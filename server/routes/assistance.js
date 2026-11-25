/**
 * Application assistance, requirements checker and preparation plans (Prompt 73).
 *
 * Requirements come from the existing service directory. Unverified information
 * is labelled as such, and a completed checklist is never presented as official
 * eligibility, acceptance or approval.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

export const assistanceRouter = Router()
assistanceRouter.use(requireAuth)

const STATUSES = ['not_started', 'preparing', 'ready', 'unavailable', 'not_applicable']
const PUBLISHED = `s.publication_status = 'published' AND s.archived_at IS NULL`

function progress(planId) {
  const items = all(`SELECT mandatory, status FROM preparation_items WHERE plan_id = ?`, [planId])
  const mandatory = items.filter((item) => Number(item.mandatory) === 1)
  const ready = mandatory.filter((item) => item.status === 'ready' || item.status === 'not_applicable')
  return {
    total: items.length,
    mandatory: mandatory.length,
    ready: ready.length,
    outstanding: mandatory.length - ready.length,
    percent: mandatory.length ? Math.round((ready.length / mandatory.length) * 100) : 0,
  }
}

function planFor(userId, serviceId) {
  return get(`SELECT * FROM preparation_plans WHERE user_id = ? AND service_id = ?`, [userId, serviceId])
}

function shapeRequirement(row) {
  return {
    id: row.id,
    name: row.requirement_name,
    description: row.description,
    mandatory: Boolean(row.is_required),
    guidance: row.guidance || null,
    issuingOffice: row.issuing_office || null,
    validity: row.validity || null,
    reviewStatus: row.review_status || 'unverified',
    verifiedAt: row.verified_at || null,
    sourceTitle: row.source_title || null,
    sourceUrl: row.review_status === 'approved' ? row.source_url || null : null,
    label:
      row.review_status === 'approved'
        ? 'Reviewed BetterGo record'
        : 'Information needs verification',
  }
}

assistanceRouter.get(
  '/assistance',
  asyncHandler(async (req, res) => {
    const services = all(
      `SELECT s.id, s.title, s.slug, s.short_description, m.name AS municipality_name,
              (SELECT COUNT(*) FROM service_requirements r WHERE r.service_id = s.id AND r.archived_at IS NULL) AS requirement_count
       FROM government_services s LEFT JOIN municipalities m ON m.id = s.municipality_id
       WHERE ${PUBLISHED} AND EXISTS (SELECT 1 FROM service_requirements r WHERE r.service_id = s.id AND r.archived_at IS NULL)
       ORDER BY s.title LIMIT 60`,
    )
    const plans = all(
      `SELECT p.id, p.service_id, s.title, s.slug, p.updated_at FROM preparation_plans p JOIN government_services s ON s.id = p.service_id
       WHERE p.user_id = ? ORDER BY p.updated_at DESC`,
      [req.user.id],
    ).map((plan) => ({ ...plan, progress: progress(plan.id) }))
    res.json({
      services,
      plans,
      note: 'A preparation checklist is a private aid. It does not mean you are eligible or that an office will accept your documents.',
    })
  }),
)

assistanceRouter.get(
  '/assistance/:slug',
  asyncHandler(async (req, res) => {
    const service = get(
      `SELECT s.*, m.name AS municipality_name FROM government_services s LEFT JOIN municipalities m ON m.id = s.municipality_id
       WHERE s.slug = ? AND ${PUBLISHED}`,
      [String(req.params.slug)],
    )
    if (!service) throw notFound('Service not found.')
    const requirements = all(
      `SELECT * FROM service_requirements WHERE service_id = ? AND archived_at IS NULL ORDER BY sort_order, id`,
      [service.id],
    )
    const procedures = all(`SELECT step_number, title, description, office, location, link FROM service_procedures WHERE service_id = ? ORDER BY step_number`, [service.id])
    const faqs = all(`SELECT question, answer FROM service_faqs WHERE service_id = ? ORDER BY id LIMIT 20`, [service.id])
    const plan = planFor(req.user.id, service.id)
    const items = plan ? all(`SELECT * FROM preparation_items WHERE plan_id = ? ORDER BY id`, [plan.id]) : []
    const documents = all(
      `SELECT id, title, category, expires_at FROM citizen_documents WHERE user_id = ? AND status = 'active' AND deleted_at IS NULL ORDER BY id DESC LIMIT 50`,
      [req.user.id],
    )
    res.json({
      service: {
        id: service.id,
        title: service.title,
        slug: service.slug,
        summary: service.short_description || service.description,
        municipalityName: service.municipality_name,
        isOnline: Boolean(service.is_online),
        officialLink: service.official_link || null,
        sourceUrl: service.source_url || null,
      },
      requirements: requirements.map(shapeRequirement),
      procedures,
      faqs,
      plan: plan ? { id: plan.id, notes: plan.notes, items, progress: progress(plan.id) } : null,
      documents,
      reminders: plan ? all(`SELECT id, remind_at, message FROM preparation_reminders WHERE plan_id = ? AND user_id = ? ORDER BY remind_at`, [plan.id, req.user.id]) : [],
      notice:
        'Preparation progress is not an official application status. The responsible government office decides eligibility and acceptance. BetterGo never sends your documents anywhere automatically.',
    })
  }),
)

assistanceRouter.post(
  '/assistance/:slug/plan',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }),
  asyncHandler(async (req, res) => {
    const service = get(`SELECT id, title FROM government_services WHERE slug = ? AND publication_status = 'published' AND archived_at IS NULL`, [String(req.params.slug)])
    if (!service) throw notFound('Service not found.')
    const existing = planFor(req.user.id, service.id)
    if (existing) return res.json({ message: 'Your preparation plan already exists.', planId: existing.id })
    const requirements = all(`SELECT * FROM service_requirements WHERE service_id = ? AND archived_at IS NULL ORDER BY sort_order, id`, [service.id])
    if (!requirements.length) throw unprocessable('This service has no recorded requirements to prepare.')
    const planId = Number(run(`INSERT INTO preparation_plans (user_id, service_id) VALUES (?, ?)`, [req.user.id, service.id]).lastInsertRowid)
    for (const requirement of requirements) {
      run(`INSERT INTO preparation_items (plan_id, requirement_id, label, mandatory) VALUES (?, ?, ?, ?)`, [
        planId,
        requirement.id,
        requirement.requirement_name,
        requirement.is_required ? 1 : 0,
      ])
    }
    logAudit(req, { action: 'assistance.plan_created', module: 'assistance', entityType: 'preparation_plan', entityId: planId })
    res.status(201).json({ message: 'Preparation plan created.', planId, note: 'Marking an item ready does not mean it has been officially accepted.' })
  }),
)

async function ownedPlan(userId, planId) {
  const plan = get(`SELECT * FROM preparation_plans WHERE id = ? AND user_id = ?`, [Number(planId), userId])
  if (!plan) throw notFound('Preparation plan not found.')
  return plan
}

assistanceRouter.patch(
  '/assistance/plans/:id',
  validate(z.object({ notes: z.string().trim().max(2000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const plan = await ownedPlan(req.user.id, req.params.id)
    run(`UPDATE preparation_plans SET notes = ?, updated_at = ? WHERE id = ?`, [cleanText(req.body.notes, 2000), nowIso(), plan.id])
    res.json({ message: 'Plan notes saved.' })
  }),
)

assistanceRouter.post(
  '/assistance/plans/:id/reset',
  asyncHandler(async (req, res) => {
    const plan = await ownedPlan(req.user.id, req.params.id)
    run(`UPDATE preparation_items SET status = 'not_started', note = NULL, updated_at = ? WHERE plan_id = ?`, [nowIso(), plan.id])
    res.json({ message: 'Checklist progress reset. Your vault documents were not changed.' })
  }),
)

assistanceRouter.delete(
  '/assistance/plans/:id',
  asyncHandler(async (req, res) => {
    const plan = await ownedPlan(req.user.id, req.params.id)
    run(`DELETE FROM preparation_plans WHERE id = ?`, [plan.id])
    logAudit(req, { action: 'assistance.plan_deleted', module: 'assistance', entityType: 'preparation_plan', entityId: plan.id })
    res.json({ message: 'Preparation plan deleted. Uploaded documents remain in your vault.' })
  }),
)

assistanceRouter.patch(
  '/assistance/plans/:id/items/:itemId',
  validate(
    z.object({
      status: z.enum(STATUSES).optional(),
      note: z.string().trim().max(1000).optional().or(z.literal('')),
      documentId: z.coerce.number().int().positive().nullable().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const plan = await ownedPlan(req.user.id, req.params.id)
    const item = get(`SELECT * FROM preparation_items WHERE id = ? AND plan_id = ?`, [Number(req.params.itemId), plan.id])
    if (!item) throw notFound('Checklist item not found.')
    if (req.body.documentId) {
      const document = get(`SELECT id FROM citizen_documents WHERE id = ? AND user_id = ? AND status = 'active' AND deleted_at IS NULL`, [
        req.body.documentId,
        req.user.id,
      ])
      if (!document) throw unprocessable('That document is not in your vault.')
    }
    run(`UPDATE preparation_items SET status = ?, note = ?, document_id = ?, updated_at = ? WHERE id = ?`, [
      req.body.status || item.status,
      req.body.note === undefined ? item.note : cleanText(req.body.note, 1000),
      req.body.documentId === undefined ? item.document_id : req.body.documentId,
      nowIso(),
      item.id,
    ])
    run(`UPDATE preparation_plans SET updated_at = ? WHERE id = ?`, [nowIso(), plan.id])
    res.json({ message: 'Checklist item updated.', progress: progress(plan.id) })
  }),
)

assistanceRouter.post(
  '/assistance/plans/:id/reminders',
  validate(z.object({ remindAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/), message: z.string().trim().max(200).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const plan = await ownedPlan(req.user.id, req.params.id)
    const id = Number(
      run(`INSERT INTO preparation_reminders (plan_id, user_id, remind_at, message) VALUES (?, ?, ?, ?)`, [
        plan.id,
        req.user.id,
        req.body.remindAt,
        cleanText(req.body.message, 200),
      ]).lastInsertRowid,
    )
    res.status(201).json({ message: 'Personal reminder saved. It is not an official government deadline.', id })
  }),
)

assistanceRouter.delete(
  '/assistance/plans/:id/reminders/:reminderId',
  asyncHandler(async (req, res) => {
    const plan = await ownedPlan(req.user.id, req.params.id)
    run(`DELETE FROM preparation_reminders WHERE id = ? AND plan_id = ? AND user_id = ?`, [Number(req.params.reminderId), plan.id, req.user.id])
    res.json({ message: 'Reminder removed.' })
  }),
)

/* ------------------------- Admin requirement review --------------------- */

export const adminAssistanceRouter = Router()
adminAssistanceRouter.use(requireAuth, requireAdmin)

function scopedService(req, serviceId) {
  const service = get(`SELECT * FROM government_services WHERE id = ?`, [Number(serviceId)])
  if (!service) throw notFound('Service not found.')
  const context = ctx(req)
  if (!context.hasGlobalScope && !(service.municipality_id && canUseMunicipality(context, service.municipality_id))) {
    throw notFound('Service not found.')
  }
  return service
}

adminAssistanceRouter.get(
  '/service-requirements',
  requirePermission('services.view'),
  asyncHandler(async (req, res) => {
    const service = scopedService(req, req.query.serviceId)
    res.json({
      service: { id: service.id, title: service.title },
      results: all(`SELECT * FROM service_requirements WHERE service_id = ? ORDER BY sort_order, id`, [service.id]),
      reviewStatuses: { unverified: 'Needs verification', draft: 'Draft', pending_review: 'Pending review', approved: 'Approved', archived: 'Archived' },
      note: 'Only approved requirements are labelled as reviewed. Nothing is approved automatically.',
    })
  }),
)

const requirementSchema = z.object({
  serviceId: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  mandatory: z.boolean().optional(),
  guidance: z.string().trim().max(2000).optional().or(z.literal('')),
  issuingOffice: z.string().trim().max(200).optional().or(z.literal('')),
  validity: z.string().trim().max(120).optional().or(z.literal('')),
  sourceTitle: z.string().trim().max(300).optional().or(z.literal('')),
  sourceUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
})

adminAssistanceRouter.post(
  '/service-requirements',
  requirePermission('services.update'),
  validate(requirementSchema),
  asyncHandler(async (req, res) => {
    const service = scopedService(req, req.body.serviceId)
    const id = Number(
      run(
        `INSERT INTO service_requirements (service_id, requirement_name, description, is_required, guidance, issuing_office, validity, source_title, source_url, review_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
        [
          service.id,
          cleanText(req.body.name, 160),
          cleanText(req.body.description, 2000),
          req.body.mandatory === false ? 0 : 1,
          cleanText(req.body.guidance, 2000),
          cleanText(req.body.issuingOffice, 200),
          cleanText(req.body.validity, 120),
          cleanText(req.body.sourceTitle, 300),
          cleanText(req.body.sourceUrl, 500),
        ],
      ).lastInsertRowid,
    )
    logAudit(req, { action: 'assistance.requirement_created', module: 'assistance', entityType: 'service_requirement', entityId: id })
    res.status(201).json({ message: 'Requirement saved as a draft. It is not shown as reviewed until approved.', id })
  }),
)

adminAssistanceRouter.patch(
  '/service-requirements/:id',
  requirePermission('services.update'),
  validate(requirementSchema.partial()),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM service_requirements WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Requirement not found.')
    scopedService(req, row.service_id)
    if (row.review_status === 'approved') {
      throw unprocessable('An approved requirement cannot be edited in place. Archive it and submit a new version for review.')
    }
    run(
      `UPDATE service_requirements SET requirement_name = ?, description = ?, is_required = ?, guidance = ?, issuing_office = ?, validity = ?,
        source_title = ?, source_url = ?, updated_at = ? WHERE id = ?`,
      [
        req.body.name ? cleanText(req.body.name, 160) : row.requirement_name,
        req.body.description === undefined ? row.description : cleanText(req.body.description, 2000),
        req.body.mandatory === undefined ? row.is_required : req.body.mandatory ? 1 : 0,
        req.body.guidance === undefined ? row.guidance : cleanText(req.body.guidance, 2000),
        req.body.issuingOffice === undefined ? row.issuing_office : cleanText(req.body.issuingOffice, 200),
        req.body.validity === undefined ? row.validity : cleanText(req.body.validity, 120),
        req.body.sourceTitle === undefined ? row.source_title : cleanText(req.body.sourceTitle, 300),
        req.body.sourceUrl === undefined ? row.source_url : cleanText(req.body.sourceUrl, 500),
        nowIso(),
        row.id,
      ],
    )
    res.json({ message: 'Requirement updated.' })
  }),
)

adminAssistanceRouter.post(
  '/service-requirements/:id/submit-review',
  requirePermission('services.update'),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM service_requirements WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Requirement not found.')
    scopedService(req, row.service_id)
    run(`UPDATE service_requirements SET review_status = 'pending_review', updated_at = ? WHERE id = ?`, [nowIso(), row.id])
    res.json({ message: 'Submitted for review.' })
  }),
)

adminAssistanceRouter.post(
  '/service-requirements/:id/approve',
  requirePermission('services.approve'),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM service_requirements WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Requirement not found.')
    scopedService(req, row.service_id)
    if (row.review_status !== 'pending_review') throw unprocessable('Only a requirement pending review can be approved.')
    if (!row.source_title) throw unprocessable('Record the source title before approving a requirement.')
    run(`UPDATE service_requirements SET review_status = 'approved', verified_by = ?, verified_at = ?, updated_at = ? WHERE id = ?`, [
      req.user.id,
      nowIso(),
      nowIso(),
      row.id,
    ])
    logAudit(req, { action: 'assistance.requirement_approved', module: 'assistance', entityType: 'service_requirement', entityId: row.id })
    res.json({ message: 'Requirement approved with its recorded source.' })
  }),
)

adminAssistanceRouter.post(
  '/service-requirements/:id/archive',
  requirePermission('services.approve'),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM service_requirements WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Requirement not found.')
    scopedService(req, row.service_id)
    run(`UPDATE service_requirements SET review_status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), row.id])
    logAudit(req, { action: 'assistance.requirement_archived', module: 'assistance', entityType: 'service_requirement', entityId: row.id })
    res.json({ message: 'Requirement archived. Existing checklists keep their item labels.' })
  }),
)

adminAssistanceRouter.get(
  '/assistance/analytics',
  requirePermission('province.analytics.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      totals: {
        plans: Number(get(`SELECT COUNT(*) AS n FROM preparation_plans`).n),
        completedPlans: Number(
          get(
            `SELECT COUNT(*) AS n FROM preparation_plans p WHERE NOT EXISTS (
               SELECT 1 FROM preparation_items i WHERE i.plan_id = p.id AND i.mandatory = 1 AND i.status NOT IN ('ready','not_applicable'))`,
          ).n,
        ),
        itemsReady: Number(get(`SELECT COUNT(*) AS n FROM preparation_items WHERE status = 'ready'`).n),
        requirements: Number(get(`SELECT COUNT(*) AS n FROM service_requirements WHERE archived_at IS NULL`).n),
        approvedRequirements: Number(get(`SELECT COUNT(*) AS n FROM service_requirements WHERE review_status = 'approved'`).n),
      },
      byService: all(
        `SELECT s.title, COUNT(p.id) AS plans FROM preparation_plans p JOIN government_services s ON s.id = p.service_id
         GROUP BY s.id HAVING COUNT(p.id) >= 3 ORDER BY plans DESC LIMIT 10`,
      ),
      note: 'Aggregated preparation activity only. Private notes, documents and individual citizens are never reported.',
    })
  }),
)
