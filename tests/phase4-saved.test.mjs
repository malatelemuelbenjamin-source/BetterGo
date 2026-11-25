/**
 * Prompt 63 — unified saved items, collections, status handling and privacy.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 4611
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4saved-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookieA = ''
let cookieB = ''
const ids = {}

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return
    } catch { /* not up */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('API did not become ready')
}

function request(pathname, options = {}, cookie = '') {
  const headers = { Accept: 'application/json', Origin: BASE, ...(options.headers || {}) }
  if (cookie) headers.Cookie = cookie
  if (options.body) headers['Content-Type'] = 'application/json'
  return fetch(`${BASE}${pathname}`, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined })
}

async function createUser(email, firstName) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: { firstName, lastName: 'Saved', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  })
  assert.equal(response.status, 201, await response.text())
  const login = await request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  return (login.headers.get('set-cookie') || '').split(';')[0]
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
  cookieA = await createUser('p4saved-a@example.com', 'Alpha')
  cookieB = await createUser('p4saved-b@example.com', 'Beta')

  const db = new DatabaseSync(DB_PATH)
  const category = db.prepare('SELECT id FROM service_categories LIMIT 1').get()
  ids.service = Number(db.prepare(
    `INSERT INTO government_services (title, slug, description, category_id, publication_status, published_at)
     VALUES ('Barangay clearance', 'saved-test-service', 'A test service.', ?, 'published', datetime('now'))`,
  ).run(category.id).lastInsertRowid)
  ids.office = Number(db.prepare(
    `INSERT INTO government_offices (name, slug, description, publication_status, verification_status)
     VALUES ('Test municipal hall', 'saved-test-office', 'A test office.', 'published', 'pending')`,
  ).run().lastInsertRowid)
  ids.announcement = Number(db.prepare(
    `INSERT INTO announcements (title, slug, summary, announcement_type, publication_status, published_at)
     VALUES ('Test advisory', 'saved-test-advisory', 'A test advisory.', 'advisory', 'published', datetime('now'))`,
  ).run().lastInsertRowid)
  ids.document = Number(db.prepare(
    `INSERT INTO public_documents (title, slug, description, document_category, publication_status)
     VALUES ('Test budget report', 'saved-test-document', 'A test document.', 'budget', 'published')`,
  ).run().lastInsertRowid)
  db.close()
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('every supported record type can be saved exactly once', async () => {
  for (const [contentType, id] of Object.entries(ids)) {
    const first = await request('/api/account/saved', { method: 'POST', body: { contentType, contentId: id } }, cookieA)
    assert.equal(first.status, 201, `${contentType}: ${await first.clone().text()}`)
    const duplicate = await request('/api/account/saved', { method: 'POST', body: { contentType, contentId: id } }, cookieA)
    assert.equal(duplicate.status, 200, 'saving twice is idempotent')
  }

  const list = await (await request('/api/account/saved', {}, cookieA)).json()
  assert.equal(list.total, 4)
  assert.equal(list.counts.service, 1)
  assert.ok(list.results.every((item) => item.available))
  assert.ok(list.results.find((item) => item.contentType === 'office').url.startsWith('/government-directory/'))
})

test('unsupported and unpublished records cannot be saved', async () => {
  const unsupported = await request('/api/account/saved', { method: 'POST', body: { contentType: 'program', contentId: 1 } }, cookieA)
  assert.equal(unsupported.status, 422)

  const missing = await request('/api/account/saved', { method: 'POST', body: { contentType: 'service', contentId: 999999 } }, cookieA)
  assert.equal(missing.status, 404)
})

test('filters, sorting and search work on saved items', async () => {
  const offices = await (await request('/api/account/saved?type=office', {}, cookieA)).json()
  assert.equal(offices.results.length, 1)
  assert.equal(offices.results[0].contentType, 'office')

  const search = await (await request('/api/account/saved?q=budget', {}, cookieA)).json()
  assert.equal(search.results.length, 1)
  assert.equal(search.results[0].contentType, 'document')

  const alpha = await (await request('/api/account/saved?sort=alpha', {}, cookieA)).json()
  const titles = alpha.results.map((item) => item.title)
  assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b)))
})

test('saved status reflects the caller bookmark only', async () => {
  const mine = await (await request(`/api/account/saved/status?contentType=service&slug=saved-test-service`, {}, cookieA)).json()
  assert.equal(mine.saved, true)
  const theirs = await (await request(`/api/account/saved/status?contentType=service&slug=saved-test-service`, {}, cookieB)).json()
  assert.equal(theirs.saved, false)
  const listB = await (await request('/api/account/saved', {}, cookieB)).json()
  assert.equal(listB.total, 0)
})

test('an unpublished record stays visible as an unavailable reference', async () => {
  const db = new DatabaseSync(DB_PATH)
  db.prepare(`UPDATE public_documents SET publication_status = 'draft' WHERE id = ?`).run(ids.document)
  db.close()

  const list = await (await request('/api/account/saved?type=document', {}, cookieA)).json()
  assert.equal(list.results.length, 1)
  assert.equal(list.results[0].available, false)
  assert.equal(list.results[0].url, null)
  assert.equal(list.results[0].title, 'This record is no longer published')
  assert.ok(!JSON.stringify(list).includes('Test budget report'), 'unpublished details are not exposed')
})

test('collections hold any record type, reorder and move between collections', async () => {
  const first = await (await request('/api/account/collections', { method: 'POST', body: { name: 'Business' } }, cookieA)).json()
  const second = await (await request('/api/account/collections', { method: 'POST', body: { name: 'Family' } }, cookieA)).json()

  const addService = await request(`/api/account/collections/${first.id}/items`, { method: 'POST', body: { contentType: 'service', contentId: ids.service } }, cookieA)
  assert.equal(addService.status, 201)
  const secondAdd = await request(`/api/account/collections/${first.id}/items`, { method: 'POST', body: { contentType: 'announcement', contentId: ids.announcement } }, cookieA)
  assert.equal(secondAdd.status, 201, await secondAdd.clone().text())

  const listed = await (await request('/api/account/collections', {}, cookieA)).json()
  const collection = listed.results.find((row) => row.id === first.id)
  assert.equal(collection.item_count, 2)
  assert.deepEqual(collection.items.map((item) => item.contentType).sort(), ['announcement', 'service'])

  const reordered = await request(`/api/account/collections/${first.id}/reorder`, {
    method: 'POST', body: { itemIds: collection.items.map((item) => item.itemId).reverse() },
  }, cookieA)
  assert.equal(reordered.status, 200)

  const moved = await request(`/api/account/collections/${first.id}/move`, {
    method: 'POST', body: { itemId: collection.items[0].itemId, collectionId: second.id },
  }, cookieA)
  assert.equal(moved.status, 200)

  const after = await (await request(`/api/account/collections/${second.id}`, {}, cookieA)).json()
  assert.equal(after.collection.items.length, 1)
})

test('another citizen cannot read or change these collections', async () => {
  const mine = await (await request('/api/account/collections', {}, cookieA)).json()
  const target = mine.results[0]
  const foreignRead = await request(`/api/account/collections/${target.id}`, {}, cookieB)
  assert.equal(foreignRead.status, 404)
  const foreignAdd = await request(`/api/account/collections/${target.id}/items`, { method: 'POST', body: { contentType: 'service', contentId: ids.service } }, cookieB)
  assert.equal(foreignAdd.status, 404)
  const foreignDelete = await request(`/api/account/collections/${target.id}`, { method: 'DELETE' }, cookieB)
  assert.equal(foreignDelete.status, 404)
  const theirs = await (await request('/api/account/collections', {}, cookieB)).json()
  assert.equal(theirs.results.length, 0)
})
