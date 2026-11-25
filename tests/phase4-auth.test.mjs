/**
 * Prompt 59 + 60 + 63 tests: resend verification, optional mobile verification,
 * TOTP two-factor sign-in, private service collections and notification summary.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { generateTotp } from '../server/lib/totp.js'

const PORT = 4605
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4auth-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookieA = ''
let cookieB = ''
let serviceId = null

async function waitForServer(attempts = 80) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return
    } catch { /* not up */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('API did not become ready in time')
}

function request(pathname, options = {}, cookie = '') {
  const headers = { Accept: 'application/json', Origin: BASE, ...(options.headers || {}) }
  if (cookie) headers.Cookie = cookie
  if (options.body) headers['Content-Type'] = 'application/json'
  return fetch(`${BASE}${pathname}`, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined })
}

async function register(email, firstName) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: {
      firstName, lastName: 'Tester', email, password: PASSWORD, confirmPassword: PASSWORD,
      municipalityId: 1, language: 'fil', acceptTerms: true, acceptPrivacy: true,
    },
  })
  const text = await response.text()
  assert.equal(response.status, 201, text)
  return JSON.parse(text)
}

async function login(email, mfaCode) {
  const response = await request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD, ...(mfaCode ? { mfaCode } : {}) } })
  return { response, cookie: (response.headers.get('set-cookie') || '').split(';')[0] }
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      DATABASE_PATH: DB_PATH,
      API_PORT: String(PORT),
      SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac',
      DEV_EXPOSE_VERIFICATION_LINKS: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
  })
  await waitForServer()

  await register('p4auth-a@example.com', 'Alpha')
  await register('p4auth-b@example.com', 'Beta')
  cookieA = (await login('p4auth-a@example.com')).cookie
  cookieB = (await login('p4auth-b@example.com')).cookie

  // A published service for collection membership.
  const db = new DatabaseSync(DB_PATH)
  const category = db.prepare('SELECT id FROM service_categories LIMIT 1').get()
  const result = db.prepare(
    `INSERT INTO government_services (title, slug, description, category_id, publication_status, published_at, verification_status)
     VALUES ('Test barangay clearance', 'test-barangay-clearance', 'A test record.', ?, 'published', datetime('now'), 'pending')`,
  ).run(category.id)
  serviceId = Number(result.lastInsertRowid)
  db.close()
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('resend verification is generic and issues a development link for unverified accounts', async () => {
  const known = await (await request('/api/auth/resend-verification', { method: 'POST', body: { email: 'p4auth-a@example.com' } })).json()
  assert.match(known.message, /If that address/i)
  assert.ok(known.verificationUrl, 'development link expected when no provider is configured')

  const unknown = await (await request('/api/auth/resend-verification', { method: 'POST', body: { email: 'nobody@example.com' } })).json()
  assert.equal(unknown.verificationUrl, undefined, 'unknown addresses must not reveal or issue anything')
})

test('mobile verification normalises the number and enforces the code', async () => {
  const sent = await request('/api/auth/phone/send-code', { method: 'POST', body: { phone: '09171234567' } }, cookieA)
  const body = await sent.json()
  assert.equal(sent.status, 201, JSON.stringify(body))
  assert.equal(body.phone, '+639171234567')
  assert.equal(body.smsDelivery, 'not_configured')
  assert.ok(body.devCode)

  const wrong = await request('/api/auth/phone/verify', { method: 'POST', body: { code: '000000' } }, cookieA)
  assert.equal(wrong.status, 422)

  const ok = await request('/api/auth/phone/verify', { method: 'POST', body: { code: body.devCode } }, cookieA)
  assert.equal(ok.status, 200)

  const me = await (await request('/api/auth/me', {}, cookieA)).json()
  assert.ok(me.profile.phone_verified_at)
  assert.equal(me.profile.phone, '+639171234567')
})

test('two-factor authentication gates sign-in and accepts a valid code', async () => {
  const setup = await (await request('/api/auth/mfa/setup', { method: 'POST' }, cookieA)).json()
  assert.ok(setup.secret)

  const enable = await request('/api/auth/mfa/enable', { method: 'POST', body: { code: generateTotp(setup.secret) } }, cookieA)
  const enabled = await enable.json()
  assert.equal(enable.status, 200, JSON.stringify(enabled))
  assert.equal(enabled.backupCodes.length, 8)

  const withoutCode = await login('p4auth-a@example.com')
  assert.equal(withoutCode.response.status, 401)
  assert.equal((await withoutCode.response.json()).mfaRequired, true)

  const withCode = await login('p4auth-a@example.com', generateTotp(setup.secret))
  assert.equal(withCode.response.status, 200)
  cookieA = withCode.cookie

  const status = await (await request('/api/auth/mfa/status', {}, cookieA)).json()
  assert.equal(status.enabled, true)
  assert.equal(status.backupCodesRemaining, 8)
})

test('collections are private and owner-scoped', async () => {
  const created = await request('/api/account/collections', { method: 'POST', body: { name: 'Business permits' } }, cookieA)
  const collection = await created.json()
  assert.equal(created.status, 201)
  assert.equal(collection.message, 'Collection created.')

  const added = await request(`/api/account/collections/${collection.id}/items`, { method: 'POST', body: { serviceId } }, cookieA)
  assert.equal(added.status, 201)

  const mine = await (await request('/api/account/collections', {}, cookieA)).json()
  assert.equal(mine.results.length, 1)
  assert.equal(mine.results[0].items.length, 1)

  const theirs = await (await request('/api/account/collections', {}, cookieB)).json()
  assert.equal(theirs.results.length, 0)

  const foreign = await request(`/api/account/collections/${collection.id}/items`, { method: 'POST', body: { serviceId } }, cookieB)
  assert.equal(foreign.status, 404)
  const foreignDelete = await request(`/api/account/collections/${collection.id}`, { method: 'DELETE' }, cookieB)
  assert.equal(foreignDelete.status, 404)
})

test('notification summary reports honest delivery channels', async () => {
  const summary = await (await request('/api/account/notifications/summary', {}, cookieA)).json()
  assert.equal(summary.total, 0)
  assert.equal(summary.unread, 0)
  assert.match(summary.note, /providers/i)
  assert.ok('email_enabled' in summary.channels)
})
