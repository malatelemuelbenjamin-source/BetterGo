/**
 * Citizen privacy centre and privacy administration (Prompt 71).
 *
 * Reuses consent_records, data_requests, data_exports, document_shares and
 * privacy_incidents. Nothing here claims legal certification: technical
 * controls are implemented, and statutory retention or notification duties
 * need qualified legal review.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission } from '../rbac.js'
import { asyncHandler, cleanText, forbidden, notFound, reference, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { PRIVACY_REQUEST_STATUSES } from '../lib/records.js'

export const privacyRouter = Router()
privacyRouter.use(requireAuth)

const OPTIONAL_CONSENTS = ['optional_communications', 'personalization', 'document_sharing', 'external_referral']
const REQUIRED_CONSENTS = ['terms_of_use', 'privacy_policy']
const REQUEST_CATEGORIES = ['access', 'correction', 'deletion', 'restriction', 'withdraw_consent', 'concern', 'question']

function noticeFor(docType) {
  return get(
    `SELECT id, doc_type, title, version, language, effective_at, published_at FROM privacy_notices
     WHERE doc_type = ? AND status = 'published' ORDER BY published_at DESC, id DESC LIMIT 1`,
    [docType],
  )
}

privacyRouter.get(
  '/privacy-center',
  asyncHandler(async (req, res) => {
    const profile = get(
      `SELECT p.first_name, p.last_name, p.display_name, p.address, p.preferred_language, p.personalization_opt_in,
              p.municipality_id, m.name AS municipality_name, u.email, u.phone, u.email_verified_at, u.phone_verified_at,
              u.account_status, u.created_at
       FROM user_profiles p JOIN users u ON u.id = p.user_id LEFT JOIN municipalities m ON m.id = p.municipality_id
       WHERE p.user_id = ?`,
      [req.user.id],
    )
    const counts = {
      saved: Number(get(`SELECT COUNT(*) AS n FROM saved_items WHERE user_id = ?`, [req.user.id]).n),
      applications: Number(get(`SELECT COUNT(*) AS n FROM citizen_applications WHERE user_id = ?`, [req.user.id]).n),
      documents: Number(get(`SELECT COUNT(*) AS n FROM citizen_documents WHERE user_id = ? AND deleted_at IS NULL`, [req.user.id]).n),
      supportTickets: Number(get(`SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ?`, [req.user.id]).n),
      feedback: Number(get(`SELECT COUNT(*) AS n FROM citizen_feedback WHERE user_id = ?`, [req.user.id]).n),
      surveyResponses: Number(get(`SELECT COUNT(*) AS n FROM survey_responses WHERE user_id = ?`, [req.user.id]).n),
      sharingPermissions: Number(get(`SELECT COUNT(*) AS n FROM document_shares WHERE user_id = ? AND revoked_at IS NULL`, [req.user.id]).n),
      exports: Number(get(`SELECT COUNT(*) AS n FROM data_exports WHERE user_id = ?`, [req.user.id]).n),
    }
    res.json({
      profile: {
        name: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || null,
        displayName: profile?.display_name || null,
        email: profile?.email || null,
        emailVerified: Boolean(profile?.email_verified_at),
        phone: profile?.phone || null,
        phoneVerified: Boolean(profile?.phone_verified_at),
        municipality: profile?.municipality_name || null,
        language: profile?.preferred_language || 'en',
        address: profile?.address || null,
        personalizationOptIn: Boolean(profile?.personalization_opt_in ?? 1),
        accountStatus: profile?.account_status || null,
        memberSince: profile?.created_at || null,
      },
      requiredInformation: [
        'Name, email address and municipality are required for a citizen account.',
        'Email verification is required for account-sensitive actions.',
      ],
      optionalInformation: [
        'Phone number, address and barangay are optional.',
        'Personalization interests and anonymous survey participation are optional.',
      ],
      counts,
      consents: all(`SELECT consent_category, status, policy_version, created_at, withdrawn_at FROM consent_records WHERE user_id = ? ORDER BY id DESC`, [
        req.user.id,
      ]),
      notices: ['privacy_policy', 'terms_of_use'].map((docType) => noticeFor(docType)).filter(Boolean),
      requests: all(
        `SELECT reference, category, status, created_at, updated_at FROM data_requests WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
        [req.user.id],
      ).map((row) => ({ ...row, statusLabel: PRIVACY_REQUEST_STATUSES[row.status] || row.status })),
      deactivation: get(`SELECT status, requested_at, reinstated_at FROM account_deactivations WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [req.user.id]) || null,
      retention: all(`SELECT record_type, retention_days FROM retention_policies ORDER BY record_type`),
      note: 'Legal retention periods and any notification duties need qualified legal review. BetterGo does not claim certification or automatic compliance.',
    })
  }),
)

privacyRouter.get(
  '/privacy-center/notices',
  asyncHandler(async (_req, res) => {
    res.json({
      notices: all(
        `SELECT doc_type, title, version, language, effective_at, published_at FROM privacy_notices
         WHERE status = 'published' ORDER BY doc_type, published_at DESC`,
      ),
      note: 'Historical notice versions are kept so old consent records still refer to the version that was accepted.',
    })
  }),
)

privacyRouter.put(
  '/privacy-center/consents/:category',
  validate(z.object({ action: z.enum(['grant', 'withdraw']), policyVersion: z.string().trim().max(40).optional() })),
  asyncHandler(async (req, res) => {
    const category = String(req.params.category)
    if (![...OPTIONAL_CONSENTS, ...REQUIRED_CONSENTS].includes(category)) throw notFound('Consent category not found.')
    if (REQUIRED_CONSENTS.includes(category) && req.body.action === 'withdraw') {
      throw forbidden('Acceptance of the Terms of Use and Privacy Policy cannot be withdrawn while the account is active. You may request account deletion instead.')
    }
    if (req.body.action === 'grant') {
      run(`INSERT INTO consent_records (user_id, consent_category, status, policy_version, source) VALUES (?, ?, 'granted', ?, 'privacy_centre')`, [
        req.user.id,
        category,
        req.body.policyVersion || null,
      ])
      return res.status(201).json({ message: 'Consent recorded.', category, status: 'granted' })
    }
    const active = get(
      `SELECT id FROM consent_records WHERE user_id = ? AND consent_category = ? AND status = 'granted' ORDER BY id DESC LIMIT 1`,
      [req.user.id, category],
    )
    if (!active) throw notFound('No active consent of that type was found.')
    run(`UPDATE consent_records SET status = 'withdrawn', withdrawn_at = ? WHERE id = ?`, [nowIso(), active.id])
    logAudit(req, { action: 'privacy.consent_withdrawn', module: 'privacy', entityType: 'consent', entityId: active.id })
    res.json({
      message:
        'Consent withdrawn. Processes that rely on another lawful basis, or that are necessary to keep an existing application or security record, are not affected.',
      category,
      status: 'withdrawn',
    })
  }),
)

privacyRouter.get(
  '/privacy-center/sharing',
  asyncHandler(async (req, res) => {
    res.json({
      results: all(
        `SELECT s.id, s.recipient_label, s.purpose, s.consented_at, s.revoked_at, d.title AS document_title, d.id AS document_id
         FROM document_shares s JOIN citizen_documents d ON d.id = s.document_id
         WHERE s.user_id = ? ORDER BY s.id DESC`,
        [req.user.id],
      ),
      note: 'This records shares you authorised in BetterGo. It does not claim to show every external access that a recipient might make outside the platform.',
    })
  }),
)

privacyRouter.delete(
  '/privacy-center/sharing/:id',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM document_shares WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Sharing record not found.')
    if (row.revoked_at) return res.json({ message: 'That sharing permission was already revoked.' })
    run(`UPDATE document_shares SET revoked_at = ? WHERE id = ?`, [nowIso(), row.id])
    logAudit(req, { action: 'privacy.share_revoked', module: 'privacy', entityType: 'document_share', entityId: row.id })
    res.json({ message: 'Sharing permission revoked.' })
  }),
)

const requestSchema = z.object({
  category: z.enum(['access', 'correction', 'deletion', 'restriction', 'withdraw_consent', 'concern', 'question']),
  description: z.string().trim().min(10).max(3000),
  requestedCategories: z.array(z.string().trim().max(60)).max(20).optional(),
  correction: z
    .object({
      field: z.string().trim().min(2).max(120),
      currentValue: z.string().trim().max(500).optional().or(z.literal('')),
      proposedValue: z.string().trim().min(1).max(500),
      explanation: z.string().trim().max(1000).optional().or(z.literal('')),
    })
    .optional(),
})

privacyRouter.post(
  '/privacy-center/requests',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 6 }),
  validate(requestSchema),
  asyncHandler(async (req, res) => {
    if (req.body.category === 'correction' && !req.body.correction) {
      throw unprocessable('Describe the correction you are asking for.', [{ field: 'correction', message: 'Required for a correction request.' }])
    }
    const ref = reference('BGPR')
    run(
      `INSERT INTO data_requests (reference, user_id, requester_name, requester_email, category, description, requested_categories, correction_details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ref,
        req.user.id,
        req.user.name,
        req.user.email,
        req.body.category,
        cleanText(req.body.description, 3000),
        req.body.requestedCategories ? JSON.stringify(req.body.requestedCategories) : null,
        req.body.correction ? JSON.stringify(req.body.correction) : null,
      ],
    )
    const created = get(`SELECT id FROM data_requests WHERE reference = ?`, [ref])
    run(`INSERT INTO privacy_request_events (request_id, from_status, to_status, note, actor_id) VALUES (?, NULL, 'submitted', 'Request received', ?)`, [
      created.id,
      req.user.id,
    ])
    logAudit(req, { action: 'privacy.request_submitted', module: 'privacy', entityType: 'data_request', entityId: ref })
    res.status(201).json({
      message:
        req.body.category === 'deletion'
          ? 'Deletion request recorded. Accounts are not deleted automatically: retention and security obligations are reviewed first.'
          : 'Request recorded. We may ask you to verify account ownership before completing it.',
      reference: ref,
      statusLabel: PRIVACY_REQUEST_STATUSES.submitted,
      note: 'These are BetterGo privacy request statuses, not government decisions.',
    })
  }),
)

privacyRouter.get(
  '/privacy-center/requests',
  asyncHandler(async (req, res) => {
    res.json({
      results: all(
        `SELECT reference, category, status, description, requested_categories, correction_details, resolution, response_summary,
                created_at, updated_at, resolved_at
         FROM data_requests WHERE user_id = ? ORDER BY id DESC`,
        [req.user.id],
      ).map((row) => ({
        ...row,
        statusLabel: PRIVACY_REQUEST_STATUSES[row.status] || row.status,
        requestedCategories: row.requested_categories ? JSON.parse(row.requested_categories) : [],
        correction: row.correction_details ? JSON.parse(row.correction_details) : null,
      })),
      statuses: PRIVACY_REQUEST_STATUSES,
      note: 'Privacy request statuses describe the BetterGo workflow only.',
    })
  }),
)

privacyRouter.post(
  '/privacy-center/export',
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 5 }),
  validate(z.object({ format: z.enum(['json', 'csv']).default('json') })),
  asyncHandler(async (req, res) => {
    const profile = get(`SELECT * FROM user_profiles WHERE user_id = ?`, [req.user.id])
    const user = get(`SELECT id, name, email, phone, account_status, email_verified_at, created_at FROM users WHERE id = ?`, [req.user.id])
    const payload = {
      generatedAt: nowIso(),
      platform: 'BetterGo Marinduque',
      note: 'This export contains only your own BetterGo data. Passwords, session tokens, internal notes and other citizens’ records are excluded. Vault files are available separately through authenticated downloads.',
      account: user,
      profile,
      consents: all(`SELECT consent_category, status, policy_version, created_at, withdrawn_at FROM consent_records WHERE user_id = ?`, [req.user.id]),
      saved: all(`SELECT content_type, content_id, created_at FROM saved_items WHERE user_id = ?`, [req.user.id]),
      applications: all(`SELECT reference, status, submission_classification, submitted_at, created_at FROM citizen_applications WHERE user_id = ?`, [req.user.id]),
      documents: all(`SELECT title, category, mime_type, file_size, version, status, created_at FROM citizen_documents WHERE user_id = ? AND deleted_at IS NULL`, [req.user.id]),
      activity: all(`SELECT activity_type, entity_label, created_at FROM citizen_activities WHERE user_id = ? ORDER BY id DESC LIMIT 500`, [req.user.id]),
      notifications: all(`SELECT title, notification_type, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 200`, [req.user.id]),
      supportTickets: all(`SELECT reference, subject, status, created_at FROM support_tickets WHERE user_id = ?`, [req.user.id]),
      feedback: all(`SELECT reference, title, status, created_at FROM citizen_feedback WHERE user_id = ?`, [req.user.id]),
      surveyResponses: all(`SELECT s.slug, r.created_at FROM survey_responses r JOIN surveys s ON s.id = r.survey_id WHERE r.user_id = ?`, [req.user.id]),
      privacyRequests: all(`SELECT reference, category, status, created_at FROM data_requests WHERE user_id = ?`, [req.user.id]),
    }
    run(`INSERT INTO data_exports (user_id, expires_at) VALUES (?, ?)`, [req.user.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()])
    logAudit(req, { action: 'privacy.export_generated', module: 'privacy', entityType: 'user', entityId: req.user.id, newValues: { format: req.body.format } })
    res.setHeader('Cache-Control', 'no-store')
    if (req.body.format === 'csv') {
      const lines = ['Section,Field,Value']
      const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
      for (const [section, rows] of Object.entries(payload)) {
        if (!Array.isArray(rows)) continue
        for (const row of rows) {
          for (const [key, value] of Object.entries(row)) lines.push([section, key, escape(value)].join(','))
        }
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="bettergo-personal-data.csv"')
      return res.send(`${lines.join('\n')}\n`)
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', 'attachment; filename="bettergo-personal-data.json"')
    res.send(JSON.stringify(payload, null, 2))
  }),
)

privacyRouter.post(
  '/privacy-center/deactivate',
  validate(z.object({ confirm: z.literal(true), reason: z.string().trim().max(1000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const current = get(`SELECT status FROM account_deactivations WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [req.user.id])
    if (current?.status === 'deactivated') throw unprocessable('Your account is already deactivated.')
    run(`INSERT INTO account_deactivations (user_id, status, reason) VALUES (?, 'deactivated', ?)`, [req.user.id, cleanText(req.body.reason, 1000)])
    run(`UPDATE users SET account_status = 'deactivated', updated_at = ? WHERE id = ?`, [nowIso(), req.user.id])
    logAudit(req, { action: 'privacy.account_deactivated', module: 'privacy', entityType: 'user', entityId: req.user.id })
    res.json({
      message: 'Account deactivated. Your records are kept and you can reactivate from the privacy centre. This is not a deletion.',
      status: 'deactivated',
    })
  }),
)

privacyRouter.post(
  '/privacy-center/reactivate',
  asyncHandler(async (req, res) => {
    const current = get(`SELECT * FROM account_deactivations WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [req.user.id])
    if (!current || current.status !== 'deactivated') throw unprocessable('Your account is not deactivated.')
    run(`UPDATE account_deactivations SET status = 'reactivated', reinstated_at = ? WHERE id = ?`, [nowIso(), current.id])
    run(`UPDATE users SET account_status = 'active', updated_at = ? WHERE id = ?`, [nowIso(), req.user.id])
    logAudit(req, { action: 'privacy.account_reactivated', module: 'privacy', entityType: 'user', entityId: req.user.id })
    res.json({ message: 'Account reactivated.', status: 'active' })
  }),
)

/* --------------------------- Privacy administration ---------------------- */

export const adminPrivacyRouter = Router()
adminPrivacyRouter.use(requireAuth, requireAdmin)

const noticeSchema = z.object({
  docType: z.enum(['privacy_policy', 'terms_of_use', 'notice']),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(20).max(100000),
  version: z.string().trim().regex(/^[0-9][0-9.a-z-]{0,19}$/),
  language: z.enum(['en', 'fil']).default('en'),
  effectiveAt: z.string().trim().max(40).optional().or(z.literal('')),
})

adminPrivacyRouter.get(
  '/privacy-notices',
  requirePermission('privacy.requests.manage'),
  asyncHandler(async (_req, res) => {
    res.json({ results: all(`SELECT * FROM privacy_notices ORDER BY doc_type, id DESC`) })
  }),
)

adminPrivacyRouter.post(
  '/privacy-notices',
  requirePermission('privacy.requests.manage'),
  validate(noticeSchema),
  asyncHandler(async (req, res) => {
    if (get(`SELECT id FROM privacy_notices WHERE doc_type = ? AND version = ? AND language = ?`, [req.body.docType, req.body.version, req.body.language])) {
      throw unprocessable('That notice version already exists.')
    }
    const id = Number(
      run(
        `INSERT INTO privacy_notices (doc_type, title, body, version, language, effective_at, author_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.body.docType, cleanText(req.body.title, 200), req.body.body, req.body.version, req.body.language, req.body.effectiveAt || null, req.user.id],
      ).lastInsertRowid,
    )
    logAudit(req, { action: 'privacy.notice_created', module: 'privacy', entityType: 'privacy_notice', entityId: id })
    res.status(201).json({ message: 'Notice draft created.', id })
  }),
)

adminPrivacyRouter.post(
  '/privacy-notices/:id/publish',
  requirePermission('privacy.requests.manage'),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM privacy_notices WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Privacy notice not found.')
    if (row.author_id === req.user.id) throw forbidden('A second reviewer must publish a notice.')
    if (row.docType !== 'notice') {
      const current = get(`SELECT id FROM privacy_notices WHERE doc_type = ? AND status = 'published' AND language = ? AND id <> ?`, [row.docType, row.language, row.id])
      if (current) run(`UPDATE privacy_notices SET status = 'archived' WHERE id = ?`, [current.id])
    }
    run(`UPDATE privacy_notices SET status = 'published', approver_id = ?, published_at = ?, effective_at = COALESCE(effective_at, ?) WHERE id = ?`, [
      req.user.id,
      nowIso(),
      nowIso(),
      row.id,
    ])
    logAudit(req, { action: 'privacy.notice_published', module: 'privacy', entityType: 'privacy_notice', entityId: row.id })
    res.json({ message: 'Notice published. Existing consent records keep their original version.' })
  }),
)

adminPrivacyRouter.get(
  '/privacy-incidents',
  requirePermission('privacy.incidents.manage'),
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(
        `SELECT i.*, COALESCE(up.display_name, u.name) AS assignee_name
         FROM privacy_incidents i LEFT JOIN users u ON u.id = i.assigned_to LEFT JOIN user_profiles up ON up.user_id = u.id
         ORDER BY i.id DESC`,
      ),
      note: 'Incident notes are internal. BetterGo does not claim any incident was reported to the National Privacy Commission unless that actually happened.',
    })
  }),
)

adminPrivacyRouter.post(
  '/privacy-incidents',
  requirePermission('privacy.incidents.manage'),
  validate(
    z.object({
      description: z.string().trim().min(20).max(3000),
      severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
      affectedSystems: z.string().trim().max(300).optional().or(z.literal('')),
      discoveredAt: z.string().trim().max(40).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const ref = reference('BGPIN')
    const id = Number(
      run(`INSERT INTO privacy_incidents (reference, description, severity, affected_systems, discovered_at, updated_at) VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`, [
        ref,
        cleanText(req.body.description, 3000),
        req.body.severity,
        cleanText(req.body.affectedSystems, 300),
        req.body.discoveredAt || null,
        nowIso(),
      ]).lastInsertRowid,
    )
    logAudit(req, { action: 'privacy.incident_reported', module: 'privacy', entityType: 'privacy_incident', entityId: ref })
    res.status(201).json({ message: 'Incident recorded for internal review. Notification duties need legal assessment.', id, reference: ref })
  }),
)

adminPrivacyRouter.patch(
  '/privacy-incidents/:reference',
  requirePermission('privacy.incidents.manage'),
  validate(
    z.object({
      status: z.enum(['reported', 'investigating', 'contained', 'resolved', 'closed']).optional(),
      investigationNotes: z.string().trim().max(5000).optional(),
      resolution: z.string().trim().max(2000).optional(),
      assignedTo: z.coerce.number().int().positive().nullable().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM privacy_incidents WHERE reference = ?`, [String(req.params.reference)])
    if (!row) throw notFound('Incident not found.')
    run(
      `UPDATE privacy_incidents SET status = ?, investigation_notes = COALESCE(?, investigation_notes),
        resolution = COALESCE(?, resolution), assigned_to = COALESCE(?, assigned_to), updated_at = ?,
        resolved_at = CASE WHEN ? IN ('resolved','closed') THEN ? ELSE resolved_at END
       WHERE id = ?`,
      [
        req.body.status || row.status,
        cleanText(req.body.investigationNotes, 5000),
        cleanText(req.body.resolution, 2000),
        req.body.assignedTo || null,
        nowIso(),
        req.body.status || row.status,
        nowIso(),
        row.id,
      ],
    )
    logAudit(req, { action: 'privacy.incident_updated', module: 'privacy', entityType: 'privacy_incident', entityId: row.reference })
    res.json({ message: 'Incident updated.' })
  }),
)

adminPrivacyRouter.get(
  '/privacy/analytics',
  requirePermission('privacy.requests.manage'),
  asyncHandler(async (_req, res) => {
    const requests = get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status IN ('submitted','under_review','awaiting_citizen','processing') THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN category = 'deletion' THEN 1 ELSE 0 END) AS deletion_requests
       FROM data_requests`,
    )
    const completed = all(`SELECT created_at, completed_at FROM data_requests WHERE completed_at IS NOT NULL`)
    const days = completed
      .map((row) => (new Date(row.completed_at).getTime() - new Date(row.created_at).getTime()) / 86_400_000)
      .filter((value) => Number.isFinite(value) && value >= 0)
    res.json({
      requests: {
        total: Number(requests.total || 0),
        open: Number(requests.open || 0),
        completed: Number(requests.completed || 0),
        deletionRequests: Number(requests.deletion_requests || 0),
        averageProcessingDays: days.length ? Number((days.reduce((sum, value) => sum + value, 0) / days.length).toFixed(1)) : null,
      },
      byCategory: all(`SELECT category, COUNT(*) AS total FROM data_requests GROUP BY category ORDER BY total DESC`),
      byStatus: all(`SELECT status, COUNT(*) AS total FROM data_requests GROUP BY status ORDER BY total DESC`),
      exports: Number(get(`SELECT COUNT(*) AS n FROM data_exports`).n),
      incidentsByStatus: all(`SELECT status, COUNT(*) AS total FROM privacy_incidents GROUP BY status`),
      note: 'Processing time is calculated from stored request timestamps only.',
    })
  }),
)
