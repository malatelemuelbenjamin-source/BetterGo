/**
 * Phase 3, Prompt 57 — final integration and audit checks.
 *
 * Six-municipality consistency, route integrity, published-only public APIs,
 * inquiry references and tracking, security headers, rate limiting and
 * administrator-only endpoints.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4606
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-final-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const MUNICIPALITIES = ['boac', 'mogpog', 'gasan', 'buenavista', 'torrijos', 'santa-cruz']

let child
let adminCookie = ''
let mogpogCookie = ''

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
  assert.equal(response.status, 200, `login failed for ${email}`)
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
  const password = 'Marinduque#Final2026'
  const hash = bcrypt.hashSync(password, 10)
  const insertUser = db.prepare(
    `INSERT INTO users (name, email, password_hash, email_verified_at, account_status)
     VALUES (?, ?, ?, datetime('now'), 'active')`,
  )
  const roleId = (slug) => Number(db.prepare(`SELECT id FROM user_roles WHERE slug = ?`).get(slug).id)
  const assign = db.prepare(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, ?, ?, 'active')`,
  )
  const adminId = Number(insertUser.run('Final Admin', 'final-admin@example.com', hash).lastInsertRowid)
  const mogpogId = Number(insertUser.run('Final Mogpog', 'final-mogpog@example.com', hash).lastInsertRowid)
  assign.run(adminId, roleId('super_admin'), 'global', null)
  const mogpog = db.prepare(`SELECT id FROM municipalities WHERE slug = 'mogpog'`).get()
  assign.run(mogpogId, roleId('municipal_admin'), 'municipality', Number(mogpog.id))
  db.close()

  adminCookie = await login('final-admin@example.com', password)
  mogpogCookie = await login('final-mogpog@example.com', password)
})

after(() => {
  if (child) child.kill()
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('all six municipalities expose consistent portal, section and API routes', async () => {
  const directory = await request('/api/municipal-portals')
  assert.equal(directory.status, 200)
  assert.deepEqual(
    directory.body.results.map((row) => row.slug).sort(),
    [...MUNICIPALITIES].sort(),
    'the directory must list exactly the six Marinduque municipalities',
  )

  for (const slug of MUNICIPALITIES) {
    const portal = await request(`/api/municipal-portals/${slug}`)
    assert.equal(portal.status, 200, `portal payload failed for ${slug}`)
    for (const key of ['municipality', 'metrics', 'content', 'announcements', 'offices', 'services', 'barangays', 'advisories', 'upcoming', 'projects', 'programs', 'faqs']) {
      assert.ok(key in portal.body, `portal payload for ${slug} is missing ${key}`)
    }

    for (const type of ['news', 'notice', 'project', 'program', 'resource', 'faq', 'about', 'contact']) {
      const list = await request(`/api/municipal-portals/${slug}/content?type=${type}`)
      assert.equal(list.status, 200, `${type} listing failed for ${slug}`)
      assert.ok(Array.isArray(list.body.results))
    }

    for (const resource of ['announcements', 'news', 'notices', 'projects', 'resources', 'offices', 'services']) {
      const api = await request(`/api/v1/municipalities/${slug}/${resource}`)
      assert.equal(api.status, 200, `v1 ${resource} failed for ${slug}`)
      assert.ok(api.body.disclaimer)
    }

    assert.equal((await request(`/api/municipal-projects?municipality=${slug}`)).status, 200)
    assert.equal((await request(`/api/municipal-programs?municipality=${slug}`)).status, 200)
    assert.equal((await request(`/api/municipal-resources?municipality=${slug}`)).status, 200)
    assert.equal((await request(`/api/municipal-faqs?municipality=${slug}`)).status, 200)
    assert.equal((await request(`/api/municipal-offices?municipality=${slug}`)).status, 200)
    assert.equal((await request(`/api/municipal-search?q=office&municipality=${slug}`)).status, 200)
  }
})

test('unknown municipalities and resources return clean 404s', async () => {
  assert.equal((await request('/api/municipal-portals/not-a-municipality')).status, 404)
  assert.equal((await request('/api/v1/municipalities/not-a-municipality')).status, 404)
  assert.equal((await request('/api/v1/municipalities/boac/unknown-resource')).status, 404)
  assert.equal((await request('/api/municipal-portals/boac/content?type=invented')).status, 400)
})

test('security headers are present on API responses', async () => {
  const response = await request('/api/municipal-projects')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN')
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
  assert.equal(response.headers.get('x-powered-by'), null)
})

test('inquiry references are issued and tracking requires the matching email', async () => {
  const created = await request('/api/municipal-feedback', {
    method: 'POST',
    body: { municipality: 'gasan', kind: 'correction', email: 'resident@example.com', message: 'The published office hours look outdated.' },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const reference = created.body.feedback.reference
  assert.match(reference, /^BGM-[A-Z0-9]+-[A-Z0-9]+$/)

  const tracked = await request('/api/municipal-feedback/track', {
    method: 'POST',
    body: { reference, email: 'resident@example.com' },
  })
  assert.equal(tracked.status, 200, JSON.stringify(tracked.body))
  assert.equal(tracked.body.inquiry.status, 'new')
  assert.match(tracked.body.inquiry.note, /not an official LGU/i)

  const wrongEmail = await request('/api/municipal-feedback/track', {
    method: 'POST',
    body: { reference, email: 'someone-else@example.com' },
  })
  assert.equal(wrongEmail.status, 404)

  const unknown = await request('/api/municipal-feedback/track', {
    method: 'POST',
    body: { reference: 'BGM-00000-000', email: 'resident@example.com' },
  })
  assert.equal(unknown.status, 404)
})

test('feedback submissions are rate limited per client', async () => {
  let limited = false
  for (let i = 0; i < 10; i += 1) {
    const response = await request('/api/municipal-feedback', {
      method: 'POST',
      body: { kind: 'concern', message: `Rate limit probe number ${i} for the public form.` },
    })
    if (response.status === 429) {
      limited = true
      break
    }
  }
  assert.ok(limited, 'the public feedback endpoint must reject bursts')
})

test('administrator-only endpoints reject anonymous and out-of-scope access', async () => {
  for (const pathname of [
    '/api/admin/municipal-offices',
    '/api/admin/municipal-feedback',
    '/api/admin/municipal-analytics/1',
    '/api/admin/municipal-export?municipality_id=1',
  ]) {
    assert.equal((await request(pathname)).status, 401, `${pathname} must require authentication`)
  }

  const crossScope = await request('/api/admin/municipal-offices', { cookie: mogpogCookie })
  assert.equal(crossScope.status, 200)
  const boacId = 1
  const denied = await request(`/api/admin/municipal-export?municipality_id=${boacId}`, { cookie: mogpogCookie })
  assert.equal(denied.status, 403, 'a municipal administrator cannot export another municipality')

  const allowed = await request('/api/admin/municipal-feedback', { cookie: adminCookie })
  assert.equal(allowed.status, 200)
})

test('pagination and filters keep their contracts', async () => {
  const portal = await request('/api/municipal-portals')
  assert.ok(portal.body.results.length === 6)

  const page = await request('/api/municipal-projects?limit=1&page=2')
  assert.equal(page.status, 200)
  assert.equal(page.body.limit, 1)
  assert.equal(page.body.page, 2)
  assert.ok(page.body.totalPages >= 1)

  const negative = await request('/api/municipal-projects?limit=-5&page=-1')
  assert.equal(negative.status, 200)
  assert.ok(negative.body.limit >= 1 && negative.body.limit <= 50, 'limit is clamped into a safe range')
  assert.equal(negative.body.page, 1)
})
