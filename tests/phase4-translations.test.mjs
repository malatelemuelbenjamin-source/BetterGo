/**
 * Prompt 83 — Filipino language access and translation requests.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4651
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4trans-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
let serviceId = null
let draftId = null
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
    json: { firstName, lastName: 'Wika', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  }, '')
  assert.equal(response.status, 201, await response.text())
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_PATH: DB_PATH, API_PORT: String(PORT), SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac', NODE_ENV: 'test' },
    stdio: 'ignore',
  })
  await waitForServer()
  await register('p4trans-citizen@example.com', 'Wika')
  await register('p4trans-other@example.com', 'Other')
  cookie = await login('p4trans-citizen@example.com')
  otherCookie = await login('p4trans-other@example.com')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Wika Admin', 'p4trans-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Wika Admin', 'p4trans-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  const category = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get()
  serviceId = Number(db.prepare(
    `INSERT INTO government_services (title, slug, category_id, municipality_id, publication_status, verification_status, fees)
     VALUES ('Business permit', 'p4-trans-business-permit', ?, 1, 'published', 'verified', 'PHP 500')`,
  ).run(category.id).lastInsertRowid)
  draftId = Number(db.prepare(
    `INSERT INTO government_services (title, slug, category_id, publication_status) VALUES ('Draft permit', 'p4-trans-draft-permit', ?, 'draft')`,
  ).run(category.id).lastInsertRowid)
  db.close()

  adminCookie = await login('p4trans-admin@example.com')
  scopedCookie = await login('p4trans-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('citizens request translations for published services only', async () => {
  const initial = await (await request('/api/account/translations')).json()
  assert.deepEqual(initial.translations, [])
  assert.ok(initial.availableServices.some((service) => service.id === serviceId))
  assert.ok(!initial.availableServices.some((service) => service.id === draftId))
  assert.match(initial.note, /English published text is the service record/i)

  const draft = await request('/api/account/translations/requests', { json: { serviceId: draftId, language: 'fil' } })
  assert.equal(draft.status, 422)

  const created = await request('/api/account/translations/requests', { json: { serviceId: serviceId, language: 'fil', note: 'For my lola' } })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.match(body.request.reference, /^BG-TR-/)
  assert.equal(body.request.status, 'pending')
  assert.match(body.message, /no translation is promised/i)
  requestId = body.request.id

  const duplicate = await request('/api/account/translations/requests', { json: { serviceId, language: 'fil' } })
  assert.equal(duplicate.status, 422)

  const other = await (await request('/api/account/translations', {}, otherCookie)).json()
  assert.equal(other.requests.length, 0, 'requests stay private to the citizen')
})

test('a request cannot be completed before a translation exists', async () => {
  const early = await request(`/api/admin/translations/requests/${requestId}/decision`, { json: { decision: 'completed', note: 'Done' } }, adminCookie)
  assert.equal(early.status, 422)

  const foreign = await request(`/api/admin/translations/requests/${requestId}/decision`, { json: { decision: 'declined', note: 'Not available' } }, scopedCookie)
  assert.equal(foreign.status, 404, await foreign.clone().text())
})

test('offices publish reading aids and confirmed translations in scope', async () => {
  const payload = {
    title: 'Pahintulot sa Negosyo',
    summary: 'Pahintulot na inilalabas ng tanggapan ng negosyo.',
    requirements: 'Validong ID at aplikasyon.',
    fees: 'PHP 500 ayon sa naisapubliko',
    procedure: 'Pumunta sa tanggapan ng negosyo.',
    status: 'draft',
    source: 'BetterGo staff reading of the English page',
  }

  const crossScope = await request(`/api/admin/translations/services/${serviceId}`, { method: 'PUT', json: payload }, scopedCookie)
  assert.equal(crossScope.status, 404)

  const saved = await request(`/api/admin/translations/services/${serviceId}`, { method: 'PUT', json: payload }, adminCookie)
  assert.equal(saved.status, 200, await saved.clone().text())
  const savedBody = await saved.json()
  assert.equal(savedBody.translation.status, 'draft')
  assert.match(savedBody.message, /reading aid/i)

  const citizenView = await (await request('/api/account/translations')).json()
  assert.equal(citizenView.translations.length, 1)
  assert.equal(citizenView.translations[0].status, 'draft')
  assert.equal(citizenView.translations[0].fees, 'PHP 500 ayon sa naisapubliko')
  assert.equal(citizenView.availableServices.length, 0, 'a translated service is no longer offered')

  const confirmed = await request(`/api/admin/translations/services/${serviceId}`, {
    method: 'PUT',
    json: { ...payload, status: 'office_confirmed', source: 'Confirmed by the Business Permits office' },
    headers: {},
  }, adminCookie)
  assert.equal(confirmed.status, 200, await confirmed.clone().text())
  assert.match((await confirmed.json()).message, /confirmed by the responsible office/i)
})

test('admin completes the request once the translation exists', async () => {
  const done = await request(`/api/admin/translations/requests/${requestId}/decision`, { json: { decision: 'completed', note: 'Filipino page published' } }, adminCookie)
  assert.equal(done.status, 200)

  const view = await (await request('/api/account/translations')).json()
  assert.equal(view.requests[0].status, 'completed')
  assert.equal(view.requests[0].responseNote, 'Filipino page published')

  const adminView = await (await request('/api/admin/translations', {}, adminCookie)).json()
  assert.match(adminView.note, /never publish a machine translation as official/i)
  const row = adminView.services.find((service) => service.id === serviceId)
  assert.equal(row.translation.status, 'office_confirmed')
  assert.equal(row.translation.title, 'Pahintulot sa Negosyo')
})

test('cancelling a pending request closes it honestly', async () => {
  const second = await request('/api/account/translations/requests', { json: { serviceId: draftId, language: 'fil' } })
  assert.equal(second.status, 422, 'drafts are never requestable')

  const created = await request('/api/account/translations/requests', { json: { serviceId, language: 'fil' } })
  // Already translated but a citizen may still ask for help; the request is accepted.
  const body = await created.json()
  const cancelled = await request(`/api/account/translations/requests/${body.request.id}/cancel`, { json: {} })
  assert.equal(cancelled.status, 200)
  assert.equal((await request(`/api/account/translations/requests/${body.request.id}/cancel`, { json: {} })).status, 422)
})
