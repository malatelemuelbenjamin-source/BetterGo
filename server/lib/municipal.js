/**
 * Shared Municipal Portal domain helpers (Phase 3).
 *
 * Used by the public portal router, the read-only API and the municipal
 * administrative workspace so the published-content rule, the content types
 * and the portal payload are defined exactly once.
 */
import { all, get } from '../db.js'
import { notFound } from './http.js'

/** Municipal content types. Announcements, offices and services keep their own tables. */
export const MUNICIPAL_CONTENT_TYPES = {
  about: 'Municipality profile',
  news: 'News and updates',
  notice: 'Public notice',
  program: 'Program and initiative',
  project: 'Project',
  resource: 'Public resource',
  faq: 'Frequently asked question',
  contact: 'Contact information',
}

export const MUNICIPAL_CONTENT_TYPE_OPTIONS = Object.entries(MUNICIPAL_CONTENT_TYPES).map(
  ([value, label]) => ({ value, label }),
)

/**
 * Only approved, published, in-date municipal content may appear publicly.
 * Approval and source verification stay separate: a published record still
 * carries its own verification status.
 */
export const MUNICIPAL_CONTENT_PUBLISHED = `c.publication_status = 'published' AND c.archived_at IS NULL
  AND (c.published_at IS NULL OR datetime(c.published_at) <= datetime('now'))
  AND (c.ends_at IS NULL OR datetime(c.ends_at) > datetime('now'))`

export const ANNOUNCEMENT_PUBLISHED = `a.publication_status = 'published' AND a.archived_at IS NULL
  AND (a.published_at IS NULL OR datetime(a.published_at) <= datetime('now'))
  AND (a.expires_at IS NULL OR datetime(a.expires_at) > datetime('now'))`

export const SERVICE_PUBLISHED = `s.publication_status = 'published' AND s.archived_at IS NULL
  AND (s.published_at IS NULL OR datetime(s.published_at) <= datetime('now'))`

/** Resolve an active municipality by slug, or throw a 404. */
export function municipalityBySlug(slug) {
  const municipality = get(`SELECT * FROM municipalities WHERE slug = ? AND is_active = 1`, [String(slug || '')])
  if (!municipality) throw notFound('Municipality not found.')
  return municipality
}

export function parseSocialLinks(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const allowed = ['facebook', 'youtube', 'instagram', 'x', 'website']
    const result = {}
    for (const key of allowed) {
      if (typeof parsed[key] === 'string' && /^https:\/\//i.test(parsed[key])) result[key] = parsed[key]
    }
    return Object.keys(result).length ? result : null
  } catch {
    return null
  }
}

/** Public-safe projection of a municipality row. */
export function publicMunicipality(municipality) {
  if (!municipality) return null
  return {
    id: municipality.id,
    name: municipality.name,
    slug: municipality.slug,
    municipal_code: municipality.municipal_code,
    description: municipality.description,
    overview: municipality.overview,
    portal_title: municipality.portal_title || municipality.name,
    portal_description: municipality.portal_description || municipality.description,
    logo: municipality.logo,
    cover_image: municipality.cover_image,
    official_website: municipality.official_website,
    email: municipality.email,
    phone: municipality.phone,
    office_address: municipality.office_address,
    office_hours: municipality.office_hours,
    social_links: parseSocialLinks(municipality.social_links),
    population: municipality.population,
    geographic_info: municipality.geographic_info,
    // An official name is only public once the municipal record itself is verified.
    mayor_name: municipality.verification_status === 'verified' ? municipality.mayor_name : null,
    last_verified_at: municipality.last_verified_at,
    source_reference: municipality.source_reference,
    source_url: municipality.source_url,
    publication_status: municipality.publication_status,
    verification_status: municipality.verification_status,
    updated_at: municipality.updated_at,
  }
}

export const CONTENT_COLUMNS = `c.id, c.municipality_id, c.content_type, c.title, c.slug, c.summary,
  c.featured_image, c.image_alt, c.image_credit, c.external_url, c.is_featured,
  c.priority, c.pinned, c.venue, c.event_start, c.event_end, c.eligibility,
  c.application_status, c.project_status, c.beneficiaries, c.office_id, c.progress_percent,
  c.progress_note, c.progress_updated_at, c.attachment_url, c.attachment_label,
  c.address, c.barangay, c.latitude, c.longitude,
  c.publication_status, c.verification_status, c.source_reference, c.source_url,
  c.starts_at, c.ends_at, c.published_at, c.updated_at`

/** Published content for one municipality, optionally filtered by type. */
export function publishedContent(municipalityId, type = null, limit = 40) {
  const params = [municipalityId]
  let clause = ''
  if (type) {
    clause = ' AND c.content_type = ?'
    params.push(String(type))
  }
  return all(
    `SELECT ${CONTENT_COLUMNS} FROM municipal_content c
     WHERE c.municipality_id = ? AND ${MUNICIPAL_CONTENT_PUBLISHED}${clause}
     ORDER BY c.is_featured DESC, c.sort_order, COALESCE(c.published_at, c.created_at) DESC
     LIMIT ?`,
    [...params, Number(limit)],
  )
}

/** Published content grouped by type, capped per type for portal homepages. */
export function contentByType(municipalityId, perType = 6) {
  const rows = all(
    `SELECT ${CONTENT_COLUMNS} FROM municipal_content c
     WHERE c.municipality_id = ? AND ${MUNICIPAL_CONTENT_PUBLISHED}
     ORDER BY c.is_featured DESC, COALESCE(c.published_at, c.created_at) DESC`,
    [municipalityId],
  )
  const grouped = {}
  for (const key of Object.keys(MUNICIPAL_CONTENT_TYPES)) grouped[key] = []
  for (const row of rows) {
    const bucket = grouped[row.content_type] || (grouped[row.content_type] = [])
    if (bucket.length < perType) bucket.push(row)
  }
  return { grouped, totals: countByType(municipalityId) }
}

function countByType(municipalityId) {
  const rows = all(
    `SELECT c.content_type, COUNT(*) AS total FROM municipal_content c
     WHERE c.municipality_id = ? AND ${MUNICIPAL_CONTENT_PUBLISHED}
     GROUP BY c.content_type`,
    [municipalityId],
  )
  const counts = {}
  for (const key of Object.keys(MUNICIPAL_CONTENT_TYPES)) counts[key] = 0
  for (const row of rows) counts[row.content_type] = Number(row.total)
  return counts
}

export function municipalityAnnouncements(municipalityId, limit = 6) {
  return all(
    `SELECT a.id, a.title, a.slug, a.summary, a.announcement_type, a.priority, a.published_at,
            a.is_featured, a.verification_status, cat.name AS category_name
     FROM announcements a
     LEFT JOIN announcement_categories cat ON cat.id = a.category_id
     WHERE a.municipality_id = ? AND ${ANNOUNCEMENT_PUBLISHED}
     ORDER BY a.is_featured DESC, a.published_at DESC LIMIT ?`,
    [municipalityId, Number(limit)],
  )
}

export const OFFICE_COLUMNS = `o.id, o.name, o.slug, o.category, o.office_type, o.description,
  o.responsibilities, o.phone, o.email, o.address, o.operating_hours, o.website, o.facebook,
  o.latitude, o.longitude, o.office_level, o.parent_office_id, o.location_verified,
  o.service_note, o.verification_status, o.source_reference, o.source_url, o.last_verified_at,
  o.municipality_id, p.name AS parent_office_name`

export function municipalityOffices(municipalityId, limit = 30) {
  return all(
    `SELECT ${OFFICE_COLUMNS} FROM government_offices o
     LEFT JOIN government_offices p ON p.id = o.parent_office_id
     WHERE o.publication_status = 'published'
       AND (o.municipality_id = ? OR EXISTS (
         SELECT 1 FROM office_municipalities om
         WHERE om.office_id = o.id AND om.municipality_id = ?
       ))
     ORDER BY o.office_level = 'department' DESC, o.name LIMIT ?`,
    [municipalityId, municipalityId, Number(limit)],
  )
}

export function municipalityServices(municipalityId, limit = 20) {
  return all(
    `SELECT s.id, s.title, s.slug, s.short_description, s.description, s.coverage_type,
            s.service_scope, s.availability_status, s.verification_status, s.is_online,
            c.name AS category_name, c.slug AS category_slug
     FROM government_services s
     LEFT JOIN service_categories c ON c.id = s.category_id
     WHERE ${SERVICE_PUBLISHED}
       AND (
         s.municipality_id = ?
         OR s.coverage_type = 'province_wide'
         OR s.service_scope IN ('province_wide', 'online_province_wide')
         OR EXISTS (SELECT 1 FROM service_coverage sc WHERE sc.service_id = s.id AND sc.municipality_id = ?)
       )
     ORDER BY s.is_featured DESC, s.title LIMIT ?`,
    [municipalityId, municipalityId, Number(limit)],
  )
}

/** Aggregate published-record counts used by the directory and dashboards. */
export function municipalityMetrics(municipalityId) {
  const count = (sql, ...params) => Number(get(sql, params).total || 0)
  const content = count(
    `SELECT COUNT(*) AS total FROM municipal_content c WHERE c.municipality_id = ? AND ${MUNICIPAL_CONTENT_PUBLISHED}`,
    municipalityId,
  )
  return {
    announced: count(
      `SELECT COUNT(*) AS total FROM announcements a WHERE a.municipality_id = ? AND ${ANNOUNCEMENT_PUBLISHED}`,
      municipalityId,
    ),
    offices: Number(
      get(
        `SELECT COUNT(*) AS total FROM government_offices o
         WHERE o.publication_status = 'published'
           AND (o.municipality_id = ? OR EXISTS (
             SELECT 1 FROM office_municipalities om WHERE om.office_id = o.id AND om.municipality_id = ?
           ))`,
        [municipalityId, municipalityId],
      ).total || 0,
    ),
    services: Number(
      get(
        `SELECT COUNT(*) AS total FROM government_services s WHERE ${SERVICE_PUBLISHED}
           AND (s.municipality_id = ? OR s.coverage_type = 'province_wide'
                OR s.service_scope IN ('province_wide','online_province_wide')
                OR EXISTS (SELECT 1 FROM service_coverage sc WHERE sc.service_id = s.id AND sc.municipality_id = ?))`,
        [municipalityId, municipalityId],
      ).total || 0,
    ),
    documents: count(
      `SELECT COUNT(*) AS total FROM public_documents d
       WHERE d.municipality_id = ? AND d.publication_status = 'published'`,
      municipalityId,
    ),
    content,
    byType: countByType(municipalityId),
  }
}

/** Directory of published municipal portals with real record counts only. */
export function municipalPortalDirectory() {
  const rows = all(
    `SELECT * FROM municipalities
     WHERE is_active = 1 AND publication_status = 'published'
     ORDER BY sort_order, name`,
  )
  return rows.map((row) => ({
    ...publicMunicipality(row),
    metrics: municipalityMetrics(row.id),
  }))
}

/** Complete portal payload for one municipality. */
export function municipalPortal(slug, { perType = 6 } = {}) {
  const municipality = municipalityBySlug(slug)
  const { grouped, totals } = contentByType(municipality.id, perType)
  return {
    municipality: publicMunicipality(municipality),
    metrics: { ...municipalityMetrics(municipality.id), byType: totals },
    content: grouped,
    advisories: all(
      `SELECT ${CONTENT_COLUMNS} FROM municipal_content c
       WHERE c.municipality_id = ? AND c.content_type IN ('notice','news')
         AND (c.priority IN ('important','urgent') OR c.pinned = 1)
         AND ${MUNICIPAL_CONTENT_PUBLISHED}
       ORDER BY CASE c.priority WHEN 'urgent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
                COALESCE(c.published_at, c.created_at) DESC LIMIT 4`,
      [municipality.id],
    ),
    upcoming: all(
      `SELECT ${CONTENT_COLUMNS} FROM municipal_content c
       WHERE c.municipality_id = ? AND c.event_start IS NOT NULL
         AND datetime(c.event_start) >= datetime('now')
         AND ${MUNICIPAL_CONTENT_PUBLISHED}
       ORDER BY c.event_start LIMIT 4`,
      [municipality.id],
    ),
    projects: all(
      `SELECT ${CONTENT_COLUMNS} FROM municipal_content c
       WHERE c.municipality_id = ? AND c.content_type = 'project' AND ${MUNICIPAL_CONTENT_PUBLISHED}
       ORDER BY c.pinned DESC, c.is_featured DESC, COALESCE(c.published_at, c.created_at) DESC LIMIT 4`,
      [municipality.id],
    ),
    programs: all(
      `SELECT ${CONTENT_COLUMNS} FROM municipal_content c
       WHERE c.municipality_id = ? AND c.content_type = 'program' AND ${MUNICIPAL_CONTENT_PUBLISHED}
       ORDER BY c.pinned DESC, c.is_featured DESC, COALESCE(c.published_at, c.created_at) DESC LIMIT 4`,
      [municipality.id],
    ),
    faqs: all(
      `SELECT ${CONTENT_COLUMNS} FROM municipal_content c
       WHERE c.municipality_id = ? AND c.content_type = 'faq' AND ${MUNICIPAL_CONTENT_PUBLISHED}
       ORDER BY c.sort_order, c.title LIMIT 8`,
      [municipality.id],
    ),
    announcements: municipalityAnnouncements(municipality.id, 8),
    offices: municipalityOffices(municipality.id, 12),
    services: municipalityServices(municipality.id, 12),
    barangays: all(`SELECT id, name FROM barangays WHERE municipality_id = ? AND is_active = 1 ORDER BY name`, [
      municipality.id,
    ]),
    documents: all(
      `SELECT id, title, slug, document_category, fiscal_year, publication_date, verification_status
       FROM public_documents WHERE municipality_id = ? AND publication_status = 'published'
       ORDER BY publication_date DESC LIMIT 5`,
      [municipality.id],
    ),
    contentTypes: MUNICIPAL_CONTENT_TYPE_OPTIONS,
  }
}

/** Paginated published content for one municipality, used by list pages and the API. */
export function municipalContentList(slug, { type = null, q = '', page = 1, limit = 12, featured = false } = {}) {
  const municipality = municipalityBySlug(slug)
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 12))
  const safePage = Math.max(1, Number(page) || 1)
  const params = [municipality.id]
  let where = `c.municipality_id = ? AND ${MUNICIPAL_CONTENT_PUBLISHED}`
  if (type) {
    where += ' AND c.content_type = ?'
    params.push(String(type))
  }
  if (featured) where += ' AND c.is_featured = 1'
  if (q) {
    where += ` AND (lower(c.title) LIKE ? OR lower(COALESCE(c.summary,'')) LIKE ? OR lower(COALESCE(c.body,'')) LIKE ?)`
    const like = `%${String(q).toLowerCase()}%`
    params.push(like, like, like)
  }
  const total = Number(
    get(`SELECT COUNT(*) AS total FROM municipal_content c WHERE ${where}`, params).total || 0,
  )
  const results = all(
    `SELECT ${CONTENT_COLUMNS} FROM municipal_content c WHERE ${where}
     ORDER BY c.is_featured DESC, c.sort_order, COALESCE(c.published_at, c.created_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, (safePage - 1) * safeLimit],
  )
  return {
    municipality: publicMunicipality(municipality),
    results,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    contentTypes: MUNICIPAL_CONTENT_TYPE_OPTIONS,
  }
}

/** One published municipal content record, with its published neighbours. */
export function municipalContentDetail(slug, contentSlug) {
  const municipality = municipalityBySlug(slug)
  const record = get(
    `SELECT c.* FROM municipal_content c WHERE c.municipality_id = ? AND c.slug = ? AND ${MUNICIPAL_CONTENT_PUBLISHED}`,
    [municipality.id, String(contentSlug || '')],
  )
  if (!record) throw notFound('Municipal content not found.')
  return {
    municipality: publicMunicipality(municipality),
    record,
    related: all(
      `SELECT ${CONTENT_COLUMNS} FROM municipal_content c
       WHERE c.municipality_id = ? AND c.content_type = ? AND c.id <> ? AND ${MUNICIPAL_CONTENT_PUBLISHED}
       ORDER BY COALESCE(c.published_at, c.created_at) DESC LIMIT 4`,
      [municipality.id, record.content_type, record.id],
    ),
  }
}
