/**
 * Prompt 82 — account security centre, session revocation, reports and
 * administrative security controls.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4657
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4security-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let secondCookie = ''
let thirdCookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
let reportId = null
let incidentId = null
let citizenId = null

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

const login = async (email, password = PASSWORD) => {
  const response = await request('/api/auth/login', { method: 'POST', json: { email, password } }, '')
  assert.equal(response.status, 200, await response.clone().text())
  return (response.headers.get('set-cookie') || '').split(';')[0]
}

const register = async (email, firstName) => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { firstName, lastName: 'Security', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  }, '')
  assert.equal(response.status, 201, await response.text())
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_PATH: DB_PATH, API_PORT: String(PORT), SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac', NODE_ENV: 'test' },
    stdio: 'ignore',
  })
  await waitForServer()
  await register('p4security-citizen@example.com', 'Sec')
  await register('p4security-other@example.com', 'Other')
  cookie = await login('p4security-citizen@example.com')
  secondCookie = await login('p4security-citizen@example.com')
  thirdCookie = await login('p4security-citizen@example.com')
  otherCookie = await login('p4security-other@example.com')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  citizenId = Number(db.prepare(`SELECT id FROM users WHERE email = 'p4security-citizen@example.com'`).get().id)
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Security Admin', 'p4security-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Security Admin', 'p4security-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  db.close()

  adminCookie = await login('p4security-admin@example.com')
  scopedCookie = await login('p4security-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('the security centre lists this account sessions without secrets', async () => {
  const response = await request('/api/account/security')
  assert.equal(response.status, 200)
  const text = await response.clone().text()
  assert.doesNotMatch(text, /token_hash/)
  const body = JSON.parse(text)
  assert.equal(body.sessions.length, 3)
  assert.equal(body.sessions.filter((row) => row.current).length, 1)
  assert.match(body.indicators.note, /not proof/i)
  assert.match(body.note, /not police reports/i)
  assert.ok(body.phishingTips.length >= 3)
  assert.equal(body.account.email, 'p4security-citizen@example.com')
})

test('a citizen cannot read or revoke another citizen session', async () => {
  const mine = await (await request('/api/account/security')).json()
  const target = mine.sessions.find((row) => !row.current)
  const foreign = await request(`/api/account/security/sessions/${target.sessionId}/revoke`, { json: {} }, otherCookie)
  assert.equal(foreign.status, 404)

  const otherView = await (await request('/api/account/security', {}, otherCookie)).json()
  assert.equal(otherView.sessions.length, 1, 'other citizens only see their own sessions')
})

test('ending a session invalidates it immediately', async () => {
  const mine = await (await request('/api/account/security')).json()
  const target = mine.sessions.find((row) => !row.current)
  const revoked = await request(`/api/account/security/sessions/${target.sessionId}/revoke`, { json: {} })
  assert.equal(revoked.status, 200)
  const afterRevoke = await (await request('/api/account/security')).json()
  assert.ok(!afterRevoke.sessions.some((row) => row.sessionId === target.sessionId), 'the revoked session is gone')

  const others = await request('/api/account/security/sessions/revoke-others', { json: {} })
  assert.equal(others.status, 200)
  const meSecond = await (await request('/api/auth/me', {}, secondCookie)).json()
  const meThird = await (await request('/api/auth/me', {}, thirdCookie)).json()
  assert.equal(meSecond.user, null, 'other devices are signed out')
  assert.equal(meThird.user, null, 'other devices are signed out')
  const meCurrent = await (await request('/api/auth/me', {}, cookie)).json()
  assert.equal(meCurrent.user.email, 'p4security-citizen@example.com')
})

test('citizens submit security reports that stay private', async () => {
  const short = await request('/api/account/security/reports', { json: { category: 'unknown_login', description: 'short' } })
  assert.equal(short.status, 422)

  const created = await request('/api/account/security/reports', {
    json: { category: 'suspicious_message', description: 'A text message asked me to send my one-time code to a link.', evidenceNote: 'Sender used an unofficial number.' },
  })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.match(body.report.reference, /^BG-SEC-/)
  assert.equal(body.report.status, 'submitted')
  assert.match(body.message, /not an official police/i)
  reportId = body.report.id

  const otherView = await (await request('/api/account/security', {}, otherCookie)).json()
  assert.equal(otherView.reports.length, 0)
})

test('reports are reviewed within municipality scope only', async () => {
  const cross = await request(`/api/admin/security/reports/${reportId}/decision`, { json: { status: 'resolved', note: 'Checked' } }, scopedCookie)
  assert.equal(cross.status, 404)

  const view = await (await request('/api/admin/security', {}, adminCookie)).json()
  assert.match(view.note, /not confirmed incidents/i)
  assert.ok(view.reports.some((row) => row.id === reportId))

  const reviewed = await request(`/api/admin/security/reports/${reportId}/decision`, { json: { status: 'under_review', note: 'Reviewing the reported number.' } }, adminCookie)
  assert.equal(reviewed.status, 200)
  const mine = await (await request('/api/account/security')).json()
  assert.equal(mine.reports.find((row) => row.id === reportId).status, 'under_review')
})

test('security incidents are recorded with a timeline by global reviewers', async () => {
  const blocked = await request('/api/admin/security/incidents', { json: { title: 'Scoped attempt', severity: 'low' } }, scopedCookie)
  assert.equal(blocked.status, 403)

  const created = await request('/api/admin/security/incidents', {
    json: { title: 'Repeated credential stuffing attempts', severity: 'high', detectionSource: 'login_attempts', affectedScope: 'Sign-in endpoint only', summary: 'Elevated failures from one network range.' },
  }, adminCookie)
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.match(body.incident.reference, /^BG-INC-/)
  assert.match(body.message, /do not publish/i)
  incidentId = body.incident.id

  const updated = await request(`/api/admin/security/incidents/${incidentId}/update`, { json: { status: 'investigating', note: 'Reviewing logs for affected accounts.' } }, adminCookie)
  assert.equal(updated.status, 200)
  const view = await (await request('/api/admin/security', {}, adminCookie)).json()
  const incident = view.incidents.find((row) => row.id === incidentId)
  assert.equal(incident.status, 'investigating')
  assert.ok(incident.events.length >= 2)
})

test('restricting an account ends its sessions and can be restored', async () => {
  const restricted = await request(`/api/admin/security/users/${citizenId}/restrict`, { json: { action: 'restrict', note: 'Security review required.' } }, adminCookie)
  assert.equal(restricted.status, 200)
  const afterRestrict = await request('/api/account/security')
  assert.ok([401, 403].includes(afterRestrict.status), 'the existing session no longer works')

  const blockedLogin = await request('/api/auth/login', { method: 'POST', json: { email: 'p4security-citizen@example.com', password: PASSWORD } }, '')
  assert.notEqual(blockedLogin.status, 200)

  const restored = await request(`/api/admin/security/users/${citizenId}/restrict`, { json: { action: 'restore', note: 'Review completed, no compromise found.' } }, adminCookie)
  assert.equal(restored.status, 200)
  cookie = await login('p4security-citizen@example.com')
  assert.equal((await request('/api/account/security')).status, 200)
})
