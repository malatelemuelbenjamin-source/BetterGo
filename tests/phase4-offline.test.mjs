/**
 * Prompt 82 — offline/low-bandwidth service information packs.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4649
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4offline-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let publishedId = null
let draftId = null
let packId = null

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
    json: { firstName, lastName: 'Offline', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  }, '')
  assert.equal(response.status, 201, await response.text())
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_PATH: DB_PATH, API_PORT: String(PORT), SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac', NODE_ENV: 'test' },
    stdio: 'ignore',
  })
  await waitForServer()
  await register('p4offline-citizen@example.com', 'Offline')
  await register('p4offline-other@example.com', 'Other')
  cookie = await login('p4offline-citizen@example.com')
  otherCookie = await login('p4offline-other@example.com')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Offline Admin', 'p4offline-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  const category = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get()
  publishedId = Number(db.prepare(
    `INSERT INTO government_services (title, slug, category_id, municipality_id, publication_status, verification_status, description, fees)
     VALUES ('Barangay clearance', 'p4-offline-barangay-clearance', ?, 1, 'published', 'verified', 'Clearance issued at the barangay hall.', 'As published: PHP 50')`,
  ).run(category.id).lastInsertRowid)
  draftId = Number(db.prepare(
    `INSERT INTO government_services (title, slug, category_id, publication_status) VALUES ('Draft service', 'p4-offline-draft-service', ?, 'draft')`,
  ).run(category.id).lastInsertRowid)
  db.close()

  adminCookie = await login('p4offline-admin@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('packs accept published services only and freeze a snapshot', async () => {
  const initial = await (await request('/api/account/offline-packs')).json()
  assert.deepEqual(initial.packs, [])
  assert.ok(initial.availableServices.some((service) => service.id === publishedId))
  assert.ok(!initial.availableServices.some((service) => service.id === draftId), 'drafts are not offered')

  const draft = await request('/api/account/offline-packs', { json: { serviceIds: [draftId] } })
  assert.equal(draft.status, 422)

  const tooMany = await request('/api/account/offline-packs', { json: { serviceIds: Array.from({ length: 21 }, (_, index) => index + 1) } })
  assert.equal(tooMany.status, 422)

  const created = await request('/api/account/offline-packs', {
    json: { title: 'Barangay visit', serviceIds: [publishedId], expiresAt: '2027-01-31' },
  })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.match(body.pack.reference, /^BG-PACK-/)
  assert.equal(body.pack.itemCount, 1)
  assert.equal(body.pack.snapshot[0].title, 'Barangay clearance')
  assert.match(body.pack.text, /not an official government record/i)
  assert.match(body.pack.text, /PHP 50/)
  assert.equal(body.pack.stale, false)
  packId = body.pack.id
})

test('pack snapshots stay private to the owner', async () => {
  assert.equal((await request(`/api/account/offline-packs/${packId}`, {}, otherCookie)).status, 404)
  assert.equal((await request(`/api/account/offline-packs/${packId}`, { method: 'DELETE' }, otherCookie)).status, 404)
  assert.equal((await request('/api/account/offline-packs', {}, '')).status, 401)

  const own = await (await request(`/api/account/offline-packs/${packId}`)).json()
  assert.equal(own.pack.snapshot.length, 1)
  assert.match(own.pack.note, /snapshot/i)
})

test('packs report when published information changed after capture', async () => {
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  db.prepare(`UPDATE government_services SET fees = ?, updated_at = datetime('now', '+1 minute') WHERE id = ?`).run('As published: PHP 80', publishedId)
  db.close()

  const view = await (await request('/api/account/offline-packs')).json()
  const pack = view.packs.find((row) => row.id === packId)
  assert.equal(pack.stale, true)
  assert.equal(pack.staleServices, 1)

  const detail = await (await request(`/api/account/offline-packs/${packId}`)).json()
  assert.match(detail.pack.text, /PHP 50/, 'the frozen snapshot is not silently updated')
})

test('deleting a pack removes it for the owner', async () => {
  const removed = await request(`/api/account/offline-packs/${packId}`, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  assert.equal((await request(`/api/account/offline-packs/${packId}`)).status, 404)
})

test('admin view is aggregate only and scoped', async () => {
  await request('/api/account/offline-packs', { json: { serviceIds: [publishedId] } })
  const view = await (await request('/api/admin/offline-packs', {}, adminCookie)).json()
  assert.ok(view.summary.packs >= 1)
  assert.match(view.note, /aggregate/i)
  assert.match(view.note, /never shows staff which services/i)
  assert.ok(view.byMunicipality.length >= 1)
})
