/**
 * Phase 3, Prompt 43 — Municipal portal foundation tests.
 *
 * Runs against a throwaway SQLite database and exercises the real HTTP API:
 * the six portals, municipal-scoped content workflow, cross-municipality
 * denial, published-only public output and the read-only municipality API.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4602
const BASE = `http://127.0.0.1:${PORT}`
const ORIGIN = BASE
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-municipal-'))
const DB_PATH = path.join(DB_DIR, 'test.db')

let child
let adminCookie = ''
let boacCookie = ''
let mogpogCookie = ''
let citizenCookie = ''
let boacContentId = null
let mogpogDraftId = null

async function waitForServer(attempts = 80) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return
    } catch {
      /* not ready yet */
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
  const text = await response.text()
  let payload = null
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
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
  })
  await waitForServer()

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const password = 'Marinduque#Portal2026'
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

  const adminId = userId('portal-admin@example.com', 'Portal Admin')
  const boacId = userId('boac-admin@example.com', 'Boac Admin')
  const mogpogId = userId('mogpog-admin@example.com', 'Mogpog Admin')
  const citizenId = userId('portal-citizen@example.com', 'Portal Citizen')

  assign.run(adminId, roleId('super_admin'), 'global', null)
  assign.run(citizenId, roleId('citizen'), 'global', null)
  const boac = db.prepare(`SELECT id FROM municipalities WHERE slug = 'boac'`).get()
  const mogpog = db.prepare(`SELECT id FROM municipalities WHERE slug = 'mogpog'`).get()
  assign.run(boacId, roleId('municipal_admin'), 'municipality', Number(boac.id))
  assign.run(mogpogId, roleId('municipal_admin'), 'municipality', Number(mogpog.id))
  db.close()

  adminCookie = await login('portal-admin@example.com', password)
  boacCookie = await login('boac-admin@example.com', password)
  mogpogCookie = await login('mogpog-admin@example.com', password)
  citizenCookie = await login('portal-citizen@example.com', password)
})

after(() => {
  if (child) child.kill()
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('the six municipality portals exist with unique slugs', async () => {
  const { status, body } = await request('/api/municipal-portals')
  assert.equal(status, 200)
  assert.equal(body.total, 6)
  const slugs = body.results.map((row) => row.slug).sort()
  assert.deepEqual(slugs, ['boac', 'buenavista', 'gasan', 'mogpog', 'santa-cruz', 'torrijos'])
  assert.equal(new Set(slugs).size, 6)
  for (const portal of body.results) {
    assert.equal(typeof portal.metrics.content, 'number')
    assert.equal(portal.metrics.content, 0, 'no municipal content is seeded')
  }
})

test('all six portal routes respond and unknown slugs 404', async () => {
  for (const slug of ['boac', 'mogpog', 'gasan', 'buenavista', 'torrijos', 'santa-cruz']) {
    const { status, body } = await request(`/api/municipal-portals/${slug}`)
    assert.equal(status, 200, slug)
    assert.equal(body.municipality.slug, slug)
    assert.ok(body.municipality.name)
    assert.deepEqual(body.announcements, [])
  }
  assert.equal((await request('/api/municipal-portals/atlantis')).status, 404)
  assert.equal((await request('/api/v1/municipalities/atlantis')).status, 404)
})

test('municipal administrators can only create content for their own municipality', async () => {
  const boacPortal = (await request('/api/admin/municipal-portals', { cookie: adminCookie })).body.results.find(
    (row) => row.slug === 'boac',
  )
  const mogpogPortal = (await request('/api/admin/municipal-portals', { cookie: mogpogCookie })).body.results.find(
    (row) => row.slug === 'mogpog',
  )
  assert.ok(boacPortal && mogpogPortal)

  const created = await request('/api/admin/municipal-content', {
    cookie: boacCookie,
    method: 'POST',
    body: {
      title: 'Boac public notice test',
      content_type: 'notice',
      summary: 'A municipal public notice used by the automated test suite.',
      body: 'This record is created by the test suite and never published as real government information.',
      municipality_id: boacPortal.id,
      source_reference: 'Automated test fixture',
    },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  boacContentId = created.body.id
  assert.equal(created.body.record.publication_status, 'draft')

  const crossCreate = await request('/api/admin/municipal-content', {
    cookie: mogpogCookie,
    method: 'POST',
    body: { title: 'Cross municipality attempt', content_type: 'news', municipality_id: boacPortal.id },
  })
  assert.equal(crossCreate.status, 403, 'a municipality admin cannot create for another municipality')

  const citizenCreate = await request('/api/admin/municipal-content', {
    cookie: citizenCookie,
    method: 'POST',
    body: { title: 'Citizen attempt', content_type: 'news', municipality_id: boacPortal.id },
  })
  assert.equal(citizenCreate.status, 403)

  const anonymous = await request('/api/admin/municipal-content')
  assert.equal(anonymous.status, 401)
})

test('drafts never appear on public routes or in global search', async () => {
  const list = await request('/api/municipal-portals/boac/content?type=notice')
  assert.equal(list.status, 200)
  assert.equal(
    list.body.total,
    0,
    `draft leaked: ${JSON.stringify((list.body.results || []).map((row) => [row.title, row.publication_status]))}`,
  )

  const portal = await request('/api/municipal-portals/boac')
  assert.deepEqual(portal.body.content.notice, [])

  const search = await request('/api/search?q=Boac%20public%20notice%20test')
  assert.equal(
    search.body.results.filter((row) => row.category === 'municipal').length,
    0,
    `search leaked: ${JSON.stringify(search.body.results.filter((row) => row.category === 'municipal'))}`,
  )

  const api = await request('/api/v1/municipalities/boac/notices')
  assert.deepEqual(api.body.data, [])
})

test('municipal content follows the shared review and publication workflow', async () => {
  const submitted = await request(`/api/admin/municipal-content/${boacContentId}/status`, {
    cookie: boacCookie,
    method: 'POST',
    body: { status: 'submitted_for_review', note: 'Ready for review' },
  })
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body))

  // Workflow transitions cannot be skipped: submitted → published is invalid.
  const jump = await request(`/api/admin/municipal-content/${boacContentId}/status`, {
    cookie: adminCookie,
    method: 'POST',
    body: { status: 'published' },
  })
  assert.equal(jump.status, 400)

  for (const status of ['under_review', 'approved', 'published']) {
    const response = await request(`/api/admin/municipal-content/${boacContentId}/status`, {
      cookie: adminCookie,
      method: 'POST',
      body: { status, note: `Moved to ${status}` },
    })
    assert.equal(response.status, 200, `${status}: ${JSON.stringify(response.body)}`)
  }

  const published = await request('/api/municipal-portals/boac/content?type=notice')
  assert.equal(published.body.total, 1)
  assert.equal(published.body.results[0].title, 'Boac public notice test')

  const search = await request('/api/search?q=Boac%20public%20notice%20test')
  const hit = search.body.results.find((row) => row.category === 'municipal')
  assert.ok(hit, 'published municipal content is searchable')
  assert.equal(hit.url, '/municipalities/boac/news')

  const api = await request('/api/v1/municipalities/boac/notices')
  assert.equal(api.body.data.length, 1)
})

test('version history records edits and workflow transitions', async () => {
  const updated = await request(`/api/admin/municipal-content/${boacContentId}`, {
    cookie: boacCookie,
    method: 'PATCH',
    body: { summary: 'Updated summary for the review history test.', note: 'Summary clarified' },
  })
  assert.equal(updated.status, 200, JSON.stringify(updated.body))

  const revisions = await request(`/api/admin/municipal-content/${boacContentId}/revisions`, { cookie: adminCookie })
  assert.equal(revisions.status, 200)
  assert.ok(revisions.body.total >= 3, `expected workflow snapshots, got ${revisions.body.total}`)
  assert.ok(revisions.body.results.some((row) => row.change_summary === 'Summary clarified'))
})

test('cross-municipality reads and portal settings are denied', async () => {
  const read = await request(`/api/admin/municipal-content/${boacContentId}`, { cookie: mogpogCookie })
  assert.equal(read.status, 404, 'records outside scope are hidden, not merely forbidden')

  const boacPortal = (await request('/api/admin/municipal-portals', { cookie: adminCookie })).body.results.find(
    (row) => row.slug === 'boac',
  )
  const settings = await request(`/api/admin/municipal-portals/${boacPortal.id}`, {
    cookie: mogpogCookie,
    method: 'PATCH',
    body: { portal_title: 'Hijacked portal' },
  })
  assert.equal(settings.status, 403)

  const ownScope = await request('/api/admin/municipal-portals', { cookie: mogpogCookie })
  assert.equal(ownScope.body.total, 1)
  assert.equal(ownScope.body.results[0].slug, 'mogpog')
})

test('portal settings validate sources and are audited', async () => {
  const boacPortal = (await request('/api/admin/municipal-portals', { cookie: adminCookie })).body.results.find(
    (row) => row.slug === 'boac',
  )
  const invalid = await request(`/api/admin/municipal-portals/${boacPortal.id}`, {
    cookie: boacCookie,
    method: 'PATCH',
    body: { official_website: 'javascript:alert(1)' },
  })
  assert.equal(invalid.status, 400)

  // Verification is recorded with the source and stamps the verification date.
  const verified = await request(`/api/admin/municipal-portals/${boacPortal.id}`, {
    cookie: boacCookie,
    method: 'PATCH',
    body: { verification_status: 'verified', source_reference: 'Automated test fixture' },
  })
  assert.equal(verified.status, 200, JSON.stringify(verified.body))
  assert.equal(verified.body.municipality.verification_status, 'verified')
  assert.ok(verified.body.municipality.last_verified_at)

  const saved = await request(`/api/admin/municipal-portals/${boacPortal.id}`, {
    cookie: boacCookie,
    method: 'PATCH',
    body: { portal_title: 'Boac municipal portal (test)', source_reference: 'Automated test fixture' },
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  assert.equal(saved.body.municipality.portal_title, 'Boac municipal portal (test)')

  const workspace = await request(`/api/admin/municipal-portals/${boacPortal.id}`, { cookie: boacCookie })
  assert.ok(workspace.body.activity.some((row) => row.action === 'municipal.portal_updated'))
})

test('municipal staff roles are scoped and cannot publish on their own', async () => {
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync('Marinduque#Editor2026', 10)
  const insert = db.prepare(
    `INSERT INTO users (name, email, password_hash, email_verified_at, account_status, created_at)
     VALUES (?, ?, ?, datetime('now'), 'active', datetime('now'))`,
  )
  const editorId = Number(insert.run('Boac Editor', 'boac-editor@example.com', hash).lastInsertRowid)
  const reviewerId = Number(insert.run('Boac Reviewer', 'boac-reviewer@example.com', hash).lastInsertRowid)
  const boac = db.prepare(`SELECT id FROM municipalities WHERE slug = 'boac'`).get()
  const role = (slug) => Number(db.prepare(`SELECT id FROM user_roles WHERE slug = ?`).get(slug).id)
  const assign = db.prepare(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', ?, 'active')`,
  )
  assign.run(editorId, role('municipal_content_editor'), Number(boac.id))
  assign.run(reviewerId, role('municipal_reviewer'), Number(boac.id))
  db.close()

  const editorCookie = await login('boac-editor@example.com', 'Marinduque#Editor2026')
  const reviewerCookie = await login('boac-reviewer@example.com', 'Marinduque#Editor2026')

  const draft = await request('/api/admin/municipal-content', {
    cookie: editorCookie,
    method: 'POST',
    body: {
      title: 'Editor draft notice',
      content_type: 'news',
      municipality_id: Number(boac.id),
      source_reference: 'Automated test fixture',
    },
  })
  assert.equal(draft.status, 201, JSON.stringify(draft.body))

  const publishAttempt = await request(`/api/admin/municipal-content/${draft.body.id}/status`, {
    cookie: editorCookie,
    method: 'POST',
    body: { status: 'submitted_for_review' },
  })
  assert.equal(publishAttempt.status, 200)
  const directPublish = await request(`/api/admin/municipal-content/${draft.body.id}/status`, {
    cookie: editorCookie,
    method: 'POST',
    body: { status: 'published' },
  })
  assert.equal(directPublish.status, 400, 'an editor cannot publish directly')

  const review = await request(`/api/admin/municipal-content/${draft.body.id}/status`, {
    cookie: reviewerCookie,
    method: 'POST',
    body: { status: 'under_review' },
  })
  assert.equal(review.status, 200)
  const approve = await request(`/api/admin/municipal-content/${draft.body.id}/status`, {
    cookie: reviewerCookie,
    method: 'POST',
    body: { status: 'approved' },
  })
  assert.equal(approve.status, 200)
  const reviewerPublish = await request(`/api/admin/municipal-content/${draft.body.id}/status`, {
    cookie: reviewerCookie,
    method: 'POST',
    body: { status: 'published' },
  })
  assert.equal(reviewerPublish.status, 403, 'reviewers approve but do not publish')
})

test('public portal API is read-only and exposes only published records', async () => {
  const municipality = await request('/api/v1/municipalities/boac')
  assert.equal(municipality.status, 200)
  assert.equal(municipality.body.data.municipality.slug, 'boac')

  for (const resource of ['announcements', 'news', 'offices', 'services', 'projects', 'resources']) {
    const response = await request(`/api/v1/municipalities/boac/${resource}`)
    assert.equal(response.status, 200, resource)
    assert.ok(Array.isArray(response.body.data), resource)
  }
  assert.equal((await request('/api/v1/municipalities/boac/unknown')).status, 404)

  const write = await request('/api/municipal-portals/boac', { method: 'POST', body: {} })
  assert.ok([404, 405].includes(write.status), `public portals are read-only, got ${write.status}`)
})

test('archiving removes municipal content from public view', async () => {
  const archived = await request(`/api/admin/municipal-content/${boacContentId}/status`, {
    cookie: adminCookie,
    method: 'POST',
    body: { status: 'archived', note: 'Test cleanup' },
  })
  assert.equal(archived.status, 200, JSON.stringify(archived.body))

  const list = await request('/api/municipal-portals/boac/content?type=notice')
  assert.equal(list.body.total, 0)
  assert.equal((await request(`/api/municipal-portals/boac/content`)).body.results.some((row) => row.id === boacContentId), false)
})
