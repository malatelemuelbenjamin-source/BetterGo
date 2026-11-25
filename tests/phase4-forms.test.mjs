/**
 * Prompt 64 — dynamic forms, publication workflow, drafts, validation and
 * BetterGo intake submission.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4613
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4forms-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let adminCookie = ''
let citizenCookie = ''
let otherCookie = ''
let serviceId = null
let formId = null

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return
    } catch { /* not up */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('API did not become ready')
}

function request(pathname, options = {}, cookie = '') {
  const headers = { Accept: 'application/json', Origin: BASE, ...(options.headers || {}) }
  if (cookie) headers.Cookie = cookie
  if (options.body) headers['Content-Type'] = 'application/json'
  return fetch(`${BASE}${pathname}`, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined })
}

const login = async (email, password = PASSWORD) => {
  const response = await request('/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(response.status, 200, `login failed for ${email}`)
  return (response.headers.get('set-cookie') || '').split(';')[0]
}

const register = async (email, firstName) => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: { firstName, lastName: 'Form', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  })
  assert.equal(response.status, 201, await response.text())
}

const fields = [
  { fieldKey: 'full_name', label: 'Full name', fieldType: 'short_text', required: true },
  { fieldKey: 'email', label: 'Email address', fieldType: 'email', required: true },
  { fieldKey: 'reason', label: 'Reason', fieldType: 'select', required: true, options: ['new', 'renewal'] },
  { fieldKey: 'business_name', label: 'Business name', fieldType: 'short_text', conditional: { fieldKey: 'reason', equals: 'renewal' } },
  { fieldKey: 'notes', label: 'Notes', fieldType: 'long_text', validation: { maxLength: 50 } },
  { fieldKey: 'accuracy', label: 'I confirm the information is accurate', fieldType: 'consent', required: true },
]

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

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const insertUser = db.prepare(
    `INSERT INTO users (name, email, password_hash, email_verified_at, account_status)
     VALUES (?, ?, ?, datetime('now'), 'active')`,
  )
  const adminId = Number(insertUser.run('Form Admin', 'p4forms-admin@example.com', hash).lastInsertRowid)
  const roleId = Number(db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(adminId, roleId)
  const category = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get()
  serviceId = Number(db.prepare(
    `INSERT INTO government_services (title, slug, description, category_id, publication_status, published_at)
     VALUES ('Form test service', 'p4-forms-service', 'A service used by tests.', ?, 'published', datetime('now'))`,
  ).run(category.id).lastInsertRowid)
  db.close()

  adminCookie = await login('p4forms-admin@example.com')
  await register('p4forms-citizen@example.com', 'Citizen')
  await register('p4forms-other@example.com', 'Other')
  citizenCookie = await login('p4forms-citizen@example.com')
  otherCookie = await login('p4forms-other@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('an administrator can create a draft form with validated fields', async () => {
  const invalid = await request('/api/admin/forms', {
    method: 'POST',
    body: { serviceId, title: 'Invalid form', fields: [{ fieldKey: 'a', label: 'A', fieldType: 'script' }] },
  }, adminCookie)
  assert.equal(invalid.status, 422)

  const response = await request('/api/admin/forms', {
    method: 'POST',
    body: {
      serviceId,
      title: 'Barangay clearance intake',
      description: 'Prepare a clearance request.',
      instructions: 'Complete every required field.',
      privacyNotice: 'We collect this information only to prepare your BetterGo intake record.',
      privacyNoticeVersion: 'v1',
      submissionClassification: 'bettergo_intake',
      fields,
    },
  }, adminCookie)
  const body = await response.json()
  assert.equal(response.status, 201, JSON.stringify(body))
  formId = body.id
})

test('draft forms are not public until they are approved and published', async () => {
  const hidden = await request(`/api/forms/${formId}`)
  assert.equal(hidden.status, 404)

  const review = await request(`/api/admin/forms/${formId}/submit-review`, { method: 'POST' }, adminCookie)
  assert.equal(review.status, 200)
  const approve = await request(`/api/admin/forms/${formId}/approve`, { method: 'POST' }, adminCookie)
  assert.equal(approve.status, 200)
  const publish = await request(`/api/admin/forms/${formId}/publish`, { method: 'POST' }, adminCookie)
  assert.equal(publish.status, 200, await publish.clone().text())

  const publicForm = await request(`/api/forms/p4-forms-service`)
  const body = await publicForm.json()
  assert.equal(publicForm.status, 200)
  assert.equal(body.form.title, 'Barangay clearance intake')
  assert.equal(body.form.fields.length, fields.length)
  assert.match(body.disclaimer, /not an official government filing/i)
})

test('drafts are private to the citizen who saved them', async () => {
  const save = await request(`/api/account/forms/${formId}/draft`, {
    method: 'PUT', body: { answers: { full_name: 'Draft Person', secret_field: 'ignored' } },
  }, citizenCookie)
  assert.equal(save.status, 200)

  const mine = await (await request(`/api/account/forms/${formId}/draft`, {}, citizenCookie)).json()
  assert.equal(mine.draft.answers.full_name, 'Draft Person')
  assert.equal(mine.draft.answers.secret_field, undefined, 'unknown keys are dropped')

  const theirs = await (await request(`/api/account/forms/${formId}/draft`, {}, otherCookie)).json()
  assert.equal(theirs.draft, null)
})

test('submission validates answers on the server and respects conditional fields', async () => {
  const missing = await request(`/api/account/forms/${formId}/submit`, {
    method: 'POST', body: { answers: { full_name: 'Citizen', reason: 'new', accuracy: true }, consent: true },
  }, citizenCookie)
  assert.equal(missing.status, 422)
  const missingBody = await missing.json()
  assert.ok(missingBody.details.some((detail) => detail.field === 'email'))

  const badEmail = await request(`/api/account/forms/${formId}/submit`, {
    method: 'POST', body: { answers: { full_name: 'Citizen', email: 'not-an-email', reason: 'new', accuracy: true }, consent: true },
  }, citizenCookie)
  assert.equal(badEmail.status, 422)

  const badOption = await request(`/api/account/forms/${formId}/submit`, {
    method: 'POST', body: { answers: { full_name: 'Citizen', email: 'c@example.com', reason: 'invented' }, consent: true },
  }, citizenCookie)
  assert.equal(badOption.status, 422)

  const noConsent = await request(`/api/account/forms/${formId}/submit`, {
    method: 'POST', body: { answers: { full_name: 'Citizen', email: 'c@example.com', reason: 'new', accuracy: true }, consent: false },
  }, citizenCookie)
  assert.equal(noConsent.status, 422)

  // `business_name` only applies to renewals, so a new application may omit it.
  const accepted = await request(`/api/account/forms/${formId}/submit`, {
    method: 'POST',
    body: { answers: { full_name: 'Citizen', email: 'c@example.com', reason: 'new', accuracy: true }, consent: true },
  }, citizenCookie)
  assert.equal(accepted.status, 201, await accepted.clone().text())
  const body = await accepted.json()
  assert.match(body.reference, /^BG-/)
  assert.equal(body.status, 'submitted')
  assert.match(body.disclaimer, /No government office has received/i)

  const draft = await (await request(`/api/account/forms/${formId}/draft`, {}, citizenCookie)).json()
  assert.equal(draft.draft, null, 'a successful submission clears the draft')

  const duplicate = await request(`/api/account/forms/${formId}/submit`, {
    method: 'POST', body: { answers: { full_name: 'Citizen', email: 'c@example.com', reason: 'new', accuracy: true }, consent: true },
  }, citizenCookie)
  // Prompt 65 replaced the hard block with a warn-and-confirm duplicate check.
  const duplicateBody = await duplicate.json()
  assert.equal(duplicate.status, 409)
  assert.equal(duplicateBody.code, 'possible_duplicate')
  assert.equal(duplicateBody.canOverride, true)
})

test('submissions appear in the citizen tracker and nowhere else', async () => {
  const list = await (await request('/api/account/applications', {}, citizenCookie)).json()
  assert.equal(list.results.length, 1)
  const reference = list.results[0].reference
  assert.match(reference, /^BG-/)

  const detail = await (await request(`/api/account/applications/${reference}`, {}, citizenCookie)).json()
  assert.equal(detail.application.submissionClassification, 'bettergo_intake')
  assert.match(detail.application.classificationLabel, /not an official government filing/i)
  assert.match(detail.application.classificationNote, /No government office has received/i)

  const foreign = await request(`/api/account/applications/${reference}`, {}, otherCookie)
  assert.equal(foreign.status, 404)
})

test('archiving a form removes it from public view but keeps records', async () => {
  const archive = await request(`/api/admin/forms/${formId}/archive`, { method: 'POST' }, adminCookie)
  assert.equal(archive.status, 200)
  const publicForm = await request(`/api/forms/p4-forms-service`)
  assert.equal(publicForm.status, 404)
  const list = await (await request('/api/account/applications', {}, citizenCookie)).json()
  assert.equal(list.results.length, 1)
})

test('citizens cannot use the administrative form endpoints', async () => {
  const create = await request('/api/admin/forms', { method: 'POST', body: { serviceId, title: 'Hijack form', fields } }, citizenCookie)
  assert.equal(create.status, 403)
  const approve = await request(`/api/admin/forms/${formId}/approve`, { method: 'POST' }, citizenCookie)
  assert.equal(approve.status, 403)
})
