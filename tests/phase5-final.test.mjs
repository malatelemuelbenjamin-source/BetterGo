/**
 * Phase 5 final integration — Prompts 110–115.
 * Monitoring, report builder/exports, open data, alerts, community moderation,
 * municipality scoping, publication gates and public discovery.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4671
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p5f-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let adminCookie = ''
let scopedCookie = ''
let citizenCookie = ''
let otherCookie = ''
const state = { recordReference: null, finding: null, threadReference: null, datasetSlug: null, reportPublicId: null }

async function waitForServer() {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return } catch { /* not up */ }
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

async function login(email) {
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

async function createRecord(payload = record(), as = adminCookie) {
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
  const addUser = (name, email) => Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES (?, ?, ?, datetime('now'), 'active')`).run(name, email, hash).lastInsertRowid)
  const admin = addUser('Phase 5 Admin', 'p5f-admin@example.com')
  const scoped = addUser('Mogpog Admin', 'p5f-scoped@example.com')
  addUser('Citizen One', 'p5f-citizen@example.com')
  addUser('Citizen Two', 'p5f-other@example.com')
  const role = (slug) => db.prepare(`SELECT id FROM user_roles WHERE slug = ?`).get(slug).id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(admin, role('super_admin'))
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scoped, role('municipal_admin'))
  db.close()
  adminCookie = await login('p5f-admin@example.com')
  scopedCookie = await login('p5f-scoped@example.com')
  citizenCookie = await login('p5f-citizen@example.com')
  otherCookie = await login('p5f-other@example.com')

  const first = await createRecord()
  assert.equal(first.status, 201, JSON.stringify(first.body))
  state.recordReference = first.body.record.reference
  await publish(first.body.record.id)
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('public Phase 5 surfaces start empty with honest disclaimers', async () => {
  const monitoring = await (await request('/api/transparency/financial-monitoring/overview')).json()
  assert.equal(monitoring.totals.published, 0)
  assert.match(monitoring.note, /not official COA findings/i)
  assert.match(monitoring.note, /independent civic technology platform/i)

  const reports = await (await request('/api/transparency/reports/templates')).json()
  assert.ok(reports.templates.length >= 12)
  assert.ok(reports.templates.every((template) => template.officialGovernmentPublication === false))

  const openData = await (await request('/api/transparency/open-data/overview')).json()
  assert.equal(openData.total, 0)
  assert.match(openData.note, /no licence is implied/i)

  const alerts = await (await request('/api/transparency/alerts/catalog')).json()
  assert.ok(alerts.topics.some((topic) => topic.key === 'budget'))
  assert.equal(alerts.channels.sms, false)

  const community = await (await request('/api/transparency/community/overview')).json()
  assert.equal(community.counts.questions, 0)
  assert.match(community.note, /not official government statements/i)

  const quality = await (await request('/api/transparency/data-quality')).json()
  assert.equal(quality.totals.published, 1)
  assert.match(quality.disclaimer, /not an official audit/i)
})

test('monitoring detects a documentation condition and stays private until human approval', async () => {
  const db = new DatabaseSync(DB_PATH)
  db.prepare(`UPDATE financial_records SET source_title = NULL WHERE reference = ?`).run(state.recordReference)
  db.close()

  const run = await request('/api/admin/transparency/financial-monitoring/run', { json: {} }, adminCookie)
  assert.equal(run.status, 200, await run.clone().text())
  const runBody = await run.json()
  assert.ok(runBody.created >= 1)

  const admin = await (await request('/api/admin/transparency/financial-monitoring', {}, adminCookie)).json()
  const finding = admin.findings.find((row) => row.recordReference === state.recordReference && row.ruleKey === 'missing_source')
  assert.ok(finding, 'missing source finding exists')
  assert.equal(finding.severity, 'high')
  state.finding = finding
  const publicBefore = await (await request('/api/transparency/financial-monitoring/findings')).json()
  assert.equal(publicBefore.total, 0)

  assert.equal((await request(`/api/admin/transparency/financial-monitoring/findings/${finding.id}`, { method: 'PATCH', json: { action: 'approve', note: '' } }, adminCookie)).status, 422)
  const approve = await request(`/api/admin/transparency/financial-monitoring/findings/${finding.id}`, { method: 'PATCH', json: { action: 'approve', note: 'Checked the original document and confirmed that the source title is absent.' } }, adminCookie)
  assert.equal(approve.status, 200, await approve.clone().text())
  assert.equal((await request(`/api/admin/transparency/financial-monitoring/findings/${finding.id}`, { method: 'PATCH', json: { action: 'publish', note: '' } }, adminCookie)).status, 200)

  const publicAfter = await (await request('/api/transparency/financial-monitoring/findings')).json()
  assert.equal(publicAfter.total, 1)
  assert.equal(publicAfter.results[0].label, 'Supporting document unavailable')
  assert.match(publicAfter.results[0].description, /does not name both a source institution/i)
  assert.ok(!JSON.stringify(publicAfter).includes('p5f-admin@example.com'))

  const analytics = await (await request('/api/transparency/financial-monitoring/analytics')).json()
  assert.equal(analytics.totals.published, 1)
  assert.ok(analytics.averageReviewHours === null || analytics.averageReviewHours >= 0)
  assert.match(analytics.note, /not corruption/i)
  const csvExport = await request('/api/transparency/financial-monitoring/findings/export?format=csv')
  assert.equal(csvExport.status, 200)
  assert.match(csvExport.headers.get('content-type'), /text\/csv/)
  assert.match(await csvExport.text(), /Finding reference/)

  const unauth = await request(`/api/admin/transparency/financial-monitoring/findings/${finding.id}`, { method: 'PATCH', json: { action: 'resolve', note: 'fixed' } })
  assert.equal(unauth.status, 401)
})

test('citizen observations are authenticated, private and never treated as findings automatically', async () => {
  const anonymous = await request('/api/transparency/financial-monitoring/observations', { json: { recordReference: state.recordReference, description: 'The published source document appears to be missing from the portal page.' } })
  assert.equal(anonymous.status, 401)

  const personal = await request('/api/transparency/financial-monitoring/observations', { json: { recordReference: state.recordReference, description: 'Contact me at citizen@example.com about this record please.' } }, citizenCookie)
  assert.equal(personal.status, 422)

  const submitted = await request('/api/transparency/financial-monitoring/observations', { json: { recordReference: state.recordReference, description: 'The published source document appears to be missing from the portal page. Please compare it with the record.' } }, citizenCookie)
  assert.equal(submitted.status, 201, await submitted.clone().text())
  const body = await submitted.json()
  assert.match(body.message, /does not establish/i)
  assert.ok(body.observation.reference)

  const mine = await (await request('/api/transparency/financial-monitoring/observations/mine', {}, citizenCookie)).json()
  assert.equal(mine.results.length, 1)

  const admin = await (await request('/api/admin/transparency/financial-monitoring', {}, adminCookie)).json()
  const observation = admin.observations.find((row) => row.reference === body.observation.reference)
  assert.ok(observation)
  assert.match(observation.submitter, /Identity restricted/i)
  assert.ok(!JSON.stringify(admin.observations).includes('citizen@example.com'))

  const publicFindings = await (await request('/api/transparency/financial-monitoring/findings')).json()
  assert.ok(!JSON.stringify(publicFindings).includes(body.observation.reference))
})

test('report preview separates amount stages and states formulas and limitations', async () => {
  const expenditure = await createRecord(record({ recordType: 'expenditure', title: 'Actual health expenditure', amountKind: 'actual', amountCents: 500000000 }))
  assert.equal(expenditure.status, 201, JSON.stringify(expenditure.body))
  await publish(expenditure.body.record.id)
  const proposed = await createRecord(record({ title: 'Proposed health budget', amountKind: 'proposed', amountCents: 1400000000 }))
  assert.equal(proposed.status, 201)
  await publish(proposed.body.record.id)

  const response = await request('/api/transparency/reports/preview', { json: { filters: { entity: 'boac', year: 2025 }, sections: ['summary', 'budget', 'expenditure', 'sources', 'methodology'] } })
  assert.equal(response.status, 200, await response.clone().text())
  const { report } = await response.json()
  assert.equal(report.counts.records, 3)
  const approved = report.calculations.find((row) => row.key === 'approved_budget')
  assert.equal(approved.valuePeso, 12500000)
  assert.match(approved.formula, /proposed and adjusted amounts are excluded/i)
  const actual = report.calculations.find((row) => row.key === 'actual_expenditure')
  assert.equal(actual.valuePeso, 5000000)
  const utilization = report.calculations.find((row) => row.key === 'budget_utilization')
  assert.equal(utilization.valuePercent, 40)
  assert.ok(report.calculations.every((row) => row.formula && row.source && row.calculatedAt && row.limitations))
  assert.ok(report.disclaimers.some((line) => /not an official government reporting/i.test(line)))
  assert.ok(!JSON.stringify(report).includes('source_title')) // internal field names are not leaked

  const empty = await (await request('/api/transparency/reports/preview', { json: { filters: { entity: 'mogpog', year: 2025 }, sections: ['summary'] } })).json()
  assert.equal(empty.report.counts.records, 0)
  assert.equal(empty.report.calculations[0].valueCents, null)
})

test('saved reports respect ownership, shared links and export only published fields', async () => {
  const anonymousSave = await request('/api/transparency/reports/save', { json: { title: 'Anonymous report', filters: {}, sections: ['summary'] } })
  assert.equal(anonymousSave.status, 401)

  const saved = await request('/api/transparency/reports/save', { json: { title: 'Boac health report', description: 'Health budget and actual expenditure.', filters: { entity: 'boac', year: 2025 }, sections: ['summary', 'budget', 'expenditure', 'sources', 'methodology'] } }, citizenCookie)
  assert.equal(saved.status, 201, await saved.clone().text())
  const config = (await saved.json()).config
  state.reportPublicId = config.publicId
  assert.ok(!config.shareUrl)

  const hidden = await request(`/api/transparency/reports/shared/${config.publicId}`)
  assert.equal(hidden.status, 404)

  const shared = await request(`/api/transparency/reports/saved/${config.publicId}`, { method: 'PATCH', json: { shared: true } }, citizenCookie)
  assert.equal(shared.status, 200, await shared.clone().text())
  const publicView = await request(`/api/transparency/reports/shared/${config.publicId}`)
  assert.equal(publicView.status, 200)
  const publicBody = await publicView.json()
  assert.equal(publicBody.report.title, 'Boac health report')
  assert.ok(!JSON.stringify(publicBody).includes('p5f-citizen@example.com'))
  assert.ok(!JSON.stringify(publicBody).includes('reviewer'))

  const generated = await request(`/api/transparency/reports/saved/${config.publicId}/generate`, { json: {} }, citizenCookie)
  assert.equal(generated.status, 201, await generated.clone().text())
  const generatedBody = await generated.json()
  assert.equal(generatedBody.report.counts.records, 3)

  const other = await request(`/api/transparency/reports/saved/${config.publicId}/export?format=csv`, {}, otherCookie)
  assert.equal(other.status, 404)

  const csv = await request(`/api/transparency/reports/saved/${config.publicId}/export?format=csv`, {}, citizenCookie)
  assert.equal(csv.status, 200)
  assert.match(csv.headers.get('content-type'), /text\/csv/)
  const csvText = await csv.text()
  assert.match(csvText, /Record reference/)
  assert.ok(!csvText.includes('p5f-citizen@example.com'))

  const xlsx = await request(`/api/transparency/reports/saved/${config.publicId}/export?format=xlsx`, {}, citizenCookie)
  assert.equal(xlsx.status, 200)
  assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString(), 'PK')

  const pdf = await request(`/api/transparency/reports/saved/${config.publicId}/export?format=pdf`, {}, citizenCookie)
  assert.equal(pdf.status, 200)
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF')

  const jsonExport = await (await request(`/api/transparency/reports/saved/${config.publicId}/export?format=json`, {}, citizenCookie)).json()
  assert.ok(Array.isArray(jsonExport.rows))
  assert.ok(jsonExport.rows.every((row) => row.reference && row.amountKind))
})

test('open data blocks sensitive fields or unverified sources and keeps versions', async () => {
  const base = {
    title: 'Boac health budget dataset',
    description: 'Published health budget and actual expenditure records for Boac in fiscal year 2025.',
    category: 'budget',
    entityLevel: 'municipal',
    municipalityId: 1,
    periodLabel: 'FY 2025',
    fiscalYear: 2025,
    sourceInstitution: 'Municipality of Boac',
    sourceReference: 'Annual Budget FY 2025',
    verificationStatus: 'verified',
    dataDictionary: [{ key: 'reference', label: 'Record reference', type: 'text', description: 'Public record reference.' }],
    recordTypes: ['budget'],
  }
  const sensitive = await request('/api/admin/transparency/open-data', { json: { ...base, title: 'Sensitive dataset', dataDictionary: [{ key: 'taxpayer_id', label: 'Taxpayer ID', type: 'text' }] } }, adminCookie)
  assert.equal(sensitive.status, 422)

  const pending = await request('/api/admin/transparency/open-data', { json: { ...base, title: 'Pending dataset', verificationStatus: 'pending' } }, adminCookie)
  assert.equal(pending.status, 201, await pending.clone().text())
  const pendingSlug = (await pending.json()).dataset.slug
  const refused = await request(`/api/admin/transparency/open-data/${pendingSlug}/publish`, { json: {} }, adminCookie)
  assert.equal(refused.status, 422)
  assert.match((await refused.json()).error, /verified/i)

  const created = await request('/api/admin/transparency/open-data', { json: base }, adminCookie)
  assert.equal(created.status, 201, await created.clone().text())
  const dataset = (await created.json()).dataset
  state.datasetSlug = dataset.slug
  assert.equal(dataset.status, 'draft')
  assert.equal((await request(`/api/transparency/open-data/datasets/${dataset.slug}`)).status, 404)

  const published = await request(`/api/admin/transparency/open-data/${dataset.slug}/publish`, { json: {} }, adminCookie)
  assert.equal(published.status, 200, await published.clone().text())

  const publicDetail = await (await request(`/api/transparency/open-data/datasets/${dataset.slug}`)).json()
  assert.equal(publicDetail.dataset.status, 'published')
  assert.equal(publicDetail.versions.length, 1)
  assert.ok(publicDetail.preview.results.some((row) => row.reference === state.recordReference))
  assert.equal(publicDetail.preview.total, 2)
  assert.match(publicDetail.dataset.licenseStatus, /No licence recorded/i)

  const csv = await request(`/api/transparency/open-data/datasets/${dataset.slug}/download?format=csv`)
  assert.equal(csv.status, 200)
  const csvText = await csv.text()
  assert.match(csvText, /Record reference/)
  assert.match(csvText, /Municipality of Boac/)
  assert.ok(!csvText.includes('citizen@example.com'))

  const analytics = await (await request('/api/transparency/open-data/downloads')).json()
  assert.ok(analytics.totals.downloads >= 1)
  assert.ok(analytics.note.includes('No user identity'))

  const scoped = await request('/api/admin/transparency/open-data', { json: { ...base, title: 'Mogpog cannot create Boac dataset' } }, scopedCookie)
  assert.equal(scoped.status, 403)

  const updated = await request(`/api/admin/transparency/open-data/${dataset.slug}`, { method: 'PATCH', json: { description: 'Updated description with verified source detail.' } }, adminCookie)
  assert.equal(updated.status, 200, await updated.clone().text())
  const updateBody = await updated.json()
  assert.equal(updateBody.dataset.status, 'draft')
  assert.equal(updateBody.dataset.version, 2)
  assert.equal((await request(`/api/transparency/open-data/datasets/${dataset.slug}`)).status, 404)
})

test('alerts follow published events, deduplicate and isolate each citizen history', async () => {
  const subscribe = await request('/api/transparency/alerts/subscriptions', { json: { topic: 'budget', municipalityId: 1 } }, citizenCookie)
  assert.equal(subscribe.status, 201, await subscribe.clone().text())
  const createdSubscription = await subscribe.json()
  const duplicate = await request('/api/transparency/alerts/subscriptions', { json: { topic: 'budget', municipalityId: 1 } }, citizenCookie)
  assert.equal(duplicate.status, 200)
  assert.equal((await duplicate.json()).subscription.id, createdSubscription.subscription.id)

  const fresh = await createRecord(record({ title: 'Approved health budget — second entry', amountCents: 900000000, department: 'Municipal Health Office II' }))
  assert.equal(fresh.status, 201, JSON.stringify(fresh.body))
  await publish(fresh.body.record.id)

  const overview = await (await request('/api/transparency/alerts', {}, citizenCookie)).json()
  assert.ok(overview.recent.length >= 1)
  assert.ok(overview.recent.every((row) => row.status === 'delivered'))
  assert.equal(overview.recent[0].channel, 'in_app')

  const history = await (await request('/api/transparency/alerts/history', {}, citizenCookie)).json()
  assert.ok(history.results.length >= 1)
  assert.ok(history.results.some((row) => /budget/i.test(row.title)))

  const isolated = await (await request('/api/transparency/alerts/history', {}, otherCookie)).json()
  assert.equal(isolated.results.length, 0)

  const preferences = await request('/api/transparency/alerts/preferences', { method: 'PUT', json: { frequency: 'weekly', quietStart: '22:00', quietEnd: '06:00', timezone: 'Asia/Manila' } }, citizenCookie)
  assert.equal(preferences.status, 200, await preferences.clone().text())
  const prefBody = await preferences.json()
  assert.equal(prefBody.preferences.frequency, 'weekly')
  assert.equal(prefBody.preferences.quietStart, '22:00')

  const digest = await (await request('/api/transparency/alerts/digest?frequency=weekly', {}, citizenCookie)).json()
  assert.ok(digest.count >= 1)
  assert.ok(digest.groups.length >= 1)

  const invalid = await request('/api/transparency/alerts/subscriptions', { json: { topic: 'not-a-topic' } }, citizenCookie)
  assert.equal(invalid.status, 422)
})

test('community submissions are moderated, private until published and screened for personal data', async () => {
  const pii = await request('/api/transparency/community/threads', {
    json: { kind: 'question', title: 'Who approved this budget entry?', body: 'Please email me at citizen@example.com. I want to understand the published health budget approval for 2025.', topicSlug: 'budget-basics', municipalityId: 1 },
  }, citizenCookie)
  assert.equal(pii.status, 422)

  const created = await request('/api/transparency/community/threads', {
    json: { kind: 'question', title: 'Who approved the published health budget?', body: 'I am reading the published health budget record for 2025 and want to understand which office approved it. The record links a public source document.', topicSlug: 'budget-basics', municipalityId: 1, recordReference: state.recordReference, sourceUrl: 'https://example.gov.ph/boac/budget-2025.pdf', sourceTitle: 'Annual Budget FY 2025' },
  }, citizenCookie)
  assert.equal(created.status, 201, await created.clone().text())
  const thread = (await created.json()).thread
  state.threadReference = thread.reference
  assert.equal(thread.status, 'pending_review')

  const publicBefore = await (await request('/api/transparency/community/threads?kind=question')).json()
  assert.equal(publicBefore.total, 0)

  const admin = await (await request('/api/admin/transparency/community', {}, adminCookie)).json()
  const pending = admin.threads.find((row) => row.reference === thread.reference)
  assert.ok(pending)
  assert.ok(!JSON.stringify(admin).includes('p5f-citizen@example.com'))
  assert.match(pending.author, /Citizen One|Community member/)

  const scopedPublish = await request(`/api/admin/transparency/community/threads/${pending.id}`, { method: 'PATCH', json: { action: 'publish' } }, scopedCookie)
  assert.ok([403, 404].includes(scopedPublish.status), 'scoped moderator cannot publish a Boac thread')

  const published = await request(`/api/admin/transparency/community/threads/${pending.id}`, { method: 'PATCH', json: { action: 'publish' } }, adminCookie)
  assert.equal(published.status, 200, await published.clone().text())

  const list = await (await request('/api/transparency/community/threads?kind=question')).json()
  assert.equal(list.total, 1)
  const detail = await (await request(`/api/transparency/community/threads/${thread.reference}`)).json()
  assert.equal(detail.thread.reference, thread.reference)
  assert.equal(detail.thread.sources[0].verificationStatus, 'unverified')
  assert.match(detail.thread.sources[0].verificationLabel, /not verified/i)

  const answer = await request(`/api/transparency/community/threads/${thread.reference}/posts`, { json: { body: 'The published record names the municipal health office; the source document is linked on the record page.' } }, otherCookie)
  assert.equal(answer.status, 201, await answer.clone().text())
  const answerId = (await answer.json()).post.id
  const adminPost = await request('/api/admin/transparency/community', {}, adminCookie).then((r) => r.json())
  const postThread = adminPost.threads.find((row) => row.reference === thread.reference)
  const post = postThread.posts.find((row) => row.id === answerId)
  assert.equal(post.status, 'pending_review')
  const approveAnswer = await request(`/api/admin/transparency/community/posts/${answerId}`, { method: 'PATCH', json: { action: 'publish' } }, adminCookie)
  assert.equal(approveAnswer.status, 200, await approveAnswer.clone().text())
  const answered = await (await request(`/api/transparency/community/threads/${thread.reference}`)).json()
  assert.equal(answered.posts.length, 1)
  assert.ok(answered.thread.answered)

  const report = await request('/api/transparency/community/reports', { json: { targetType: 'thread', targetId: pending.id, reason: 'other', details: 'The answer cites a document but the question might need more context.' } }, otherCookie)
  assert.equal(report.status, 201, await report.clone().text())
  const reportBody = await report.json()
  const reports = await (await request('/api/admin/transparency/community', {}, adminCookie)).json()
  const reportRow = reports.reports.find((row) => row.reference === reportBody.reference)
  assert.ok(reportRow)

  const hide = await request(`/api/admin/transparency/community/threads/${pending.id}`, { method: 'PATCH', json: { action: 'hide', note: 'Need to clarify the source before this remains public.' } }, adminCookie)
  assert.equal(hide.status, 200)
  assert.equal((await request(`/api/transparency/community/threads/${thread.reference}`)).status, 404)

  const appeal = await request('/api/transparency/community/appeals', { json: { targetType: 'thread', targetId: pending.id, reason: 'The source link is public and the question follows the guidelines, so I would like a moderator to review the decision.' } }, citizenCookie)
  assert.equal(appeal.status, 201, await appeal.clone().text())
  const appealId = (await (await request('/api/admin/transparency/community', {}, adminCookie)).json()).appeals[0].id
  const accept = await request(`/api/admin/transparency/community/appeals/${appealId}`, { method: 'PATCH', json: { action: 'accept', note: 'Reviewed the public source and restored the discussion.' } }, adminCookie)
  assert.equal(accept.status, 200, await accept.clone().text())
  assert.equal((await request(`/api/transparency/community/threads/${thread.reference}`)).status, 200)
})

test('municipality scoping hides unrelated moderation queues and blocks scoped publication', async () => {
  const scopedQueue = await (await request('/api/admin/transparency/community', {}, scopedCookie)).json()
  assert.ok(!scopedQueue.threads.some((row) => row.reference === state.threadReference), 'Boac thread is not in the Mogpog queue')
  const scopedDatasets = await (await request('/api/admin/transparency/open-data', {}, scopedCookie)).json()
  assert.ok(!scopedDatasets.datasets.some((row) => row.slug === state.datasetSlug))

  const scopedReports = await (await request('/api/admin/transparency/reports', {}, scopedCookie)).json()
  assert.equal(scopedReports.configs.length, 1, 'shared configuration is visible without owner email')
  assert.ok(!JSON.stringify(scopedReports).includes('p5f-citizen@example.com'))
})

test('public APIs remain read-only and private administrative data is not exposed', async () => {
  const publicWrite = await request('/api/transparency/financial-monitoring/findings', { json: { description: 'x' } })
  assert.ok([404, 405, 401].includes(publicWrite.status))
  const adminWithoutAuth = await request('/api/admin/transparency/financial-monitoring')
  assert.equal(adminWithoutAuth.status, 401)
  const citizenAdmin = await request('/api/admin/transparency/reports', {}, citizenCookie)
  assert.equal(citizenAdmin.status, 403)

  const reports = await (await request('/api/transparency/reports/preview', { json: { filters: {}, sections: ['summary'] } })).json()
  assert.ok(!JSON.stringify(reports).includes('p5f-admin@example.com'))
  assert.ok(!JSON.stringify(reports).includes('moderation_note'))
})

test('data-quality, robots and sitemap support public discovery without indexing private pages', async () => {
  const integration = await (await request('/api/admin/transparency/integration', {}, adminCookie)).json()
  assert.equal(integration.phase, 5)
  assert.ok(integration.checks.length >= 6)
  assert.ok(integration.checks.every((check) => typeof check.ok === 'boolean' && check.detail))
  assert.match(integration.readiness, /not production-launch-ready/i)

  const robots = await (await request('/robots.txt')).text()
  assert.match(robots, /Disallow: \/admin/)
  assert.match(robots, /Sitemap:/)

  const sitemap = await (await request('/sitemap.xml')).text()
  assert.match(sitemap, /\/transparency\/reports/)
  assert.match(sitemap, /\/transparency\/open-data/)
  assert.match(sitemap, /\/transparency\/financial-monitoring\/boac/)
  assert.ok(!sitemap.includes('/admin'))
  assert.ok(sitemap.includes(state.recordReference))

  const missing = await request('/api/transparency/open-data/datasets/not-a-dataset')
  assert.equal(missing.status, 404)
})
