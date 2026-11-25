/**
 * Prompt 81 — accessibility preferences, self-declared assistance needs and
 * inclusive-service information scoped to published office records.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4647
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4personal-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let adminCookie = ''
let scopedCookie = ''
let serviceId = null

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
  const registered = await request('/api/auth/register', {
    method: 'POST',
    json: { firstName: 'Access', lastName: 'Tester', email: 'p4personal-citizen@example.com', password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  }, '')
  assert.equal(registered.status, 201, await registered.text())
  cookie = await login('p4personal-citizen@example.com')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Access Admin', 'p4personal-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Access Admin', 'p4personal-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  const category = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get()
  serviceId = Number(db.prepare(
    `INSERT INTO government_services (title, slug, category_id, municipality_id, publication_status, verification_status)
     VALUES ('Inclusive health check', 'p4-inclusive-health-check', ?, 1, 'published', 'verified')`,
  ).run(category.id).lastInsertRowid)
  db.prepare(
    `INSERT INTO government_services (title, slug, category_id, municipality_id, publication_status)
     VALUES ('Draft accessible service', 'p4-draft-accessible-service', ?, 1, 'draft')`,
  ).run(category.id)
  db.close()

  adminCookie = await login('p4personal-admin@example.com')
  scopedCookie = await login('p4personal-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('accessibility preferences validate and persist', async () => {
  const initial = await (await request('/api/account/personalization')).json()
  assert.equal(initial.settings.textScale, 'default')
  assert.equal(initial.settings.highContrast, false)
  assert.deepEqual(initial.settings.assistanceNeeds, [])
  assert.match(initial.note, /self-declared/i)

  const invalid = await request('/api/account/personalization', { method: 'PUT', json: { textScale: 'gigantic' } })
  assert.equal(invalid.status, 422)

  const saved = await request('/api/account/personalization', {
    method: 'PUT',
    json: { textScale: 'larger', highContrast: true, reducedMotion: true, screenReaderHints: false, personalizationOptIn: false, language: 'fil' },
  })
  assert.equal(saved.status, 200, await saved.clone().text())
  const savedBody = await saved.json()
  assert.equal(savedBody.settings.textScale, 'larger')
  assert.equal(savedBody.settings.highContrast, true)
  assert.equal(savedBody.settings.screenReaderHints, false)
  assert.equal(savedBody.settings.personalizationOptIn, false)

  const off = await (await request('/api/account/personalization')).json()
  assert.equal(off.services.length, 0, 'personalization off hides suggestions')
  assert.match(off.personalizedNote, /off/i)
})

test('declared assistance needs are optional, validated and never framed as eligibility', async () => {
  const invalid = await request('/api/account/personalization/needs', { method: 'PUT', json: { assistanceNeeds: ['vip'] } })
  assert.equal(invalid.status, 422)

  const saved = await request('/api/account/personalization/needs', { method: 'PUT', json: { assistanceNeeds: ['senior', 'pwd', 'pwd'] } })
  assert.equal(saved.status, 200)
  const body = await saved.json()
  assert.deepEqual(body.assistanceNeeds, ['senior', 'pwd'])
  assert.match(body.note, /not decide eligibility/i)

  const view = await (await request('/api/account/personalization')).json()
  assert.deepEqual(view.settings.assistanceNeeds, ['senior', 'pwd'])
})

test('offices record accessibility information only for published services in scope', async () => {
  assert.equal((await request('/api/admin/personalization', {}, '')).status, 401)

  const globalView = await (await request('/api/admin/personalization', {}, adminCookie)).json()
  assert.ok(globalView.summary.publishedServices >= 1)
  assert.ok(globalView.needCounts.senior >= 1)
  assert.match(globalView.note, /aggregate/i)
  assert.equal(globalView.services.find((service) => service.id === serviceId).features.length, 0)

  const scoped = await request(`/api/admin/personalization/services/${serviceId}`, {
    method: 'PUT',
    json: { accessibilityFeatures: ['wheelchair_access'] },
  }, scopedCookie)
  assert.equal(scoped.status, 404, 'another municipality cannot edit this service')

  const saved = await request(`/api/admin/personalization/services/${serviceId}`, {
    method: 'PUT',
    json: { accessibilityFeatures: ['wheelchair_access', 'priority_lane'], accessibilityNotes: 'Ground-floor room per the Rural Health Unit.' },
  }, adminCookie)
  assert.equal(saved.status, 200, await saved.clone().text())
  const savedBody = await saved.json()
  assert.deepEqual(savedBody.service.features, ['wheelchair_access', 'priority_lane'])
  assert.match(savedBody.service.notes, /Rural Health Unit/)

  const invalidFeature = await request(`/api/admin/personalization/services/${serviceId}`, {
    method: 'PUT',
    json: { accessibilityFeatures: ['helipad'] },
  }, adminCookie)
  assert.equal(invalidFeature.status, 422)
})

test('citizens see published accessibility information when personalization is on', async () => {
  await request('/api/account/personalization', { method: 'PUT', json: { personalizationOptIn: true } })
  const view = await (await request('/api/account/personalization')).json()
  assert.equal(view.services.length, 1, 'draft services are never listed')
  assert.equal(view.services[0].title, 'Inclusive health check')
  assert.equal(view.services[0].features.length, 2)
  assert.match(view.services[0].featureLabels[0], /Wheelchair/)
  assert.match(view.note, /confirm/i)

  const scopedView = await (await request('/api/admin/personalization', {}, scopedCookie)).json()
  assert.equal(scopedView.summary.accountsWithDeclaredNeeds, 0, 'a different municipality sees no declared needs')
  assert.equal(scopedView.services.length, 0)
})
