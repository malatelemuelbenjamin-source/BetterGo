/**
 * Citizen account security centre (Prompt 82).
 *
 * Signals here are indicators, not proof of compromise, and no security score
 * is invented. Only the account owner sees their own sessions and events.
 */
import { Router } from 'express'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { all, get, nowIso, run } from '../db.js'
import { clearSessionCookie, rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, forbidden, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const REPORT_CATEGORIES = {
  unknown_login: 'Login or session I do not recognise',
  unauthorized_change: 'Account change I did not make',
  suspicious_message: 'Message claiming to be BetterGo',
  account_takeover: 'Suspected account takeover',
  document_access: 'Unauthorized access to my documents',
  representative_abuse: 'Problem with an authorized representative',
}
const REPORT_STATUSES = { submitted: 'Submitted', under_review: 'Under review', resolved: 'Resolved', dismissed: 'Dismissed' }
const INCIDENT_STATUSES = { open: 'Open', investigating: 'Investigating', contained: 'Contained', resolved: 'Resolved', closed: 'Closed' }
const SEVERITIES = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }

const ref = (prefix) => `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`

function notify(userId, title, message, relatedId = null) {
  const prefs = get(`SELECT in_app_enabled FROM notification_preferences WHERE user_id = ?`, [userId])
  if (prefs && Number(prefs.in_app_enabled) === 0) return
  run(
    `INSERT INTO notifications (user_id, title, message, notification_type, category, related_entity_type, related_entity_id)
     VALUES (?, ?, ?, 'security', 'account', 'security', ?)`,
    [userId, title, message, relatedId],
  )
}

const maskIp = (value) => {
  if (!value) return null
  const parts = String(value).split('.')
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : 'Hidden'
}

const shortAgent = (value) => {
  const ua = String(value || '').trim()
  if (!ua) return 'Unknown browser'
  return ua.replace(/\s+/g, ' ').slice(0, 90)
}

function shapeSession(row, currentId) {
  return {
    id: row.id,
    sessionId: row.session_id,
    agent: shortAgent(row.user_agent),
    ip: maskIp(row.ip_address),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    current: row.session_id === currentId,
  }
}

function shapeReport(row) {
  return {
    id: row.id,
    reference: row.reference,
    category: row.category,
    categoryLabel: REPORT_CATEGORIES[row.category] || row.category,
    description: row.description,
    evidenceNote: row.evidence_note,
    status: row.status,
    statusLabel: REPORT_STATUSES[row.status] || row.status,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  }
}

function shapeIncident(row, events = []) {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    severity: row.severity,
    severityLabel: SEVERITIES[row.severity] || row.severity,
    status: row.status,
    statusLabel: INCIDENT_STATUSES[row.status] || row.status,
    detectionSource: row.detection_source,
    affectedScope: row.affected_scope,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    events,
  }
}

export const securityRouter = Router()
securityRouter.use(requireAuth)

securityRouter.get(
  '/security',
  asyncHandler(async (req, res) => {
    const user = get(`SELECT email_verified_at, phone_verified_at, last_login_at FROM users WHERE id = ?`, [req.user.id])
    const mfa = get(`SELECT enabled, enabled_at FROM user_mfa WHERE user_id = ?`, [req.user.id])
    const backupCodes = get(
      `SELECT COUNT(*) AS total FROM user_mfa_backup_codes WHERE user_id = ? AND used_at IS NULL`,
      [req.user.id],
    )?.total || 0
    const sessions = all(
      `SELECT * FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 50`,
      [req.user.id],
    )
    const failed = get(
      `SELECT COUNT(*) AS total FROM login_attempts WHERE identifier = ? AND success = 0 AND created_at >= datetime('now', '-1 day')`,
      [req.user.email],
    )?.total || 0
    const events = all(`SELECT event_type, detail, created_at FROM account_security_events WHERE user_id = ? ORDER BY id DESC LIMIT 25`, [req.user.id])
    const reports = all(`SELECT * FROM account_security_reports WHERE user_id = ? ORDER BY id DESC LIMIT 20`, [req.user.id])
    const passwordChange = get(
      `SELECT created_at FROM account_security_events WHERE user_id = ? AND event_type = 'auth.password_changed' ORDER BY id DESC LIMIT 1`,
      [req.user.id],
    )

    const recommendations = []
    if (!user.email_verified_at) recommendations.push({ key: 'verify_email', label: 'Verify your email address.' })
    if (!mfa?.enabled) recommendations.push({ key: 'enable_mfa', label: 'Turn on multi-factor authentication.' })
    if (sessions.length > 1) recommendations.push({ key: 'review_sessions', label: 'Review your active sessions and end any you do not recognise.' })
    if (failed >= 5) recommendations.push({ key: 'password', label: 'Several failed sign-in attempts were recorded. Consider changing your password.' })

    res.json({
      account: {
        email: req.user.email,
        emailVerified: Boolean(user.email_verified_at),
        phoneVerified: Boolean(user.phone_verified_at),
        lastLoginAt: user.last_login_at,
        passwordChangedAt: passwordChange?.created_at || null,
      },
      mfa: {
        enabled: Boolean(mfa?.enabled),
        enabledAt: mfa?.enabled_at || null,
        backupCodesRemaining: backupCodes,
      },
      sessions: sessions.map((row) => shapeSession(row, req.sessionId)),
      indicators: {
        failedLoginsLastDay: failed,
        note: 'These are indicators, not proof that someone broke into the account. BetterGo does not treat a new device, a changed network or travel as fraud by itself.',
      },
      recentEvents: events,
      reports: reports.map(shapeReport),
      recommendations,
      protection: {
        email: user.email_verified_at ? 'verified' : 'unverified',
        mfa: mfa?.enabled ? 'enabled' : 'not_enabled',
        sessions: `${sessions.length} active`,
        note: 'No account is completely protected. Keep your password private, never share one-time codes, and report anything unfamiliar.',
      },
      phishingTips: [
        'BetterGo never asks for your password or one-time code by email, text or phone.',
        'Check that links point to this BetterGo address before signing in.',
        'BetterGo does not send payment instructions through unofficial chat accounts.',
        'Only upload documents inside your signed-in document vault.',
        'Report a suspicious message instead of replying to it.',
      ],
      reportCategories: REPORT_CATEGORIES,
      reportStatuses: REPORT_STATUSES,
      note: 'BetterGo security reports are platform records. They are not police reports or official government incident reports.',
    })
  }),
)

securityRouter.post(
  '/security/sessions/:sessionId/revoke',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM auth_sessions WHERE session_id = ? AND user_id = ?`, [String(req.params.sessionId), req.user.id])
    if (!row) throw notFound('Session not found.')
    if (!row.revoked_at) {
      run(`UPDATE auth_sessions SET revoked_at = ? WHERE id = ?`, [nowIso(), row.id])
      logAudit(req, { action: 'security.session_revoked', module: 'security', entityType: 'auth_session', entityId: row.id })
    }
    if (row.session_id === req.sessionId) clearSessionCookie(res)
    res.json({
      message: row.session_id === req.sessionId ? 'This session was ended.' : 'That session was ended immediately.',
      current: row.session_id === req.sessionId,
    })
  }),
)

securityRouter.post(
  '/security/sessions/revoke-others',
  asyncHandler(async (req, res) => {
    const result = run(
      `UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND session_id <> ?`,
      [nowIso(), req.user.id, req.sessionId || ''],
    )
    logAudit(req, { action: 'security.other_sessions_revoked', module: 'security', entityType: 'auth_session', entityId: req.user.id })
    res.json({ message: `Ended ${result.changes} other session(s).`, ended: result.changes })
  }),
)

securityRouter.post(
  '/security/reports',
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 5 }),
  validate(
    z.object({
      category: z.enum(Object.keys(REPORT_CATEGORIES)),
      description: z.string().trim().min(10).max(3000),
      evidenceNote: z.string().trim().max(1000).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(
      run(
        `INSERT INTO account_security_reports (reference, user_id, category, description, evidence_note) VALUES (?, ?, ?, ?, ?)`,
        [ref('BG-SEC'), req.user.id, req.body.category, cleanText(req.body.description, 3000), cleanText(req.body.evidenceNote, 1000)],
      ).lastInsertRowid,
    )
    notify(req.user.id, 'Security report received', 'Your report was recorded. A reviewer will look at it; this is not a police report.', id)
    logAudit(req, { action: 'security.report_submitted', module: 'security', entityType: 'security_report', entityId: id })
    res.status(201).json({
      message: 'Security report recorded. This is a BetterGo platform report, not an official police or government incident report.',
      report: shapeReport(get(`SELECT * FROM account_security_reports WHERE id = ?`, [id])),
    })
  }),
)

/* -------------------------------- Admin --------------------------------- */

export const adminSecurityRouter = Router()
adminSecurityRouter.use(requireAuth, requireAdmin)

function scopedUser(req, userId) {
  const profile = get(`SELECT municipality_id FROM user_profiles WHERE user_id = ?`, [userId])
  if (!profile) return ctx(req).hasGlobalScope
  const context = ctx(req)
  return Boolean(context.hasGlobalScope || (profile.municipality_id && canUseMunicipality(context, profile.municipality_id)))
}

adminSecurityRouter.get(
  '/security',
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const scopedUsers = context.hasGlobalScope
      ? all(`SELECT id, email FROM users WHERE deleted_at IS NULL`)
      : context.municipalityIds.length
        ? all(
            `SELECT u.id, u.email FROM users u JOIN user_profiles p ON p.user_id = u.id WHERE u.deleted_at IS NULL AND p.municipality_id IN (${context.municipalityIds.map(() => '?').join(',')})`,
            context.municipalityIds,
          )
        : []
    const ids = new Set(scopedUsers.map((row) => row.id))
    const failed = get(
      `SELECT COUNT(*) AS total FROM login_attempts WHERE success = 0 AND created_at >= datetime('now', '-1 day')`,
    )?.total || 0
    const reports = all(`SELECT r.*, u.name AS citizen_name FROM account_security_reports r JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 100`)
      .filter((row) => ids.has(row.user_id))
    const sessions = all(`SELECT user_id FROM auth_sessions WHERE revoked_at IS NULL`).filter((row) => ids.has(row.user_id))
    const suspicious = all(
      `SELECT identifier, COUNT(*) AS failures FROM login_attempts
       WHERE success = 0 AND created_at >= datetime('now', '-1 day')
       GROUP BY identifier HAVING COUNT(*) >= 5 ORDER BY failures DESC LIMIT 20`,
    )
      .map((row) => ({ identifier: row.identifier, failures: row.failures, userId: scopedUsers.find((user) => user.email === row.identifier)?.id || null }))
      .filter((row) => row.userId)
    const incidents = all(`SELECT * FROM security_incidents ORDER BY id DESC LIMIT 50`).map((row) => shapeIncident(row,
      all(`SELECT action, note, created_at FROM security_incident_events WHERE incident_id = ? ORDER BY id`, [row.id]),
    ))
    res.json({
      summary: {
        activeSessions: sessions.length,
        failedLoginsLastDay: failed,
        pendingReports: reports.filter((row) => row.status === 'submitted' || row.status === 'under_review').length,
        openIncidents: incidents.filter((row) => ['open', 'investigating', 'contained'].includes(row.status)).length,
      },
      reports: reports.map((row) => ({ ...shapeReport(row), citizenName: row.citizen_name })),
      suspiciousLogins: suspicious,
      incidents,
      reportStatuses: REPORT_STATUSES,
      incidentStatuses: INCIDENT_STATUSES,
      severities: SEVERITIES,
      note: 'Indicators are not confirmed incidents. Administrators cannot view passwords, MFA secrets, recovery codes or private documents here. Approved restrictions must follow documented procedure.',
    })
  }),
)

adminSecurityRouter.post(
  '/security/reports/:id/decision',
  requirePermission('municipality_users.manage'),
  validate(z.object({ status: z.enum(['under_review', 'resolved', 'dismissed']), note: z.string().trim().min(3).max(1000) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM account_security_reports WHERE id = ?`, [Number(req.params.id)])
    if (!row || !scopedUser(req, row.user_id)) throw notFound('Security report not found.')
    if (row.status === 'resolved' || row.status === 'dismissed') throw unprocessable('This report is already closed.')
    run(`UPDATE account_security_reports SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`, [
      req.body.status,
      cleanText(req.body.note, 1000),
      req.user.id,
      nowIso(),
      row.id,
    ])
    notify(row.user_id, 'Security report updated', `Your security report is now ${REPORT_STATUSES[req.body.status].toLowerCase()}.`, row.id)
    logAudit(req, { action: `security.report_${req.body.status}`, module: 'security', entityType: 'security_report', entityId: row.id })
    res.json({ message: 'Report updated.' })
  }),
)

adminSecurityRouter.post(
  '/security/incidents',
  requirePermission('municipality_users.manage'),
  validate(
    z.object({
      title: z.string().trim().min(5).max(200),
      severity: z.enum(Object.keys(SEVERITIES)),
      detectionSource: z.string().trim().max(200).optional().or(z.literal('')),
      affectedScope: z.string().trim().max(500).optional().or(z.literal('')),
      summary: z.string().trim().max(2000).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (!ctx(req).hasGlobalScope) {
      throw forbidden('Security incidents are recorded by a platform security reviewer with global scope.')
    }
    const id = Number(
      run(
        `INSERT INTO security_incidents (reference, title, severity, detection_source, affected_scope, summary, assigned_to, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ref('BG-INC'),
          cleanText(req.body.title, 200),
          req.body.severity,
          cleanText(req.body.detectionSource, 200),
          cleanText(req.body.affectedScope, 500),
          cleanText(req.body.summary, 2000),
          req.user.id,
          req.user.id,
        ],
      ).lastInsertRowid,
    )
    run(`INSERT INTO security_incident_events (incident_id, actor_id, action, note) VALUES (?, ?, 'created', ?)`, [id, req.user.id, cleanText(req.body.summary, 2000)])
    logAudit(req, { action: 'security.incident_created', module: 'security', entityType: 'security_incident', entityId: id })
    res.status(201).json({
      message: 'Incident recorded. Do not publish details or affected personal data without an approved incident response and legal review.',
      incident: shapeIncident(get(`SELECT * FROM security_incidents WHERE id = ?`, [id])),
    })
  }),
)

adminSecurityRouter.post(
  '/security/incidents/:id/update',
  requirePermission('municipality_users.manage'),
  validate(z.object({ status: z.enum(Object.keys(INCIDENT_STATUSES)), note: z.string().trim().min(3).max(1000) })),
  asyncHandler(async (req, res) => {
    if (!ctx(req).hasGlobalScope) throw forbidden('Security incidents are handled by a global security reviewer.')
    const row = get(`SELECT * FROM security_incidents WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Incident not found.')
    run(`UPDATE security_incidents SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?`, [
      req.body.status,
      nowIso(),
      ['resolved', 'closed'].includes(req.body.status) ? nowIso() : row.resolved_at,
      row.id,
    ])
    run(`INSERT INTO security_incident_events (incident_id, actor_id, action, note) VALUES (?, ?, ?, ?)`, [
      row.id,
      req.user.id,
      req.body.status,
      cleanText(req.body.note, 1000),
    ])
    logAudit(req, { action: `security.incident_${req.body.status}`, module: 'security', entityType: 'security_incident', entityId: row.id })
    res.json({ message: 'Incident updated.' })
  }),
)

adminSecurityRouter.post(
  '/security/users/:id/restrict',
  requirePermission('municipality_users.manage'),
  validate(z.object({ action: z.enum(['restrict', 'restore']), note: z.string().trim().min(5).max(500) })),
  asyncHandler(async (req, res) => {
    const user = get(`SELECT id, name, account_status FROM users WHERE id = ? AND deleted_at IS NULL`, [Number(req.params.id)])
    if (!user || !scopedUser(req, user.id)) throw notFound('Account not found in your scope.')
    if (user.id === req.user.id) throw unprocessable('You cannot restrict your own account here.')
    if (req.body.action === 'restrict') {
      run(`UPDATE users SET account_status = 'suspended', session_version = session_version + 1, updated_at = ? WHERE id = ?`, [nowIso(), user.id])
      run(`UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, [nowIso(), user.id])
    } else {
      run(`UPDATE users SET account_status = 'active', updated_at = ? WHERE id = ?`, [nowIso(), user.id])
    }
    run(`INSERT INTO account_security_events (user_id, event_type, detail) VALUES (?, ?, ?)`, [
      user.id,
      req.body.action === 'restrict' ? 'account.restricted' : 'account.restored',
      cleanText(req.body.note, 500),
    ])
    notify(
      user.id,
      req.body.action === 'restrict' ? 'Account access restricted' : 'Account access restored',
      req.body.action === 'restrict'
        ? 'An administrator restricted access for security review. Contact BetterGo support to regain access.'
        : 'Access to your account was restored. Sign in again.',
    )
    logAudit(req, { action: `security.account_${req.body.action}`, module: 'security', entityType: 'user', entityId: user.id })
    res.json({ message: req.body.action === 'restrict' ? 'Account restricted and sessions ended.' : 'Account restored.' })
  }),
)
