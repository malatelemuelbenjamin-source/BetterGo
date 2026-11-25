/**
 * Prompt 67 — digital records centre: timeline accuracy, ownership isolation,
 * filters, record details, receipts, exports, privacy workflow, retention and
 * administrative scope.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4619
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4records-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let editorCookie = ''
let applicationId = null
let otherApplicationId = null
let reference = null
let documentId = null
let privacyReference = null

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
  assert.equal(response.status, 200, `login failed for ${email}`)
  return (response.headers.get('set-cookie') || '').split(';')[0]
}

const register = async (email, firstName, municipalityId = 1) => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { firstName, lastName: 'Records', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId, acceptTerms: true, acceptPrivacy: true },
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

  await register('p4records-citizen@example.com', 'Citizen')
  await register('p4records-other@example.com', 'Other', 2)

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const insertUser = (name, email) =>
    Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES (?, ?, ?, datetime('now'), 'active')`).run(name, email, hash).lastInsertRowid)
  const adminId = insertUser('Records Admin', 'p4records-admin@example.com')
  const editorId = insertUser('Boac Editor', 'p4records-editor@example.com')
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(adminId, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(editorId, municipalRole)

  const citizenId = db.prepare(`SELECT id FROM users WHERE email = 'p4records-citizen@example.com'`).get().id
  const otherId = db.prepare(`SELECT id FROM users WHERE email = 'p4records-other@example.com'`).get().id
  const categoryId = db.prepare('SELECT id FROM service_categories LIMIT 1').get().id
  const service = { id: Number(db.prepare(
    `INSERT INTO government_services (title, slug, description, category_id, publication_status, published_at)
     VALUES ('Records test service', 'p4-records-service', 'Used by records tests.', ?, 'published', datetime('now'))`,
  ).run(categoryId).lastInsertRowid) }
  reference = 'BG-67-TEST-0001'
  applicationId = Number(
    db.prepare(
      `INSERT INTO citizen_applications (reference, user_id, municipality_id, service_id, status, submitted_at, submission_classification)
       VALUES (?, ?, 1, ?, 'submitted', datetime('now','-2 days'), 'bettergo_intake')`,
    ).run(reference, citizenId, service.id).lastInsertRowid,
  )
  db.prepare(`INSERT INTO citizen_application_events (application_id, from_status, to_status, citizen_visible, note) VALUES (?, NULL, 'submitted', 1, 'BetterGo intake received')`).run(applicationId)
  db.prepare(`INSERT INTO citizen_application_events (application_id, from_status, to_status, citizen_visible, note) VALUES (?, 'submitted', 'in_review', 1, 'Opened for review')`).run(applicationId)

  otherApplicationId = Number(
    db.prepare(
      `INSERT INTO citizen_applications (reference, user_id, municipality_id, service_id, status, submitted_at, submission_classification)
       VALUES ('BG-67-OTHER-0001', ?, 2, ?, 'submitted', datetime('now'), 'bettergo_intake')`,
    ).run(otherId, service.id).lastInsertRowid,
  )

  documentId = Number(
    db.prepare(
      `INSERT INTO citizen_documents (user_id, category, original_filename, storage_reference, mime_type, file_size, title, status)
       VALUES (?, 'certificates', 'clearance.pdf', 'stored.pdf', 'application/pdf', 120, 'Barangay clearance', 'active')`,
    ).run(citizenId).lastInsertRowid,
  )
  db.prepare(`INSERT INTO document_events (document_id, user_id, event_type, detail) VALUES (?, ?, 'uploaded', 'Uploaded to private vault')`).run(documentId, citizenId)
  db.prepare(`INSERT INTO account_security_events (user_id, event_type, detail) VALUES (?, 'login_success', 'Password sign-in')`).run(citizenId)
  db.prepare(`INSERT INTO profile_change_events (user_id, field_category, changed_fields) VALUES (?, 'personal_information', 'name')`).run(citizenId)

  privacyReference = 'BGDR-67-TEST-0001'
  db.prepare(
    `INSERT INTO data_requests (reference, user_id, requester_name, requester_email, category, description, status)
     VALUES (?, ?, 'Citizen Records', 'p4records-citizen@example.com', 'access', 'Please send a copy of my data.', 'submitted')`,
  ).run(privacyReference, citizenId)
  db.close()

  cookie = await login('p4records-citizen@example.com')
  otherCookie = await login('p4records-other@example.com')
  adminCookie = await login('p4records-admin@example.com')
  editorCookie = await login('p4records-editor@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('the records timeline is built only from the caller’s stored records', async () => {
  const response = await request('/api/account/records?limit=50')
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.total >= 6, true, JSON.stringify(body.counts))
  assert.equal(body.categories.find((entry) => entry.key === 'applications').count, 3)
  assert.equal(body.counts.documents, 1)
  assert.equal(body.counts.security >= 1, true)
  assert.match(body.disclaimer, /not official government records/i)
  assert.equal(body.results.some((row) => row.reference === 'BG-67-OTHER-0001'), false)
  // Stable chronological ordering, newest first.
  const dates = body.results.map((row) => row.occurredAt)
  assert.deepEqual(dates, [...dates].sort().reverse())
})

test('categories, search, date range and status filters narrow real records', async () => {
  const applications = await (await request('/api/account/records?category=applications')).json()
  assert.equal(applications.total, 3)
  assert.equal(applications.results.every((row) => row.category === 'applications'), true)

  const searched = await (await request(`/api/account/records?q=${reference}`)).json()
  assert.equal(searched.total >= 1, true)
  assert.equal(searched.results.every((row) => String(row.reference).includes(reference) || String(row.title).includes(reference)), true)

  const future = await (await request('/api/account/records?from=2999-01-01')).json()
  assert.equal(future.total, 0)

  const status = await (await request('/api/account/records?status=Withdrawn%20by%20you')).json()
  assert.equal(status.total, 0)
})

test('one citizen cannot read another citizen’s record detail', async () => {
  const foreign = await request(`/api/account/records/application/${applicationId}`, {}, otherCookie)
  assert.equal(foreign.status, 404)
  const own = await request(`/api/account/records/application/${applicationId}`)
  assert.equal(own.status, 200)
  const body = await own.json()
  assert.equal(body.record.reference, reference)
  assert.equal(body.record.history.length, 2)

  const foreignDocument = await request(`/api/account/records/document/${documentId}`, {}, otherCookie)
  assert.equal(foreignDocument.status, 404)
  const ownDocument = await (await request(`/api/account/records/document/${documentId}`)).json()
  assert.equal(ownDocument.record.title, 'Barangay clearance')
})

test('a BetterGo submission receipt is explicit about what it is not', async () => {
  const response = await request(`/api/account/applications/${reference}/receipt`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control'), /no-store/)
  const body = await response.json()
  assert.equal(body.receipt.reference, reference)
  assert.equal(body.receipt.classification, 'bettergo_intake')
  assert.match(body.receipt.disclaimer, /not proof of official government filing/i)
  assert.equal(body.receipt.externalReference, null)

  const foreign = await request(`/api/account/applications/${reference}/receipt`, {}, otherCookie)
  assert.equal(foreign.status, 404)
})

test('activity summaries export as CSV and JSON with a platform disclaimer', async () => {
  const csv = await request('/api/account/records/export?format=csv&category=applications')
  assert.equal(csv.status, 200)
  assert.match(csv.headers.get('content-type'), /text\/csv/)
  assert.match(csv.headers.get('content-disposition'), /attachment/)
  const text = await csv.text()
  assert.match(text, /BetterGo Marinduque activity summary/)
  assert.match(text, /not official government records/i)
  assert.match(text, new RegExp(reference))

  const json = await (await request('/api/account/records/export?format=json')).json()
  assert.equal(json.platform, 'BetterGo Marinduque')
  assert.equal(json.records.some((row) => row.reference === 'BG-67-OTHER-0001'), false)
})

test('citizens track privacy requests and see platform statuses, not government decisions', async () => {
  const submitted = await request('/api/account/privacy/requests', {
    method: 'POST',
    json: { category: 'correction', description: 'My address is spelled incorrectly in my profile.' },
  })
  assert.equal(submitted.status, 201)

  const list = await (await request('/api/account/privacy/requests')).json()
  assert.equal(list.results.length >= 2, true)
  assert.equal(list.statuses.submitted, 'Submitted')
  assert.match(list.note, /not government decisions/i)
  assert.equal(list.results[0].statusLabel.length > 0, true)
})

test('retention policies are visible to citizens and protect active records', async () => {
  const retention = await (await request('/api/account/records/retention')).json()
  assert.equal(retention.policies.length, 4)
  assert.equal(retention.policies.every((row) => row.retentionDays === null), true)
  assert.match(retention.note, /Active application records are never deleted automatically/i)
})

test('administrators search within scope and cannot archive an active record', async () => {
  const admin = await (await request('/api/admin/records?q=BG-67', {}, adminCookie)).json()
  assert.equal(admin.results.length >= 2, true)

  const scoped = await (await request('/api/admin/records?q=BG-67', {}, editorCookie)).json()
  assert.equal(scoped.results.length, 1)
  assert.equal(scoped.results[0].reference, 'BG-67-OTHER-0001')

  const blocked = await request(`/api/admin/records/application/${applicationId}/archive`, {
    method: 'POST',
    json: { reason: 'Retention review' },
  }, adminCookie)
  assert.equal(blocked.status, 422)
  assert.match((await blocked.json()).error, /active application/i)

  const foreign = await request(`/api/admin/records/application/${applicationId}/archive`, { method: 'POST', json: { reason: 'Retention review' } }, editorCookie)
  assert.equal(foreign.status, 404, 'municipality scope hides records from other municipalities')
})

test('a closed record can be archived and restored without losing history', async () => {
  const db = new DatabaseSync(DB_PATH)
  db.prepare(`UPDATE citizen_applications SET status = 'closed', closed_at = datetime('now') WHERE id = ?`).run(otherApplicationId)
  db.close()

  const archived = await request(`/api/admin/records/application/${otherApplicationId}/archive`, {
    method: 'POST',
    json: { reason: 'Closed more than a year ago' },
  }, adminCookie)
  assert.equal(archived.status, 200, await archived.text())

  const history = await (await request(`/api/admin/records/application/${otherApplicationId}/history`, {}, adminCookie)).json()
  assert.equal(history.archiveEvents.length, 1)
  assert.equal(history.archiveEvents[0].action, 'archived')

  const restored = await request(`/api/admin/records/application/${otherApplicationId}/restore`, { method: 'POST', json: {} }, adminCookie)
  assert.equal(restored.status, 200)
})

test('retention settings are restricted to province-wide administrators', async () => {
  const denied = await request('/api/admin/records/retention', { method: 'PUT', json: { recordType: 'application', retentionDays: 365 } }, editorCookie)
  assert.equal(denied.status, 403)

  const saved = await request('/api/admin/records/retention', { method: 'PUT', json: { recordType: 'application', retentionDays: 365 } }, adminCookie)
  assert.equal(saved.status, 200, await saved.text())
  const policies = await (await request('/api/admin/records/retention', {}, adminCookie)).json()
  assert.equal(policies.policies.find((row) => row.recordType === 'application').retentionDays, 365)
})

test('privacy requests are processed by authorised staff only', async () => {
  const list = await (await request('/api/admin/records/privacy-requests', {}, adminCookie)).json()
  assert.equal(list.results.length >= 2, true)

  const denied = await request(`/api/admin/records/privacy-requests/${privacyReference}`, { method: 'PATCH', json: { status: 'under_review' } }, editorCookie)
  assert.equal([403, 404].includes(denied.status), true, 'out-of-scope or unauthorised staff cannot decide a request')

  const noReason = await request(`/api/admin/records/privacy-requests/${privacyReference}`, { method: 'PATCH', json: { status: 'rejected' } }, adminCookie)
  assert.equal(noReason.status, 400)

  const accepted = await request(`/api/admin/records/privacy-requests/${privacyReference}`, {
    method: 'PATCH',
    json: { status: 'awaiting_citizen', note: 'Please confirm the email address on the account.' },
  }, adminCookie)
  assert.equal(accepted.status, 200, await accepted.text())

  const citizenView = await (await request('/api/account/privacy/requests')).json()
  const row = citizenView.results.find((entry) => entry.reference === privacyReference)
  assert.equal(row.status, 'awaiting_citizen')

  const timeline = await (await request('/api/account/records?category=privacy')).json()
  assert.equal(timeline.results.some((entry) => entry.type === 'privacy_decision'), true)
})

test('unauthenticated callers receive no records', async () => {
  for (const pathname of ['/api/account/records', '/api/account/records/export', '/api/account/applications/BG-67-TEST-0001/receipt']) {
    const response = await request(pathname, {}, '')
    assert.equal(response.status, 401, pathname)
  }
})
