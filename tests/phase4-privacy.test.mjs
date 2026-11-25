/**
 * Prompt 71 — privacy centre: overview, consent withdrawal, notice versioning,
 * request workflows, export ownership, sharing revocation, deactivation,
 * incidents and administration restrictions.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4627
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4privacy-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let reviewerCookie = ''
let shareId = null
let requestReference = null

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
    json: { firstName, lastName: 'Privacy', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
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
  await register('p4privacy-citizen@example.com', 'Citizen')
  await register('p4privacy-other@example.com', 'Other')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const insertUser = (name, email) =>
    Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES (?, ?, ?, datetime('now'), 'active')`).run(name, email, hash).lastInsertRowid)
  const adminId = insertUser('Privacy Admin', 'p4privacy-admin@example.com')
  const reviewerId = insertUser('Privacy Reviewer', 'p4privacy-reviewer@example.com')
  const roleId = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  for (const id of [adminId, reviewerId]) {
    db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(id, roleId)
  }

  const citizenId = db.prepare(`SELECT id FROM users WHERE email = 'p4privacy-citizen@example.com'`).get().id
  const docId = Number(
    db.prepare(
      `INSERT INTO citizen_documents (user_id, category, original_filename, storage_reference, mime_type, file_size, title, status)
       VALUES (?, 'certificates', 'clearance.pdf', 'privacy-test.pdf', 'application/pdf', 100, 'Clearance', 'active')`,
    ).run(citizenId).lastInsertRowid,
  )
  shareId = Number(
    db.prepare(`INSERT INTO document_shares (document_id, user_id, recipient_label, purpose) VALUES (?, ?, 'Boac office', 'Review')`).run(docId, citizenId).lastInsertRowid,
  )
  db.prepare(`INSERT INTO consent_records (user_id, consent_category, status, policy_version) VALUES (?, 'optional_communications', 'granted', 'v1')`).run(citizenId)
  db.prepare(`INSERT INTO consent_records (user_id, consent_category, status, policy_version) VALUES (?, 'privacy_policy', 'granted', 'v1')`).run(citizenId)
  db.close()

  cookie = await login('p4privacy-citizen@example.com')
  otherCookie = await login('p4privacy-other@example.com')
  adminCookie = await login('p4privacy-admin@example.com')
  reviewerCookie = await login('p4privacy-reviewer@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('the privacy centre summarises only the caller’s own stored data', async () => {
  const response = await request('/api/account/privacy-center')
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.profile.email, 'p4privacy-citizen@example.com')
  assert.equal(body.counts.documents, 1)
  assert.equal(body.counts.sharingPermissions, 1)
  assert.match(body.note, /qualified legal review/i)

  const foreign = await (await request('/api/account/privacy-center', {}, otherCookie)).json()
  assert.equal(foreign.counts.documents, 0)
  assert.equal(foreign.counts.sharingPermissions, 0)
})

test('optional consent can be withdrawn and restored; required consent cannot', async () => {
  const withdraw = await request('/api/account/privacy-center/consents/optional_communications', { method: 'PUT', json: { action: 'withdraw' } })
  assert.equal(withdraw.status, 200)
  assert.match((await withdraw.json()).message, /another lawful basis/i)

  const grant = await request('/api/account/privacy-center/consents/optional_communications', { method: 'PUT', json: { action: 'grant' } })
  assert.equal(grant.status, 201)

  const required = await request('/api/account/privacy-center/consents/privacy_policy', { method: 'PUT', json: { action: 'withdraw' } })
  assert.equal(required.status, 403)
})

test('privacy notices are versioned and need a second publisher', async () => {
  const draft = await request('/api/admin/privacy-notices', {
    json: { docType: 'privacy_policy', title: 'Privacy Policy', body: 'This notice explains how BetterGo processes personal data for platform features. It is not a legal certification.', version: '2.0', language: 'en' },
  }, adminCookie)
  const body = await draft.json()
  assert.equal(draft.status, 201, JSON.stringify(body))

  const selfPublish = await request(`/api/admin/privacy-notices/${body.id}/publish`, { method: 'POST', json: {} }, adminCookie)
  assert.equal(selfPublish.status, 403)

  const published = await request(`/api/admin/privacy-notices/${body.id}/publish`, { method: 'POST', json: {} }, reviewerCookie)
  assert.equal(published.status, 200)

  const citizen = await (await request('/api/account/privacy-center/notices')).json()
  assert.equal(citizen.notices.some((notice) => notice.version === '2.0'), true)

  const duplicate = await request('/api/admin/privacy-notices', {
    json: { docType: 'privacy_policy', title: 'Duplicate', body: 'A duplicate version that should be refused by validation.', version: '2.0', language: 'en' },
  }, adminCookie)
  assert.equal(duplicate.status, 422)
})

test('privacy requests record corrections and stay owner-scoped', async () => {
  const missingCorrection = await request('/api/account/privacy-center/requests', {
    json: { category: 'correction', description: 'Please correct the spelling of my surname.' },
  })
  assert.equal(missingCorrection.status, 422)

  const access = await request('/api/account/privacy-center/requests', {
    json: { category: 'access', description: 'Please send me a copy of the data you hold about me.', requestedCategories: ['profile', 'applications'] },
  })
  const accessBody = await access.json()
  assert.equal(access.status, 201, JSON.stringify(accessBody))
  requestReference = accessBody.reference
  assert.match(accessBody.note, /not government decisions/i)

  const correction = await request('/api/account/privacy-center/requests', {
    json: {
      category: 'correction',
      description: 'My surname is misspelled in my profile.',
      correction: { field: 'last name', currentValue: 'Privocy', proposedValue: 'Privacy', explanation: 'Typo when registering' },
    },
  })
  assert.equal(correction.status, 201)

  const list = await (await request('/api/account/privacy-center/requests')).json()
  assert.equal(list.results.length, 2)
  assert.equal(list.results.find((row) => row.category === 'correction').correction.field, 'last name')

  const foreign = await (await request('/api/account/privacy-center/requests', {}, otherCookie)).json()
  assert.equal(foreign.results.length, 0)
})

test('administrators process privacy requests with recorded decisions', async () => {
  const pending = await (await request('/api/admin/records/privacy-requests', {}, adminCookie)).json()
  assert.equal(pending.results.some((row) => row.reference === requestReference), true)

  const decision = await request(`/api/admin/records/privacy-requests/${requestReference}`, {
    method: 'PATCH',
    json: { status: 'completed', note: 'Exported data sent through the account export.' },
  }, adminCookie)
  assert.equal(decision.status, 200)

  const mine = await (await request('/api/account/privacy-center/requests')).json()
  assert.equal(mine.results.find((row) => row.reference === requestReference).status, 'completed')

  const citizen = await request(`/api/admin/records/privacy-requests/${requestReference}`, { method: 'PATCH', json: { status: 'completed' } }, cookie)
  assert.equal(citizen.status, 403)
})

test('personal data exports contain only the caller’s data', async () => {
  const json = await request('/api/account/privacy-center/export', { method: 'POST', json: { format: 'json' } })
  assert.equal(json.status, 200)
  assert.match(json.headers.get('cache-control'), /no-store/)
  const payload = await json.json()
  assert.equal(payload.account.email, 'p4privacy-citizen@example.com')
  assert.equal(payload.documents.length, 1)
  assert.equal(JSON.stringify(payload).includes('p4privacy-other@example.com'), false)
  assert.match(payload.note, /Passwords, session tokens/i)

  const csv = await request('/api/account/privacy-center/export', { method: 'POST', json: { format: 'csv' } })
  assert.equal(csv.status, 200)
  assert.match(csv.headers.get('content-type'), /text\/csv/)
  const text = await csv.text()
  assert.match(text, /documents/)
})

test('sharing permissions can be reviewed and revoked', async () => {
  const sharing = await (await request('/api/account/privacy-center/sharing')).json()
  assert.equal(sharing.results.length, 1)
  assert.match(sharing.note, /does not claim to show every external access/i)

  const foreign = await request(`/api/account/privacy-center/sharing/${shareId}`, { method: 'DELETE' }, otherCookie)
  assert.equal(foreign.status, 404)

  const revoke = await request(`/api/account/privacy-center/sharing/${shareId}`, { method: 'DELETE' })
  assert.equal(revoke.status, 200)
  const after = await (await request('/api/account/privacy-center/sharing')).json()
  assert.equal(after.results[0].revoked_at !== null, true)
})

test('temporary deactivation can be reversed and is not deletion', async () => {
  const deactivate = await request('/api/account/privacy-center/deactivate', { method: 'POST', json: { confirm: true, reason: 'Taking a break' } })
  assert.equal(deactivate.status, 200)
  assert.match((await deactivate.json()).message, /not a deletion/i)

  const again = await request('/api/account/privacy-center/deactivate', { method: 'POST', json: { confirm: true } })
  assert.equal(again.status, 422)

  const reactivate = await request('/api/account/privacy-center/reactivate', { method: 'POST', json: {} })
  assert.equal(reactivate.status, 200)

  const center = await (await request('/api/account/privacy-center')).json()
  assert.equal(center.profile.accountStatus, 'active')
})

test('privacy incidents are internal to authorised staff', async () => {
  const created = await request('/api/admin/privacy-incidents', {
    json: { description: 'A test log contained an unexpected email address during development.', severity: 'low' },
  }, adminCookie)
  assert.equal(created.status, 201, await created.text())

  const citizen = await request('/api/admin/privacy-incidents', {}, cookie)
  assert.equal([401, 403].includes(citizen.status), true)

  const list = await (await request('/api/admin/privacy-incidents', {}, adminCookie)).json()
  assert.match(list.note, /does not claim any incident was reported/i)
  assert.equal(list.results.length, 1)
})

test('privacy analytics use stored request timestamps', async () => {
  const analytics = await (await request('/api/admin/privacy/analytics', {}, adminCookie)).json()
  assert.equal(analytics.requests.total >= 2, true)
  assert.equal(analytics.requests.completed >= 1, true)
  assert.match(analytics.note, /stored request timestamps/i)

  const denied = await request('/api/admin/privacy/analytics', {}, cookie)
  assert.equal([401, 403].includes(denied.status), true)
})

test('unauthenticated callers get no privacy data', async () => {
  for (const pathname of ['/api/account/privacy-center', '/api/account/privacy-center/sharing', '/api/account/privacy-center/requests']) {
    const response = await request(pathname, {}, '')
    assert.equal(response.status, 401, pathname)
  }
})
