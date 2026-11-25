/**
 * Prompt 62 — dashboard payload, widget customization and owner scoping.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = 4609
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4dash-'))
const PASSWORD = 'Marinduque#Test2026'

let child
let cookieA = ''
let cookieB = ''

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

async function createUser(email, firstName) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: { firstName, lastName: 'Dash', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  })
  assert.equal(response.status, 201, await response.text())
  const login = await request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  return (login.headers.get('set-cookie') || '').split(';')[0]
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
  cookieA = await createUser('p4dash-a@example.com', 'Alpha')
  cookieB = await createUser('p4dash-b@example.com', 'Beta')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('dashboard returns real widget data and honest empty states', async () => {
  const response = await request('/api/account/dashboard', {}, cookieA)
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  for (const key of ['quickServices', 'savedServices', 'recentActivity', 'applications', 'municipalAnnouncements', 'advisories', 'programs', 'recommended', 'recentlyViewed', 'notifications']) {
    assert.ok(Array.isArray(body[key]), `${key} should be an array`)
  }
  assert.deepEqual(body.programs, [], 'no programme records exist, so the widget must stay empty')
  assert.equal(body.programsPublished, false)
  assert.ok('personalizationOptIn' in body)
  assert.match(body.notice, /BetterGo container only/)
})

test('dashboard layout starts at sensible defaults', async () => {
  const body = await (await request('/api/account/dashboard/preferences', {}, cookieA)).json()
  assert.equal(body.customized, false)
  assert.deepEqual(body.order.slice(0, 3), ['stats', 'checklist', 'activity'])
  assert.ok(!body.available.includes('security'), 'security is not hideable')
  assert.deepEqual(body.alwaysVisible, ['security'])
})

test('layout visibility and order persist and reject unknown or protected widgets', async () => {
  const invalid = await request('/api/account/dashboard/preferences', {
    method: 'PUT', body: { order: ['stats', 'not-a-widget'] },
  }, cookieA)
  assert.equal(invalid.status, 422)

  const protectedWidget = await request('/api/account/dashboard/preferences', {
    method: 'PUT', body: { hidden: ['security'] },
  }, cookieA)
  assert.equal(protectedWidget.status, 422)

  const saved = await request('/api/account/dashboard/preferences', {
    method: 'PUT',
    body: { order: ['services', 'stats', 'checklist'], hidden: ['activity', 'programs'] },
  }, cookieA)
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()))

  const layout = await (await request('/api/account/dashboard/preferences', {}, cookieA)).json()
  assert.equal(layout.customized, true)
  assert.deepEqual(layout.order.slice(0, 3), ['services', 'stats', 'checklist'])
  assert.ok(layout.hidden.includes('activity'))
  assert.ok(layout.hidden.includes('programs'))
  assert.equal(layout.order.length, layout.available.length, 'every widget keeps a position')
})

test('layout preferences are per citizen', async () => {
  const theirs = await (await request('/api/account/dashboard/preferences', {}, cookieB)).json()
  assert.equal(theirs.customized, false)
  assert.deepEqual(theirs.hidden, [])
})

test('resetting the layout restores defaults', async () => {
  const reset = await request('/api/account/dashboard/preferences/reset', { method: 'POST' }, cookieA)
  assert.equal(reset.status, 200)
  const layout = await (await request('/api/account/dashboard/preferences', {}, cookieA)).json()
  assert.equal(layout.customized, false)
  assert.deepEqual(layout.hidden, [])
})

test('dashboard requires authentication', async () => {
  const response = await request('/api/account/dashboard', {})
  assert.equal(response.status, 401)
  const layout = await request('/api/account/dashboard/preferences', {})
  assert.equal(layout.status, 401)
})
