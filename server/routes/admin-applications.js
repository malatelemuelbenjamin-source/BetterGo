import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { requireAdmin, requirePermission, ctx } from '../rbac.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { APPLICATION_STATUSES, REVIEWER_STATUSES } from '../lib/citizen.js'
import { addEvent, notifyCitizen } from './applications.js'

/**
 * Administrative BetterGo application management (Prompt 65 §11–12, §17).
 * Municipality-scoped: reviewers never see submissions outside their scope.
 */
export const adminApplicationsRouter = Router()
adminApplicationsRouter.use(requireAdmin)

const scopes = (req) => {
  const context = ctx(req)
  return context.hasGlobalScope ? null : context.municipalityIds || []
}

function scopedApplication(req, id) {
  const application = get(
    `SELECT a.*, u.email AS citizen_email, COALESCE(up.display_name, u.name) AS citizen_name,
            m.name AS municipality_name, s.title AS service_title, f.title AS form_title
     FROM citizen_applications a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN municipalities m ON m.id = a.municipality_id
     LEFT JOIN government_services s ON s.id = a.service_id
     LEFT JOIN service_forms f ON f.id = a.form_id
     WHERE a.id = ?`,
    [Number(id)],
  )
  if (!application) throw notFound('Application not found.')
  const scope = scopes(req)
  if (scope && !scope.includes(Number(application.municipality_id))) throw notFound('Application not found.')
  return application
}

const CITIZEN_SAFE =
  'BetterGo platform status only. No government office has received, accepted, processed, approved or refused this submission.'

adminApplicationsRouter.get(
  '/applications',
  requirePermission('services.view'),
  asyncHandler(async (req, res) => {
    const scope = scopes(req)
    const status = APPLICATION_STATUSES[String(req.query.status)] ? String(req.query.status) : null
    const term = cleanText(req.query.q, 100)
    const municipalityId = Number(req.query.municipalityId) || null
    const serviceId = Number(req.query.serviceId) || null
    const assigned = String(req.query.assigned || '')
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25))

    const where = ['1 = 1']
    const params = []
    if (scope) {
      where.push(`a.municipality_id IN (${scope.map(() => '?').join(',')})`)
      params.push(...scope)
    }
    if (status) {
      where.push('a.status = ?')
      params.push(status)
    }
    if (municipalityId) {
      where.push('a.municipality_id = ?')
      params.push(municipalityId)
    }
    if (serviceId) {
      where.push('a.service_id = ?')
      params.push(serviceId)
    }
    if (term) {
      where.push('a.reference LIKE ?')
      params.push(`%${term}%`)
    }
    if (assigned === 'me') {
      where.push('a.reviewer_id = ?')
      params.push(req.user.id)
    } else if (assigned === 'unassigned') {
      where.push('a.reviewer_id IS NULL')
    }

    const rows = all(
      `SELECT a.id, a.reference, a.status, a.submitted_at, a.created_at, a.updated_at,
              a.reviewer_id, COALESCE(ru.name, '') AS reviewer_name,
              m.name AS municipality_name, s.title AS service_title, c.email AS citizen_email
       FROM citizen_applications a
       JOIN users c ON c.id = a.user_id
       LEFT JOIN users ru ON ru.id = a.reviewer_id
       LEFT JOIN municipalities m ON m.id = a.municipality_id
       LEFT JOIN government_services s ON s.id = a.service_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.id DESC`,
      params,
    )

    res.json({
      results: rows.slice((page - 1) * limit, page * limit),
      total: rows.length,
      page,
      limit,
      statuses: APPLICATION_STATUSES,
      municipalities: all(`SELECT id, name FROM municipalities ORDER BY name`),
      note: CITIZEN_SAFE,
    })
  }),
)

adminApplicationsRouter.get(
  '/applications/analytics',
  requirePermission('services.view'),
  asyncHandler(async (req, res) => {
    const scope = scopes(req)
    const filter = scope ? `AND a.municipality_id IN (${scope.map(() => '?').join(',')})` : ''
    const params = scope || []
    const total = Number(get(`SELECT COUNT(*) AS n FROM citizen_applications a WHERE 1 = 1 ${filter}`, params).n)
    const byStatus = all(
      `SELECT a.status, COUNT(*) AS n FROM citizen_applications a WHERE 1 = 1 ${filter} GROUP BY a.status ORDER BY n DESC`,
      params,
    )
    const byMunicipality = all(
      `SELECT COALESCE(m.name, 'Unassigned') AS name, COUNT(*) AS n
       FROM citizen_applications a LEFT JOIN municipalities m ON m.id = a.municipality_id
       WHERE 1 = 1 ${filter} GROUP BY m.name ORDER BY n DESC LIMIT 10`,
      params,
    )
    const byService = all(
      `SELECT COALESCE(s.title, 'Unknown service') AS name, COUNT(*) AS n
       FROM citizen_applications a LEFT JOIN government_services s ON s.id = a.service_id
       WHERE 1 = 1 ${filter} GROUP BY s.title ORDER BY n DESC LIMIT 10`,
      params,
    )
    const reviewRows = all(
      `SELECT a.submitted_at, a.closed_at FROM citizen_applications a
       WHERE a.closed_at IS NOT NULL AND a.submitted_at IS NOT NULL ${filter}`,
      params,
    )
    const durations = reviewRows
      .map((row) => (new Date(row.closed_at).getTime() - new Date(row.submitted_at).getTime()) / 86_400_000)
      .filter((value) => Number.isFinite(value) && value >= 0)
    const average = durations.length >= 5 ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10 : null
    const last30 = Number(
      get(
        `SELECT COUNT(*) AS n FROM citizen_applications a
         WHERE a.submitted_at IS NOT NULL AND a.submitted_at >= datetime('now', '-30 days') ${filter}`,
        params,
      ).n,
    )
    const infoRequests = Number(
      get(
        `SELECT COUNT(*) AS n FROM citizen_application_events e
         JOIN citizen_applications a ON a.id = e.application_id
         WHERE e.to_status = 'awaiting_citizen' ${filter}`,
        params,
      ).n,
    )
    const closures = Number(
      get(`SELECT COUNT(*) AS n FROM citizen_applications a WHERE a.status IN ('closed','completed') ${filter}`, params).n,
    )

    res.json({
      total,
      last30Days: last30,
      byStatus,
      byMunicipality,
      byService,
      additionalInfoRequests: infoRequests,
      closures,
      averageReviewDays: average,
      averageNote:
        average === null
          ? 'Not shown: at least five closed records with real timestamps are needed before an average is meaningful.'
          : 'Average number of days between BetterGo submission and BetterGo closure. This is platform handling time, not government processing time.',
      disclaimer: 'These are BetterGo platform metrics. They are not official government performance statistics.',
    })
  }),
)

adminApplicationsRouter.get(
  '/applications/:id',
  requirePermission('services.view'),
  asyncHandler(async (req, res) => {
    const application = scopedApplication(req, req.params.id)
    let answers = null
    try {
      answers = application.form_answers ? JSON.parse(application.form_answers) : null
    } catch {
      answers = null
    }
    const documentIds = application.document_ids ? JSON.parse(application.document_ids) : []
    const documents = documentIds.length
      ? all(
          `SELECT d.id, d.original_filename, d.mime_type, d.file_size, d.created_at, d.category
           FROM citizen_documents d WHERE d.id IN (${documentIds.map(() => '?').join(',')})`,
          documentIds,
        )
      : []
    res.json({
      application: {
        id: application.id,
        reference: application.reference,
        status: application.status,
        statusLabel: APPLICATION_STATUSES[application.status] || application.status,
        citizenStatusNote: application.citizen_status_note,
        submittedAt: application.submitted_at,
        createdAt: application.created_at,
        municipalityName: application.municipality_name,
        serviceTitle: application.service_title,
        formTitle: application.form_title,
        formVersion: application.form_version,
        submissionClassification: application.submission_classification,
        citizenEmail: application.citizen_email,
        citizenName: application.citizen_name,
        reviewerId: application.reviewer_id,
        reviewerName: application.reviewer_name,
        externalReference: application.external_reference || null,
        privacyNoticeVersion: application.privacy_notice_version,
      },
      answers,
      documents,
      history: all(
        `SELECT e.from_status, e.to_status, e.note, e.citizen_visible, e.created_at, u.name AS actor_name
         FROM citizen_application_events e LEFT JOIN users u ON u.id = e.actor_id
         WHERE e.application_id = ? ORDER BY e.id ASC`,
        [application.id],
      ),
      reviewers: all(
        `SELECT DISTINCT u.id, COALESCE(up.display_name, u.name, u.email) AS name
         FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id
         JOIN user_role_assignments ra ON ra.user_id = u.id
         WHERE u.account_status = 'active' ${scopes(req) ? 'AND ra.municipality_id IS NULL' : ''}
         ORDER BY name LIMIT 100`,
      ),
      disclaimer: CITIZEN_SAFE,
    })
  }),
)

adminApplicationsRouter.post(
  '/applications/:id/status',
  requirePermission('services.view'),
  validate(
    z.object({
      status: z.enum(REVIEWER_STATUSES),
      note: z.string().trim().max(1000).optional().or(z.literal('')),
      citizenVisible: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const application = scopedApplication(req, req.params.id)
    if (['withdrawn'].includes(application.status)) throw unprocessable('A withdrawn record cannot be moved to another status.')
    const { status } = req.body
    const note = cleanText(req.body.note, 1000)
    const citizenVisible = req.body.citizenVisible !== false
    if (status === 'closed' && !note) throw unprocessable('Explain the closure so the citizen understands it.')
    run(`UPDATE citizen_applications SET status = ?, citizen_status_note = ?, closed_at = ?, updated_at = ? WHERE id = ?`, [
      status,
      citizenVisible ? note || null : null,
      status === 'closed' ? nowIso() : application.closed_at,
      nowIso(),
      application.id,
    ])
    addEvent(application.id, application.status, status, note, req.user.id, citizenVisible)
    notifyCitizen(
      application.user_id,
      `BetterGo record ${application.reference} updated`,
      `Status: ${APPLICATION_STATUSES[status]}. ${note || ''} This is a BetterGo platform status, not a government decision.`.trim().slice(0, 400),
      application.id,
    )
    logAudit(req, { action: 'admin.application_status_changed', module: 'citizen', entityType: 'citizen_application', entityId: application.id })
    res.json({ message: 'Status updated.', status })
  }),
)

adminApplicationsRouter.post(
  '/applications/:id/request-info',
  requirePermission('services.view'),
  validate(z.object({ message: z.string().trim().min(10).max(1000) })),
  asyncHandler(async (req, res) => {
    const application = scopedApplication(req, req.params.id)
    if (['closed', 'withdrawn'].includes(application.status)) throw unprocessable('Closed or withdrawn records cannot request more information.')
    const message = cleanText(req.body.message, 1000)
    run(`UPDATE citizen_applications SET status = 'awaiting_citizen', citizen_status_note = ?, updated_at = ? WHERE id = ?`, [
      message,
      nowIso(),
      application.id,
    ])
    addEvent(application.id, application.status, 'awaiting_citizen', message, req.user.id)
    notifyCitizen(
      application.user_id,
      'More information requested',
      `Reference ${application.reference}: ${message}`.slice(0, 400),
      application.id,
    )
    logAudit(req, { action: 'admin.application_info_requested', module: 'citizen', entityType: 'citizen_application', entityId: application.id })
    res.json({ message: 'Information request sent to the citizen.' })
  }),
)

adminApplicationsRouter.post(
  '/applications/:id/message',
  requirePermission('services.view'),
  validate(z.object({ message: z.string().trim().min(1).max(1000) })),
  asyncHandler(async (req, res) => {
    const application = scopedApplication(req, req.params.id)
    const message = cleanText(req.body.message, 1000)
    addEvent(application.id, application.status, application.status, message, req.user.id)
    notifyCitizen(application.user_id, `Message about ${application.reference}`, message.slice(0, 400), application.id)
    logAudit(req, { action: 'admin.application_message_sent', module: 'citizen', entityType: 'citizen_application', entityId: application.id })
    res.json({ message: 'Message added.' })
  }),
)

adminApplicationsRouter.post(
  '/applications/:id/assign',
  requirePermission('services.view'),
  validate(z.object({ reviewerId: z.union([z.number().int().positive(), z.null()]) })),
  asyncHandler(async (req, res) => {
    const application = scopedApplication(req, req.params.id)
    const reviewerId = req.body.reviewerId
    if (reviewerId) {
      const reviewer = get(`SELECT id, account_status FROM users WHERE id = ?`, [reviewerId])
      if (!reviewer || reviewer.account_status !== 'active') throw unprocessable('That reviewer account is not active.')
      const roles = get(`SELECT COUNT(*) AS n FROM user_role_assignments WHERE user_id = ?`, [reviewerId])
      if (!Number(roles.n)) throw unprocessable('That account has no administrative role.')
    }
    run(`UPDATE citizen_applications SET reviewer_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?`, [
      reviewerId,
      reviewerId ? nowIso() : null,
      nowIso(),
      application.id,
    ])
    addEvent(
      application.id,
      application.status,
      application.status,
      reviewerId ? 'Assigned to a BetterGo reviewer.' : 'Reviewer assignment cleared.',
      req.user.id,
      0,
    )
    logAudit(req, { action: 'admin.application_assigned', module: 'citizen', entityType: 'citizen_application', entityId: application.id })
    res.json({ message: reviewerId ? 'Reviewer assigned.' : 'Assignment cleared.' })
  }),
)
