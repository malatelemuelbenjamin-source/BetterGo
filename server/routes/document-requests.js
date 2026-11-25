/**
 * Document request centre (Prompt 76). BetterGo tracks a citizen's request and
 * its office-recorded status. It does not issue, certify or release documents.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const STATUSES = ['submitted', 'acknowledged', 'needs_information', 'ready_for_office_release', 'completed', 'rejected', 'cancelled', 'expired']
const OPEN = ['submitted', 'acknowledged', 'needs_information', 'ready_for_office_release']
const PUBLISHED = `s.publication_status = 'published' AND s.archived_at IS NULL`

function notify(userId, title, message, requestId) {
  const prefs = get(`SELECT in_app_enabled FROM notification_preferences WHERE user_id = ?`, [userId])
  if (prefs && Number(prefs.in_app_enabled) === 0) return
  run(
    `INSERT INTO notifications (user_id, title, message, notification_type, category, related_entity_type, related_entity_id)
     VALUES (?, ?, ?, 'document_request', 'account', 'document_request', ?)`,
    [userId, title, message, requestId],
  )
}

function addEvent(id, action, from, to, actorType, actorId, note = null) {
  run(`INSERT INTO document_request_events (request_id, action, from_status, to_status, actor_type, actor_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    id,
    action,
    from || null,
    to || null,
    actorType,
    actorId,
    note ? cleanText(note, 500) : null,
  ])
}

function reference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let code = 'BG-DOC-'
    for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)]
    if (!get(`SELECT id FROM document_requests WHERE reference = ?`, [code])) return code
  }
  throw unprocessable('Could not generate a request reference. Please retry.')
}

function shape(row) {
  const service = get(`SELECT title, slug FROM government_services WHERE id = ?`, [row.service_id])
  return {
    id: row.id,
    reference: row.reference,
    serviceTitle: service?.title,
    serviceSlug: service?.slug,
    officeName: row.office_name,
    purpose: row.purpose,
    status: row.status,
    officeNote: row.office_note,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    events: all(`SELECT action, from_status, to_status, actor_type, note, created_at FROM document_request_events WHERE request_id = ? ORDER BY id`, [row.id]),
  }
}

const officeFor = (service) =>
  service.office_id
    ? get(`SELECT name, address, phone, email, operating_hours, website FROM government_offices WHERE id = ? AND publication_status = 'published'`, [service.office_id])
    : null

export const documentRequestsRouter = Router()
documentRequestsRouter.use(requireAuth)

documentRequestsRouter.get(
  '/document-requests',
  asyncHandler(async (req, res) => {
    const settings = all(
      `SELECT s.id, s.title, s.slug, s.short_description, s.request_method, s.external_request_url, s.office_id, s.municipality_id,
              c.name AS category_name, m.name AS municipality_name,
              (SELECT COUNT(*) FROM service_requirements r WHERE r.service_id = s.id AND r.archived_at IS NULL) AS requirement_count
       FROM government_services s LEFT JOIN service_categories c ON c.id = s.category_id LEFT JOIN municipalities m ON m.id = s.municipality_id
       WHERE ${PUBLISHED} AND (s.request_method IS NOT NULL OR EXISTS (SELECT 1 FROM service_requirements r WHERE r.service_id = s.id AND r.archived_at IS NULL))
       ORDER BY c.name, s.title LIMIT 60`,
    )
    const requests = all(`SELECT * FROM document_requests WHERE user_id = ? ORDER BY id DESC LIMIT 100`, [req.user.id]).map(shape)
    res.json({
      guidance: settings.map((service) => ({
        id: service.id,
        title: service.title,
        slug: service.slug,
        summary: service.short_description,
        categoryName: service.category_name || 'Uncategorised',
        municipalityName: service.municipality_name,
        requirementCount: service.requirement_count,
        requestMethod: service.request_method || 'information',
        externalUrl: service.request_method === 'external' ? service.external_request_url : null,
      })),
      categories: [...new Set(settings.map((service) => service.category_name).filter(Boolean))].sort(),
      requests: requests.filter((row) => OPEN.includes(row.status)),
      history: requests.filter((row) => !OPEN.includes(row.status)),
      notice: 'BetterGo records your request and its status. It does not issue, authenticate or release government documents.',
    })
  }),
)

documentRequestsRouter.get(
  '/document-requests/guidance/:slug',
  asyncHandler(async (req, res) => {
    const service = get(
      `SELECT s.*, m.name AS municipality_name FROM government_services s LEFT JOIN municipalities m ON m.id = s.municipality_id WHERE s.slug = ? AND ${PUBLISHED}`,
      [String(req.params.slug)],
    )
    if (!service) throw notFound('Service not found.')
    const requirements = all(`SELECT requirement_name, description, is_required, review_status, source_title, source_url, issuing_office FROM service_requirements WHERE service_id = ? AND archived_at IS NULL ORDER BY sort_order, id`, [service.id])
    const existing = get(`SELECT id FROM document_requests WHERE user_id = ? AND service_id = ? AND status IN ('submitted','acknowledged','needs_information')`, [req.user.id, service.id])
    res.json({
      service: {
        id: service.id,
        title: service.title,
        slug: service.slug,
        summary: service.short_description,
        municipalityName: service.municipality_name,
        requestMethod: service.request_method || 'information',
        externalUrl: service.request_method === 'external' ? service.external_request_url : null,
        instructions: service.request_instructions || null,
      },
      office: officeFor(service),
      requirements: requirements.map((row) => ({ ...row, verified: row.review_status === 'approved' })),
      existingRequestId: existing?.id || null,
      canSubmit: ['bettergo', 'request'].includes(service.request_method || '') && !existing,
      notice: 'Only information recorded from official sources is shown. A missing office detail is not evidence that a service is unavailable.',
    })
  }),
)

documentRequestsRouter.post(
  '/document-requests',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  validate(z.object({ serviceSlug: z.string().trim().min(1).max(160), purpose: z.string().trim().max(300).optional().or(z.literal('')), note: z.string().trim().max(500).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const service = get(`SELECT * FROM government_services s WHERE s.slug = ? AND ${PUBLISHED}`, [req.body.serviceSlug])
    if (!service) throw notFound('Service not found.')
    if (!['bettergo', 'request'].includes(service.request_method || '')) {
      throw unprocessable('This service does not take BetterGo requests. Follow the recorded official instructions instead.')
    }
    const duplicate = get(`SELECT id FROM document_requests WHERE user_id = ? AND service_id = ? AND status IN ('submitted','acknowledged','needs_information')`, [req.user.id, service.id])
    if (duplicate) throw unprocessable('You already have an open request for this service.')
    const office = officeFor(service)
    const ref = reference()
    const id = Number(
      run(
        `INSERT INTO document_requests (reference, user_id, service_id, municipality_id, office_name, purpose, status)
         VALUES (?, ?, ?, ?, ?, ?, 'submitted')`,
        [ref, req.user.id, service.id, service.municipality_id || null, office?.name || null, cleanText(req.body.purpose, 300)],
      ).lastInsertRowid,
    )
    addEvent(id, 'submitted', null, 'submitted', 'citizen', req.user.id, req.body.note)
    notify(req.user.id, 'Document request recorded', `BetterGo recorded request ${ref} for ${service.title}. This is not an issued document or an official approval.`, id)
    res.status(201).json({
      message: 'Request recorded. The responsible office still decides whether to release a document.',
      request: shape(get(`SELECT * FROM document_requests WHERE id = ?`, [id])),
    })
  }),
)

async function ownRequest(userId, id) {
  const row = get(`SELECT * FROM document_requests WHERE id = ? AND user_id = ?`, [Number(id), userId])
  if (!row) throw notFound('Document request not found.')
  return row
}

documentRequestsRouter.get(
  '/document-requests/:id',
  asyncHandler(async (req, res) => {
    const row = await ownRequest(req.user.id, req.params.id)
    res.json({
      request: shape(row),
      office: get(`SELECT o.name, o.address, o.phone, o.email, o.operating_hours, o.website FROM document_requests d JOIN government_services s ON s.id = d.service_id LEFT JOIN government_offices o ON o.id = s.office_id WHERE d.id = ?`, [row.id]),
      label: 'BetterGo request record — not an official document, certificate or government approval.',
    })
  }),
)

documentRequestsRouter.get(
  '/document-requests/:id/summary',
  asyncHandler(async (req, res) => {
    const row = await ownRequest(req.user.id, req.params.id)
    const shaped = shape(row)
    res.type('text/plain').send([
      'BetterGo request record — not an official document, certificate or government approval.',
      `Reference: ${shaped.reference}`,
      `Service: ${shaped.serviceTitle}`,
      `Status: ${shaped.status.replaceAll('_', ' ')}`,
      `Office: ${shaped.officeName || 'Not recorded'}`,
      `Submitted: ${shaped.submittedAt}`,
      'Only the responsible government office can issue or release an official document.',
    ].join('\n'))
  }),
)

documentRequestsRouter.post(
  '/document-requests/:id/cancel',
  asyncHandler(async (req, res) => {
    const row = await ownRequest(req.user.id, req.params.id)
    if (!OPEN.includes(row.status)) throw unprocessable('This request is already closed.')
    run(`UPDATE document_requests SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowIso(), row.id])
    addEvent(row.id, 'cancelled_by_citizen', row.status, 'cancelled', 'citizen', req.user.id)
    res.json({ message: 'Request cancelled in BetterGo. The office may have its own separate record.', request: shape(get(`SELECT * FROM document_requests WHERE id = ?`, [row.id])) })
  }),
)

/* -------------------------------- Admin --------------------------------- */

export const adminDocumentRequestsRouter = Router()
adminDocumentRequestsRouter.use(requireAuth, requireAdmin)

adminDocumentRequestsRouter.get(
  '/document-requests',
  requirePermission('services.view'),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const filters = []
    const params = []
    if (req.query.status) {
      filters.push('d.status = ?')
      params.push(String(req.query.status))
    }
    if (!context.hasGlobalScope) {
      if (!context.municipalityIds.length) return res.json({ results: [], statuses: STATUSES })
      filters.push(`d.municipality_id IN (${context.municipalityIds.map(() => '?').join(',')})`)
      params.push(...context.municipalityIds)
    }
    const rows = all(
      `SELECT d.*, s.title AS service_title, u.name AS citizen_name FROM document_requests d JOIN government_services s ON s.id = d.service_id JOIN users u ON u.id = d.user_id
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY d.id DESC LIMIT 100`,
      params,
    )
    res.json({
      results: rows.map((row) => ({ ...shape(row), serviceTitle: row.service_title, citizenName: row.citizen_name, internalNote: row.internal_note })),
      statuses: STATUSES,
      note: 'Status changes are platform records supplied by authorized staff. They do not issue a document.',
    })
  }),
)

adminDocumentRequestsRouter.post(
  '/document-requests/:id/status',
  requirePermission('services.update'),
  validate(z.object({ status: z.enum(['acknowledged', 'needs_information', 'ready_for_office_release', 'completed', 'rejected', 'expired']), note: z.string().trim().max(500).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT d.*, s.municipality_id FROM document_requests d JOIN government_services s ON s.id = d.service_id WHERE d.id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Document request not found.')
    if (!ctx(req).hasGlobalScope && !(row.municipality_id && canUseMunicipality(ctx(req), row.municipality_id))) throw notFound('Document request not found.')
    if (!OPEN.includes(row.status)) throw unprocessable('This request is already closed.')
    if (req.body.status === 'rejected' && !String(req.body.note || '').trim()) throw unprocessable('A reason is required when rejecting a request.')
    run(`UPDATE document_requests SET status = ?, office_note = ?, updated_at = ? WHERE id = ?`, [req.body.status, cleanText(req.body.note, 500), nowIso(), row.id])
    addEvent(row.id, `status_${req.body.status}`, row.status, req.body.status, 'admin', req.user.id, req.body.note)
    logAudit(req, { action: 'document_requests.status_updated', module: 'document_requests', entityType: 'document_request', entityId: row.id })
    notify(row.user_id, 'Document request status updated', `Request ${row.reference} is now ${req.body.status.replaceAll('_', ' ')}. Check the office for any official document release.`, row.id)
    res.json({ message: 'Status recorded.', request: shape(get(`SELECT * FROM document_requests WHERE id = ?`, [row.id])) })
  }),
)

adminDocumentRequestsRouter.put(
  '/document-requests/services/:id/guidance',
  requirePermission('services.update'),
  validate(z.object({ requestMethod: z.enum(['information', 'external', 'bettergo', 'request', 'none']), externalUrl: z.string().trim().url().max(500).optional().or(z.literal('')), instructions: z.string().trim().max(1000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const service = get(`SELECT * FROM government_services WHERE id = ?`, [Number(req.params.id)])
    if (!service) throw notFound('Service not found.')
    if (!ctx(req).hasGlobalScope && !(service.municipality_id && canUseMunicipality(ctx(req), service.municipality_id))) throw notFound('Service not found.')
    if (req.body.requestMethod === 'external' && !req.body.externalUrl) throw unprocessable('An official external request link is required for external requests.')
    run(`UPDATE government_services SET request_method = ?, external_request_url = ?, request_instructions = ?, updated_at = ? WHERE id = ?`, [
      req.body.requestMethod,
      cleanText(req.body.externalUrl, 500),
      cleanText(req.body.instructions, 1000),
      nowIso(),
      service.id,
    ])
    logAudit(req, { action: 'document_requests.guidance_updated', module: 'document_requests', entityType: 'government_service', entityId: service.id })
    res.json({ message: 'Request guidance saved.' })
  }),
)

adminDocumentRequestsRouter.patch(
  '/document-requests/:id/note',
  requirePermission('services.update'),
  validate(z.object({ note: z.string().trim().max(1000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT d.*, s.municipality_id FROM document_requests d JOIN government_services s ON s.id = d.service_id WHERE d.id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Document request not found.')
    if (!ctx(req).hasGlobalScope && !(row.municipality_id && canUseMunicipality(ctx(req), row.municipality_id))) throw notFound('Document request not found.')
    run(`UPDATE document_requests SET internal_note = ?, updated_at = ? WHERE id = ?`, [cleanText(req.body.note, 1000), nowIso(), row.id])
    res.json({ message: 'Internal note saved.' })
  }),
)
