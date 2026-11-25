/**
 * Prompt 72 — discovery search, explained recommendations, finder, related
 * services, history privacy and admin configuration.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4629
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4discovery-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
const serviceIds = {}

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
  assert.equal(response.status, 200, `login failed for ${email}`)
  return (response.headers.get('set-cookie') || '').split(';')[0]
}

const register = async (email, firstName, municipalityId = 1) => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { firstName, lastName: 'Discovery', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId, acceptTerms: true, acceptPrivacy: true },
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
  await register('p4discovery-citizen@example.com', 'Citizen', 1)
  await register('p4discovery-other@example.com', 'Other', 2)

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const category = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get()
  const secondCategory = db.prepare(`SELECT id FROM service_categories LIMIT 1 OFFSET 1`).get() || category
  const insertService = (title, slug, fields = {}) =>
    Number(
      db.prepare(
        `INSERT INTO government_services (title, slug, description, short_description, category_id, municipality_id, service_scope,
          publication_status, published_at, is_online, application_mode, availability_status, is_featured)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)`,
      ).run(
        title,
        slug,
        fields.description || `${title} description`,
        fields.summary || `${title} summary`,
        fields.categoryId || category.id,
        fields.municipalityId || null,
        fields.scope || 'province_wide',
        fields.publicationStatus || 'published',
        fields.isOnline ? 1 : 0,
        fields.mode || null,
        fields.availability || 'needs_confirmation',
        fields.featured ? 1 : 0,
      ).lastInsertRowid,
    )
  serviceIds.boac = insertService('Boac business permit', 'p4-boac-permit', { municipalityId: 1, scope: 'municipal', isOnline: true, mode: 'online' })
  serviceIds.province = insertService('Province-wide civil registry copy', 'p4-civil-registry', { featured: true })
  serviceIds.second = insertService('Mogpog health programme', 'p4-mogpog-health', { municipalityId: 2, scope: 'municipal', categoryId: secondCategory.id })
  serviceIds.draft = insertService('Unpublished draft service', 'p4-draft-service', { publicationStatus: 'draft' })
  db.prepare(`INSERT INTO service_coverage (service_id, municipality_id) VALUES (?, 3)`).run(serviceIds.province)

  const hash = bcrypt.hashSync(PASSWORD, 10)
  const insertUser = (name, email) =>
    Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES (?, ?, ?, datetime('now'), 'active')`).run(name, email, hash).lastInsertRowid)
  const adminId = insertUser('Discovery Admin', 'p4discovery-admin@example.com')
  const scopedId = insertUser('Mogpog Staff', 'p4discovery-scoped@example.com')
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(adminId, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scopedId, municipalRole)
  db.close()

  cookie = await login('p4discovery-citizen@example.com')
  otherCookie = await login('p4discovery-other@example.com')
  adminCookie = await login('p4discovery-admin@example.com')
  scopedCookie = await login('p4discovery-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('search exposes published services only and explains missing coverage', async () => {
  const all = await (await request('/api/account/discovery/services')).json()
  assert.equal(all.results.some((row) => row.id === serviceIds.draft), false)
  assert.equal(all.total, 3)

  const municipal = await (await request('/api/account/discovery/services?municipalityId=2')).json()
  assert.equal(municipal.results.some((row) => row.id === serviceIds.second), true)
  assert.equal(municipal.results.some((row) => row.id === serviceIds.province), true)
  assert.equal(municipal.results.some((row) => row.id === serviceIds.boac), false)
  assert.match(municipal.note, /missing coverage record does not mean a service is unavailable/i)

  const covered = await (await request('/api/account/discovery/services?municipalityId=3')).json()
  assert.equal(covered.results.some((row) => row.id === serviceIds.province), true)

  const online = await (await request('/api/account/discovery/services?online=1')).json()
  assert.equal(online.results.every((row) => row.isOnline), true)

  const searched = await (await request('/api/account/discovery/services?q=civil')).json()
  assert.equal(searched.results.length, 1)
  assert.equal(searched.results[0].capabilityLabel.length > 0, true)
  assert.equal(searched.results[0].capability, 'information_only')
})

test('recommendations explain themselves and can be switched off', async () => {
  const overview = await (await request('/api/account/discovery')).json()
  assert.equal(overview.preferences.personalizationEnabled, true)
  assert.equal(overview.recommendations.length >= 1, true)
  assert.equal(overview.recommendations.every((row) => typeof row.reason === 'string'), true)
  assert.match(overview.recommendations[0].reason, /municipality|saved|recently viewed/i)

  const off = await request('/api/account/discovery/preferences', { method: 'PUT', json: { personalizationEnabled: false } })
  assert.equal(off.status, 200)
  const after = await (await request('/api/account/discovery')).json()
  assert.equal(after.recommendations.length, 0)
  assert.equal(after.featured.length >= 1, true, 'editorial featured items stay visible')
})

test('the guided finder answers with published matches and a clear disclaimer', async () => {
  const finder = await (await request('/api/account/discovery/finder')).json()
  assert.equal(finder.questions.length, 3)
  assert.match(finder.note, /not an official eligibility assessment/i)

  const results = await (await request('/api/account/discovery/finder', {
    json: { municipalityId: 1, category: (await (await request('/api/account/discovery/services')).json()).results.find((row) => row.id === serviceIds.boac).categoryKey, preference: 'online' },
  })).json()
  assert.equal(results.results.some((row) => row.id === serviceIds.boac), true)
  assert.match(results.results[0].reason, /Matches the municipality/i)
})

test('related services combine editorial links and the same category', async () => {
  const related = await (await request(`/api/account/discovery/services/p4-boac-permit/related`)).json()
  assert.equal(related.service.slug, 'p4-boac-permit')
  assert.equal(Array.isArray(related.results), true)
  assert.match(related.note, /not official procedures or mandatory sequences/i)
})

test('history is private, clearable and respects the opt-out', async () => {
  const view = await request('/api/account/activity', {
    json: { type: 'service_viewed', entityType: 'service', entityId: serviceIds.boac, label: 'Boac business permit', slug: 'p4-boac-permit' },
  })
  assert.equal(view.status, 201)
  const recorded = await view.json()
  assert.equal(recorded.recorded, true)

  const history = await (await request('/api/account/discovery/history')).json()
  assert.equal(history.results.length, 1)

  const foreign = await (await request('/api/account/discovery/history', {}, otherCookie)).json()
  assert.equal(foreign.results.length, 0)

  const disabled = await request('/api/account/discovery/preferences', { method: 'PUT', json: { historyEnabled: false } })
  assert.equal(disabled.status, 200)
  const afterDisable = await (await request('/api/account/discovery/history')).json()
  assert.equal(afterDisable.results.length, 0, 'turning history off clears recorded views')

  const skipped = await request('/api/account/activity', {
    json: { type: 'service_viewed', entityType: 'service', entityId: serviceIds.boac, label: 'Boac business permit', slug: 'p4-boac-permit' },
  })
  assert.equal((await skipped.json()).recorded, false)

  await request('/api/account/discovery/preferences', { method: 'PUT', json: { historyEnabled: true } })
  await request('/api/account/activity', { json: { type: 'service_viewed', entityType: 'service', entityId: serviceIds.boac, label: 'Boac business permit', slug: 'p4-boac-permit' } })
  const restored = await (await request('/api/account/discovery/history')).json()
  assert.equal(restored.results.length, 1)
  const cleared = await request(`/api/account/discovery/history/${restored.results[0].id}`, { method: 'DELETE' })
  assert.equal(cleared.status, 200)
  assert.equal((await (await request('/api/account/discovery/history')).json()).results.length, 0)
})

test('saving from discovery uses the existing private saved-services store', async () => {
  const save = await request('/api/account/saved', { json: { contentType: 'service', contentId: serviceIds.boac } })
  assert.equal(save.status, 201)
  const overview = await (await request('/api/account/discovery')).json()
  assert.equal(overview.saved.some((row) => row.id === serviceIds.boac), true)

  const otherSaved = await (await request('/api/account/saved', {}, otherCookie)).json()
  assert.equal(otherSaved.results.length, 0)
})

test('admin configuration is permission-checked and audited', async () => {
  const created = await request('/api/admin/discovery/relationships', {
    json: { serviceId: serviceIds.boac, relatedServiceId: serviceIds.province, relationship: 'related', note: 'Often used together' },
  }, adminCookie)
  assert.equal(created.status, 201, await created.text())

  const listed = await (await request('/api/admin/discovery', {}, adminCookie)).json()
  assert.equal(listed.relationships.length, 1)

  const citizen = await request('/api/admin/discovery', {}, cookie)
  assert.equal([401, 403].includes(citizen.status), true)

  const badQuestion = await request('/api/admin/discovery/questions', {
    json: { key: 'Bad Key', label: 'Not valid', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
  }, adminCookie)
  assert.equal(badQuestion.status, 422)

  const analytics = await (await request('/api/admin/discovery/analytics', {}, adminCookie)).json()
  assert.match(analytics.note, /never individual browsing histories/i)
  const deniedAnalytics = await request('/api/admin/discovery/analytics', {}, scopedCookie)
  assert.equal([401, 403].includes(deniedAnalytics.status), true)
})

test('discovery endpoints require authentication', async () => {
  for (const pathname of ['/api/account/discovery', '/api/account/discovery/services', '/api/account/discovery/history']) {
    const response = await request(pathname, {}, '')
    assert.equal(response.status, 401, pathname)
  }
})
