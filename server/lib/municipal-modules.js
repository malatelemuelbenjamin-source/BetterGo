/**
 * Municipal portal modules (Phase 3, Prompts 44–56).
 *
 * Cross-municipality queries for projects, programs, resources, FAQs, the
 * office directory and map, discovery search, feedback, subscriptions and
 * privacy-preserving analytics.
 *
 * Every public query here is restricted to published records. Verification is
 * reported alongside the record; it is never implied by publication.
 */
import { all, get, nowIso, run } from '../db.js'
import { badRequest, notFound } from './http.js'
import {
  CONTENT_COLUMNS,
  MUNICIPAL_CONTENT_PUBLISHED,
  municipalityBySlug,
  OFFICE_COLUMNS,
  publicMunicipality,
} from './municipal.js'

export const PROJECT_STATUSES = {
  proposed: 'Proposed',
  planned: 'Planned',
  approved: 'Approved',
  scheduled: 'Scheduled',
  ongoing: 'Ongoing',
  suspended: 'Temporarily suspended',
  completed: 'Completed',
  cancelled: 'Cancelled',
  archived: 'Archived',
}

export const APPLICATION_STATUSES = {
  open: 'Applications are open',
  closed: 'Applications are closed',
  by_office: 'Apply at the responsible office',
  not_stated: 'Application details have not been published',
}

export const CONTENT_PRIORITIES = {
  normal: 'Normal',
  important: 'Important',
  urgent: 'Urgent',
}

export const FEEDBACK_KINDS = {
  correction: 'Incorrect or outdated information',
  missing: 'Missing information',
  suggestion: 'Suggestion',
  concern: 'Concern',
}

export const SUBSCRIPTION_TOPICS = {
  announcements: 'Announcements and advisories',
  news: 'News and public notices',
  projects: 'Projects and progress updates',
  programs: 'Programs and community initiatives',
  resources: 'New public resources',
}

export const RESOURCE_TYPES = {
  pdf: 'PDF document',
  form: 'Downloadable form',
  image: 'Public image',
  guide: 'Informational guide',
  external: 'External official link',
}

const BASE_FROM = `FROM municipal_content c
  JOIN municipalities m ON m.id = c.municipality_id
  LEFT JOIN government_offices o ON o.id = c.office_id`

const PUBLIC_MUNICIPALITY = `m.is_active = 1 AND m.publication_status = 'published'`

function contentWhere({ type, municipality, q, status, office, featured, pinned, upcoming, priority } = {}) {
  const params = []
  let where = `${MUNICIPAL_CONTENT_PUBLISHED} AND ${PUBLIC_MUNICIPALITY}`
  if (type) {
    where += ' AND c.content_type = ?'
    params.push(String(type))
  }
  if (municipality) {
    where += ' AND m.slug = ?'
    params.push(String(municipality))
  }
  if (office) {
    where += ' AND o.slug = ?'
    params.push(String(office))
  }
  if (status) {
    where += " AND COALESCE(NULLIF(c.project_status,''), 'proposed') = ?"
    params.push(String(status))
  }
  if (priority) {
    where += ' AND c.priority = ?'
    params.push(String(priority))
  }
  if (featured) where += ' AND c.is_featured = 1'
  if (pinned) where += ' AND c.pinned = 1'
  if (upcoming) {
    where += " AND c.event_start IS NOT NULL AND datetime(c.event_start) >= datetime('now')"
  }
  if (q) {
    where += ` AND (lower(c.title) LIKE ? OR lower(COALESCE(c.summary,'')) LIKE ?
      OR lower(COALESCE(c.body,'')) LIKE ? OR lower(COALESCE(c.beneficiaries,'')) LIKE ?)`
    const like = `%${String(q).toLowerCase().slice(0, 120)}%`
    params.push(like, like, like, like)
  }
  return { where, params }
}

function paginate({ page = 1, limit = 12 } = {}) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 12))
  const safePage = Math.max(1, Number(page) || 1)
  return { safeLimit, safePage, offset: (safePage - 1) * safeLimit }
}

/** Paginated published municipal content of one type across any municipality. */
export function municipalContentFeed(options = {}) {
  const { where, params } = contentWhere(options)
  const { safeLimit, safePage, offset } = paginate(options)
  const sort = options.sort === 'updated'
    ? 'COALESCE(c.progress_updated_at, c.updated_at) DESC'
    : options.sort === 'event'
      ? "CASE WHEN c.event_start IS NULL THEN 1 ELSE 0 END, c.event_start"
      : 'c.pinned DESC, c.is_featured DESC, COALESCE(c.published_at, c.created_at) DESC'
  const total = Number(get(`SELECT COUNT(*) AS total ${BASE_FROM} WHERE ${where}`, params).total || 0)
  const results = all(
    `SELECT ${CONTENT_COLUMNS}, m.name AS municipality_name, m.slug AS municipality_slug,
            o.name AS office_name, o.slug AS office_slug
     ${BASE_FROM} WHERE ${where}
     ORDER BY ${sort} LIMIT ? OFFSET ?`,
    [...params, safeLimit, offset],
  )
  return {
    results,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  }
}

/** Published project or program plus its public update stream. */
export function municipalProjectDetail(municipalitySlug, projectSlug) {
  const municipality = municipalityBySlug(municipalitySlug)
  const record = get(
    `SELECT ${CONTENT_COLUMNS}, m.name AS municipality_name, m.slug AS municipality_slug,
            o.name AS office_name, o.slug AS office_slug, o.phone AS office_phone,
            o.email AS office_email, o.address AS office_address
     FROM municipal_content c
     JOIN municipalities m ON m.id = c.municipality_id
     LEFT JOIN government_offices o ON o.id = c.office_id
     WHERE c.municipality_id = ? AND c.slug = ? AND c.content_type IN ('project','program')
       AND ${MUNICIPAL_CONTENT_PUBLISHED}`,
    [municipality.id, String(projectSlug || '')],
  )
  if (!record) throw notFound('Project not found.')
  const updates = all(
    `SELECT id, update_type, title, description, reported_on, progress_percent,
            source_reference, source_url, created_at
     FROM municipal_content_updates
     WHERE content_id = ? AND publication_status = 'published'
     ORDER BY COALESCE(reported_on, created_at) DESC LIMIT 20`,
    [record.id],
  )
  const related = all(
    `SELECT ${CONTENT_COLUMNS} FROM municipal_content c
     WHERE c.municipality_id = ? AND c.content_type = ? AND c.id <> ? AND ${MUNICIPAL_CONTENT_PUBLISHED}
     ORDER BY COALESCE(c.published_at, c.created_at) DESC LIMIT 4`,
    [municipality.id, record.content_type, record.id],
  )
  const services = all(
    `SELECT s.id, s.title, s.slug FROM government_services s
     WHERE s.publication_status = 'published' AND s.municipality_id = ?
     ORDER BY s.title LIMIT 5`,
    [municipality.id],
  )
  return { municipality: publicMunicipality(municipality), record, updates, related, services }
}

/** Published office directory, optionally for one municipality, with map markers. */
export function municipalOfficeDirectory({ municipality = null, q = '', level = null, limit = 100 } = {}) {
  const params = []
  let where = `o.publication_status = 'published'`
  if (municipality) {
    const record = municipalityBySlug(municipality)
    where += ` AND (o.municipality_id = ? OR EXISTS (
      SELECT 1 FROM office_municipalities om WHERE om.office_id = o.id AND om.municipality_id = ?))`
    params.push(record.id, record.id)
  }
  if (level) {
    where += ' AND o.office_level = ?'
    params.push(String(level))
  }
  if (q) {
    where += ` AND (lower(o.name) LIKE ? OR lower(COALESCE(o.description,'')) LIKE ?
      OR lower(COALESCE(o.responsibilities,'')) LIKE ?)`
    const like = `%${String(q).toLowerCase().slice(0, 120)}%`
    params.push(like, like, like)
  }
  const results = all(
    `SELECT ${OFFICE_COLUMNS}, m.name AS municipality_name, m.slug AS municipality_slug
     FROM government_offices o
     LEFT JOIN government_offices p ON p.id = o.parent_office_id
     LEFT JOIN municipalities m ON m.id = o.municipality_id
     WHERE ${where}
     ORDER BY o.office_level = 'department' DESC, o.name LIMIT ?`,
    [...params, Math.min(200, Math.max(1, Number(limit) || 100))],
  )
  // Coordinates are exposed only when an administrator has verified them.
  const markers = results
    .filter((row) => row.location_verified === 1 && Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude)))
    .map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      municipality: row.municipality_name,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      address: row.address,
      phone: row.phone,
    }))
  return { results, markers, total: results.length }
}

/** Published FAQs across the portal, grouped by municipality. */
export function municipalFaqs({ municipality = null, q = '', limit = 60 } = {}) {
  const { where, params } = contentWhere({ type: 'faq', municipality, q })
  const rows = all(
    `SELECT ${CONTENT_COLUMNS}, m.name AS municipality_name, m.slug AS municipality_slug
     ${BASE_FROM} WHERE ${where} ORDER BY m.name, c.sort_order, c.title LIMIT ?`,
    [...params, Math.min(100, Math.max(1, Number(limit) || 60))],
  )
  return rows
}

/** Public resource center: published municipal resource records and public documents. */
export function municipalResourceCenter({ municipality = null, category = null, q = '', limit = 40 } = {}) {
  const contentOptions = { type: 'resource', municipality, q }
  const { where, params } = contentWhere(contentOptions)
  const content = all(
    `SELECT ${CONTENT_COLUMNS}, m.name AS municipality_name, m.slug AS municipality_slug,
            'content' AS source_kind
     ${BASE_FROM} WHERE ${where}
     ORDER BY COALESCE(c.published_at, c.created_at) DESC LIMIT ?`,
    [...params, Math.min(60, Number(limit) || 40)],
  )

  const docParams = []
  let docWhere = `d.publication_status = 'published'`
  if (municipality) {
    docWhere += ' AND m.slug = ?'
    docParams.push(String(municipality))
  }
  if (category) {
    docWhere += ' AND d.document_category = ?'
    docParams.push(String(category))
  }
  if (q) {
    docWhere += ` AND (lower(d.title) LIKE ? OR lower(COALESCE(d.description,'')) LIKE ?)`
    const like = `%${String(q).toLowerCase().slice(0, 120)}%`
    docParams.push(like, like)
  }
  const documents = all(
    `SELECT d.id, d.title, d.slug, d.description, d.document_category, d.resource_type,
            d.file_name, d.file_type, d.file_size, d.external_url, d.source_url, d.version,
            d.publication_date, d.review_date, d.verification_status, d.municipality_id,
            m.name AS municipality_name, m.slug AS municipality_slug, 'document' AS source_kind
     FROM public_documents d
     LEFT JOIN municipalities m ON m.id = d.municipality_id
     WHERE ${docWhere}
     ORDER BY COALESCE(d.publication_date, d.created_at) DESC LIMIT ?`,
    [...docParams, Math.min(60, Number(limit) || 40)],
  )

  const categories = all(
    `SELECT document_category AS value, COUNT(*) AS total FROM public_documents
     WHERE publication_status = 'published' GROUP BY document_category ORDER BY document_category`,
  )
  return { results: [...documents, ...content], documents, content, categories }
}

/**
 * Cross-municipality discovery (Prompt 55): one published-only search over
 * municipal updates, offices, services and resources.
 */
export function municipalDiscovery({ q = '', municipality = null, limit = 8 } = {}) {
  const term = String(q || '').trim().slice(0, 100)
  if (!term) throw badRequest('Enter a search term.')
  const like = `%${term.toLowerCase()}%`
  const municipalityId = municipality ? municipalityBySlug(municipality).id : null
  const scope = municipalityId ? ' AND c.municipality_id = ?' : ''
  const scopeParams = municipalityId ? [municipalityId] : []

  const updates = all(
    `SELECT ${CONTENT_COLUMNS}, m.name AS municipality_name, m.slug AS municipality_slug
     FROM municipal_content c JOIN municipalities m ON m.id = c.municipality_id
     WHERE ${MUNICIPAL_CONTENT_PUBLISHED} AND ${PUBLIC_MUNICIPALITY}${scope}
       AND (lower(c.title) LIKE ? OR lower(COALESCE(c.summary,'')) LIKE ? OR lower(COALESCE(c.body,'')) LIKE ?)
     ORDER BY COALESCE(c.published_at, c.created_at) DESC LIMIT ?`,
    [...scopeParams, like, like, like, limit],
  )
  const officeScope = municipalityId ? ' AND o.municipality_id = ?' : ''
  const offices = all(
    `SELECT ${OFFICE_COLUMNS}, m.name AS municipality_name, m.slug AS municipality_slug
     FROM government_offices o
     LEFT JOIN government_offices p ON p.id = o.parent_office_id
     LEFT JOIN municipalities m ON m.id = o.municipality_id
     WHERE o.publication_status = 'published'${officeScope}
       AND (lower(o.name) LIKE ? OR lower(COALESCE(o.description,'')) LIKE ?)
     ORDER BY o.name LIMIT ?`,
    [...(municipalityId ? [municipalityId] : []), like, like, limit],
  )
  const serviceScope = municipalityId
    ? " AND (s.municipality_id = ? OR s.coverage_type = 'province_wide')"
    : ''
  const services = all(
    `SELECT s.id, s.title, s.slug, s.short_description, s.verification_status, m.name AS municipality_name
     FROM government_services s LEFT JOIN municipalities m ON m.id = s.municipality_id
     WHERE s.publication_status = 'published'${serviceScope}
       AND (lower(s.title) LIKE ? OR lower(COALESCE(s.short_description,'')) LIKE ?)
     ORDER BY s.title LIMIT ?`,
    [...(municipalityId ? [municipalityId] : []), like, like, limit],
  )
  const docScope = municipalityId ? ' AND d.municipality_id = ?' : ''
  const documents = all(
    `SELECT d.id, d.title, d.slug, d.document_category, d.verification_status, m.name AS municipality_name
     FROM public_documents d LEFT JOIN municipalities m ON m.id = d.municipality_id
     WHERE d.publication_status = 'published'${docScope}
       AND (lower(d.title) LIKE ? OR lower(COALESCE(d.description,'')) LIKE ?)
     ORDER BY d.title LIMIT ?`,
    [...(municipalityId ? [municipalityId] : []), like, like, limit],
  )
  if (municipalityId) recordPortalMetric(municipalityId, 'search')
  return {
    query: term,
    municipality: municipality || null,
    total: updates.length + offices.length + services.length + documents.length,
    groups: { updates, offices, services, documents },
  }
}

/* -------------------------------- Analytics ------------------------------- */

/** Increment a daily aggregate counter. No visitor identifiers are stored. */
export function recordPortalMetric(municipalityId, metric) {
  if (!municipalityId || !metric) return
  const day = nowIso().slice(0, 10)
  run(
    `INSERT INTO municipal_analytics (municipality_id, metric, day, total) VALUES (?, ?, ?, 1)
     ON CONFLICT (municipality_id, metric, day) DO UPDATE SET total = total + 1`,
    [Number(municipalityId), String(metric).slice(0, 40), day],
  )
}

/** Aggregated portal metrics for the municipal workspace. */
export function portalAnalytics(municipalityId, days = 30) {
  const safeDays = Math.min(365, Math.max(1, Number(days) || 30))
  const rows = all(
    `SELECT metric, day, total FROM municipal_analytics
     WHERE municipality_id = ? AND day >= date('now', ?) ORDER BY day`,
    [Number(municipalityId), `-${safeDays} days`],
  )
  const totals = {}
  const series = {}
  for (const row of rows) {
    totals[row.metric] = (totals[row.metric] || 0) + Number(row.total)
    series[row.metric] = series[row.metric] || []
    series[row.metric].push({ day: row.day, total: Number(row.total) })
  }
  return {
    days: safeDays,
    totals,
    series,
    published: contentTotals(municipalityId),
    note: 'Counts are aggregated daily page views recorded by BetterGo and contain no personal data.',
  }
}

function contentTotals(municipalityId) {
  const rows = all(
    `SELECT content_type, publication_status, COUNT(*) AS total FROM municipal_content
     WHERE municipality_id = ? GROUP BY content_type, publication_status`,
    [Number(municipalityId)],
  )
  const byType = {}
  for (const row of rows) {
    byType[row.content_type] = byType[row.content_type] || {}
    byType[row.content_type][row.publication_status] = Number(row.total)
  }
  return byType
}

/* -------------------------------- Feedback -------------------------------- */

/** Public citation, e.g. BGM-M3K9P-4TQ. Unique and non-sequential. */
function feedbackReference() {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5)
  const random = Math.random().toString(36).slice(2, 5).toUpperCase()
  return `BGM-${stamp}-${random}`
}

export function createFeedback({ municipalityId = null, contentId = null, kind, name, email, message, pageUrl = null }) {
  let reference = feedbackReference()
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!get(`SELECT id FROM municipal_feedback WHERE reference = ?`, [reference])) break
    reference = feedbackReference()
  }
  const id = Number(
    run(
      `INSERT INTO municipal_feedback (municipality_id, content_id, kind, name, email, message, page_url, reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [municipalityId, contentId, kind, name, email, message, pageUrl, reference],
    ).lastInsertRowid,
  )
  return get(`SELECT id, reference, kind, status, created_at FROM municipal_feedback WHERE id = ?`, [id])
}

/**
 * Public-safe status lookup. Requires the reference AND the email used when
 * submitting, so a reference alone cannot reveal anyone's message.
 */
export function trackFeedback(reference, email) {
  const record = get(
    `SELECT f.id, f.reference, f.kind, f.status, f.created_at, f.handled_at, m.name AS municipality_name
     FROM municipal_feedback f LEFT JOIN municipalities m ON m.id = f.municipality_id
     WHERE f.reference = ? AND lower(COALESCE(f.email,'')) = lower(?)`,
    [String(reference || '').trim().toUpperCase(), String(email || '').trim()],
  )
  if (!record) throw notFound('No inquiry matches that reference and email address.')
  return {
    reference: record.reference,
    kind: record.kind,
    status: record.status,
    submitted_at: record.created_at,
    reviewed_at: record.handled_at,
    municipality: record.municipality_name,
    note: 'This status covers a BetterGo platform inquiry. It is not an official LGU complaint or case number.',
  }
}

export function listFeedback({ municipalityId = null, status = null, limit = 50 } = {}) {
  const params = []
  let where = '1 = 1'
  if (municipalityId) {
    where += ' AND f.municipality_id = ?'
    params.push(Number(municipalityId))
  }
  if (status) {
    where += ' AND f.status = ?'
    params.push(String(status))
  }
  return all(
    `SELECT f.*, m.name AS municipality_name, c.title AS content_title, u.name AS handled_by_name
     FROM municipal_feedback f
     LEFT JOIN municipalities m ON m.id = f.municipality_id
     LEFT JOIN municipal_content c ON c.id = f.content_id
     LEFT JOIN users u ON u.id = f.handled_by
     WHERE ${where} ORDER BY f.id DESC LIMIT ?`,
    [...params, Math.min(200, Math.max(1, Number(limit) || 50))],
  )
}

/* ------------------------------ Subscriptions ----------------------------- */

export function subscribeToMunicipality({ municipalityId, email, topics = [] }) {
  const token = `sub_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  const existing = get(`SELECT * FROM municipal_subscriptions WHERE municipality_id = ? AND email = ?`, [
    municipalityId,
    email,
  ])
  if (existing) {
    run(`UPDATE municipal_subscriptions SET topics = ?, token = ?, unsubscribed_at = NULL WHERE id = ?`, [
      JSON.stringify(topics),
      token,
      existing.id,
    ])
    return { token, confirmed: Boolean(existing.confirmed_at), existing: true }
  }
  run(`INSERT INTO municipal_subscriptions (municipality_id, email, topics, token) VALUES (?, ?, ?, ?)`, [
    municipalityId,
    email,
    JSON.stringify(topics),
    token,
  ])
  return { token, confirmed: false, existing: false }
}

export function confirmSubscription(token) {
  const record = get(`SELECT * FROM municipal_subscriptions WHERE token = ?`, [String(token || '')])
  if (!record) throw notFound('Subscription confirmation link is not valid.')
  if (!record.confirmed_at) {
    run(`UPDATE municipal_subscriptions SET confirmed_at = datetime('now') WHERE id = ?`, [record.id])
  }
  return { municipality_id: record.municipality_id, confirmed: true }
}

export function unsubscribe(token) {
  const record = get(`SELECT * FROM municipal_subscriptions WHERE token = ?`, [String(token || '')])
  if (!record) throw notFound('Subscription link is not valid.')
  run(`UPDATE municipal_subscriptions SET unsubscribed_at = datetime('now') WHERE id = ?`, [record.id])
  return { unsubscribed: true }
}

/** Published subscription topics for one municipality (no subscriber data). */
export function subscriptionTopics(municipalityId) {
  return Object.entries(SUBSCRIPTION_TOPICS).map(([value, label]) => ({ value, label }))
}
