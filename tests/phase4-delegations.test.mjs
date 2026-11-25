/**
 * Prompt 79 — delegated read-only access, acceptance and revocation.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 4643
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4deleg-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let ownerCookie = ''
let delegateCookie = ''
let strangerCookie = ''
let delegationId = null

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return
    } catch { /* not up */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('API did not become ready')
}

function request(pathname, options = {}, as = ownerCookie) {
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
    json: { firstName, lastName: 'Delegation', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
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
  await register('p4deleg-owner@example.com', 'Owner')
  await register('p4deleg-helper@example.com', 'Helper')
  await register('p4deleg-stranger@example.com', 'Stranger')
  ownerCookie = await login('p4deleg-owner@example.com')
  delegateCookie = await login('p4deleg-helper@example.com')
  strangerCookie = await login('p4deleg-stranger@example.com')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const owner = db.prepare(`SELECT id FROM users WHERE email = 'p4deleg-owner@example.com'`).get()
  const category = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get()
  const serviceId = Number(db.prepare(`INSERT INTO government_services (title, slug, category_id, publication_status) VALUES ('Delegated service', 'p4-delegated-service', ?, 'published')`).run(category.id).lastInsertRowid)
  db.prepare(
    `INSERT INTO document_requests (reference, user_id, service_id, status) VALUES ('BG-DOC-OWNER1', ?, 1, 'submitted')`,
  ).run(Number(owner.id))
  db.close()
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('invitations require an existing account and explicit scopes', async () => {
  const unknown = await request('/api/account/delegations', { json: { email: 'nobody@example.com', relationship: 'family', scopes: ['applications'] } })
  assert.equal(unknown.status, 422)

  const self = await request('/api/account/delegations', { json: { email: 'p4deleg-owner@example.com', relationship: 'family', scopes: ['applications'] } })
  assert.equal(self.status, 422)

  const created = await request('/api/account/delegations', {
    json: { email: 'p4deleg-helper@example.com', relationship: 'caregiver', scopes: ['document_requests'], expiresAt: '2027-12-31' },
  })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.equal(body.delegation.status, 'pending')
  assert.match(body.message, /must accept/i)
  delegationId = body.delegation.id

  const duplicate = await request('/api/account/delegations', { json: { email: 'p4deleg-helper@example.com', relationship: 'family', scopes: ['applications'] } })
  assert.equal(duplicate.status, 422)
})

test('nothing is shared before acceptance', async () => {
  assert.equal((await request(`/api/account/delegations/${delegationId}/overview`, {}, delegateCookie)).status, 404)
  assert.equal((await request(`/api/account/delegations/${delegationId}/accept`, { method: 'POST', json: {} }, strangerCookie)).status, 404)

  const pending = await (await request('/api/account/delegations', {}, delegateCookie)).json()
  assert.equal(pending.received[0].status, 'pending')
  assert.equal(pending.received[0].ownerName, 'Owner Delegation')
})

test('accepting grants only the selected read-only summaries', async () => {
  const accepted = await request(`/api/account/delegations/${delegationId}/accept`, { method: 'POST', json: {} }, delegateCookie)
  assert.equal(accepted.status, 200)

  const overview = await (await request(`/api/account/delegations/${delegationId}/overview`, {}, delegateCookie)).json()
  assert.equal(overview.sections.documentRequests.length, 1)
  assert.equal(overview.sections.applications, undefined, 'ungranted scopes are absent')
  assert.equal(overview.sections.payments, undefined, 'payments are never delegated')
  assert.match(overview.note, /cannot change/i)

  const ownerView = await (await request('/api/account/delegations')).json()
  assert.equal(ownerView.given[0].status, 'active')
})

test('revocation removes access immediately for both parties', async () => {
  const revoked = await request(`/api/account/delegations/${delegationId}/revoke`, { method: 'POST', json: {} }, ownerCookie)
  assert.equal(revoked.status, 200)
  assert.equal((await request(`/api/account/delegations/${delegationId}/overview`, {}, delegateCookie)).status, 404)

  const delegateView = await (await request('/api/account/delegations', {}, delegateCookie)).json()
  assert.equal(delegateView.received[0].status, 'revoked')
})

test('declining shares nothing and delegation endpoints need authentication', async () => {
  const created = await request('/api/account/delegations', { json: { email: 'p4deleg-stranger@example.com', relationship: 'representative', scopes: ['applications', 'complaints'] } })
  const { delegation } = await created.json()
  const declined = await request(`/api/account/delegations/${delegation.id}/decline`, { method: 'POST', json: {} }, strangerCookie)
  assert.equal(declined.status, 200)
  assert.equal((await request(`/api/account/delegations/${delegation.id}/overview`, {}, strangerCookie)).status, 404)
  assert.equal((await request('/api/account/delegations', {}, '')).status, 401)
})
