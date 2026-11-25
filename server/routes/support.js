/**
 * Citizen help centre and BetterGo support tickets (Prompt 69).
 *
 * BetterGo support is platform assistance, not an LGU complaint desk and not an
 * emergency channel. Ticket statuses are BetterGo support states. Internal
 * notes are never returned to citizens, and attachments use the same private
 * storage as the personal document vault (no public URL).
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, forbidden, notFound, paginated, pagination, reference, slugify, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { MAX_FILE_BYTES, detectFileType, sanitiseFilename, storeFile, readFile } from '../lib/vault.js'

export const TICKET_STATUSES = {
  new: 'New',
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In progress',
  waiting_citizen: 'Waiting for your response',
  resolved: 'Resolved',
  closed: 'Closed',
  reopened: 'Reopened',
}

export const TICKET_PRIORITIES = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }

const CITIZEN_REOPENABLE = ['resolved', 'closed']
const OPEN_STATUSES = ['new', 'open', 'assigned', 'in_progress', 'waiting_citizen', 'reopened']

function notify(userId, title, message, type = 'account', entityType = null, entityId = null) {
  const prefs = get(`SELECT in_app_enabled FROM notification_preferences WHERE user_id = ?`, [userId])
  if (prefs && Number(prefs.in_app_enabled) === 0) return
  run(
    `INSERT INTO notifications (user_id, title, message, notification_type, category, related_entity_type, related_entity_id)
     VALUES (?, ?, ?, ?, 'account', ?, ?)`,
    [userId, title, message, type, entityType, entityId],
  )
}

function addEvent(ticketId, from, to, actorId, note) {
  run(`INSERT INTO support_ticket_events (ticket_id, from_status, to_status, actor_id, note) VALUES (?, ?, ?, ?, ?)`, [
    ticketId,
    from || null,
    to || null,
    actorId || null,
    note || null,
  ])
}

function ticketFor(userId, reference) {
  return get(`SELECT * FROM support_tickets WHERE reference = ? AND user_id = ?`, [String(reference), userId])
}

function presentTicket(row) {
  return {
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    category: row.category_name || null,
    categoryKey: row.category_key || null,
    status: row.status,
    statusLabel: TICKET_STATUSES[row.status] || row.status,
    priority: row.priority,
    priorityLabel: TICKET_PRIORITIES[row.priority] || row.priority,
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at,
    applicationReference: row.application_reference || null,
    municipalityName: row.municipality_name || null,
    satisfactionRating: row.satisfaction_rating || null,
  }
}

/* ------------------------------- Public help ---------------------------- */

export const helpRouter = Router()

helpRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    res.json({
      categories: all(
        `SELECT c.id, c.key, c.name, c.description,
                (SELECT COUNT(*) FROM support_articles a WHERE a.category_id = c.id AND a.status = 'published') AS article_count
         FROM support_categories c WHERE c.status = 'active' ORDER BY c.sort_order, c.name`,
      ),
    })
  }),
)

helpRouter.get(
  '/articles',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query)
    const term = cleanText(req.query.q, 120)
    const category = cleanText(req.query.category, 60)
    const language = ['en', 'fil'].includes(String(req.query.language)) ? String(req.query.language) : null
    const clauses = [`a.status = 'published'`]
    const params = []
    if (term) {
      clauses.push(`(a.title LIKE ? OR a.summary LIKE ? OR a.body LIKE ?)`)
      params.push(`%${term}%`, `%${term}%`, `%${term}%`)
    }
    if (category) {
      clauses.push(`c.key = ?`)
      params.push(category)
    }
    if (language) {
      clauses.push(`a.language = ?`)
      params.push(language)
    }
    const where = clauses.join(' AND ')
    const total = Number(get(`SELECT COUNT(*) AS n FROM support_articles a LEFT JOIN support_categories c ON c.id = a.category_id WHERE ${where}`, params).n)
    const rows = all(
      `SELECT a.id, a.slug, a.title, a.summary, a.language, a.published_at, c.name AS category_name, c.key AS category_key
       FROM support_articles a LEFT JOIN support_categories c ON c.id = a.category_id
       WHERE ${where} ORDER BY a.published_at DESC, a.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    res.json({ ...paginated(rows, total, page, limit), note: 'Only approved and published help articles are shown.' })
  }),
)

helpRouter.get(
  '/articles/:slug',
  asyncHandler(async (req, res) => {
    const row = get(
      `SELECT a.*, c.name AS category_name, c.key AS category_key
       FROM support_articles a LEFT JOIN support_categories c ON c.id = a.category_id
       WHERE a.slug = ? AND a.status = 'published'`,
      [String(req.params.slug)],
    )
    if (!row) throw notFound('Help article not found.')
    const related = all(
      `SELECT slug, title, summary FROM support_articles
       WHERE status = 'published' AND category_id = ? AND id <> ? ORDER BY published_at DESC LIMIT 4`,
      [row.category_id, row.id],
    )
    res.json({
      article: {
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        body: row.body,
        language: row.language,
        categoryName: row.category_name,
        categoryKey: row.category_key,
        publishedAt: row.published_at,
        updatedAt: row.updated_at,
      },
      related,
      disclaimer: 'Help articles explain BetterGo features. They do not state government requirements or official procedures.',
    })
  }),
)

helpRouter.post(
  '/articles/:slug/feedback',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }),
  validate(z.object({ helpful: z.boolean() })),
  asyncHandler(async (req, res) => {
    const article = get(`SELECT id FROM support_articles WHERE slug = ? AND status = 'published'`, [String(req.params.slug)])
    if (!article) throw notFound('Help article not found.')
    run(
      `INSERT INTO support_article_feedback (article_id, user_id, helpful) VALUES (?, ?, ?)
       ON CONFLICT(article_id, user_id) DO UPDATE SET helpful = excluded.helpful`,
      [article.id, req.user.id, req.body.helpful ? 1 : 0],
    )
    res.json({ message: 'Thank you for the feedback.' })
  }),
)

/* ------------------------------ Citizen tickets ------------------------- */

export const supportRouter = Router()
supportRouter.use(requireAuth)

supportRouter.get(
  '/support/tickets',
  asyncHandler(async (req, res) => {
    const status = TICKET_STATUSES[String(req.query.status)] ? String(req.query.status) : null
    const rows = all(
      `SELECT t.*, c.name AS category_name, c.key AS category_key, m.name AS municipality_name
       FROM support_tickets t
       LEFT JOIN support_categories c ON c.id = t.category_id
       LEFT JOIN municipalities m ON m.id = t.municipality_id
       WHERE t.user_id = ? ${status ? 'AND t.status = ?' : ''}
       ORDER BY t.id DESC`,
      status ? [req.user.id, status] : [req.user.id],
    )
    res.json({
      results: rows.map(presentTicket),
      statuses: TICKET_STATUSES,
      note: 'BetterGo support tickets are handled by the platform team. They are not official LGU complaints or emergency requests.',
    })
  }),
)

const ticketSchema = z.object({
  subject: z.string().trim().min(5, 'Give your request a short title.').max(160),
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().min(20, 'Describe the issue in at least 20 characters.').max(5000),
  issueType: z.enum(['question', 'technical_problem', 'accessibility', 'account_issue', 'suggestion']).optional(),
  municipalityId: z.coerce.number().int().positive().optional().nullable(),
  applicationReference: z.string().trim().max(80).optional().or(z.literal('')),
  privacyAccepted: z.literal(true, { errorMap: () => ({ message: 'Please read and accept the privacy notice.' }) }),
})

supportRouter.post(
  '/support/tickets',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 8 }),
  validate(ticketSchema),
  asyncHandler(async (req, res) => {
    const category = get(`SELECT * FROM support_categories WHERE key = ? AND status = 'active'`, [req.body.category])
    if (!category) throw unprocessable('Choose a valid support category.', [{ field: 'category', message: 'Unknown category.' }])
    const profile = get(`SELECT municipality_id FROM user_profiles WHERE user_id = ?`, [req.user.id])
    const municipalityId = req.body.municipalityId || profile?.municipality_id || null
    if (municipalityId && !get(`SELECT id FROM municipalities WHERE id = ?`, [Number(municipalityId)])) {
      throw unprocessable('Choose a valid municipality.', [{ field: 'municipalityId', message: 'Unknown municipality.' }])
    }
    const ref = reference('BGSUP')
    const id = Number(
      run(
        `INSERT INTO support_tickets (reference, user_id, category_id, subject, description, issue_type, municipality_id, application_reference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ref,
          req.user.id,
          category.id,
          cleanText(req.body.subject, 160),
          cleanText(req.body.description, 5000),
          req.body.issueType || 'question',
          municipalityId,
          cleanText(req.body.applicationReference, 80),
        ],
      ).lastInsertRowid,
    )
    run(`INSERT INTO support_ticket_messages (ticket_id, author_id, author_role, body) VALUES (?, ?, 'citizen', ?)`, [
      id,
      req.user.id,
      cleanText(req.body.description, 5000),
    ])
    addEvent(id, null, 'new', req.user.id, 'Ticket submitted')
    notify(req.user.id, `Support ticket ${ref} received`, 'Our platform support team will review your request.', 'account', 'support_ticket', id)
    logAudit(req, { action: 'support.ticket_created', module: 'support', entityType: 'support_ticket', entityId: ref, municipalityId })
    res.status(201).json({
      message: 'Your support ticket was submitted to the BetterGo platform team.',
      reference: ref,
      disclaimer: 'This is a BetterGo support ticket, not an official LGU complaint. For emergencies, contact verified emergency services.',
    })
  }),
)

supportRouter.get(
  '/support/tickets/:reference',
  asyncHandler(async (req, res) => {
    const row = get(
      `SELECT t.*, c.name AS category_name, c.key AS category_key, m.name AS municipality_name,
              COALESCE(up.display_name, u.name) AS assigned_name
       FROM support_tickets t
       LEFT JOIN support_categories c ON c.id = t.category_id
       LEFT JOIN municipalities m ON m.id = t.municipality_id
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE t.reference = ? AND t.user_id = ?`,
      [String(req.params.reference), req.user.id],
    )
    if (!row) throw notFound('Support ticket not found.')
    const messages = all(
      `SELECT id, author_role, body, created_at FROM support_ticket_messages
       WHERE ticket_id = ? AND internal = 0 ORDER BY id ASC`,
      [row.id],
    )
    const attachments = all(
      `SELECT id, original_filename, mime_type, file_size, message_id, created_at FROM support_attachments WHERE ticket_id = ? ORDER BY id ASC`,
      [row.id],
    )
    const history = all(`SELECT from_status, to_status, note, created_at FROM support_ticket_events WHERE ticket_id = ? ORDER BY id ASC`, [row.id])
    res.json({
      ticket: presentTicket(row),
      messages,
      attachments,
      history,
      canReopen: CITIZEN_REOPENABLE.includes(row.status),
      canReply: OPEN_STATUSES.includes(row.status) || row.status === 'resolved',
      note: 'Internal staff notes are never shown here.',
    })
  }),
)

supportRouter.post(
  '/support/tickets/:reference/messages',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }),
  validate(z.object({ body: z.string().trim().min(2).max(3000) })),
  asyncHandler(async (req, res) => {
    const ticket = ticketFor(req.user.id, req.params.reference)
    if (!ticket) throw notFound('Support ticket not found.')
    if (!OPEN_STATUSES.includes(ticket.status) && ticket.status !== 'resolved') {
      throw unprocessable('This ticket is closed. Reopen it before replying.')
    }
    const messageId = Number(
      run(`INSERT INTO support_ticket_messages (ticket_id, author_id, author_role, body) VALUES (?, ?, 'citizen', ?)`, [
        ticket.id,
        req.user.id,
        cleanText(req.body.body, 3000),
      ]).lastInsertRowid,
    )
    if (ticket.status === 'waiting_citizen' || ticket.status === 'resolved') {
      run(`UPDATE support_tickets SET status = 'open', updated_at = ? WHERE id = ?`, [nowIso(), ticket.id])
      addEvent(ticket.id, ticket.status, 'open', req.user.id, 'Citizen replied')
    } else {
      run(`UPDATE support_tickets SET updated_at = ? WHERE id = ?`, [nowIso(), ticket.id])
    }
    res.status(201).json({ message: 'Your reply was added to the conversation.', messageId })
  }),
)

supportRouter.post(
  '/support/tickets/:reference/close',
  asyncHandler(async (req, res) => {
    const ticket = ticketFor(req.user.id, req.params.reference)
    if (!ticket) throw notFound('Support ticket not found.')
    if (ticket.status === 'closed') return res.json({ message: 'This ticket is already closed.' })
    run(`UPDATE support_tickets SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), ticket.id])
    addEvent(ticket.id, ticket.status, 'closed', req.user.id, 'Closed by citizen')
    res.json({ message: 'Ticket closed. You can reopen it later if you still need help.' })
  }),
)

supportRouter.post(
  '/support/tickets/:reference/reopen',
  asyncHandler(async (req, res) => {
    const ticket = ticketFor(req.user.id, req.params.reference)
    if (!ticket) throw notFound('Support ticket not found.')
    if (!CITIZEN_REOPENABLE.includes(ticket.status)) throw unprocessable('Only a resolved or closed ticket can be reopened.')
    const reopenCount = Number(get(`SELECT COUNT(*) AS n FROM support_ticket_events WHERE ticket_id = ? AND to_status = 'reopened'`, [ticket.id]).n)
    if (reopenCount >= 3) throw unprocessable('This ticket has been reopened several times. Please submit a new ticket so it can be reviewed with fresh context.')
    run(`UPDATE support_tickets SET status = 'reopened', closed_at = NULL, updated_at = ? WHERE id = ?`, [nowIso(), ticket.id])
    addEvent(ticket.id, ticket.status, 'reopened', req.user.id, 'Reopened by citizen')
    notify(req.user.id, `Ticket ${ticket.reference} reopened`, 'Your support ticket is open again.', 'account', 'support_ticket', ticket.id)
    res.json({ message: 'Ticket reopened.', status: 'reopened' })
  }),
)

supportRouter.post(
  '/support/tickets/:reference/feedback',
  validate(z.object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const ticket = ticketFor(req.user.id, req.params.reference)
    if (!ticket) throw notFound('Support ticket not found.')
    if (!['resolved', 'closed'].includes(ticket.status)) throw unprocessable('Feedback is available after a ticket is resolved.')
    if (ticket.satisfaction_rating) throw unprocessable('Feedback was already recorded for this ticket.')
    run(`UPDATE support_tickets SET satisfaction_rating = ?, feedback = ?, updated_at = ? WHERE id = ?`, [
      req.body.rating,
      cleanText(req.body.comment, 1000),
      nowIso(),
      ticket.id,
    ])
    logAudit(req, { action: 'support.ticket_feedback', module: 'support', entityType: 'support_ticket', entityId: ticket.reference })
    res.json({ message: 'Thank you for the feedback. It is visible only to the BetterGo support team.' })
  }),
)

/* Attachments: raw body parsed in server/index.js for this path. */
function attachmentBelongsTo(ticketId, attachmentId, userId, allowStaff) {
  const row = get(`SELECT * FROM support_attachments WHERE id = ? AND ticket_id = ?`, [Number(attachmentId), ticketId])
  if (!row) return null
  if (Number(row.user_id) === Number(userId)) return row
  if (!allowStaff) return null
  const ticket = get(`SELECT user_id FROM support_tickets WHERE id = ?`, [ticketId])
  return ticket ? row : null
}

supportRouter.post(
  '/support/tickets/:reference/attachments',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  asyncHandler(async (req, res) => {
    const ticket = ticketFor(req.user.id, req.params.reference)
    if (!ticket) throw notFound('Support ticket not found.')
    const buffer = req.body
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw unprocessable('No file data received.')
    if (buffer.length > MAX_FILE_BYTES) throw unprocessable('Attachments must be 10 MB or smaller.')
    const type = detectFileType(buffer)
    if (!type) throw unprocessable('Attach a PDF, JPG or PNG file.')
    const { reference: stored } = storeFile(buffer, type)
    const id = Number(
      run(
        `INSERT INTO support_attachments (ticket_id, user_id, original_filename, storage_reference, mime_type, file_size)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [ticket.id, req.user.id, sanitiseFilename(req.get('x-filename') || `attachment.${type.ext}`), stored, type.mime, buffer.length],
      ).lastInsertRowid,
    )
    res.status(201).json({ message: 'Attachment added privately to your ticket.', id })
  }),
)

supportRouter.get(
  '/support/attachments/:id',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM support_attachments WHERE id = ?`, [Number(req.params.id)])
    if (!row || Number(row.user_id) !== Number(req.user.id)) throw notFound('Attachment not found.')
    const buffer = readFile(row.storage_reference)
    if (!buffer) throw notFound('Attachment not found.')
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${row.original_filename}"`)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(buffer)
  }),
)

/* ----------------------------- Admin support ---------------------------- */

export const adminSupportRouter = Router()
adminSupportRouter.use(requireAuth, requireAdmin)

function scopedTicket(req, reference) {
  const row = get(
    `SELECT t.*, c.name AS category_name, c.key AS category_key, m.name AS municipality_name, u.email AS citizen_email
     FROM support_tickets t
     LEFT JOIN support_categories c ON c.id = t.category_id
     LEFT JOIN municipalities m ON m.id = t.municipality_id
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.reference = ?`,
    [String(reference)],
  )
  if (!row) throw notFound('Support ticket not found.')
  const context = ctx(req)
  if (!context.hasGlobalScope && !(row.municipality_id && canUseMunicipality(context, row.municipality_id))) {
    throw notFound('Support ticket not found.')
  }
  return row
}

adminSupportRouter.get(
  '/tickets',
  requirePermission('reports.view'),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const status = TICKET_STATUSES[String(req.query.status)] ? String(req.query.status) : null
    const category = cleanText(req.query.category, 60)
    const unassigned = String(req.query.unassigned) === '1'
    const term = cleanText(req.query.q, 120)
    const clauses = ['1=1']
    const params = []
    if (!context.hasGlobalScope) {
      clauses.push(context.municipalityIds.length ? `t.municipality_id IN (${context.municipalityIds.map(() => '?').join(',')})` : '0')
      params.push(...context.municipalityIds)
    }
    if (status) {
      clauses.push('t.status = ?')
      params.push(status)
    }
    if (category) {
      clauses.push('c.key = ?')
      params.push(category)
    }
    if (unassigned) clauses.push('t.assigned_to IS NULL')
    if (term) {
      clauses.push('(t.reference LIKE ? OR t.subject LIKE ?)')
      params.push(`%${term}%`, `%${term}%`)
    }
    const rows = all(
      `SELECT t.*, c.name AS category_name, c.key AS category_key, m.name AS municipality_name,
              COALESCE(up.display_name, u.name) AS assigned_name
       FROM support_tickets t
       LEFT JOIN support_categories c ON c.id = t.category_id
       LEFT JOIN municipalities m ON m.id = t.municipality_id
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE ${clauses.join(' AND ')} ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.id DESC LIMIT 100`,
      params,
    )
    res.json({ results: rows, statuses: TICKET_STATUSES, priorities: TICKET_PRIORITIES, note: 'Only tickets within your municipality scope are listed.' })
  }),
)

adminSupportRouter.get(
  '/tickets/:reference',
  requirePermission('reports.view'),
  asyncHandler(async (req, res) => {
    const row = scopedTicket(req, req.params.reference)
    res.json({
      ticket: presentTicket(row),
      citizenEmail: row.citizen_email,
      description: row.description,
      messages: all(
        `SELECT id, author_id, author_role, body, internal, created_at FROM support_ticket_messages WHERE ticket_id = ? ORDER BY id ASC`,
        [row.id],
      ),
      attachments: all(`SELECT id, original_filename, mime_type, file_size, created_at FROM support_attachments WHERE ticket_id = ? ORDER BY id ASC`, [row.id]),
      history: all(
        `SELECT e.from_status, e.to_status, e.note, e.created_at, COALESCE(up.display_name, u.name) AS actor_name
         FROM support_ticket_events e LEFT JOIN users u ON u.id = e.actor_id LEFT JOIN user_profiles up ON up.user_id = u.id
         WHERE e.ticket_id = ? ORDER BY e.id ASC`,
        [row.id],
      ),
      feedback: row.satisfaction_rating ? { rating: row.satisfaction_rating, comment: row.feedback } : null,
    })
  }),
)

const adminUpdateSchema = z.object({
  status: z.enum(Object.keys(TICKET_STATUSES)).optional(),
  priority: z.enum(Object.keys(TICKET_PRIORITIES)).optional(),
  assignedTo: z.coerce.number().int().positive().nullable().optional(),
  note: z.string().trim().max(2000).optional(),
})

adminSupportRouter.patch(
  '/tickets/:reference',
  requirePermission('reports.view'),
  validate(adminUpdateSchema),
  asyncHandler(async (req, res) => {
    const row = scopedTicket(req, req.params.reference)
    if (req.body.assignedTo) {
      const agent = get(`SELECT id FROM users WHERE id = ?`, [req.body.assignedTo])
      if (!agent) throw unprocessable('Choose a valid support agent.')
    }
    const nextStatus = req.body.status || row.status
    if (req.body.status) {
      if (req.body.status === 'closed' && row.status !== 'resolved') {
        throw unprocessable('Resolve the ticket before closing it.')
      }
      run(`UPDATE support_tickets SET status = ?, closed_at = CASE WHEN ? = 'closed' THEN ? ELSE closed_at END, updated_at = ? WHERE id = ?`, [
        nextStatus,
        nextStatus,
        nowIso(),
        nowIso(),
        row.id,
      ])
      addEvent(row.id, row.status, nextStatus, req.user.id, cleanText(req.body.note, 2000))
      notify(row.user_id, `Ticket ${row.reference}: ${TICKET_STATUSES[nextStatus]}`, cleanText(req.body.note, 400) || 'Your BetterGo support ticket was updated.', 'account', 'support_ticket', row.id)
    }
    if (req.body.priority) run(`UPDATE support_tickets SET priority = ?, updated_at = ? WHERE id = ?`, [req.body.priority, nowIso(), row.id])
    if (req.body.assignedTo !== undefined) {
      run(`UPDATE support_tickets SET assigned_to = ?, updated_at = ? WHERE id = ?`, [req.body.assignedTo || null, nowIso(), row.id])
      if (req.body.assignedTo && row.status === 'new') {
        run(`UPDATE support_tickets SET status = 'assigned' WHERE id = ?`, [row.id])
        addEvent(row.id, row.status, 'assigned', req.user.id, 'Assigned to a support agent')
      }
    }
    logAudit(req, { action: 'support.ticket_updated', module: 'support', entityType: 'support_ticket', entityId: row.reference, newValues: req.body })
    res.json({ message: 'Ticket updated.' })
  }),
)

adminSupportRouter.post(
  '/tickets/:reference/messages',
  requirePermission('reports.view'),
  validate(z.object({ body: z.string().trim().min(2).max(3000), internal: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const row = scopedTicket(req, req.params.reference)
    const internal = Boolean(req.body.internal)
    const id = Number(
      run(`INSERT INTO support_ticket_messages (ticket_id, author_id, author_role, body, internal) VALUES (?, ?, 'support', ?, ?)`, [
        row.id,
        req.user.id,
        cleanText(req.body.body, 3000),
        internal ? 1 : 0,
      ]).lastInsertRowid,
    )
    if (!internal) {
      const nextStatus = row.status === 'new' || row.status === 'assigned' ? 'in_progress' : row.status
      if (nextStatus !== row.status) {
        run(`UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?`, [nextStatus, nowIso(), row.id])
        addEvent(row.id, row.status, nextStatus, req.user.id, 'Support replied')
      } else {
        run(`UPDATE support_tickets SET updated_at = ? WHERE id = ?`, [nowIso(), row.id])
      }
      notify(row.user_id, `Reply on ticket ${row.reference}`, 'The BetterGo support team replied to your ticket.', 'account', 'support_ticket', row.id)
    }
    res.status(201).json({ message: internal ? 'Internal note added. Citizens cannot see it.' : 'Reply sent to the citizen.', messageId: id })
  }),
)

adminSupportRouter.get(
  '/attachments/:id',
  requirePermission('reports.view'),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM support_attachments WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Attachment not found.')
    const ticket = scopedTicket(req, get(`SELECT reference FROM support_tickets WHERE id = ?`, [row.ticket_id])?.reference)
    const buffer = readFile(row.storage_reference)
    if (!buffer) throw notFound('Attachment not found.')
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${row.original_filename}"`)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(buffer)
    logAudit(req, { action: 'support.attachment_viewed', module: 'support', entityType: 'support_ticket', entityId: ticket.reference })
  }),
)

adminSupportRouter.get(
  '/metrics',
  requirePermission('reports.view'),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const scope = context.hasGlobalScope ? '' : context.municipalityIds.length ? `WHERE municipality_id IN (${context.municipalityIds.map(() => '?').join(',')})` : 'WHERE 0'
    const params = context.hasGlobalScope ? [] : context.municipalityIds
    const totals = get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status IN ('new','open','assigned','in_progress','waiting_citizen','reopened') THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
              SUM(CASE WHEN assigned_to IS NULL THEN 1 ELSE 0 END) AS unassigned,
              SUM(CASE WHEN satisfaction_rating IS NOT NULL THEN 1 ELSE 0 END) AS rated,
              AVG(satisfaction_rating) AS average_rating
       FROM support_tickets ${scope}`,
      params,
    )
    res.json({
      totals: {
        total: Number(totals.total || 0),
        open: Number(totals.open || 0),
        resolved: Number(totals.resolved || 0),
        unassigned: Number(totals.unassigned || 0),
        rated: Number(totals.rated || 0),
        averageRating: totals.average_rating ? Number(Number(totals.average_rating).toFixed(2)) : null,
      },
      byCategory: all(
        `SELECT c.name AS category, COUNT(*) AS total FROM support_tickets t
         LEFT JOIN support_categories c ON c.id = t.category_id ${scope ? scope.replace('WHERE', 'WHERE t.') : ''}
         GROUP BY c.name ORDER BY total DESC`,
        params,
      ),
      note: 'Counts come from stored tickets. BetterGo has no published service-level response guarantee.',
    })
  }),
)

/* Admin help content management */
const articleSchema = z.object({
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().max(400).optional().or(z.literal('')),
  body: z.string().trim().min(10).max(20000),
  category: z.string().trim().min(2).max(60),
  language: z.enum(['en', 'fil']).default('en'),
})

adminSupportRouter.get(
  '/articles',
  requirePermission('cms.manage'),
  asyncHandler(async (_req, res) => {
    res.json({ results: all(`SELECT a.*, c.name AS category_name FROM support_articles a LEFT JOIN support_categories c ON c.id = a.category_id ORDER BY a.id DESC`) })
  }),
)

adminSupportRouter.post(
  '/articles',
  requirePermission('cms.manage'),
  validate(articleSchema),
  asyncHandler(async (req, res) => {
    const category = get(`SELECT id FROM support_categories WHERE key = ?`, [req.body.category])
    if (!category) throw unprocessable('Choose a valid help category.')
    const base = slugify(req.body.title) || `article-${Date.now()}`
    let slug = base
    let n = 2
    while (get(`SELECT id FROM support_articles WHERE slug = ?`, [slug])) slug = `${base}-${n++}`
    const id = Number(
      run(
        `INSERT INTO support_articles (slug, category_id, title, summary, body, language, status, author_id)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
        [slug, category.id, cleanText(req.body.title, 160), cleanText(req.body.summary, 400), cleanText(req.body.body, 20000), req.body.language, req.user.id],
      ).lastInsertRowid,
    )
    logAudit(req, { action: 'support.article_created', module: 'support', entityType: 'support_article', entityId: id })
    res.status(201).json({ message: 'Article created as a draft.', id, slug })
  }),
)

adminSupportRouter.post(
  '/articles/:id/publish',
  requirePermission('cms.manage'),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM support_articles WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Article not found.')
    if (row.author_id === req.user.id) throw forbidden('A second reviewer must publish an article before it becomes public.')
    run(`UPDATE support_articles SET status = 'published', reviewer_id = ?, published_at = ?, updated_at = ? WHERE id = ?`, [req.user.id, nowIso(), nowIso(), row.id])
    logAudit(req, { action: 'support.article_published', module: 'support', entityType: 'support_article', entityId: row.id })
    res.json({ message: 'Article published.' })
  }),
)

adminSupportRouter.post(
  '/categories',
  requirePermission('cms.manage'),
  validate(z.object({ key: z.string().trim().regex(/^[a-z0-9_]{3,40}$/), name: z.string().trim().min(2).max(80), description: z.string().trim().max(300).optional() })),
  asyncHandler(async (req, res) => {
    if (get(`SELECT id FROM support_categories WHERE key = ?`, [req.body.key])) throw unprocessable('That category key already exists.')
    const id = Number(run(`INSERT INTO support_categories (key, name, description) VALUES (?, ?, ?)`, [req.body.key, cleanText(req.body.name, 80), cleanText(req.body.description, 300)]).lastInsertRowid)
    res.status(201).json({ message: 'Category created.', id })
  }),
)
