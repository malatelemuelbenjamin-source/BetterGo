/**
 * Identity verification and trust centre (Prompt 78).
 *
 * BetterGo never inspects government IDs or claims legal identity verification.
 * A resident verification is only recorded after an authorized office review.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const TYPES = {
  resident: 'Resident address review',
  phone: 'Mobile number verification',
}
const STATUSES = { pending: 'Pending review', verified: 'Reviewed by office', rejected: 'Not verified', cancelled: 'Cancelled' }

const smsConfigured = () => Boolean(process.env.SMS_PROVIDER_URL && process.env.SMS_PROVIDER_KEY)

function notify(userId, title, message, id) {
  const prefs = get(`SELECT in_app_enabled FROM notification_preferences WHERE user_id = ?`, [userId])
  if (prefs && Number(prefs.in_app_enabled) === 0) return
  run(
    `INSERT INTO notifications (user_id, title, message, notification_type, category, related_entity_type, related_entity_id)
     VALUES (?, ?, ?, 'identity', 'account', 'identity_verification', ?)`,
    [userId, title, message, id],
  )
}

function reference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let code = 'BG-ID-'
    for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)]
    if (!get(`SELECT id FROM identity_verifications WHERE reference = ?`, [code])) return code
  }
  throw unprocessable('Could not generate a verification reference. Please retry.')
}

function shape(row) {
  return {
    id: row.id,
    reference: row.reference,
    type: row.verification_type,
    typeLabel: TYPES[row.verification_type] || row.verification_type,
    status: row.status,
    statusLabel: STATUSES[row.status] || row.status,
    method: row.method,
    citizenNote: row.citizen_note,
    officeNote: row.office_note,
    requestedAt: row.requested_at,
    verifiedAt: row.verified_at,
  }
}

export const identityRouter = Router()
identityRouter.use(requireAuth)

identityRouter.get(
  '/identity',
  asyncHandler(async (req, res) => {
    const user = get(`SELECT email, phone, email_verified_at, phone_verified_at, account_status, created_at FROM users WHERE id = ?`, [req.user.id])
    const verifications = all(`SELECT * FROM identity_verifications WHERE user_id = ? ORDER BY id DESC LIMIT 30`, [req.user.id])
    const resident = verifications.find((row) => row.verification_type === 'resident' && row.status === 'verified')
    const events = all(
      `SELECT event_type, detail, created_at FROM account_security_events WHERE user_id = ? ORDER BY id DESC LIMIT 8`,
      [req.user.id],
    )
    res.json({
      account: {
        email: user.email,
        emailVerified: Boolean(user.email_verified_at),
        phone: user.phone ? `${user.phone.slice(0, 3)}••••${user.phone.slice(-2)}` : null,
        phoneVerified: Boolean(user.phone_verified_at),
        accountStatus: user.account_status,
        memberSince: user.created_at,
      },
      verifications: verifications.map(shape),
      trust: {
        email: Boolean(user.email_verified_at) ? 'verified' : 'unverified',
        phone: smsConfigured() ? (user.phone_verified_at ? 'verified' : 'unverified') : 'unavailable',
        resident: resident ? 'reviewed_by_office' : 'not_reviewed',
        note: 'Verification here records platform and office review events only. It is not a national digital ID, a legal identity proof or a government endorsement.',
      },
      recentSecurityEvents: events,
      types: TYPES,
      smsAvailable: smsConfigured(),
      note: 'Do not upload ID numbers or ID photos for verification. BetterGo never asks for them. A resident review must happen with the responsible office.',
    })
  }),
)

identityRouter.post(
  '/identity/requests',
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 5 }),
  validate(
    z.object({
      type: z.enum(['resident', 'phone']),
      municipalityId: z.coerce.number().int().positive().optional(),
      officeId: z.coerce.number().int().positive().optional(),
      note: z.string().trim().max(1000).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (req.body.type === 'phone' && !smsConfigured()) {
      throw unprocessable('Mobile verification is unavailable because no SMS provider is configured. BetterGo will not pretend to send a code.')
    }
    const open = get(`SELECT id FROM identity_verifications WHERE user_id = ? AND verification_type = ? AND status = 'pending'`, [req.user.id, req.body.type])
    if (open) throw unprocessable('You already have a pending request of this type.')
    if (req.body.officeId && !get(`SELECT id FROM government_offices WHERE id = ?`, [req.body.officeId])) throw unprocessable('That office is not recorded.')
    const id = Number(
      run(
        `INSERT INTO identity_verifications (reference, user_id, verification_type, method, municipality_id, office_id, citizen_note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          reference(),
          req.user.id,
          req.body.type,
          req.body.type === 'resident' ? 'office_review' : 'sms',
          req.body.municipalityId || null,
          req.body.officeId || null,
          cleanText(req.body.note, 1000),
        ],
      ).lastInsertRowid,
    )
    notify(req.user.id, 'Verification request recorded', 'Your request is pending office review. This is not a verified status yet.', id)
    res.status(201).json({
      message: 'Request recorded. It stays pending until an authorized office review is recorded.',
      verification: shape(get(`SELECT * FROM identity_verifications WHERE id = ?`, [id])),
      noSensitiveDocuments: 'Do not submit ID photos, ID numbers or other sensitive documents through BetterGo.',
    })
  }),
)

identityRouter.post(
  '/identity/requests/:id/cancel',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM identity_verifications WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Verification request not found.')
    if (row.status !== 'pending') throw unprocessable('Only a pending request can be cancelled.')
    run(`UPDATE identity_verifications SET status = 'cancelled' WHERE id = ?`, [row.id])
    res.json({ message: 'Request cancelled.' })
  }),
)

/* -------------------------------- Admin --------------------------------- */

export const adminIdentityRouter = Router()
adminIdentityRouter.use(requireAuth, requireAdmin)

function scoped(req, row) {
  if (!ctx(req).hasGlobalScope && !(row.municipality_id && canUseMunicipality(ctx(req), row.municipality_id))) throw notFound('Verification request not found.')
}

adminIdentityRouter.get(
  '/identity-verifications',
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const filters = []
    const params = []
    if (req.query.status) {
      filters.push('v.status = ?')
      params.push(String(req.query.status))
    }
    if (!context.hasGlobalScope) {
      if (!context.municipalityIds.length) return res.json({ results: [], statuses: STATUSES })
      filters.push(`v.municipality_id IN (${context.municipalityIds.map(() => '?').join(',')})`)
      params.push(...context.municipalityIds)
    }
    const rows = all(
      `SELECT v.*, u.name AS citizen_name, u.email AS citizen_email FROM identity_verifications v JOIN users u ON u.id = v.user_id
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY v.id DESC LIMIT 100`,
      params,
    )
    res.json({
      results: rows.map((row) => ({ ...shape(row), citizenName: row.citizen_name, citizenEmail: row.citizen_email })),
      statuses: STATUSES,
      note: 'Record a decision only after an actual office review. BetterGo does not inspect or store identity documents for this purpose.',
    })
  }),
)

adminIdentityRouter.post(
  '/identity-verifications/:id/decision',
  requirePermission('municipality_users.manage'),
  validate(z.object({ decision: z.enum(['verified', 'rejected']), note: z.string().trim().min(3).max(1000) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM identity_verifications WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Verification request not found.')
    scoped(req, row)
    if (row.status !== 'pending') throw unprocessable('Only a pending request can be decided.')
    run(`UPDATE identity_verifications SET status = ?, office_note = ?, verified_at = ?, verified_by = ? WHERE id = ?`, [
      req.body.decision,
      cleanText(req.body.note, 1000),
      req.body.decision === 'verified' ? nowIso() : null,
      req.user.id,
      row.id,
    ])
    logAudit(req, { action: `identity.${req.body.decision}`, module: 'identity', entityType: 'identity_verification', entityId: row.id })
    notify(row.user_id, 'Verification review recorded', `Your ${row.verification_type} review was recorded as ${req.body.decision}. This is a BetterGo record, not a national digital ID.`, row.id)
    res.json({ message: 'Review recorded.', verification: shape(get(`SELECT * FROM identity_verifications WHERE id = ?`, [row.id])) })
  }),
)
