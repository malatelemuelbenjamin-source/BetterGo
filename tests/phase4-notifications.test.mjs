/**
 * Prompt 68 — citizen notifications centre: categories, read/archive/delete
 * rules, ownership, polling, preferences, municipality follows, templates and
 * delivery honesty.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4621
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4notif-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let approverCookie = ''
let securityNoteId = null
let applicationNoteId = null
let accountNoteId = null

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

const register = async (email, firstName) => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { firstName, lastName: 'Notify', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
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

  await register('p4notify-citizen@example.com', 'Citizen')
  await register('p4notify-other@example.com', 'Other')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const insertUser = (name, email) =>
    Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES (?, ?, ?, datetime('now'), 'active')`).run(name, email, hash).lastInsertRowid)
  const adminId = insertUser('Notify Admin', 'p4notify-admin@example.com')
  const approverId = insertUser('Notify Approver', 'p4notify-approver@example.com')
  const roleId = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  for (const id of [adminId, approverId]) {
    db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(id, roleId)
  }

  const citizenId = db.prepare(`SELECT id FROM users WHERE email = 'p4notify-citizen@example.com'`).get().id
  const insertNote = (fields) =>
    Number(
      db.prepare(
        `INSERT INTO notifications (user_id, title, message, notification_type, category, related_entity_type, related_entity_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(citizenId, fields.title, fields.message || null, fields.type, fields.category, fields.entityType || null, fields.entityId || null).lastInsertRowid,
    )
  securityNoteId = insertNote({ title: 'Password changed', type: 'security', category: 'security' })
  applicationNoteId = insertNote({ title: 'Application updated', type: 'application', category: 'application', entityType: 'application', entityId: 1 })
  accountNoteId = insertNote({ title: 'Welcome to BetterGo', type: 'account', category: 'account' })

  const categoryId = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get().id
  const serviceId = Number(db.prepare(
    `INSERT INTO government_services (title, slug, description, category_id, publication_status, published_at)
     VALUES ('Notification test service', 'p4-notify-service', 'Used by notification tests.', ?, 'published', datetime('now'))`,
  ).run(categoryId).lastInsertRowid)
  db.prepare(
    `INSERT INTO citizen_applications (reference, user_id, municipality_id, service_id, status, submitted_at)
     VALUES ('BG-68-TEST-0001', ?, 1, ?, 'submitted', datetime('now'))`,
  ).run(citizenId, serviceId)
  db.close()

  cookie = await login('p4notify-citizen@example.com')
  otherCookie = await login('p4notify-other@example.com')
  adminCookie = await login('p4notify-admin@example.com')
  approverCookie = await login('p4notify-approver@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('the notification centre reports real categories and unread counts', async () => {
  const response = await request('/api/account/notifications')
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.total, 3)
  assert.equal(body.unread, 3)
  assert.equal(body.counts.security, 1)
  assert.equal(body.counts.application, 1)
  assert.equal(body.channels.inApp, true)
  assert.equal(body.channels.sms, false)
  assert.match(body.note, /In-app notifications are active/i)
})

test('filters narrow by category and status without leaking other accounts', async () => {
  const security = await (await request('/api/account/notifications?category=security')).json()
  assert.equal(security.total, 1)
  assert.equal(security.results[0].title, 'Password changed')

  const unread = await (await request('/api/account/notifications?status=unread')).json()
  assert.equal(unread.total, 3)

  const foreign = await (await request('/api/account/notifications', {}, otherCookie)).json()
  assert.equal(foreign.total, 0)
})

test('another citizen cannot change or delete a notification', async () => {
  const patch = await request(`/api/account/notifications/${accountNoteId}`, { method: 'PATCH', json: { read: true } }, otherCookie)
  assert.equal(patch.status, 404)
  const remove = await request(`/api/account/notifications/${accountNoteId}`, { method: 'DELETE' }, otherCookie)
  assert.equal(remove.status, 404)
})

test('read, important and archive states work and can be reversed', async () => {
  const read = await request(`/api/account/notifications/${accountNoteId}`, { method: 'PATCH', json: { read: true } })
  assert.equal(read.status, 200)
  assert.equal((await read.json()).notification.read, true)

  const important = await request(`/api/account/notifications/${accountNoteId}`, { method: 'PATCH', json: { important: true } })
  assert.equal((await important.json()).notification.important, true)

  const archived = await request(`/api/account/notifications/${accountNoteId}`, { method: 'PATCH', json: { archived: true } })
  assert.equal(archived.status, 200)

  const inbox = await (await request('/api/account/notifications')).json()
  assert.equal(inbox.results.some((row) => row.id === accountNoteId), false)

  const archiveView = await (await request('/api/account/notifications?status=archived')).json()
  assert.equal(archiveView.results.some((row) => row.id === accountNoteId), true)

  const restored = await request(`/api/account/notifications/${accountNoteId}`, { method: 'PATCH', json: { archived: false } })
  assert.equal(restored.status, 200)
  const after = await (await request('/api/account/notifications')).json()
  assert.equal(after.results.some((row) => row.id === accountNoteId), true)
})

test('security notices cannot be archived or deleted', async () => {
  const archive = await request(`/api/account/notifications/${securityNoteId}`, { method: 'PATCH', json: { archived: true } })
  assert.equal(archive.status, 422)
  const remove = await request(`/api/account/notifications/${securityNoteId}`, { method: 'DELETE' })
  assert.equal(remove.status, 422)
  const list = await (await request('/api/account/notifications')).json()
  assert.equal(list.results.some((row) => row.id === securityNoteId), true)
})

test('deleting a notification never deletes the underlying record', async () => {
  const remove = await request(`/api/account/notifications/${applicationNoteId}`, { method: 'DELETE' })
  assert.equal(remove.status, 200)
  assert.match((await remove.json()).message, /was not changed/)
  const applications = await (await request('/api/account/applications')).json()
  assert.equal(applications.results.length, 1)
})

test('read-all marks the inbox read and archive-all keeps protected notices', async () => {
  await request('/api/account/notifications/read-all', { method: 'POST', json: {} })
  const list = await (await request('/api/account/notifications')).json()
  assert.equal(list.unread, 0)

  const archived = await request('/api/account/notifications/archive-all', { method: 'POST', json: {} })
  assert.equal(archived.status, 200)
  const inbox = await (await request('/api/account/notifications')).json()
  assert.equal(inbox.results.every((row) => row.category === 'security'), true)
})

test('polling returns only new notifications for the signed-in citizen', async () => {
  const initial = await (await request('/api/account/notifications/poll?since=0')).json()
  const latest = initial.latestId
  assert.equal(initial.results.length >= 1, true)

  const empty = await (await request(`/api/account/notifications/poll?since=${latest}`)).json()
  assert.equal(empty.results.length, 0)
  assert.equal(empty.latestId, latest)

  const foreign = await (await request('/api/account/notifications/poll?since=0', {}, otherCookie)).json()
  assert.equal(foreign.results.length, 0)
})

test('notification settings keep security on and accept quiet hours', async () => {
  const settings = await (await request('/api/account/notification-settings')).json()
  assert.equal(settings.categories.find((row) => row.key === 'security').alwaysOn, true)
  assert.equal(settings.municipalities.length, 6)

  const saved = await request('/api/account/notification-settings', {
    method: 'PUT',
    json: { applications: false, security: false, quietHoursStart: '22:00', quietHoursEnd: '06:00' },
  })
  assert.equal(saved.status, 200)
  const body = await saved.json()
  assert.equal(body.preferences.applications_enabled, 0)
  assert.equal(body.preferences.security_enabled, 1, 'security notices stay on')
  assert.equal(body.preferences.quiet_hours_start, '22:00')

  const invalid = await request('/api/account/notification-settings', { method: 'PUT', json: { quietHoursStart: '25:99' } })
  assert.equal(invalid.status, 422)
})

test('municipality follows are private and can be removed', async () => {
  const follow = await request('/api/account/notification-settings/municipalities/1', { method: 'POST', json: {} })
  assert.equal(follow.status, 201)
  const settings = await (await request('/api/account/notification-settings')).json()
  assert.equal(settings.follows.length, 1)

  const foreign = await (await request('/api/account/notification-settings', {}, otherCookie)).json()
  assert.equal(foreign.follows.length, 0)

  const unfollow = await request('/api/account/notification-settings/municipalities/1', { method: 'DELETE' })
  assert.equal(unfollow.status, 200)
  const after = await (await request('/api/account/notification-settings')).json()
  assert.equal(after.follows.length, 0)
})

test('delivery status never claims an unconfirmed email or SMS delivery', async () => {
  const body = await (await request('/api/account/notifications/delivery-status')).json()
  assert.equal(body.channels.in_app.state, 'active')
  assert.equal(body.channels.sms.state, 'unavailable')
  assert.match(body.note, /provider-confirmed/i)
})

test('templates reject markup, unknown variables and unavailable channels', async () => {
  const created = await request('/api/admin/notification-templates', {
    method: 'POST',
    json: {
      name: 'Application status update',
      category: 'application',
      title: 'Your BetterGo record {{reference}} was updated',
      body: 'Hello {{citizen_name}}, your record {{reference}} is now {{status}}.',
      channel: 'in_app',
      language: 'en',
      status: 'active',
    },
  }, adminCookie)
  assert.equal(created.status, 201, await created.text())

  const html = await request('/api/admin/notification-templates', {
    method: 'POST',
    json: { name: 'Unsafe', category: 'account', title: '<b>Hello</b>', body: 'Body', channel: 'in_app' },
  }, adminCookie)
  assert.equal(html.status, 422)

  const unknown = await request('/api/admin/notification-templates', {
    method: 'POST',
    json: { name: 'Unknown variable', category: 'account', title: 'Hello {{ssn}}', body: 'Body', channel: 'in_app' },
  }, adminCookie)
  assert.equal(unknown.status, 422)

  const sms = await request('/api/admin/notification-templates', {
    method: 'POST',
    json: { name: 'SMS template', category: 'account', title: 'Hi', body: 'Body', channel: 'sms' },
  }, adminCookie)
  assert.equal(sms.status, 422)

  const list = await (await request('/api/admin/notification-templates', {}, adminCookie)).json()
  assert.equal(list.results.some((row) => row.name === 'Application status update'), true)

  const citizen = await request('/api/admin/notification-templates', {}, cookie)
  assert.equal(citizen.status, 403)
})

test('campaigns are approval-gated and dispatch is refused', async () => {
  const emergency = await request('/api/admin/notification-campaigns', {
    method: 'POST',
    json: { title: 'Emergency test', category: 'emergency' },
  }, adminCookie)
  assert.equal(emergency.status, 422, 'emergency campaigns need a verified source workflow')

  const created = await request('/api/admin/notification-campaigns', {
    method: 'POST',
    json: { title: 'Service maintenance notice', category: 'platform' },
  }, adminCookie)
  const campaign = await created.json()
  assert.equal(created.status, 201, JSON.stringify(campaign))

  const selfApprove = await request(`/api/admin/notification-campaigns/${campaign.id}/approve`, { method: 'POST', json: {} }, adminCookie)
  assert.equal(selfApprove.status, 403)

  const approved = await request(`/api/admin/notification-campaigns/${campaign.id}/approve`, { method: 'POST', json: {} }, approverCookie)
  assert.equal(approved.status, 200, await approved.text())

  const send = await request(`/api/admin/notification-campaigns/${campaign.id}/send`, { method: 'POST', json: {} }, approverCookie)
  assert.equal(send.status, 422)
  assert.match((await send.json()).error, /No notifications were sent/i)

  const list = await (await request('/api/admin/notification-campaigns', {}, adminCookie)).json()
  assert.equal(list.dispatchAvailable, false)
})

test('analytics use stored rows and distinguish in-app reads from delivery', async () => {
  const analytics = await (await request('/api/admin/notification-analytics', {}, adminCookie)).json()
  assert.equal(analytics.totals.created >= 2, true)
  assert.equal(Array.isArray(analytics.byCategory), true)
  assert.match(analytics.note, /In-app reads are tracked/i)

  const citizen = await request('/api/admin/notification-analytics', {}, cookie)
  assert.equal(citizen.status, 403)
})

test('unauthenticated callers cannot read notifications', async () => {
  const response = await request('/api/account/notifications', {}, '')
  assert.equal(response.status, 401)
  const poll = await request('/api/account/notifications/poll', {}, '')
  assert.equal(poll.status, 401)
})
