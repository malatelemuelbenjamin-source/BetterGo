/**
 * Offline and low-bandwidth access (Prompt 82).
 *
 * A pack is a frozen snapshot of published service information for printing or
 * reading without a connection. It is not a live government record and must be
 * re-checked before travelling or paying anything.
 */
import { Router } from 'express'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin } from '../rbac.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const today = () => new Date().toISOString().slice(0, 10)
const REFERENCE = () => `BG-PACK-${randomBytes(4).toString('hex').toUpperCase()}`

const parse = (value, fallback = []) => {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function serviceRows(ids) {
  if (!ids.length) return []
  return all(
    `SELECT g.id, g.title, g.slug, g.description, g.eligibility, g.requirements, g.fees,
            g.processing_time, g.application_procedure, g.official_link, g.source_reference,
            g.verification_status, g.municipality_id, m.name AS municipality_name
     FROM government_services g
     LEFT JOIN municipalities m ON m.id = g.municipality_id
     WHERE g.publication_status = 'published' AND g.id IN (${ids.map(() => '?').join(',')})
     ORDER BY g.title`,
    ids,
  )
}

function snapshotOf(row, capturedAt) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    municipality: row.municipality_name || 'Province-wide',
    description: row.description,
    eligibility: row.eligibility,
    requirements: row.requirements,
    fees: row.fees,
    processingTime: row.processing_time,
    procedure: row.application_procedure,
    officialLink: row.official_link,
    sourceReference: row.source_reference,
    verificationStatus: row.verification_status,
    capturedAt,
  }
}

function plainText(title, rows, capturedAt, expiresAt) {
  const lines = [
    title,
    `Captured ${capturedAt}${expiresAt ? ` · re-check after ${expiresAt}` : ''}`,
    'This is a BetterGo snapshot of published service information. It is not an official government record.',
    'Confirm details with the responsible office before travelling or paying any fee.',
    '',
  ]
  for (const row of rows) {
    lines.push(`## ${row.title} (${row.municipality})`)
    if (row.description) lines.push(row.description)
    if (row.requirements) lines.push(`Requirements as published: ${row.requirements}`)
    if (row.fees) lines.push(`Fees as published: ${row.fees}`)
    if (row.processingTime) lines.push(`Processing time as published: ${row.processingTime}`)
    if (row.procedure) lines.push(`How to request: ${row.procedure}`)
    if (row.officialLink) lines.push(`Office link: ${row.officialLink}`)
    lines.push(`Verification: ${row.verificationStatus || 'not recorded'}`, '')
  }
  return lines.join('\n')
}

function shape(row, includeSnapshot = false) {
  const ids = parse(row.service_ids)
  const expired = row.expires_at && row.expires_at < today()
  const changed = ids.length
    ? get(
        `SELECT COUNT(*) AS total FROM government_services WHERE id IN (${ids.map(() => '?').join(',')}) AND updated_at > ?`,
        [...ids, row.created_at],
      )?.total || 0
    : 0
  const base = {
    id: row.id,
    reference: row.reference,
    title: row.title,
    itemCount: row.item_count,
    status: expired ? 'expired' : row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    stale: changed > 0,
    staleServices: changed,
  }
  if (!includeSnapshot) return base
  const snapshot = parse(row.snapshot)
  return {
    ...base,
    snapshot,
    text: plainText(row.title, snapshot, row.created_at, row.expires_at),
    note: 'This snapshot only reflects what was published when it was created. Open the live service page for anything you plan to act on today.',
  }
}

export const offlineRouter = Router()
offlineRouter.use(requireAuth)

offlineRouter.get(
  '/offline-packs',
  asyncHandler(async (req, res) => {
    const rows = all(`SELECT * FROM service_info_packs WHERE user_id = ? ORDER BY id DESC LIMIT 30`, [req.user.id])
    res.json({
      packs: rows.map((row) => shape(row)),
      availableServices: all(
        `SELECT g.id, g.title, g.slug, m.name AS municipality_name
         FROM government_services g LEFT JOIN municipalities m ON m.id = g.municipality_id
         WHERE g.publication_status = 'published' ORDER BY g.title LIMIT 60`,
      ).map((row) => ({ id: row.id, title: row.title, municipality: row.municipality_name || 'Province-wide' })),
      note: 'Packs are snapshots you keep. They are not live records, are not sent anywhere, and must be re-checked before you act on them.',
    })
  }),
)

offlineRouter.post(
  '/offline-packs',
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 20 }),
  validate(
    z.object({
      title: z.string().trim().max(80).optional().or(z.literal('')),
      serviceIds: z.array(z.coerce.number().int().positive()).min(1).max(20),
      expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const ids = [...new Set(req.body.serviceIds)]
    const rows = serviceRows(ids)
    if (rows.length !== ids.length) throw unprocessable('One or more selected services are not published, so they cannot be included.')
    if (req.body.expiresAt && req.body.expiresAt < today()) throw unprocessable('The re-check date cannot be in the past.')
    const capturedAt = nowIso()
    const snapshot = rows.map((row) => snapshotOf(row, capturedAt))
    const title = cleanText(req.body.title, 80) || `Service information pack ${capturedAt.slice(0, 10)}`
    const id = Number(
      run(
        `INSERT INTO service_info_packs (reference, user_id, title, service_ids, snapshot, item_count, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [REFERENCE(), req.user.id, title, JSON.stringify(ids), JSON.stringify(snapshot), rows.length, req.body.expiresAt || null],
      ).lastInsertRowid,
    )
    logAudit(req, { action: 'offline.pack_created', module: 'offline', entityType: 'service_info_pack', entityId: id })
    res.status(201).json({
      message: 'Offline pack created. Keep it as a snapshot and re-check the live pages before acting.',
      pack: shape(get(`SELECT * FROM service_info_packs WHERE id = ?`, [id]), true),
    })
  }),
)

offlineRouter.get(
  '/offline-packs/:id',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM service_info_packs WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Offline pack not found.')
    res.json({ pack: shape(row, true) })
  }),
)

offlineRouter.delete(
  '/offline-packs/:id',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM service_info_packs WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Offline pack not found.')
    run(`DELETE FROM service_info_packs WHERE id = ?`, [row.id])
    logAudit(req, { action: 'offline.pack_deleted', module: 'offline', entityType: 'service_info_pack', entityId: row.id })
    res.json({ message: 'Offline pack removed.' })
  }),
)

/* -------------------------------- Admin --------------------------------- */

export const adminOfflineRouter = Router()
adminOfflineRouter.use(requireAuth, requireAdmin)

adminOfflineRouter.get(
  '/offline-packs',
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const scope = context.hasGlobalScope
      ? { sql: '', params: [] }
      : !context.municipalityIds.length
        ? { sql: 'WHERE 1 = 0', params: [] }
        : { sql: `WHERE p.municipality_id IN (${context.municipalityIds.map(() => '?').join(',')})`, params: context.municipalityIds }
    const rows = all(
      `SELECT k.id, k.item_count, k.expires_at, p.municipality_id, m.name AS municipality_name
       FROM service_info_packs k
       LEFT JOIN user_profiles p ON p.user_id = k.user_id
       LEFT JOIN municipalities m ON m.id = p.municipality_id
       ${scope.sql}`,
      scope.params,
    )
    const byMunicipality = new Map()
    for (const row of rows) {
      const key = row.municipality_name || 'Unassigned'
      byMunicipality.set(key, (byMunicipality.get(key) || 0) + 1)
    }
    res.json({
      summary: {
        packs: rows.length,
        expiredPacks: rows.filter((row) => row.expires_at && row.expires_at < today()).length,
        servicesCovered: rows.reduce((total, row) => total + Number(row.item_count || 0), 0),
      },
      byMunicipality: [...byMunicipality.entries()].map(([municipality, packs]) => ({ municipality, packs })),
      note: 'Counts are aggregate only; BetterGo never shows staff which services a resident saved offline. Packs are citizen snapshots, not official publications.',
    })
  }),
)
