/**
 * Phase 5 — financial transparency foundation, budget explorer, module records,
 * verification workflow, municipality scoping and import validation.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4669
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p5-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let adminCookie = ''
let scopedCookie = ''
const created = []

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return
    } catch { /* not up */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('API did not become ready')
}

function request(pathname, options = {}, as = '') {
  const headers = { Accept: 'application/json', Origin: BASE, ...(options.headers || {}) }
  if (as) headers.Cookie = as
  if (options.json) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(options.json)
  }
  return fetch(`${BASE}${pathname}`, { method: options.method || (options.body ? 'POST' : 'GET'), headers, body: options.body })
}

const login = async (email) => {
  const response = await request('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })
  assert.equal(response.status, 200, await response.text())
  return (response.headers.get('set-cookie') || '').split(';')[0]
}

const record = (overrides = {}) => ({
  recordType: 'budget',
  title: 'Annual budget appropriation — health',
  description: 'Encoded from the published annual budget document.',
  governmentLevel: 'municipal',
  municipalityId: 1,
  fiscalYear: 2025,
  periodType: 'annual',
  periodLabel: 'FY 2025',
  categoryKey: 'health',
  officialClassification: 'Health, Nutrition and Population Control',
  department: 'Municipal Health Office',
  amountCents: 1250000000,
  currency: 'PHP',
  amountKind: 'approved',
  sourceInstitution: 'Municipality of Boac',
  sourceTitle: 'Annual Budget FY 2025',
  sourceUrl: 'https://example.gov.ph/boac/budget-2025.pdf',
  sourcePublishedOn: '2025-01-15',
  limitations: 'Encoded from the published PDF; verify against the printed copy.',
  ...overrides,
})

async function createRecord(payload, as = adminCookie) {
  const response = await request('/api/admin/transparency/finance/records', { json: payload }, as)
  return { status: response.status, body: await response.json() }
}

async function transition(id, action, note, as = adminCookie) {
  return request(`/api/admin/transparency/finance/records/${id}/transition`, { json: { action, note } }, as)
}

async function publish(id) {
  for (const action of ['submit', 'review', 'verify', 'approve', 'publish']) {
    const response = await transition(id, action)
    assert.equal(response.status, 200, `${action}: ${await response.clone().text()}`)
  }
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_PATH: DB_PATH, API_PORT: String(PORT), SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac', NODE_ENV: 'test' },
    stdio: 'ignore',
  })
  await waitForServer()
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const globalAdmin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Finance Admin', 'p5-admin@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const scopedAdmin = Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES ('Mogpog Finance Admin', 'p5-scoped@example.com', ?, datetime('now'), 'active')`).run(hash).lastInsertRowid)
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(globalAdmin, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scopedAdmin, municipalRole)
  db.close()
  adminCookie = await login('p5-admin@example.com')
  scopedCookie = await login('p5-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('public portal starts empty and never invents data', async () => {
  const overview = await (await request('/api/transparency/finance/overview')).json()
  assert.equal(overview.totals.published, 0)
  assert.equal(overview.counts.budget, 0)
  assert.match(overview.note, /never as zero/i)
  assert.match(overview.note, /independent civic platform/i)
  assert.ok(Object.keys(overview.modules).length >= 17)

  const budgets = await (await request('/api/transparency/finance/budgets')).json()
  assert.match(budgets.note, /missing categories are not zero/i)
  assert.equal(budgets.records.length, 0)

  const categories = await (await request('/api/transparency/finance/categories')).json()
  assert.ok(categories.categories.length >= 14)
  assert.ok(categories.categories.some((row) => row.key === 'health'))
})

test('records need source, review and approval before publication', async () => {
  const draft = await createRecord(record({ sourceTitle: '', sourceInstitution: '' }))
  assert.equal(draft.status, 201, JSON.stringify(draft.body))
  created.push(draft.body.record.id)
  assert.equal(draft.body.record.status, 'draft')
  assert.match(draft.body.message, /not public/i)

  assert.equal((await request(`/api/transparency/finance/records/${draft.body.record.reference}`)).status, 404)
  const early = await transition(draft.body.record.id, 'submit')
  assert.equal(early.status, 422)

  const updated = await request(`/api/admin/transparency/finance/records/${draft.body.record.id}`, {
    method: 'PUT',
    json: record(),
  }, adminCookie)
  assert.equal(updated.status, 200, await updated.clone().text())

  const publishNow = await transition(draft.body.record.id, 'publish')
  assert.equal(publishNow.status, 422, 'cannot publish straight from draft')

  await publish(draft.body.record.id)
  const detail = await request(`/api/transparency/finance/records/${draft.body.record.reference}`)
  assert.equal(detail.status, 200)
  const body = await detail.json()
  assert.equal(body.record.amountCents, 1250000000)
  assert.equal(body.record.amountKind, 'approved')
  assert.equal(body.record.source.title, 'Annual Budget FY 2025')
  assert.equal(body.record.categoryLabel, 'Health')
  assert.match(body.note, /not an official certification/i)
  assert.ok(!JSON.stringify(body).includes('change_note'))
})

test('public filters, pagination and module coverage work', async () => {
  const byType = await (await request('/api/transparency/finance/records?type=budget&year=2025&municipality=boac&category=health')).json()
  assert.equal(byType.total, 1)
  assert.equal(byType.results[0].entity.slug, 'boac')

  const wrong = await (await request('/api/transparency/finance/records?type=procurement')).json()
  assert.equal(wrong.total, 0)

  const coverage = await (await request('/api/transparency/finance/coverage')).json()
  const boac = coverage.coverage.find((row) => row.entity.slug === 'boac')
  assert.equal(boac.modules.budget, 1)
  assert.equal(boac.modules.procurement, 0)
  assert.match(coverage.note, /does not mean the government spent or received nothing/i)
})

test('budget explorer separates amount kinds and compares only real years', async () => {
  const older = await createRecord(record({ fiscalYear: 2024, periodLabel: 'FY 2024', amountCents: 1000000000 }))
  assert.equal(older.status, 201, JSON.stringify(older.body))
  await publish(older.body.record.id)

  const proposed = await createRecord(record({ recordType: 'budget', amountKind: 'proposed', amountCents: 1400000000, title: 'Proposed budget — health' }))
  assert.equal(proposed.status, 201)
  await publish(proposed.body.record.id)

  const view = await (await request('/api/transparency/finance/budgets?municipality=boac')).json()
  assert.equal(view.selected.slug, 'boac')
  const approved2025 = view.allocations.find((row) => row.amountKind === 'approved' && row.fiscalYear === 2025)
  assert.equal(approved2025.totalCents, 1250000000)
  assert.ok(view.allocations.some((row) => row.amountKind === 'proposed' && row.fiscalYear === 2025))
  const comparison = view.comparisons.find((row) => row.category === 'health' && row.amountKind === 'approved')
  assert.equal(comparison.previousCents, 1000000000)
  assert.equal(comparison.currentCents, 1250000000)
  assert.equal(comparison.percentageChange, 25)
  assert.ok(view.records.every((row) => row.entity.slug === 'boac'))

  const other = await (await request('/api/transparency/finance/budgets?municipality=mogpog')).json()
  assert.equal(other.records.length, 0)
  assert.ok(other.entities.some((row) => row.slug === 'mogpog' && row.publishedBudgets === 0))
})

test('municipal administrators are limited to their municipality', async () => {
  const foreign = await request(`/api/admin/transparency/finance/records/${created[0]}`, { method: 'PUT', json: record() }, scopedCookie)
  assert.equal(foreign.status, 404)
  const foreignTransition = await transition(created[0], 'correction', 'Not my municipality', scopedCookie)
  assert.equal(foreignTransition.status, 404)

  const scopedView = await (await request('/api/admin/transparency/finance', {}, scopedCookie)).json()
  assert.ok(scopedView.records.every((row) => row.entity.municipalityId === 2 || row.entity.municipalityId === null))

  const own = await createRecord(record({ municipalityId: 2, title: 'Mogpog health appropriation', amountCents: 300000000 }), scopedCookie)
  assert.equal(own.status, 201, JSON.stringify(own.body))
  const wrongScope = await createRecord(record({ municipalityId: 1, title: 'Boac record from Mogpog admin' }), scopedCookie)
  assert.equal(wrongScope.status, 403, 'cross-municipality creation is refused')
})

test('reporting periods and imports validate and stay private until published', async () => {
  const period = await request('/api/admin/transparency/finance/periods', {
    json: { governmentLevel: 'municipal', municipalityId: 1, fiscalYear: 2025, periodType: 'annual', periodLabel: 'FY 2025', startsOn: '2025-01-01', endsOn: '2025-12-31' },
  }, adminCookie)
  assert.equal(period.status, 201, await period.clone().text())
  const duplicate = await request('/api/admin/transparency/finance/periods', {
    json: { governmentLevel: 'municipal', municipalityId: 1, fiscalYear: 2025, periodType: 'annual', periodLabel: 'FY 2025' },
  }, adminCookie)
  assert.equal(duplicate.status, 422)

  const periods = await (await request('/api/transparency/finance/periods?municipality=boac')).json()
  assert.ok(periods.periods.some((row) => row.periodLabel === 'FY 2025'))

  const imported = await request('/api/admin/transparency/finance/imports', {
    json: {
      recordType: 'procurement',
      governmentLevel: 'municipal',
      municipalityId: 1,
      filename: 'procurement-2025.csv',
      rows: [
        record({ recordType: undefined, title: 'Supply of medical equipment', categoryKey: 'health', amountCents: 250000000, amountKind: 'contract', department: 'Procurement Office' }),
        record({ recordType: undefined, title: 'Duplicate of the same row', categoryKey: 'health', amountCents: 250000000, amountKind: 'contract', department: 'Procurement Office' }),
        record({ recordType: undefined, title: 'Invalid category row', categoryKey: 'not_a_category', amountCents: 1, amountKind: 'contract' }),
      ],
    },
  }, adminCookie)
  assert.equal(imported.status, 201, await imported.clone().text())
  const importBody = await imported.json()
  assert.equal(importBody.import.accepted, 1)
  assert.equal(importBody.import.rejected, 2)
  assert.match(importBody.message, /drafts/i)

  const publicProcurement = await (await request('/api/transparency/finance/records?type=procurement')).json()
  assert.equal(publicProcurement.total, 0, 'imported drafts are not public')
})

test('correction removes a record from public until it is fixed and republished', async () => {
  const correction = await transition(created[0], 'correction', 'Amount differs from the printed document by PHP 1,000.')
  assert.equal(correction.status, 200, await correction.clone().text())

  const list = await (await request('/api/transparency/finance/records?type=budget')).json()
  assert.ok(!list.results.some((row) => row.id === created[0]))

  const versions = await (await request(`/api/admin/transparency/finance/records/${created[0]}/versions`, {}, adminCookie)).json()
  assert.ok(versions.versions.length >= 2)

  const adminQueue = await (await request('/api/admin/transparency/finance', {}, adminCookie)).json()
  assert.match(adminQueue.note, /Drafts and reviewer notes are never public/i)

  assert.equal((await request('/api/admin/transparency/finance')).status, 401)
})

test('specialist fields persist for loans, assets, procurement, payroll, tax and land', async () => {
  const loan = await createRecord(record({
    recordType: 'loan',
    title: 'Infrastructure loan — repayment schedule',
    amountCents: 5000000000,
    amountKind: 'balance',
    principalCents: 5000000000,
    outstandingBalanceCents: 3250000000,
    interestRate: 6.25,
    maturityDate: '2032-12-31',
    termStart: '2025-01-01',
    termEnd: '2032-12-31',
    identifier: 'LOAN-2025-001',
    arrangement: 'LGU guarantee recorded in the loan agreement.',
    stage: 'repayment',
    counterparty: 'Land Bank of the Philippines',
    categoryKey: 'infrastructure',
  }))
  assert.equal(loan.status, 201, JSON.stringify(loan.body))
  await publish(loan.body.record.id)

  const loanDetail = await (await request(`/api/transparency/finance/records/${loan.body.record.reference}`)).json()
  assert.equal(loanDetail.record.specialist.interestRate, 6.25)
  assert.equal(loanDetail.record.specialist.outstandingBalanceCents, 3250000000)
  assert.equal(loanDetail.record.specialist.maturityDate, '2032-12-31')
  assert.equal(loanDetail.record.specialist.identifier, 'LOAN-2025-001')
  assert.equal(loanDetail.record.specialist.stage, 'repayment')
  assert.equal(loanDetail.record.specialist.arrangement, 'LGU guarantee recorded in the loan agreement.')

  const asset = await createRecord(record({
    recordType: 'asset',
    title: 'Municipal health centre building',
    categoryKey: 'health',
    amountKind: 'valuation',
    amountCents: 880000000,
    identifier: 'ASSET-BLDG-014',
    location: 'Barangay Poblacion, Boac',
    quantity: 450,
    quantityLabel: 'square metres',
    termStart: '2019-06-15',
  }))
  assert.equal(asset.status, 201, JSON.stringify(asset.body))
  await publish(asset.body.record.id)
  const assetDetail = await (await request(`/api/transparency/finance/records/${asset.body.record.reference}`)).json()
  assert.equal(assetDetail.record.specialist.identifier, 'ASSET-BLDG-014')
  assert.equal(assetDetail.record.specialist.location, 'Barangay Poblacion, Boac')
  assert.equal(assetDetail.record.specialist.quantity, 450)
  assert.equal(assetDetail.record.specialist.quantityLabel, 'square metres')
  assert.equal(assetDetail.record.specialist.termStart, '2019-06-15')

  const procurement = await createRecord(record({
    recordType: 'procurement',
    title: 'Supply of medical equipment — contract',
    amountCents: 250000000,
    amountKind: 'contract',
    categoryKey: 'health',
    identifier: 'CONTRACT-2025-017',
    stage: 'awarded',
    termStart: '2025-03-01',
    termEnd: '2025-09-30',
    counterparty: 'Sample Supplier Corporation',
  }))
  assert.equal(procurement.status, 201, JSON.stringify(procurement.body))
  assert.equal(procurement.body.record.specialist.identifier, 'CONTRACT-2025-017')
  assert.equal(procurement.body.record.specialist.stage, 'awarded')

  const payroll = await createRecord(record({
    recordType: 'payroll',
    title: 'Personnel expenditure — aggregate',
    amountCents: 4200000000,
    categoryKey: 'local_administration',
    quantity: 142,
    quantityLabel: 'personnel',
    stage: 'annual aggregate',
  }))
  assert.equal(payroll.status, 201, JSON.stringify(payroll.body))
  assert.equal(payroll.body.record.specialist.quantity, 142)

  const tax = await createRecord(record({
    recordType: 'tax',
    title: 'Business tax assessment and collection — aggregate',
    amountCents: 910000000,
    amountKind: 'assessed',
    categoryKey: 'economic_development',
    rateDescription: 'Graduated rates under the local revenue code.',
    assessmentBasis: 'Gross receipts declared by registered businesses.',
    quantity: 318,
    quantityLabel: 'registered taxpayers',
  }))
  assert.equal(tax.status, 201, JSON.stringify(tax.body))
  assert.equal(tax.body.record.specialist.rateDescription, 'Graduated rates under the local revenue code.')

  const land = await createRecord(record({
    recordType: 'land',
    title: 'Public land transaction record',
    amountCents: 150000000,
    amountKind: 'valuation',
    categoryKey: 'infrastructure',
    identifier: 'PARCEL-04-112',
    titleNumber: 'OCT-11245',
    location: 'Barangay Tabi, Boac',
    quantity: 1200,
    quantityLabel: 'square metres',
    stage: 'recorded transaction',
  }))
  assert.equal(land.status, 201, JSON.stringify(land.body))
  assert.equal(land.body.record.specialist.titleNumber, 'OCT-11245')

  const missingLandId = await createRecord(record({ recordType: 'land', title: 'Land record without any identifier', categoryKey: 'infrastructure' }))
  assert.equal(missingLandId.status, 422)

  const badRate = await createRecord(record({ recordType: 'loan', title: 'Loan with an implausible rate', categoryKey: 'infrastructure', interestRate: 150 }))
  assert.ok([422, 400].includes(badRate.status))

  const badDates = await createRecord(record({ recordType: 'procurement', title: 'Contract with reversed dates', categoryKey: 'health', termStart: '2025-12-01', termEnd: '2025-01-01' }))
  assert.equal(badDates.status, 422)
})
