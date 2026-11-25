/**
 * Consent, authorization and electronic signature centre (Prompt 80).
 *
 * Everything here is a BetterGo platform record. A typed-name signature is not
 * a government-issued electronic signature certificate, is not notarised, and
 * no LGU has confirmed or endorsed it.
 */
import { Router } from 'express'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, forbidden, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const POLICY_VERSION = '2026-01'

const CATEGORIES = {
  terms_of_use: { label: 'Terms of Use', required: true, description: 'Acceptance is required while the account is active.' },
  privacy_policy: { label: 'Privacy Policy', required: true, description: 'Acceptance is required while the account is active.' },
  service_updates: { label: 'Service and application updates', required: false, description: 'Messages about services you follow and requests you filed.' },
  data_sharing: { label: 'Sharing records with an office you authorize', required: false, description: 'Only the records you name, only for the purpose you write down.' },
  research: { label: 'Research and service improvement', required: false, description: 'Aggregated, de-identified input about how services are used.' },
}

const STATEMENTS = {
  data_accuracy: {
    label: 'Accuracy of information',
    text: 'I confirm that the information I submit through BetterGo is accurate and complete to the best of my knowledge.',
  },
  document_release: {
    label: 'Instruction to release a document summary',
    text: 'I instruct BetterGo to record that the named recipient may receive the selected document summary. I understand the responsible office issues any official copy, and that BetterGo does not issue certificates.',
  },
  representative: {
    label: 'Helping through another person',
    text: 'I confirm that I asked the named person to help me with selected BetterGo records. This does not make them my legal representative and does not transfer my account.',
  },
  consent_confirmation: {
    label: 'Consent confirmation',
    text: 'I confirm the consent choices recorded in my BetterGo account are my own and were made by me.',
  },
}

const SHARE_CATEGORIES = {
  profile: 'Profile and contact details',
  applications: 'Application progress',
  appointments: 'Appointment summaries',
  document_requests: 'Document request progress',
  complaints: 'Complaint case progress',
}

const SIGNATURE_NOTE =
  'This is a BetterGo platform record of your typed name and confirmation. It is not a government-issued electronic signature certificate, it is not notarised, and no LGU has confirmed it.'

function reference(prefix) {
  return `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`
}

const today = () => new Date().toISOString().slice(0, 10)

function parseShareCategories(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.filter((entry) => SHARE_CATEGORIES[entry]) : []
  } catch {
    return []
  }
}

function shapeAuthorization(row) {
  const expired = row.status === 'active' && row.expires_at && row.expires_at < today()
  const status = expired ? 'expired' : row.status
  return {
    id: row.id,
    reference: row.reference,
    recipientName: row.recipient_name,
    recipientOrganization: row.recipient_organization,
    purpose: row.purpose,
    categories: parseShareCategories(row.categories),
    categoryLabels: parseShareCategories(row.categories).map((entry) => SHARE_CATEGORIES[entry]),
    status,
    expiresAt: row.expires_at,
    signatureId: row.signature_id,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }
}

function shapeSignature(row) {
  return {
    id: row.id,
    reference: row.reference,
    statement: row.statement_key,
    statementLabel: STATEMENTS[row.statement_key]?.label || row.statement_key,
    statementText: row.statement_text,
    signerName: row.signer_name,
    contentHash: row.content_hash,
    status: row.status,
    acknowledgedAt: row.acknowledged_at,
    acknowledgementNote: row.acknowledgement_note,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }
}

export const consentRouter = Router()
consentRouter.use(requireAuth)

consentRouter.get(
  '/consent',
  asyncHandler(async (req, res) => {
    const rows = all(`SELECT * FROM consent_records WHERE user_id = ? ORDER BY id DESC`, [req.user.id])
    const latest = new Map()
    for (const row of rows) if (!latest.has(row.consent_category)) latest.set(row.consent_category, row)
    const catalog = Object.entries(CATEGORIES).map(([key, meta]) => {
      const record = latest.get(key)
      return {
        key,
        ...meta,
        status: record?.status || 'not_recorded',
        policyVersion: record?.policy_version || null,
        updatedAt: record?.withdrawn_at || record?.created_at || null,
      }
    })
    res.json({
      catalog,
      policyVersion: POLICY_VERSION,
      signatures: all(`SELECT * FROM electronic_signatures WHERE user_id = ? ORDER BY id DESC LIMIT 30`, [req.user.id]).map(shapeSignature),
      authorizations: all(`SELECT * FROM consent_authorizations WHERE user_id = ? ORDER BY id DESC LIMIT 30`, [req.user.id]).map(shapeAuthorization),
      statements: STATEMENTS,
      shareCategories: SHARE_CATEGORIES,
      signatureNote: SIGNATURE_NOTE,
      note: 'Required consents keep the account working. Optional consents can be withdrawn at any time and withdrawal applies going forward.',
    })
  }),
)

consentRouter.post(
  '/consent/signatures',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }),
  validate(
    z.object({
      statement: z.enum(Object.keys(STATEMENTS)),
      signerName: z.string().trim().min(3).max(120),
      agree: z.literal(true),
      subjectReference: z.string().trim().max(80).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const user = get(`SELECT name FROM users WHERE id = ?`, [req.user.id])
    const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
    if (normalize(req.body.signerName) !== normalize(user?.name)) {
      throw unprocessable('Type your full name exactly as it appears on your account.')
    }
    const statement = STATEMENTS[req.body.statement]
    const signedAt = nowIso()
    const contentHash = createHash('sha256')
      .update(`${req.body.statement}|${statement.text}|${req.body.signerName}|${req.user.id}|${signedAt}|${req.body.subjectReference || ''}`)
      .digest('hex')
    const id = Number(
      run(
        `INSERT INTO electronic_signatures (reference, user_id, statement_key, statement_text, signer_name, content_hash, subject_reference, signed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [reference('BG-SIG'), req.user.id, req.body.statement, statement.text, req.body.signerName, contentHash, cleanText(req.body.subjectReference, 80), signedAt],
      ).lastInsertRowid,
    )
    logAudit(req, { action: 'consent.signature_recorded', module: 'consent', entityType: 'electronic_signature', entityId: id })
    res.status(201).json({
      message: 'Signature recorded on this platform.',
      note: SIGNATURE_NOTE,
      signature: shapeSignature(get(`SELECT * FROM electronic_signatures WHERE id = ?`, [id])),
    })
  }),
)

consentRouter.post(
  '/consent/signatures/:id/revoke',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM electronic_signatures WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Signature record not found.')
    if (row.status !== 'recorded') throw unprocessable('This signature record is already closed.')
    run(`UPDATE electronic_signatures SET status = 'revoked', revoked_at = ? WHERE id = ?`, [nowIso(), row.id])
    logAudit(req, { action: 'consent.signature_revoked', module: 'consent', entityType: 'electronic_signature', entityId: row.id })
    res.json({ message: 'Signature record withdrawn. Any authorization that relied on it should be revoked too.' })
  }),
)

consentRouter.post(
  '/consent/authorizations',
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 10 }),
  validate(
    z.object({
      recipientName: z.string().trim().min(2).max(120),
      recipientOrganization: z.string().trim().min(2).max(160),
      purpose: z.string().trim().min(10).max(500),
      categories: z.array(z.enum(Object.keys(SHARE_CATEGORIES))).min(1).max(5),
      expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      signatureId: z.coerce.number().int().positive().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (req.body.expiresAt && req.body.expiresAt < today()) throw unprocessable('The expiry date cannot be in the past.')
    if (req.body.signatureId) {
      const signature = get(`SELECT * FROM electronic_signatures WHERE id = ? AND user_id = ?`, [req.body.signatureId, req.user.id])
      if (!signature) throw unprocessable('That signature record is not yours.')
      if (signature.status !== 'recorded') throw unprocessable('That signature record was withdrawn.')
    }
    const id = Number(
      run(
        `INSERT INTO consent_authorizations (reference, user_id, recipient_name, recipient_organization, purpose, categories, expires_at, signature_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reference('BG-AUTH'),
          req.user.id,
          cleanText(req.body.recipientName, 120),
          cleanText(req.body.recipientOrganization, 160),
          cleanText(req.body.purpose, 500),
          JSON.stringify(req.body.categories),
          req.body.expiresAt || null,
          req.body.signatureId || null,
        ],
      ).lastInsertRowid,
    )
    logAudit(req, { action: 'consent.authorization_created', module: 'consent', entityType: 'consent_authorization', entityId: id })
    res.status(201).json({
      message: 'Authorization recorded. BetterGo does not transmit records automatically; the named recipient must request them through the responsible office.',
      authorization: shapeAuthorization(get(`SELECT * FROM consent_authorizations WHERE id = ?`, [id])),
    })
  }),
)

consentRouter.post(
  '/consent/authorizations/:id/revoke',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM consent_authorizations WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Authorization not found.')
    if (row.status !== 'active') throw unprocessable('This authorization is already closed.')
    run(`UPDATE consent_authorizations SET status = 'revoked', revoked_at = ? WHERE id = ?`, [nowIso(), row.id])
    logAudit(req, { action: 'consent.authorization_revoked', module: 'consent', entityType: 'consent_authorization', entityId: row.id })
    res.json({ message: 'Authorization revoked. It cannot be used again.' })
  }),
)

consentRouter.post(
  '/consent/:category',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 40 }),
  validate(
    z.object({
      status: z.enum(['granted', 'withdrawn']),
      policyVersion: z.string().trim().max(30).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const category = req.params.category
    const meta = CATEGORIES[category]
    if (!meta) throw notFound('Unknown consent category.')
    if (meta.required && req.body.status === 'withdrawn') {
      throw forbidden('Acceptance of the Terms of Use and Privacy Policy cannot be withdrawn while the account is active.')
    }
    const current = get(
      `SELECT * FROM consent_records WHERE user_id = ? AND consent_category = ? ORDER BY id DESC LIMIT 1`,
      [req.user.id, category],
    )
    if (req.body.status === 'withdrawn' && (!current || current.status !== 'granted')) {
      throw notFound('No active consent of that type was found.')
    }
    const id = Number(
      run(
        `INSERT INTO consent_records (user_id, consent_category, status, policy_version, source, withdrawn_at)
         VALUES (?, ?, ?, ?, 'consent_centre', ?)`,
        [
          req.user.id,
          category,
          req.body.status,
          req.body.policyVersion || POLICY_VERSION,
          req.body.status === 'withdrawn' ? nowIso() : null,
        ],
      ).lastInsertRowid,
    )
    logAudit(req, {
      action: `consent.${req.body.status}`,
      module: 'consent',
      entityType: 'consent_record',
      entityId: id,
      detail: category,
    })
    res.status(req.body.status === 'granted' ? 201 : 200).json({
      message: req.body.status === 'granted' ? 'Consent recorded for this account.' : 'Consent withdrawn. It applies going forward.',
      consent: { id, category, status: req.body.status, policyVersion: req.body.policyVersion || POLICY_VERSION },
    })
  }),
)

/* -------------------------------- Admin --------------------------------- */

export const adminConsentRouter = Router()
adminConsentRouter.use(requireAuth, requireAdmin)

function profileMunicipality(userId) {
  return get(`SELECT municipality_id FROM user_profiles WHERE user_id = ?`, [userId])?.municipality_id || null
}

function scopeFilter(req, alias = 'p') {
  const context = ctx(req)
  if (context.hasGlobalScope) return { sql: '', params: [] }
  if (!context.municipalityIds.length) return { sql: 'AND 1 = 0', params: [] }
  return { sql: `AND ${alias}.municipality_id IN (${context.municipalityIds.map(() => '?').join(',')})`, params: context.municipalityIds }
}

adminConsentRouter.get(
  '/consent',
  asyncHandler(async (req, res) => {
    const scope = scopeFilter(req)
    const signatureRows = all(
      `SELECT s.*, u.name AS citizen_name FROM electronic_signatures s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_profiles p ON p.user_id = s.user_id
       WHERE 1 = 1 ${scope.sql} ORDER BY s.id DESC LIMIT 100`,
      scope.params,
    )
    const authorizationRows = all(
      `SELECT a.*, u.name AS citizen_name FROM consent_authorizations a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN user_profiles p ON p.user_id = a.user_id
       WHERE 1 = 1 ${scope.sql} ORDER BY a.id DESC LIMIT 100`,
      scope.params,
    )
    res.json({
      summary: {
        recordedSignatures: signatureRows.filter((row) => row.status === 'recorded').length,
        awaitingAcknowledgement: signatureRows.filter((row) => row.status === 'recorded' && !row.acknowledged_at).length,
        activeAuthorizations: authorizationRows.filter((row) => shapeAuthorization(row).status === 'active').length,
      },
      signatures: signatureRows.map((row) => ({ ...shapeSignature(row), citizenName: row.citizen_name })),
      authorizations: authorizationRows.map((row) => ({ ...shapeAuthorization(row), citizenName: row.citizen_name })),
      note: 'These are BetterGo platform records only. Acknowledging a signature means the office received the record; it does not verify identity, notarise a document or create a government certificate.',
    })
  }),
)

adminConsentRouter.post(
  '/consent/signatures/:id/acknowledge',
  requirePermission('municipality_users.manage'),
  validate(z.object({ note: z.string().trim().min(3).max(500) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM electronic_signatures WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Signature record not found.')
    const municipality = profileMunicipality(row.user_id)
    if (!ctx(req).hasGlobalScope && !(municipality && canUseMunicipality(ctx(req), municipality))) {
      throw notFound('Signature record not found.')
    }
    if (row.status !== 'recorded') throw unprocessable('This signature record is closed.')
    if (row.acknowledged_at) throw unprocessable('This signature record was already acknowledged.')
    run(`UPDATE electronic_signatures SET acknowledged_by = ?, acknowledged_at = ?, acknowledgement_note = ? WHERE id = ?`, [
      req.user.id,
      nowIso(),
      cleanText(req.body.note, 500),
      row.id,
    ])
    logAudit(req, { action: 'consent.signature_acknowledged', module: 'consent', entityType: 'electronic_signature', entityId: row.id })
    res.json({ message: 'Acknowledged as received by an office. This is not identity verification.' })
  }),
)
