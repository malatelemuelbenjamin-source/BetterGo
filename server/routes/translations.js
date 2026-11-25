/**
 * Language access (Prompt 83).
 *
 * English is the published language. A Filipino translation is a reading aid
 * unless an authorized office review marked it confirmed. BetterGo never
 * invents a translation for another language; those are requested instead.
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

const LANGUAGES = { fil: 'Filipino' }
const STATUSES = { draft: 'BetterGo reading aid (not office-confirmed)', office_confirmed: 'Confirmed by the responsible office' }
const REQUEST_STATUSES = { pending: 'Pending review', completed: 'Translation available', declined: 'Not available' }

const parse = (value) => {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const reference = () => `BG-TR-${randomBytes(4).toString('hex').toUpperCase()}`

function shapeTranslation(row) {
  return {
    id: row.id,
    serviceId: row.service_id,
    language: row.language,
    languageLabel: LANGUAGES[row.language] || row.language,
    title: row.title,
    summary: row.summary,
    eligibility: row.eligibility,
    requirements: row.requirements,
    fees: row.fees,
    procedure: row.procedure,
    notes: row.notes,
    status: row.status,
    statusLabel: STATUSES[row.status] || row.status,
    source: row.source,
    serviceTitle: row.service_title,
    serviceSlug: row.service_slug,
    updatedAt: row.updated_at,
  }
}

function shapeRequest(row) {
  return {
    id: row.id,
    reference: row.reference,
    serviceTitle: row.service_title,
    serviceSlug: row.service_slug,
    language: row.language,
    languageLabel: LANGUAGES[row.language] || row.language,
    note: row.note,
    status: row.status,
    statusLabel: REQUEST_STATUSES[row.status] || row.status,
    responseNote: row.response_note,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  }
}

export const translationsRouter = Router()
translationsRouter.use(requireAuth)

translationsRouter.get(
  '/translations',
  asyncHandler(async (req, res) => {
    const translations = all(
      `SELECT t.*, g.title AS service_title, g.slug AS service_slug
       FROM service_translations t JOIN government_services g ON g.id = t.service_id
       WHERE g.publication_status = 'published' AND t.language = 'fil'
       ORDER BY g.title LIMIT 100`,
    ).map(shapeTranslation)
    const requests = all(
      `SELECT r.*, g.title AS service_title, g.slug AS service_slug
       FROM translation_requests r LEFT JOIN government_services g ON g.id = r.service_id
       WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 30`,
      [req.user.id],
    ).map(shapeRequest)
    const requested = new Set(
      all(`SELECT service_id, language FROM translation_requests WHERE user_id = ? AND status = 'pending'`, [req.user.id])
        .map((row) => `${row.service_id}:${row.language}`),
    )
    const available = all(
      `SELECT g.id, g.title, g.slug, m.name AS municipality_name
       FROM government_services g LEFT JOIN municipalities m ON m.id = g.municipality_id
       WHERE g.publication_status = 'published' ORDER BY g.title LIMIT 100`,
    )
      .filter((row) => !translations.some((entry) => entry.serviceId === row.id) && !requested.has(`${row.id}:fil`))
      .map((row) => ({ id: row.id, title: row.title, municipality: row.municipality_name || 'Province-wide' }))
    res.json({
      translations,
      requests,
      availableServices: available,
      languages: LANGUAGES,
      note: 'The English published text is the service record. A Filipino translation here is a reading aid prepared for BetterGo unless it is explicitly marked as confirmed by the responsible office. For other languages, request help; BetterGo does not generate translations automatically.',
    })
  }),
)

translationsRouter.post(
  '/translations/requests',
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 10 }),
  validate(
    z.object({
      serviceId: z.coerce.number().int().positive(),
      language: z.enum(Object.keys(LANGUAGES)),
      note: z.string().trim().max(500).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const service = get(`SELECT id, title FROM government_services WHERE id = ? AND publication_status = 'published'`, [req.body.serviceId])
    if (!service) throw unprocessable('Only a published service can be requested.')
    const existing = get(
      `SELECT id FROM translation_requests WHERE user_id = ? AND service_id = ? AND language = ? AND status = 'pending'`,
      [req.user.id, service.id, req.body.language],
    )
    if (existing) throw unprocessable('You already have a pending request for this service and language.')
    const id = Number(
      run(`INSERT INTO translation_requests (reference, user_id, service_id, language, note) VALUES (?, ?, ?, ?, ?)`, [
        reference(),
        req.user.id,
        service.id,
        req.body.language,
        cleanText(req.body.note, 500),
      ]).lastInsertRowid,
    )
    logAudit(req, { action: 'translation.requested', module: 'translations', entityType: 'translation_request', entityId: id })
    res.status(201).json({
      message: 'Request recorded. It stays pending until a reviewer responds; no translation is promised.',
      request: shapeRequest(get(
        `SELECT r.*, g.title AS service_title, g.slug AS service_slug FROM translation_requests r LEFT JOIN government_services g ON g.id = r.service_id WHERE r.id = ?`,
        [id],
      )),
    })
  }),
)

translationsRouter.post(
  '/translations/requests/:id/cancel',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM translation_requests WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Request not found.')
    if (row.status !== 'pending') throw unprocessable('Only a pending request can be cancelled.')
    run(`UPDATE translation_requests SET status = 'declined', response_note = 'Cancelled by the citizen.', reviewed_at = ? WHERE id = ?`, [nowIso(), row.id])
    res.json({ message: 'Request cancelled.' })
  }),
)

/* -------------------------------- Admin --------------------------------- */

export const adminTranslationsRouter = Router()
adminTranslationsRouter.use(requireAuth, requireAdmin)

function scoped(req, serviceId) {
  const service = get(`SELECT id, municipality_id, publication_status FROM government_services WHERE id = ?`, [serviceId])
  if (!service) return null
  const context = ctx(req)
  if (context.hasGlobalScope) return service
  return service.municipality_id && canUseMunicipality(context, service.municipality_id) ? service : null
}

adminTranslationsRouter.get(
  '/translations',
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const services = all(
      `SELECT g.id, g.title, g.slug, g.municipality_id, g.verification_status, t.id AS translation_id, t.title AS translated_title,
              t.status AS translation_status, t.updated_at,
              t.summary AS t_summary, t.eligibility AS t_eligibility, t.requirements AS t_requirements,
              t.fees AS t_fees, t.procedure AS t_procedure, t.notes AS t_notes, t.source AS t_source
       FROM government_services g
       LEFT JOIN service_translations t ON t.service_id = g.id AND t.language = 'fil'
       WHERE g.publication_status = 'published' ORDER BY g.title LIMIT 200`,
    ).filter((row) => context.hasGlobalScope || (row.municipality_id && canUseMunicipality(context, row.municipality_id)))
    const serviceIds = new Set(services.map((row) => row.id))
    const requests = all(
      `SELECT r.*, g.title AS service_title, g.slug AS service_slug, u.name AS citizen_name, u.email AS citizen_email
       FROM translation_requests r
       LEFT JOIN government_services g ON g.id = r.service_id
       LEFT JOIN users u ON u.id = r.user_id
       ORDER BY r.id DESC LIMIT 100`,
    ).filter((row) => serviceIds.has(row.service_id))
    res.json({
      services: services.map((row) => ({
        id: row.id,
        title: row.title,
        translationId: row.translation_id,
        translatedTitle: row.translated_title,
        translationStatus: row.translation_status,
        updatedAt: row.updated_at,
        translation: row.translation_id ? {
          title: row.translated_title,
          summary: row.t_summary,
          eligibility: row.t_eligibility,
          requirements: row.t_requirements,
          fees: row.t_fees,
          procedure: row.t_procedure,
          notes: row.t_notes,
          source: row.t_source,
          status: row.translation_status,
        } : null,
      })),
      requests: requests.map((row) => ({ ...shapeRequest(row), citizenName: row.citizen_name, citizenEmail: row.citizen_email })),
      statuses: STATUSES,
      requestStatuses: REQUEST_STATUSES,
      note: 'Mark a translation office-confirmed only after the responsible office actually confirmed it. Otherwise keep it as a BetterGo reading aid. Never publish a machine translation as official.',
    })
  }),
)

adminTranslationsRouter.put(
  '/translations/services/:id',
  requirePermission('services.update'),
  validate(
    z.object({
      title: z.string().trim().min(3).max(200),
      summary: z.string().trim().max(2000).optional().or(z.literal('')),
      eligibility: z.string().trim().max(2000).optional().or(z.literal('')),
      requirements: z.string().trim().max(2000).optional().or(z.literal('')),
      fees: z.string().trim().max(500).optional().or(z.literal('')),
      procedure: z.string().trim().max(2000).optional().or(z.literal('')),
      notes: z.string().trim().max(1000).optional().or(z.literal('')),
      status: z.enum(['draft', 'office_confirmed']),
      source: z.string().trim().max(300).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const service = scoped(req, Number(req.params.id))
    if (!service) throw notFound('Service not found in your scope.')
    const existing = get(`SELECT id FROM service_translations WHERE service_id = ? AND language = 'fil'`, [service.id])
    const values = [
      cleanText(req.body.title, 200),
      cleanText(req.body.summary, 2000),
      cleanText(req.body.eligibility, 2000),
      cleanText(req.body.requirements, 2000),
      cleanText(req.body.fees, 500),
      cleanText(req.body.procedure, 2000),
      cleanText(req.body.notes, 1000),
      req.body.status,
      cleanText(req.body.source, 300),
      req.user.id,
      nowIso(),
    ]
    let id
    if (existing) {
      run(
        `UPDATE service_translations SET title=?, summary=?, eligibility=?, requirements=?, fees=?, procedure=?, notes=?, status=?, source=?, translated_by=?, updated_at=? WHERE id=?`,
        [...values, existing.id],
      )
      id = existing.id
    } else {
      id = Number(
        run(
          `INSERT INTO service_translations (title, summary, eligibility, requirements, fees, procedure, notes, status, source, translated_by, updated_at, service_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...values, service.id],
        ).lastInsertRowid,
      )
    }
    logAudit(req, { action: 'translation.saved', module: 'translations', entityType: 'service_translation', entityId: id })
    res.json({
      message: req.body.status === 'office_confirmed'
        ? 'Translation saved as confirmed by the responsible office.'
        : 'Translation saved as a BetterGo reading aid. It is clearly labelled until the office confirms it.',
      translation: shapeTranslation(get(
        `SELECT t.*, g.title AS service_title, g.slug AS service_slug FROM service_translations t JOIN government_services g ON g.id = t.service_id WHERE t.id = ?`,
        [id],
      )),
    })
  }),
)

adminTranslationsRouter.post(
  '/translations/requests/:id/decision',
  requirePermission('services.update'),
  validate(z.object({ decision: z.enum(['completed', 'declined']), note: z.string().trim().min(3).max(500) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM translation_requests WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Request not found.')
    if (!scoped(req, row.service_id)) throw notFound('Request not found in your scope.')
    if (row.status !== 'pending') throw unprocessable('Only a pending request can be decided.')
    if (req.body.decision === 'completed' && !get(`SELECT id FROM service_translations WHERE service_id = ? AND language = ?`, [row.service_id, row.language])) {
      throw unprocessable('Publish a translation for this service first; a request cannot be completed without one.')
    }
    run(`UPDATE translation_requests SET status = ?, response_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`, [
      req.body.decision,
      cleanText(req.body.note, 500),
      req.user.id,
      nowIso(),
      row.id,
    ])
    logAudit(req, { action: `translation.request_${req.body.decision}`, module: 'translations', entityType: 'translation_request', entityId: row.id })
    res.json({ message: req.body.decision === 'completed' ? 'Request marked completed.' : 'Request declined with a note.' })
  }),
)
