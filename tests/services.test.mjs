/**
 * Phase 2 — Government Services Directory tests.
 *
 * Runs against a throwaway SQLite database. Two accounts are seeded directly
 * (a super administrator and a Mogpog municipal administrator) so that role
 * and municipality scoping can be exercised through the real HTTP API.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4601
const BASE = `http://127.0.0.1:${PORT}`
const ORIGIN = BASE
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-services-'))
const DB_PATH = path.join(DB_DIR, 'test.db')

let child
let adminCookie = ''
let citizenCookie = ''
let mogpogCookie = ''
let service = null
let boacServiceId = null

async function waitForServer(attempts = 80) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return
    } catch {
      /* not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('API did not become ready in time')
}

async function request(pathname, { cookie = '', method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json', Origin: ORIGIN }
  if (cookie) headers.Cookie = cookie
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let payload = null
  const text = await response.text()
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  return { status: response.status, body: payload, headers: response.headers }
}

async function login(email, password) {
  const response = await request('/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(response.status, 200, `login failed for ${email}: ${JSON.stringify(response.body)}`)
  return (response.headers.get('set-cookie') || '').split(';')[0]
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      DATABASE_PATH: DB_PATH,
      API_PORT: String(PORT),
      SESSION_SECRET: 'test-secret-value-that-is-long-enough-for-hmac',
      DEV_EXPOSE_VERIFICATION_LINKS: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
  })
  await waitForServer()

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const password = 'Marinduque#Services2026'
  const hash = bcrypt.hashSync(password, 10)
  const insertUser = db.prepare(
    `INSERT INTO users (name, email, password_hash, email_verified_at, account_status, created_at)
     VALUES (?, ?, ?, datetime('now'), 'active', datetime('now'))`,
  )
  const userId = (email, name) => Number(insertUser.run(name, email, hash).lastInsertRowid)
  const roleId = (slug) => Number(db.prepare(`SELECT id FROM user_roles WHERE slug = ?`).get(slug).id)
  const assign = db.prepare(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, ?, ?, 'active')`,
  )

  const adminId = userId('services-admin@example.com', 'Services Admin')
  const citizenId = userId('services-citizen@example.com', 'Services Citizen')
  const mogpogId = userId('mogpog-admin@example.com', 'Mogpog Admin')

  assign.run(adminId, roleId('super_admin'), 'global', null)
  assign.run(citizenId, roleId('citizen'), 'global', null)
  const mogpogMunicipality = db.prepare(`SELECT id FROM municipalities WHERE slug = 'mogpog'`).get()
  assign.run(mogpogId, roleId('municipal_admin'), 'municipality', Number(mogpogMunicipality.id))
  db.close()

  adminCookie = await login('services-admin@example.com', password)
  citizenCookie = await login('services-citizen@example.com', password)
  mogpogCookie = await login('mogpog-admin@example.com', password)
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('category hierarchy exposes 25 parent groups with subcategories', async () => {
  const response = await request('/api/services/categories')
  assert.equal(response.status, 200)
  assert.equal(response.body.results.length, 25, 'expected exactly 25 parent categories')
  assert.ok(response.body.flat.length >= 230, 'expected the full subcategory structure')
  const slugs = response.body.flat.map((category) => category.slug)
  assert.equal(new Set(slugs).size, slugs.length, 'category slugs must be unique')
  for (const parent of response.body.results) {
    assert.ok(parent.children.length > 0, `${parent.name} should have subcategories`)
  }
})

test('published directory starts empty (no fabricated service records)', async () => {
  const response = await request('/api/services')
  assert.equal(response.status, 200)
  assert.equal(response.body.total, 0)
  assert.equal(response.body.facets.categories.length >= 25, true)
})

test('anonymous and citizen users cannot create service records', async () => {
  const anonymous = await request('/api/admin/services', { method: 'POST', body: { title: 'Nope' } })
  assert.equal(anonymous.status, 401)
  const citizen = await request('/api/admin/services', { cookie: citizenCookie, method: 'POST', body: { title: 'Nope' } })
  assert.equal(citizen.status, 403)
})

test('invalid category references are rejected', async () => {
  const response = await request('/api/admin/services', {
    cookie: adminCookie,
    method: 'POST',
    body: { title: 'Invalid category service', category_id: 999999 },
  })
  assert.equal(response.status, 422)
})

test('administrator creates a draft service record', async () => {
  const categories = await request('/api/services/categories')
  const health = categories.body.flat.find((category) => category.slug === 'health-medical')
  assert.ok(health, 'health category should exist')
  const response = await request('/api/admin/services', {
    cookie: adminCookie,
    method: 'POST',
    body: {
      title: 'Medical assistance information (test record)',
      category_id: health.id,
      short_description: 'A non-production record used to verify the service workflow.',
      description: 'Created by the automated test suite against a throwaway database.',
      eligibility: 'Test eligibility text.',
      service_scope: 'province_wide',
      availability_status: 'needs_confirmation',
      source_reference: 'Test fixture, not a real government record',
    },
  })
  assert.equal(response.status, 201, JSON.stringify(response.body))
  assert.equal(response.body.record.publication_status, 'draft')
  assert.equal(response.body.record.verification_status, 'pending')
  service = response.body.record
})

test('nested requirements, fees, processing, documents, FAQs and coverage can be managed', async () => {
  const id = service.id
  const requirement = await request(`/api/admin/services/${id}/requirements`, {
    cookie: adminCookie,
    method: 'POST',
    body: { requirement_name: 'Valid identification (test)', description: 'Any government-issued ID', is_required: true },
  })
  assert.equal(requirement.status, 201, JSON.stringify(requirement.body))

  const fee = await request(`/api/admin/services/${id}/fees`, {
    cookie: adminCookie,
    method: 'POST',
    body: { fee_name: 'Test fee', amount: '25.50', fee_type: 'fixed', conditions: 'Test only' },
  })
  assert.equal(fee.status, 201, JSON.stringify(fee.body))
  const feeList = await request(`/api/admin/services/${id}/fees`, { cookie: adminCookie })
  assert.equal(feeList.body.results[0].amount_cents, 2550, 'money is stored in centavos')

  const negative = await request(`/api/admin/services/${id}/fees`, {
    cookie: adminCookie,
    method: 'POST',
    body: { fee_name: 'Bad fee', amount: '-3' },
  })
  assert.equal(negative.status, 422)

  const processing = await request(`/api/admin/services/${id}/processing`, {
    cookie: adminCookie,
    method: 'POST',
    body: { processing_time: '3–5', processing_unit: 'working days' },
  })
  assert.equal(processing.status, 201)

  const document = await request(`/api/admin/services/${id}/documents`, {
    cookie: adminCookie,
    method: 'POST',
    body: { document_title: 'Test form', document_type: 'form', external_url: 'https://example.gov.ph/form' },
  })
  assert.equal(document.status, 201)

  const unsafeDocument = await request(`/api/admin/services/${id}/documents`, {
    cookie: adminCookie,
    method: 'POST',
    body: { document_title: 'Unsafe link', external_url: 'javascript:alert(1)' },
  })
  assert.equal(unsafeDocument.status, 422)

  const faq = await request(`/api/admin/services/${id}/faqs`, {
    cookie: adminCookie,
    method: 'POST',
    body: { question: 'Is this a real service?', answer: 'No. This record exists only in the test database.' },
  })
  assert.equal(faq.status, 201)

  const boac = (await request('/api/lookups')).body.municipalities.find((m) => m.slug === 'boac')
  const coverage = await request(`/api/admin/services/${id}/coverage`, {
    cookie: adminCookie,
    method: 'POST',
    body: { municipality_id: boac.id, availability_status: 'in_person_required', local_instructions: 'Test coverage' },
  })
  assert.equal(coverage.status, 201, JSON.stringify(coverage.body))
  const duplicate = await request(`/api/admin/services/${id}/coverage`, {
    cookie: adminCookie,
    method: 'POST',
    body: { municipality_id: boac.id },
  })
  assert.equal(duplicate.status, 400, 'duplicate coverage is rejected')
})

test('verification requires an identified source', async () => {
  const missing = await request(`/api/admin/services/${service.id}/verify`, {
    cookie: adminCookie,
    method: 'POST',
    body: { verification_status: 'verified', source_reference: '', source_url: '' },
  })
  assert.equal(missing.status, 400)

  const source = await request('/api/admin/service-sources', {
    cookie: adminCookie,
    method: 'POST',
    body: {
      name: 'Test fixture source',
      organization: 'Automated test suite',
      url: 'https://example.gov.ph/test-source',
      document_reference: 'TEST-001',
    },
  })
  assert.equal(source.status, 201, JSON.stringify(source.body))

  const verified = await request(`/api/admin/services/${service.id}/verify`, {
    cookie: adminCookie,
    method: 'POST',
    body: { verification_status: 'verified', source_id: source.body.id, next_review_at: '2027-01-01' },
  })
  assert.equal(verified.status, 200, JSON.stringify(verified.body))
  assert.equal(verified.body.record.verification_status, 'verified')
  assert.ok(verified.body.record.verified_at)
})

test('draft records are never exposed publicly', async () => {
  const list = await request('/api/services')
  assert.equal(list.body.total, 0)
  const detail = await request(`/api/services/${service.slug}`)
  assert.equal(detail.status, 404)
  const requirements = await request(`/api/services/${service.id}/requirements`)
  assert.equal(requirements.status, 404)
})

test('workflow moves the record through review to publication', async () => {
  for (const status of ['submitted_for_review', 'approved', 'published']) {
    const response = await request(`/api/admin/services/${service.id}/status`, {
      cookie: adminCookie,
      method: 'POST',
      body: { status, note: `Test transition to ${status}` },
    })
    assert.equal(response.status, 200, `${status}: ${JSON.stringify(response.body)}`)
  }
  const detail = await request(`/api/admin/services/${service.id}`, { cookie: adminCookie })
  assert.equal(detail.body.record.publication_status, 'published')
  assert.ok(detail.body.record.published_at)
  assert.ok(detail.body.revisions.length >= 1, 'revision history is recorded')
  assert.ok(detail.body.workflow.length >= 3, 'workflow history is recorded')
})

test('invalid workflow jumps are rejected', async () => {
  const response = await request(`/api/admin/services/${service.id}/status`, {
    cookie: adminCookie,
    method: 'POST',
    body: { status: 'draft' },
  })
  assert.equal(response.status, 400)
})

test('published service appears in the directory, detail page and facets', async () => {
  const list = await request('/api/services?q=medical')
  assert.equal(list.status, 200)
  assert.equal(list.body.total, 1)
  assert.equal(list.body.results[0].slug, service.slug)

  const detail = await request(`/api/services/${service.slug}`)
  assert.equal(detail.status, 200)
  assert.equal(detail.body.requirements.length, 1)
  assert.equal(detail.body.fees.length, 1)
  assert.equal(detail.body.coverage.length, 1)
  assert.equal(detail.body.faqs.length, 1)
  assert.equal(detail.body.service.verification_status, 'verified')

  const byCategory = await request('/api/services?category=health-medical')
  assert.equal(byCategory.body.total, 1)
  const byMunicipality = await request('/api/services?municipality=boac')
  assert.equal(byMunicipality.body.total, 1)
  const otherMunicipality = await request('/api/services?municipality=mogpog')
  assert.equal(otherMunicipality.body.total, 1, 'province-wide services remain visible everywhere')
})

test('service search matches requirement text and expands Filipino terms', async () => {
  const requirementMatch = await request('/api/services?q=identification')
  assert.equal(requirementMatch.body.total, 1)
  // "tulong" expands to assistance-related terms; it must not error or leak drafts.
  const taglish = await request('/api/services?q=tulong')
  assert.equal(taglish.status, 200)
  assert.ok(Array.isArray(taglish.body.results))
})

test('municipal administrators cannot edit records outside their municipality', async () => {
  const forbidden = await request(`/api/admin/services/${service.id}`, {
    cookie: mogpogCookie,
    method: 'PATCH',
    body: { short_description: 'Out of scope change' },
  })
  assert.equal(forbidden.status, 403)

  const adminList = await request('/api/admin/services', { cookie: mogpogCookie })
  assert.equal(adminList.status, 200)
  assert.equal(adminList.body.total, 0, 'the Boac-covered province service is outside Mogpog scope')
})

test('citizen favourites and moderated feedback work end to end', async () => {
  const saved = await request(`/api/services/${service.slug}/favorite`, { cookie: citizenCookie, method: 'POST' })
  assert.equal(saved.status, 201, JSON.stringify(saved.body))
  const savedAgain = await request(`/api/services/${service.slug}/favorite`, { cookie: citizenCookie, method: 'POST' })
  assert.equal(savedAgain.status, 200, 'saving twice is idempotent')

  const anonymousFeedback = await request(`/api/services/${service.slug}/feedback`, {
    method: 'POST',
    body: { rating: 5, comment: 'This should require authentication.' },
  })
  assert.equal(anonymousFeedback.status, 401)

  const feedback = await request(`/api/services/${service.slug}/feedback`, {
    cookie: citizenCookie,
    method: 'POST',
    body: { rating: 4, comment: 'The requirements list was clear in this test fixture.' },
  })
  assert.equal(feedback.status, 201, JSON.stringify(feedback.body))

  const duplicate = await request(`/api/services/${service.slug}/feedback`, {
    cookie: citizenCookie,
    method: 'POST',
    body: { rating: 5, comment: 'A second submission on the same day.' },
  })
  assert.equal(duplicate.status, 429)

  const publicBefore = await request(`/api/services/${service.slug}/feedback`)
  assert.equal(publicBefore.body.results.length, 0, 'pending feedback is not public')

  const queue = await request('/api/admin/service-feedback?status=pending', { cookie: adminCookie })
  assert.equal(queue.body.results.length, 1)
  assert.equal(queue.body.results[0].comment.includes('@'), false, 'no account details are exposed')

  const moderation = await request(`/api/admin/service-feedback/${queue.body.results[0].id}`, {
    cookie: adminCookie,
    method: 'PATCH',
    body: { status: 'approved', is_public: true },
  })
  assert.equal(moderation.status, 200)

  const publicAfter = await request(`/api/services/${service.slug}/feedback`)
  assert.equal(publicAfter.body.results.length, 1)
  assert.equal(publicAfter.body.summary.total, 1)
})

test('service import validates rows and only creates drafts', async () => {
  const invalid = await request('/api/admin/services/import', {
    cookie: adminCookie,
    method: 'POST',
    body: { rows: [{ service_name: 'Unknown category row', category: 'does-not-exist' }] },
  })
  assert.equal(invalid.status, 200)
  assert.equal(invalid.body.valid, 0)
  assert.ok(invalid.body.results[0].errors.length > 0)

  const valid = await request('/api/admin/services/import', {
    cookie: adminCookie,
    method: 'POST',
    body: {
      dry_run: true,
      rows: [{ service_name: 'Imported draft (test)', category: 'health-medical', source_url: 'https://example.gov.ph/import' }],
    },
  })
  assert.equal(valid.body.valid, 1)
  assert.equal(valid.body.dry_run, true)

  const created = await request('/api/admin/services/import', {
    cookie: adminCookie,
    method: 'POST',
    body: {
      dry_run: false,
      rows: [{ service_name: 'Imported draft (test)', category: 'health-medical', source_url: 'https://example.gov.ph/import' }],
    },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.equal(created.body.created, 1)

  const publicList = await request('/api/services')
  assert.equal(publicList.body.total, 1, 'imported drafts are not published')
})

test('developer API exposes published records only and documents itself', async () => {
  const meta = await request('/api/v1/meta')
  assert.equal(meta.status, 200)
  assert.equal(meta.body.version, 'v1')

  const services = await request('/api/v1/services')
  assert.equal(services.body.meta.total, 1)
  assert.ok(services.body.data.every((row) => row.slug !== 'imported-draft-test'))

  const detail = await request(`/api/v1/services/${service.slug}`)
  assert.equal(detail.status, 200)
  assert.ok(detail.body.data.requirements.length >= 1)

  const openapi = await request('/api/openapi.json')
  assert.equal(openapi.status, 200)
  assert.ok(openapi.body.paths['/v1/services'])

  const suggestions = await request('/api/search/suggest?q=health')
  assert.equal(suggestions.status, 200)
  assert.ok(suggestions.body.categories.length > 0)
})

test('category management enforces permissions and rejects circular parents', async () => {
  const citizen = await request('/api/admin/service-categories', { cookie: citizenCookie })
  assert.equal(citizen.status, 403)

  const created = await request('/api/admin/service-categories', {
    cookie: adminCookie,
    method: 'POST',
    body: { name: 'Test category (automated)', description: 'Temporary test category' },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))

  const selfParent = await request(`/api/admin/service-categories/${created.body.id}`, {
    cookie: adminCookie,
    method: 'PATCH',
    body: { parent_id: created.body.id },
  })
  assert.equal(selfParent.status, 400)

  const archived = await request(`/api/admin/service-categories/${created.body.id}`, {
    cookie: adminCookie,
    method: 'DELETE',
  })
  assert.equal(archived.status, 200)
})

test('global search covers service categories, forms and service FAQs', async () => {
  const category = await request('/api/search?q=health&category=categories')
  assert.equal(category.status, 200)
  assert.ok(
    category.body.results.some((row) => row.category === 'categories' && row.url.startsWith('/services/category/')),
    'category matches must link to the category page',
  )

  const form = await request('/api/search?q=Test%20form&category=resources')
  assert.equal(form.status, 200)
  assert.ok(
    form.body.results.some((row) => row.category === 'resources' && row.url.includes('#documents')),
    'form matches must link to the service documents section',
  )

  const faq = await request('/api/search?q=real%20service&category=service_faqs')
  assert.equal(faq.status, 200)
  assert.ok(
    faq.body.results.some((row) => row.category === 'service_faqs' && row.url.includes('#faqs')),
    'service FAQ matches must link to the FAQ section',
  )

  const suggestion = await request('/api/search/suggest?q=health')
  assert.equal(suggestion.status, 200)
  assert.ok(suggestion.body.groups.categories.length > 0)
  assert.ok(suggestion.body.suggestions.every((item) => item.url && item.category))
})

test('archiving removes a service from public access without deleting it', async () => {
  const archive = await request(`/api/admin/services/${service.id}`, { cookie: adminCookie, method: 'DELETE' })
  assert.equal(archive.status, 200)
  const detail = await request(`/api/services/${service.slug}`)
  assert.equal(detail.status, 404)
  const adminDetail = await request(`/api/admin/services/${service.id}`, { cookie: adminCookie })
  assert.equal(adminDetail.status, 200)
  assert.equal(adminDetail.body.record.publication_status, 'archived')
})
