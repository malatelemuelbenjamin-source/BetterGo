/**
 * Consent request builder, publication workflow and citizen decisions
 * (Prompt 80, full scope). Required permissions are never preselected and a
 * decision can only be withdrawn, not silently edited.
 */
import { Router } from 'express'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { requireAdmin, requirePermission } from '../rbac.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const STATUSES = {
  draft: 'Draft',
  pending_review: 'Pending review',
  approved_for_publication: 'Approved for publication',
  published: 'Published',
  expired: 'Expired',
  archived: 'Archived',
  rejected: 'Rejected',
}
const DECISIONS = { accepted: 'Accepted', declined: 'Declined' }
const reference = (prefix) => `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`
const parse = (value, fallback = []) => {
  try {
    return JSON.parse(value || 'null') ?? fallback
  } catch {
    return fallback
  }
}
const today = () => new Date().toISOString().slice(0, 10)

function effectiveStatus(row) {
  if (row.status === 'published' && row.expires_at && row.expires_at < today()) return 'expired'
  return row.status
}

function shapeRequest(row, decision = null) {
  const status = effectiveStatus(row)
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    purpose: row.purpose,
    requestingEntity: row.requesting_entity,
    informationInvolved: row.information_involved,
    intendedUse: row.intended_use,
    dataRecipients: row.data_recipients,
    processingDuration: row.processing_duration,
    expiresAt: row.expires_at,
    requiredPermissions: parse(row.required_permissions),
    optionalPermissions: parse(row.optional_permissions),
    withdrawalInstructions: row.withdrawal_instructions,
    privacyNoticeVersion: row.privacy_notice_version,
    references: parse(row.references_json),
    status,
    statusLabel: STATUSES[status] || row.status,
    version: row.version,
    reviewNote: row.review_note,
    submittedAt: row.submitted_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    decision: decision
      ? {
        reference: decision.receipt_reference,
        decision: decision.decision,
        decisionLabel: DECISIONS[decision.decision] || decision.decision,
        grantedPermissions: parse(decision.granted_permissions),
        typedName: decision.typed_name,
        decidedAt: decision.decided_at,
        withdrawnAt: decision.withdrawn_at,
      }
      : null,
  }
}

function notify(userId, title, message, entityId) {
  const prefs = get(`SELECT in_app_enabled FROM notification_preferences WHERE user_id = ?`, [userId])
  if (prefs && Number(prefs.in_app_enabled) === 0) return
  run(
    `INSERT INTO notifications (user_id, title, message, notification_type, category, related_entity_type, related_entity_id)
     VALUES (?, ?, ?, 'consent', 'consent', 'consent_request', ?)`,
    [userId, title, message, entityId],
  )
}

function assertTransition(row, allowed, message) {
  if (!allowed.includes(row.status)) throw unprocessable(message)
}

const requestBody = z.object({
  title: z.string().trim().min(5).max(160),
  purpose: z.string().trim().min(10).max(1000),
  requestingEntity: z.string().trim().min(2).max(160),
  informationInvolved: z.string().trim().max(1000).optional().or(z.literal('')),
  intendedUse: z.string().trim().max(1000).optional().or(z.literal('')),
  dataRecipients: z.string().trim().max(1000).optional().or(z.literal('')),
  processingDuration: z.string().trim().max(300).optional().or(z.literal('')),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  requiredPermissions: z.array(z.string().trim().min(2).max(120)).max(10),
  optionalPermissions: z.array(z.string().trim().min(2).max(120)).max(10),
  withdrawalInstructions: z.string().trim().max(1000).optional().or(z.literal('')),
  privacyNoticeVersion: z.string().trim().max(40).optional().or(z.literal('')),
  references: z.array(z.string().trim().max(200)).max(10).optional(),
})

export const consentRequestsRouter = Router()
consentRequestsRouter.use(requireAuth)

consentRequestsRouter.get(
  '/consent-requests',
  asyncHandler(async (req, res) => {
    const rows = all(
      `SELECT r.*, d.id AS decision_id, d.receipt_reference, d.decision, d.granted_permissions, d.typed_name, d.decided_at, d.withdrawn_at
       FROM consent_requests r
       LEFT JOIN consent_request_decisions d ON d.request_id = r.id AND d.user_id = ?
       WHERE r.status IN ('published','expired','archived')
       ORDER BY r.id DESC`,
      [req.user.id],
    )
    const items = rows.map((row) => shapeRequest(row, row.decision_id ? row : null))
    const pending = items.filter((item) => item.status !== 'expired' && (!item.decision || item.decision.withdrawnAt))
    const history = items.filter((item) => !pending.includes(item))
    res.json({
      pending,
      history,
      decisions: all(`SELECT * FROM consent_request_decisions WHERE user_id = ? ORDER BY id DESC`, [req.user.id]).map((row) => ({
        reference: row.receipt_reference,
        requestId: row.request_id,
        decision: row.decision,
        decidedAt: row.decided_at,
        withdrawnAt: row.withdrawn_at,
      })),
      activity: all(`SELECT action, detail, created_at FROM consent_request_events WHERE user_id = ? ORDER BY id DESC LIMIT 50`, [req.user.id]),
      decisionsCatalog: DECISIONS,
      note: 'Accepting a request records only the permissions you choose. BetterGo platform records are not official government receipts.',
    })
  }),
)

consentRequestsRouter.get(
  '/consent-requests/:id',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM consent_requests WHERE id = ?`, [Number(req.params.id)])
    if (!row || !['published', 'expired', 'archived'].includes(row.status)) throw notFound('Consent request not found.')
    const decision = get(`SELECT * FROM consent_request_decisions WHERE request_id = ? AND user_id = ?`, [row.id, req.user.id])
    res.json({ request: shapeRequest(row, decision), note: 'Review every permission. Optional permissions are never required.' })
  }),
)

consentRequestsRouter.post(
  '/consent-requests/:id/decide',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }),
  validate(
    z.object({
      decision: z.enum(['accepted', 'declined']),
      permissions: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
      typedName: z.string().trim().min(3).max(120).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM consent_requests WHERE id = ?`, [Number(req.params.id)])
    if (!row || row.status !== 'published' || effectiveStatus(row) !== 'published') throw notFound('This request is not open for a decision.')
    const existing = get(`SELECT * FROM consent_request_decisions WHERE request_id = ? AND user_id = ?`, [row.id, req.user.id])
    if (existing && !existing.withdrawn_at) throw unprocessable('You already recorded a decision for this request.')

    const required = parse(row.required_permissions)
    const optional = parse(row.optional_permissions)
    const allowed = new Set([...required, ...optional])
    const chosen = [...new Set(req.body.permissions)]
    if (chosen.some((permission) => !allowed.has(permission))) throw unprocessable('One of the selected permissions is not part of this request.')
    if (req.body.decision === 'accepted' && required.some((permission) => !chosen.includes(permission))) {
      throw unprocessable('Accepting requires every required permission. Decline instead if you do not agree.')
    }
    if (req.body.decision === 'declined' && chosen.length) throw unprocessable('A declined request cannot grant permissions.')
    if (req.body.typedName) {
      const user = get(`SELECT name FROM users WHERE id = ?`, [req.user.id])
      if (String(req.body.typedName).toLowerCase().replace(/\s+/g, ' ').trim() !== String(user.name).toLowerCase().replace(/\s+/g, ' ').trim()) {
        throw unprocessable('Type your name exactly as it appears on your account.')
      }
    }

    const receipt = reference('BG-CONSENT')
    const decidedAt = nowIso()
    if (existing) {
      run(
        `UPDATE consent_request_decisions SET request_version = ?, decision = ?, granted_permissions = ?, typed_name = ?, decided_at = ?, withdrawn_at = NULL, receipt_reference = ? WHERE id = ?`,
        [row.version, req.body.decision, JSON.stringify(chosen), cleanText(req.body.typedName, 120), decidedAt, receipt, existing.id],
      )
    } else {
      run(
        `INSERT INTO consent_request_decisions (receipt_reference, request_id, request_version, user_id, decision, granted_permissions, typed_name, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [receipt, row.id, row.version, req.user.id, req.body.decision, JSON.stringify(chosen), cleanText(req.body.typedName, 120), decidedAt],
      )
    }
    run(`INSERT INTO consent_request_events (request_id, user_id, action, detail) VALUES (?, ?, ?, ?)`, [
      row.id,
      req.user.id,
      req.body.decision,
      `${chosen.length} permission(s) recorded`,
    ])
    notify(req.user.id, 'Consent decision recorded', `Your ${req.body.decision === 'accepted' ? 'acceptance' : 'decline'} of "${row.title}" was recorded. Receipt ${receipt}.`, row.id)
    logAudit(req, { action: 'consent.request_decided', module: 'consent', entityType: 'consent_request', entityId: row.id })
    const decision = get(`SELECT * FROM consent_request_decisions WHERE request_id = ? AND user_id = ?`, [row.id, req.user.id])
    res.status(201).json({
      message: req.body.decision === 'accepted'
        ? 'Acceptance recorded for the chosen permissions. You can withdraw it later; withdrawal does not erase records already lawfully shared.'
        : 'Decline recorded. No permission was granted.',
      receipt: receipt,
      decision: shapeRequest(row, decision).decision,
      note: 'This receipt is a BetterGo platform record, not an official government document.',
    })
  }),
)

consentRequestsRouter.post(
  '/consent-requests/:id/withdraw',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM consent_requests WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Consent request not found.')
    const decision = get(`SELECT * FROM consent_request_decisions WHERE request_id = ? AND user_id = ?`, [row.id, req.user.id])
    if (!decision || decision.decision !== 'accepted' || decision.withdrawn_at) throw unprocessable('There is no active acceptance to withdraw.')
    run(`UPDATE consent_request_decisions SET withdrawn_at = ? WHERE id = ?`, [nowIso(), decision.id])
    run(`INSERT INTO consent_request_events (request_id, user_id, action) VALUES (?, ?, 'withdrawn')`, [row.id, req.user.id])
    notify(req.user.id, 'Consent withdrawn', `Your acceptance of "${row.title}" was withdrawn. Future processing relying on it stops; records already shared are not automatically deleted.`, row.id)
    logAudit(req, { action: 'consent.request_withdrawn', module: 'consent', entityType: 'consent_request', entityId: row.id })
    res.json({ message: 'Consent withdrawn. Future processing relying on it stops; information already lawfully shared is not automatically deleted.' })
  }),
)

consentRequestsRouter.get(
  '/consent-requests/:id/receipt',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM consent_requests WHERE id = ?`, [Number(req.params.id)])
    const decision = row ? get(`SELECT * FROM consent_request_decisions WHERE request_id = ? AND user_id = ?`, [row.id, req.user.id]) : null
    if (!row || !decision) throw notFound('Consent receipt not found.')
    const user = get(`SELECT name, email FROM users WHERE id = ?`, [req.user.id])
    const lines = [
      'BetterGo Marinduque — platform consent receipt',
      'This receipt is a BetterGo platform record. It is not an official government document, certificate or legally recognised electronic signature.',
      '',
      `Receipt reference: ${decision.receipt_reference}`,
      `Account: ${user.name} <${user.email}> (user ${req.user.id})`,
      `Consent request: ${row.title}`,
      `Request reference: ${row.reference}`,
      `Requesting entity: ${row.requesting_entity}`,
      `Purpose: ${row.purpose}`,
      `Permissions granted: ${parse(decision.granted_permissions).join(', ') || 'none'}`,
      `Decision: ${DECISIONS[decision.decision] || decision.decision}`,
      `Decided at: ${decision.decided_at}`,
      `Privacy notice version: ${row.privacy_notice_version || 'not recorded'}`,
      `Request version: ${decision.request_version}`,
      `Withdrawn at: ${decision.withdrawn_at || 'not withdrawn'}`,
      `Request expires: ${row.expires_at || 'no expiry recorded'}`,
    ]
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="bettergo-consent-${decision.receipt_reference}.txt"`)
    res.send(lines.join('\n'))
  }),
)

/* -------------------------------- Admin --------------------------------- */

export const adminConsentRequestsRouter = Router()
adminConsentRequestsRouter.use(requireAuth, requireAdmin)

adminConsentRequestsRouter.get(
  '/consent-requests',
  requirePermission('privacy.requests.manage'),
  asyncHandler(async (req, res) => {
    const rows = all(`SELECT * FROM consent_requests ORDER BY id DESC LIMIT 100`)
    const items = rows.map((row) => ({
      ...shapeRequest(row),
      decisionCounts: {
        accepted: get(`SELECT COUNT(*) AS total FROM consent_request_decisions WHERE request_id = ? AND decision = 'accepted' AND withdrawn_at IS NULL`, [row.id])?.total || 0,
        declined: get(`SELECT COUNT(*) AS total FROM consent_request_decisions WHERE request_id = ? AND decision = 'declined'`, [row.id])?.total || 0,
        withdrawn: get(`SELECT COUNT(*) AS total FROM consent_request_events WHERE request_id = ? AND action = 'withdrawn'`, [row.id])?.total || 0,
      },
    }))
    res.json({
      requests: items,
      summary: {
        total: items.length,
        pendingReview: items.filter((row) => row.status === 'pending_review').length,
        published: items.filter((row) => row.status === 'published').length,
        accepted: items.reduce((sum, row) => sum + row.decisionCounts.accepted, 0),
        declined: items.reduce((sum, row) => sum + row.decisionCounts.declined, 0),
        withdrawn: items.reduce((sum, row) => sum + row.decisionCounts.withdrawn, 0),
      },
      statuses: STATUSES,
      note: 'Statistics come from recorded decisions only. Consent is not legal approval by an LGU and no official requirement is implied.',
    })
  }),
)

adminConsentRequestsRouter.post(
  '/consent-requests',
  requirePermission('privacy.requests.manage'),
  validate(requestBody),
  asyncHandler(async (req, res) => {
    const id = Number(
      run(
        `INSERT INTO consent_requests (reference, title, purpose, requesting_entity, information_involved, intended_use, data_recipients,
          processing_duration, expires_at, required_permissions, optional_permissions, withdrawal_instructions, privacy_notice_version,
          references_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reference('BG-CREQ'),
          cleanText(req.body.title, 160),
          cleanText(req.body.purpose, 1000),
          cleanText(req.body.requestingEntity, 160),
          cleanText(req.body.informationInvolved, 1000),
          cleanText(req.body.intendedUse, 1000),
          cleanText(req.body.dataRecipients, 1000),
          cleanText(req.body.processingDuration, 300),
          req.body.expiresAt || null,
          JSON.stringify(req.body.requiredPermissions),
          JSON.stringify(req.body.optionalPermissions),
          cleanText(req.body.withdrawalInstructions, 1000),
          cleanText(req.body.privacyNoticeVersion, 40),
          JSON.stringify(req.body.references || []),
          req.user.id,
        ],
      ).lastInsertRowid,
    )
    logAudit(req, { action: 'consent.request_created', module: 'consent', entityType: 'consent_request', entityId: id })
    res.status(201).json({ message: 'Consent request saved as a draft.', request: shapeRequest(get(`SELECT * FROM consent_requests WHERE id = ?`, [id])) })
  }),
)

adminConsentRequestsRouter.put(
  '/consent-requests/:id',
  requirePermission('privacy.requests.manage'),
  validate(requestBody),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM consent_requests WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Consent request not found.')
    assertTransition(row, ['draft', 'pending_review', 'rejected'], 'Only draft, in-review or rejected requests can be edited.')
    run(
      `UPDATE consent_requests SET title = ?, purpose = ?, requesting_entity = ?, information_involved = ?, intended_use = ?, data_recipients = ?,
        processing_duration = ?, expires_at = ?, required_permissions = ?, optional_permissions = ?, withdrawal_instructions = ?,
        privacy_notice_version = ?, references_json = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      [
        cleanText(req.body.title, 160),
        cleanText(req.body.purpose, 1000),
        cleanText(req.body.requestingEntity, 160),
        cleanText(req.body.informationInvolved, 1000),
        cleanText(req.body.intendedUse, 1000),
        cleanText(req.body.dataRecipients, 1000),
        cleanText(req.body.processingDuration, 300),
        req.body.expiresAt || null,
        JSON.stringify(req.body.requiredPermissions),
        JSON.stringify(req.body.optionalPermissions),
        cleanText(req.body.withdrawalInstructions, 1000),
        cleanText(req.body.privacyNoticeVersion, 40),
        JSON.stringify(req.body.references || []),
        nowIso(),
        row.id,
      ],
    )
    if (row.status === 'rejected') run(`UPDATE consent_requests SET status = 'draft' WHERE id = ?`, [row.id])
    logAudit(req, { action: 'consent.request_updated', module: 'consent', entityType: 'consent_request', entityId: row.id })
    res.json({ message: 'Request updated. A new version requires a fresh citizen decision.', request: shapeRequest(get(`SELECT * FROM consent_requests WHERE id = ?`, [row.id])) })
  }),
)

adminConsentRequestsRouter.post(
  '/consent-requests/:id/transition',
  requirePermission('privacy.requests.manage'),
  validate(z.object({ action: z.enum(['submit', 'approve', 'publish', 'reject', 'archive', 'expire']), note: z.string().trim().max(500).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM consent_requests WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Consent request not found.')
    const note = cleanText(req.body.note, 500)
    const map = {
      submit: { from: ['draft', 'rejected'], to: 'pending_review', extra: 'submitted_at' },
      approve: { from: ['pending_review'], to: 'approved_for_publication' },
      publish: { from: ['approved_for_publication'], to: 'published', extra: 'published_at' },
      reject: { from: ['draft', 'pending_review', 'approved_for_publication'], to: 'rejected' },
      archive: { from: ['published', 'expired', 'rejected'], to: 'archived' },
      expire: { from: ['published'], to: 'expired' },
    }
    const move = map[req.body.action]
    assertTransition(row, move.from, `This request cannot be ${req.body.action}d from its current status.`)
    if (req.body.action === 'reject' && note.length < 3) throw unprocessable('Explain why the request is rejected.')
    if (req.body.action === 'publish' && (!row.expires_at || row.expires_at < today())) {
      throw unprocessable('Set a future expiry date before publishing.')
    }
    if (req.body.action === 'publish' && parse(row.required_permissions).length === 0 && parse(row.optional_permissions).length === 0) {
      throw unprocessable('Add at least one permission before publishing.')
    }
    const sets = ['status = ?', 'review_note = COALESCE(?, review_note)', 'updated_at = ?']
    const values = [move.to, note || null, nowIso()]
    if (move.extra) {
      sets.push(`${move.extra} = ?`)
      values.push(nowIso())
    }
    if (req.body.action === 'approve' || req.body.action === 'reject') {
      sets.push('reviewed_by = ?')
      values.push(req.user.id)
    }
    values.push(row.id)
    run(`UPDATE consent_requests SET ${sets.join(', ')} WHERE id = ?`, values)

    if (move.to === 'published') {
      const citizens = all(`SELECT id FROM users WHERE account_status NOT IN ('deleted','disabled','suspended')`)
      for (const citizen of citizens) {
        notify(citizen.id, 'New consent request', `"${row.title}" asks for your decision. Nothing is granted until you accept.`, row.id)
      }
    }
    logAudit(req, { action: `consent.request_${req.body.action}`, module: 'consent', entityType: 'consent_request', entityId: row.id, detail: note })
    res.json({ message: `Request status is now ${STATUSES[move.to]}.`, request: shapeRequest(get(`SELECT * FROM consent_requests WHERE id = ?`, [row.id])) })
  }),
)
