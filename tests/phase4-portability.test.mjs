/**
 * Prompt 84 — data portability exports and reviewed account closure requests.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4653
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4port-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
let exportId = null
let closureId = null

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
    json: { firstName, lastName: 'Portability', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  }, '')
  assert.equal(response.status, 201, await response.text())
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_PATH: DB_PATH, API_PORT: String(PORT), SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac', NODE_ENV: 'test' },
    stdio: 'ignore',
  })
  await waitForServer()
  await register('p4port-citizen@example.com', 'Port')
  await register('p4port-other@example.com', 'Other')
  cookie = await login('p4port-citizen@example.com')
  otherCookie = await login('p4port-other@example.com')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const owner = db.prepare(`SELECT id FROM users WHERE email = 'p4port-citizen@example.com'`).get()
  db.prepare(`INSERT INTO citizen_applications (reference, user_id, status) VALUES ('BG-APP-EXPORT1', ?, 'submitted')`).run(Number(owner.id))
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Port Admin', 'p4port-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Port Admin', 'p4port-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  db.close()

  adminCookie = await login('p4port-admin@example.com')
  scopedCookie = await login('p4port-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('exports contain only the owner’s BetterGo records', async () => {
  const created = await request('/api/account/exports', { json: { categories: ['profile', 'applications', 'appointments', 'document_requests', 'complaints', 'journeys', 'consents', 'delegations', 'notifications', 'documents'] } })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.match(body.export.reference, /^BG-EXP-/)
  assert.ok(body.export.categories.includes('applications'))
  assert.ok(body.export.categories.includes('profile'))
  assert.equal(body.export.recordCounts.applications, 1)
  exportId = body.export.id

  const download = await request(`/api/account/exports/${exportId}`)
  assert.equal(download.status, 200)
  assert.match(download.headers.get('content-disposition') || '', /attachment/)
  const text = await download.text()
  assert.match(text, /BG-APP-EXPORT1/)
  assert.doesNotMatch(text, /"password|"session|"token/)
  assert.match(text, /only the records BetterGo holds/i)

  assert.equal((await request(`/api/account/exports/${exportId}`, {}, otherCookie)).status, 404)
  assert.equal((await request('/api/account/exports', {}, '')).status, 401)
})

test('export history is deletable by its owner only', async () => {
  assert.equal((await request(`/api/account/exports/${exportId}`, { method: 'DELETE' }, otherCookie)).status, 404)
  const removed = await request(`/api/account/exports/${exportId}`, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  assert.equal((await request(`/api/account/exports/${exportId}`)).status, 422)
})

test('closure requests require review and never delete anything immediately', async () => {
  const created = await request('/api/account/closure-requests', { json: { reason: 'Moving abroad' } })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.equal(body.closure.status, 'pending_review')
  assert.match(body.message, /nothing is deleted yet/i)
  closureId = body.closure.id

  const duplicate = await request('/api/account/closure-requests', { json: { reason: 'Again' } })
  assert.equal(duplicate.status, 422)

  const account = await (await request('/api/auth/me')).json()
  assert.equal(account.user.email, 'p4port-citizen@example.com', 'the account still works while pending')
})

test('the citizen can cancel while pending', async () => {
  const cancelled = await request(`/api/account/closure-requests/${closureId}/cancel`, { json: {} })
  assert.equal(cancelled.status, 200)
  assert.equal((await request(`/api/account/closure-requests/${closureId}/cancel`, { json: {} })).status, 422)
})

test('closure review is municipality-scoped and never performs deletion', async () => {
  const created = await request('/api/account/closure-requests', { json: { reason: 'Prefer not to say' } })
  const { closure } = await created.json()

  const scopedView = await (await request('/api/admin/closure-requests', {}, scopedCookie)).json()
  assert.equal(scopedView.results.length, 0, 'another municipality sees no requests')

  const crossScope = await request(`/api/admin/closure-requests/${closure.id}/decision`, { json: { decision: 'declined', note: 'Not my scope' } }, scopedCookie)
  assert.equal(crossScope.status, 404)

  const view = await (await request('/api/admin/closure-requests', {}, adminCookie)).json()
  assert.match(view.note, /nothing is deleted/i)
  assert.ok(view.results.some((row) => row.id === closure.id))

  const approved = await request(`/api/admin/closure-requests/${closure.id}/decision`, { json: { decision: 'approved', note: 'Checked privacy requests; ready for manual closure.' } }, adminCookie)
  assert.equal(approved.status, 200)
  assert.match((await approved.json()).message, /no data was deleted/i)

  const duplicate = await request(`/api/admin/closure-requests/${closure.id}/decision`, { json: { decision: 'declined', note: 'Changed mind' } }, adminCookie)
  assert.equal(duplicate.status, 422)
})
