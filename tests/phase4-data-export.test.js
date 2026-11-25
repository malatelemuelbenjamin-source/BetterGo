/**
 * Prompt 84 — category-based personal data exports, CSV/README downloads,
 * expiry, duplicate prevention and administrative retention.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4661
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4export-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
let exportId = null

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
    json: { firstName, lastName: 'Export', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  }, '')
  assert.equal(response.status, 201, await response.text())
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_PATH: DB_PATH, API_PORT: String(PORT), SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac', NODE_ENV: 'test' },
    stdio: 'ignore',
  })
  await waitForServer()
  await register('p4export-citizen@example.com', 'Ex')
  await register('p4export-other@example.com', 'Other')
  cookie = await login('p4export-citizen@example.com')
  otherCookie = await login('p4export-other@example.com')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const owner = db.prepare(`SELECT id FROM users WHERE email = 'p4export-citizen@example.com'`).get()
  db.prepare(`INSERT INTO citizen_applications (reference, user_id, status) VALUES ('BG-APP-EXPORT-1', ?, 'submitted')`).run(Number(owner.id))
  const category = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get()
  const serviceId = Number(db.prepare(`INSERT INTO government_services (title, slug, category_id, publication_status) VALUES ('Export service', 'p4-export-service', ?, 'published')`).run(category.id).lastInsertRowid)
  db.prepare(`INSERT INTO service_journeys (reference, user_id, service_id, title) VALUES ('BG-JRN-EXPORT-1', ?, ?, 'Export journey')`).run(Number(owner.id), serviceId)
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Export Admin', 'p4export-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Export Admin', 'p4export-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  db.close()

  adminCookie = await login('p4export-admin@example.com')
  scopedCookie = await login('p4export-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('the portability centre explains categories and exclusions', async () => {
  const body = await (await request('/api/account/portability')).json()
  assert.ok(Object.keys(body.categories).length >= 10)
  assert.match(body.note, /own BetterGo records/i)
  assert.ok(body.exclusions.some((item) => /passwords/i.test(item)))
  assert.ok(body.limitations.some((item) => /PDF/i.test(item)))
  assert.equal(body.retentionDays, 7)
  assert.equal(body.exports.length, 0)
})

test('exports require valid categories and avoid duplicates', async () => {
  assert.equal((await request('/api/account/exports', { json: { categories: [] } })).status, 422)
  assert.equal((await request('/api/account/exports', { json: { categories: ['passwords'] } })).status, 422)

  const created = await request('/api/account/exports', { json: { categories: ['profile', 'applications', 'journeys'] } })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.equal(body.export.status, 'completed')
  assert.deepEqual(body.export.categories.sort(), ['applications', 'journeys', 'profile'])
  assert.equal(body.export.recordCounts.applications, 1)
  assert.equal(body.export.recordCounts.journeys, 1)
  assert.match(body.message, /expires after 7 days/i)
  exportId = body.export.id

  const duplicate = await request('/api/account/exports', { json: { categories: ['applications', 'journeys', 'profile'] } })
  assert.equal(duplicate.status, 422)
})

test('downloads are owner-only and support JSON, CSV and a README', async () => {
  assert.equal((await request(`/api/account/exports/${exportId}`, {}, otherCookie)).status, 404)

  const json = await request(`/api/account/exports/${exportId}`)
  assert.equal(json.status, 200)
  assert.match(json.headers.get('content-disposition') || '', /attachment/)
  const text = await json.text()
  assert.match(text, /BG-APP-EXPORT-1/)
  assert.match(text, /BG-JRN-EXPORT-1/)
  assert.doesNotMatch(text, /"password|"token/)

  const csv = await request(`/api/account/exports/${exportId}?format=csv&section=applications`)
  assert.equal(csv.status, 200)
  assert.match(csv.headers.get('content-type') || '', /text\/csv/)
  assert.match(await csv.text(), /BG-APP-EXPORT-1/)

  const badCsv = await request(`/api/account/exports/${exportId}?format=csv&section=complaints`)
  assert.equal(badCsv.status, 422)

  const readme = await request(`/api/account/exports/${exportId}?format=readme`)
  assert.equal(readme.status, 200)
  assert.match(await readme.text(), /not an official government record/i)

  assert.equal((await request(`/api/account/exports/${exportId}`, {}, '')).status, 401)
})

test('expired exports cannot be downloaded and are marked honestly', async () => {
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  db.prepare(`UPDATE data_exports SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`).run(exportId)
  db.close()

  const list = await (await request('/api/account/portability')).json()
  assert.equal(list.exports.find((row) => row.id === exportId).status, 'expired')

  const download = await request(`/api/account/exports/${exportId}`)
  assert.equal(download.status, 404)

  const fresh = await request('/api/account/exports', { json: { categories: ['profile', 'applications', 'journeys'] } })
  assert.equal(fresh.status, 201, 'an expired export does not block a new one')
  exportId = (await fresh.json()).export.id
})

test('cancelling removes export contents', async () => {
  const cancelled = await request(`/api/account/exports/${exportId}`, { method: 'DELETE' })
  assert.equal(cancelled.status, 200)
  assert.equal((await request(`/api/account/exports/${exportId}`)).status, 422)

  const list = await (await request('/api/account/portability')).json()
  assert.equal(list.exports.find((row) => row.id === exportId).status, 'cancelled')
})

test('administrators see metadata only and purge within scope', async () => {
  const created = await request('/api/account/exports', { json: { categories: ['profile'] } })
  const createdBody = await created.json()
  assert.ok(createdBody.export, JSON.stringify(createdBody))
  const target = createdBody.export

  const scoped = await (await request('/api/admin/data-exports', {}, scopedCookie)).json()
  assert.equal(scoped.results.length, 0, 'another municipality cannot see this export')
  const crossPurge = await request(`/api/admin/data-exports/${target.id}/purge`, { json: { note: 'Not my scope' } }, scopedCookie)
  assert.equal(crossPurge.status, 404)

  const view = await (await request('/api/admin/data-exports', {}, adminCookie)).json()
  assert.match(view.note, /does not expose package contents/i)
  assert.ok(view.results.some((row) => row.id === target.id))
  assert.ok(!JSON.stringify(view.results).includes('BetterGo holds about your own account'), 'package contents are never returned')

  const purged = await request(`/api/admin/data-exports/${target.id}/purge`, { json: { note: 'Retention period elapsed.' } }, adminCookie)
  assert.equal(purged.status, 200)
  const after = await (await request('/api/admin/data-exports', {}, adminCookie)).json()
  assert.equal(after.results.find((row) => row.id === target.id).status, 'expired')
})
