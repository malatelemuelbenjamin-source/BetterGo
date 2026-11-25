/**
 * Citizen complaints and case tracking (Prompt 77).
 *
 * Cases are BetterGo records. Statuses reflect platform handling, not an official
 * government decision. Attachments stay in the private document vault.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const CATEGORIES = {
  service_quality: 'Service quality',
  delay: 'Delay or slow processing',
  staff_conduct: 'Staff conduct',
  facility: 'Office facility or accessibility',
  fees: 'Fees or payment concern',
  information: 'Incorrect information',
  other: 'Other concern',
}
const STATUSES = ['new', 'acknowledged', 'in_review', 'needs_information', 'referred', 'resolved', 'closed', 'withdrawn']
const OPEN = ['new', 'acknowledged', 'in_review', 'needs_information', 'referred']
const SEVERITIES = { low: 'Low', normal: 'Normal', high: 'High' }
const ADMIN_TRANSITIONS = {
  new: ['acknowledged', 'referred', 'needs_information'],
  acknowledged: ['in_review', 'needs_information', 'referred', 'resolved'],
  in_review: ['needs_information', 'referred', 'resolved'],
  needs_information: ['acknowledged', 'in_review', 'referred', 'closed'],
  referred: ['in_review', 'resolved', 'closed'],
  resolved: ['closed'],
}

function notify(userId, title, message, caseId) {
  const prefs = get(`SELECT in_app_enabled FROM notification_preferences WHERE user_id = ?`, [userId])
  if (prefs && Number(prefs.in_app_enabled) === 0) return
  run(
    `INSERT INTO notifications (user_id, title, message, notification_type, category, related_entity_type, related_entity_id)
     VALUES (?, ?, ?, 'complaint', 'account', 'complaint_case', ?)`,
    [userId, title, message, caseId],
  )
}

function addEvent(id, action, from, to, actorType, actorId, note = null) {
  run(`INSERT INTO complaint_events (case_id, action, from_status, to_status, actor_type, actor_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    id,
    action,
    from || null,
    to || null,
    actorType,
    actorId,
    note ? cleanText(note, 1000) : null,
  ])
}

const reference = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let code = 'BG-CASE-'
    for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)]
    if (!get(`SELECT id FROM complaint_cases WHERE reference = ?`, [code])) return code
  }
  throw unprocessable('Could not generate a case reference. Please retry.')
}

function shape(row) {
  const office = row.office_id ? get(`SELECT name FROM government_offices WHERE id = ?`, [row.office_id]) : null
  return {
    id: row.id,
    reference: row.reference,
    category: row.category,
    categoryLabel: CATEGORIES[row.category] || row.category,
    subject: row.subject,
    description: row.description,
    locationText: row.location_text,
    officeName: office?.name || null,
    severity: row.severity,
    severityLabel: SEVERITIES[row.severity] || row.severity,
    status: row.status,
    confidential: Boolean(row.confidential),
    resolutionSummary: row.resolution_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events: all(`SELECT action, from_status, to_status, actor_type, note, created_at FROM complaint_events WHERE case_id = ? ORDER BY id`, [row.id]),
    attachments: all(`SELECT a.document_id, d.original_filename, d.category FROM complaint_attachments a JOIN citizen_documents d ON d.id = a.document_id WHERE a.case_id = ?`, [row.id]),
  }
}

export const complaintsRouter = Router()
complaintsRouter.use(requireAuth)

complaintsRouter.get(
  '/complaints',
  asyncHandler(async (req, res) => {
    const rows = all(`SELECT * FROM complaint_cases WHERE user_id = ? ORDER BY id DESC LIMIT 100`, [req.user.id])
    res.json({
      categories: CATEGORIES,
      severities: SEVERITIES,
      open: rows.filter((row) => OPEN.includes(row.status)).map(shape),
      history: rows.filter((row) => !OPEN.includes(row.status)).map(shape),
      notice: 'BetterGo tracks your case. A case status is not an official government finding, and submitting here does not replace any official complaint process.',
    })
  }),
)

complaintsRouter.post(
  '/complaints',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 8 }),
  validate(
    z.object({
      category: z.enum(Object.keys(CATEGORIES)),
      subject: z.string().trim().min(4).max(160),
      description: z.string().trim().min(20).max(4000),
      locationText: z.string().trim().max(300).optional().or(z.literal('')),
      municipalityId: z.coerce.number().int().positive().optional(),
      officeId: z.coerce.number().int().positive().optional(),
      serviceId: z.coerce.number().int().positive().optional(),
      severity: z.enum(['low', 'normal', 'high']).optional(),
      confidential: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const openCount = Number(get(`SELECT COUNT(*) AS n FROM complaint_cases WHERE user_id = ? AND status IN ('new','acknowledged','in_review','needs_information','referred')`, [req.user.id]).n)
    if (openCount >= 5) throw unprocessable('You already have several open cases. Add details to an existing case or wait for an update.')
    if (req.body.officeId && !get(`SELECT id FROM government_offices WHERE id = ?`, [req.body.officeId])) throw unprocessable('That office is not recorded.')
    if (req.body.serviceId && !get(`SELECT id FROM government_services WHERE id = ?`, [req.body.serviceId])) throw unprocessable('That service is not recorded.')
    const ref = reference()
    const id = Number(
      run(
        `INSERT INTO complaint_cases (reference, user_id, category, subject, description, location_text, municipality_id, office_id, service_id, severity, confidential)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ref,
          req.user.id,
          req.body.category,
          cleanText(req.body.subject, 160),
          cleanText(req.body.description, 4000),
          cleanText(req.body.locationText, 300),
          req.body.municipalityId || null,
          req.body.officeId || null,
          req.body.serviceId || null,
          req.body.severity || 'normal',
          req.body.confidential ? 1 : 0,
        ],
      ).lastInsertRowid,
    )
    addEvent(id, 'submitted', null, 'new', 'citizen', req.user.id)
    notify(req.user.id, 'Case recorded', `BetterGo recorded case ${ref}. This is not an official government complaint or decision.`, id)
    res.status(201).json({
      message: 'Case recorded. Keep your reference to follow its progress. BetterGo is not the deciding government office.',
      case: shape(get(`SELECT * FROM complaint_cases WHERE id = ?`, [id])),
    })
  }),
)

async function ownCase(userId, id) {
  const row = get(`SELECT * FROM complaint_cases WHERE id = ? AND user_id = ?`, [Number(id), userId])
  if (!row) throw notFound('Case not found.')
  return row
}

complaintsRouter.get(
  '/complaints/:id',
  asyncHandler(async (req, res) => {
    const row = await ownCase(req.user.id, req.params.id)
    res.json({ case: shape(row), label: 'BetterGo case record — not an official government decision or certificate.' })
  }),
)

complaintsRouter.post(
  '/complaints/:id/comments',
  validate(z.object({ note: z.string().trim().min(2).max(2000) })),
  asyncHandler(async (req, res) => {
    const row = await ownCase(req.user.id, req.params.id)
    if (!OPEN.includes(row.status)) throw unprocessable('This case is closed and can no longer receive comments.')
    addEvent(row.id, 'citizen_comment', row.status, row.status, 'citizen', req.user.id, req.body.note)
    run(`UPDATE complaint_cases SET updated_at = ? WHERE id = ?`, [nowIso(), row.id])
    res.status(201).json({ message: 'Comment added.', case: shape(get(`SELECT * FROM complaint_cases WHERE id = ?`, [row.id])) })
  }),
)

complaintsRouter.post(
  '/complaints/:id/attachments',
  validate(z.object({ documentId: z.coerce.number().int().positive() })),
  asyncHandler(async (req, res) => {
    const row = await ownCase(req.user.id, req.params.id)
    if (!OPEN.includes(row.status)) throw unprocessable('This case is closed.')
    const document = get(`SELECT id FROM citizen_documents WHERE id = ? AND user_id = ? AND status = 'active' AND deleted_at IS NULL`, [req.body.documentId, req.user.id])
    if (!document) throw unprocessable('That document is not in your vault.')
    const existing = get(`SELECT id FROM complaint_attachments WHERE case_id = ? AND document_id = ?`, [row.id, document.id])
    if (!existing) {
      run(`INSERT INTO complaint_attachments (case_id, document_id) VALUES (?, ?)`, [row.id, document.id])
      addEvent(row.id, 'attachment_linked', row.status, row.status, 'citizen', req.user.id)
    }
    res.status(201).json({ message: 'Vault document linked. It remains private and is not sent to any office automatically.' })
  }),
)

complaintsRouter.post(
  '/complaints/:id/withdraw',
  asyncHandler(async (req, res) => {
    const row = await ownCase(req.user.id, req.params.id)
    if (!OPEN.includes(row.status)) throw unprocessable('This case is already closed.')
    run(`UPDATE complaint_cases SET status = 'withdrawn', updated_at = ? WHERE id = ?`, [nowIso(), row.id])
    addEvent(row.id, 'withdrawn', row.status, 'withdrawn', 'citizen', req.user.id)
    res.json({ message: 'Case withdrawn in BetterGo. Any separate official complaint you filed is unaffected.', case: shape(get(`SELECT * FROM complaint_cases WHERE id = ?`, [row.id])) })
  }),
)

complaintsRouter.get(
  '/complaints/:id/summary',
  asyncHandler(async (req, res) => {
    const row = await ownCase(req.user.id, req.params.id)
    const shaped = shape(row)
    res.type('text/plain').send([
      'BetterGo case record — not an official government decision or certificate.',
      `Reference: ${shaped.reference}`,
      `Subject: ${shaped.subject}`,
      `Status: ${shaped.status.replaceAll('_', ' ')}`,
      `Filed: ${shaped.createdAt}`,
      'BetterGo is an independent civic platform; the responsible office makes any official decision.',
    ].join('\n'))
  }),
)

/* -------------------------------- Admin --------------------------------- */

export const adminComplaintsRouter = Router()
adminComplaintsRouter.use(requireAuth, requireAdmin)

adminComplaintsRouter.get(
  '/complaints',
  requirePermission('reports.view'),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const filters = []
    const params = []
    if (req.query.status) {
      filters.push('c.status = ?')
      params.push(String(req.query.status))
    }
    if (req.query.category) {
      filters.push('c.category = ?')
      params.push(String(req.query.category))
    }
    if (!context.hasGlobalScope) {
      if (!context.municipalityIds.length) return res.json({ results: [], categories: CATEGORIES, statuses: STATUSES })
      filters.push(`c.municipality_id IN (${context.municipalityIds.map(() => '?').join(',')})`)
      params.push(...context.municipalityIds)
    }
    const rows = all(
      `SELECT c.*, u.name AS citizen_name FROM complaint_cases c JOIN users u ON u.id = c.user_id ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY c.id DESC LIMIT 100`,
      params,
    )
    res.json({
      results: rows.map((row) => ({ ...shape(row), citizenName: row.confidential ? 'Restricted' : row.citizen_name, internalNote: row.internal_note })),
      categories: CATEGORIES,
      statuses: STATUSES,
      note: 'Case handling records only. They are not official government findings or performance data.',
    })
  }),
)

adminComplaintsRouter.post(
  '/complaints/:id/status',
  requirePermission('reports.review'),
  validate(z.object({ status: z.enum(['acknowledged', 'in_review', 'needs_information', 'referred', 'resolved', 'closed']), note: z.string().trim().max(1000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM complaint_cases WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Case not found.')
    if (!ctx(req).hasGlobalScope && !(row.municipality_id && canUseMunicipality(ctx(req), row.municipality_id))) throw notFound('Case not found.')
    if (!(ADMIN_TRANSITIONS[row.status] || []).includes(req.body.status)) {
      throw unprocessable(`A case in ${row.status.replaceAll('_', ' ')} cannot move to ${req.body.status.replaceAll('_', ' ')}.`)
    }
    if (['resolved', 'referred'].includes(req.body.status) && !String(req.body.note || '').trim()) {
      throw unprocessable('A public explanation is required for this status.')
    }
    run(`UPDATE complaint_cases SET status = ?, resolution_summary = COALESCE(?, resolution_summary), updated_at = ? WHERE id = ?`, [
      req.body.status,
      req.body.status === 'resolved' ? cleanText(req.body.note, 1000) : null,
      nowIso(),
      row.id,
    ])
    addEvent(row.id, `status_${req.body.status}`, row.status, req.body.status, 'admin', req.user.id, req.body.note)
    logAudit(req, { action: 'complaints.status_updated', module: 'complaints', entityType: 'complaint_case', entityId: row.id })
    notify(row.user_id, 'Case status updated', `Case ${row.reference} is now ${req.body.status.replaceAll('_', ' ')}. This is a BetterGo record, not an official decision.`, row.id)
    res.json({ message: 'Case status recorded.', case: shape(get(`SELECT * FROM complaint_cases WHERE id = ?`, [row.id])) })
  }),
)

adminComplaintsRouter.patch(
  '/complaints/:id/note',
  requirePermission('reports.review'),
  validate(z.object({ note: z.string().trim().max(2000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM complaint_cases WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Case not found.')
    if (!ctx(req).hasGlobalScope && !(row.municipality_id && canUseMunicipality(ctx(req), row.municipality_id))) throw notFound('Case not found.')
    run(`UPDATE complaint_cases SET internal_note = ?, updated_at = ? WHERE id = ?`, [cleanText(req.body.note, 2000), nowIso(), row.id])
    res.json({ message: 'Internal note saved.' })
  }),
)

adminComplaintsRouter.get(
  '/complaints/analytics',
  requirePermission('reports.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      totals: {
        cases: Number(get(`SELECT COUNT(*) AS n FROM complaint_cases`).n),
        open: Number(get(`SELECT COUNT(*) AS n FROM complaint_cases WHERE status IN ('new','acknowledged','in_review','needs_information','referred')`).n),
        resolved: Number(get(`SELECT COUNT(*) AS n FROM complaint_cases WHERE status IN ('resolved','closed')`).n),
      },
      byCategory: all(`SELECT category, COUNT(*) AS count FROM complaint_cases GROUP BY category ORDER BY count DESC`),
      note: 'Aggregated BetterGo case activity only. No citizen names, descriptions or attachments appear here.',
    })
  }),
)
