/**
 * Prompt 66 — personal document vault: upload validation, ownership, private
 * delivery, folders, reuse, sharing, replacement and deletion rules.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4617
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4vault-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const VAULT_DIR = path.join(DB_DIR, 'vault')
const PASSWORD = 'Marinduque#Test2026'

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('bettergo test document\n%%EOF\n')])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake png body')])

let child
let cookie = ''
let otherCookie = ''
let documentId = null
let folderId = null
let reference = null

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
    json: { firstName, lastName: 'Vault', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId: 1, acceptTerms: true, acceptPrivacy: true },
  }, '')
  assert.equal(response.status, 201, await response.text())
}

const upload = (buffer, query = '', as = cookie, contentType = 'application/pdf', filename = 'clearance.pdf') =>
  request(`/api/account/documents${query}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'X-Filename': filename },
    body: buffer,
  }, as)

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

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  db.prepare(
    `INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES (?, ?, ?, datetime('now'), 'active')`,
  ).run('Vault Admin', 'p4vault-admin@example.com', hash)
  db.close()

  await register('p4vault-citizen@example.com', 'Citizen')
  await register('p4vault-other@example.com', 'Other')
  cookie = await login('p4vault-citizen@example.com')
  otherCookie = await login('p4vault-other@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('the vault rejects files that are not real PDFs or images', async () => {
  const text = await upload(Buffer.from('just some text pretending to be a pdf'), '', cookie, 'application/pdf', 'fake.pdf')
  assert.equal(text.status, 422)

  const executable = await upload(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), '', cookie, 'application/pdf', 'tool.pdf')
  assert.equal(executable.status, 422)

  const empty = await upload(Buffer.alloc(0), '', cookie, 'application/pdf', 'empty.pdf')
  assert.equal(empty.status, 422)
})

test('an owner can upload a document with citizen-provided metadata', async () => {
  const response = await upload(PDF, '?category=certificates&title=Barangay%20clearance&issuer=Barangay%20Boac&expiresAt=2030-01-31', cookie)
  const body = await response.json()
  assert.equal(response.status, 201, JSON.stringify(body))
  documentId = body.document.id
  assert.equal(body.document.title, 'Barangay clearance')
  assert.equal(body.document.categoryLabel, 'Certificates and clearances')
  assert.equal(body.document.metadataSource, 'citizen_provided')
  assert.equal(body.document.mimeType, 'application/pdf')

  const list = await (await request('/api/account/documents')).json()
  assert.equal(list.total, 1)
  assert.equal(list.storage.usedBytes, PDF.length)
  assert.match(list.note, /never sent to an office/i)
})

test('vault files are private to their owner', async () => {
  const foreignList = await (await request('/api/account/documents', {}, otherCookie)).json()
  assert.equal(foreignList.total, 0)

  const foreignFile = await request(`/api/account/documents/${documentId}/file`, {}, otherCookie)
  assert.equal(foreignFile.status, 404)
  const foreignMeta = await request(`/api/account/documents/${documentId}`, {}, otherCookie)
  assert.equal(foreignMeta.status, 404)
  const foreignDelete = await request(`/api/account/documents/${documentId}`, { method: 'DELETE' }, otherCookie)
  assert.equal(foreignDelete.status, 404)

  // No public URL serves vault content.
  const direct = await fetch(`${BASE}/uploads/${documentId}.pdf`)
  assert.equal(direct.status, 404)
})

test('owners can preview and download their own file with safe headers', async () => {
  const preview = await request(`/api/account/documents/${documentId}/file`)
  assert.equal(preview.status, 200)
  assert.equal(preview.headers.get('content-type'), 'application/pdf')
  assert.equal(preview.headers.get('x-content-type-options'), 'nosniff')
  assert.match(preview.headers.get('content-disposition'), /^inline/)
  assert.match(preview.headers.get('cache-control'), /no-store/)

  const download = await request(`/api/account/documents/${documentId}/file?download=1`)
  assert.equal(download.status, 200)
  assert.match(download.headers.get('content-disposition'), /^attachment/)

  const security = await (await request('/api/account/documents/security')).json()
  assert.equal(security.total, 1)
  assert.equal(security.recentActivity.length >= 2, true)
  assert.equal(security.recentActivity[0].event_type, 'accessed')
})

test('folders organise documents and never delete them', async () => {
  const created = await (await request('/api/account/documents/folders', { method: 'POST', json: { name: 'Clearances' } })).json()
  folderId = created.id

  const move = await request(`/api/account/documents/${documentId}`, { method: 'PATCH', json: { folderId } })
  assert.equal(move.status, 200)
  assert.equal((await move.json()).document.folderId, folderId)

  const renamed = await request(`/api/account/documents/folders/${folderId}`, { method: 'PATCH', json: { name: 'Clearances 2026' } })
  assert.equal(renamed.status, 200)

  const removed = await request(`/api/account/documents/folders/${folderId}`, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  const after = await (await request('/api/account/documents')).json()
  assert.equal(after.total, 1, 'the document survives folder deletion')
  assert.equal(after.results[0].folderId, null)
})

test('search, filters and sorting use real records', async () => {
  const png = await upload(PNG, '?category=identification&title=School%20ID', cookie, 'image/png', 'id.png')
  assert.equal(png.status, 201)

  const byCategory = await (await request('/api/account/documents?category=identification')).json()
  assert.equal(byCategory.total, 1)
  assert.equal(byCategory.results[0].title, 'School ID')

  const byTerm = await (await request('/api/account/documents?q=barangay')).json()
  assert.equal(byTerm.total, 1)

  const sorted = await (await request('/api/account/documents?sort=title')).json()
  assert.equal(sorted.results[0].title, 'Barangay clearance')
})

test('untyped documents can be reused on a BetterGo form by their owner only', async () => {
  const db = new DatabaseSync(DB_PATH)
  const category = db.prepare('SELECT id FROM service_categories LIMIT 1').get()
  const serviceId = Number(
    db.prepare(
      `INSERT INTO government_services (title, slug, description, category_id, publication_status, published_at)
       VALUES ('Vault reuse service', 'p4-vault-service', 'Used by vault tests.', ?, 'published', datetime('now'))`,
    ).run(category.id).lastInsertRowid,
  )
  const adminRow = db.prepare(`SELECT id FROM users WHERE email = 'p4vault-admin@example.com'`).get()
  const roleId = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(adminRow.id, roleId)
  db.close()

  const adminCookie = await login('p4vault-admin@example.com')
  const form = await (await request('/api/admin/forms', {
    method: 'POST',
    json: {
      serviceId,
      title: 'Vault reuse intake',
      submissionClassification: 'bettergo_intake',
      fields: [
        { fieldKey: 'full_name', label: 'Full name', fieldType: 'short_text', required: true },
        { fieldKey: 'support', label: 'Supporting document', fieldType: 'file', required: false },
      ],
    },
  }, adminCookie)).json()
  for (const step of ['submit-review', 'approve', 'publish']) {
    const response = await request(`/api/admin/forms/${form.id}/${step}`, { method: 'POST', json: {} }, adminCookie)
    assert.equal(response.status, 200, `${step} failed`)
  }

  const submit = async (as, documentIds) =>
    request(`/api/account/forms/${form.id}/submit`, {
      method: 'POST',
      json: { answers: { full_name: 'Citizen Vault' }, consent: true, documentIds, allowDuplicate: true },
    }, as)

  const foreign = await submit(otherCookie, [documentId])
  assert.equal(foreign.status, 422, 'another citizen cannot attach a document they do not own')

  const own = await submit(cookie, [documentId])
  const body = await own.json()
  assert.equal(own.status, 201, JSON.stringify(body))
  reference = body.reference

  const detail = await (await request(`/api/account/applications/${reference}`)).json()
  assert.equal(detail.documents.length, 1)
  assert.equal(detail.documents[0].id, documentId)
})

test('a document referenced by an active record cannot be silently deleted', async () => {
  const blocked = await request(`/api/account/documents/${documentId}`, { method: 'DELETE' })
  assert.equal(blocked.status, 422)
  const body = await blocked.json()
  assert.match(body.error, /active BetterGo record/i)

  const stillThere = await request(`/api/account/documents/${documentId}`)
  assert.equal(stillThere.status, 200)
})

test('replacing a document keeps a new version and the old history', async () => {
  const replacement = await request(`/api/account/documents/${documentId}/replace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'clearance-2026.pdf' },
    body: PDF,
  })
  const body = await replacement.json()
  assert.equal(replacement.status, 201, JSON.stringify(body))
  assert.equal(body.document.version, 2)
  assert.equal(body.document.title, 'Barangay clearance', 'metadata carries over')
  assert.notEqual(body.document.id, documentId)
  documentId = body.document.id
})

test('sharing requires explicit consent, identifies the recipient and can be revoked', async () => {
  const noConsent = await request(`/api/account/documents/${documentId}/shares`, {
    method: 'POST',
    json: { recipientLabel: 'Boac Planning Office', purpose: 'Review my clearance' },
  })
  assert.equal(noConsent.status, 422)

  const share = await request(`/api/account/documents/${documentId}/shares`, {
    method: 'POST',
    json: { recipientLabel: 'Boac Planning Office', purpose: 'Review my clearance', consent: true },
  })
  const shareBody = await share.json()
  assert.equal(share.status, 201, JSON.stringify(shareBody))
  assert.match(shareBody.note, /does not transmit the file/i)

  const security = await (await request('/api/account/documents/security')).json()
  assert.equal(security.shares.length, 1)

  const revoke = await request(`/api/account/documents/${documentId}/shares/${shareBody.id}`, { method: 'DELETE' })
  assert.equal(revoke.status, 200)
  const after = await (await request('/api/account/documents/security')).json()
  assert.equal(after.shares.length, 0)
})

test('a document not used by an active record can be deleted by its owner', async () => {
  const created = await upload(PNG, '?category=other&title=Unused%20scan', cookie, 'image/png', 'scan.png')
  const id = (await created.json()).document.id
  const deleted = await request(`/api/account/documents/${id}`, { method: 'DELETE' })
  assert.equal(deleted.status, 200)
  const list = await (await request('/api/account/documents')).json()
  assert.equal(list.results.some((row) => row.id === id), false)
  const file = await request(`/api/account/documents/${id}/file`)
  assert.equal(file.status, 404)
})

test('administrators have no route into a citizen vault', async () => {
  const adminCookie = await login('p4vault-admin@example.com')
  for (const pathname of ['/api/admin/vault', '/api/admin/citizen-documents', `/api/admin/documents/${documentId}/file`]) {
    const response = await request(pathname, {}, adminCookie)
    assert.equal(response.status, 404, `${pathname} must not exist for administrators`)
  }
  // Even an administrator's own vault is separate: the citizen's document is not theirs.
  const asAdmin = await request(`/api/account/documents/${documentId}`, {}, adminCookie)
  assert.equal(asAdmin.status, 404)
})
