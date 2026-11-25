/**
 * Phase 4 foundation tests (Prompt 58).
 *
 * Covers the citizen account architecture, activity history, application
 * tracking foundation and private document metadata, including cross-account
 * access prevention. Runs against a throwaway database.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { capabilityFor } from '../server/lib/citizen.js'

const PORT = 4603
const BASE = `http://127.0.0.1:${PORT}`
const ORIGIN = BASE
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4-'))
const DB_PATH = path.join(DB_DIR, 'test.db')

let child
let cookieA = ''
let cookieB = ''

async function waitForServer(attempts = 80) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('API did not become ready in time')
}

function request(pathname, options = {}, cookie = '') {
  const headers = { Accept: 'application/json', Origin: ORIGIN, ...(options.headers || {}) }
  if (cookie) headers.Cookie = cookie
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  return fetch(`${BASE}${pathname}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
}

async function register(email, firstName) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: {
      firstName,
      lastName: 'Tester',
      email,
      password: 'Marinduque#Test2026',
      confirmPassword: 'Marinduque#Test2026',
      municipalityId: 1,
      acceptTerms: true,
      acceptPrivacy: true,
    },
  })
  assert.equal(response.status, 201, await response.text())
  const login = await request('/api/auth/login', { method: 'POST', body: { email, password: 'Marinduque#Test2026' } })
  assert.equal(login.status, 200)
  return (login.headers.get('set-cookie') || '').split(';')[0]
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
  cookieA = await register('phase4-a@example.com', 'Alpha')
  cookieB = await register('phase4-b@example.com', 'Beta')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('citizen dashboard requires authentication', async () => {
  const response = await request('/api/account/dashboard')
  assert.equal(response.status, 401)
})

test('citizen dashboard returns the Phase 4 foundation without fabricated data', async () => {
  const response = await request('/api/account/dashboard', {}, cookieA)
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  for (const key of ['quickServices', 'savedServices', 'recentActivity', 'applications', 'municipalAnnouncements', 'recentlyViewed', 'notifications', 'security']) {
    assert.ok(key in body, `expected ${key}`)
  }
  assert.equal(body.counts.applications, 0)
  assert.equal(body.counts.documents, 0)
  assert.match(body.notice, /not government|no government/i)
})

test('activity is recorded for the owner, deduplicated and type-checked', async () => {
  const payload = { type: 'service_viewed', entityType: 'service', entityId: 1, label: 'Barangay clearance', slug: 'barangay-clearance' }
  const first = await request('/api/account/activity', { method: 'POST', body: payload }, cookieA)
  assert.equal(first.status, 201)

  const duplicate = await request('/api/account/activity', { method: 'POST', body: payload }, cookieA)
  const duplicateBody = await duplicate.json()
  assert.equal(duplicateBody.recorded, false, 'repeated views within 30 minutes are not stored again')

  const invalid = await request('/api/account/activity', { method: 'POST', body: { type: 'keystroke_log', entityType: 'service' } }, cookieA)
  assert.equal(invalid.status, 422)
})

test('activity history is private to its owner', async () => {
  const mine = await (await request('/api/account/activity', {}, cookieA)).json()
  assert.ok(mine.results.some((row) => row.source === 'activity' && row.action === 'service_viewed'))

  const theirs = await (await request('/api/account/activity', {}, cookieB)).json()
  assert.equal(theirs.results.filter((row) => row.source === 'activity').length, 0)
})

test('application records are scoped to the signed-in citizen', async () => {
  const db = new DatabaseSync(DB_PATH)
  const userA = db.prepare('SELECT id FROM users WHERE email = ?').get('phase4-a@example.com')
  const userB = db.prepare('SELECT id FROM users WHERE email = ?').get('phase4-b@example.com')
  db.prepare(
    `INSERT INTO citizen_applications (reference, user_id, municipality_id, status, submitted_at)
     VALUES (?, ?, 1, 'submitted', datetime('now'))`,
  ).run('BGAPP-TEST-A', userA.id)
  db.prepare(`INSERT INTO citizen_applications (reference, user_id, municipality_id, status) VALUES (?, ?, 1, 'draft')`).run(
    'BGAPP-TEST-B',
    userB.id,
  )
  db.close()

  const listA = await (await request('/api/account/applications', {}, cookieA)).json()
  assert.equal(listA.results.length, 1)
  assert.equal(listA.results[0].reference, 'BGAPP-TEST-A')
  assert.match(listA.disclaimer, /not a government decision/i)

  const own = await request('/api/account/applications/BGAPP-TEST-A', {}, cookieA)
  assert.equal(own.status, 200)

  const foreign = await request('/api/account/applications/BGAPP-TEST-B', {}, cookieA)
  assert.equal(foreign.status, 404, 'another citizen application must not be readable')
})

test('document metadata is owner-scoped and never exposes storage references', async () => {
  const db = new DatabaseSync(DB_PATH)
  const userA = db.prepare('SELECT id FROM users WHERE email = ?').get('phase4-a@example.com')
  db.prepare(
    `INSERT INTO citizen_documents (user_id, category, original_filename, storage_reference, mime_type, file_size)
     VALUES (?, 'identification', 'sample.pdf', 'private/vault/sample.pdf', 'application/pdf', 1024)`,
  ).run(userA.id)
  db.close()

  const mine = await (await request('/api/account/documents', {}, cookieA)).json()
  assert.equal(mine.results.length, 1)
  assert.equal('storage_reference' in mine.results[0], false)
  assert.equal(mine.results[0].metadataSource, 'citizen_provided')

  const theirs = await (await request('/api/account/documents', {}, cookieB)).json()
  assert.equal(theirs.results.length, 0)
})

test('capability labels reflect real functionality only', () => {
  assert.equal(capabilityFor({ availability_status: 'temporarily_unavailable' }), 'temporarily_unavailable')
  assert.equal(capabilityFor({ availability_status: 'available', is_online: 1, official_link: 'https://example.gov.ph' }), 'external_website')
  assert.equal(capabilityFor({ availability_status: 'available' }, { hasDownloadableForm: true }), 'downloadable_form')
  assert.equal(capabilityFor({ availability_status: 'in_person_required' }), 'in_person_required')
  assert.equal(capabilityFor({ availability_status: 'available' }), 'information_only')
  // A recorded government integration is respected, but is never inferred.
  assert.equal(
    capabilityFor({ availability_status: 'available', digital_capability: 'government_integration' }),
    'government_integration',
  )
})
