/**
 * Prompt 77 — complaint cases, comments, vault attachments, transitions and scope.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4639
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4cases-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
const ids = {}
let caseId = null

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return
    } catch { /* not up */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('API did not become ready')
}

function request(pathname, options = {}, as = cookie) {
  const headers = { Accept: 'application/json', Origin: BASE, ...(options.headers || {}) }
  if (as) headers.Cookie = as
  if (options.json) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(options.json)
  }
  return fetch(`${BASE}${pathname}`, { method: options.method || (options.body ? 'POST' : 'GET'), headers, body: options.body })
}

const login = async (email) => {
  const response = await request('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } }, '')
  assert.equal(response.status, 200)
  return (response.headers.get('set-cookie') || '').split(';')[0]
}

const register = async (email, firstName) => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { firstName, lastName: 'Cases', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  }, '')
  assert.equal(response.status, 201, await response.text())
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      DATABASE_PATH: DB_PATH,
      API_PORT: String(PORT),
      SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac',
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
  })
  await waitForServer()
  await register('p4cases-citizen@example.com', 'Citizen')
  await register('p4cases-other@example.com', 'Other')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  ids.office = Number(db.prepare(`INSERT INTO government_offices (municipality_id, name, slug, publication_status) VALUES (1, 'Boac Office', 'p4-boac-office', 'published')`).run().lastInsertRowid)
  const citizen = db.prepare(`SELECT id FROM users WHERE email = 'p4cases-citizen@example.com'`).get()
  const other = db.prepare(`SELECT id FROM users WHERE email = 'p4cases-other@example.com'`).get()
  ids.citizen = Number(citizen.id)
  ids.document = Number(db.prepare(`INSERT INTO citizen_documents (user_id, category, original_filename, storage_reference, mime_type, file_size, status) VALUES (?, 'other', 'photo.jpg', 'private/photo.jpg', 'image/jpeg', 100, 'active')`).run(ids.citizen).lastInsertRowid)
  ids.otherDocument = Number(db.prepare(`INSERT INTO citizen_documents (user_id, category, original_filename, storage_reference, mime_type, file_size, status) VALUES (?, 'other', 'other.jpg', 'private/other.jpg', 'image/jpeg', 100, 'active')`).run(Number(other.id)).lastInsertRowid)
  db.close()

  cookie = await login('p4cases-citizen@example.com')
  otherCookie = await login('p4cases-other@example.com')

  const db2 = new DatabaseSync(DB_PATH)
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db2.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Case Admin', 'p4cases-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db2.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Case Admin', 'p4cases-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db2.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db2.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db2.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db2.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  db2.close()

  adminCookie = await login('p4cases-admin@example.com')
  scopedCookie = await login('p4cases-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

const validCase = (overrides = {}) => ({
  category: 'delay',
  subject: 'Long queue at the office',
  description: 'I waited for more than three hours at the counter without an explanation.',
  locationText: 'Municipal hall counter',
  municipalityId: 1,
  officeId: ids.office,
  severity: 'normal',
  ...overrides,
})

test('cases are validated, referenced and clearly labelled', async () => {
  const invalid = await request('/api/account/complaints', { json: validCase({ description: 'Too short' }) })
  assert.equal(invalid.status, 422)

  const created = await request('/api/account/complaints', { json: validCase() })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.match(body.case.reference, /^BG-CASE-[A-Z2-9]{6}$/)
  assert.equal(body.case.status, 'new')
  assert.equal(body.case.categoryLabel, 'Delay or slow processing')
  assert.match(body.message, /not the deciding government office/i)
  caseId = body.case.id

  const overview = await (await request('/api/account/complaints')).json()
  assert.equal(overview.open.length, 1)
  assert.match(overview.notice, /not an official government finding/i)
})

test('cases are private and accept comments and vault attachments', async () => {
  assert.equal((await request(`/api/account/complaints/${caseId}`, {}, otherCookie)).status, 404)
  assert.equal((await request(`/api/account/complaints/${caseId}/comments`, { method: 'POST', json: { note: 'More detail' } }, otherCookie)).status, 404)

  const comment = await request(`/api/account/complaints/${caseId}/comments`, { json: { note: 'The queue number was not called.' } })
  assert.equal(comment.status, 201)

  const foreign = await request(`/api/account/complaints/${caseId}/attachments`, { json: { documentId: ids.otherDocument } })
  assert.equal(foreign.status, 422)

  const own = await request(`/api/account/complaints/${caseId}/attachments`, { json: { documentId: ids.document } })
  assert.equal(own.status, 201)
  assert.match((await own.json()).message, /remains private/i)

  const detail = await (await request(`/api/account/complaints/${caseId}`)).json()
  assert.equal(detail.case.attachments.length, 1)
  assert.equal(detail.case.events.some((event) => event.action === 'citizen_comment'), true)
  assert.match(detail.label, /not an official government decision/i)

  const summary = await (await request(`/api/account/complaints/${caseId}/summary`)).text()
  assert.match(summary, /not an official government decision|not an official government/i)
})

test('administrators follow allowed transitions, with reasons, inside scope', async () => {
  const forbidden = await request(`/api/admin/complaints/${caseId}/status`, { method: 'POST', json: { status: 'acknowledged' } }, scopedCookie)
  assert.equal(forbidden.status, 404)

  const skip = await request(`/api/admin/complaints/${caseId}/status`, { method: 'POST', json: { status: 'resolved', note: 'Done' } }, adminCookie)
  assert.equal(skip.status, 422)

  const acknowledged = await request(`/api/admin/complaints/${caseId}/status`, { method: 'POST', json: { status: 'acknowledged', note: 'Received' } }, adminCookie)
  assert.equal(acknowledged.status, 200)

  const review = await request(`/api/admin/complaints/${caseId}/status`, { method: 'POST', json: { status: 'in_review' } }, adminCookie)
  assert.equal(review.status, 200)

  const noExplanation = await request(`/api/admin/complaints/${caseId}/status`, { method: 'POST', json: { status: 'resolved' } }, adminCookie)
  assert.equal(noExplanation.status, 422)

  const resolved = await request(`/api/admin/complaints/${caseId}/status`, { method: 'POST', json: { status: 'resolved', note: 'Queue process reviewed with the office.' } }, adminCookie)
  assert.equal(resolved.status, 200)
  const resolvedBody = await resolved.json()
  assert.equal(resolvedBody.case.resolutionSummary, 'Queue process reviewed with the office.')

  const citizenView = await (await request(`/api/account/complaints/${caseId}`)).json()
  assert.equal(citizenView.case.status, 'resolved')
})

test('confidential cases hide citizen identity from the admin queue', async () => {
  const created = await request('/api/account/complaints', { json: validCase({ subject: 'Private concern', confidential: true }) })
  const body = await created.json()
  const queue = await (await request('/api/admin/complaints', {}, adminCookie)).json()
  const row = queue.results.find((item) => item.id === body.case.id)
  assert.equal(row.citizenName, 'Restricted')
  assert.match(queue.note, /not official government findings/i)
})

test('withdrawn cases cannot receive further comments', async () => {
  const created = await request('/api/account/complaints', { json: validCase({ subject: 'Withdraw me' }) })
  const body = await created.json()
  const withdrawn = await request(`/api/account/complaints/${body.case.id}/withdraw`, { method: 'POST', json: {} })
  assert.equal(withdrawn.status, 200)
  assert.match((await withdrawn.json()).message, /separate official complaint/i)
  const comment = await request(`/api/account/complaints/${body.case.id}/comments`, { json: { note: 'One more thing' } })
  assert.equal(comment.status, 422)
})

test('case analytics are aggregated and the endpoints require authentication', async () => {
  const analytics = await (await request('/api/admin/complaints/analytics', {}, adminCookie)).json()
  assert.equal(analytics.totals.cases >= 3, true)
  assert.equal(JSON.stringify(analytics).includes('Long queue'), false)
  assert.match(analytics.note, /No citizen names/i)

  assert.equal((await request('/api/account/complaints', {}, '')).status, 401)
  assert.equal((await request('/api/admin/complaints', {}, cookie)).status, 403)
})
