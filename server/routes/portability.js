/**
 * Citizen data portability (Prompt 84) and closure request foundation (Prompt 85).
 *
 * Exports contain only the signed-in citizen's own BetterGo records. Passwords,
 * MFA secrets, session tokens, other citizens' data and confidential staff notes
 * are never included. PDF generation is not implemented; the API reports that
 * limitation instead of pretending to produce one.
 */
import { Router } from 'express'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const EXPORT_CATEGORIES = {
  profile: 'Account profile',
  preferences: 'Preferences and notification settings',
  applications: 'BetterGo applications and intake records',
  appointments: 'Appointments',
  document_requests: 'Document requests',
  complaints: 'Complaint cases',
  journeys: 'Service journeys and preparation tasks',
  feedback: 'Feedback and suggestions',
  activity: 'Personal activity history',
  consents: 'Consent, signatures and authorizations',
  delegations: 'Authorized representative relationships',
  notifications: 'Notification history',
  documents: 'Personal document metadata (not the files)',
}
const EXPORT_STATUSES = {
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  expired: 'Expired',
  cancelled: 'Cancelled',
}
const EXPORT_FORMATS = { json: 'JSON (structured records)', csv: 'CSV (one category)', readme: 'README (plain text)' }
const EXPORT_DAYS = 7
const CLOSURE_STATUSES = {
  pending_review: 'Pending review',
  approved: 'Approved for manual closure',
  declined: 'Declined',
  cancelled: 'Cancelled',
}
const reference = (prefix) => `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`
const parse = (value, fallback) => {
  try {
    return JSON.parse(value || 'null') ?? fallback
  } catch {
    return fallback
  }
}
const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

function buildSections(userId, categories) {
  const builders = {
    profile: () => ({
      account: get(`SELECT name, email, phone, account_status, email_verified_at, created_at FROM users WHERE id = ?`, [userId]),
      profile: get(
        `SELECT first_name, middle_name, last_name, suffix, preferred_language, display_preference, municipality_id, barangay_id, address, created_at
         FROM user_profiles WHERE user_id = ?`,
        [userId],
      ),
    }),
    preferences: () => ({
      profile: get(
        `SELECT preferred_language, display_preference, reduced_motion, text_scale, high_contrast, simplified_view, screen_reader_hints, personalization_opt_in, assistance_needs
         FROM user_profiles WHERE user_id = ?`,
        [userId],
      ),
      notifications: get(`SELECT * FROM notification_preferences WHERE user_id = ?`, [userId]),
    }),
    applications: () => all(`SELECT reference, status, submitted_at, created_at FROM citizen_applications WHERE user_id = ? ORDER BY id DESC LIMIT 200`, [userId]),
    appointments: () => all(`SELECT reference, status, appointment_date, appointment_time, created_at FROM appointments WHERE user_id = ? ORDER BY id DESC LIMIT 200`, [userId]),
    document_requests: () => all(`SELECT reference, status, submitted_at FROM document_requests WHERE user_id = ? ORDER BY id DESC LIMIT 200`, [userId]),
    complaints: () => all(`SELECT reference, subject, status, created_at FROM complaint_cases WHERE user_id = ? ORDER BY id DESC LIMIT 200`, [userId]),
    journeys: () => all(
      `SELECT j.reference, j.title, j.status, j.created_at,
              (SELECT COUNT(*) FROM service_journey_tasks t WHERE t.journey_id = j.id AND t.status = 'done') AS tasks_done,
              (SELECT COUNT(*) FROM service_journey_tasks t WHERE t.journey_id = j.id) AS tasks_total
       FROM service_journeys j WHERE j.user_id = ? ORDER BY j.id DESC LIMIT 100`,
      [userId],
    ),
    feedback: () => all(`SELECT reference, title, status, created_at FROM citizen_feedback WHERE user_id = ? ORDER BY id DESC LIMIT 100`, [userId]),
    activity: () => all(`SELECT activity_type, entity_type, entity_label, created_at FROM citizen_activities WHERE user_id = ? ORDER BY id DESC LIMIT 200`, [userId]),
    consents: () => ({
      consents: all(`SELECT consent_category, status, policy_version, source, created_at, withdrawn_at FROM consent_records WHERE user_id = ? ORDER BY id DESC LIMIT 200`, [userId]),
      signatures: all(`SELECT reference, statement_key, signer_name, status, signed_at FROM electronic_signatures WHERE user_id = ? ORDER BY id DESC LIMIT 100`, [userId]),
      authorizations: all(`SELECT reference, recipient_name, recipient_organization, purpose, status, created_at FROM consent_authorizations WHERE user_id = ? ORDER BY id DESC LIMIT 100`, [userId]),
    }),
    delegations: () => ({
      given: all(`SELECT relationship, scopes, status, created_at FROM access_delegations WHERE owner_user_id = ? ORDER BY id DESC LIMIT 100`, [userId]),
      received: all(`SELECT relationship, scopes, status, created_at FROM access_delegations WHERE delegate_user_id = ? ORDER BY id DESC LIMIT 100`, [userId]),
    }),
    notifications: () => all(`SELECT title, notification_type, category, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 200`, [userId]),
    documents: () => all(`SELECT original_filename AS title, mime_type, file_size, created_at FROM citizen_documents WHERE user_id = ? ORDER BY id DESC LIMIT 200`, [userId]),
  }
  const sections = {}
  for (const category of categories) {
    const builder = builders[category]
    if (!builder) continue
    sections[category] = builder()
  }
  return sections
}

function toCsv(rows) {
  if (!Array.isArray(rows) || !rows.length) return ''
  const flat = rows.map((row) => {
    const output = {}
    for (const [key, value] of Object.entries(row || {})) {
      output[key] = value !== null && typeof value === 'object' ? JSON.stringify(value) : value
    }
    return output
  })
  const headers = [...new Set(flat.flatMap((row) => Object.keys(row)))]
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  return [headers.map(escape).join(','), ...flat.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n')
}

const isExpired = (row) => Boolean(row.expires_at && row.expires_at < new Date().toISOString())

function shapeExport(row) {
  const expired = row.status !== 'expired' && isExpired(row)
  return {
    id: row.id,
    reference: row.reference,
    status: expired ? 'expired' : row.status,
    statusLabel: EXPORT_STATUSES[expired ? 'expired' : row.status] || row.status,
    categories: parse(row.sections, []),
    categoryLabels: parse(row.sections, []).map((key) => EXPORT_CATEGORIES[key] || key),
    recordCounts: parse(row.record_counts, {}),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    downloadedAt: row.downloaded_at,
    errorReason: row.error_reason || null,
  }
}

function shapeClosure(row) {
  return {
    id: row.id,
    reference: row.reference,
    reason: row.reason,
    status: row.status,
    statusLabel: CLOSURE_STATUSES[row.status] || row.status,
    reviewNote: row.review_note,
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at,
    cancelledAt: row.cancelled_at,
  }
}

export const portabilityRouter = Router()
portabilityRouter.use(requireAuth)

portabilityRouter.get(
  '/portability',
  asyncHandler(async (req, res) => {
    const open = get(
      `SELECT * FROM account_closure_requests WHERE user_id = ? AND status = 'pending_review' ORDER BY id DESC LIMIT 1`,
      [req.user.id],
    )
    const latest = open || get(`SELECT * FROM account_closure_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [req.user.id])
    res.json({
      exports: all(`SELECT * FROM data_exports WHERE user_id = ? ORDER BY id DESC LIMIT 30`, [req.user.id]).map(shapeExport),
      categories: EXPORT_CATEGORIES,
      formats: EXPORT_FORMATS,
      statuses: EXPORT_STATUSES,
      retentionDays: EXPORT_DAYS,
      closure: latest ? shapeClosure(latest) : null,
      closureStatuses: CLOSURE_STATUSES,
      note: 'Exports cover your own BetterGo records only. Official government records, other citizens\' information, passwords, MFA secrets, session tokens and confidential staff notes are excluded.',
      exclusions: [
        'Passwords, MFA secrets, recovery codes and session tokens.',
        'Other citizens\' personal information and shared records.',
        'Confidential administrative notes and restricted third-party records.',
        'Document files themselves are not included; only document metadata is listed.',
        'Official government records held by an office are not BetterGo exports.',
      ],
      limitations: ['CSV contains one category per download.', 'PDF summaries are not implemented yet and are not simulated.'],
      closureNote: 'Submitting a closure request does not delete anything immediately. Staff review it first, and you can cancel while it is pending.',
    })
  }),
)

portabilityRouter.post(
  '/exports',
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 10 }),
  validate(
    z.object({
      categories: z.array(z.enum(Object.keys(EXPORT_CATEGORIES))).min(1).max(13),
      format: z.enum(['json', 'csv']).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const categories = [...new Set(req.body.categories)].sort()
    const duplicate = get(
      `SELECT id FROM data_exports WHERE user_id = ? AND sections = ? AND status = 'completed' AND created_at >= datetime('now', '-10 minutes')`,
      [req.user.id, JSON.stringify(categories)],
    )
    if (duplicate) throw unprocessable('An export with these categories was just created. Use it instead of creating a duplicate.')

    const id = Number(
      run(
        `INSERT INTO data_exports (reference, user_id, status, sections, record_counts, payload, expires_at)
         VALUES (?, ?, 'processing', ?, '{}', '{}', ?)`,
        [reference('BG-EXP'), req.user.id, JSON.stringify(categories), daysFromNow(EXPORT_DAYS)],
      ).lastInsertRowid,
    )
    try {
      const sections = buildSections(req.user.id, categories)
      const counts = Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, Array.isArray(value) ? value.length : 1]))
      const payload = {
        exportNote: 'This file contains only the records BetterGo holds about your own account. It excludes passwords, session tokens, other people\'s data and official government records held by an office.',
        generatedAt: nowIso(),
        categories,
        sections,
      }
      run(`UPDATE data_exports SET status = 'completed', record_counts = ?, payload = ? WHERE id = ?`, [
        JSON.stringify(counts),
        JSON.stringify(payload),
        id,
      ])
      logAudit(req, { action: 'portability.export_completed', module: 'portability', entityType: 'data_export', entityId: id })
      res.status(201).json({
        message: `Export ready. It expires after ${EXPORT_DAYS} days and is available only to your signed-in account.`,
        export: shapeExport(get(`SELECT * FROM data_exports WHERE id = ?`, [id])),
      })
    } catch (error) {
      run(`UPDATE data_exports SET status = 'failed', error_reason = ? WHERE id = ?`, ['The export could not be generated. Please retry.', id])
      logAudit(req, { action: 'portability.export_failed', module: 'portability', entityType: 'data_export', entityId: id })
      res.status(500).json({ error: 'The export could not be generated. Please retry.' })
    }
  }),
)

portabilityRouter.get(
  '/exports/:id',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM data_exports WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Export not found.')
    if (row.status !== 'completed') throw unprocessable('This export is not available for download.')
    if (isExpired(row)) {
      run(`UPDATE data_exports SET status = 'expired', payload = '{}' WHERE id = ?`, [row.id])
      throw notFound('This export expired and was removed. Create a new export.')
    }
    const format = String(req.query.format || 'json')
    run(`UPDATE data_exports SET downloaded_at = COALESCE(downloaded_at, ?) WHERE id = ?`, [nowIso(), row.id])
    logAudit(req, { action: 'portability.export_downloaded', module: 'portability', entityType: 'data_export', entityId: row.id, detail: format })

    if (format === 'readme') {
      const categories = parse(row.sections, [])
      res.setHeader('Content-Disposition', `attachment; filename="bettergo-${row.reference}-README.txt"`)
      res.type('text/plain').send([
        'BetterGo Marinduque personal data export',
        `Created: ${row.created_at}`,
        `Expires: ${row.expires_at}`,
        `Categories: ${categories.map((key) => EXPORT_CATEGORIES[key] || key).join(', ')}`,
        '',
        'Files: JSON contains every selected category. CSV downloads one category at a time.',
        'Excluded: passwords, MFA secrets, recovery codes, session tokens, other citizens\' data, confidential staff notes, and official government records held by an office.',
        'Document files are not included; only document metadata is listed.',
        'A downloaded BetterGo export is not an official government record or certified document.',
      ].join('\n'))
      return
    }

    if (format === 'csv') {
      const section = String(req.query.section || '')
      const payload = parse(row.payload, {})
      if (!EXPORT_CATEGORIES[section] || !(section in (payload.sections || {}))) {
        res.setHeader('Content-Type', 'application/json')
        return res.status(422).json({ error: 'Choose one exported category for CSV, for example ?section=applications.' })
      }
      const value = payload.sections[section]
      const rows = Array.isArray(value) ? value : [value]
      res.setHeader('Content-Disposition', `attachment; filename="bettergo-${row.reference}-${section}.csv"`)
      res.type('text/csv').send(toCsv(rows))
      return
    }

    res.setHeader('Content-Disposition', `attachment; filename="bettergo-${row.reference}.json"`)
    res.setHeader('Cache-Control', 'private, no-store')
    res.type('application/json').send(row.payload)
  }),
)

portabilityRouter.delete(
  '/exports/:id',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM data_exports WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Export not found.')
    if (row.status === 'processing') throw unprocessable('This export is still processing.')
    run(`UPDATE data_exports SET status = 'cancelled', payload = '{}' WHERE id = ?`, [row.id])
    res.json({ message: 'Export cancelled and its contents removed.' })
  }),
)

portabilityRouter.post(
  '/closure-requests',
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 3 }),
  validate(z.object({ reason: z.string().trim().max(1000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    if (get(`SELECT id FROM account_closure_requests WHERE user_id = ? AND status = 'pending_review'`, [req.user.id])) {
      throw unprocessable('You already have a closure request pending review.')
    }
    const id = Number(
      run(`INSERT INTO account_closure_requests (reference, user_id, reason) VALUES (?, ?, ?)`, [
        reference('BG-CLOSE'),
        req.user.id,
        cleanText(req.body.reason, 1000),
      ]).lastInsertRowid,
    )
    logAudit(req, { action: 'portability.closure_requested', module: 'portability', entityType: 'account_closure_request', entityId: id })
    res.status(201).json({
      message: 'Closure request recorded for review. Nothing is deleted yet, and you can cancel while it is pending.',
      closure: shapeClosure(get(`SELECT * FROM account_closure_requests WHERE id = ?`, [id])),
    })
  }),
)

portabilityRouter.post(
  '/closure-requests/:id/cancel',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM account_closure_requests WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Closure request not found.')
    if (row.status !== 'pending_review') throw unprocessable('Only a pending request can be cancelled.')
    run(`UPDATE account_closure_requests SET status = 'cancelled', cancelled_at = ? WHERE id = ?`, [nowIso(), row.id])
    logAudit(req, { action: 'portability.closure_cancelled', module: 'portability', entityType: 'account_closure_request', entityId: row.id })
    res.json({ message: 'Closure request cancelled. Your account stays open.' })
  }),
)

/* -------------------------------- Admin --------------------------------- */

export const adminPortabilityRouter = Router()
adminPortabilityRouter.use(requireAuth, requireAdmin)

function scopedExportRows(req) {
  const context = ctx(req)
  const rows = all(
    `SELECT e.*, u.name AS citizen_name, u.email AS citizen_email, p.municipality_id
     FROM data_exports e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN user_profiles p ON p.user_id = e.user_id
     ORDER BY e.id DESC LIMIT 200`,
  )
  return rows.filter((row) => context.hasGlobalScope || (row.municipality_id && canUseMunicipality(context, row.municipality_id)))
}

adminPortabilityRouter.get(
  '/data-exports',
  asyncHandler(async (req, res) => {
    const rows = scopedExportRows(req)
    const expired = rows.filter((row) => row.status === 'expired' || isExpired(row))
    res.json({
      summary: {
        total: rows.length,
        completed: rows.filter((row) => row.status === 'completed' && !isExpired(row)).length,
        failed: rows.filter((row) => row.status === 'failed').length,
        expired: expired.length,
        pending: rows.filter((row) => ['queued', 'processing'].includes(row.status)).length,
      },
      results: rows.map((row) => ({
        ...shapeExport(row),
        citizenName: row.citizen_name,
        citizenEmail: row.citizen_email,
      })),
      retentionDays: EXPORT_DAYS,
      note: 'Administrators can see request metadata only. Opening a citizen export package requires a documented operational purpose, and this interface does not expose package contents.',
    })
  }),
)

adminPortabilityRouter.post(
  '/data-exports/:id/purge',
  requirePermission('privacy.requests.manage'),
  validate(z.object({ note: z.string().trim().min(5).max(500) })),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const row = get(
      `SELECT e.*, p.municipality_id FROM data_exports e LEFT JOIN user_profiles p ON p.user_id = e.user_id WHERE e.id = ?`,
      [Number(req.params.id)],
    )
    if (!row) throw notFound('Export not found.')
    if (!context.hasGlobalScope && !(row.municipality_id && canUseMunicipality(context, row.municipality_id))) {
      throw notFound('Export not found in your scope.')
    }
    run(`UPDATE data_exports SET status = 'expired', payload = '{}' WHERE id = ?`, [row.id])
    logAudit(req, {
      action: 'portability.export_purged',
      module: 'portability',
      entityType: 'data_export',
      entityId: row.id,
      detail: cleanText(req.body.note, 500),
    })
    res.json({ message: 'Export contents purged according to retention procedure.' })
  }),
)

adminPortabilityRouter.get(
  '/closure-requests',
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const rows = all(
      `SELECT c.*, u.name AS citizen_name, u.email AS citizen_email, p.municipality_id
       FROM account_closure_requests c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN user_profiles p ON p.user_id = c.user_id
       ORDER BY c.id DESC LIMIT 100`,
    ).filter((row) => context.hasGlobalScope || (row.municipality_id && canUseMunicipality(context, row.municipality_id)))
    res.json({
      results: rows.map((row) => ({ ...shapeClosure(row), citizenName: row.citizen_name, citizenEmail: row.citizen_email })),
      statuses: CLOSURE_STATUSES,
      note: 'A decision here records a review outcome only. Approved requests still need the documented manual closure process; nothing is deleted by this action. Never approve without checking outstanding privacy or records requests.',
    })
  }),
)

adminPortabilityRouter.post(
  '/closure-requests/:id/decision',
  requirePermission('municipality_users.manage'),
  validate(z.object({ decision: z.enum(['approved', 'declined']), note: z.string().trim().min(3).max(1000) })),
  asyncHandler(async (req, res) => {
    const row = get(
      `SELECT c.*, p.municipality_id FROM account_closure_requests c LEFT JOIN user_profiles p ON p.user_id = c.user_id WHERE c.id = ?`,
      [Number(req.params.id)],
    )
    if (!row) throw notFound('Closure request not found.')
    const context = ctx(req)
    if (!context.hasGlobalScope && !(row.municipality_id && canUseMunicipality(context, row.municipality_id))) {
      throw notFound('Closure request not found.')
    }
    if (row.status !== 'pending_review') throw unprocessable('This request is already decided.')
    run(`UPDATE account_closure_requests SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`, [
      req.body.decision,
      cleanText(req.body.note, 1000),
      req.user.id,
      nowIso(),
      row.id,
    ])
    logAudit(req, { action: `portability.closure_${req.body.decision}`, module: 'portability', entityType: 'account_closure_request', entityId: row.id })
    res.json({
      message: req.body.decision === 'approved'
        ? 'Approved for manual closure. No data was deleted by this action.'
        : 'Closure request declined with a note.',
    })
  }),
)
