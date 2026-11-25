/**
 * Prompt 85 — account deactivation, reviewed deletion, retention and
 * anonymisation.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4663
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4lifecycle-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'
const EMAIL = 'p4life-citizen@example.com'

let child
let cookie = ''
let helperCookie = ''
let adminCookie = ''
let scopedCookie = ''
let deletionId = null
let secondDeletionId = null

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
  if (response.status !== 200) return null
  return (response.headers.get('set-cookie') || '').split(';')[0]
}

const register = async (email, firstName) => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { firstName, lastName: 'Lifecycle', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  }, '')
  assert.equal(response.status, 201, await response.text())
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_PATH: DB_PATH, API_PORT: String(PORT), SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac', NODE_ENV: 'test' },
    stdio: 'ignore',
  })
  await waitForServer()
  await register(EMAIL, 'Life')
  await register('p4life-helper@example.com', 'Helper')
  cookie = await login(EMAIL)
  helperCookie = await login('p4life-helper@example.com')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Life Admin', 'p4life-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Life Admin', 'p4life-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  db.close()

  adminCookie = await login('p4life-admin@example.com')
  scopedCookie = await login('p4life-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('account management explains status, sessions and retention honestly', async () => {
  const body = await (await request('/api/account/account-management')).json()
  assert.equal(body.account.email, EMAIL)
  assert.match(body.note, /never claims immediate erasure/i)
  assert.ok(body.retention.length >= 10)
  assert.ok(body.retention.every((rule) => rule.legalReviewStatus !== 'approved'), 'no legal period is invented')
  assert.match(body.recovery, /reactivate/i)

  const helperView = await (await request('/api/account/account-management', {}, helperCookie)).json()
  assert.equal(helperView.account.email, 'p4life-helper@example.com')
})

test('deletion needs a draft, typed email confirmation and can be withdrawn', async () => {
  const draft = await request('/api/account/deletion-requests', { json: { reason: 'No longer needed' } })
  assert.equal(draft.status, 201, await draft.clone().text())
  const draftBody = await draft.json()
  assert.equal(draftBody.deletion.status, 'draft')
  assert.ok(draftBody.consequences.some((item) => /anonymised/i.test(item)))
  deletionId = draftBody.deletion.id

  const wrong = await request(`/api/account/deletion-requests/${deletionId}/submit`, { json: { confirmationText: 'wrong@example.com', confirm: true } })
  assert.equal(wrong.status, 422)

  const submitted = await request(`/api/account/deletion-requests/${deletionId}/submit`, { json: { confirmationText: EMAIL, confirm: true } })
  assert.equal(submitted.status, 200, await submitted.clone().text())
  assert.match((await submitted.json()).message, /nothing is deleted yet/i)

  const withdrawn = await request(`/api/account/deletion-requests/${deletionId}/withdraw`, { json: {} })
  assert.equal(withdrawn.status, 200)
  assert.equal((await request(`/api/account/deletion-requests/${deletionId}/withdraw`, { json: {} })).status, 422)
})

test('deactivation ends sessions and delegated access, and reactivation works', async () => {
  const delegation = await request('/api/account/delegations', { json: { email: 'p4life-helper@example.com', relationship: 'family', scopes: ['applications'] } })
  const { delegation: row } = await delegation.json()
  await request(`/api/account/delegations/${row.id}/accept`, { method: 'POST', json: {} }, helperCookie)

  const bad = await request('/api/account/deactivate', { json: { confirm: 'yes' } })
  assert.equal(bad.status, 422)

  const deactivated = await request('/api/account/deactivate', { json: { reason: 'Taking a break', confirm: 'DEACTIVATE' } })
  assert.equal(deactivated.status, 200, await deactivated.clone().text())
  assert.match((await deactivated.json()).message, /records are kept/i)

  const blocked = await request('/api/account/account-management')
  assert.ok([401, 403].includes(blocked.status), 'existing sessions no longer work')

  const reactivated = await request('/api/auth/reactivate', { method: 'POST', json: { email: EMAIL, password: PASSWORD } }, '')
  assert.equal(reactivated.status, 200, await reactivated.clone().text())
  cookie = (reactivated.headers.get('set-cookie') || '').split(';')[0]

  const view = await (await request('/api/account/account-management')).json()
  assert.equal(view.representatives.length, 0, 'delegated access stays revoked')
  assert.equal(view.deactivation.status, 'reactivated')
})

test('deletion review is scoped, scheduled and honestly completed', async () => {
  const draft = await request('/api/account/deletion-requests', { json: { reason: 'Please remove my account' } })
  const { deletion } = await draft.json()
  secondDeletionId = deletion.id
  await request(`/api/account/deletion-requests/${secondDeletionId}/submit`, { json: { confirmationText: EMAIL, confirm: true } })

  const scopedView = await (await request('/api/admin/account-deletion', {}, scopedCookie)).json()
  assert.equal(scopedView.requests.length, 0, 'another municipality sees no deletion requests')
  const cross = await request(`/api/admin/account-deletion/${secondDeletionId}/decision`, { json: { decision: 'reject', note: 'Not my municipality' } }, scopedCookie)
  assert.equal(cross.status, 404)

  const scheduled = await request(`/api/admin/account-deletion/${secondDeletionId}/decision`, {
    json: { decision: 'schedule', note: 'Reviewed linked records.', scheduledFor: '2027-01-15' },
  }, adminCookie)
  assert.equal(scheduled.status, 200, await scheduled.clone().text())

  const completed = await request(`/api/admin/account-deletion/${secondDeletionId}/decision`, {
    json: { decision: 'complete', note: 'Anonymised identifiers; retained records noted.' },
  }, adminCookie)
  assert.equal(completed.status, 200, await completed.clone().text())
  assert.match((await completed.json()).message, /not a claim that every record was erased/i)

  assert.equal(await login(EMAIL), null, 'the old sign-in no longer works')
  const stale = await request('/api/account/account-management', {}, cookie)
  assert.ok([401, 403].includes(stale.status))

  const view = await (await request('/api/admin/account-deletion', {}, adminCookie)).json()
  const done = view.requests.find((row) => row.id === secondDeletionId)
  assert.equal(done.status, 'completed')
  assert.ok(done.events.length >= 2)
})

test('retention rules require explicit review status', async () => {
  const view = await (await request('/api/admin/account-deletion', {}, adminCookie)).json()
  const first = view.retention[0]

  const saved = await request(`/api/admin/account-deletion/retention/${first.category}`, {
    method: 'PUT',
    json: {
      retentionRule: 'Keep while the account is active, then follow the approved schedule.',
      retentionTrigger: 'Account closure review',
      deletionMethod: 'Pending approved anonymisation procedure',
      legalReviewStatus: 'pending_legal_review',
    },
  }, adminCookie)
  assert.equal(saved.status, 200, await saved.clone().text())
  assert.match((await saved.json()).message, /not approved/i)

  const invalid = await request(`/api/admin/account-deletion/retention/${first.category}`, {
    method: 'PUT',
    json: { retentionRule: 'short', retentionTrigger: 'x', deletionMethod: 'y', legalReviewStatus: 'approved' },
  }, adminCookie)
  assert.equal(invalid.status, 422)
})
