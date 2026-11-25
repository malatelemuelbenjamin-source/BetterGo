/**
 * Delegated access (Prompt 79). Delegates receive read-only summaries for the
 * scopes the owner grants. They never get account control, passwords or vault files.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const SCOPES = {
  applications: 'Application progress',
  appointments: 'Appointment summaries',
  document_requests: 'Document request progress',
  complaints: 'Complaint case progress',
  journeys: 'Service journey progress',
}
const RELATIONSHIPS = { family: 'Family member', caregiver: 'Caregiver', representative: 'Authorized representative', other: 'Other trusted person' }

function notify(userId, title, message) {
  const prefs = get(`SELECT in_app_enabled FROM notification_preferences WHERE user_id = ?`, [userId])
  if (prefs && Number(prefs.in_app_enabled) === 0) return
  run(
    `INSERT INTO notifications (user_id, title, message, notification_type, category) VALUES (?, ?, ?, 'delegation', 'account')`,
    [userId, title, message],
  )
}

const parseScopes = (value) => {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.filter((scope) => SCOPES[scope]) : []
  } catch {
    return []
  }
}

function event(id, actor, action, note = null) {
  run(`INSERT INTO delegation_events (delegation_id, actor_user_id, action, note) VALUES (?, ?, ?, ?)`, [id, actor, action, cleanText(note, 500)])
}

function shape(row, viewerId) {
  const owner = get(`SELECT name FROM users WHERE id = ?`, [row.owner_user_id])
  const delegate = get(`SELECT name, email FROM users WHERE id = ?`, [row.delegate_user_id])
  return {
    id: row.id,
    ownerName: owner?.name,
    delegateName: delegate?.name,
    delegateEmail: viewerId === row.owner_user_id ? delegate?.email : null,
    relationship: row.relationship,
    relationshipLabel: RELATIONSHIPS[row.relationship] || row.relationship,
    scopes: parseScopes(row.scopes),
    scopeLabels: parseScopes(row.scopes).map((scope) => SCOPES[scope]),
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    isOwner: viewerId === row.owner_user_id,
  }
}

function activeFor(delegateId, ownerId) {
  const row = get(`SELECT * FROM access_delegations WHERE owner_user_id = ? AND delegate_user_id = ? AND status = 'active'`, [ownerId, delegateId])
  if (!row) return null
  if (row.expires_at && row.expires_at < new Date().toISOString().slice(0, 10)) {
    run(`UPDATE access_delegations SET status = 'expired' WHERE id = ?`, [row.id])
    return null
  }
  return row
}

export const delegationsRouter = Router()
delegationsRouter.use(requireAuth)

delegationsRouter.get(
  '/delegations',
  asyncHandler(async (req, res) => {
    const rows = all(`SELECT * FROM access_delegations WHERE owner_user_id = ? OR delegate_user_id = ? ORDER BY id DESC`, [req.user.id, req.user.id])
    res.json({
      given: rows.filter((row) => row.owner_user_id === req.user.id).map((row) => shape(row, req.user.id)),
      received: rows.filter((row) => row.delegate_user_id === req.user.id).map((row) => shape(row, req.user.id)),
      scopes: SCOPES,
      relationships: RELATIONSHIPS,
      note: 'Delegates can only read the summaries you select. They cannot change your password, account settings, documents or payments, and BetterGo does not treat them as your legal representative.',
    })
  }),
)

delegationsRouter.post(
  '/delegations',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  validate(
    z.object({
      email: z.string().trim().email().max(200),
      relationship: z.enum(Object.keys(RELATIONSHIPS)),
      scopes: z.array(z.enum(Object.keys(SCOPES))).min(1).max(5),
      expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const delegate = get(`SELECT id, name FROM users WHERE lower(email) = lower(?) AND account_status NOT IN ('suspended','deactivated','disabled')`, [req.body.email])
    if (!delegate) throw unprocessable('That person needs an active BetterGo account before you can delegate access.')
    if (delegate.id === req.user.id) throw unprocessable('You cannot delegate access to yourself.')
    if (get(`SELECT id FROM access_delegations WHERE owner_user_id = ? AND delegate_user_id = ?`, [req.user.id, delegate.id])) {
      throw unprocessable('A delegation already exists with this person.')
    }
    const id = Number(
      run(`INSERT INTO access_delegations (owner_user_id, delegate_user_id, relationship, scopes, expires_at) VALUES (?, ?, ?, ?, ?)`, [
        req.user.id,
        delegate.id,
        req.body.relationship,
        JSON.stringify(req.body.scopes),
        req.body.expiresAt || null,
      ]).lastInsertRowid,
    )
    event(id, req.user.id, 'invited')
    notify(delegate.id, 'Delegated access requested', 'Someone asked you to help with selected BetterGo records. You must accept before anything is shared.')
    res.status(201).json({
      message: 'Invitation recorded. The other person must accept before any summary is shared.',
      delegation: shape(get(`SELECT * FROM access_delegations WHERE id = ?`, [id]), req.user.id),
    })
  }),
)

async function delegation(id) {
  const row = get(`SELECT * FROM access_delegations WHERE id = ?`, [Number(id)])
  if (!row) throw notFound('Delegation not found.')
  return row
}

delegationsRouter.post(
  '/delegations/:id/accept',
  asyncHandler(async (req, res) => {
    const row = await delegation(req.params.id)
    if (row.delegate_user_id !== req.user.id || row.status !== 'pending') throw notFound('Invitation not found.')
    run(`UPDATE access_delegations SET status = 'active', responded_at = ? WHERE id = ?`, [nowIso(), row.id])
    event(row.id, req.user.id, 'accepted')
    notify(row.owner_user_id, 'Delegated access accepted', `Your delegate accepted read-only access to ${parseScopes(row.scopes).length} record type(s).`)
    res.json({ message: 'Access accepted. It stays read-only and you can revoke it at any time.', delegation: shape(get(`SELECT * FROM access_delegations WHERE id = ?`, [row.id]), req.user.id) })
  }),
)

delegationsRouter.post(
  '/delegations/:id/decline',
  asyncHandler(async (req, res) => {
    const row = await delegation(req.params.id)
    if (row.delegate_user_id !== req.user.id || row.status !== 'pending') throw notFound('Invitation not found.')
    run(`UPDATE access_delegations SET status = 'declined', responded_at = ? WHERE id = ?`, [nowIso(), row.id])
    event(row.id, req.user.id, 'declined')
    res.json({ message: 'Invitation declined. Nothing was shared.' })
  }),
)

delegationsRouter.post(
  '/delegations/:id/revoke',
  asyncHandler(async (req, res) => {
    const row = await delegation(req.params.id)
    if (row.owner_user_id !== req.user.id && row.delegate_user_id !== req.user.id) throw notFound('Delegation not found.')
    if (!['pending', 'active'].includes(row.status)) throw unprocessable('This delegation is already closed.')
    run(`UPDATE access_delegations SET status = 'revoked', revoked_at = ? WHERE id = ?`, [nowIso(), row.id])
    event(row.id, req.user.id, row.owner_user_id === req.user.id ? 'revoked_by_owner' : 'revoked_by_delegate')
    notify(row.owner_user_id === req.user.id ? row.delegate_user_id : row.owner_user_id, 'Delegated access ended', 'Read-only delegated access was revoked.')
    logAudit(req, { action: 'delegation.revoked', module: 'delegations', entityType: 'access_delegation', entityId: row.id })
    res.json({ message: 'Delegated access ended immediately.' })
  }),
)

delegationsRouter.get(
  '/delegations/:id/overview',
  asyncHandler(async (req, res) => {
    const row = await delegation(req.params.id)
    if (row.delegate_user_id !== req.user.id) throw notFound('Delegation not found.')
    const current = activeFor(req.user.id, row.owner_user_id)
    if (!current || current.id !== row.id) throw notFound('This delegation is not active.')
    const scopes = parseScopes(row.scopes)
    const owner = get(`SELECT name FROM users WHERE id = ?`, [row.owner_user_id])
    const result = { ownerName: owner?.name, scopes: scopes.map((scope) => SCOPES[scope]), sections: {}, note: 'Read-only summary for assistance. You cannot change the owner\'s account, documents, payments or applications.' }
    if (scopes.includes('applications')) {
      result.sections.applications = all(`SELECT reference, status, submitted_at FROM citizen_applications WHERE user_id = ? ORDER BY id DESC LIMIT 20`, [row.owner_user_id])
    }
    if (scopes.includes('appointments')) {
      result.sections.appointments = all(`SELECT reference, status, appointment_date FROM appointments WHERE user_id = ? ORDER BY id DESC LIMIT 20`, [row.owner_user_id])
    }
    if (scopes.includes('document_requests')) {
      result.sections.documentRequests = all(`SELECT reference, status, submitted_at FROM document_requests WHERE user_id = ? ORDER BY id DESC LIMIT 20`, [row.owner_user_id])
    }
    if (scopes.includes('complaints')) {
      result.sections.complaints = all(`SELECT reference, status, subject FROM complaint_cases WHERE user_id = ? ORDER BY id DESC LIMIT 20`, [row.owner_user_id])
    }
    if (scopes.includes('journeys')) {
      result.sections.journeys = all(
        `SELECT j.reference, j.title, j.status,
                (SELECT COUNT(*) FROM service_journey_tasks t WHERE t.journey_id = j.id AND t.status = 'done') AS tasks_done,
                (SELECT COUNT(*) FROM service_journey_tasks t WHERE t.journey_id = j.id) AS tasks_total
         FROM service_journeys j WHERE j.user_id = ? ORDER BY j.id DESC LIMIT 20`,
        [row.owner_user_id],
      )
    }
    event(row.id, req.user.id, 'overview_viewed')
    res.json(result)
  }),
)
