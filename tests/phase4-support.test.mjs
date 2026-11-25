/**
 * Prompt 69 — help centre and BetterGo support tickets: publication workflow,
 * ticket ownership, conversations, internal notes, attachments, scoping,
 * feedback and metrics.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4623
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4support-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const VAULT_DIR = path.join(DB_DIR, 'vault')
const PASSWORD = 'Marinduque#Test2026'
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('support attachment\n%%EOF\n')])

let child
let cookie = ''
let otherCookie = ''
let adminCookie = ''
let scopedCookie = ''
let reference = null
let ticketId = null

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

const register = async (email, firstName, municipalityId = 1) => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { firstName, lastName: 'Support', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId, acceptTerms: true, acceptPrivacy: true },
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
      VAULT_DIR,
    },
    stdio: 'ignore',
  })
  await waitForServer()

  await register('p4support-citizen@example.com', 'Citizen', 1)
  await register('p4support-other@example.com', 'Other', 2)

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const insertUser = (name, email) =>
    Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES (?, ?, ?, datetime('now'), 'active')`).run(name, email, hash).lastInsertRowid)
  const adminId = insertUser('Support Admin', 'p4support-admin@example.com')
  const scopedId = insertUser('Mogpog Support', 'p4support-scoped@example.com')
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(adminId, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scopedId, municipalRole)

  const category = db.prepare(`SELECT id FROM support_categories WHERE key = 'technical'`).get()
  db.prepare(
    `INSERT INTO support_articles (slug, category_id, title, summary, body, status, published_at)
     VALUES ('fixing-login-errors', ?, 'Fixing login errors', 'Common sign-in problems', 'Clear your browser cookies and try again.', 'published', datetime('now'))`,
  ).run(category.id)
  db.prepare(
    `INSERT INTO support_articles (slug, category_id, title, summary, body, status)
     VALUES ('internal-draft', ?, 'Internal draft', 'Not published yet', 'Draft body.', 'draft')`,
  ).run(category.id)
  db.close()

  cookie = await login('p4support-citizen@example.com')
  otherCookie = await login('p4support-other@example.com')
  adminCookie = await login('p4support-admin@example.com')
  scopedCookie = await login('p4support-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('the public help centre lists only published articles', async () => {
  const categories = await (await request('/api/help/categories')).json()
  assert.equal(categories.categories.length, 12)
  assert.equal(categories.categories.some((row) => row.article_count === 1), true)

  const articles = await (await request('/api/help/articles?q=login')).json()
  assert.equal(articles.total, 1)
  assert.equal(articles.results[0].slug, 'fixing-login-errors')

  const draft = await request('/api/help/articles/internal-draft')
  assert.equal(draft.status, 404)

  const detail = await (await request('/api/help/articles/fixing-login-errors')).json()
  assert.match(detail.disclaimer, /do not state government requirements/i)
})

test('article feedback requires a signed-in account', async () => {
  const anonymous = await request('/api/help/articles/fixing-login-errors/feedback', { json: { helpful: true } }, '')
  assert.equal(anonymous.status, 401)
  const own = await request('/api/help/articles/fixing-login-errors/feedback', { json: { helpful: true } })
  assert.equal(own.status, 200)
})

test('ticket submission needs consent and creates a non-guessable reference', async () => {
  const noConsent = await request('/api/account/support/tickets', {
    json: { subject: 'Cannot open a form', category: 'technical', description: 'The digital form page shows an error when I open it.' },
  })
  assert.equal(noConsent.status, 422)

  const badCategory = await request('/api/account/support/tickets', {
    json: { subject: 'Cannot open a form', category: 'not_real', description: 'The digital form page shows an error when I open it.', privacyAccepted: true },
  })
  assert.equal(badCategory.status, 422)

  const created = await request('/api/account/support/tickets', {
    json: {
      subject: 'Cannot open a form',
      category: 'technical',
      description: 'The digital form page shows an error when I open it in my browser.',
      issueType: 'technical_problem',
      privacyAccepted: true,
    },
  })
  const body = await created.json()
  assert.equal(created.status, 201, JSON.stringify(body))
  reference = body.reference
  assert.match(reference, /^BGSUP-/)
  assert.match(body.disclaimer, /not an official LGU complaint/i)
})

test('ticket ownership is enforced on every citizen route', async () => {
  const list = await (await request('/api/account/support/tickets', {}, otherCookie)).json()
  assert.equal(list.results.length, 0)

  const view = await request(`/api/account/support/tickets/${reference}`, {}, otherCookie)
  assert.equal(view.status, 404)
  const reply = await request(`/api/account/support/tickets/${reference}/messages`, { json: { body: 'Trying to access a foreign ticket.' } }, otherCookie)
  assert.equal(reply.status, 404)
  const close = await request(`/api/account/support/tickets/${reference}/close`, { json: {} }, otherCookie)
  assert.equal(close.status, 404)
})

test('citizens can reply and read only public support messages', async () => {
  const reply = await request(`/api/account/support/tickets/${reference}/messages`, { json: { body: 'It happens in both Chrome and Firefox.' } })
  assert.equal(reply.status, 201)

  const detail = await (await request(`/api/account/support/tickets/${reference}`)).json()
  assert.equal(detail.messages.length, 2)
  assert.equal(detail.messages.every((message) => message.author_role === 'citizen'), true)
  assert.equal(detail.ticket.statusLabel.length > 0, true)
})

test('support attachments are validated and private', async () => {
  const invalid = await request(`/api/account/support/tickets/${reference}/attachments`, {
    headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'fake.pdf' },
    body: Buffer.from('not a real pdf'),
  })
  assert.equal(invalid.status, 422)

  const uploaded = await request(`/api/account/support/tickets/${reference}/attachments`, {
    headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'screenshot.pdf' },
    body: PDF,
  })
  const body = await uploaded.json()
  assert.equal(uploaded.status, 201, JSON.stringify(body))

  const own = await request(`/api/account/support/attachments/${body.id}`)
  assert.equal(own.status, 200)
  assert.match(own.headers.get('cache-control'), /no-store/)

  const foreign = await request(`/api/account/support/attachments/${body.id}`, {}, otherCookie)
  assert.equal(foreign.status, 404)

  const direct = await fetch(`${BASE}/uploads/${body.id}.pdf`)
  assert.equal(direct.status, 404)
})

test('municipality scope hides tickets from other municipalities', async () => {
  const scoped = await request(`/api/admin/support/tickets/${reference}`, {}, scopedCookie)
  assert.equal(scoped.status, 404)

  const admin = await (await request(`/api/admin/support/tickets/${reference}`, {}, adminCookie)).json()
  ticketId = admin.ticket.id
  assert.equal(admin.messages.length, 2)
  assert.equal(admin.citizenEmail, 'p4support-citizen@example.com')
})

test('internal notes are never returned to the citizen', async () => {
  const note = await request(`/api/admin/support/tickets/${reference}/messages`, {
    json: { body: 'Internal: check the form renderer regression.', internal: true },
  }, adminCookie)
  assert.equal(note.status, 201)

  const citizenView = await (await request(`/api/account/support/tickets/${reference}`)).json()
  assert.equal(citizenView.messages.some((message) => /Internal: check/.test(message.body)), false)

  const adminView = await (await request(`/api/admin/support/tickets/${reference}`, {}, adminCookie)).json()
  assert.equal(adminView.messages.some((message) => message.internal === 1), true)
})

test('status transitions, assignment and citizen notifications are recorded', async () => {
  const assigned = await request(`/api/admin/support/tickets/${reference}`, {
    method: 'PATCH',
    json: { assignedTo: 1, priority: 'high' },
  }, adminCookie)
  assert.equal(assigned.status, 200, await assigned.text())

  const reply = await request(`/api/admin/support/tickets/${reference}/messages`, {
    json: { body: 'We reproduced the error and are fixing it.' },
  }, adminCookie)
  assert.equal(reply.status, 201)

  const detail = await (await request(`/api/account/support/tickets/${reference}`)).json()
  assert.equal(detail.messages.some((message) => message.author_role === 'support'), true)
  assert.equal(['in_progress', 'assigned'].includes(detail.ticket.status), true)

  const inbox = await (await request('/api/account/notifications')).json()
  assert.equal(inbox.results.some((note) => /Reply on ticket/.test(note.title)), true)

  const invalidClose = await request(`/api/admin/support/tickets/${reference}`, { method: 'PATCH', json: { status: 'closed' } }, adminCookie)
  assert.equal(invalidClose.status, 422)

  const resolved = await request(`/api/admin/support/tickets/${reference}`, { method: 'PATCH', json: { status: 'resolved', note: 'Fixed in the latest release.' } }, adminCookie)
  assert.equal(resolved.status, 200)
})

test('citizens can rate a resolved ticket once and reopen it', async () => {
  const feedback = await request(`/api/account/support/tickets/${reference}/feedback`, { json: { rating: 4, comment: 'Fast response.' } })
  assert.equal(feedback.status, 200)
  const again = await request(`/api/account/support/tickets/${reference}/feedback`, { json: { rating: 5 } })
  assert.equal(again.status, 422)

  const reopen = await request(`/api/account/support/tickets/${reference}/reopen`, { json: {} })
  assert.equal(reopen.status, 200)
  const detail = await (await request(`/api/account/support/tickets/${reference}`)).json()
  assert.equal(detail.ticket.status, 'reopened')

  const close = await request(`/api/account/support/tickets/${reference}/close`, { json: {} })
  assert.equal(close.status, 200)
})

test('help articles are reviewed before publication', async () => {
  const created = await request('/api/admin/support/articles', {
    json: { title: 'Saving a form draft', summary: 'How drafts work', body: 'Open the form and choose Save draft.', category: 'digital_forms' },
  }, adminCookie)
  const body = await created.json()
  assert.equal(created.status, 201, JSON.stringify(body))

  const selfPublish = await request(`/api/admin/support/articles/${body.id}/publish`, { json: {} }, adminCookie)
  assert.equal(selfPublish.status, 403)
})

test('support metrics use stored tickets only', async () => {
  const metrics = await (await request('/api/admin/support/metrics', {}, adminCookie)).json()
  assert.equal(metrics.totals.total >= 1, true)
  assert.equal(metrics.totals.rated >= 1, true)
  assert.match(metrics.note, /no published service-level/i)

  const citizen = await request('/api/admin/support/metrics', {}, cookie)
  assert.equal(citizen.status, 403)
})

test('public endpoints never expose tickets', async () => {
  const response = await request('/api/help/tickets', {}, '')
  assert.equal(response.status, 404)
  const list = await request('/api/account/support/tickets', {}, '')
  assert.equal(list.status, 401)
})
