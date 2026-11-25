/**
 * Prompt 81 — consolidated preferences, default municipality and reset.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = 4667
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4prefs-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return
    } catch { /* not up */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('API did not become ready')
}

function request(pathname, options = {}) {
  const headers = { Accept: 'application/json', Origin: BASE }
  if (cookie) headers.Cookie = cookie
  if (options.json) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(options.json)
  }
  return fetch(`${BASE}${pathname}`, { method: options.method || (options.body ? 'POST' : 'GET'), headers, body: options.body })
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_PATH: DB_PATH, API_PORT: String(PORT), SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac', NODE_ENV: 'test' },
    stdio: 'ignore',
  })
  await waitForServer()
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { firstName: 'Pref', lastName: 'Centre', email: 'p4prefs@example.com', password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  })
  assert.equal(response.status, 201, await response.text())
  const login = await request('/api/auth/login', { method: 'POST', json: { email: 'p4prefs@example.com', password: PASSWORD } })
  assert.equal(login.status, 200)
  cookie = (login.headers.get('set-cookie') || '').split(';')[0]
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('preferences centre reports real options and defaults', async () => {
  const body = await (await request('/api/account/preferences')).json()
  assert.equal(body.settings.language, 'en')
  assert.equal(body.settings.textScale, 'default')
  assert.equal(body.defaults.simplifiedView, false)
  assert.ok(body.municipalities.length >= 5)
  assert.match(body.note, /never removes access/i)
})

test('preferences save, validate and apply', async () => {
  const saved = await request('/api/account/preferences', {
    method: 'PUT',
    json: {
      language: 'fil',
      display: 'dark',
      textScale: 'larger',
      simplifiedView: true,
      highContrast: true,
      reducedMotion: true,
      defaultMunicipalityId: 2,
      searchPersonalization: false,
    },
  })
  assert.equal(saved.status, 200, await saved.clone().text())
  const body = await saved.json()
  assert.equal(body.settings.language, 'fil')
  assert.equal(body.settings.display, 'dark')
  assert.equal(body.settings.textScale, 'larger')
  assert.equal(body.settings.simplifiedView, true)
  assert.equal(body.settings.defaultMunicipalityId, 2)
  assert.equal(body.settings.searchPersonalization, false)

  const invalid = await request('/api/account/preferences', { method: 'PUT', json: { defaultMunicipalityId: 9999 } })
  assert.equal(invalid.status, 404)
})

test('reset restores the standard interface and keeps declared needs', async () => {
  await request('/api/account/personalization/needs', { method: 'PUT', json: { assistanceNeeds: ['senior'] } })
  const reset = await request('/api/account/preferences/reset', { json: {} })
  assert.equal(reset.status, 200, await reset.clone().text())
  const body = await reset.json()
  assert.equal(body.settings.language, 'en')
  assert.equal(body.settings.textScale, 'default')
  assert.equal(body.settings.simplifiedView, false)
  assert.equal(body.settings.display, 'system')
  assert.equal(body.settings.searchPersonalization, true)
  assert.deepEqual(body.settings.assistanceNeeds, ['senior'])
  assert.match(body.message, /standard interface/i)
})
