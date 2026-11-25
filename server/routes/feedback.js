/**
 * Citizen feedback, feature suggestions and independent community surveys
 * (Prompt 70).
 *
 * Everything here is BetterGo platform feedback. It is never presented as an
 * LGU complaint, consultation or official survey, and results are only shown
 * when enough real responses exist to protect the people who answered.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, forbidden, notFound, reference, slugify, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

export const FEEDBACK_STATUSES = {
  new: 'New',
  reviewing: 'Under review',
  responded: 'Responded',
  duplicate: 'Duplicate',
  spam: 'Spam',
  archived: 'Archived',
}

export const SUGGESTION_STATUSES = {
  submitted: 'Submitted',
  under_review: 'Under review',
  accepted: 'Accepted for consideration',
  planned: 'Planned',
  in_development: 'In development',
  implemented: 'Implemented',
  declined: 'Declined',
  archived: 'Archived',
}

export const QUESTION_TYPES = ['short_text', 'long_text', 'single_choice', 'multiple_choice', 'dropdown', 'rating', 'yes_no', 'date', 'ranking']

export const MIN_RESULT_THRESHOLD = 5

const DISCLAIMER =
  'This is BetterGo platform feedback or an independent BetterGo community survey. It is not an official LGU complaint, consultation or survey.'

function notify(userId, title, message, type = 'account') {
  if (!userId) return
  const prefs = get(`SELECT in_app_enabled FROM notification_preferences WHERE user_id = ?`, [userId])
  if (prefs && Number(prefs.in_app_enabled) === 0) return
  run(`INSERT INTO notifications (user_id, title, message, notification_type, category) VALUES (?, ?, ?, ?, 'account')`, [
    userId,
    title,
    message,
    type,
  ])
}

function scopeWhere(req, alias = 'f') {
  const context = ctx(req)
  if (context.hasGlobalScope) return { sql: '1=1', params: [] }
  if (!context.municipalityIds.length) return { sql: '0', params: [] }
  return {
    sql: `${alias}.municipality_id IN (${context.municipalityIds.map(() => '?').join(',')})`,
    params: context.municipalityIds,
  }
}

function surveyOpen(survey) {
  if (survey.status !== 'published') return false
  const now = nowIso()
  if (survey.opens_at && String(survey.opens_at) > now) return false
  if (survey.closes_at && String(survey.closes_at) < now) return false
  return true
}

/* ------------------------------ Public routes --------------------------- */

export const feedbackRouter = Router()

feedbackRouter.get(
  '/feedback/categories',
  asyncHandler(async (_req, res) => {
    res.json({
      categories: all(`SELECT id, key, name, description FROM feedback_categories WHERE status = 'active' ORDER BY sort_order, name`),
      disclaimer: DISCLAIMER,
    })
  }),
)

const feedbackSchema = z.object({
  category: z.string().trim().min(2).max(60),
  title: z.string().trim().min(5).max(160),
  description: z.string().trim().min(20).max(5000),
  relatedFeature: z.string().trim().max(120).optional().or(z.literal('')),
  municipalityId: z.coerce.number().int().positive().optional().nullable(),
  rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
  anonymous: z.boolean().optional(),
})

feedbackRouter.post(
  '/feedback',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  validate(feedbackSchema),
  asyncHandler(async (req, res) => {
    const anonymous = Boolean(req.body.anonymous)
    if (!anonymous && !req.user) throw forbidden('Sign in to submit identified feedback, or choose anonymous feedback.')
    if (anonymous && req.user) {
      throw unprocessable('Anonymous feedback must be submitted while signed out so it cannot be linked to an account.')
    }
    const category = get(`SELECT id FROM feedback_categories WHERE key = ? AND status = 'active'`, [req.body.category])
    if (!category) throw unprocessable('Choose a valid feedback category.')
    if (req.body.municipalityId && !get(`SELECT id FROM municipalities WHERE id = ?`, [Number(req.body.municipalityId)])) {
      throw unprocessable('Choose a valid municipality.')
    }
    const ref = reference('BGFB')
    const id = Number(
      run(
        `INSERT INTO citizen_feedback (reference, user_id, anonymous, category_id, title, description, related_feature, municipality_id, rating)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ref,
          anonymous ? null : req.user.id,
          anonymous ? 1 : 0,
          category.id,
          cleanText(req.body.title, 160),
          cleanText(req.body.description, 5000),
          cleanText(req.body.relatedFeature, 120),
          req.body.municipalityId || null,
          req.body.rating || null,
        ],
      ).lastInsertRowid,
    )
    if (!anonymous) notify(req.user.id, `Feedback ${ref} received`, 'Thank you. The BetterGo team reviews platform feedback.', 'account')
    logAudit(req, { action: 'feedback.submitted', module: 'feedback', entityType: 'citizen_feedback', entityId: ref, newValues: { anonymous } })
    res.status(201).json({
      message: anonymous
        ? 'Anonymous feedback received. Because it is not linked to an account, we cannot ask you follow-up questions.'
        : 'Feedback received. You can track it in your account.',
      reference: ref,
      anonymous,
      disclaimer: DISCLAIMER,
    })
  }),
)

feedbackRouter.get(
  '/account/feedback',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      results: all(
        `SELECT f.reference, f.title, f.description, f.status, f.rating, f.admin_response, f.created_at, c.name AS category_name
         FROM citizen_feedback f LEFT JOIN feedback_categories c ON c.id = f.category_id
         WHERE f.user_id = ? ORDER BY f.id DESC`,
        [req.user.id],
      ).map((row) => ({ ...row, statusLabel: FEEDBACK_STATUSES[row.status] || row.status })),
      disclaimer: DISCLAIMER,
    })
  }),
)

feedbackRouter.get(
  '/feedback/suggestions',
  asyncHandler(async (req, res) => {
    const term = cleanText(req.query.q, 120)
    const params = []
    let extra = ''
    if (term) {
      extra = ' AND (s.title LIKE ? OR s.proposal LIKE ?)'
      params.push(`%${term}%`, `%${term}%`)
    }
    const rows = all(
      `SELECT s.id, s.reference, s.title, s.problem, s.proposal, s.status, s.created_at,
              c.name AS category_name,
              (SELECT COUNT(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id) AS votes
       FROM feature_suggestions s LEFT JOIN feedback_categories c ON c.id = s.category_id
       WHERE s.public = 1 ${extra} ORDER BY votes DESC, s.id DESC LIMIT 60`,
      params,
    )
    res.json({
      results: rows.map((row) => ({ ...row, statusLabel: SUGGESTION_STATUSES[row.status] || row.status })),
      note: 'These are citizen proposals, not approved platform development commitments.',
    })
  }),
)

feedbackRouter.post(
  '/feedback/suggestions/:id/vote',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 60 }),
  asyncHandler(async (req, res) => {
    const suggestion = get(`SELECT * FROM feature_suggestions WHERE id = ? AND public = 1`, [Number(req.params.id)])
    if (!suggestion) throw notFound('Suggestion not found.')
    const existing = get(`SELECT id FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?`, [suggestion.id, req.user.id])
    if (existing) {
      run(`DELETE FROM suggestion_votes WHERE id = ?`, [existing.id])
      return res.json({ message: 'Vote removed.', voted: false })
    }
    run(`INSERT INTO suggestion_votes (suggestion_id, user_id) VALUES (?, ?)`, [suggestion.id, req.user.id])
    res.status(201).json({ message: 'Vote recorded.', voted: true })
  }),
)

feedbackRouter.get(
  '/surveys',
  asyncHandler(async (req, res) => {
    const now = nowIso()
    const rows = all(
      `SELECT s.id, s.slug, s.title, s.description, s.category, s.audience, s.municipality_id, s.allow_anonymous,
              s.closes_at, m.name AS municipality_name
       FROM surveys s LEFT JOIN municipalities m ON m.id = s.municipality_id
       WHERE s.status = 'published'
         AND (s.opens_at IS NULL OR s.opens_at <= ?)
         AND (s.closes_at IS NULL OR s.closes_at >= ?)
       ORDER BY s.published_at DESC LIMIT 50`,
      [now, now],
    )
    const profile = req.user ? get(`SELECT municipality_id FROM user_profiles WHERE user_id = ?`, [req.user.id]) : null
    const visible = rows.filter((row) => row.audience !== 'single_municipality' || !row.municipality_id || Number(row.municipality_id) === Number(profile?.municipality_id))
    res.json({
      results: visible,
      note: 'Surveys are published by the BetterGo platform unless the survey record states otherwise.',
    })
  }),
)

feedbackRouter.get(
  '/surveys/:slug',
  asyncHandler(async (req, res) => {
    const survey = get(
      `SELECT s.*, m.name AS municipality_name FROM surveys s LEFT JOIN municipalities m ON m.id = s.municipality_id WHERE s.slug = ?`,
      [String(req.params.slug)],
    )
    if (!survey || !surveyOpen(survey)) throw notFound('Survey not found or no longer open.')
    const questions = all(`SELECT id, question_key, label, question_type, options, required, sort_order FROM survey_questions WHERE survey_id = ? ORDER BY sort_order, id`, [survey.id])
    res.json({
      survey: {
        slug: survey.slug,
        title: survey.title,
        description: survey.description,
        category: survey.category,
        intro: survey.intro,
        privacyNotice: survey.privacy_notice,
        completionMessage: survey.completion_message,
        closesAt: survey.closes_at,
        allowAnonymous: Boolean(survey.allow_anonymous),
        municipalityName: survey.municipality_name,
        questions: questions.map((question) => ({ ...question, options: question.options ? JSON.parse(question.options) : null })),
      },
      disclaimer: 'This is an independent BetterGo community survey, not an official LGU survey or consultation.',
    })
  }),
)

const responseSchema = z.object({
  answers: z.record(z.string(), z.any()),
  anonymous: z.boolean().optional(),
})

feedbackRouter.post(
  '/account/surveys/:slug/responses',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }),
  validate(responseSchema),
  asyncHandler(async (req, res) => {
    const survey = get(`SELECT * FROM surveys WHERE slug = ?`, [String(req.params.slug)])
    if (!survey || !surveyOpen(survey)) throw notFound('Survey not found or no longer open.')
    if (survey.one_per_account) {
      const existing = get(`SELECT id FROM survey_responses WHERE survey_id = ? AND user_id = ?`, [survey.id, req.user.id])
      if (existing) throw unprocessable('This survey accepts one response per account, and you have already responded.')
    }
    const questions = all(`SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order`, [survey.id])
    const answers = []
    for (const question of questions) {
      const raw = req.body.answers[question.question_key]
      if (question.required && (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0))) {
        throw unprocessable(`Answer the required question: ${question.label}`)
      }
      if (raw === undefined || raw === null || raw === '') continue
      let value = raw
      if (['single_choice', 'dropdown', 'yes_no'].includes(question.question_type)) {
        const options = question.options ? JSON.parse(question.options) : []
        if (question.question_type === 'yes_no') {
          if (!['yes', 'no'].includes(String(raw))) throw unprocessable(`Choose yes or no for: ${question.label}`)
        } else if (options.length && !options.map(String).includes(String(raw))) {
          throw unprocessable(`Choose one of the listed options for: ${question.label}`)
        }
      }
      if (question.question_type === 'multiple_choice') {
        const options = question.options ? JSON.parse(question.options) : []
        if (!Array.isArray(raw)) throw unprocessable(`Choose one or more options for: ${question.label}`)
        if (options.length && raw.some((item) => !options.map(String).includes(String(item)))) {
          throw unprocessable(`Choose only listed options for: ${question.label}`)
        }
      }
      if (question.question_type === 'rating') {
        const number = Number(raw)
        if (!Number.isInteger(number) || number < 1 || number > 5) throw unprocessable(`Use a rating from 1 to 5 for: ${question.label}`)
        value = number
      }
      if (question.question_type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
        throw unprocessable(`Use a valid date for: ${question.label}`)
      }
      if (typeof value === 'string') value = cleanText(value, 3000)
      answers.push({ question, value })
    }
    const profile = get(`SELECT municipality_id FROM user_profiles WHERE user_id = ?`, [req.user.id])
    const responseId = Number(
      run(`INSERT INTO survey_responses (survey_id, user_id, anonymous, municipality_id) VALUES (?, ?, ?, ?)`, [
        survey.id,
        survey.allow_anonymous && req.body.anonymous ? null : req.user.id,
        survey.allow_anonymous && req.body.anonymous ? 1 : 0,
        profile?.municipality_id || null,
      ]).lastInsertRowid,
    )
    for (const answer of answers) {
      run(`INSERT INTO survey_answers (response_id, question_id, value) VALUES (?, ?, ?)`, [
        responseId,
        answer.question.id,
        Array.isArray(answer.value) ? JSON.stringify(answer.value) : String(answer.value),
      ])
    }
    notify(req.user.id, `Response to ${survey.title} recorded`, 'Thank you for participating in this BetterGo community survey.', 'account')
    logAudit(req, { action: 'feedback.survey_response', module: 'feedback', entityType: 'survey', entityId: survey.slug })
    res.status(201).json({
      message: survey.completion_message || 'Your response was recorded. Thank you.',
      responseId,
      note: 'Responses are voluntary and are not a representative sample of Marinduque residents.',
    })
  }),
)

feedbackRouter.get(
  '/account/surveys/history',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      results: all(
        `SELECT s.slug, s.title, r.created_at, r.anonymous FROM survey_responses r JOIN surveys s ON s.id = r.survey_id
         WHERE r.user_id = ? ORDER BY r.id DESC`,
        [req.user.id],
      ),
    })
  }),
)

feedbackRouter.get(
  '/account/suggestions',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      results: all(
        `SELECT s.reference, s.title, s.proposal, s.status, s.admin_note, s.public, s.created_at,
                (SELECT COUNT(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id) AS votes
         FROM feature_suggestions s WHERE s.user_id = ? ORDER BY s.id DESC`,
        [req.user.id],
      ).map((row) => ({ ...row, statusLabel: SUGGESTION_STATUSES[row.status] || row.status })),
    })
  }),
)

const suggestionSchema = z.object({
  category: z.string().trim().min(2).max(60),
  title: z.string().trim().min(5).max(160),
  problem: z.string().trim().max(2000).optional().or(z.literal('')),
  proposal: z.string().trim().min(20).max(3000),
})

feedbackRouter.post(
  '/account/suggestions',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  validate(suggestionSchema),
  asyncHandler(async (req, res) => {
    const category = get(`SELECT id FROM feedback_categories WHERE key = ? AND status = 'active'`, [req.body.category])
    if (!category) throw unprocessable('Choose a valid suggestion category.')
    const ref = reference('BGSUG')
    run(
      `INSERT INTO feature_suggestions (reference, user_id, category_id, title, problem, proposal) VALUES (?, ?, ?, ?, ?, ?)`,
      [ref, req.user.id, category.id, cleanText(req.body.title, 160), cleanText(req.body.problem, 2000), cleanText(req.body.proposal, 3000)],
    )
    res.status(201).json({
      message: 'Suggestion submitted. It becomes public only if a moderator publishes it.',
      reference: ref,
    })
  }),
)

feedbackRouter.delete(
  '/account/suggestions/:reference',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM feature_suggestions WHERE reference = ? AND user_id = ?`, [String(req.params.reference), req.user.id])
    if (!row) throw notFound('Suggestion not found.')
    if (row.status !== 'submitted') throw unprocessable('Only a suggestion that is still under initial review can be withdrawn.')
    run(`DELETE FROM feature_suggestions WHERE id = ?`, [row.id])
    res.json({ message: 'Suggestion withdrawn.' })
  }),
)

/* ------------------------------ Admin routes ---------------------------- */

export const adminFeedbackRouter = Router()
adminFeedbackRouter.use(requireAuth, requireAdmin)

adminFeedbackRouter.get(
  '/feedback',
  requirePermission('reports.view'),
  asyncHandler(async (req, res) => {
    const status = FEEDBACK_STATUSES[String(req.query.status)] ? String(req.query.status) : null
    const category = cleanText(req.query.category, 60)
    const scope = scopeWhere(req, 'f')
    const clauses = [scope.sql]
    const params = [...scope.params]
    if (status) {
      clauses.push('f.status = ?')
      params.push(status)
    }
    if (category) {
      clauses.push('c.key = ?')
      params.push(category)
    }
    const rows = all(
      `SELECT f.reference, f.anonymous, f.title, f.description, f.related_feature, f.rating, f.status, f.admin_response,
              f.created_at, c.name AS category_name, m.name AS municipality_name,
              CASE WHEN f.anonymous = 1 THEN NULL ELSE u.email END AS citizen_email
       FROM citizen_feedback f
       LEFT JOIN feedback_categories c ON c.id = f.category_id
       LEFT JOIN municipalities m ON m.id = f.municipality_id
       LEFT JOIN users u ON u.id = f.user_id
       WHERE ${clauses.join(' AND ')} ORDER BY f.id DESC LIMIT 100`,
      params,
    )
    res.json({
      results: rows.map((row) => ({ ...row, statusLabel: FEEDBACK_STATUSES[row.status] || row.status })),
      statuses: FEEDBACK_STATUSES,
      note: 'Anonymous feedback never shows an account identity, even to administrators.',
    })
  }),
)

adminFeedbackRouter.patch(
  '/feedback/:reference',
  requirePermission('reports.view'),
  validate(
    z.object({
      status: z.enum(Object.keys(FEEDBACK_STATUSES)).optional(),
      response: z.string().trim().max(2000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM citizen_feedback WHERE reference = ?`, [String(req.params.reference)])
    if (!row) throw notFound('Feedback not found.')
    const context = ctx(req)
    if (!context.hasGlobalScope && !(row.municipality_id && canUseMunicipality(context, row.municipality_id))) {
      throw notFound('Feedback not found.')
    }
    run(`UPDATE citizen_feedback SET status = ?, admin_response = COALESCE(?, admin_response), archived_at = CASE WHEN ? = 'archived' THEN ? ELSE archived_at END, updated_at = ? WHERE id = ?`, [
      req.body.status || row.status,
      cleanText(req.body.response, 2000),
      req.body.status || row.status,
      nowIso(),
      nowIso(),
      row.id,
    ])
    if (row.user_id && req.body.response) {
      notify(row.user_id, `Response to feedback ${row.reference}`, req.body.response.slice(0, 400), 'account')
    }
    logAudit(req, { action: 'feedback.moderated', module: 'feedback', entityType: 'citizen_feedback', entityId: row.reference })
    res.json({ message: 'Feedback updated.' })
  }),
)

adminFeedbackRouter.get(
  '/suggestions',
  requirePermission('reports.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(
        `SELECT s.*, c.name AS category_name, u.email AS citizen_email,
                (SELECT COUNT(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id) AS votes
         FROM feature_suggestions s LEFT JOIN feedback_categories c ON c.id = s.category_id
         LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 100`,
      ),
      statuses: SUGGESTION_STATUSES,
    })
  }),
)

adminFeedbackRouter.patch(
  '/suggestions/:id',
  requirePermission('reports.view'),
  validate(
    z.object({
      status: z.enum(Object.keys(SUGGESTION_STATUSES)).optional(),
      note: z.string().trim().max(1000).optional(),
      public: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM feature_suggestions WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Suggestion not found.')
    if (['declined', 'archived'].includes(req.body.status) && !req.body.note && !row.admin_note) {
      throw unprocessable('Explain why the suggestion is declined or archived.')
    }
    run(`UPDATE feature_suggestions SET status = ?, admin_note = COALESCE(?, admin_note), public = COALESCE(?, public), updated_at = ? WHERE id = ?`, [
      req.body.status || row.status,
      cleanText(req.body.note, 1000),
      req.body.public === undefined ? null : req.body.public ? 1 : 0,
      nowIso(),
      row.id,
    ])
    if (req.body.status && req.body.status !== row.status) {
      notify(row.user_id, `Suggestion ${row.reference}: ${SUGGESTION_STATUSES[req.body.status]}`, 'The BetterGo team updated your feature suggestion.', 'account')
    }
    logAudit(req, { action: 'feedback.suggestion_updated', module: 'feedback', entityType: 'feature_suggestion', entityId: row.reference })
    res.json({ message: 'Suggestion updated. Implemented must only be used when the feature actually exists.' })
  }),
)

const questionSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{2,40}$/),
  label: z.string().trim().min(3).max(300),
  type: z.enum(QUESTION_TYPES),
  options: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  required: z.boolean().optional(),
})

const surveySchema = z.object({
  title: z.string().trim().min(5).max(160),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  category: z.string().trim().max(80).optional().or(z.literal('')),
  audience: z.enum(['all_citizens', 'single_municipality']).default('all_citizens'),
  municipalityId: z.coerce.number().int().positive().optional().nullable(),
  intro: z.string().trim().max(2000).optional().or(z.literal('')),
  privacyNotice: z.string().trim().max(2000).optional().or(z.literal('')),
  completionMessage: z.string().trim().max(500).optional().or(z.literal('')),
  allowAnonymous: z.boolean().optional(),
  onePerAccount: z.boolean().optional(),
  opensAt: z.string().trim().max(40).optional().or(z.literal('')),
  closesAt: z.string().trim().max(40).optional().or(z.literal('')),
  questions: z.array(questionSchema).min(1).max(50),
})

adminFeedbackRouter.get(
  '/surveys',
  requirePermission('cms.manage'),
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(
        `SELECT s.*, m.name AS municipality_name,
                (SELECT COUNT(*) FROM survey_questions q WHERE q.survey_id = s.id) AS question_count,
                (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.id) AS response_count
         FROM surveys s LEFT JOIN municipalities m ON m.id = s.municipality_id ORDER BY s.id DESC`,
      ),
      note: 'Publishing a survey does not make it an official LGU survey.',
    })
  }),
)

adminFeedbackRouter.post(
  '/surveys',
  requirePermission('cms.manage'),
  validate(surveySchema),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    if (req.body.municipalityId && !context.hasGlobalScope && !canUseMunicipality(context, req.body.municipalityId)) {
      throw forbidden('You can only create surveys for your assigned municipality.')
    }
    const base = slugify(req.body.title) || `survey-${Date.now()}`
    let slug = base
    let n = 2
    while (get(`SELECT id FROM surveys WHERE slug = ?`, [slug])) slug = `${base}-${n++}`
    const id = Number(
      run(
        `INSERT INTO surveys (slug, title, description, category, audience, municipality_id, intro, privacy_notice, completion_message, allow_anonymous, one_per_account, opens_at, closes_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          slug,
          cleanText(req.body.title, 160),
          cleanText(req.body.description, 1000),
          cleanText(req.body.category, 80),
          req.body.audience,
          req.body.audience === 'single_municipality' ? req.body.municipalityId || null : null,
          cleanText(req.body.intro, 2000),
          cleanText(req.body.privacyNotice, 2000),
          cleanText(req.body.completionMessage, 500),
          req.body.allowAnonymous ? 1 : 0,
          req.body.onePerAccount === false ? 0 : 1,
          req.body.opensAt || null,
          req.body.closesAt || null,
          req.user.id,
        ],
      ).lastInsertRowid,
    )
    req.body.questions.forEach((question, index) => {
      run(
        `INSERT INTO survey_questions (survey_id, question_key, label, question_type, options, required, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, question.key, cleanText(question.label, 300), question.type, question.options ? JSON.stringify(question.options) : null, question.required ? 1 : 0, index],
      )
    })
    logAudit(req, { action: 'feedback.survey_created', module: 'feedback', entityType: 'survey', entityId: slug })
    res.status(201).json({ message: 'Survey created as a draft.', id, slug })
  }),
)

adminFeedbackRouter.post(
  '/surveys/:id/publish',
  requirePermission('cms.manage'),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM surveys WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Survey not found.')
    if (row.status === 'published') throw unprocessable('This survey is already published.')
    run(`UPDATE surveys SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), row.id])
    res.json({ message: 'Survey published. It is a BetterGo community survey, not an official LGU survey.' })
  }),
)

adminFeedbackRouter.post(
  '/surveys/:id/close',
  requirePermission('cms.manage'),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM surveys WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Survey not found.')
    run(`UPDATE surveys SET status = 'closed', updated_at = ? WHERE id = ?`, [nowIso(), row.id])
    res.json({ message: 'Survey closed. Submitted responses are unchanged.' })
  }),
)

adminFeedbackRouter.get(
  '/surveys/:id/results',
  requirePermission('cms.manage'),
  asyncHandler(async (req, res) => {
    const survey = get(`SELECT * FROM surveys WHERE id = ?`, [Number(req.params.id)])
    if (!survey) throw notFound('Survey not found.')
    const total = Number(get(`SELECT COUNT(*) AS n FROM survey_responses WHERE survey_id = ?`, [survey.id]).n)
    if (total < MIN_RESULT_THRESHOLD) {
      return res.json({
        survey: { title: survey.title, slug: survey.slug },
        total,
        suppressed: true,
        note: `Results are shown only after ${MIN_RESULT_THRESHOLD} responses, so individual participants cannot be identified.`,
      })
    }
    const questions = all(`SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order`, [survey.id])
    const results = questions.map((question) => {
      const answers = all(
        `SELECT a.value, COUNT(*) AS total FROM survey_answers a JOIN survey_responses r ON r.id = a.response_id
         WHERE r.survey_id = ? AND a.question_id = ? GROUP BY a.value ORDER BY total DESC`,
        [survey.id, question.id],
      )
      const options = question.options ? JSON.parse(question.options) : null
      const numeric = answers.map((row) => Number(row.value)).filter((value) => Number.isFinite(value))
      return {
        key: question.question_key,
        label: question.label,
        type: question.question_type,
        options,
        distribution: answers,
        average: question.question_type === 'rating' && numeric.length ? Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(2)) : null,
      }
    })
    res.json({
      survey: { title: survey.title, slug: survey.slug },
      total,
      suppressed: false,
      results,
      byMunicipality: all(
        `SELECT m.name AS municipality_name, COUNT(*) AS total FROM survey_responses r
         LEFT JOIN municipalities m ON m.id = r.municipality_id
         WHERE r.survey_id = ? GROUP BY m.name HAVING COUNT(*) >= ${MIN_RESULT_THRESHOLD}`,
        [survey.id],
      ),
      note: 'Voluntary responses are not a representative sample of Marinduque residents. Small groups are not broken down.',
    })
  }),
)

adminFeedbackRouter.get(
  '/feedback/analytics',
  requirePermission('reports.view'),
  asyncHandler(async (_req, res) => {
    const feedbackTotals = get(
      `SELECT COUNT(*) AS total, AVG(rating) AS average_rating, SUM(CASE WHEN anonymous = 1 THEN 1 ELSE 0 END) AS anonymous FROM citizen_feedback`,
    )
    res.json({
      feedback: {
        total: Number(feedbackTotals.total || 0),
        anonymous: Number(feedbackTotals.anonymous || 0),
        averageRating: feedbackTotals.average_rating ? Number(Number(feedbackTotals.average_rating).toFixed(2)) : null,
      },
      byCategory: all(
        `SELECT c.name AS category, COUNT(*) AS total FROM citizen_feedback f LEFT JOIN feedback_categories c ON c.id = f.category_id
         GROUP BY c.name ORDER BY total DESC`,
      ),
      suggestions: get(
        `SELECT COUNT(*) AS total,
                (SELECT COUNT(*) FROM suggestion_votes) AS votes,
                SUM(CASE WHEN public = 1 THEN 1 ELSE 0 END) AS published
         FROM feature_suggestions`,
      ),
      surveys: all(
        `SELECT s.title, s.slug, s.status,
                (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.id) AS responses
         FROM surveys s ORDER BY s.id DESC LIMIT 20`,
      ),
      note: 'These are BetterGo platform feedback and voluntary survey metrics, not government performance ratings.',
    })
  }),
)

adminFeedbackRouter.post(
  '/feedback/categories',
  requirePermission('cms.manage'),
  validate(z.object({ key: z.string().trim().regex(/^[a-z0-9_]{3,40}$/), name: z.string().trim().min(2).max(80), description: z.string().trim().max(300).optional() })),
  asyncHandler(async (req, res) => {
    if (get(`SELECT id FROM feedback_categories WHERE key = ?`, [req.body.key])) throw unprocessable('That category key already exists.')
    const id = Number(run(`INSERT INTO feedback_categories (key, name, description) VALUES (?, ?, ?)`, [req.body.key, cleanText(req.body.name, 80), cleanText(req.body.description, 300)]).lastInsertRowid)
    res.status(201).json({ message: 'Feedback category created.', id })
  }),
)
