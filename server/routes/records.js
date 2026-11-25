/**
 * Citizen digital records centre and administrative records management
 * (Prompt 67).
 *
 * The timeline is assembled from records that already exist for the account:
 * BetterGo application tracking, the personal document vault, saved services,
 * account security events, profile changes, privacy requests and consents.
 * Every query is filtered by the authenticated user id. Nothing is fabricated,
 * and no record is labelled as an official government record.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, badRequest, cleanText, forbidden, notFound, reference, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { APPLICATION_STATUSES } from '../lib/citizen.js'
import {
  ARCHIVABLE_RECORD_TYPES,
  DEFAULT_RETENTION,
  DISCLAIMER,
  PRIVACY_REQUEST_STATUSES,
  RECORD_CATEGORIES,
  RECORD_TYPES,
  recordsToCsv,
} from '../lib/records.js'

export const recordsRouter = Router()
recordsRouter.use(requireAuth)

const SAVED_LABELS = {
  service: 'Government service',
  office: 'Government office',
  announcement: 'Announcement',
  document: 'Public document',
}

const SAVED_PATHS = {
  service: (slug) => `/services/${slug}`,
  office: (slug) => `/government-offices/${slug}`,
  announcement: (slug) => `/announcements/${slug}`,
  document: (slug) => `/transparency/documents/${slug}`,
}

function savedTitle(row) {
  try {
    switch (row.content_type) {
      case 'service': {
        const found = get(`SELECT title, slug FROM government_services WHERE id = ?`, [row.content_id])
        return found ? { title: found.title, url: SAVED_PATHS.service(found.slug) } : null
      }
      case 'office': {
        const found = get(`SELECT name AS title, slug FROM government_offices WHERE id = ?`, [row.content_id])
        return found ? { title: found.title, url: SAVED_PATHS.office(found.slug) } : null
      }
      case 'announcement': {
        const found = get(`SELECT title, slug FROM announcements WHERE id = ?`, [row.content_id])
        return found ? { title: found.title, url: SAVED_PATHS.announcement(found.slug) } : null
      }
      case 'document': {
        const found = get(`SELECT title, slug FROM public_documents WHERE id = ?`, [row.content_id])
        return found ? { title: found.title, url: SAVED_PATHS.document(found.slug) } : null
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

function item({ key, type, title, description, occurredAt, reference: ref, url, status, municipalityName, serviceTitle, recordType, recordId }) {
  const meta = RECORD_TYPES[type] || { category: 'account', label: 'Account activity' }
  return {
    key,
    category: meta.category,
    type,
    typeLabel: meta.label,
    title,
    description: description || null,
    occurredAt,
    reference: ref || null,
    url: url || null,
    status: status || null,
    municipalityName: municipalityName || null,
    serviceTitle: serviceTitle || null,
    recordType: recordType || null,
    recordId: recordId || null,
    source: 'BetterGo platform record',
  }
}

/** Build every recorded event for one account. Bounded per source table. */
export function buildTimeline(userId) {
  const items = []

  const applications = all(
    `SELECT a.id, a.reference, a.status, a.submitted_at, a.created_at, a.withdrawn_at, a.closed_at, a.archived_at,
            a.submission_classification, m.name AS municipality_name, s.title AS service_title, s.slug AS service_slug
     FROM citizen_applications a
     LEFT JOIN municipalities m ON m.id = a.municipality_id
     LEFT JOIN government_services s ON s.id = a.service_id
     WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 500`,
    [userId],
  )
  const appById = new Map()
  for (const app of applications) {
    appById.set(Number(app.id), app)
    items.push(
      item({
        key: `application-${app.id}-submitted`,
        type: 'application_submitted',
        title: `Submitted ${app.reference}`,
        description: `${app.service_title || 'Government service'} · ${app.submission_classification === 'bettergo_intake' ? 'BetterGo intake' : 'BetterGo record'}`,
        occurredAt: app.submitted_at || app.created_at,
        reference: app.reference,
        url: `/dashboard/applications/${app.reference}`,
        status: APPLICATION_STATUSES[app.status] || app.status,
        municipalityName: app.municipality_name,
        serviceTitle: app.service_title,
        recordType: 'application',
        recordId: app.id,
      }),
    )
  }

  const appEvents = all(
    `SELECT e.id, e.application_id, e.from_status, e.to_status, e.note, e.created_at
     FROM citizen_application_events e JOIN citizen_applications a ON a.id = e.application_id
     WHERE a.user_id = ? AND e.citizen_visible = 1 ORDER BY e.id DESC LIMIT 800`,
    [userId],
  )
  for (const event of appEvents) {
    const app = appById.get(Number(event.application_id))
    if (!app) continue
    const isWithdraw = event.to_status === 'withdrawn'
    const isClosed = event.to_status === 'closed' || event.to_status === 'completed'
    items.push(
      item({
        key: `application-event-${event.id}`,
        type: isWithdraw ? 'application_withdrawn' : isClosed ? 'application_closed' : 'application_status',
        title: `Status: ${APPLICATION_STATUSES[event.to_status] || event.to_status}`,
        description: event.note || null,
        occurredAt: event.created_at,
        reference: app.reference,
        url: `/dashboard/applications/${app.reference}`,
        status: APPLICATION_STATUSES[event.to_status] || event.to_status,
        municipalityName: app.municipality_name,
        serviceTitle: app.service_title,
        recordType: 'application',
        recordId: app.id,
      }),
    )
  }

  const documentEvents = all(
    `SELECT e.id, e.document_id, e.event_type, e.detail, e.created_at, d.title, d.category, d.deleted_at
     FROM document_events e JOIN citizen_documents d ON d.id = e.document_id
     WHERE e.user_id = ? ORDER BY e.id DESC LIMIT 800`,
    [userId],
  )
  const docTypes = {
    uploaded: 'document_uploaded',
    replaced: 'document_replaced',
    deleted: 'document_deleted',
    accessed: 'document_accessed',
    shared: 'document_shared',
    share_revoked: 'document_shared',
    folder_changed: 'document_replaced',
  }
  for (const event of documentEvents) {
    items.push(
      item({
        key: `document-event-${event.id}`,
        type: docTypes[event.event_type] || 'document_uploaded',
        title: `${RECORD_TYPES[docTypes[event.event_type] || 'document_uploaded'].label}: ${event.title || 'Document'}`,
        description: event.detail || null,
        occurredAt: event.created_at,
        url: '/dashboard/documents',
        recordType: 'document',
        recordId: event.document_id,
      }),
    )
  }

  const saved = all(`SELECT id, content_type, content_id, created_at FROM saved_items WHERE user_id = ? ORDER BY id DESC LIMIT 400`, [userId])
  for (const row of saved) {
    const resolved = savedTitle(row)
    items.push(
      item({
        key: `saved-${row.id}`,
        type: 'saved_added',
        title: resolved?.title ? `Saved ${resolved.title}` : `Saved ${SAVED_LABELS[row.content_type] || 'record'}`,
        description: SAVED_LABELS[row.content_type] || null,
        occurredAt: row.created_at,
        url: resolved?.url || '/dashboard/saved',
      }),
    )
  }

  const security = all(`SELECT id, event_type, detail, created_at FROM account_security_events WHERE user_id = ? ORDER BY id DESC LIMIT 400`, [userId])
  for (const row of security) {
    items.push(
      item({
        key: `security-${row.id}`,
        type: 'security_event',
        title: String(row.event_type || 'Account security').replace(/_/g, ' '),
        description: row.detail || null,
        occurredAt: row.created_at,
        url: '/dashboard/account',
      }),
    )
  }

  const profileChanges = all(
    `SELECT id, field_category, changed_fields, outcome, created_at FROM profile_change_events WHERE user_id = ? ORDER BY id DESC LIMIT 400`,
    [userId],
  )
  for (const row of profileChanges) {
    const preference = ['preferences', 'dashboard_layout', 'personalization', 'notifications'].includes(row.field_category)
    items.push(
      item({
        key: `profile-${row.id}`,
        type: preference ? 'preference_change' : 'profile_change',
        title: `${String(row.field_category || 'profile').replace(/_/g, ' ')} updated`,
        description: row.changed_fields ? `Fields: ${row.changed_fields}${row.outcome && row.outcome !== 'success' ? ` (${row.outcome})` : ''}` : null,
        occurredAt: row.created_at,
        url: '/dashboard/account',
      }),
    )
  }

  const requests = all(
    `SELECT id, reference, category, status, description, resolution, created_at, updated_at FROM data_requests WHERE user_id = ? ORDER BY id DESC LIMIT 200`,
    [userId],
  )
  for (const row of requests) {
    items.push(
      item({
        key: `privacy-${row.id}-submitted`,
        type: 'privacy_request',
        title: `Privacy request ${row.reference}`,
        description: `${row.category} · ${PRIVACY_REQUEST_STATUSES[row.status] || row.status}`,
        occurredAt: row.created_at,
        reference: row.reference,
        url: '/dashboard/privacy/requests',
        status: PRIVACY_REQUEST_STATUSES[row.status] || row.status,
        recordType: 'privacy_request',
        recordId: row.id,
      }),
    )
  }
  const requestEvents = all(
    `SELECT e.id, e.request_id, e.to_status, e.note, e.created_at, r.reference
     FROM privacy_request_events e JOIN data_requests r ON r.id = e.request_id
     WHERE r.user_id = ? ORDER BY e.id DESC LIMIT 400`,
    [userId],
  )
  for (const event of requestEvents) {
    items.push(
      item({
        key: `privacy-event-${event.id}`,
        type: 'privacy_decision',
        title: `Privacy request ${PRIVACY_REQUEST_STATUSES[event.to_status] || event.to_status}`,
        description: event.note || null,
        occurredAt: event.created_at,
        reference: event.reference,
        url: '/dashboard/privacy/requests',
        status: PRIVACY_REQUEST_STATUSES[event.to_status] || event.to_status,
        recordType: 'privacy_request',
        recordId: event.request_id,
      }),
    )
  }

  const consents = all(
    `SELECT id, consent_category, status, policy_version, created_at, withdrawn_at FROM consent_records WHERE user_id = ? ORDER BY id DESC LIMIT 100`,
    [userId],
  )
  for (const row of consents) {
    items.push(
      item({
        key: `consent-${row.id}`,
        type: 'consent',
        title: `${String(row.consent_category).replace(/_/g, ' ')} consent ${row.status}`,
        description: row.policy_version ? `Policy version ${row.policy_version}` : null,
        occurredAt: row.withdrawn_at || row.created_at,
        url: '/dashboard/privacy',
        status: row.status,
      }),
    )
  }

  return items.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))
}

function filterTimeline(items, query) {
  const category = Object.keys(RECORD_CATEGORIES).includes(String(query.category)) ? String(query.category) : null
  const type = String(query.type || '')
  const status = cleanText(query.status, 80)
  const municipality = cleanText(query.municipality, 80)
  const service = cleanText(query.service, 160)
  const term = cleanText(query.q, 120)?.toLowerCase()
  const from = cleanText(query.from, 30)
  const to = cleanText(query.to, 30)

  return items.filter((row) => {
    if (category && row.category !== category) return false
    if (type && row.type !== type) return false
    if (status && String(row.status || '').toLowerCase() !== status.toLowerCase()) return false
    if (municipality && String(row.municipalityName || '').toLowerCase() !== municipality.toLowerCase()) return false
    if (service && !String(row.serviceTitle || '').toLowerCase().includes(service.toLowerCase())) return false
    if (from && String(row.occurredAt).slice(0, 10) < from) return false
    if (to && String(row.occurredAt).slice(0, 10) > to) return false
    if (term) {
      const haystack = [row.title, row.description, row.reference, row.serviceTitle, row.municipalityName, row.typeLabel]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(term)) return false
    }
    return true
  })
}

export function selectTimeline(userId, query) {
  const filtered = filterTimeline(buildTimeline(userId), query)
  const sort = query.sort === 'oldest' ? 'oldest' : 'newest'
  if (sort === 'oldest') filtered.reverse()
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 20))
  return {
    results: filtered.slice((page - 1) * limit, page * limit),
    total: filtered.length,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
    sort,
  }
}

recordsRouter.get(
  '/records',
  asyncHandler(async (req, res) => {
    const payload = selectTimeline(req.user.id, req.query)
    const allItems = buildTimeline(req.user.id)
    const counts = Object.fromEntries(Object.keys(RECORD_CATEGORIES).map((key) => [key, allItems.filter((row) => row.category === key).length]))
    const municipalities = [...new Set(allItems.map((row) => row.municipalityName).filter(Boolean))].sort()
    res.json({
      ...payload,
      counts,
      categories: Object.entries(RECORD_CATEGORIES).map(([key, label]) => ({ key, label, count: counts[key] })),
      types: Object.entries(RECORD_TYPES).map(([key, meta]) => ({ key, label: meta.label, category: meta.category })),
      municipalities,
      disclaimer: DISCLAIMER,
    })
  }),
)

recordsRouter.get(
  '/records/categories',
  asyncHandler(async (_req, res) => {
    res.json({
      categories: Object.entries(RECORD_CATEGORIES).map(([key, label]) => ({ key, label })),
      types: Object.entries(RECORD_TYPES).map(([key, meta]) => ({ key, label: meta.label, category: meta.category })),
      disclaimer: DISCLAIMER,
    })
  }),
)

recordsRouter.get(
  '/records/export',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }),
  asyncHandler(async (req, res) => {
    const format = ['csv', 'json'].includes(String(req.query.format)) ? String(req.query.format) : 'csv'
    const items = filterTimeline(buildTimeline(req.user.id), { ...req.query, page: 1, limit: 100000 })
    const generatedAt = nowIso()
    run(`INSERT INTO data_exports (user_id, expires_at) VALUES (?, ?)`, [
      req.user.id,
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ])
    logAudit(req, { action: 'records.exported', module: 'records', entityType: 'user', entityId: req.user.id, newValues: { format, records: items.length } })
    const filename = `bettergo-activity-${req.user.id}-${generatedAt.slice(0, 10)}`
    res.setHeader('Cache-Control', 'no-store')
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`)
      return res.send(
        `# BetterGo Marinduque activity summary\n# Generated ${generatedAt}. ${DISCLAIMER}\n${recordsToCsv(items)}`,
      )
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`)
    res.send(
      JSON.stringify(
        {
          generatedAt,
          platform: 'BetterGo Marinduque',
          disclaimer: DISCLAIMER,
          counts: { total: items.length },
          records: items,
        },
        null,
        2,
      ),
    )
  }),
)

recordsRouter.get(
  '/records/retention',
  asyncHandler(async (req, res) => {
    const policies = all(`SELECT record_type, retention_days, description, updated_at FROM retention_policies ORDER BY record_type`)
    const known = new Map(policies.map((row) => [row.record_type, row]))
    res.json({
      policies: DEFAULT_RETENTION.map((entry) => {
        const stored = known.get(entry.recordType)
        return {
          recordType: entry.recordType,
          description: stored?.description || entry.description,
          retentionDays: stored?.retention_days ?? null,
          configured: Boolean(stored),
        }
      }),
      archivedApplications: all(
        `SELECT reference, archived_at FROM citizen_applications WHERE user_id = ? AND archived_at IS NOT NULL ORDER BY id DESC`,
        [req.user.id],
      ),
      note: 'Records with no configured retention period are kept until you ask for deletion or the platform closes your account. Active application records are never deleted automatically.',
    })
  }),
)

recordsRouter.get(
  '/records/:type/:id',
  asyncHandler(async (req, res) => {
    const type = String(req.params.type)
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw notFound('Record not found.')

    if (type === 'application') {
      const row = get(
        `SELECT a.*, m.name AS municipality_name, s.title AS service_title, s.slug AS service_slug
         FROM citizen_applications a
         LEFT JOIN municipalities m ON m.id = a.municipality_id
         LEFT JOIN government_services s ON s.id = a.service_id
         WHERE a.id = ? AND a.user_id = ?`,
        [id, req.user.id],
      )
      if (!row) throw notFound('Record not found.')
      const history = all(
        `SELECT from_status, to_status, note, created_at FROM citizen_application_events
         WHERE application_id = ? AND citizen_visible = 1 ORDER BY id ASC`,
        [id],
      )
      return res.json({
        record: {
          type: 'application',
          reference: row.reference,
          serviceTitle: row.service_title,
          municipalityName: row.municipality_name,
          status: APPLICATION_STATUSES[row.status] || row.status,
          statusKey: row.status,
          submittedAt: row.submitted_at,
          createdAt: row.created_at,
          classification: row.submission_classification,
          archivedAt: row.archived_at,
          url: `/dashboard/applications/${row.reference}`,
          history: history.map((event) => ({ ...event, label: APPLICATION_STATUSES[event.to_status] || event.to_status })),
        },
        disclaimer: DISCLAIMER,
      })
    }

    if (type === 'document') {
      const row = get(
        `SELECT id, title, category, original_filename, mime_type, file_size, version, status, expires_at, created_at, deleted_at
         FROM citizen_documents WHERE id = ? AND user_id = ?`,
        [id, req.user.id],
      )
      if (!row) throw notFound('Record not found.')
      const events = all(
        `SELECT event_type, detail, created_at FROM document_events WHERE document_id = ? AND user_id = ? ORDER BY id ASC LIMIT 100`,
        [id, req.user.id],
      )
      return res.json({
        record: { type: 'document', ...row, url: '/dashboard/documents', events },
        disclaimer: DISCLAIMER,
      })
    }

    if (type === 'privacy_request') {
      const row = get(`SELECT * FROM data_requests WHERE id = ? AND user_id = ?`, [id, req.user.id])
      if (!row) throw notFound('Record not found.')
      const events = all(`SELECT from_status, to_status, note, created_at FROM privacy_request_events WHERE request_id = ? ORDER BY id ASC`, [id])
      return res.json({
        record: {
          type: 'privacy_request',
          reference: row.reference,
          category: row.category,
          status: PRIVACY_REQUEST_STATUSES[row.status] || row.status,
          statusKey: row.status,
          description: row.description,
          resolution: row.resolution,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          url: '/dashboard/privacy/requests',
          history: events.map((event) => ({ ...event, label: PRIVACY_REQUEST_STATUSES[event.to_status] || event.to_status })),
        },
        disclaimer: 'Privacy request statuses describe the BetterGo request workflow only. They are not government decisions.',
      })
    }

    throw notFound('Record not found.')
  }),
)

/* Submission receipt. Confirms BetterGo intake only; no government filing. */
recordsRouter.get(
  '/applications/:reference/receipt',
  asyncHandler(async (req, res) => {
    const row = get(
      `SELECT a.*, m.name AS municipality_name, s.title AS service_title
       FROM citizen_applications a
       LEFT JOIN municipalities m ON m.id = a.municipality_id
       LEFT JOIN government_services s ON s.id = a.service_id
       WHERE a.reference = ? AND a.user_id = ?`,
      [String(req.params.reference), req.user.id],
    )
    if (!row) throw notFound('Application record not found.')
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      receipt: {
        reference: row.reference,
        serviceTitle: row.service_title,
        municipalityName: row.municipality_name,
        submittedAt: row.submitted_at || row.created_at,
        classification: row.submission_classification,
        accountReference: `BetterGo account #${req.user.id}`,
        confirmation: 'Submission recorded on the BetterGo platform.',
        externalReference: row.external_reference || null,
        disclaimer:
          'This receipt confirms submission to the BetterGo platform only. It is not proof of official government filing, acceptance, approval, or processing.',
      },
      platform: 'BetterGo Marinduque',
    })
  }),
)

/* -------------------------------------------------------------------------
 * Citizen privacy request tracking (Prompt 67 §10), building on the existing
 * data_requests workflow rather than creating a second request system.
 * ---------------------------------------------------------------------- */

/* -------------------------------------------------------------------------
 * Administrative records management (Prompt 67 §13)
 * ---------------------------------------------------------------------- */
export const adminRecordsRouter = Router()
adminRecordsRouter.use(requireAuth, requireAdmin)

function scopeFor(req) {
  const context = ctx(req)
  return {
    context,
    global: Boolean(context.hasGlobalScope),
    municipalityIds: context.municipalityIds || [],
  }
}

adminRecordsRouter.get(
  '/records',
  asyncHandler(async (req, res) => {
    const term = cleanText(req.query.q, 120)
    const { global, municipalityIds } = scopeFor(req)
    const params = []
    let where = '1=1'
    if (!global) {
      where += municipalityIds.length ? ` AND a.municipality_id IN (${municipalityIds.map(() => '?').join(',')})` : ' AND 0'
      params.push(...municipalityIds)
    }
    if (term) {
      where += ' AND (a.reference LIKE ? OR s.title LIKE ?)'
      params.push(`%${term}%`, `%${term}%`)
    }
    const rows = all(
      `SELECT a.id, a.reference, a.status, a.submitted_at, a.created_at, a.archived_at, a.submission_classification,
              m.name AS municipality_name, s.title AS service_title, u.email AS citizen_email
       FROM citizen_applications a
       LEFT JOIN municipalities m ON m.id = a.municipality_id
       LEFT JOIN government_services s ON s.id = a.service_id
       LEFT JOIN users u ON u.id = a.user_id
       WHERE ${where} ORDER BY a.id DESC LIMIT 100`,
      params,
    )
    res.json({ results: rows, note: 'Records are shown within your municipality scope only.' })
  }),
)

adminRecordsRouter.get(
  '/records/retention',
  asyncHandler(async (req, res) => {
    const { global } = scopeFor(req)
    if (!global) throw forbidden('Retention policies are province-wide settings.')
    const stored = all(`SELECT * FROM retention_policies ORDER BY record_type`)
    const known = new Map(stored.map((row) => [row.record_type, row]))
    res.json({
      policies: DEFAULT_RETENTION.map((entry) => {
        const row = known.get(entry.recordType)
        return {
          recordType: entry.recordType,
          description: row?.description || entry.description,
          retentionDays: row?.retention_days ?? null,
          updatedAt: row?.updated_at || null,
        }
      }),
      activeApplications: Number(get(`SELECT COUNT(*) AS n FROM citizen_applications WHERE archived_at IS NULL`).n),
      note: 'A blank retention period means no automatic deletion. Active application records are protected from automatic archival.',
    })
  }),
)

adminRecordsRouter.put(
  '/records/retention',
  validate(
    z.object({
      recordType: z.enum(DEFAULT_RETENTION.map((entry) => entry.recordType)),
      retentionDays: z.union([z.coerce.number().int().min(30).max(36500), z.null()]),
      description: z.string().trim().max(200).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { global } = scopeFor(req)
    if (!global) throw forbidden('Retention policies are province-wide settings.')
    const existing = get(`SELECT * FROM retention_policies WHERE record_type = ?`, [req.body.recordType])
    if (existing) {
      run(`UPDATE retention_policies SET retention_days = ?, description = ?, updated_by = ?, updated_at = ? WHERE id = ?`, [
        req.body.retentionDays,
        req.body.description ?? existing.description,
        req.user.id,
        nowIso(),
        existing.id,
      ])
    } else {
      run(`INSERT INTO retention_policies (record_type, retention_days, description, updated_by) VALUES (?, ?, ?, ?)`, [
        req.body.recordType,
        req.body.retentionDays,
        req.body.description || null,
        req.user.id,
      ])
    }
    logAudit(req, { action: 'records.retention_updated', module: 'records', entityType: 'retention_policy', entityId: req.body.recordType, newValues: { retentionDays: req.body.retentionDays } })
    res.json({ message: 'Retention policy saved.', recordType: req.body.recordType, retentionDays: req.body.retentionDays })
  }),
)

adminRecordsRouter.get(
  '/records/privacy-requests',
  requirePermission('privacy.requests.manage'),
  asyncHandler(async (req, res) => {
    const status = PRIVACY_REQUEST_STATUSES[String(req.query.status)] ? String(req.query.status) : null
    const { global, municipalityIds } = scopeFor(req)
    const params = []
    let where = '1=1'
    if (!global) {
      where += municipalityIds.length
        ? ` AND p.municipality_id IN (${municipalityIds.map(() => '?').join(',')})`
        : ' AND 0'
      params.push(...municipalityIds)
    }
    if (status) {
      where += ' AND r.status = ?'
      params.push(status)
    }
    const rows = all(
      `SELECT r.id, r.reference, r.category, r.status, r.description, r.resolution, r.created_at, r.updated_at,
              u.email AS citizen_email
       FROM data_requests r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN user_profiles p ON p.user_id = r.user_id
       WHERE ${where} ORDER BY r.id DESC LIMIT 100`,
      params,
    )
    res.json({
      results: rows.map((row) => ({ ...row, statusLabel: PRIVACY_REQUEST_STATUSES[row.status] || row.status })),
      statuses: PRIVACY_REQUEST_STATUSES,
    })
  }),
)

adminRecordsRouter.patch(
  '/records/privacy-requests/:reference',
  requirePermission('privacy.requests.manage'),
  validate(
    z.object({
      status: z.enum(Object.keys(PRIVACY_REQUEST_STATUSES)),
      note: z.string().trim().max(2000).optional(),
      resolution: z.string().trim().max(2000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM data_requests WHERE reference = ?`, [String(req.params.reference)])
    if (!row) throw notFound('Privacy request not found.')
    const profile = row.user_id ? get(`SELECT municipality_id FROM user_profiles WHERE user_id = ?`, [row.user_id]) : null
    const { context } = scopeFor(req)
    if (!context.hasGlobalScope && !(profile?.municipality_id && canUseMunicipality(context, profile.municipality_id))) {
      throw notFound('Privacy request not found.')
    }
    if (row.status === 'completed' || row.status === 'rejected') {
      throw unprocessable('A closed privacy request cannot be reopened here; ask the citizen to submit a new request.')
    }
    if (req.body.status === 'rejected' && !req.body.resolution) {
      throw badRequest('Explain why the request is rejected.', [{ field: 'resolution', message: 'A reason is required.' }])
    }
    run(`UPDATE data_requests SET status = ?, resolution = COALESCE(?, resolution), review_notes = COALESCE(?, review_notes), updated_at = ?, resolved_at = CASE WHEN ? IN ('completed','rejected') THEN ? ELSE resolved_at END WHERE id = ?`, [
      req.body.status,
      cleanText(req.body.resolution, 2000),
      cleanText(req.body.note, 2000),
      nowIso(),
      req.body.status,
      nowIso(),
      row.id,
    ])
    run(`INSERT INTO privacy_request_events (request_id, from_status, to_status, note, actor_id) VALUES (?, ?, ?, ?, ?)`, [
      row.id,
      row.status,
      req.body.status,
      cleanText(req.body.resolution || req.body.note, 2000),
      req.user.id,
    ])
    logAudit(req, { action: 'records.privacy_request_updated', module: 'privacy', entityType: 'data_request', entityId: row.reference, oldValues: { status: row.status }, newValues: { status: req.body.status } })
    res.json({ message: 'Privacy request updated.', status: req.body.status, statusLabel: PRIVACY_REQUEST_STATUSES[req.body.status] })
  }),
)

adminRecordsRouter.post(
  '/records/:recordType/:id/archive',
  validate(z.object({ reason: z.string().trim().min(3).max(500) })),
  asyncHandler(async (req, res) => {
    const recordType = String(req.params.recordType)
    if (!ARCHIVABLE_RECORD_TYPES.includes(recordType)) throw badRequest('That record type cannot be archived.')
    if (recordType !== 'application') {
      throw unprocessable('Only BetterGo application records are archived from this screen. Documents and privacy requests follow their own workflows.')
    }
    const id = Number(req.params.id)
    const row = get(`SELECT * FROM citizen_applications WHERE id = ?`, [id])
    if (!row) throw notFound('Record not found.')
    const { context } = scopeFor(req)
    if (!context.hasGlobalScope && !(row.municipality_id && canUseMunicipality(context, row.municipality_id))) throw notFound('Record not found.')
    if (['submitted', 'in_review', 'awaiting_citizen', 'resubmitted'].includes(row.status)) {
      throw unprocessable('An active application record cannot be archived. Close or withdraw it first.')
    }
    if (row.archived_at) throw unprocessable('That record is already archived.')
    run(`UPDATE citizen_applications SET archived_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), id])
    run(`INSERT INTO record_archive_events (record_type, record_id, user_id, action, reason, actor_id) VALUES ('application', ?, ?, 'archived', ?, ?)`, [
      id,
      row.user_id,
      cleanText(req.body.reason, 500),
      req.user.id,
    ])
    logAudit(req, { action: 'records.application_archived', module: 'records', entityType: 'application', entityId: row.reference, newValues: { reason: req.body.reason }, municipalityId: row.municipality_id })
    res.json({ message: 'Record archived. The audit history is preserved and the citizen can still see the record in their archive.' })
  }),
)

adminRecordsRouter.post(
  '/records/:recordType/:id/restore',
  asyncHandler(async (req, res) => {
    if (String(req.params.recordType) !== 'application') throw badRequest('That record type cannot be restored here.')
    const id = Number(req.params.id)
    const row = get(`SELECT * FROM citizen_applications WHERE id = ?`, [id])
    if (!row) throw notFound('Record not found.')
    const { context } = scopeFor(req)
    if (!context.hasGlobalScope && !(row.municipality_id && canUseMunicipality(context, row.municipality_id))) throw notFound('Record not found.')
    if (!row.archived_at) throw unprocessable('That record is not archived.')
    run(`UPDATE citizen_applications SET archived_at = NULL, updated_at = ? WHERE id = ?`, [nowIso(), id])
    run(`INSERT INTO record_archive_events (record_type, record_id, user_id, action, reason, actor_id) VALUES ('application', ?, ?, 'restored', 'Restored by administrator', ?)`, [
      id,
      row.user_id,
      req.user.id,
    ])
    logAudit(req, { action: 'records.application_restored', module: 'records', entityType: 'application', entityId: row.reference, municipalityId: row.municipality_id })
    res.json({ message: 'Record restored to the active list.' })
  }),
)

adminRecordsRouter.get(
  '/records/:recordType/:id/history',
  asyncHandler(async (req, res) => {
    const recordType = String(req.params.recordType)
    const id = Number(req.params.id)
    if (recordType === 'application') {
      const row = get(`SELECT * FROM citizen_applications WHERE id = ?`, [id])
      if (!row) throw notFound('Record not found.')
      const { context } = scopeFor(req)
      if (!context.hasGlobalScope && !(row.municipality_id && canUseMunicipality(context, row.municipality_id))) throw notFound('Record not found.')
      return res.json({
        events: all(
          `SELECT from_status, to_status, citizen_visible, note, created_at FROM citizen_application_events WHERE application_id = ? ORDER BY id ASC`,
          [id],
        ),
        archiveEvents: all(`SELECT action, reason, created_at FROM record_archive_events WHERE record_type = 'application' AND record_id = ? ORDER BY id ASC`, [id]),
      })
    }
    throw notFound('Record not found.')
  }),
)
