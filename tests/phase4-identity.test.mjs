/**
 * Prompt 78 — verification status honesty, review requests and office decisions.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4641
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4identity-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
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
    json: { firstName, lastName: 'Identity', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
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
      SMS_PROVIDER_URL: '',
      SMS_PROVIDER_KEY: '',
    },
    stdio: 'ignore',
  })
  await waitForServer()
  await register('p4identity-citizen@example.com', 'Citizen')
  await register('p4identity-other@example.com', 'Other')
  cookie = await login('p4identity-citizen@example.com')
  otherCookie = await login('p4identity-other@example.com')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Identity Admin', 'p4identity-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Identity Admin', 'p4identity-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  db.close()

  adminCookie = await login('p4identity-admin@example.com')
  scopedCookie = await login('p4identity-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('the trust centre reports only actual verification state', async () => {
  const data = await (await request('/api/account/identity')).json()
  assert.equal(data.trust.email, data.account.emailVerified ? 'verified' : 'unverified')
  assert.equal(data.trust.phone, 'unavailable')
  assert.equal(data.smsAvailable, false)
  assert.equal(data.trust.resident, 'not_reviewed')
  assert.match(data.note, /never asks for them/i)
})

test('phone verification is refused when no SMS provider exists', async () => {
  const response = await request('/api/account/identity/requests', { json: { type: 'phone' } })
  assert.equal(response.status, 422)
  assert.match((await response.json()).error, /SMS provider/i)
})

test('resident review requests stay pending until an office review', async () => {
  const created = await request('/api/account/identity/requests', { json: { type: 'resident', municipalityId: 1, note: 'Resident since 2019' } })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.equal(body.verification.status, 'pending')
  assert.match(body.message, /stays pending/i)
  assert.match(body.noSensitiveDocuments, /Do not submit ID/i)
  requestId = body.verification.id

  const duplicate = await request('/api/account/identity/requests', { json: { type: 'resident' } })
  assert.equal(duplicate.status, 422)

  const data = await (await request('/api/account/identity')).json()
  assert.equal(data.trust.resident, 'not_reviewed', 'a pending request is not a verified status')

  assert.equal((await request(`/api/account/identity/requests/${requestId}/cancel`, { method: 'POST', json: {} }, otherCookie)).status, 404)
})

test('office decisions require a note and are municipality scoped', async () => {
  const queue = await (await request('/api/admin/identity-verifications?status=pending', {}, adminCookie)).json()
  assert.equal(queue.results.length, 1)
  assert.match(queue.note, /does not inspect/i)

  const noNote = await request(`/api/admin/identity-verifications/${requestId}/decision`, { method: 'POST', json: { decision: 'verified' } }, adminCookie)
  assert.equal(noNote.status, 422)

  const denied = await request(`/api/admin/identity-verifications/${requestId}/decision`, { method: 'POST', json: { decision: 'verified', note: 'Reviewed in person' } }, scopedCookie)
  assert.equal(denied.status, 404)

  const verified = await request(`/api/admin/identity-verifications/${requestId}/decision`, { method: 'POST', json: { decision: 'verified', note: 'Reviewed in person at the office' } }, adminCookie)
  assert.equal(verified.status, 200)
  assert.equal((await verified.json()).verification.status, 'verified')

  const data = await (await request('/api/account/identity')).json()
  assert.equal(data.trust.resident, 'reviewed_by_office')
  assert.equal(data.verifications[0].officeNote, 'Reviewed in person at the office')

  const scopedList = await (await request('/api/admin/identity-verifications', {}, scopedCookie)).json()
  assert.equal(scopedList.results.length, 0)
})

test('cancelled requests cannot be decided', async () => {
  const other = await request('/api/account/identity/requests', { json: { type: 'resident', municipalityId: 1 } }, otherCookie)
  const { verification } = await other.json()
  await request(`/api/account/identity/requests/${verification.id}/cancel`, { method: 'POST', json: {} }, otherCookie)
  const decision = await request(`/api/admin/identity-verifications/${verification.id}/decision`, { method: 'POST', json: { decision: 'verified', note: 'Test review' } }, adminCookie)
  assert.equal(decision.status, 422)
})

test('identity endpoints require authentication', async () => {
  assert.equal((await request('/api/account/identity', {}, '')).status, 401)
  assert.equal((await request('/api/admin/identity-verifications', {}, cookie)).status, 403)
})
