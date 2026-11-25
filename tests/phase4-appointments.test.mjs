/**
 * Prompt 74 — appointment services, slots, requests, confirmation, ownership,
 * scoping and analytics.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4633
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4appt-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'
const tomorrow = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10)

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
const ids = {}

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
    json: { firstName, lastName: 'Booking', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
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
  await register('p4appt-citizen@example.com', 'Citizen')
  await register('p4appt-other@example.com', 'Other')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const category = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get()
  const makeService = (title, slug, municipalityId) =>
    Number(db.prepare(
      `INSERT INTO government_services (title, slug, category_id, municipality_id, service_scope, publication_status, published_at, availability_status)
       VALUES (?, ?, ?, ?, 'municipal', 'published', datetime('now'), 'needs_confirmation')`,
    ).run(title, slug, category.id, municipalityId).lastInsertRowid)
  ids.bookingService = makeService('Booking service', 'p4-booking-service', 1)
  ids.requestService = makeService('Request service', 'p4-request-service', 1)
  ids.otherService = makeService('Mogpog service', 'p4-mogpog-booking', 2)
  db.prepare(`INSERT INTO appointment_settings (service_id, appointment_mode, office_name, location) VALUES (?, 'confirmed_booking', 'Boac office', 'Municipal hall')`).run(ids.bookingService)
  db.prepare(`INSERT INTO appointment_settings (service_id, appointment_mode, office_name) VALUES (?, 'request', 'Request desk')`).run(ids.requestService)
  db.prepare(`INSERT INTO appointment_settings (service_id, appointment_mode) VALUES (?, 'external')`).run(ids.otherService)
  ids.slot = Number(db.prepare(
    `INSERT INTO appointment_slots (service_id, municipality_id, office_name, slot_date, start_time, end_time, capacity) VALUES (?, 1, 'Boac office', ?, '09:00', '09:30', 1)`,
  ).run(ids.bookingService, tomorrow).lastInsertRowid)
  ids.requestSlot = Number(db.prepare(
    `INSERT INTO appointment_slots (service_id, municipality_id, office_name, slot_date, start_time, end_time, capacity) VALUES (?, 1, 'Request desk', ?, '10:00', '10:30', 3)`,
  ).run(ids.requestService, tomorrow).lastInsertRowid)
  db.close()

  cookie = await login('p4appt-citizen@example.com')
  otherCookie = await login('p4appt-other@example.com')

  const db2 = new DatabaseSync(DB_PATH)
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db2.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Appt Admin', 'p4appt-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db2.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Admin', 'p4appt-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db2.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db2.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db2.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db2.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  db2.close()

  adminCookie = await login('p4appt-admin@example.com')
  scopedCookie = await login('p4appt-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('only configured appointment services are offered', async () => {
  const list = await (await request('/api/account/appointments/services')).json()
  assert.equal(list.results.length, 3)
  assert.equal(list.results.find((row) => row.id === ids.bookingService).mode, 'confirmed_booking')
  assert.equal(list.results.find((row) => row.id === ids.bookingService).modeLabel.length > 0, true)
})

test('a configured slot can be reserved and capacity prevents double booking', async () => {
  const booked = await request('/api/account/appointments', { json: { serviceSlug: 'p4-booking-service', slotId: ids.slot, note: 'Morning please' } })
  assert.equal(booked.status, 201, await booked.clone().text())
  const body = await booked.json()
  assert.match(body.appointment.reference, /^BG-APT-[A-Z2-9]{6}$/)
  assert.equal(body.appointment.status, 'confirmed')
  assert.match(body.message, /not an official|BetterGo record/i)

  const second = await request('/api/account/appointments', { json: { serviceSlug: 'p4-booking-service', slotId: ids.slot } }, otherCookie)
  assert.equal(second.status, 422)

  const full = await (await request('/api/account/appointments')).json()
  assert.equal(full.totals.confirmed, 1)
  assert.equal(full.upcoming.length, 1)
})

test('a request without confirmed arrangements stays pending', async () => {
  const requested = await request('/api/account/appointments', { json: { serviceSlug: 'p4-request-service', slotId: ids.requestSlot, note: 'Please schedule' } })
  assert.equal(requested.status, 201)
  const body = await requested.json()
  assert.equal(body.appointment.status, 'pending_confirmation')
  assert.match(body.message, /not confirmed/i)
})

test('cancelling releases the reserved slot and records history', async () => {
  const center = await (await request('/api/account/appointments')).json()
  const confirmed = center.upcoming.find((row) => row.status === 'confirmed')
  const cancelled = await request(`/api/account/appointments/${confirmed.id}/cancel`, { json: { reason: 'Schedule conflict' } })
  assert.equal(cancelled.status, 200)
  assert.equal((await cancelled.json()).appointment.status, 'cancelled_citizen')

  const db = new DatabaseSync(DB_PATH)
  const slot = db.prepare(`SELECT booked FROM appointment_slots WHERE id = ?`).get(ids.slot)
  db.close()
  assert.equal(slot.booked, 0)

  const returned = await (await request(`/api/account/appointments/${confirmed.id}`)).json()
  assert.equal(returned.appointment.events.some((event) => event.action === 'cancelled_by_citizen'), true)

  const rebook = await request('/api/account/appointments', { json: { serviceSlug: 'p4-booking-service', slotId: ids.slot } })
  assert.equal(rebook.status, 201)
})

test('rescheduling is a request and does not silently change a confirmed appointment', async () => {
  const center = await (await request('/api/account/appointments')).json()
  const confirmed = center.upcoming.find((row) => row.status === 'confirmed')
  const result = await request(`/api/account/appointments/${confirmed.id}/reschedule`, { json: { preferredDate: tomorrow, reason: 'Need another day' } })
  assert.equal(result.status, 200)
  const body = await result.json()
  assert.equal(body.appointment.status, 'reschedule_requested')
  assert.match(body.message, /not changed until/i)
})

test('appointments are private to their owner', async () => {
  const center = await (await request('/api/account/appointments')).json()
  const own = center.upcoming[0]
  for (const [pathname, options] of [
    [`/api/account/appointments/${own.id}`, {}],
    [`/api/account/appointments/${own.id}/cancel`, { method: 'POST', json: {} }],
    [`/api/account/appointments/${own.id}/summary`, {}],
  ]) {
    assert.equal((await request(pathname, options, otherCookie)).status, 404)
  }
})

test('administrators confirm, reject with a reason and stay within scope', async () => {
  const queue = await (await request('/api/admin/appointments?status=pending_confirmation', {}, adminCookie)).json()
  assert.equal(queue.results.length, 1)
  const pending = queue.results[0]

  const noReason = await request(`/api/admin/appointments/${pending.id}/reject`, { method: 'POST', json: {} }, adminCookie)
  assert.equal(noReason.status, 422)

  const confirmed = await request(`/api/admin/appointments/${pending.id}/confirm`, { method: 'POST', json: { reason: 'Schedule verified' } }, adminCookie)
  assert.equal(confirmed.status, 200)
  assert.equal((await confirmed.json()).appointment.status, 'confirmed')

  const citizenView = await (await request(`/api/account/appointments/${pending.id}`)).json()
  assert.equal(citizenView.appointment.status, 'confirmed')
  assert.equal(citizenView.appointment.events.some((event) => event.actor_type === 'admin'), true)

  const mogpogQueue = await (await request('/api/admin/appointments', {}, scopedCookie)).json()
  assert.equal(mogpogQueue.results.some((row) => row.id === pending.id), false)
  assert.equal((await request(`/api/admin/appointments/${pending.id}`, {}, scopedCookie)).status, 404)
})

test('configuration validates external links and slot conflicts', async () => {
  const external = await request(`/api/admin/appointment-settings/${ids.otherService}`, { method: 'PUT', json: { appointmentMode: 'external' } }, adminCookie)
  assert.equal(external.status, 422)
  const configured = await request(`/api/admin/appointment-settings/${ids.otherService}`, {
    method: 'PUT',
    json: { appointmentMode: 'external', externalUrl: 'https://office.example.gov.ph/book' },
  }, adminCookie)
  assert.equal(configured.status, 200)

  const forbidden = await request(`/api/admin/appointment-settings/${ids.bookingService}`, { method: 'PUT', json: { appointmentMode: 'request' } }, scopedCookie)
  assert.equal(forbidden.status, 404)

  const conflict = await request('/api/admin/appointment-slots', {
    json: { serviceId: ids.bookingService, slotDate: tomorrow, startTime: '09:00', endTime: '09:30' },
  }, adminCookie)
  assert.equal(conflict.status, 422)

  const blockDelete = await request(`/api/admin/appointment-slots/${ids.slot}`, { method: 'DELETE' }, adminCookie)
  assert.equal([200, 422].includes(blockDelete.status), true)
})

test('appointment analytics are aggregated and role restricted', async () => {
  const analytics = await (await request('/api/admin/appointments-analytics', {}, adminCookie)).json()
  assert.equal(analytics.totals.requests >= 2, true)
  assert.equal(JSON.stringify(analytics).includes('p4appt-citizen@example.com'), false)
  assert.match(analytics.note, /never lists citizens/i)
  const denied = await request('/api/admin/appointments-analytics', {}, scopedCookie)
  assert.equal([401, 403].includes(denied.status), true)
})

test('appointment endpoints require authentication', async () => {
  assert.equal((await request('/api/account/appointments', {}, '')).status, 401)
  assert.equal((await request('/api/account/appointments/services', {}, '')).status, 401)
})
