import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { requireAuth, rateLimit } from '../auth.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { APPLICATION_STATUSES, CITIZEN_WITHDRAWABLE, REVIEWER_STATUSES } from '../lib/citizen.js'

/**
 * BetterGo application tracking (Prompt 65).
 *
 * Every route is scoped to the signed-in citizen; references are random, and a
 * foreign reference answers 404 so records cannot be probed.
 */
export const applicationsRouter = Router()
applicationsRouter.use('/account/applications', requireAuth)

const CLASSIFICATION = {
  bettergo_intake: 'Submitted to BetterGo — not an official government filing',
  information_only: 'BetterGo record',
}

const DISCLAIMER =
  'No government office has received, accepted, processed or approved this submission. BetterGo statuses are platform states, not a government decision.'

function citizenApplication(reference, userId) {
  return get(
    `SELECT a.*, m.name AS municipality_name, s.title AS service_title, s.slug AS service_slug,
            f.title AS form_title, f.privacy_notice_version AS current_privacy_version
     FROM citizen_applications a
     LEFT JOIN municipalities m ON m.id = a.municipality_id
     LEFT JOIN government_services s ON s.id = a.service_id
     LEFT JOIN service_forms f ON f.id = a.form_id
     WHERE a.reference = ? AND a.user_id = ?`,
    [String(reference), userId],
  )
}

function notifyCitizen(userId, title, message, applicationId) {
  const prefs = get(`SELECT in_app_enabled FROM notification_preferences WHERE user_id = ?`, [userId])
  if (prefs && Number(prefs.in_app_enabled) === 0) return
  run(
    `INSERT INTO notifications (user_id, title, message, notification_type, related_entity_type, related_entity_id)
     VALUES (?, ?, ?, 'application', 'application', ?)`,
    [userId, title, message, applicationId],
  )
}

function addEvent(applicationId, fromStatus, toStatus, note, actorId, citizenVisible = 1) {
  run(
    `INSERT INTO citizen_application_events (application_id, from_status, to_status, citizen_visible, note, actor_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [applicationId, fromStatus, toStatus, citizenVisible ? 1 : 0, note || null, actorId],
  )
}

applicationsRouter.get(
  '/account/applications',
  asyncHandler(async (req, res) => {
    const status = APPLICATION_STATUSES[String(req.query.status)] ? String(req.query.status) : null
    const term = cleanText(req.query.q, 100)
    const sort = ['newest', 'oldest', 'status'].includes(String(req.query.sort)) ? String(req.query.sort) : 'newest'
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : null
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : null
    const municipalityId = Number(req.query.municipalityId) || null

    const where = ['a.user_id = ?']
    const params = [req.user.id]
    if (status) {
      where.push('a.status = ?')
      params.push(status)
    }
    if (municipalityId) {
      where.push('a.municipality_id = ?')
      params.push(municipalityId)
    }
    if (term) {
      where.push('(a.reference LIKE ? OR s.title LIKE ?)')
      params.push(`%${term}%`, `%${term}%`)
    }
    if (from) {
      where.push('date(COALESCE(a.submitted_at, a.created_at)) >= date(?)')
      params.push(from)
    }
    if (to) {
      where.push('date(COALESCE(a.submitted_at, a.created_at)) <= date(?)')
      params.push(to)
    }
    const order = sort === 'oldest' ? 'a.id ASC' : sort === 'status' ? 'a.status ASC, a.id DESC' : 'a.id DESC'

    const rows = all(
      `SELECT a.reference, a.status, a.citizen_status_note, a.submitted_at, a.created_at, a.updated_at,
              a.submission_classification, a.form_id,
              m.name AS municipality_name, s.title AS service_title, s.slug AS service_slug
       FROM citizen_applications a
       LEFT JOIN municipalities m ON m.id = a.municipality_id
       LEFT JOIN government_services s ON s.id = a.service_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${order}`,
      params,
    )

    const counts = {
      total: Number(get(`SELECT COUNT(*) AS n FROM citizen_applications WHERE user_id = ?`, [req.user.id]).n),
      draft: Number(get(`SELECT COUNT(*) AS n FROM citizen_applications WHERE user_id = ? AND status = 'draft'`, [req.user.id]).n),
      submitted: Number(
        get(`SELECT COUNT(*) AS n FROM citizen_applications WHERE user_id = ? AND status IN ('submitted','resubmitted')`, [req.user.id]).n,
      ),
      inReview: Number(
        get(`SELECT COUNT(*) AS n FROM citizen_applications WHERE user_id = ? AND status IN ('in_review','awaiting_citizen')`, [req.user.id]).n,
      ),
      closed: Number(
        get(`SELECT COUNT(*) AS n FROM citizen_applications WHERE user_id = ? AND status IN ('closed','completed','cancelled')`, [req.user.id]).n,
      ),
    }

    res.json({
      results: rows.slice((page - 1) * limit, page * limit),
      total: rows.length,
      page,
      limit,
      counts,
      statuses: APPLICATION_STATUSES,
      municipalities: all(
        `SELECT DISTINCT m.id, m.name FROM citizen_applications a JOIN municipalities m ON m.id = a.municipality_id
         WHERE a.user_id = ? ORDER BY m.name`,
        [req.user.id],
      ),
      note: 'Tracking records are BetterGo containers. They are not government applications, and no status here is a government decision.',
      disclaimer: DISCLAIMER,
    })
  }),
)

applicationsRouter.get(
  '/account/applications/:reference',
  asyncHandler(async (req, res) => {
    const application = citizenApplication(req.params.reference, req.user.id)
    if (!application) throw notFound('Application not found.')

    let answers = null
    if (application.form_answers) {
      try {
        answers = JSON.parse(application.form_answers)
      } catch {
        answers = null
      }
    }
    const documentIds = application.document_ids ? JSON.parse(application.document_ids) : []
    const documents = documentIds.length
      ? all(
          `SELECT id, original_filename, category, mime_type, file_size, created_at
           FROM citizen_documents WHERE user_id = ? AND id IN (${documentIds.map(() => '?').join(',')})`,
          [req.user.id, ...documentIds],
        )
      : []

    res.json({
      application: {
        reference: application.reference,
        status: application.status,
        statusLabel: APPLICATION_STATUSES[application.status] || application.status,
        citizenStatusNote: application.citizen_status_note,
        submittedAt: application.submitted_at,
        createdAt: application.created_at,
        updatedAt: application.updated_at,
        municipalityName: application.municipality_name,
        serviceTitle: application.service_title,
        serviceSlug: application.service_slug,
        formId: application.form_id,
        formTitle: application.form_title,
        formVersion: application.form_version,
        privacyNoticeVersion: application.privacy_notice_version,
        consentedAt: application.consented_at,
        submissionClassification: application.submission_classification,
        classificationLabel: CLASSIFICATION[application.submission_classification] || 'BetterGo record',
        classificationNote: DISCLAIMER,
        externalReference: application.external_reference || null,
      },
      answers,
      documents,
      history: all(
        `SELECT to_status, from_status, note, created_at FROM citizen_application_events
         WHERE application_id = ? AND citizen_visible = 1 ORDER BY id ASC`,
        [application.id],
      ).map((event) => ({ ...event, label: APPLICATION_STATUSES[event.to_status] || event.to_status })),
      actions: {
        canWithdraw: CITIZEN_WITHDRAWABLE.includes(application.status),
        canResubmit: application.status === 'awaiting_citizen',
      },
      disclaimer: DISCLAIMER,
    })
  }),
)

applicationsRouter.post(
  '/account/applications/:reference/withdraw',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  validate(z.object({ reason: z.string().trim().max(500).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const application = citizenApplication(req.params.reference, req.user.id)
    if (!application) throw notFound('Application not found.')
    if (!CITIZEN_WITHDRAWABLE.includes(application.status)) {
      throw unprocessable('This record can no longer be withdrawn.', [{ field: 'status', message: 'Not withdrawable.' }])
    }
    const reason = cleanText(req.body.reason, 500)
    run(`UPDATE citizen_applications SET status = 'withdrawn', withdrawn_at = ?, withdrawal_reason = ?, updated_at = ? WHERE id = ?`, [
      nowIso(),
      reason,
      nowIso(),
      application.id,
    ])
    addEvent(application.id, application.status, 'withdrawn', reason || 'Withdrawn by the citizen.', req.user.id)
    notifyCitizen(
      req.user.id,
      'BetterGo submission withdrawn',
      `Reference ${application.reference} was withdrawn on BetterGo. The record is kept for audit; this does not withdraw any government filing.`,
      application.id,
    )
    logAudit(req, { action: 'citizen.application_withdrawn', module: 'citizen', entityType: 'citizen_application', entityId: application.id })
    res.json({
      message: 'Withdrawn on BetterGo. Your record is kept for audit, and any separate government filing is unaffected.',
      status: 'withdrawn',
      statusLabel: APPLICATION_STATUSES.withdrawn,
    })
  }),
)

applicationsRouter.post(
  '/account/applications/:reference/resubmit',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }),
  validate(z.object({ answers: z.record(z.any()).optional(), note: z.string().trim().max(1000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const application = citizenApplication(req.params.reference, req.user.id)
    if (!application) throw notFound('Application not found.')
    if (application.status !== 'awaiting_citizen') {
      throw unprocessable('This record is not waiting for information.')
    }
    let merged = application.form_answers ? JSON.parse(application.form_answers) : {}
    if (req.body.answers && typeof req.body.answers === 'object') {
      merged = { ...merged, ...req.body.answers }
    }
    run(`UPDATE citizen_applications SET status = 'resubmitted', form_answers = ?, updated_at = ? WHERE id = ?`, [
      JSON.stringify(merged).slice(0, 200_000),
      nowIso(),
      application.id,
    ])
    addEvent(application.id, 'awaiting_citizen', 'resubmitted', cleanText(req.body.note, 1000) || 'Additional information provided.', req.user.id)
    notifyCitizen(
      req.user.id,
      'Information resubmitted',
      `Reference ${application.reference} was updated on BetterGo. This is not an official government filing.`,
      application.id,
    )
    logAudit(req, { action: 'citizen.application_resubmitted', module: 'citizen', entityType: 'citizen_application', entityId: application.id })
    res.json({ message: 'Information resubmitted on BetterGo.', status: 'resubmitted' })
  }),
)

/** Shared helpers for the administrative routes. */
export { citizenApplication, notifyCitizen, addEvent, REVIEWER_STATUSES, DISCLAIMER }
