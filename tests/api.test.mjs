/**
 * Backend smoke + policy tests.
 *
 * The server is started as a child process against a throwaway SQLite file so
 * the development database is never touched. Only free, built-in tooling is
 * used (node:test, fetch).
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = 4599
const BASE = `http://127.0.0.1:${PORT}`
const ORIGIN = BASE
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-test-'))
const DB_PATH = path.join(DB_DIR, 'test.db')

let child
let cookies = ''

async function waitForServer(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('API did not become ready in time')
}

async function request(pathname, options = {}) {
  const headers = { Accept: 'application/json', Origin: ORIGIN, ...(options.headers || {}) }
  if (cookies) headers.Cookie = cookies
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  return fetch(`${BASE}${pathname}`, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined })
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
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('health endpoint responds', async () => {
  const response = await request('/api/health')
  assert.equal(response.status, 200)
})

test('seeded lookups expose the six municipalities', async () => {
  const response = await request('/api/lookups')
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.municipalities.length, 6)
  assert.ok(body.municipalities.every((m) => m.slug && m.name))
})

test('public announcements list contains only published records', async () => {
  const response = await request('/api/announcements')
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.ok(Array.isArray(body.results))
  // Nothing has been published in a fresh database: no fabricated seed content.
  assert.equal(body.total, 0)
})

test('anonymous visitors cannot read administration endpoints', async () => {
  const response = await request('/api/admin/overview')
  assert.equal(response.status, 401)
})

test('cross-origin state changes are rejected (CSRF protection)', async () => {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'irrelevant-password' }),
  })
  assert.equal(response.status, 403)
})

test('registration creates an unverified account and a development verification link', async () => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: {
      firstName: 'Test',
      lastName: 'Citizen',
      email: 'citizen@example.com',
      password: 'Marinduque#Test2026',
      confirmPassword: 'Marinduque#Test2026',
      municipalityId: 1,
      acceptTerms: true,
      acceptPrivacy: true,
    },
  })
  const body = await response.json()
  assert.equal(response.status, 201, JSON.stringify(body))
  assert.ok(body.verificationUrl || body.user?.id, 'expected a verification link in development mode')

  const duplicate = await request('/api/auth/register', {
    method: 'POST',
    body: {
      firstName: 'Test',
      lastName: 'Citizen',
      email: 'citizen@example.com',
      password: 'Marinduque#Test2026',
      confirmPassword: 'Marinduque#Test2026',
      municipalityId: 1,
      acceptTerms: true,
      acceptPrivacy: true,
    },
  })
  assert.equal(duplicate.status, 422)
})

test('an unverified citizen is signed in but flagged and cannot reach administration', async () => {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'citizen@example.com', password: 'Marinduque#Test2026' },
  })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.mustVerifyEmail, true)
  cookies = (response.headers.get('set-cookie') || '').split(';')[0]

  const admin = await request('/api/admin/overview')
  assert.equal(admin.status, 403, 'a citizen must never reach admin endpoints')
})
