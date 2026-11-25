/**
 * Prompt 65 — BetterGo application submission, tracking, review workflow,
 * withdrawal, resubmission and municipality-scoped administration.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4615
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4apps-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let adminCookie = ''
let scopedCookie = ''
let citizenCookie = ''
let otherCookie = ''
let formId = null
let serviceId = null
let reference = null
let applicationId = null
let scopedAdminId = null

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

const login = async (email) => {
  const response = await request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  assert.equal(response.status, 200, `login failed for ${email}`)
  return (response.headers.get('set-cookie') || '').split(';')[0]
}

const register = async (email, firstName) => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: { firstName, lastName: 'Track', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  })
  assert.equal(response.status, 201, await response.text())
}

const fields = [
  { fieldKey: 'full_name', label: 'Full name', fieldType: 'short_text', required: true },
  { fieldKey: 'purpose', label: 'Purpose', fieldType: 'long_text', required: true },
  { fieldKey: 'accuracy', label: 'I confirm this is accurate', fieldType: 'consent', required: true },
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
  const adminId = Number(insertUser.run('Track Admin', 'p4apps-admin@example.com', hash).lastInsertRowid)
  const roleId = Number(db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(adminId, roleId)

  // A municipality-scoped reviewer for a municipality the citizen does not use.
  const otherMunicipality = Number(db.prepare(`SELECT id FROM municipalities WHERE id <> 1 ORDER BY id LIMIT 1`).get().id)
  scopedAdminId = Number(insertUser.run('Scoped Reviewer', 'p4apps-scoped@example.com', hash).lastInsertRowid)
  const municipalRoleId = Number(db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', ?, 'active')`).run(
    scopedAdminId,
    municipalRoleId,
    otherMunicipality,
  )

  const category = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get()
  serviceId = Number(db.prepare(
    `INSERT INTO government_services (title, slug, description, category_id, publication_status, published_at)
     VALUES ('Tracking test service', 'p4-apps-service', 'A service used by tracking tests.', ?, 'published', datetime('now'))`,
  ).run(category.id).lastInsertRowid)
  db.close()

  adminCookie = await login('p4apps-admin@example.com')
  scopedCookie = await login('p4apps-scoped@example.com')
  await register('p4apps-citizen@example.com', 'Citizen')
  await register('p4apps-other@example.com', 'Other')
  citizenCookie = await login('p4apps-citizen@example.com')
  otherCookie = await login('p4apps-other@example.com')

  const form = await request('/api/admin/forms', {
    method: 'POST',
    body: {
      serviceId,
      title: 'Tracking intake',
      description: 'Prepare a BetterGo record.',
      privacyNotice: 'We store this only for your BetterGo record.',
      privacyNoticeVersion: 'v1',
      submissionClassification: 'bettergo_intake',
      fields,
    },
  }, adminCookie)
  formId = (await form.json()).id
  for (const step of ['submit-review', 'approve', 'publish']) {
    const response = await request(`/api/admin/forms/${formId}/${step}`, { method: 'POST' }, adminCookie)
    assert.equal(response.status, 200, `${step} failed`)
  }
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('a citizen submission creates a trackable BetterGo reference', async () => {
  const response = await request(`/api/account/forms/${formId}/submit`, {
    method: 'POST',
    body: { answers: { full_name: 'Citizen Track', purpose: 'Records test', accuracy: true }, consent: true },
  }, citizenCookie)
  const body = await response.json()
  assert.equal(response.status, 201, JSON.stringify(body))
  reference = body.reference
  assert.match(reference, /^BG-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/)

  const list = await (await request('/api/account/applications', {}, citizenCookie)).json()
  assert.equal(list.total, 1)
  assert.equal(list.counts.submitted, 1)
  applicationId = null
})

test('repeated clicks cannot create duplicate submissions', async () => {
  const again = await request(`/api/account/forms/${formId}/submit`, {
    method: 'POST',
    body: { answers: { full_name: 'Citizen Track', purpose: 'Records test', accuracy: true }, consent: true },
  }, citizenCookie)
  assert.equal(again.status, 409)
})

test('another citizen cannot read or act on the record', async () => {
  const detail = await request(`/api/account/applications/${reference}`, {}, otherCookie)
  assert.equal(detail.status, 404)
  const withdraw = await request(`/api/account/applications/${reference}/withdraw`, { method: 'POST', body: {} }, otherCookie)
  assert.equal(withdraw.status, 404)
  const list = await (await request('/api/account/applications', {}, otherCookie)).json()
  assert.equal(list.total, 0)
})

test('detail exposes answers, timeline and BetterGo classification only', async () => {
  const response = await request(`/api/account/applications/${reference}`, {}, citizenCookie)
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.application.classificationLabel.includes('not an official government filing'), true)
  assert.equal(body.answers.full_name, 'Citizen Track')
  assert.equal(body.history.length >= 1, true)
  assert.equal(body.history[0].label, 'Submitted to BetterGo')
  assert.equal(body.actions.canWithdraw, true)
  assert.match(body.disclaimer, /platform states/i)
})

test('municipality-scoped reviewers cannot see or change foreign submissions', async () => {
  const list = await (await request('/api/admin/applications', {}, scopedCookie)).json()
  assert.equal(list.total, 0)

  const adminList = await (await request('/api/admin/applications?q=' + encodeURIComponent(reference), {}, adminCookie)).json()
  assert.equal(adminList.total, 1)
  applicationId = adminList.results[0].id

  const peek = await request(`/api/admin/applications/${applicationId}`, {}, scopedCookie)
  assert.equal(peek.status, 404)
  const change = await request(`/api/admin/applications/${applicationId}/status`, { method: 'POST', body: { status: 'in_review' } }, scopedCookie)
  assert.equal(change.status, 404)
})

test('review workflow requests information and the citizen resubmits', async () => {
  const assign = await request(`/api/admin/applications/${applicationId}/assign`, { method: 'POST', body: { reviewerId: scopedAdminId } }, adminCookie)
  assert.equal(assign.status, 200)

  const review = await request(`/api/admin/applications/${applicationId}/status`, {
    method: 'POST', body: { status: 'in_review', note: 'Checking the details you provided.' },
  }, adminCookie)
  assert.equal(review.status, 200)

  const requestInfo = await request(`/api/admin/applications/${applicationId}/request-info`, {
    method: 'POST', body: { message: 'Please describe the purpose in more detail.' },
  }, adminCookie)
  assert.equal(requestInfo.status, 200)

  const mine = await (await request(`/api/account/applications/${reference}`, {}, citizenCookie)).json()
  assert.equal(mine.application.status, 'awaiting_citizen')
  assert.equal(mine.actions.canResubmit, true)

  const resubmit = await request(`/api/account/applications/${reference}/resubmit`, {
    method: 'POST', body: { answers: { purpose: 'A longer, clearer purpose statement.' }, note: 'Added detail.' },
  }, citizenCookie)
  assert.equal(resubmit.status, 200)

  const after = await (await request(`/api/account/applications/${reference}`, {}, citizenCookie)).json()
  assert.equal(after.application.status, 'resubmitted')
  assert.equal(after.answers.purpose, 'A longer, clearer purpose statement.')
  assert.equal(after.answers.full_name, 'Citizen Track', 'previous answers are preserved')
  assert.equal(after.actions.canResubmit, false)
})

test('closure explains itself and appears in the citizen timeline', async () => {
  const missingNote = await request(`/api/admin/applications/${applicationId}/status`, { method: 'POST', body: { status: 'closed' } }, adminCookie)
  assert.equal(missingNote.status, 422)

  const close = await request(`/api/admin/applications/${applicationId}/status`, {
    method: 'POST', body: { status: 'closed', note: 'Your BetterGo record has been closed after review.' },
  }, adminCookie)
  assert.equal(close.status, 200)

  const detail = await (await request(`/api/account/applications/${reference}`, {}, citizenCookie)).json()
  assert.equal(detail.application.status, 'closed')
  assert.equal(detail.history.at(-1).note.includes('closed after review'), true)
  assert.equal(detail.actions.canWithdraw, false)
})

test('a closed record cannot be withdrawn again', async () => {
  const withdraw = await request(`/api/account/applications/${reference}/withdraw`, { method: 'POST', body: { reason: 'Not needed' } }, citizenCookie)
  assert.equal(withdraw.status, 422)
})

test('withdrawal keeps the record for audit and explains the limits', async () => {
  const submit = await request(`/api/account/forms/${formId}/submit`, {
    method: 'POST',
    body: { answers: { full_name: 'Citizen Track', purpose: 'Second record', accuracy: true }, consent: true, allowDuplicate: true },
  }, citizenCookie)
  assert.equal(submit.status, 201, await submit.clone().text())
  const second = (await submit.json()).reference

  const withdraw = await request(`/api/account/applications/${second}/withdraw`, {
    method: 'POST', body: { reason: 'I no longer need this record' },
  }, citizenCookie)
  const body = await withdraw.json()
  assert.equal(withdraw.status, 200)
  assert.match(body.message, /kept for audit/i)

  const detail = await (await request(`/api/account/applications/${second}`, {}, citizenCookie)).json()
  assert.equal(detail.application.status, 'withdrawn')
  assert.equal(detail.history.at(-1).to_status, 'withdrawn')
})

test('list filters, counts and analytics use real records only', async () => {
  const filtered = await request('/api/account/applications?status=closed', {}, citizenCookie)
  const body = await filtered.json()
  assert.equal(body.total, 1)
  assert.equal(body.results[0].status, 'closed')

  const searched = await (await request('/api/account/applications?q=' + encodeURIComponent(reference), {}, citizenCookie)).json()
  assert.equal(searched.total, 1)

  const analytics = await (await request('/api/admin/applications/analytics', {}, adminCookie)).json()
  assert.equal(analytics.total, 2)
  assert.equal(analytics.byStatus.some((row) => row.status === 'closed'), true)
  assert.equal(analytics.averageReviewDays === null || analytics.averageReviewDays >= 0, true)
  assert.match(analytics.disclaimer, /not official government performance/i)

  const scopedAnalytics = await (await request('/api/admin/applications/analytics', {}, scopedCookie)).json()
  assert.equal(scopedAnalytics.total, 0)
})

test('citizen notifications are private and never leak to other citizens', async () => {
  const mine = await (await request('/api/account/notifications', {}, citizenCookie)).json()
  const titles = (mine.results || mine.notifications || []).map((row) => row.title)
  assert.equal(titles.some((title) => /withdrawn|closed|updated|information/i.test(title)), true)
  const theirs = await (await request('/api/account/notifications', {}, otherCookie)).json()
  assert.equal((theirs.results || theirs.notifications || []).length, 0)
})

test('no endpoint claims a government referral or external transmission', async () => {
  const detail = await (await request(`/api/admin/applications/${applicationId}`, {}, adminCookie)).json()
  assert.equal(detail.application.externalReference, null)
  assert.match(detail.disclaimer, /no government office has received/i)
  assert.equal(Object.values(detail.application).includes('referred'), false)
})
