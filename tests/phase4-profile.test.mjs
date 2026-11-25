/**
 * Prompt 61 — profile completion, personalization preferences, change history
 * and safe contact-detail changes.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = 4607
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4profile-'))
const PASSWORD = 'Marinduque#Test2026'

let child
let cookieA = ''
let cookieB = ''

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return
    } catch { /* not up yet */ }
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

async function register(email, firstName) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: {
      firstName, lastName: 'Profile', email, password: PASSWORD, confirmPassword: PASSWORD,
      municipalityId: 1, acceptTerms: true, acceptPrivacy: true,
    },
  })
  const text = await response.text()
  assert.equal(response.status, 201, text)
}

async function login(email) {
  const response = await request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  assert.equal(response.status, 200, await response.clone().text())
  return (response.headers.get('set-cookie') || '').split(';')[0]
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      DATABASE_PATH: path.join(DB_DIR, 'test.db'),
      API_PORT: String(PORT),
      SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac',
      DEV_EXPOSE_VERIFICATION_LINKS: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
  })
  await waitForServer()
  await register('p4profile-a@example.com', 'Alpha')
  await register('p4profile-b@example.com', 'Beta')
  cookieA = await login('p4profile-a@example.com')
  cookieB = await login('p4profile-b@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

const baseProfile = {
  firstName: 'Alpha', lastName: 'Profile', middleName: '', suffix: '',
  municipalityId: 1, address: '', language: 'en',
}

test('display name and municipality are saved and reflected in the profile', async () => {
  const response = await request('/api/account/profile', {
    method: 'PATCH', body: { ...baseProfile, displayName: 'Aling Alpha', language: 'fil' },
  }, cookieA)
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.profile.display_name, 'Aling Alpha')
  assert.equal(body.profile.preferred_language, 'fil')
  assert.ok(body.completion.percent >= 60)

  const me = await (await request('/api/account/profile', {}, cookieA)).json()
  assert.equal(me.profile.display_name, 'Aling Alpha')
  assert.ok(Array.isArray(me.availableInterests) && me.availableInterests.includes('advisories'))
})

test('profile change history records categories, never old values', async () => {
  const history = await (await request('/api/account/profile/history', {}, cookieA)).json()
  assert.ok(history.results.length >= 1)
  const latest = history.results[0]
  assert.equal(latest.field_category, 'personal_information')
  assert.match(latest.changed_fields, /display name/)
  assert.match(latest.changed_fields, /municipality|language/)
  assert.ok(!JSON.stringify(history).includes('Aling Alpha'), 'old display values must not be retained')
})

test('changing the mobile number resets its verification state', async () => {
  const sent = await (await request('/api/auth/phone/send-code', { method: 'POST', body: { phone: '09170000001' } }, cookieA)).json()
  await request('/api/auth/phone/verify', { method: 'POST', body: { code: sent.devCode } }, cookieA)
  let me = await (await request('/api/auth/me', {}, cookieA)).json()
  assert.ok(me.profile.phone_verified_at)

  const changed = await request('/api/account/profile', { method: 'PATCH', body: { ...baseProfile, phone: '09170000002' } }, cookieA)
  assert.equal(changed.status, 200)
  me = await (await request('/api/auth/me', {}, cookieA)).json()
  assert.equal(me.profile.phone, '09170000002')
  assert.equal(me.profile.phone_verified_at, null, 'a replacement number must not inherit verification')
})

test('personalization interests are optional, validated and owner-scoped', async () => {
  const saved = await request('/api/account/preferences/personalization', {
    method: 'PUT', body: { personalizationOptIn: true, interests: ['advisories', 'programs'] },
  }, cookieA)
  assert.equal(saved.status, 200)

  const mine = await (await request('/api/account/preferences/personalization', {}, cookieA)).json()
  assert.deepEqual(mine.interests.sort(), ['advisories', 'programs'])
  assert.equal(mine.personalizationOptIn, true)

  const theirs = await (await request('/api/account/preferences/personalization', {}, cookieB)).json()
  assert.deepEqual(theirs.interests, [])

  const invalid = await request('/api/account/preferences/personalization', { method: 'PUT', body: { interests: ['not-a-real-topic'] } }, cookieA)
  assert.equal(invalid.status, 422)

  const cleared = await request('/api/account/preferences/personalization', {
    method: 'PUT', body: { personalizationOptIn: false, interests: [] },
  }, cookieA)
  assert.equal(cleared.status, 200)
  const after = await (await request('/api/account/preferences/personalization', {}, cookieA)).json()
  assert.deepEqual(after.interests, [])
  assert.equal(after.personalizationOptIn, false)
})

test('another citizen cannot read or modify this profile', async () => {
  const history = await (await request('/api/account/profile/history', {}, cookieB)).json()
  assert.deepEqual(history.results, [])

  const foreign = await request('/api/account/profile', { method: 'PATCH', body: { ...baseProfile, displayName: 'Hijack' } }, cookieB)
  assert.equal(foreign.status, 200, 'the endpoint only ever writes the caller profile')
  const mine = await (await request('/api/account/profile', {}, cookieA)).json()
  assert.equal(mine.profile.display_name, 'Aling Alpha')
  // Cookie B's own update only changes cookie B's profile.
  const theirs = await (await request('/api/account/profile', {}, cookieB)).json()
  assert.equal(theirs.profile.display_name, 'Hijack')
})
