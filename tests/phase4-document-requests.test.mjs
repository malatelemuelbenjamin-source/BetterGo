/**
 * Prompt 76 — document request guidance, request tracking and office status.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4637
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4docs-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
const ids = {}
let requestId = null

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
    json: { firstName, lastName: 'Docs', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
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
  await register('p4docs-citizen@example.com', 'Citizen')
  await register('p4docs-other@example.com', 'Other')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const category = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get()
  ids.office = Number(db.prepare(
    `INSERT INTO government_offices (municipality_id, name, slug, address, phone, operating_hours, publication_status, verification_status)
     VALUES (1, 'Boac Civil Registrar', 'p4-boac-registrar', 'Municipal Hall', '042-000-0000', '8am-5pm', 'published', 'verified')`,
  ).run().lastInsertRowid)
  const makeService = (title, slug, method, extra = {}) =>
    Number(db.prepare(
      `INSERT INTO government_services (title, slug, category_id, municipality_id, service_scope, publication_status, published_at, office_id, request_method, external_request_url, request_instructions)
       VALUES (?, ?, ?, ?, 'municipal', 'published', datetime('now'), ?, ?, ?, ?)`,
    ).run(title, slug, category.id, extra.municipalityId || 1, extra.officeId || ids.office, method, extra.externalUrl || null, extra.instructions || null).lastInsertRowid)
  ids.bettergoService = makeService('Birth certificate request', 'p4-birth-certificate', 'bettergo', { instructions: 'Bring a valid ID.' })
  ids.externalService = makeService('External civil record', 'p4-external-record', 'external', { externalUrl: 'https://psa.example.gov.ph/request' })
  ids.otherMunicipality = makeService('Mogpog record request', 'p4-mogpog-record', 'bettergo', { municipalityId: 2 })
  ids.infoService = makeService('Information only service', 'p4-info-only', 'information')
  db.prepare(`INSERT INTO service_requirements (service_id, requirement_name, description, is_required, review_status, source_title, issuing_office) VALUES (?, 'Valid ID', 'Government issued', 1, 'approved', 'Office posting', 'Civil Registrar')`).run(ids.bettergoService)
  db.prepare(`INSERT INTO service_requirements (service_id, requirement_name, is_required, review_status) VALUES (?, 'Old requirement', 1, 'unverified')`).run(ids.bettergoService)
  db.close()

  cookie = await login('p4docs-citizen@example.com')
  otherCookie = await login('p4docs-other@example.com')

  const db2 = new DatabaseSync(DB_PATH)
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db2.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Docs Admin', 'p4docs-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db2.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Docs Admin', 'p4docs-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db2.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db2.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db2.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db2.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  db2.close()

  adminCookie = await login('p4docs-admin@example.com')
  scopedCookie = await login('p4docs-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('the request centre lists only recorded request guidance', async () => {
  const center = await (await request('/api/account/document-requests')).json()
  const slugs = center.guidance.map((row) => row.slug)
  assert.equal(slugs.includes('p4-birth-certificate'), true)
  assert.equal(slugs.includes('p4-external-record'), true)
  assert.equal(slugs.includes('p4-info-only'), true)
  assert.equal(center.guidance.find((row) => row.slug === 'p4-info-only').requestMethod, 'information')
  assert.equal(center.guidance.find((row) => row.slug === 'p4-external-record').externalUrl, 'https://psa.example.gov.ph/request')
  assert.match(center.notice, /does not issue/i)
})

test('guidance separates reviewed requirements and verified office details', async () => {
  const guidance = await (await request('/api/account/document-requests/guidance/p4-birth-certificate')).json()
  assert.equal(guidance.requirements.length, 2)
  assert.equal(guidance.requirements.find((row) => row.requirement_name === 'Valid ID').verified, true)
  assert.equal(guidance.requirements.find((row) => row.requirement_name === 'Old requirement').verified, false)
  assert.equal(guidance.office.name, 'Boac Civil Registrar')
  assert.equal(guidance.canSubmit, true)

  const external = await (await request('/api/account/document-requests/guidance/p4-external-record')).json()
  assert.equal(external.canSubmit, false)
  assert.equal(external.service.externalUrl, 'https://psa.example.gov.ph/request')
})

test('requests are recorded once and refuse unsupported methods', async () => {
  const created = await request('/api/account/document-requests', { json: { serviceSlug: 'p4-birth-certificate', purpose: 'Employment' } })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.match(body.request.reference, /^BG-DOC-[A-Z2-9]{6}$/)
  assert.equal(body.request.status, 'submitted')
  assert.match(body.message, /office still decides/i)
  requestId = body.request.id

  const duplicate = await request('/api/account/document-requests', { json: { serviceSlug: 'p4-birth-certificate' } })
  assert.equal(duplicate.status, 422)

  const unsupported = await request('/api/account/document-requests', { json: { serviceSlug: 'p4-external-record' } })
  assert.equal(unsupported.status, 422)
})

test('request details are private and summaries are labelled', async () => {
  assert.equal((await request(`/api/account/document-requests/${requestId}`, {}, otherCookie)).status, 404)
  assert.equal((await request(`/api/account/document-requests/${requestId}/cancel`, { method: 'POST', json: {} }, otherCookie)).status, 404)

  const summary = await (await request(`/api/account/document-requests/${requestId}/summary`)).text()
  assert.match(summary, /not an official document/i)
  assert.match(summary, /BG-DOC-/)
})

test('administrators record statuses within their municipality', async () => {
  const queue = await (await request('/api/admin/document-requests', {}, adminCookie)).json()
  assert.equal(queue.results.length, 1)

  const noReason = await request(`/api/admin/document-requests/${requestId}/status`, { method: 'POST', json: { status: 'rejected' } }, adminCookie)
  assert.equal(noReason.status, 422)

  const acknowledged = await request(`/api/admin/document-requests/${requestId}/status`, { method: 'POST', json: { status: 'acknowledged', note: 'Received at the office' } }, adminCookie)
  assert.equal(acknowledged.status, 200)

  const citizenView = await (await request(`/api/account/document-requests/${requestId}`)).json()
  assert.equal(citizenView.request.status, 'acknowledged')
  assert.equal(citizenView.request.officeNote, 'Received at the office')

  const scoped = await request(`/api/admin/document-requests/${requestId}/status`, { method: 'POST', json: { status: 'completed', note: 'Done' } }, scopedCookie)
  assert.equal(scoped.status, 404)

  await request(`/api/admin/document-requests/${requestId}/status`, { method: 'POST', json: { status: 'completed', note: 'Released by office' } }, adminCookie)
  const closed = await request(`/api/admin/document-requests/${requestId}/status`, { method: 'POST', json: { status: 'acknowledged' } }, adminCookie)
  assert.equal(closed.status, 422)

  const history = await (await request('/api/account/document-requests')).json()
  assert.equal(history.history.some((row) => row.id === requestId), true)
  assert.equal(history.requests.length, 0)
})

test('guidance configuration requires an external link and respects scope', async () => {
  const missing = await request(`/api/admin/document-requests/services/${ids.infoService}/guidance`, { method: 'PUT', json: { requestMethod: 'external' } }, adminCookie)
  assert.equal(missing.status, 422)

  const saved = await request(`/api/admin/document-requests/services/${ids.infoService}/guidance`, {
    method: 'PUT',
    json: { requestMethod: 'external', externalUrl: 'https://office.example.gov.ph/request', instructions: 'Use the portal' },
  }, adminCookie)
  assert.equal(saved.status, 200)

  const forbidden = await request(`/api/admin/document-requests/services/${ids.bettergoService}/guidance`, { method: 'PUT', json: { requestMethod: 'information' } }, scopedCookie)
  assert.equal(forbidden.status, 404)
})

test('document request endpoints require authentication', async () => {
  assert.equal((await request('/api/account/document-requests', {}, '')).status, 401)
  assert.equal((await request('/api/account/document-requests/guidance/p4-birth-certificate', {}, '')).status, 401)
})
