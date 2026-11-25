/**
 * Prompt 75 — fee information, payment foundation, signed provider callbacks,
 * idempotency, ownership and fee approval workflow.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4635
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4pay-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'
const SECRET = 'sandbox-only-provider-secret'

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
const ids = {}
let transactionId = null
let transactionReference = null

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
    json: { firstName, lastName: 'Payer', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
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
      PAYMENT_PROVIDER_DEMO_SECRET: SECRET,
    },
    stdio: 'ignore',
  })
  await waitForServer()
  await register('p4pay-citizen@example.com', 'Citizen')
  await register('p4pay-other@example.com', 'Other')

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const category = db.prepare(`SELECT id FROM service_categories LIMIT 1`).get()
  const makeService = (title, slug, municipalityId = 1) =>
    Number(db.prepare(
      `INSERT INTO government_services (title, slug, category_id, municipality_id, service_scope, publication_status, published_at, availability_status)
       VALUES (?, ?, ?, ?, 'municipal', 'published', datetime('now'), 'needs_confirmation')`,
    ).run(title, slug, category.id, municipalityId).lastInsertRowid)
  ids.fixedService = makeService('Fixed fee service', 'p4-fee-fixed')
  ids.freeService = makeService('Free service', 'p4-fee-free')
  ids.variableService = makeService('Variable fee service', 'p4-fee-variable')
  ids.unknownService = makeService('Unknown fee service', 'p4-fee-unknown')
  ids.otherService = makeService('Mogpog fee service', 'p4-fee-mogpog', 2)
  db.prepare(`INSERT INTO service_fees (service_id, fee_name, fee_type, amount_cents, fee_description, source_title, source_url, review_status, verified_at) VALUES (?, 'Processing fee', 'fixed', 2500, 'Processing fee', 'Ordinance 2024-01', 'https://example.gov.ph/fees', 'approved', datetime('now'))`).run(ids.fixedService)
  db.prepare(`INSERT INTO service_fees (service_id, fee_name, fee_type, fee_description, source_title, review_status, verified_at) VALUES (?, 'No charge', 'free', 'No charge', 'Ordinance 2024-02', 'approved', datetime('now'))`).run(ids.freeService)
  db.prepare(`INSERT INTO service_fees (service_id, fee_name, fee_type, fee_description, source_title, review_status, verified_at) VALUES (?, 'Depends on document type', 'variable', 'Depends on document type', 'Ordinance 2024-03', 'approved', datetime('now'))`).run(ids.variableService)
  db.prepare(`INSERT INTO payment_methods (slug, name, method_type, status, instructions) VALUES ('cash', 'Over the counter', 'instructions', 'instructions_only', 'Pay at the municipal treasurer window.')`).run()
  db.prepare(`INSERT INTO payment_methods (slug, name, method_type, provider, status) VALUES ('demo-online', 'Demo gateway', 'gateway', 'demo', 'provider_configured')`).run()
  db.prepare(`INSERT INTO payment_methods (slug, name, method_type, provider, status) VALUES ('offline-wallet', 'Unconfigured wallet', 'e_wallet', 'wallet', 'provider_configured')`).run()
  db.close()

  cookie = await login('p4pay-citizen@example.com')
  otherCookie = await login('p4pay-other@example.com')

  const db2 = new DatabaseSync(DB_PATH)
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const admin = Number(db2.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Pay Admin', 'p4pay-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scoped = Number(db2.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Pay Admin', 'p4pay-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db2.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db2.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db2.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, superRole)
  db2.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, municipalRole)
  db2.close()

  adminCookie = await login('p4pay-admin@example.com')
  scopedCookie = await login('p4pay-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

const sign = (reference, status, providerReference) => crypto.createHmac('sha256', SECRET).update(`${reference}:${status}:${providerReference}`).digest('hex')

test('fee information distinguishes free, fixed, variable and unknown', async () => {
  const fixed = await (await request('/api/account/payments/services/p4-fee-fixed')).json()
  assert.equal(fixed.fee.amount, 25)
  assert.equal(fixed.fee.amountLabel, 'PHP 25.00')
  assert.equal(fixed.fee.sourceUrl, 'https://example.gov.ph/fees')

  const free = await (await request('/api/account/payments/services/p4-fee-free')).json()
  assert.equal(free.feeLabel, 'Confirmed free of charge')
  assert.equal(free.fee.amount, null)

  const variable = await (await request('/api/account/payments/services/p4-fee-variable')).json()
  assert.equal(variable.feeLabel, 'Variable or conditional fee')

  const unknown = await (await request('/api/account/payments/services/p4-fee-unknown')).json()
  assert.equal(unknown.fee, null)
  assert.match(unknown.feeLabel, /unavailable/i)
  assert.match(unknown.note, /not .*zero|Confirm the fee/i)
})

test('payment methods report configuration honestly', async () => {
  const center = await (await request('/api/account/payments')).json()
  const demo = center.methods.find((method) => method.slug === 'demo-online')
  const offline = center.methods.find((method) => method.slug === 'offline-wallet')
  assert.equal(demo.operational, true)
  assert.equal(offline.operational, false)
  assert.equal(JSON.stringify(center).includes(SECRET), false)
})

test('payment requests refuse unsafe or unverified cases', async () => {
  const cases = [
    { serviceSlug: 'p4-fee-unknown', methodSlug: 'cash', expected: 422 },
    { serviceSlug: 'p4-fee-free', methodSlug: 'cash', expected: 422 },
    { serviceSlug: 'p4-fee-variable', methodSlug: 'cash', expected: 422 },
    { serviceSlug: 'p4-fee-fixed', methodSlug: 'offline-wallet', expected: 422 },
  ]
  for (const entry of cases) {
    const response = await request('/api/account/payments/requests', { json: { serviceSlug: entry.serviceSlug, methodSlug: entry.methodSlug } })
    assert.equal(response.status, entry.expected, entry.serviceSlug)
  }
})

test('a payment reference uses the approved server-side amount', async () => {
  const created = await request('/api/account/payments/requests', {
    json: { serviceSlug: 'p4-fee-fixed', methodSlug: 'demo-online', purpose: 'Permit fee', amount: 1 },
  })
  assert.equal(created.status, 201, await created.clone().text())
  const body = await created.json()
  assert.match(body.transaction.reference, /^BG-PAY-[A-Z2-9]{6}$/)
  assert.equal(body.transaction.amount, 25)
  assert.equal(body.transaction.status, 'pending_payment')
  assert.match(body.message, /not received|has not/i)
  transactionId = body.transaction.id
  transactionReference = body.transaction.reference
})

test('only a valid signed provider callback marks a transaction paid, once', async () => {
  const providerReference = 'DEMO-TX-1001'
  const unsigned = await request(`/api/payments/callback/demo`, { json: { reference: transactionReference, providerReference, status: 'paid', amount: 25 } }, '')
  assert.equal(unsigned.status, 401)

  const mismatch = await request('/api/payments/callback/demo', {
    json: { reference: transactionReference, providerReference, status: 'paid', amount: 1 },
    headers: { 'x-payment-signature': sign(transactionReference, 'paid', providerReference) },
  }, '')
  assert.equal(mismatch.status, 409)

  const db = new DatabaseSync(DB_PATH)
  const flagged = db.prepare(`SELECT status FROM payment_transactions WHERE id = ?`).get(transactionId)
  db.close()
  assert.equal(flagged.status, 'under_reconciliation')

  const second = await request('/api/account/payments/requests', { json: { serviceSlug: 'p4-fee-fixed', methodSlug: 'demo-online' } })
  const secondBody = await second.json()
  const reference = secondBody.transaction.reference
  const providerRef2 = 'DEMO-TX-1002'

  const paid = await request('/api/payments/callback/demo', {
    json: { reference, providerReference: providerRef2, status: 'paid', amount: 25 },
    headers: { 'x-payment-signature': sign(reference, 'paid', providerRef2) },
  }, '')
  assert.equal(paid.status, 200)
  assert.equal((await paid.json()).status, 'paid')

  const duplicate = await request('/api/payments/callback/demo', {
    json: { reference, providerReference: providerRef2, status: 'paid', amount: 25 },
    headers: { 'x-payment-signature': sign(reference, 'paid', providerRef2) },
  }, '')
  assert.equal(duplicate.status, 200)
  assert.equal((await duplicate.json()).alreadyProcessed, true)

  const history = await (await request('/api/account/payments/history?status=paid')).json()
  assert.equal(history.results.length, 1)
  assert.equal(history.results[0].providerReference, providerRef2)
})

test('unknown providers are reported as unconfigured', async () => {
  const response = await request('/api/payments/callback/unknown-provider', { json: { reference: transactionReference, providerReference: 'X-001', status: 'paid' } }, '')
  assert.equal(response.status, 503)
})

test('transactions are private to their owner and cancellable', async () => {
  assert.equal((await request(`/api/account/payments/${transactionId}`, {}, otherCookie)).status, 404)
  assert.equal((await request(`/api/account/payments/${transactionId}/summary`, {}, otherCookie)).status, 404)
  const cancelForeign = await request(`/api/account/payments/${transactionId}/cancel`, { method: 'POST', json: {} }, otherCookie)
  assert.equal(cancelForeign.status, 404)

  const fresh = await (await request('/api/account/payments/requests', { json: { serviceSlug: 'p4-fee-fixed', methodSlug: 'cash' } })).json()
  const own = fresh.transaction
  const cancelled = await request(`/api/account/payments/${own.id}/cancel`, { method: 'POST', json: {} })
  assert.equal(cancelled.status, 200)
  assert.equal((await cancelled.json()).transaction.status, 'cancelled')
})

test('administrators cannot mark transactions paid but can flag reconciliation', async () => {
  const cannotPay = await request(`/api/admin/payments/${transactionId}/resolve`, { method: 'POST', json: { status: 'paid', note: 'test' } }, adminCookie)
  assert.equal(cannotPay.status, 422)

  const paidRow = await (await request('/api/admin/payments?status=paid', {}, adminCookie)).json()
  assert.equal(paidRow.results.length, 1)
  const flag = await request(`/api/admin/payments/${paidRow.results[0].id}/reconcile`, { method: 'POST', json: { note: 'Check provider' } }, adminCookie)
  assert.equal(flag.status, 200)

  const resolve = await request(`/api/admin/payments/${paidRow.results[0].id}/resolve`, { method: 'POST', json: { status: 'failed', note: 'Provider reversed it' } }, adminCookie)
  assert.equal(resolve.status, 200)
  const resolved = await (await request('/api/account/payments/history?status=failed')).json()
  assert.equal(resolved.results.length, 1)
})

test('fee changes need review, a source and approval before publishing', async () => {
  const draft = await request('/api/admin/service-fees', {
    json: { serviceId: ids.otherService, feeType: 'fixed', amount: 30, feeDescription: 'New fee', sourceTitle: 'Ordinance 2026-04' },
  }, adminCookie)
  const draftBody = await draft.json()
  assert.equal(draft.status, 201, JSON.stringify(draftBody))
  const feeId = draftBody.id

  const earlyApprove = await request(`/api/admin/service-fees/${feeId}/approve`, { method: 'POST', json: {} }, adminCookie)
  assert.equal(earlyApprove.status, 422)

  const publicBefore = await (await request('/api/account/payments/services/p4-fee-mogpog')).json()
  assert.equal(publicBefore.fee, null)

  await request(`/api/admin/service-fees/${feeId}/submit-review`, { method: 'POST', json: {} }, adminCookie)
  const approved = await request(`/api/admin/service-fees/${feeId}/approve`, { method: 'POST', json: {} }, adminCookie)
  assert.equal(approved.status, 200)

  const publicAfter = await (await request('/api/account/payments/services/p4-fee-mogpog')).json()
  assert.equal(publicAfter.fee.amount, 30)

  const edit = await request(`/api/admin/service-fees/${feeId}`, { method: 'PATCH', json: { amount: 1 } }, adminCookie)
  assert.equal(edit.status, 422)

  const archive = await request(`/api/admin/service-fees/${feeId}/archive`, { method: 'POST', json: {} }, adminCookie)
  assert.equal(archive.status, 200)
  const hidden = await (await request('/api/account/payments/services/p4-fee-mogpog')).json()
  assert.equal(hidden.fee, null)
})

test('payment analytics count only provider-verified amounts and are role restricted', async () => {
  const analytics = await (await request('/api/admin/payments/analytics', {}, adminCookie)).json()
  assert.equal(analytics.totals.transactions >= 2, true)
  assert.equal(analytics.totals.providerConfirmedAmount >= 0, true)
  assert.equal(JSON.stringify(analytics).includes('p4pay-citizen@example.com'), false)
  assert.match(analytics.note, /not official government/i)

  const denied = await request('/api/admin/payments/analytics', {}, scopedCookie)
  assert.equal([401, 403].includes(denied.status), true)

  const reconciliation = await (await request('/api/admin/payments/reconciliation', {}, adminCookie)).json()
  assert.match(reconciliation.note, /never altered/i)
})

test('payment endpoints require authentication', async () => {
  assert.equal((await request('/api/account/payments', {}, '')).status, 401)
  assert.equal((await request('/api/account/payments/history', {}, '')).status, 401)
})
