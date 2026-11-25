/**
 * Prompt 114 — moderated transparency questions and community discussion.
 *
 * All submissions are plain text, held for review, and screened for personal
 * information and unsafe links. Contributor expertise is never granted
 * automatically. Community content is not an official government statement.
 */
import { Router } from 'express'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { canUseMunicipality, ctx, requireAdmin, requirePermission } from '../rbac.js'
import { asyncHandler, cleanText, forbidden, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

export const COMMUNITY_STATUSES = ['pending_review', 'published', 'changes_requested', 'hidden', 'removed', 'under_appeal', 'restored']
export const CONTENT_REASONS = ['inaccurate', 'harassment', 'privacy', 'impersonation', 'spam', 'unsafe_link', 'confidential_document', 'other']
const REF = (prefix) => `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`
const PII = /(?:\+63|0)9\d{9}\b|\b\d{3}-\d{3}-\d{4}\b|\b[\w.+-]+@[\w-]+\.[\w.]+\b|\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/

const parse = (value, fallback) => { try { return JSON.parse(value || 'null') ?? fallback } catch { return fallback } }

function displayName(userId) {
  const contributor = get(`SELECT display_name FROM community_contributors WHERE user_id = ?`, [userId])
  return contributor?.display_name || 'Community member'
}

function validateContent(text, label = 'Contribution') {
  if (PII.test(text)) throw unprocessable(`${label} appears to contain a personal email address, phone number or government ID. Remove personal information before posting.`)
  if ((text.match(/https?:\/\//g) || []).length > 5) throw unprocessable('Too many links. Add the most relevant public sources instead.')
  return cleanText(text, 5000)
}

function safeUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw unprocessable('Only public http or https links are accepted.')
  return url.toString().slice(0, 500)
}

function shapeThread(row, { includeModeration = false } = {}) {
  const shape = {
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    title: row.title,
    body: row.body,
    topicSlug: row.topic_slug,
    topicTitle: row.topic_title || null,
    municipalityId: row.municipality_id,
    municipalityName: row.municipality_name || null,
    municipalitySlug: row.municipality_slug || null,
    recordReference: row.record_reference,
    author: displayName(row.user_id),
    authorIsContributor: Boolean(get(`SELECT id FROM community_contributors WHERE user_id = ?`, [row.user_id])),
    status: row.status,
    featured: Boolean(row.featured),
    answered: Boolean(row.answered_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    answers: Number(get(`SELECT COUNT(*) AS n FROM community_posts WHERE thread_id = ? AND status = 'published'`, [row.id]).n),
  }
  if (includeModeration) {
    shape.moderationNote = row.moderation_note
    shape.authorAccount = row.author_email ? 'Account identity restricted' : null
  }
  return shape
}

function shapePost(row, { includeModeration = false } = {}) {
  const shape = {
    id: row.id,
    threadId: row.thread_id,
    parentId: row.parent_id,
    body: row.body,
    author: displayName(row.user_id),
    createdAt: row.created_at,
    status: row.status,
    sources: all(`SELECT id, title, institution, url, published_on, verification_status FROM community_sources WHERE post_id = ? ORDER BY id`, [row.id]).map((source) => ({
      id: source.id,
      title: source.title,
      institution: source.institution,
      url: source.url,
      publishedOn: source.published_on,
      verificationStatus: source.verification_status,
      verificationLabel: source.verification_status === 'verified' ? 'Source reviewed by a moderator' : 'User-submitted source; not verified',
    })),
  }
  if (includeModeration) shape.moderationNote = row.moderation_note
  return shape
}

function notify(userId, title, message, entityType, entityId) {
  run(
    `INSERT INTO notifications (user_id, title, message, notification_type, category, related_entity_type, related_entity_id)
     VALUES (?, ?, ?, 'community', 'community', ?, ?)`,
    [userId, title, message, entityType, entityId],
  )
}

function canModerate(req, thread) {
  const context = ctx(req)
  if (context.hasGlobalScope) return true
  return Boolean(thread.municipality_id && canUseMunicipality(context, thread.municipality_id))
}

/* -------------------------------- Public -------------------------------- */

export const communityPublicRouter = Router()

communityPublicRouter.get(
  '/transparency/community/overview',
  asyncHandler(async (_req, res) => {
    const published = all(
      `SELECT t.*, m.name AS municipality_name, m.slug AS municipality_slug, c.title AS topic_title
       FROM community_threads t LEFT JOIN municipalities m ON m.id = t.municipality_id LEFT JOIN community_topics c ON c.slug = t.topic_slug
       WHERE t.status IN ('published','restored') ORDER BY t.featured DESC, t.created_at DESC LIMIT 20`,
    )
    res.json({
      topics: all(`SELECT * FROM community_topics WHERE active = 1 ORDER BY sort_order`).map((topic) => ({
        slug: topic.slug, title: topic.title, description: topic.description,
        threads: Number(get(`SELECT COUNT(*) AS n FROM community_threads WHERE topic_slug = ? AND status IN ('published','restored')`, [topic.slug]).n),
      })),
      recent: published.map((row) => shapeThread(row)),
      counts: {
        questions: Number(get(`SELECT COUNT(*) AS n FROM community_threads WHERE kind = 'question' AND status IN ('published','restored')`).n),
        discussions: Number(get(`SELECT COUNT(*) AS n FROM community_threads WHERE kind = 'discussion' AND status IN ('published','restored')`).n),
        unanswered: Number(get(`SELECT COUNT(*) AS n FROM community_threads WHERE kind = 'question' AND status IN ('published','restored') AND answered_at IS NULL`).n),
        contributors: Number(get(`SELECT COUNT(*) AS n FROM community_contributors`).n),
      },
      guidelines: [
        'Discuss published records and cite public sources.',
        'Do not post personal information, private documents, harassment or impersonation.',
        'An audit observation or data-quality finding is not automatically a final legal conclusion.',
        'Community content is moderated before publication and is not an official government response.',
      ],
      note: 'BetterGo community discussions are independent public conversations, not official government statements.',
    })
  }),
)

communityPublicRouter.get(
  '/transparency/community/topics',
  asyncHandler(async (_req, res) => {
    res.json({ topics: all(`SELECT * FROM community_topics WHERE active = 1 ORDER BY sort_order`) })
  }),
)

communityPublicRouter.get(
  '/transparency/community/threads',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 10))
    const clauses = [`t.status IN ('published','restored')`]
    const params = []
    if (['question', 'discussion'].includes(String(req.query.kind))) { clauses.push('t.kind = ?'); params.push(String(req.query.kind)) }
    if (req.query.topic) { clauses.push('t.topic_slug = ?'); params.push(String(req.query.topic)) }
    if (req.query.municipality) { clauses.push('m.slug = ?'); params.push(String(req.query.municipality)) }
    if (req.query.answered === 'yes') clauses.push('t.answered_at IS NOT NULL')
    if (req.query.answered === 'no') clauses.push('t.answered_at IS NULL')
    if (req.query.featured === '1') clauses.push('t.featured = 1')
    if (req.query.q) { clauses.push('(t.title LIKE ? OR t.body LIKE ?)'); params.push(`%${String(req.query.q).slice(0, 100)}%`, `%${String(req.query.q).slice(0, 100)}%`) }
    if (req.query.record) { clauses.push('t.record_reference = ?'); params.push(String(req.query.record)) }
    const where = `WHERE ${clauses.join(' AND ')}`
    const sort = req.query.sort === 'recent' ? 't.created_at DESC' : 't.featured DESC, t.updated_at DESC'
    const total = Number(get(`SELECT COUNT(*) AS n FROM community_threads t LEFT JOIN municipalities m ON m.id = t.municipality_id ${where}`, params).n)
    const rows = all(
      `SELECT t.*, m.name AS municipality_name, m.slug AS municipality_slug, c.title AS topic_title
       FROM community_threads t LEFT JOIN municipalities m ON m.id = t.municipality_id LEFT JOIN community_topics c ON c.slug = t.topic_slug
       ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    )
    res.json({
      results: rows.map((row) => shapeThread(row)), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)),
      topics: all(`SELECT slug, title FROM community_topics WHERE active = 1 ORDER BY sort_order`),
      note: 'Results are moderated public discussions. Popularity does not make an answer factually correct.',
    })
  }),
)

communityPublicRouter.get(
  '/transparency/community/threads/:reference',
  asyncHandler(async (req, res) => {
    const thread = get(
      `SELECT t.*, m.name AS municipality_name, m.slug AS municipality_slug, c.title AS topic_title
       FROM community_threads t LEFT JOIN municipalities m ON m.id = t.municipality_id LEFT JOIN community_topics c ON c.slug = t.topic_slug
       WHERE t.reference = ? AND t.status IN ('published','restored')`,
      [String(req.params.reference)],
    )
    if (!thread) throw notFound('Published discussion not found.')
    const posts = all(`SELECT * FROM community_posts WHERE thread_id = ? AND status IN ('published','restored') ORDER BY created_at`, [thread.id])
    res.json({
      thread: {
        ...shapeThread(thread),
        sources: all(`SELECT id, title, institution, url, published_on, verification_status FROM community_sources WHERE thread_id = ? ORDER BY id`, [thread.id]).map((source) => ({
          id: source.id,
          title: source.title,
          institution: source.institution,
          url: source.url,
          publishedOn: source.published_on,
          verificationStatus: source.verification_status,
          verificationLabel: source.verification_status === 'verified' ? 'Source reviewed by a moderator' : 'User-submitted source; not verified',
        })),
      },
      posts: posts.map((row) => shapePost(row)),
      note: 'Community answers are user contributions, not official findings. A verified source is labelled separately; no citation is invented.',
    })
  }),
)

communityPublicRouter.get(
  '/transparency/community/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      threads: all(`SELECT reference, kind, title, status, moderation_note, created_at, updated_at FROM community_threads WHERE user_id = ? ORDER BY id DESC LIMIT 100`, [req.user.id]),
      posts: all(`SELECT p.id, p.body, p.status, p.moderation_note, p.created_at, t.reference AS thread_reference FROM community_posts p JOIN community_threads t ON t.id = p.thread_id WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 100`, [req.user.id]),
      appeals: all(`SELECT reference, status, reason, decision_note, created_at FROM community_appeals WHERE user_id = ? ORDER BY id DESC`, [req.user.id]),
      note: 'Moderation notes shown here are visible only to you and authorised moderators.',
    })
  }),
)

communityPublicRouter.post(
  '/transparency/community/threads',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }),
  validate(z.object({
    kind: z.enum(['question', 'discussion']),
    title: z.string().trim().min(8).max(180),
    body: z.string().trim().min(20).max(5000),
    topicSlug: z.string().trim().min(2).max(60),
    municipalityId: z.coerce.number().int().positive().nullable().optional(),
    recordReference: z.string().trim().max(60).optional().or(z.literal('')),
    sourceUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
    sourceTitle: z.string().trim().max(180).optional().or(z.literal('')),
  })),
  asyncHandler(async (req, res) => {
    const topic = get(`SELECT * FROM community_topics WHERE slug = ? AND active = 1`, [req.body.topicSlug])
    if (!topic) throw unprocessable('Choose a supported discussion topic.')
    const body = validateContent(req.body.body)
    validateContent(req.body.title, 'Title')
    if (req.body.recordReference) {
      const record = get(`SELECT id FROM financial_records WHERE reference = ? AND publication_status = 'published'`, [req.body.recordReference])
      if (!record) throw unprocessable('Link only a published financial record.')
    }
    if (req.body.municipalityId) {
      const municipality = get(`SELECT id FROM municipalities WHERE id = ? AND is_active = 1`, [req.body.municipalityId])
      if (!municipality) throw notFound('Municipality not found.')
    }
    const duplicate = get(`SELECT id FROM community_threads WHERE user_id = ? AND title = ? AND created_at >= datetime('now', '-10 minutes')`, [req.user.id, cleanText(req.body.title, 180)])
    if (duplicate) throw unprocessable('A similar submission was just received. Please wait for moderation instead of posting it again.')
    const id = Number(run(
      `INSERT INTO community_threads (reference, kind, title, body, topic_slug, municipality_id, record_reference, user_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_review')`,
      [REF(req.body.kind === 'question' ? 'BG-Q' : 'BG-D'), req.body.kind, cleanText(req.body.title, 180), body, topic.slug, req.body.municipalityId ?? null, cleanText(req.body.recordReference, 60), req.user.id],
    ).lastInsertRowid)
    if (req.body.sourceUrl) {
      run(
        `INSERT INTO community_sources (thread_id, title, url, verification_status) VALUES (?, ?, ?, 'unverified')`,
        [id, cleanText(req.body.sourceTitle, 180) || 'Public source', safeUrl(req.body.sourceUrl)],
      )
    }
    logAudit(req, { action: 'transparency.community_thread_submitted', module: 'transparency', entityType: 'community_thread', entityId: id })
    res.status(201).json({
      message: 'Submitted for moderation. It is not public yet and does not constitute an official inquiry or complaint.',
      thread: { reference: get(`SELECT reference FROM community_threads WHERE id = ?`, [id]).reference, status: 'pending_review' },
    })
  }),
)

communityPublicRouter.post(
  '/transparency/community/threads/:reference/posts',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }),
  validate(z.object({
    body: z.string().trim().min(10).max(5000),
    parentId: z.coerce.number().int().positive().nullable().optional(),
    sourceUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
    sourceTitle: z.string().trim().max(180).optional().or(z.literal('')),
  })),
  asyncHandler(async (req, res) => {
    const thread = get(`SELECT * FROM community_threads WHERE reference = ? AND status IN ('published','restored')`, [String(req.params.reference)])
    if (!thread) throw notFound('Published discussion not found.')
    const body = validateContent(req.body.body, 'Answer')
    if (req.body.parentId) {
      const parent = get(`SELECT id FROM community_posts WHERE id = ? AND thread_id = ? AND status = 'published'`, [req.body.parentId, thread.id])
      if (!parent) throw unprocessable('The reply target is not a published answer in this discussion.')
    }
    const id = Number(run(
      `INSERT INTO community_posts (thread_id, parent_id, body, user_id, status) VALUES (?, ?, ?, ?, 'pending_review')`,
      [thread.id, req.body.parentId ?? null, body, req.user.id],
    ).lastInsertRowid)
    if (req.body.sourceUrl) {
      run(`INSERT INTO community_sources (post_id, title, url, verification_status) VALUES (?, ?, ?, 'unverified')`, [id, cleanText(req.body.sourceTitle, 180) || 'Public source', safeUrl(req.body.sourceUrl)])
    }
    logAudit(req, { action: 'transparency.community_post_submitted', module: 'transparency', entityType: 'community_post', entityId: id })
    res.status(201).json({ message: 'Answer submitted for moderation. It is not public yet.', post: { id, status: 'pending_review' } })
  }),
)

communityPublicRouter.post(
  '/transparency/community/reports',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  validate(z.object({
    targetType: z.enum(['thread', 'post']),
    targetId: z.coerce.number().int().positive(),
    reason: z.enum(CONTENT_REASONS),
    details: z.string().trim().max(1500).optional().or(z.literal('')),
  })),
  asyncHandler(async (req, res) => {
    const target = req.body.targetType === 'thread'
      ? get(`SELECT id, user_id, status FROM community_threads WHERE id = ?`, [req.body.targetId])
      : get(`SELECT id, user_id, status FROM community_posts WHERE id = ?`, [req.body.targetId])
    if (!target) throw notFound('Content not found.')
    if (target.user_id === req.user.id) throw unprocessable('You cannot report your own contribution.')
    const duplicate = get(`SELECT id FROM community_reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'`, [req.user.id, req.body.targetType, target.id])
    if (duplicate) throw unprocessable('You already have an open report for this content.')
    const id = Number(run(
      `INSERT INTO community_reports (reference, target_type, target_id, reason, details, reporter_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [REF('BG-CR'), req.body.targetType, target.id, req.body.reason, cleanText(req.body.details, 1500), req.user.id],
    ).lastInsertRowid)
    logAudit(req, { action: 'transparency.community_content_reported', module: 'transparency', entityType: 'community_report', entityId: id })
    res.status(201).json({ message: 'Report received. It is private and will be reviewed by a moderator.', reference: get(`SELECT reference FROM community_reports WHERE id = ?`, [id]).reference })
  }),
)

communityPublicRouter.post(
  '/transparency/community/appeals',
  requireAuth,
  validate(z.object({
    targetType: z.enum(['thread', 'post']),
    targetId: z.coerce.number().int().positive(),
    reason: z.string().trim().min(20).max(2000),
  })),
  asyncHandler(async (req, res) => {
    const table = req.body.targetType === 'thread' ? 'community_threads' : 'community_posts'
    const target = get(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`, [req.body.targetId, req.user.id])
    if (!target) throw notFound('Your moderated content was not found.')
    if (!['hidden', 'removed', 'changes_requested'].includes(target.status)) throw unprocessable('Only hidden, removed or changes-requested content can be appealed.')
    const duplicate = get(`SELECT id FROM community_appeals WHERE user_id = ? AND status = 'pending' AND thread_id IS ? AND post_id IS ?`, [req.user.id, req.body.targetType === 'thread' ? target.id : null, req.body.targetType === 'post' ? target.id : null])
    if (duplicate) throw unprocessable('An appeal for this content is already pending.')
    const id = Number(run(
      `INSERT INTO community_appeals (reference, thread_id, post_id, user_id, reason) VALUES (?, ?, ?, ?, ?)`,
      [REF('BG-AP'), req.body.targetType === 'thread' ? target.id : null, req.body.targetType === 'post' ? target.id : null, req.user.id, validateContent(req.body.reason, 'Appeal')],
    ).lastInsertRowid)
    run(`UPDATE ${table} SET status = 'under_appeal', updated_at = ? WHERE id = ?`, [nowIso(), target.id])
    logAudit(req, { action: 'transparency.community_appeal_submitted', module: 'transparency', entityType: 'community_appeal', entityId: id })
    res.status(201).json({ message: 'Appeal received. A moderator will review it; the content stays hidden meanwhile.', reference: get(`SELECT reference FROM community_appeals WHERE id = ?`, [id]).reference })
  }),
)

communityPublicRouter.get(
  '/transparency/community/experts',
  asyncHandler(async (_req, res) => {
    const rows = all(
      `SELECT c.display_name, c.bio, c.expertise, c.credentials_text, c.verification_status, c.verified_at
       FROM community_contributors c ORDER BY CASE c.verification_status WHEN 'verified' THEN 0 ELSE 1 END, c.display_name`,
    )
    res.json({
      experts: rows.map((row) => ({
        displayName: row.display_name,
        bio: row.bio,
        expertise: parse(row.expertise, []),
        credentials: row.credentials_text,
        verificationStatus: row.verification_status,
        verificationLabel: row.verification_status === 'verified' ? 'Credentials reviewed by a moderator' : 'Self-declared; not verified',
        verifiedAt: row.verified_at,
      })),
      note: 'Expertise is self-declared unless marked verified. A contributor does not represent an LGU, COA or any institution unless verified authorisation is recorded.',
    })
  }),
)

communityPublicRouter.get(
  '/transparency/community/guidelines',
  asyncHandler(async (_req, res) => {
    res.json({
      guidelines: [
        { title: 'Respectful civic discussion', detail: 'Disagree with evidence, not people. Harassment, threats and demeaning language are removed.' },
        { title: 'Cite public sources', detail: 'Link official documents or approved BetterGo records. A user-submitted link is labelled unverified until reviewed.' },
        { title: 'Facts and opinions', detail: 'Say when something is your interpretation. Popularity is not evidence.' },
        { title: 'Reading financial reports', detail: 'Proposed, approved, allotted, obligated, disbursed and actual amounts are different stages.' },
        { title: 'Audit observations', detail: 'An audit observation or data-quality finding is not automatically a final legal finding.' },
        { title: 'Privacy', detail: 'Do not publish personal emails, phone numbers, addresses, IDs, taxpayer data or confidential documents.' },
        { title: 'Reporting problems', detail: 'Use the report button for harmful content or the monitoring observation form for a data discrepancy.' },
      ],
      moderation: 'Submissions are held for review. Moderators may publish, request changes, hide, remove or restore content, with a reason and an appeal route.',
      disclaimer: 'BetterGo community discussions are independent public conversations and do not constitute official government responses.',
    })
  }),
)

communityPublicRouter.put(
  '/transparency/community/contributors/me',
  requireAuth,
  validate(z.object({
    displayName: z.string().trim().min(2).max(80),
    bio: z.string().trim().max(1000).optional().or(z.literal('')),
    expertise: z.array(z.string().trim().min(2).max(80)).max(8).optional(),
    credentialsText: z.string().trim().max(500).optional().or(z.literal('')),
  })),
  asyncHandler(async (req, res) => {
    validateContent(req.body.bio || '', 'Biography')
    const existing = get(`SELECT * FROM community_contributors WHERE user_id = ?`, [req.user.id])
    if (existing) {
      run(`UPDATE community_contributors SET display_name = ?, bio = ?, expertise = ?, credentials_text = ?, updated_at = ? WHERE user_id = ?`, [
        cleanText(req.body.displayName, 80), cleanText(req.body.bio, 1000), JSON.stringify(req.body.expertise || []), cleanText(req.body.credentialsText, 500), nowIso(), req.user.id,
      ])
    } else {
      run(`INSERT INTO community_contributors (user_id, display_name, bio, expertise, credentials_text) VALUES (?, ?, ?, ?, ?)`, [
        req.user.id, cleanText(req.body.displayName, 80), cleanText(req.body.bio, 1000), JSON.stringify(req.body.expertise || []), cleanText(req.body.credentialsText, 500),
      ])
    }
    logAudit(req, { action: 'transparency.community_contributor_updated', module: 'transparency', entityType: 'community_contributor', entityId: req.user.id })
    res.json({ message: 'Public contributor profile saved. Credentials remain self-declared until a moderator reviews them.', contributor: get(`SELECT display_name, bio, expertise, credentials_text, verification_status FROM community_contributors WHERE user_id = ?`, [req.user.id]) })
  }),
)

/* --------------------------------- Admin -------------------------------- */

export const communityAdminRouter = Router()
communityAdminRouter.use(requireAuth, requireAdmin)

communityAdminRouter.get(
  '/transparency/community',
  requirePermission('transparency.view'),
  asyncHandler(async (req, res) => {
    const scoped = ctx(req).hasGlobalScope ? { sql: '', params: [] } : { sql: `WHERE (t.municipality_id IN (${ctx(req).municipalityIds.length ? ctx(req).municipalityIds.map(() => '?').join(',') : 'NULL'}) OR t.municipality_id IS NULL)`, params: ctx(req).municipalityIds }
    const threads = all(
      `SELECT t.*, m.name AS municipality_name, m.slug AS municipality_slug, c.title AS topic_title
       FROM community_threads t LEFT JOIN municipalities m ON m.id = t.municipality_id LEFT JOIN community_topics c ON c.slug = t.topic_slug
       ${scoped.sql} ORDER BY CASE t.status WHEN 'pending_review' THEN 0 WHEN 'under_appeal' THEN 1 ELSE 2 END, t.id DESC LIMIT 200`,
      scoped.params,
    )
    const context = ctx(req)
    const allowedThreadIds = new Set(threads.map((thread) => thread.id))
    const allowedPostIds = new Set(all(`SELECT p.id FROM community_posts p JOIN community_threads t ON t.id = p.thread_id WHERE t.municipality_id IN (${context.hasGlobalScope ? 'SELECT id FROM municipalities' : (context.municipalityIds.length ? context.municipalityIds.map(() => '?').join(',') : 'NULL')})`, context.hasGlobalScope ? [] : context.municipalityIds).map((row) => row.id))
    const reports = all(
      `SELECT r.*, CASE WHEN r.target_type = 'thread' THEN (SELECT title FROM community_threads WHERE id = r.target_id) ELSE (SELECT substr(body,1,120) FROM community_posts WHERE id = r.target_id) END AS target_label
       FROM community_reports r ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.id DESC LIMIT 200`,
    ).filter((row) => context.hasGlobalScope || (row.target_type === 'thread' ? allowedThreadIds.has(row.target_id) : allowedPostIds.has(row.target_id)))
      .slice(0, 100)
      .map((row) => ({ id: row.id, reference: row.reference, targetType: row.target_type, targetId: row.target_id, targetLabel: row.target_label, reason: row.reason, details: row.details, status: row.status, resolutionNote: row.resolution_note, createdAt: row.created_at, reporter: 'Identity restricted' }))
    res.json({
      summary: {
        pendingThreads: threads.filter((row) => row.status === 'pending_review').length,
        pendingPosts: Number(get(`SELECT COUNT(*) AS n FROM community_posts WHERE status = 'pending_review'`).n),
        openReports: reports.filter((row) => row.status === 'open').length,
        openAppeals: Number(get(`SELECT COUNT(*) AS n FROM community_appeals WHERE status = 'pending'`).n),
        contributors: Number(get(`SELECT COUNT(*) AS n FROM community_contributors`).n),
      },
      threads: threads.map((row) => ({ ...shapeThread(row, { includeModeration: true }), posts: all(`SELECT * FROM community_posts WHERE thread_id = ? ORDER BY id`, [row.id]).map((post) => shapePost(post, { includeModeration: true })) })),
      reports,
      appeals: all(`SELECT a.*, t.reference AS thread_reference, t.title FROM community_appeals a LEFT JOIN community_threads t ON t.id = a.thread_id ORDER BY a.id DESC LIMIT 100`).map((row) => ({ id: row.id, reference: row.reference, threadReference: row.thread_reference, title: row.title, reason: row.reason, status: row.status, decisionNote: row.decision_note, createdAt: row.created_at, appellant: 'Identity restricted' })),
      contributors: ctx(req).hasGlobalScope
        ? all(`SELECT c.id, c.display_name, c.bio, c.expertise, c.credentials_text, c.verification_status, c.created_at FROM community_contributors c ORDER BY c.id DESC`).map((row) => ({ ...row, expertise: parse(row.expertise, []) }))
        : [],
      sources: all(`SELECT s.*, t.reference AS thread_reference FROM community_sources s LEFT JOIN community_threads t ON t.id = s.thread_id ORDER BY s.id DESC LIMIT 100`),
      topics: all(`SELECT * FROM community_topics ORDER BY sort_order`),
      statuses: COMMUNITY_STATUSES,
      reasons: CONTENT_REASONS,
      note: 'Reports, appeals and reviewer notes are private. Municipality-scoped moderators see only content in their municipalities and provincial public content they are authorised to review.',
    })
  }),
)

communityAdminRouter.patch(
  '/transparency/community/threads/:id',
  requirePermission('transparency.data.approve'),
  validate(z.object({ action: z.enum(['publish', 'request_changes', 'hide', 'remove', 'restore', 'feature', 'unfeature']), note: z.string().trim().max(1000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const thread = get(`SELECT * FROM community_threads WHERE id = ?`, [Number(req.params.id)])
    if (!thread || !canModerate(req, thread)) throw notFound('Discussion not found.')
    const note = cleanText(req.body.note, 1000)
    if (['request_changes', 'hide', 'remove'].includes(req.body.action) && (!note || note.length < 5)) throw unprocessable('Explain the moderation decision so the author can understand and appeal it.')
    const action = req.body.action
    if (action === 'publish') {
      if (thread.status === 'removed') throw unprocessable('A removed discussion cannot be published; use restore after review.')
      run(`UPDATE community_threads SET status = 'published', moderation_note = ?, updated_at = ? WHERE id = ?`, [note, nowIso(), thread.id])
      notify(thread.user_id, 'Your transparency question was published', 'A moderator published your contribution. Community content is not an official government response.', 'community_thread', thread.id)
    } else if (action === 'request_changes') {
      run(`UPDATE community_threads SET status = 'changes_requested', moderation_note = ?, updated_at = ? WHERE id = ?`, [note, nowIso(), thread.id])
      notify(thread.user_id, 'Changes requested for your transparency contribution', note, 'community_thread', thread.id)
    } else if (action === 'hide') {
      run(`UPDATE community_threads SET status = 'hidden', moderation_note = ?, updated_at = ? WHERE id = ?`, [note, nowIso(), thread.id])
      notify(thread.user_id, 'Your transparency contribution was hidden', `${note} You may appeal this decision from your community page.`, 'community_thread', thread.id)
    } else if (action === 'remove') {
      run(`UPDATE community_threads SET status = 'removed', moderation_note = ?, updated_at = ? WHERE id = ?`, [note, nowIso(), thread.id])
      notify(thread.user_id, 'Your transparency contribution was removed', `${note} You may appeal this decision from your community page.`, 'community_thread', thread.id)
    } else if (action === 'restore') {
      run(`UPDATE community_threads SET status = 'restored', moderation_note = ?, updated_at = ? WHERE id = ?`, [note, nowIso(), thread.id])
      notify(thread.user_id, 'Your transparency contribution was restored', note || 'A moderator restored your contribution.', 'community_thread', thread.id)
    } else if (action === 'feature') run(`UPDATE community_threads SET featured = 1, updated_at = ? WHERE id = ?`, [nowIso(), thread.id])
    else run(`UPDATE community_threads SET featured = 0, updated_at = ? WHERE id = ?`, [nowIso(), thread.id])
    run(`INSERT INTO community_moderation_log (actor_id, action, target_type, target_id, note) VALUES (?, ?, 'thread', ?, ?)`, [req.user.id, action, thread.id, note])
    logAudit(req, { action: `transparency.community_thread_${action}`, module: 'transparency', entityType: 'community_thread', entityId: thread.id, detail: note || undefined })
    res.json({ message: 'Moderation decision recorded.', thread: shapeThread(get(`SELECT t.*, m.name AS municipality_name, m.slug AS municipality_slug, c.title AS topic_title FROM community_threads t LEFT JOIN municipalities m ON m.id = t.municipality_id LEFT JOIN community_topics c ON c.slug = t.topic_slug WHERE t.id = ?`, [thread.id]), { includeModeration: true }) })
  }),
)

communityAdminRouter.patch(
  '/transparency/community/posts/:id',
  requirePermission('transparency.data.approve'),
  validate(z.object({ action: z.enum(['publish', 'request_changes', 'hide', 'remove', 'restore']), note: z.string().trim().max(1000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const post = get(`SELECT p.*, t.municipality_id FROM community_posts p JOIN community_threads t ON t.id = p.thread_id WHERE p.id = ?`, [Number(req.params.id)])
    if (!post || !canModerate(req, post)) throw notFound('Answer not found.')
    const note = cleanText(req.body.note, 1000)
    if (['request_changes', 'hide', 'remove'].includes(req.body.action) && (!note || note.length < 5)) throw unprocessable('Explain the moderation decision.')
    const status = { publish: 'published', request_changes: 'changes_requested', hide: 'hidden', remove: 'removed', restore: 'restored' }[req.body.action]
    run(`UPDATE community_posts SET status = ?, moderation_note = ?, updated_at = ? WHERE id = ?`, [status, note, nowIso(), post.id])
    if (status === 'published' || status === 'restored') run(`UPDATE community_threads SET answered_at = COALESCE(answered_at, ?) WHERE id = ?`, [nowIso(), post.thread_id])
    notify(post.user_id, `Your answer was ${req.body.action === 'publish' ? 'published' : req.body.action.replace('_', ' ')}`, note || 'A moderator updated your contribution.', 'community_post', post.id)
    run(`INSERT INTO community_moderation_log (actor_id, action, target_type, target_id, note) VALUES (?, ?, 'post', ?, ?)`, [req.user.id, req.body.action, post.id, note])
    logAudit(req, { action: `transparency.community_post_${req.body.action}`, module: 'transparency', entityType: 'community_post', entityId: post.id })
    res.json({ message: 'Answer moderation decision recorded.', post: shapePost(get(`SELECT * FROM community_posts WHERE id = ?`, [post.id]), { includeModeration: true }) })
  }),
)

communityAdminRouter.patch(
  '/transparency/community/sources/:id',
  requirePermission('transparency.data.approve'),
  validate(z.object({ action: z.enum(['verify', 'reject']), note: z.string().trim().max(500).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const source = get(`SELECT * FROM community_sources WHERE id = ?`, [Number(req.params.id)])
    if (!source) throw notFound('Source not found.')
    run(`UPDATE community_sources SET verification_status = ?, verified_by = ?, verified_at = ? WHERE id = ?`, [req.body.action === 'verify' ? 'verified' : 'rejected', req.user.id, nowIso(), source.id])
    logAudit(req, { action: `transparency.community_source_${req.body.action}`, module: 'transparency', entityType: 'community_source', entityId: source.id })
    res.json({ message: req.body.action === 'verify' ? 'Source marked reviewed. The citation itself was not altered.' : 'Source marked rejected; the user claim remains separate.', source: get(`SELECT * FROM community_sources WHERE id = ?`, [source.id]) })
  }),
)

communityAdminRouter.patch(
  '/transparency/community/reports/:id',
  requirePermission('transparency.data.approve'),
  validate(z.object({ action: z.enum(['resolve', 'dismiss']), note: z.string().trim().min(5).max(1000) })),
  asyncHandler(async (req, res) => {
    const report = get(`SELECT * FROM community_reports WHERE id = ?`, [Number(req.params.id)])
    if (!report) throw notFound('Report not found.')
    run(`UPDATE community_reports SET status = ?, resolution_note = ?, resolved_by = ?, updated_at = ? WHERE id = ?`, [req.body.action === 'resolve' ? 'resolved' : 'dismissed', cleanText(req.body.note, 1000), req.user.id, nowIso(), report.id])
    logAudit(req, { action: `transparency.community_report_${req.body.action}`, module: 'transparency', entityType: 'community_report', entityId: report.id })
    res.json({ message: 'Report decision recorded. Reporter and reviewer notes remain private.' })
  }),
)

communityAdminRouter.patch(
  '/transparency/community/appeals/:id',
  requirePermission('transparency.data.approve'),
  validate(z.object({ action: z.enum(['accept', 'reject']), note: z.string().trim().min(5).max(1000) })),
  asyncHandler(async (req, res) => {
    const appeal = get(`SELECT * FROM community_appeals WHERE id = ?`, [Number(req.params.id)])
    if (!appeal) throw notFound('Appeal not found.')
    const status = req.body.action === 'accept' ? 'accepted' : 'rejected'
    run(`UPDATE community_appeals SET status = ?, decision_note = ?, decided_by = ?, decided_at = ? WHERE id = ?`, [status, cleanText(req.body.note, 1000), req.user.id, nowIso(), appeal.id])
    if (appeal.thread_id) {
      run(`UPDATE community_threads SET status = ?, updated_at = ? WHERE id = ?`, [req.body.action === 'accept' ? 'restored' : 'hidden', nowIso(), appeal.thread_id])
      notify(appeal.user_id, `Appeal ${status}`, `${cleanText(req.body.note, 1000)}`, 'community_appeal', appeal.id)
    }
    if (appeal.post_id) {
      run(`UPDATE community_posts SET status = ?, updated_at = ? WHERE id = ?`, [req.body.action === 'accept' ? 'restored' : 'hidden', nowIso(), appeal.post_id])
      notify(appeal.user_id, `Appeal ${status}`, `${cleanText(req.body.note, 1000)}`, 'community_appeal', appeal.id)
    }
    run(`INSERT INTO community_moderation_log (actor_id, action, target_type, target_id, note) VALUES (?, ?, 'appeal', ?, ?)`, [req.user.id, req.body.action, appeal.id, req.body.note])
    logAudit(req, { action: `transparency.community_appeal_${req.body.action}`, module: 'transparency', entityType: 'community_appeal', entityId: appeal.id })
    res.json({ message: `Appeal ${status}.`, appeal: get(`SELECT * FROM community_appeals WHERE id = ?`, [appeal.id]) })
  }),
)

communityAdminRouter.patch(
  '/transparency/community/contributors/:id',
  requirePermission('transparency.data.approve'),
  validate(z.object({ action: z.enum(['verify', 'reject']), note: z.string().trim().max(500).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    if (!ctx(req).hasGlobalScope) throw forbidden('Credential verification is province-wide and cannot be performed by a municipal moderator.')
    const contributor = get(`SELECT * FROM community_contributors WHERE id = ?`, [Number(req.params.id)])
    if (!contributor) throw notFound('Contributor not found.')
    if (req.body.action === 'verify' && !contributor.credentials_text) throw unprocessable('Credentials must be recorded before verification. Do not grant verified expertise without evidence.')
    run(`UPDATE community_contributors SET verification_status = ?, verified_by = ?, verified_at = ?, updated_at = ? WHERE id = ?`, [req.body.action === 'verify' ? 'verified' : 'rejected', req.user.id, nowIso(), nowIso(), contributor.id])
    logAudit(req, { action: `transparency.community_contributor_${req.body.action}`, module: 'transparency', entityType: 'community_contributor', entityId: contributor.id })
    res.json({ message: req.body.action === 'verify' ? 'Contributor credentials marked reviewed. This is not an institutional endorsement.' : 'Contributor verification rejected.' })
  }),
)
