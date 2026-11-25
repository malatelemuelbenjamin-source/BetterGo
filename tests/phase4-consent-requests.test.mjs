/**
 * Prompt 80 (full) — consent request builder, publication review, citizen
 * decisions, receipts, withdrawal and enforcement of required permissions.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4665
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4creq-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let helperCookie = ''
let adminCookie = ''
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
  assert.equal(response.status, 200, await response.text())
  return (response.headers.get('set-cookie') || '').split(';')[0]
}

const register = async (email, firstName) => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { firstName, lastName: 'Consent', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  }, '')
  assert.equal(response.status, 201, await response.text())
}

const draft = (overrides = {}) => ({
  title: 'Share contact details with a partner office',
  purpose: 'Allow the named office to contact you about a scheduled appointment.',
  requestingEntity: 'BetterGo Marinduque (platform)',
  informationInvolved: 'Name, email address and appointment reference.',
  intendedUse: 'Appointment reminders only.',
  dataRecipients: 'The office you selected when booking.',
  processingDuration: 'Until the appointment is completed plus 30 days.',
  expiresAt: '2027-06-30',
  requiredPermissions: ['share_contact_details'],
  optionalPermissions: ['share_appointment_history'],
  withdrawalInstructions: 'Withdraw any time from your consent centre.',
  privacyNoticeVersion: '0.9-draft',
  references: ['Privacy notice 0.9 draft'],
  ...overrides,
})

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_PATH: DB_PATH, API_PORT: String(PORT), SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac', NODE_ENV: 'test' },
    stdio: 'ignore',
  })
  await waitForServer()
  await register('p4creq-citizen@example.com', 'Con Sent')
  await register('p4creq-helper@example.com', 'Hel Per')
  cookie = await login('p4creq-citizen@example.com')
  helperCookie = await login('p4creq-helper@example.com')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Consent Admin', 'p4creq-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const role = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, role)
  db.close()
  adminCookie = await login('p4creq-admin@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('only reviewed requests are published and visible to citizens', async () => {
  const invalid = await request('/api/admin/consent-requests', { json: draft({ requiredPermissions: [] }) }, adminCookie)
  assert.equal(invalid.status, 201, 'a request without permissions can be drafted')

  const created = await request('/api/admin/consent-requests', { json: draft() }, adminCookie)
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.equal(body.request.status, 'draft')
  assert.deepEqual(body.request.requiredPermissions, ['share_contact_details'])
  requestId = body.request.id

  assert.equal((await request(`/api/account/consent-requests/${requestId}`)).status, 404, 'drafts are not visible')
  assert.equal((await request('/api/admin/consent-requests', { json: draft() })).status, 403, 'citizens cannot use the builder')

  assert.equal((await request(`/api/admin/consent-requests/${requestId}/transition`, { json: { action: 'publish' } }, adminCookie)).status, 422)
  assert.equal((await request(`/api/admin/consent-requests/${requestId}/transition`, { json: { action: 'submit' } }, adminCookie)).status, 200)
  assert.equal((await request(`/api/admin/consent-requests/${requestId}/transition`, { json: { action: 'publish' } }, adminCookie)).status, 422, 'publishing needs approval')
  assert.equal((await request(`/api/admin/consent-requests/${requestId}/transition`, { json: { action: 'approve' } }, adminCookie)).status, 200)
  const published = await request(`/api/admin/consent-requests/${requestId}/transition`, { json: { action: 'publish' } }, adminCookie)
  assert.equal(published.status, 200, await published.clone().text())

  const citizenView = await (await request('/api/account/consent-requests')).json()
  assert.equal(citizenView.pending.length, 1)
  assert.match(citizenView.note, /not official government receipts/i)
})

test('acceptance requires every required permission and records a receipt', async () => {
  const partial = await request(`/api/account/consent-requests/${requestId}/decide`, {
    json: { decision: 'accepted', permissions: ['share_appointment_history'], typedName: 'Con Sent Consent' },
  })
  assert.equal(partial.status, 422)

  const unknown = await request(`/api/account/consent-requests/${requestId}/decide`, {
    json: { decision: 'accepted', permissions: ['share_contact_details', 'everything'] },
  })
  assert.equal(unknown.status, 422)

  const accepted = await request(`/api/account/consent-requests/${requestId}/decide`, {
    json: { decision: 'accepted', permissions: ['share_contact_details', 'share_appointment_history'], typedName: 'Con Sent Consent' },
  })
  assert.equal(accepted.status, 201, await accepted.clone().text())
  const body = await accepted.json()
  assert.match(body.receipt, /^BG-CONSENT-/)
  assert.deepEqual(body.decision.grantedPermissions.sort(), ['share_appointment_history', 'share_contact_details'])
  assert.match(body.note, /platform record/i)

  const again = await request(`/api/account/consent-requests/${requestId}/decide`, { json: { decision: 'declined', permissions: [] } })
  assert.equal(again.status, 422, 'a recorded decision cannot be silently replaced')

  const receipt = await request(`/api/account/consent-requests/${requestId}/receipt`)
  assert.equal(receipt.status, 200)
  assert.match(receipt.headers.get('content-type') || '', /text\/plain/)
  const text = await receipt.text()
  assert.match(text, /platform consent receipt/i)
  assert.match(text, /not an official government document/i)
  assert.match(text, /share_contact_details/)
  assert.equal((await request(`/api/account/consent-requests/${requestId}/receipt`, {}, helperCookie)).status, 404)
})

test('withdrawal is recorded and allows a fresh decision later', async () => {
  const withdrawn = await request(`/api/account/consent-requests/${requestId}/withdraw`, { json: {} })
  assert.equal(withdrawn.status, 200)
  assert.match((await withdrawn.json()).message, /not automatically deleted/i)
  assert.equal((await request(`/api/account/consent-requests/${requestId}/withdraw`, { json: {} })).status, 422)

  const list = await (await request('/api/account/consent-requests')).json()
  assert.equal(list.pending.length, 1, 'a withdrawn acceptance is pending again')

  const redisposed = await request(`/api/account/consent-requests/${requestId}/decide`, { json: { decision: 'declined', permissions: [] } })
  assert.equal(redisposed.status, 201)
  assert.match((await redisposed.json()).message, /no permission was granted/i)
})

test('admin reporting counts real decisions only', async () => {
  const view = await (await request('/api/admin/consent-requests', {}, adminCookie)).json()
  assert.ok(view.summary.total >= 2)
  assert.equal(view.summary.withdrawn, 1)
  assert.equal(view.summary.declined, 1)
  assert.match(view.note, /not legal approval/i)
})

test('past expiry blocks publication', async () => {
  const created = await request('/api/admin/consent-requests', { json: draft({ expiresAt: '2020-01-01', requiredPermissions: ['share_contact_details'] }) }, adminCookie)
  const id = (await created.json()).request.id
  await request(`/api/admin/consent-requests/${id}/transition`, { json: { action: 'submit' } }, adminCookie)
  await request(`/api/admin/consent-requests/${id}/transition`, { json: { action: 'approve' } }, adminCookie)
  const publish = await request(`/api/admin/consent-requests/${id}/transition`, { json: { action: 'publish' } }, adminCookie)
  assert.equal(publish.status, 422)
  assert.match((await publish.json()).error, /future expiry/i)
})
