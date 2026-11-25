/**
 * Prompt 73 — requirements checker, private checklists, reminders and the
 * requirement review workflow.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4631
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4assist-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
const ids = {}

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
    json: { firstName, lastName: 'Assist', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
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
  await register('p4assist-citizen@example.com', 'Citizen')
  await register('p4assist-other@example.com', 'Other')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const category = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get()
  ids.service = Number(db.prepare(
    `INSERT INTO government_services (title, slug, description, short_description, category_id, municipality_id, service_scope, publication_status, published_at, availability_status)
     VALUES ('Boac assistance test service', 'p4-assist-service', 'Description', 'Summary', ?, 1, 'municipal', 'published', datetime('now'), 'needs_confirmation')`,
  ).run(category.id).lastInsertRowid)
  ids.otherService = Number(db.prepare(
    `INSERT INTO government_services (title, slug, category_id, municipality_id, service_scope, publication_status, published_at, availability_status)
     VALUES ('Boac second service', 'p4-assist-second', ?, 1, 'municipal', 'published', datetime('now'), 'needs_confirmation')`,
  ).run(category.id).lastInsertRowid)
  ids.approvedRequirement = Number(db.prepare(
    `INSERT INTO service_requirements (service_id, requirement_name, description, is_required, review_status, verified_at, source_title, source_url, issuing_office)
     VALUES (?, 'Barangay certificate', 'Recent certificate', 1, 'approved', datetime('now'), 'Office issuance', 'https://example.gov.ph/source', 'Barangay office')`,
  ).run(ids.service).lastInsertRowid)
  db.prepare(
    `INSERT INTO service_requirements (service_id, requirement_name, description, is_required, review_status) VALUES (?, 'Valid ID', 'Any government ID', 1, 'unverified')`,
  ).run(ids.service)
  db.prepare(`INSERT INTO service_requirements (service_id, requirement_name, is_required, review_status, archived_at) VALUES (?, 'Old item', 1, 'archived', datetime('now'))`).run(ids.service)
  db.prepare(`INSERT INTO service_procedures (service_id, step_number, title, description, office) VALUES (?, 1, 'Submit at office', 'Bring documents', 'Municipal hall')`).run(ids.service)
  db.prepare(`INSERT INTO service_faqs (service_id, question, answer, status) VALUES (?, 'Is this approved?', 'No, only the office decides.', 'published')`).run(ids.service)

  const citizen = db.prepare(`SELECT id FROM users WHERE email = 'p4assist-citizen@example.com'`).get()
  const other = db.prepare(`SELECT id FROM users WHERE email = 'p4assist-other@example.com'`).get()
  ids.citizen = Number(citizen.id)
  ids.other = Number(other.id)
  ids.document = Number(db.prepare(
    `INSERT INTO citizen_documents (user_id, category, original_filename, storage_reference, mime_type, file_size, status) VALUES (?, 'identity', 'id.pdf', 'private/uuid.pdf', 'application/pdf', 1234, 'active')`,
  ).run(ids.citizen).lastInsertRowid)
  ids.otherDocument = Number(db.prepare(
    `INSERT INTO citizen_documents (user_id, category, original_filename, storage_reference, mime_type, file_size, status) VALUES (?, 'identity', 'other.pdf', 'private/other.pdf', 'application/pdf', 1234, 'active')`,
  ).run(ids.other).lastInsertRowid)

  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Assist Admin', 'p4assist-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Admin', 'p4assist-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  db.close()

  cookie = await login('p4assist-citizen@example.com')
  otherCookie = await login('p4assist-other@example.com')
  adminCookie = await login('p4assist-admin@example.com')
  scopedCookie = await login('p4assist-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('requirements display clearly separates reviewed and unverified information', async () => {
  const overview = await (await request('/api/account/assistance')).json()
  const service = overview.services.find((row) => row.id === ids.service)
  assert.equal(service.requirement_count, 2)

  const detail = await (await request('/api/account/assistance/p4-assist-service')).json()
  assert.equal(detail.requirements.length, 2)
  const approved = detail.requirements.find((row) => row.id === ids.approvedRequirement)
  assert.equal(approved.reviewStatus, 'approved')
  assert.equal(approved.label, 'Reviewed BetterGo record')
  assert.equal(approved.sourceUrl, 'https://example.gov.ph/source')
  const unverified = detail.requirements.find((row) => row.id !== ids.approvedRequirement)
  assert.equal(unverified.label, 'Information needs verification')
  assert.equal(unverified.sourceUrl, null)
  assert.equal(detail.procedures[0].title, 'Submit at office')
  assert.equal(detail.faqs.length, 1)
  assert.match(detail.notice, /not an official application status/i)
})

test('a preparation checklist is created once, tracked and reset', async () => {
  const created = await request('/api/account/assistance/p4-assist-service/plan', { method: 'POST' })
  assert.equal(created.status, 201)
  const again = await request('/api/account/assistance/p4-assist-service/plan', { method: 'POST' })
  assert.equal(again.status, 200)

  let detail = await (await request('/api/account/assistance/p4-assist-service')).json()
  assert.equal(detail.plan.items.length, 2)
  assert.equal(detail.plan.progress.percent, 0)
  const first = detail.plan.items[0]

  const updated = await request(`/api/account/assistance/plans/${detail.plan.id}/items/${first.id}`, {
    method: 'PATCH',
    json: { status: 'ready', note: 'Private note', documentId: ids.document },
  })
  assert.equal(updated.status, 200)
  const body = await updated.json()
  assert.equal(body.progress.percent, 50)

  const foreignDocument = await request(`/api/account/assistance/plans/${detail.plan.id}/items/${first.id}`, {
    method: 'PATCH',
    json: { documentId: ids.otherDocument },
  })
  assert.equal(foreignDocument.status, 422)

  detail = await (await request('/api/account/assistance/p4-assist-service')).json()
  const citizenView = await (await request(`/api/account/assistance/plans/${detail.plan.id}`, {}, otherCookie))
  assert.equal(citizenView.status, 404, 'another citizen cannot see the plan')

  await request(`/api/account/assistance/plans/${detail.plan.id}`, { method: 'PATCH', json: { notes: 'My plan' } })
  await request(`/api/account/assistance/plans/${detail.plan.id}/reset`, { method: 'POST' })
  detail = await (await request('/api/account/assistance/p4-assist-service')).json()
  assert.equal(detail.plan.progress.percent, 0)
  assert.equal(detail.plan.notes, 'My plan')
  assert.equal(detail.plan.items[0].note, null)
})

test('reminders are validated, private and removable', async () => {
  const detail = await (await request('/api/account/assistance/p4-assist-service')).json()
  const bad = await request(`/api/account/assistance/plans/${detail.plan.id}/reminders`, { json: { remindAt: 'tomorrow' } })
  assert.equal(bad.status, 422)
  const created = await request(`/api/account/assistance/plans/${detail.plan.id}/reminders`, { json: { remindAt: '2027-01-15', message: 'Prepare' } })
  assert.equal(created.status, 201)
  const { id } = await created.json()

  const other = await request(`/api/account/assistance/plans/${detail.plan.id}/reminders`, { json: { remindAt: '2027-01-16' } }, otherCookie)
  assert.equal(other.status, 404)

  const removed = await request(`/api/account/assistance/plans/${detail.plan.id}/reminders/${id}`, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  const after = await (await request('/api/account/assistance/p4-assist-service')).json()
  assert.equal(after.reminders.length, 0)
})

test('requirements follow a review workflow and hide unapproved sources publicly', async () => {
  const draft = await request('/api/admin/service-requirements', {
    json: { serviceId: ids.otherService, name: 'New requirement', description: 'Draft text', sourceTitle: 'Ordinance 2026-01', sourceUrl: 'https://example.gov.ph/ord' },
  }, adminCookie)
  const draftBody = await draft.json()
  assert.equal(draft.status, 201, JSON.stringify(draftBody))
  const { id } = draftBody

  const premature = await request(`/api/admin/service-requirements/${id}/approve`, { method: 'POST', json: {} }, adminCookie)
  assert.equal(premature.status, 422)

  const publicView = await (await request('/api/account/assistance/p4-assist-second')).json()
  assert.equal(publicView.requirements[0].sourceUrl, null)

  await request(`/api/admin/service-requirements/${id}/submit-review`, { method: 'POST', json: {} }, adminCookie)
  const approved = await request(`/api/admin/service-requirements/${id}/approve`, { method: 'POST', json: {} }, adminCookie)
  assert.equal(approved.status, 200)

  const after = await (await request('/api/account/assistance/p4-assist-second')).json()
  assert.equal(after.requirements[0].reviewStatus, 'approved')
  assert.equal(after.requirements[0].sourceUrl, 'https://example.gov.ph/ord')

  const edit = await request(`/api/admin/service-requirements/${id}`, { method: 'PATCH', json: { name: 'Changed' } }, adminCookie)
  assert.equal(edit.status, 422)

  const archived = await request(`/api/admin/service-requirements/${id}/archive`, { method: 'POST', json: {} }, adminCookie)
  assert.equal(archived.status, 200)
  const hidden = await (await request('/api/account/assistance/p4-assist-second')).json()
  assert.equal(hidden.requirements.length, 0)
})

test('admin access is municipality-scoped and analytics stay aggregated', async () => {
  const denied = await request(`/api/admin/service-requirements?serviceId=${ids.service}`, {}, scopedCookie)
  assert.equal(denied.status, 404)

  const citizen = await request(`/api/admin/service-requirements?serviceId=${ids.service}`, {}, cookie)
  assert.equal([401, 403].includes(citizen.status), true)

  const listed = await (await request(`/api/admin/service-requirements?serviceId=${ids.service}`, {}, adminCookie)).json()
  assert.equal(listed.results.length, 3)

  const analytics = await (await request('/api/admin/assistance/analytics', {}, adminCookie)).json()
  assert.equal(analytics.totals.plans, 1)
  assert.equal(analytics.totals.approvedRequirements >= 1, true)
  assert.equal(JSON.stringify(analytics).includes('My plan'), false)
  assert.equal(JSON.stringify(analytics).includes('id.pdf'), false)
  assert.match(analytics.note, /never reported/i)
})

test('assistance endpoints require authentication', async () => {
  for (const pathname of ['/api/account/assistance', '/api/account/assistance/p4-assist-service']) {
    assert.equal((await request(pathname, {}, '')).status, 401)
  }
})
