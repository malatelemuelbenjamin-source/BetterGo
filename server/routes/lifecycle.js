/**
 * Account deactivation, deletion requests and retention (Prompt 85).
 *
 * A request never deletes anything. Deactivation ends sessions and delegated
 * access but keeps records. Deletion review can anonymise identifiers; records
 * under an approved retention rule are kept, and that is stated plainly.
 */
import { Router } from 'express'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth, startSession, verifyPassword } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, forbidden, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const STATUSES = {
  draft: 'Draft',
  submitted: 'Submitted',
  identity_confirmation_required: 'Identity confirmation required',
  under_review: 'Under review',
  additional_info_required: 'Additional information requested',
  scheduled_for_processing: 'Scheduled for processing',
  partially_completed: 'Partially completed',
  completed: 'Completed',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}
const DEACTIVATION_STATUSES = { active: 'Deactivated', reactivated: 'Reactivated', cancelled: 'Cancelled' }
const RETENTION_REVIEW = {
  pending_legal_review: 'Pending legal and privacy review',
  approved: 'Approved retention schedule',
  draft: 'Draft, not in force',
}
const RETENTION_CATEGORIES = {
  account: 'Basic account information',
  preferences: 'Profile preferences',
  documents: 'Uploaded documents',
  applications: 'Applications and submission records',
  appointments: 'Appointments',
  support: 'Feedback and support records',
  consents: 'Consent and authorization history',
  security: 'Security and audit records',
  exports: 'Temporary export files',
  notifications: 'Notification history',
}

const ref = (prefix) => `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`
const parse = (value, fallback) => {
  try {
    return JSON.parse(value || 'null') ?? fallback
  } catch {
    return fallback
  }
}

function notify(userId, title, message, id = null) {
  const prefs = get(`SELECT in_app_enabled FROM notification_preferences WHERE user_id = ?`, [userId])
  if (prefs && Number(prefs.in_app_enabled) === 0) return
  run(
    `INSERT INTO notifications (user_id, title, message, notification_type, category, related_entity_type, related_entity_id)
     VALUES (?, ?, ?, 'account', 'account', 'account_lifecycle', ?)`,
    [userId, title, message, id],
  )
}

function shapeDeactivation(row) {
  return {
    id: row.id,
    reference: row.reference,
    reason: row.reason,
    status: row.status,
    statusLabel: DEACTIVATION_STATUSES[row.status] || row.status,
    effectiveAt: row.effective_at,
    createdAt: row.created_at,
    reactivatedAt: row.reactivated_at,
  }
}

function shapeDeletion(row, events = []) {
  return {
    id: row.id,
    reference: row.reference,
    reason: row.reason,
    status: row.status,
    statusLabel: STATUSES[row.status] || row.status,
    confirmationMethod: row.confirmation_method,
    scheduledFor: row.scheduled_for,
    reviewNote: row.review_note,
    failureReason: row.failure_reason,
    requestedAt: row.requested_at,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    completedAt: row.completed_at,
    withdrawnAt: row.withdrawn_at,
    events,
  }
}

function shapeRetention(row) {
  return {
    category: row.category,
    categoryLabel: RETENTION_CATEGORIES[row.category] || row.category,
    purpose: row.purpose,
    responsibleSystem: row.responsible_system,
    retentionRule: row.retention_rule,
    retentionTrigger: row.retention_trigger,
    deletionMethod: row.deletion_method,
    legalReviewStatus: row.legal_review_status,
    legalReviewLabel: RETENTION_REVIEW[row.legal_review_status] || row.legal_review_status,
    exceptions: row.exceptions,
    updatedAt: row.updated_at,
  }
}

function ensureRetentionRules() {
  for (const [category, label] of Object.entries(RETENTION_CATEGORIES)) {
    if (!get(`SELECT id FROM account_retention_rules WHERE category = ?`, [category])) {
      run(
        `INSERT INTO account_retention_rules (category, purpose, responsible_system, retention_rule, retention_trigger, deletion_method, legal_review_status, exceptions)
         VALUES (?, ?, 'BetterGo', 'No approved schedule yet. Records are kept until legal and privacy review approves a period.', 'Account closure review', 'Pending approved method', 'pending_legal_review', 'Retention may be required for legal, security or dispute purposes.')`,
        [category, label],
      )
    }
  }
}

function recentAuth(req) {
  if (!req.sessionId) return false
  const session = get(`SELECT created_at FROM auth_sessions WHERE session_id = ? AND user_id = ? AND revoked_at IS NULL`, [req.sessionId, req.user.id])
  if (!session) return false
  return (Date.now() - new Date(`${session.created_at.replace(' ', 'T')}Z`).getTime()) < 60 * 60 * 1000
}

function revokeEverything(userId) {
  run(`UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, [nowIso(), userId])
  run(`UPDATE access_delegations SET status = 'revoked', revoked_at = ? WHERE (owner_user_id = ? OR delegate_user_id = ?) AND status IN ('pending','active')`, [nowIso(), userId, userId])
}

export const lifecycleRouter = Router()
export const reactivateRouter = Router()

reactivateRouter.post(
  '/reactivate',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }),
  validate(z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) })),
  asyncHandler(async (req, res) => {
    const user = get(`SELECT * FROM users WHERE lower(email) = lower(?) AND deleted_at IS NULL`, [req.body.email])
    if (!user || !(await verifyPassword(req.body.password, user.password_hash))) {
      return res.status(401).json({ error: 'Email or password is not correct.' })
    }
    if (user.account_status !== 'deactivated') return res.status(422).json({ error: 'This account is not deactivated.' })
    run(`UPDATE users SET account_status = CASE WHEN email_verified_at IS NULL THEN 'pending_verification' ELSE 'active' END, updated_at = ? WHERE id = ?`, [nowIso(), user.id])
    run(`UPDATE lifecycle_deactivations SET status = 'reactivated', reactivated_at = ? WHERE user_id = ? AND status = 'active'`, [nowIso(), user.id])
    const refreshed = get(`SELECT * FROM users WHERE id = ?`, [user.id])
    startSession(req, res, refreshed)
    run(`INSERT INTO account_security_events (user_id, event_type) VALUES (?, 'account.reactivated')`, [user.id])
    notify(user.id, 'Account reactivated', 'Your BetterGo account was reactivated. Delegated access stays revoked until you invite again.')
    logAudit(req, { action: 'lifecycle.reactivated', module: 'lifecycle', entityType: 'user', entityId: user.id })
    res.json({ message: 'Account reactivated. Delegated access must be invited again.', user: { id: refreshed.id, name: refreshed.name, email: refreshed.email } })
  }),
)

lifecycleRouter.get(
  '/account-management',
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureRetentionRules()
    const user = get(`SELECT account_status, email, email_verified_at, created_at FROM users WHERE id = ?`, [req.user.id])
    const deactivation = get(`SELECT * FROM lifecycle_deactivations WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [req.user.id])
    const deletion = get(`SELECT * FROM account_deletion_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [req.user.id])
    const sessions = get(`SELECT COUNT(*) AS total FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL`, [req.user.id])?.total || 0
    const representatives = all(
      `SELECT id, status, relationship FROM access_delegations WHERE owner_user_id = ? AND status = 'active'`,
      [req.user.id],
    )
    const privacyRequests = all(`SELECT reference, category AS request_type, status, created_at FROM data_requests WHERE user_id = ? ORDER BY id DESC LIMIT 10`, [req.user.id])
    res.json({
      account: {
        status: user.account_status,
        email: user.email,
        emailVerified: Boolean(user.email_verified_at),
        memberSince: user.created_at,
      },
      deactivation: deactivation ? shapeDeactivation(deactivation) : null,
      deletion: deletion ? shapeDeletion(deletion) : null,
      deletionHistory: all(`SELECT * FROM account_deletion_requests WHERE user_id = ? ORDER BY id DESC LIMIT 10`, [req.user.id]).map((row) => shapeDeletion(row)),
      sessions,
      representatives,
      privacyRequests,
      retention: all(`SELECT * FROM account_retention_rules ORDER BY category`).map(shapeRetention),
      statuses: STATUSES,
      deactivationStatuses: DEACTIVATION_STATUSES,
      recovery: 'To reactivate a deactivated account, sign in with your email and password on the reactivation form. Delegated access is not restored automatically.',
      note: 'Deactivation keeps your records but blocks sign-in. Deletion is reviewed and may anonymise identifiers; records under an approved retention rule may be kept. BetterGo never claims immediate erasure of everything.',
    })
  }),
)

lifecycleRouter.post(
  '/deactivate',
  requireAuth,
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 3 }),
  validate(z.object({ reason: z.string().trim().max(1000).optional().or(z.literal('')), confirm: z.literal('DEACTIVATE') })),
  asyncHandler(async (req, res) => {
    if (get(`SELECT id FROM account_deletion_requests WHERE user_id = ? AND status IN ('submitted','under_review','scheduled_for_processing')`, [req.user.id])) {
      throw unprocessable('A deletion request is in progress. Withdraw it before deactivating.')
    }
    const id = Number(
      run(`INSERT INTO lifecycle_deactivations (reference, user_id, reason, effective_at) VALUES (?, ?, ?, ?)`, [
        ref('BG-DEACT'),
        req.user.id,
        cleanText(req.body.reason, 1000),
        nowIso(),
      ]).lastInsertRowid,
    )
    run(`UPDATE users SET account_status = 'deactivated', session_version = session_version + 1, updated_at = ? WHERE id = ?`, [nowIso(), req.user.id])
    revokeEverything(req.user.id)
    run(`INSERT INTO account_security_events (user_id, event_type) VALUES (?, 'account.deactivated')`, [req.user.id])
    logAudit(req, { action: 'lifecycle.deactivated', module: 'lifecycle', entityType: 'account_deactivation', entityId: id })
    res.json({
      message: 'Account deactivated. Sessions and delegated access ended. Records are kept and you can reactivate with your email and password.',
      deactivation: shapeDeactivation(get(`SELECT * FROM lifecycle_deactivations WHERE id = ?`, [id])),
    })
  }),
)

lifecycleRouter.post(
  '/deletion-requests',
  requireAuth,
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 3 }),
  validate(z.object({ reason: z.string().trim().max(1000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    if (!recentAuth(req)) throw forbidden('Sign in again before starting a deletion request.')
    if (get(`SELECT id FROM account_deletion_requests WHERE user_id = ? AND status NOT IN ('completed','rejected','withdrawn')`, [req.user.id])) {
      throw unprocessable('You already have an open deletion request.')
    }
    const id = Number(
      run(`INSERT INTO account_deletion_requests (reference, user_id, reason) VALUES (?, ?, ?)`, [
        ref('BG-DEL'),
        req.user.id,
        cleanText(req.body.reason, 1000),
      ]).lastInsertRowid,
    )
    logAudit(req, { action: 'lifecycle.deletion_draft', module: 'lifecycle', entityType: 'account_deletion_request', entityId: id })
    res.status(201).json({
      message: 'Deletion request saved as a draft. Review the consequences and confirm to submit it.',
      deletion: shapeDeletion(get(`SELECT * FROM account_deletion_requests WHERE id = ?`, [id])),
      consequences: [
        'Your BetterGo account and sign-in access will end after review.',
        'Active sessions and delegated access are revoked.',
        'Some records may be anonymised rather than deleted.',
        'Records under an approved retention rule, security logs and records needed by an office may be kept.',
        'Official government records held by an office are not controlled by BetterGo.',
      ],
    })
  }),
)

lifecycleRouter.post(
  '/deletion-requests/:id/submit',
  requireAuth,
  validate(z.object({ confirmationText: z.string().trim().min(3).max(200), confirm: z.literal(true) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM account_deletion_requests WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Deletion request not found.')
    if (row.status !== 'draft') throw unprocessable('This request is not a draft.')
    if (!recentAuth(req)) throw forbidden('Sign in again before submitting a deletion request.')
    const user = get(`SELECT email FROM users WHERE id = ?`, [req.user.id])
    if (req.body.confirmationText.toLowerCase() !== String(user.email).toLowerCase()) {
      throw unprocessable('Type your account email exactly to confirm.')
    }
    run(`UPDATE account_deletion_requests SET status = 'submitted', confirmation_method = 'typed_email_recent_login', submitted_at = ? WHERE id = ?`, [nowIso(), row.id])
    run(`INSERT INTO deletion_processing_events (request_id, actor_id, action, detail) VALUES (?, ?, 'submitted', 'Citizen confirmed with typed email after recent sign-in.')`, [row.id, req.user.id])
    notify(req.user.id, 'Deletion request received', 'Your deletion request was submitted for review. Nothing is deleted yet.', row.id)
    const events = all(`SELECT action, detail, created_at FROM deletion_processing_events WHERE request_id = ? ORDER BY id`, [row.id])
    res.json({
      message: 'Deletion request submitted for review. Nothing is deleted yet.',
      deletion: shapeDeletion(get(`SELECT * FROM account_deletion_requests WHERE id = ?`, [row.id]), events),
    })
  }),
)

lifecycleRouter.post(
  '/deletion-requests/:id/withdraw',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM account_deletion_requests WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Deletion request not found.')
    if (['completed', 'rejected', 'withdrawn'].includes(row.status)) throw unprocessable('This request is already closed.')
    run(`UPDATE account_deletion_requests SET status = 'withdrawn', withdrawn_at = ? WHERE id = ?`, [nowIso(), row.id])
    run(`INSERT INTO deletion_processing_events (request_id, actor_id, action, detail) VALUES (?, ?, 'withdrawn', 'Withdrawn by the citizen.')`, [row.id, req.user.id])
    notify(req.user.id, 'Deletion request withdrawn', 'Your account remains open.', row.id)
    logAudit(req, { action: 'lifecycle.deletion_withdrawn', module: 'lifecycle', entityType: 'account_deletion_request', entityId: row.id })
    res.json({ message: 'Deletion request withdrawn. Your account stays open.' })
  }),
)

/* -------------------------------- Admin --------------------------------- */

export const adminLifecycleRouter = Router()
adminLifecycleRouter.use(requireAuth, requireAdmin)

function scopedUser(req, userId) {
  const profile = get(`SELECT municipality_id FROM user_profiles WHERE user_id = ?`, [userId])
  if (!profile) return ctx(req).hasGlobalScope
  const context = ctx(req)
  return Boolean(context.hasGlobalScope || (profile.municipality_id && canUseMunicipality(context, profile.municipality_id)))
}

adminLifecycleRouter.get(
  '/account-deletion',
  asyncHandler(async (req, res) => {
    ensureRetentionRules()
    const context = ctx(req)
    const requests = all(
      `SELECT r.*, u.name AS citizen_name, u.email AS citizen_email, p.municipality_id
       FROM account_deletion_requests r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN user_profiles p ON p.user_id = r.user_id
       ORDER BY r.id DESC LIMIT 100`,
    ).filter((row) => context.hasGlobalScope || (row.municipality_id && canUseMunicipality(context, row.municipality_id)))
    const deactivations = all(
      `SELECT d.*, u.name AS citizen_name, p.municipality_id
       FROM lifecycle_deactivations d JOIN users u ON u.id = d.user_id LEFT JOIN user_profiles p ON p.user_id = d.user_id
       ORDER BY d.id DESC LIMIT 50`,
    ).filter((row) => context.hasGlobalScope || (row.municipality_id && canUseMunicipality(context, row.municipality_id)))
    res.json({
      summary: {
        openRequests: requests.filter((row) => !['completed', 'rejected', 'withdrawn'].includes(row.status)).length,
        completed: requests.filter((row) => row.status === 'completed').length,
        failed: requests.filter((row) => row.failure_reason).length,
        activeDeactivations: deactivations.filter((row) => row.status === 'active').length,
      },
      requests: requests.map((row) => ({
        ...shapeDeletion(row, all(`SELECT action, detail, created_at FROM deletion_processing_events WHERE request_id = ? ORDER BY id`, [row.id])),
        citizenName: row.citizen_name,
        citizenEmail: row.citizen_email,
      })),
      deactivations: deactivations.map((row) => ({ ...shapeDeactivation(row), citizenName: row.citizen_name })),
      retention: all(`SELECT * FROM account_retention_rules ORDER BY category`).map(shapeRetention),
      statuses: STATUSES,
      retentionReview: RETENTION_REVIEW,
      note: 'Approving deletion records a review outcome. Do not claim completion before processing actually happens. Anonymisation replaces identifiers; retained records are kept under an approved rule.',
    })
  }),
)

adminLifecycleRouter.post(
  '/account-deletion/:id/decision',
  requirePermission('municipality_users.manage'),
  validate(
    z.object({
      decision: z.enum(['request_info', 'schedule', 'reject', 'complete_partial', 'complete']),
      note: z.string().trim().min(3).max(1000),
      scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM account_deletion_requests WHERE id = ?`, [Number(req.params.id)])
    if (!row || !scopedUser(req, row.user_id)) throw notFound('Deletion request not found.')
    if (['completed', 'rejected', 'withdrawn'].includes(row.status)) throw unprocessable('This request is already closed.')
    const map = {
      request_info: 'additional_info_required',
      schedule: 'scheduled_for_processing',
      reject: 'rejected',
      complete_partial: 'partially_completed',
      complete: 'completed',
    }
    if (req.body.decision === 'schedule' && !req.body.scheduledFor) throw unprocessable('Choose the scheduled processing date.')
    run(
      `UPDATE account_deletion_requests SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, scheduled_for = COALESCE(?, scheduled_for),
        processing_started_at = CASE WHEN ? IN ('complete','complete_partial') THEN COALESCE(processing_started_at, ?) ELSE processing_started_at END,
        completed_at = CASE WHEN ? = 'complete' THEN ? ELSE completed_at END
       WHERE id = ?`,
      [
        map[req.body.decision],
        cleanText(req.body.note, 1000),
        req.user.id,
        nowIso(),
        req.body.scheduledFor || null,
        req.body.decision,
        nowIso(),
        req.body.decision,
        nowIso(),
        row.id,
      ],
    )
    run(`INSERT INTO deletion_processing_events (request_id, actor_id, action, detail) VALUES (?, ?, ?, ?)`, [
      row.id,
      req.user.id,
      map[req.body.decision],
      cleanText(req.body.note, 1000),
    ])

    if (req.body.decision === 'complete') {
      const user = get(`SELECT id, email FROM users WHERE id = ?`, [row.user_id])
      revokeEverything(row.user_id)
      run(
        `UPDATE users SET name = 'Deleted account', email = ?, phone = NULL, password_hash = ?, account_status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?`,
        [`deleted+${row.user_id}@invalid.local`, `deleted-${randomBytes(16).toString('hex')}`, nowIso(), nowIso(), row.user_id],
      )
      run(`UPDATE user_profiles SET first_name = 'Deleted', middle_name = NULL, last_name = 'Account', address = NULL, profile_photo = NULL WHERE user_id = ?`, [row.user_id])
      run(`UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ?`, [nowIso(), row.user_id])
      logAudit(req, { action: 'lifecycle.deletion_completed', module: 'lifecycle', entityType: 'account_deletion_request', entityId: row.id })
      notify(row.user_id, 'Account deletion processed', 'Your BetterGo account was anonymised and access ended. Some records may remain under an approved retention rule.', row.id)
      return res.json({
        message: `Account anonymised. Sign-in access ended. Records covered by an approved retention rule may remain; this is not a claim that every record was erased. (${user.email})`,
      })
    }
    if (req.body.decision === 'complete_partial') {
      notify(row.user_id, 'Deletion partially completed', 'Part of the request was processed; other records are retained under review. See the review note.', row.id)
    }
    logAudit(req, { action: `lifecycle.deletion_${map[req.body.decision]}`, module: 'lifecycle', entityType: 'account_deletion_request', entityId: row.id })
    res.json({ message: req.body.decision === 'reject' ? 'Deletion request rejected with an explanation.' : 'Deletion request updated.' })
  }),
)

adminLifecycleRouter.put(
  '/account-deletion/retention/:category',
  requirePermission('privacy.requests.manage'),
  validate(
    z.object({
      retentionRule: z.string().trim().min(5).max(1000),
      retentionTrigger: z.string().trim().min(3).max(500),
      deletionMethod: z.string().trim().min(3).max(500),
      legalReviewStatus: z.enum(['draft', 'pending_legal_review', 'approved']),
      exceptions: z.string().trim().max(1000).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    ensureRetentionRules()
    const category = String(req.params.category)
    if (!RETENTION_CATEGORIES[category]) throw notFound('Unknown retention category.')
    run(
      `UPDATE account_retention_rules SET retention_rule = ?, retention_trigger = ?, deletion_method = ?, legal_review_status = ?, exceptions = ?, updated_at = ? WHERE category = ?`,
      [
        cleanText(req.body.retentionRule, 1000),
        cleanText(req.body.retentionTrigger, 500),
        cleanText(req.body.deletionMethod, 500),
        req.body.legalReviewStatus,
        cleanText(req.body.exceptions, 1000),
        nowIso(),
        category,
      ],
    )
    logAudit(req, { action: 'lifecycle.retention_updated', module: 'lifecycle', entityType: 'retention_rule', entityId: category })
    res.json({
      message: req.body.legalReviewStatus === 'approved'
        ? 'Retention rule saved as approved. Only do this after actual legal and privacy review.'
        : 'Retention rule saved. It remains clearly marked as not approved.',
      retention: shapeRetention(get(`SELECT * FROM account_retention_rules WHERE category = ?`, [category])),
    })
  }),
)
