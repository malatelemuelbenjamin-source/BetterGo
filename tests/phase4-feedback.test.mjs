/**
 * Prompt 70 — feedback, suggestions and surveys: identification rules,
 * moderation, votes, survey eligibility, duplicate prevention, result
 * thresholds and scope.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'

const PORT = 4625
const BASE = `http://127.0.0.1:${PORT}`
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-p4feedback-'))
const DB_PATH = path.join(DB_DIR, 'test.db')
const PASSWORD = 'Marinduque#Test2026'

let child
let cookie = ''
let adminCookie = ''
let scopedCookie = ''
let surveyId = null
let suggestionId = null
let suggestionReference = null
let feedbackReference = null

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
    json: { firstName, lastName: 'Feedback', email, password: PASSWORD, confirmPassword: PASSWORD, municipalityId, acceptTerms: true, acceptPrivacy: true },
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
    },
    stdio: 'ignore',
  })
  await waitForServer()

  for (const [email, name, municipality] of [
    ['p4feedback-citizen@example.com', 'Citizen', 1],
    ['p4feedback-two@example.com', 'Two', 1],
    ['p4feedback-three@example.com', 'Three', 1],
    ['p4feedback-four@example.com', 'Four', 1],
    ['p4feedback-five@example.com', 'Five', 1],
  ]) await register(email, name, municipality)

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA busy_timeout = 5000')
  const hash = bcrypt.hashSync(PASSWORD, 10)
  const insertUser = (name, email) =>
    Number(db.prepare(`INSERT INTO users (name, email, password_hash, email_verified_at, account_status) VALUES (?, ?, ?, datetime('now'), 'active')`).run(name, email, hash).lastInsertRowid)
  const adminId = insertUser('Feedback Admin', 'p4feedback-admin@example.com')
  const scopedId = insertUser('Mogpog Admin', 'p4feedback-scoped@example.com')
  const superRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'super_admin'`).get().id
  const municipalRole = db.prepare(`SELECT id FROM user_roles WHERE slug = 'municipal_admin'`).get().id
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'global', NULL, 'active')`).run(adminId, superRole)
  db.prepare(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, status) VALUES (?, ?, 'municipality', 2, 'active')`).run(scopedId, municipalRole)
  db.close()

  cookie = await login('p4feedback-citizen@example.com')
  adminCookie = await login('p4feedback-admin@example.com')
  scopedCookie = await login('p4feedback-scoped@example.com')
})

after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(DB_DIR, { recursive: true, force: true })
})

test('feedback categories are platform-managed', async () => {
  const body = await (await request('/api/feedback/categories')).json()
  assert.equal(body.categories.length, 12)
  assert.match(body.disclaimer, /not an official LGU complaint/i)
})

test('identified feedback needs an account; anonymous is genuinely unlinked', async () => {
  const anonymousWithoutFlag = await request('/api/feedback', {
    json: { category: 'website_usability', title: 'Menu is confusing', description: 'I could not find the service directory from the home page.' },
  }, '')
  assert.equal(anonymousWithoutFlag.status, 403)

  const anonymous = await request('/api/feedback', {
    json: { category: 'website_usability', title: 'Menu is confusing', description: 'I could not find the service directory from the home page.', anonymous: true },
  }, '')
  const anonBody = await anonymous.json()
  assert.equal(anonymous.status, 201, JSON.stringify(anonBody))
  assert.match(anonBody.message, /cannot ask you follow-up/i)

  const linkedAnonymous = await request('/api/feedback', {
    json: { category: 'website_usability', title: 'Hidden identity', description: 'Trying to hide my account from administrators here.', anonymous: true },
  })
  assert.equal(linkedAnonymous.status, 422)

  const identified = await request('/api/feedback', {
    json: { category: 'accessibility', title: 'Keyboard focus issue', description: 'The filter buttons lose keyboard focus after a search.' },
  })
  const body = await identified.json()
  assert.equal(identified.status, 201, JSON.stringify(body))
  feedbackReference = body.reference

  const history = await (await request('/api/account/feedback')).json()
  assert.equal(history.results.length, 1)
  assert.equal(history.results[0].reference, feedbackReference)
})

test('anonymous feedback never exposes an identity through administration', async () => {
  const list = await (await request('/api/admin/feedback', {}, adminCookie)).json()
  const anonymousRows = list.results.filter((row) => row.anonymous === 1)
  assert.equal(anonymousRows.length, 1)
  assert.equal(anonymousRows[0].citizen_email, null)

  const scoped = await request(`/api/admin/feedback/${feedbackReference}`, { method: 'PATCH', json: { status: 'reviewing' } }, scopedCookie)
  assert.equal(scoped.status, 404, 'feedback from another municipality is hidden')
})

test('moderators can respond and the citizen is notified', async () => {
  const response = await request(`/api/admin/feedback/${feedbackReference}`, {
    method: 'PATCH',
    json: { status: 'responded', response: 'We are fixing the keyboard focus order.' },
  }, adminCookie)
  assert.equal(response.status, 200, await response.text())

  const history = await (await request('/api/account/feedback')).json()
  assert.equal(history.results[0].admin_response, 'We are fixing the keyboard focus order.')

  const notifications = await (await request('/api/account/notifications')).json()
  assert.equal(notifications.results.some((note) => /Response to feedback/.test(note.title)), true)
})

test('suggestions stay private until moderated and can be voted once', async () => {
  const created = await request('/api/account/suggestions', {
    json: { category: 'feature_request', title: 'Add a service comparison view', problem: 'Comparing requirements is slow.', proposal: 'Let citizens compare two published services side by side.' },
  })
  const body = await created.json()
  assert.equal(created.status, 201, JSON.stringify(body))
  suggestionReference = body.reference

  const publicList = await (await request('/api/feedback/suggestions')).json()
  assert.equal(publicList.results.length, 0)

  const adminList = await (await request('/api/admin/suggestions', {}, adminCookie)).json()
  suggestionId = adminList.results[0].id

  const publish = await request(`/api/admin/suggestions/${suggestionId}`, { method: 'PATCH', json: { public: true, status: 'under_review' } }, adminCookie)
  assert.equal(publish.status, 200)

  const visible = await (await request('/api/feedback/suggestions')).json()
  assert.equal(visible.results.length, 1)
  assert.match(visible.note, /not approved platform development commitments/i)

  const vote = await request(`/api/feedback/suggestions/${suggestionId}/vote`, { method: 'POST', json: {} })
  assert.equal(vote.status, 201)
  const unvote = await request(`/api/feedback/suggestions/${suggestionId}/vote`, { method: 'POST', json: {} })
  assert.equal(unvote.status, 200)
  assert.equal((await unvote.json()).voted, false)

  const counted = await (await request('/api/feedback/suggestions')).json()
  assert.equal(counted.results[0].votes, 0)
})

test('a suggestion can only be withdrawn while still in initial review', async () => {
  const withdraw = await request(`/api/account/suggestions/${suggestionReference}`, { method: 'DELETE' })
  assert.equal(withdraw.status, 422)
})

test('declining a suggestion requires an explanation', async () => {
  const missing = await request(`/api/admin/suggestions/${suggestionId}`, { method: 'PATCH', json: { status: 'declined' } }, adminCookie)
  assert.equal(missing.status, 422)
  const explained = await request(`/api/admin/suggestions/${suggestionId}`, { method: 'PATCH', json: { status: 'declined', note: 'Not planned for this year.' } }, adminCookie)
  assert.equal(explained.status, 200)
})

test('surveys are drafted, published and listed only while open', async () => {
  const created = await request('/api/admin/surveys', {
    json: {
      title: 'BetterGo service finder experience',
      description: 'Quick feedback about finding services.',
      category: 'usability',
      audience: 'all_citizens',
      privacyNotice: 'Responses are voluntary and stored on BetterGo.',
      questions: [
        { key: 'ease', label: 'How easy was it to find a service?', type: 'rating', required: true },
        { key: 'used_for', label: 'What did you use it for?', type: 'single_choice', options: ['Personal need', 'Family member', 'Community work'], required: false },
      ],
    },
  }, adminCookie)
  const body = await created.json()
  assert.equal(created.status, 201, JSON.stringify(body))
  surveyId = body.id

  const beforePublish = await (await request('/api/surveys')).json()
  assert.equal(beforePublish.results.length, 0)

  const published = await request(`/api/admin/surveys/${surveyId}/publish`, { method: 'POST', json: {} }, adminCookie)
  assert.equal(published.status, 200)

  const list = await (await request('/api/surveys')).json()
  assert.equal(list.results.length, 1)

  const detail = await (await request(`/api/surveys/${body.slug}`)).json()
  assert.equal(detail.survey.questions.length, 2)
  assert.match(detail.disclaimer, /not an official LGU survey/i)
})

test('survey responses validate answers and prevent duplicates', async () => {
  const slug = (await (await request('/api/surveys', {}, adminCookie)).json()).results[0].slug

  const missing = await request(`/api/account/surveys/${slug}/responses`, { json: { answers: {} } })
  assert.equal(missing.status, 422)

  const badOption = await request(`/api/account/surveys/${slug}/responses`, {
    json: { answers: { ease: 4, used_for: 'Not an option' } },
  })
  assert.equal(badOption.status, 422)

  const accepted = await request(`/api/account/surveys/${slug}/responses`, {
    json: { answers: { ease: 4, used_for: 'Personal need' } },
  })
  assert.equal(accepted.status, 201, await accepted.text())

  const duplicate = await request(`/api/account/surveys/${slug}/responses`, {
    json: { answers: { ease: 5 } },
  })
  assert.equal(duplicate.status, 422)

  const history = await (await request('/api/account/surveys/history')).json()
  assert.equal(history.results.length, 1)
})

test('results stay suppressed until the privacy threshold is reached', async () => {
  const suppressed = await (await request(`/api/admin/surveys/${surveyId}/results`, {}, adminCookie)).json()
  assert.equal(suppressed.suppressed, true)
  assert.match(suppressed.note, /cannot be identified/i)

  for (const [email] of [
    ['p4feedback-two@example.com'],
    ['p4feedback-three@example.com'],
    ['p4feedback-four@example.com'],
    ['p4feedback-five@example.com'],
  ]) {
    const session = await login(email)
    const slug = (await (await request('/api/surveys', {}, session)).json()).results[0].slug
    const response = await request(`/api/account/surveys/${slug}/responses`, { json: { answers: { ease: 5 } } }, session)
    assert.equal(response.status, 201, await response.text())
  }

  const results = await (await request(`/api/admin/surveys/${surveyId}/results`, {}, adminCookie)).json()
  assert.equal(results.suppressed, false)
  assert.equal(results.total, 5)
  const rating = results.results.find((row) => row.key === 'ease')
  assert.equal(rating.average >= 4 && rating.average <= 5, true)
  assert.equal(rating.distribution.reduce((sum, row) => sum + Number(row.total), 0), 5)
  assert.match(results.note, /not a representative sample/i)
})

test('citizens cannot reach moderation or survey analytics', async () => {
  for (const pathname of ['/api/admin/feedback', '/api/admin/suggestions', '/api/admin/surveys', `/api/admin/surveys/${surveyId}/results`]) {
    const response = await request(pathname, {}, cookie)
    assert.equal([401, 403].includes(response.status), true, pathname)
  }
})

test('feedback analytics use stored rows and are clearly labelled', async () => {
  const analytics = await (await request('/api/admin/feedback/analytics', {}, adminCookie)).json()
  assert.equal(analytics.feedback.total >= 2, true)
  assert.equal(analytics.feedback.anonymous, 1)
  assert.match(analytics.note, /not government performance ratings/i)
})
