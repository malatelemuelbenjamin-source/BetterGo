/**
 * Phase 3, Prompts 44–56 — municipal portal modules.
 *
 * Exercises the public project, program, resource, FAQ, office/map, discovery,
 * feedback, subscription, analytics and export endpoints against a real HTTP
 * server, including the published-only rule and municipality scoping.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4604
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-modules-'))
const DB_PATH = path.join(DB_DIR, 'test.db')

let child
let adminCookie = ''
let boacCookie = ''
let mogpogCookie = ''
let boacId = null

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
  const headers = { Accept: 'application/json', Origin: BASE }
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
  const password = 'Marinduque#Modules2026'
  const hash = bcrypt.hashSync(password, 10)
  const insertUser = db.prepare(
    `INSERT INTO users (name, email, password_hash, email_verified_at, account_status, created_at)
     VALUES (?, ?, ?, datetime('now'), 'active', datetime('now'))`,
  )
  const roleId = (slug) => Number(db.prepare(`SELECT id FROM user_roles WHERE slug = ?`).get(slug).id)
  const assign = db.prepare(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, ?, ?, 'active')`,
  )
  const adminId = Number(insertUser.run('Modules Admin', 'modules-admin@example.com', hash).lastInsertRowid)
  const boacUserId = Number(insertUser.run('Boac Modules', 'modules-boac@example.com', hash).lastInsertRowid)
  const mogpogUserId = Number(insertUser.run('Mogpog Modules', 'modules-mogpog@example.com', hash).lastInsertRowid)
  assign.run(adminId, roleId('super_admin'), 'global', null)
  const boac = db.prepare(`SELECT id FROM municipalities WHERE slug = 'boac'`).get()
  const mogpog = db.prepare(`SELECT id FROM municipalities WHERE slug = 'mogpog'`).get()
  boacId = Number(boac.id)
  assign.run(boacUserId, roleId('municipal_admin'), 'municipality', boacId)
  assign.run(mogpogUserId, roleId('municipal_admin'), 'municipality', Number(mogpog.id))

  // Fixtures: one published and one draft record of each public module type.
  const insert = db.prepare(
    `INSERT INTO municipal_content (municipality_id, content_type, title, slug, summary, body,
       publication_status, verification_status, project_status, application_status, progress_percent,
       progress_note, event_start, venue, priority, pinned, source_reference, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run(boacId, 'project', 'Coastal road repair', 'coastal-road-repair', 'Repair of the coastal road', 'Body', 'published', 'verified', 'ongoing', 'not_stated', 40, 'Phase one complete', '2026-12-01', 'Poblacion', 'normal', 0, 'Fixture source', '2026-01-01 00:00:00')
  insert.run(boacId, 'project', 'Draft seawall', 'draft-seawall', 'Not public', 'Body', 'draft', 'pending', 'proposed', 'not_stated', null, null, null, null, 'normal', 0, 'Fixture source', null)
  insert.run(boacId, 'program', 'Barangay health drive', 'barangay-health-drive', 'Free health screening', 'Body', 'published', 'verified', 'proposed', 'open', null, null, '2027-01-15', 'Barangay hall', 'important', 0, 'Fixture source', '2026-02-01 00:00:00')
  insert.run(boacId, 'faq', 'How do I request a barangay clearance?', 'barangay-clearance', 'Bring a valid ID.', 'Ask the barangay hall.', 'published', 'verified', 'proposed', 'not_stated', null, null, null, null, 'normal', 0, 'Fixture source', '2026-02-02 00:00:00')
  insert.run(boacId, 'notice', 'Water interruption', 'water-interruption', 'Scheduled interruption', 'Body', 'published', 'verified', 'proposed', 'not_stated', null, null, '2026-12-05', 'Boac', 'urgent', 1, 'Fixture source', '2026-03-01 00:00:00')

  const project = db.prepare(`SELECT id FROM municipal_content WHERE slug = 'coastal-road-repair'`).get()
  const insertUpdate = db.prepare(
    `INSERT INTO municipal_content_updates (content_id, municipality_id, update_type, title, description, reported_on, progress_percent, source_reference, publication_status)
     VALUES (?, ?, 'progress', ?, ?, ?, ?, ?, ?)`,
  )
  insertUpdate.run(Number(project.id), boacId, 'Published milestone', 'First phase finished', '2026-03-01', 40, 'Fixture source', 'published')
  insertUpdate.run(Number(project.id), boacId, 'Internal note', 'Not for the public', '2026-03-02', 45, 'Fixture source', 'draft')

  // One office with verified coordinates and one without.
  const insertOffice = db.prepare(
    `INSERT INTO government_offices (name, slug, municipality_id, government_level, office_type, office_level,
       publication_status, verification_status, latitude, longitude, location_verified, address)
     VALUES (?, ?, ?, 'municipal', 'Office', ?, 'published', 'verified', ?, ?, ?, ?)`,
  )
  insertOffice.run('Boac Municipal Hall', 'boac-municipal-hall', boacId, 'office', 13.4467, 121.8417, 1, 'Poblacion, Boac')
  insertOffice.run('Boac Satellite Office', 'boac-satellite-office', boacId, 'division', null, null, 0, 'Barangay Tampus')

  db.close()

  adminCookie = await login('modules-admin@example.com', password)
  boacCookie = await login('modules-boac@example.com', password)
  mogpogCookie = await login('modules-mogpog@example.com', password)
})

after(() => {
  if (child) child.kill()
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('published projects are listed and drafts never appear', async () => {
  const list = await request('/api/municipal-projects')
  assert.equal(list.status, 200)
  const slugs = list.body.results.map((row) => row.slug)
  assert.ok(slugs.includes('coastal-road-repair'))
  assert.ok(!slugs.includes('draft-seawall'), 'draft project leaked into the public list')

  const detail = await request('/api/municipal-portals/boac/projects/draft-seawall')
  assert.equal(detail.status, 404)

  const published = await request('/api/municipal-portals/boac/projects/coastal-road-repair')
  assert.equal(published.status, 200)
  assert.equal(published.body.record.progress_percent, 40)
  assert.equal(published.body.updates.length, 1, 'only published progress updates are public')
})

test('project filters and status validation work', async () => {
  const ongoing = await request('/api/municipal-projects?status=ongoing')
  assert.equal(ongoing.status, 200)
  assert.ok(ongoing.body.results.every((row) => row.project_status === 'ongoing'))

  const bogus = await request('/api/municipal-projects?status=invented')
  assert.equal(bogus.status, 400)
})

test('public programs expose application status without fabricating it', async () => {
  const programs = await request('/api/municipal-programs')
  assert.equal(programs.status, 200)
  const program = programs.body.results.find((row) => row.slug === 'barangay-health-drive')
  assert.equal(program.application_status, 'open')
})

test('FAQs, resources and offices respond with published-only results', async () => {
  const faqs = await request('/api/municipal-faqs?municipality=boac')
  assert.equal(faqs.status, 200)
  assert.ok(faqs.body.results.some((row) => row.slug === 'barangay-clearance'))

  const resources = await request('/api/municipal-resources')
  assert.equal(resources.status, 200)
  assert.ok(Array.isArray(resources.body.results))

  const offices = await request('/api/municipal-offices?municipality=boac')
  assert.equal(offices.status, 200)
  assert.equal(offices.body.markers.length, 1, 'only verified coordinates become map markers')
  assert.equal(offices.body.markers[0].slug, 'boac-municipal-hall')
})

test('portal payload includes dashboard sections and labels', async () => {
  const portal = await request('/api/municipal-portals/boac')
  assert.equal(portal.status, 200)
  assert.ok(Array.isArray(portal.body.advisories))
  assert.ok(portal.body.advisories.some((row) => row.slug === 'water-interruption'))
  assert.ok(Array.isArray(portal.body.upcoming))
  assert.ok(Array.isArray(portal.body.projects))
  assert.ok(Array.isArray(portal.body.programs))
  assert.ok(portal.body.labels.projectStatuses.ongoing)
})

test('cross-municipality discovery only returns published records', async () => {
  const search = await request('/api/municipal-search?q=coastal')
  assert.equal(search.status, 200)
  assert.ok(search.body.groups.updates.some((row) => row.slug === 'coastal-road-repair'))

  const draft = await request('/api/municipal-search?q=seawall')
  assert.equal(draft.status, 200)
  assert.equal(draft.body.total, 0, 'draft records must not be discoverable')

  const empty = await request('/api/municipal-search?q=')
  assert.equal(empty.status, 400)
})

test('feedback is validated, stored for review and never public', async () => {
  const short = await request('/api/municipal-feedback', {
    method: 'POST',
    body: { municipality: 'boac', kind: 'correction', message: 'short' },
  })
  assert.equal(short.status, 422)

  const created = await request('/api/municipal-feedback', {
    method: 'POST',
    body: { municipality: 'boac', kind: 'correction', message: 'The office hours appear out of date.' },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.equal(created.body.feedback.status, 'new')

  const anonymousList = await request('/api/admin/municipal-feedback')
  assert.equal(anonymousList.status, 401)

  const scoped = await request('/api/admin/municipal-feedback', { cookie: mogpogCookie })
  assert.equal(scoped.status, 200)
  assert.equal(scoped.body.results.length, 0, 'another municipality must not see this feedback')

  const boacList = await request('/api/admin/municipal-feedback', { cookie: boacCookie })
  assert.equal(boacList.status, 200)
  assert.equal(boacList.body.results.length, 1)

  const review = await request(`/api/admin/municipal-feedback/${created.body.feedback.id}`, {
    cookie: boacCookie,
    method: 'PATCH',
    body: { status: 'resolved', response: 'Checked with the records officer.' },
  })
  assert.equal(review.status, 200)
  assert.equal(review.body.feedback.status, 'resolved')
})

test('subscriptions use double opt-in and can be removed', async () => {
  const subscribe = await request('/api/municipal-subscriptions', {
    method: 'POST',
    body: { municipality: 'boac', email: 'citizen@example.com', topics: ['announcements'] },
  })
  assert.equal(subscribe.status, 201, JSON.stringify(subscribe.body))
  const token = subscribe.body.confirmation.token
  assert.ok(token)

  const confirm = await request(`/api/municipal-subscriptions/confirm/${token}`)
  assert.equal(confirm.status, 200)
  assert.equal(confirm.body.confirmed, true)

  const remove = await request(`/api/municipal-subscriptions/unsubscribe/${token}`, { method: 'POST' })
  assert.equal(remove.status, 200)
  assert.equal(remove.body.unsubscribed, true)

  const invalid = await request('/api/municipal-subscriptions/confirm/not-a-real-token')
  assert.equal(invalid.status, 404)
})

test('offices are created within scope and coordinates require verification', async () => {
  const denied = await request('/api/admin/municipal-offices', {
    cookie: mogpogCookie,
    method: 'POST',
    body: { municipality_id: boacId, name: 'Wrong Municipality Office' },
  })
  assert.equal(denied.status, 403)

  const mismatch = await request('/api/admin/municipal-offices', {
    cookie: boacCookie,
    method: 'POST',
    body: { municipality_id: boacId, name: 'Half Located Office', latitude: 13.4 },
  })
  assert.equal(mismatch.status, 400)

  const created = await request('/api/admin/municipal-offices', {
    cookie: boacCookie,
    method: 'POST',
    body: {
      municipality_id: boacId,
      name: 'Boac Treasury Office',
      office_level: 'division',
      address: 'Municipal Hall, Boac',
      latitude: 13.4468,
      longitude: 121.8418,
      location_verified: true,
      source_reference: 'Fixture source',
    },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.equal(created.body.office.publication_status, 'draft')
  assert.equal(created.body.office.location_verified, 1)

  const draftMap = await request('/api/municipal-offices?municipality=boac')
  assert.equal(draftMap.body.markers.length, 1, 'a draft office must not appear on the public map')

  const published = await request(`/api/admin/municipal-offices/${created.body.office.id}`, {
    cookie: boacCookie,
    method: 'PATCH',
    body: { publication_status: 'published' },
  })
  assert.equal(published.status, 200)
  const afterPublish = await request('/api/municipal-offices?municipality=boac')
  assert.equal(afterPublish.body.markers.length, 2)
})

test('portal analytics are aggregated and administrator-only', async () => {
  await request('/api/municipal-portals/boac')
  const anonymous = await request(`/api/admin/municipal-analytics/${boacId}`)
  assert.equal(anonymous.status, 401)

  const analytics = await request(`/api/admin/municipal-analytics/${boacId}`, { cookie: boacCookie })
  assert.equal(analytics.status, 200)
  assert.ok(Number(analytics.body.totals.portal_view) >= 1)
  assert.ok(analytics.body.published.project)

  const other = await request('/api/admin/municipal-analytics/1', { cookie: mogpogCookie })
  assert.equal(other.status, 403, 'a municipal administrator cannot read another municipality analytics')
})

test('data export requires authentication and municipality scope', async () => {
  const anonymous = await request(`/api/admin/municipal-export?municipality_id=${boacId}`)
  assert.equal(anonymous.status, 401)

  const csv = await request(`/api/admin/municipal-export?municipality_id=${boacId}&format=csv`, { cookie: boacCookie })
  assert.equal(csv.status, 200)
  assert.match(String(csv.headers.get('content-type')), /text\/csv/)

  const denied = await request(`/api/admin/municipal-export?municipality_id=${boacId}`, { cookie: mogpogCookie })
  assert.equal(denied.status, 403)
})

test('v1 read-only module endpoints expose published data only', async () => {
  const projects = await request('/api/v1/municipal-projects')
  assert.equal(projects.status, 200)
  assert.ok(projects.body.data.every((row) => row.slug !== 'draft-seawall'))
  assert.ok(projects.body.disclaimer)

  const offices = await request('/api/v1/municipal-offices?municipality=boac')
  assert.equal(offices.status, 200)
  assert.ok(Array.isArray(offices.body.data.markers))
})
