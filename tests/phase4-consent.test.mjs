/**
 * Prompt 80 — consent choices, data-sharing authorizations and typed-name
 * electronic signature records. Everything is a platform record only.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4645
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4consent-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
let signatureId = null

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
    json: { firstName, lastName: 'Consent', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
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
  await register('p4consent-citizen@example.com', 'Consent')
  await register('p4consent-other@example.com', 'Other')
  cookie = await login('p4consent-citizen@example.com')
  otherCookie = await login('p4consent-other@example.com')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Consent Admin', 'p4consent-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Consent Admin', 'p4consent-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  db.close()

  adminCookie = await login('p4consent-admin@example.com')
  scopedCookie = await login('p4consent-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('consent catalogue reflects recorded choices and protects required consents', async () => {
  const overview = await (await request('/api/account/consent')).json()
  assert.equal(overview.policyVersion, '2026-01')
  assert.ok(overview.catalog.find((entry) => entry.key === 'terms_of_use').required)

  const required = await request('/api/account/consent/terms_of_use', { json: { status: 'withdrawn' } })
  assert.equal(required.status, 403)

  const missing = await request('/api/account/consent/research', { json: { status: 'withdrawn' } })
  assert.equal(missing.status, 404)

  const granted = await request('/api/account/consent/research', { json: { status: 'granted' } })
  assert.equal(granted.status, 201, await granted.clone().text())
  const grantedView = await (await request('/api/account/consent')).json()
  assert.equal(grantedView.catalog.find((entry) => entry.key === 'research').status, 'granted')

  const withdrawn = await request('/api/account/consent/research', { json: { status: 'withdrawn' } })
  assert.equal(withdrawn.status, 200)
  const withdrawnView = await (await request('/api/account/consent')).json()
  assert.equal(withdrawnView.catalog.find((entry) => entry.key === 'research').status, 'withdrawn')
})

test('typed-name signatures require the account name and record an honest platform hash', async () => {
  const mismatch = await request('/api/account/consent/signatures', { json: { statement: 'data_accuracy', signerName: 'Someone Else', agree: true } })
  assert.equal(mismatch.status, 422)

  const noAgreement = await request('/api/account/consent/signatures', { json: { statement: 'data_accuracy', signerName: 'Consent Consent', agree: false } })
  assert.equal(noAgreement.status, 422)

  const created = await request('/api/account/consent/signatures', {
    json: { statement: 'data_accuracy', signerName: 'Consent Consent', agree: true, subjectReference: 'BG-DOC-1' },
  })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.match(body.signature.reference, /^BG-SIG-/)
  assert.equal(body.signature.contentHash.length, 64)
  assert.match(body.note || body.signatureNote || '', /not a government-issued/i)
  signatureId = body.signature.id

  const otherView = await (await request('/api/account/consent', {}, otherCookie)).json()
  assert.equal(otherView.signatures.length, 0, 'one citizen never sees another signature record')

  const foreignRevoke = await request(`/api/account/consent/signatures/${signatureId}/revoke`, { method: 'POST', json: {} }, otherCookie)
  assert.equal(foreignRevoke.status, 404)
})

test('authorizations name a recipient, cover selected records and can be revoked', async () => {
  const invalid = await request('/api/account/consent/authorizations', {
    json: { recipientName: 'Maria', recipientOrganization: 'Mogpog Health Office', purpose: 'To help me follow my request', categories: ['payments'] },
  })
  assert.equal(invalid.status, 422)

  const past = await request('/api/account/consent/authorizations', {
    json: { recipientName: 'Maria', recipientOrganization: 'Mogpog Health Office', purpose: 'To help me follow my request', categories: ['applications'], expiresAt: '2020-01-01' },
  })
  assert.equal(past.status, 422)

  const created = await request('/api/account/consent/authorizations', {
    json: {
      recipientName: 'Maria Santos',
      recipientOrganization: 'Mogpog Health Office',
      purpose: 'To help me follow my document request at the health office.',
      categories: ['document_requests', 'appointments'],
      signatureId,
    },
  })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.match(body.authorization.reference, /^BG-AUTH-/)
  assert.equal(body.authorization.status, 'active')
  assert.equal(body.authorization.categoryLabels.length, 2)
  assert.match(body.message, /does not transmit/i)

  const foreignRevoke = await request(`/api/account/consent/authorizations/${body.authorization.id}/revoke`, { method: 'POST', json: {} }, otherCookie)
  assert.equal(foreignRevoke.status, 404)

  const revoked = await request(`/api/account/consent/authorizations/${body.authorization.id}/revoke`, { method: 'POST', json: {} })
  assert.equal(revoked.status, 200)
  const view = await (await request('/api/account/consent')).json()
  assert.equal(view.authorizations[0].status, 'revoked')
})

test('offices acknowledge receipt within their municipality scope only', async () => {
  assert.equal((await request('/api/admin/consent', {}, '')).status, 401)

  const globalView = await (await request('/api/admin/consent', {}, adminCookie)).json()
  assert.ok(globalView.summary.recordedSignatures >= 1)
  assert.match(globalView.note, /not verify identity/i)

  const scopedView = await (await request('/api/admin/consent', {}, scopedCookie)).json()
  assert.equal(scopedView.signatures.length, 0, 'another municipality sees no signature records')

  const crossScope = await request(`/api/admin/consent/signatures/${signatureId}/acknowledge`, { json: { note: 'Received at counter' } }, scopedCookie)
  assert.equal(crossScope.status, 404)

  const acknowledged = await request(`/api/admin/consent/signatures/${signatureId}/acknowledge`, { json: { note: 'Received at the records counter' } }, adminCookie)
  assert.equal(acknowledged.status, 200)
  assert.match((await acknowledged.json()).message, /not identity verification/i)

  const duplicate = await request(`/api/admin/consent/signatures/${signatureId}/acknowledge`, { json: { note: 'Received again' } }, adminCookie)
  assert.equal(duplicate.status, 422)
})

test('withdrawing a signature closes it for future authorizations', async () => {
  const second = await request('/api/account/consent/signatures', {
    json: { statement: 'representative', signerName: 'Consent Consent', agree: true },
  })
  const secondBody = await second.json()
  const revoked = await request(`/api/account/consent/signatures/${secondBody.signature.id}/revoke`, { method: 'POST', json: {} })
  assert.equal(revoked.status, 200)

  const closed = await request('/api/account/consent/authorizations', {
    json: {
      recipientName: 'Jose Cruz',
      recipientOrganization: 'Boac Social Welfare Office',
      purpose: 'To help me follow my complaint case.',
      categories: ['complaints'],
      signatureId: secondBody.signature.id,
    },
  })
  assert.equal(closed.status, 422)
})
