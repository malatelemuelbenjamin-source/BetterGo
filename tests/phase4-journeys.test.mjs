/**
 * Prompt 83 — service journey planner, templates, change detection and
 * delegated journey sharing.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4659
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4journey-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
let serviceId = null
let secondServiceId = null
let journeyId = null
let taskId = null
let ownerJourneyCount = 0

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
    json: { firstName, lastName: 'Journey', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  }, '')
  assert.equal(response.status, 201, await response.text())
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_PATH: DB_PATH, API_PORT: String(PORT), SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac', NODE_ENV: 'test' },
    stdio: 'ignore',
  })
  await waitForServer()
  await register('p4journey-owner@example.com', 'Journey')
  await register('p4journey-helper@example.com', 'Helper')
  cookie = await login('p4journey-owner@example.com')
  otherCookie = await login('p4journey-helper@example.com')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const category = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get()
  serviceId = Number(db.prepare(
    `INSERT INTO government_services (title, slug, category_id, municipality_id, publication_status, verification_status, fees, source_reference)
     VALUES ('Barangay business permit', 'p4-journey-business-permit', ?, 1, 'published', 'verified', 'PHP 300 as published', 'SB-2026-01')`,
  ).run(category.id).lastInsertRowid)
  secondServiceId = Number(db.prepare(
    `INSERT INTO government_services (title, slug, category_id, municipality_id, publication_status) VALUES ('Draft journey service', 'p4-journey-draft', ?, 1, 'draft')`,
  ).run(category.id).lastInsertRowid)
  db.prepare(`INSERT INTO service_requirements (service_id, requirement_name, description, is_required, sort_order) VALUES (?, 'Barangay clearance', 'Original copy', 1, 1)`).run(serviceId)
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Journey Admin', 'p4journey-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Journey Admin', 'p4journey-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  db.close()

  adminCookie = await login('p4journey-admin@example.com')
  scopedCookie = await login('p4journey-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('a journey is created only from a published service and seeds preparation tasks', async () => {
  const draft = await request('/api/account/service-journeys', { json: { serviceId: secondServiceId } })
  assert.equal(draft.status, 422)

  const created = await request('/api/account/service-journeys', { json: { serviceId, priority: 'high' } })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.match(body.journey.reference, /^BG-JRN-/)
  assert.equal(body.journey.status, 'active')
  assert.ok(body.journey.tasks.length >= 4, 'requirement plus standard preparation tasks')
  assert.ok(body.journey.tasks.some((row) => row.title.includes('Barangay clearance')))
  assert.match(body.journey.note, /not official/i)
  assert.equal(body.journey.progress.percent, 0)
  journeyId = body.journey.id
  ownerJourneyCount = 1

  const duplicate = await request('/api/account/service-journeys', { json: { serviceId } })
  assert.equal(duplicate.status, 422)

  const list = await (await request('/api/account/service-journeys')).json()
  assert.equal(list.journeys.length, 1)
  assert.match(list.progressNote, /tasks you checked yourself/i)
})

test('tasks track citizen preparation and progress from actual records', async () => {
  const detail = await (await request(`/api/account/service-journeys/${journeyId}`)).json()
  taskId = detail.journey.tasks[0].id
  const total = detail.journey.tasks.length

  const added = await request(`/api/account/service-journeys/${journeyId}/tasks`, { json: { title: 'Ask the barangay about the form', dueDate: '2027-02-01', priority: 'high' } })
  assert.equal(added.status, 201, await added.clone().text())

  const done = await request(`/api/account/service-journeys/${journeyId}/tasks/${taskId}`, { method: 'PATCH', json: { status: 'done' } })
  assert.equal(done.status, 200)
  assert.match((await done.json()).message, /your own preparation/i)

  const updated = await (await request(`/api/account/service-journeys/${journeyId}`)).json()
  assert.equal(updated.journey.progress.done, 1)
  assert.equal(updated.journey.progress.total, total + 1)
  assert.equal(updated.journey.progress.percent, Math.round((1 / (total + 1)) * 100))
})

test('journeys are private and other citizens cannot read or change them', async () => {
  assert.equal((await request(`/api/account/service-journeys/${journeyId}`, {}, otherCookie)).status, 404)
  assert.equal((await request(`/api/account/service-journeys/${journeyId}`, { method: 'PATCH', json: { status: 'archived' } }, otherCookie)).status, 404)
  assert.equal((await request(`/api/account/service-journeys/${journeyId}/tasks/${taskId}`, { method: 'PATCH', json: { status: 'pending' } }, otherCookie)).status, 404)
  assert.equal((await request('/api/account/service-journeys', {}, '')).status, 401)
})

test('published service changes prompt a review without overwriting tasks', async () => {
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  db.prepare(`UPDATE government_services SET fees = ?, updated_at = datetime('now', '+2 minutes') WHERE id = ?`).run('PHP 350 as published', serviceId)
  db.close()

  const changed = await (await request(`/api/account/service-journeys/${journeyId}`)).json()
  assert.equal(changed.journey.requirementsChanged, true)
  assert.equal(changed.journey.progress.done, 1, 'completed tasks survive the change')

  const reviewed = await request(`/api/account/service-journeys/${journeyId}/acknowledge-update`, { json: {} })
  assert.equal(reviewed.status, 200)
  const after = await (await request(`/api/account/service-journeys/${journeyId}`)).json()
  assert.equal(after.journey.requirementsChanged, false)
  assert.equal(after.journey.progress.done, 1)
})

test('journey status changes control task editing honestly', async () => {
  const paused = await request(`/api/account/service-journeys/${journeyId}`, { method: 'PATCH', json: { status: 'paused' } })
  assert.equal(paused.status, 200)
  const completed = await request(`/api/account/service-journeys/${journeyId}`, { method: 'PATCH', json: { status: 'completed' } })
  assert.equal(completed.status, 200)
  const blocked = await request(`/api/account/service-journeys/${journeyId}/tasks`, { json: { title: 'Late task' } })
  assert.equal(blocked.status, 422)

  const archived = await request(`/api/account/service-journeys/${journeyId}`, { method: 'PATCH', json: { status: 'archived' } })
  assert.equal(archived.status, 200)
  const list = await (await request('/api/account/service-journeys?status=archived')).json()
  assert.equal(list.journeys.length, 1)
})

test('published templates seed new journeys and stay municipality-scoped', async () => {
  const payload = {
    title: 'Business permit preparation',
    notes: 'Based on the published service page.',
    status: 'published',
    steps: [
      { title: 'Prepare the barangay clearance', description: 'Original and photocopy', stepType: 'document' },
      { title: 'Review the official fee page', stepType: 'review' },
    ],
  }
  const cross = await request(`/api/admin/service-journeys/services/${serviceId}`, { method: 'PUT', json: payload }, scopedCookie)
  assert.equal(cross.status, 404)

  const saved = await request(`/api/admin/service-journeys/services/${serviceId}`, { method: 'PUT', json: payload }, adminCookie)
  assert.equal(saved.status, 200, await saved.clone().text())
  assert.match((await saved.json()).message, /published/i)

  const view = await (await request('/api/admin/service-journeys', {}, adminCookie)).json()
  assert.match(view.note, /cannot read citizen notes/i)
  const entry = view.templates.find((row) => row.serviceId === serviceId)
  assert.equal(entry.template.status, 'published')
  assert.equal(entry.template.steps.length, 2)

  await request(`/api/account/service-journeys/${journeyId}`, { method: 'PATCH', json: { status: 'archived' } })
  const fresh = await request('/api/account/service-journeys', { json: { serviceId } })
  assert.equal(fresh.status, 201, await fresh.clone().text())
  const freshBody = await fresh.json()
  assert.deepEqual(freshBody.journey.tasks.map((row) => row.title), ['Prepare the barangay clearance', 'Review the official fee page'])
  journeyId = freshBody.journey.id
})

test('delegated representatives see journey progress only when granted', async () => {
  const created = await request('/api/account/delegations', { json: { email: 'p4journey-helper@example.com', relationship: 'family', scopes: ['journeys'] } })
  assert.equal(created.status, 201, await created.clone().text())
  const { delegation } = await created.json()
  await request(`/api/account/delegations/${delegation.id}/accept`, { method: 'POST', json: {} }, otherCookie)
  const overview = await (await request(`/api/account/delegations/${delegation.id}/overview`, {}, otherCookie)).json()
  assert.ok(overview.sections.journeys.length >= 1)
  assert.equal(overview.sections.applications, undefined)
  assert.equal(overview.sections.journeys[0].tasks_total, 2)
  assert.equal(ownerJourneyCount, 1)
})
