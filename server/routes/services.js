import crypto from 'node:crypto'
import { Router } from 'express'
import { all, get, nowIso, run } from '../db.js'
import {
  asyncHandler,
  badRequest,
  cleanText,
  notFound,
  paginated,
  pagination,
  safeUrl,
  tooMany,
  unauthorized,
} from '../lib/http.js'
import { rateLimit } from '../auth.js'
import { logAudit } from '../audit.js'
import {
  AVAILABILITY,
  SERVICE_SCOPES,
  SERVICE_VERIFICATION,
  SERVICE_PUBLISHED_SQL as PUBLISHED,
  expandServiceTerms,
} from '../lib/service-domain.js'
import { capabilityFor, capabilityMeta } from '../lib/citizen.js'

export const servicesRouter = Router()

function categoryRows() {
  return all(
    `SELECT id, name, slug, description, icon, parent_id, sort_order, is_featured, status
     FROM service_categories WHERE status = 'active' AND is_active = 1 ORDER BY sort_order, name`,
  )
}

/** Resolve a category slug to itself and all descendants. */
function categoryIdsForSlug(slug) {
  const rows = categoryRows()
  const root = rows.find((row) => row.slug === slug)
  if (!root) return null
  const ids = [Number(root.id)]
  let added = true
  while (added) {
    added = false
    for (const row of rows) {
      if (row.parent_id && ids.includes(Number(row.parent_id)) && !ids.includes(Number(row.id))) {
        ids.push(Number(row.id))
        added = true
      }
    }
  }
  return ids
}

function paramList(values) {
  return values.map(() => '?').join(', ')
}

/**
 * Build the public WHERE clause for service search. Only published records
 * ever pass through this function.
 */
function buildServiceQuery(query) {
  const clauses = [PUBLISHED]
  const params = []
  const terms = expandServiceTerms(query.q)
  const raw = String(query.q || '').trim().toLowerCase()

  if (terms.length) {
    const perTerm = `(lower(s.title) LIKE ? OR lower(COALESCE(s.short_description,'')) LIKE ?
      OR lower(COALESCE(s.description,'')) LIKE ? OR lower(COALESCE(s.full_description,'')) LIKE ?
      OR lower(COALESCE(s.eligibility,'')) LIKE ? OR lower(COALESCE(c.name,'')) LIKE ?
      OR EXISTS (SELECT 1 FROM service_requirements r WHERE r.service_id = s.id AND lower(r.requirement_name) LIKE ?)
      OR EXISTS (SELECT 1 FROM service_faqs f WHERE f.service_id = s.id AND f.status='published' AND (lower(f.question) LIKE ? OR lower(f.answer) LIKE ?)))`
    for (const term of terms) {
      const like = `%${term}%`
      clauses.push(perTerm)
      params.push(like, like, like, like, like, like, like, like, like)
    }
  }

  if (query.category) {
    const ids = categoryIdsForSlug(String(query.category))
    if (!ids) return { empty: true, where: '1 = 0', params: [], terms, raw }
    clauses.push(`s.category_id IN (${paramList(ids)})`)
    params.push(...ids)
  }

  if (query.municipality) {
    clauses.push(`(
      s.municipality_id = (SELECT id FROM municipalities WHERE slug = ?)
      OR s.coverage_type = 'province_wide'
      OR s.service_scope IN ('province_wide','online_province_wide')
      OR EXISTS (SELECT 1 FROM service_coverage sc WHERE sc.service_id = s.id AND sc.municipality_id = (SELECT id FROM municipalities WHERE slug = ?))
    )`)
    params.push(String(query.municipality), String(query.municipality))
  }

  if (query.office) {
    clauses.push(`o.slug = ?`)
    params.push(String(query.office))
  }

  if (query.availability && AVAILABILITY[query.availability]) {
    clauses.push(`s.availability_status = ?`)
    params.push(String(query.availability))
  }

  if (query.verification && SERVICE_VERIFICATION[query.verification]) {
    clauses.push(`s.verification_status = ?`)
    params.push(String(query.verification))
  }

  if (query.scope && SERVICE_SCOPES[query.scope]) {
    clauses.push(`s.service_scope = ?`)
    params.push(String(query.scope))
  }

  if (query.type) {
    clauses.push(`s.service_type = ?`)
    params.push(String(query.type))
  }

  if (query.online === 'true') clauses.push(`(s.is_online = 1 OR s.availability_status = 'online_application')`)
  if (query.featured === 'true') clauses.push(`s.is_featured = 1`)

  return { where: clauses.join(' AND '), params, terms, raw }
}

function orderClause(query, raw) {
  const sort = String(query.sort || '')
  if (sort === 'newest') return { sql: 's.published_at DESC, s.updated_at DESC, s.title ASC', params: [] }
  if (sort === 'oldest') return { sql: 's.published_at ASC, s.title ASC', params: [] }
  if (sort === 'name' || sort === 'title') return { sql: 's.title ASC', params: [] }
  if (raw) {
    return {
      sql: `CASE WHEN lower(s.title) = ? THEN 0 WHEN lower(s.title) LIKE ? THEN 1 ELSE 2 END, s.title ASC`,
      params: [raw, `${raw}%`],
    }
  }
  return { sql: 's.is_featured DESC, s.title ASC', params: [] }
}

const RESULT_COLUMNS = `s.id, s.title, s.slug, s.description, s.short_description, s.service_type,
  s.coverage_type, s.service_scope, s.availability_status, s.verification_status, s.is_featured,
  s.is_online, s.last_reviewed_at, s.verified_at, s.updated_at, s.published_at,
  s.fees, s.processing_time, c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon,
  pc.name AS parent_category_name, pc.slug AS parent_category_slug,
  o.name AS office_name, o.slug AS office_slug,
  m.name AS municipality_name, m.slug AS municipality_slug,
  (SELECT COUNT(*) FROM service_requirements r WHERE r.service_id = s.id) AS requirement_count,
  (SELECT COUNT(*) FROM service_procedures p WHERE p.service_id = s.id) AS procedure_count,
  (SELECT MIN(f.amount_cents) FROM service_fees f WHERE f.service_id = s.id) AS fee_min_cents,
  (SELECT MAX(f.amount_cents) FROM service_fees f WHERE f.service_id = s.id) AS fee_max_cents,
  (SELECT p.processing_time FROM service_processing p WHERE p.service_id = s.id ORDER BY p.id LIMIT 1) AS processing_time_detail`

const RESULT_JOINS = `LEFT JOIN service_categories c ON c.id = s.category_id
  LEFT JOIN service_categories pc ON pc.id = c.parent_id
  LEFT JOIN government_offices o ON o.id = s.office_id
  LEFT JOIN municipalities m ON m.id = s.municipality_id`

function searchServices(req, { limitOverride } = {}) {
  const { page, limit: requested, offset } = pagination(req.query)
  const limit = limitOverride || requested
  const built = buildServiceQuery(req.query)
  if (built.empty) {
    return { results: [], total: 0, page, limit, totalPages: 1, facets: { categories: [] }, terms: built.terms }
  }
  const order = orderClause(req.query, built.raw)
  const total = Number(
    get(
      `SELECT COUNT(*) AS total FROM government_services s ${RESULT_JOINS} WHERE ${built.where}`,
      built.params,
    ).total,
  )
  const rawLimit = limitOverride ? Math.min(Math.max(1, limitOverride), 200) : limit
  const results = all(
    `SELECT ${RESULT_COLUMNS} FROM government_services s ${RESULT_JOINS}
     WHERE ${built.where} ORDER BY ${order.sql} LIMIT ? OFFSET ?`,
    [...built.params, ...order.params, rawLimit, offset],
  )
  return { results, total, page, limit: rawLimit, totalPages: Math.max(1, Math.ceil(total / rawLimit)), terms: built.terms }
}

function serviceFacets() {
  const categories = all(
    `SELECT c.id, c.name, c.slug, c.icon, c.parent_id,
       (SELECT COUNT(*) FROM government_services s2
          LEFT JOIN service_categories c2 ON c2.id = s2.category_id
        WHERE s2.publication_status='published' AND s2.archived_at IS NULL
          AND s2.category_id = c.id) AS service_count
     FROM service_categories c WHERE c.status = 'active' ORDER BY c.sort_order, c.name`,
  )
  return {
    categories,
    municipalities: all(
      `SELECT m.id, m.name, m.slug,
        (SELECT COUNT(DISTINCT s.id) FROM government_services s
           LEFT JOIN service_coverage sc ON sc.service_id = s.id
         WHERE s.publication_status='published' AND s.archived_at IS NULL
           AND (s.municipality_id = m.id OR sc.municipality_id = m.id)) AS service_count
       FROM municipalities m WHERE m.is_active = 1 ORDER BY m.sort_order`,
    ),
    offices: all(
      `SELECT o.id, o.name, o.slug, COUNT(s.id) AS service_count
       FROM government_offices o JOIN government_services s ON s.office_id = o.id
       WHERE s.publication_status = 'published' AND s.archived_at IS NULL
       GROUP BY o.id, o.name, o.slug ORDER BY o.name`,
    ),
    availability: Object.entries(AVAILABILITY)
      .filter(([key]) => key !== 'archived')
      .map(([key, label]) => ({
        value: key,
        label,
        count: Number(get(`SELECT COUNT(*) AS n FROM government_services s WHERE ${PUBLISHED} AND s.availability_status = ?`, [key]).n),
      })),
  }
}

/* --------------------------------------------------------------------------
 * Directory, categories and detail
 * ------------------------------------------------------------------------ */
servicesRouter.get(
  '/services',
  asyncHandler(async (req, res) => {
    const payload = searchServices(req)
    res.json({
      ...payload,
      facets: serviceFacets(),
      availabilityOptions: AVAILABILITY,
      verificationOptions: SERVICE_VERIFICATION,
      scopeOptions: SERVICE_SCOPES,
    })
  }),
)

servicesRouter.get(
  '/services/categories',
  asyncHandler(async (_req, res) => {
    const rows = categoryRows()
    const counts = new Map(
      all(
        `SELECT category_id, COUNT(*) AS n FROM government_services s
         WHERE ${PUBLISHED} AND category_id IS NOT NULL GROUP BY category_id`,
      ).map((row) => [Number(row.category_id), Number(row.n)]),
    )
    const nodes = rows.map((row) => ({
      ...row,
      is_featured: Boolean(row.is_featured),
      service_count: counts.get(Number(row.id)) || 0,
      children: [],
    }))
    const byId = new Map(nodes.map((node) => [Number(node.id), node]))
    const roots = []
    for (const node of nodes) {
      const parent = node.parent_id ? byId.get(Number(node.parent_id)) : null
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    // A parent's headline count includes its subcategories.
    for (const node of nodes) {
      if (node.children.length) node.total_service_count = node.service_count + node.children.reduce((sum, child) => sum + child.service_count, 0)
      else node.total_service_count = node.service_count
    }
    res.json({
      results: roots,
      flat: nodes.map(({ children, ...rest }) => ({ ...rest, child_count: children.length })),
      featured: roots.filter((node) => node.is_featured),
      total_categories: nodes.length,
      total_parents: roots.length,
    })
  }),
)

servicesRouter.get(
  '/services/categories/:slug',
  asyncHandler(async (req, res) => {
    const rows = categoryRows()
    const category = rows.find((row) => row.slug === req.params.slug)
    if (!category || category.status !== 'active') throw notFound('Service category not found.')
    const parent = category.parent_id ? rows.find((row) => Number(row.id) === Number(category.parent_id)) : null
    const children = rows.filter((row) => Number(row.parent_id) === Number(category.id))
    const ids = categoryIdsForSlug(category.slug)
    const services = all(
      `SELECT ${RESULT_COLUMNS} FROM government_services s ${RESULT_JOINS}
       WHERE ${PUBLISHED} AND s.category_id IN (${paramList(ids)})
       ORDER BY s.is_featured DESC, s.title LIMIT 24`,
      ids,
    )
    const offices = all(
      `SELECT o.id, o.name, o.slug, o.category, o.verification_status
       FROM government_offices o
       WHERE o.publication_status = 'published' AND o.id IN (
         SELECT s.office_id FROM government_services s WHERE ${PUBLISHED} AND s.category_id IN (${paramList(ids)}) AND s.office_id IS NOT NULL
       ) ORDER BY o.name LIMIT 12`,
      ids,
    )
    res.json({
      category: { ...category, is_featured: Boolean(category.is_featured) },
      parent,
      breadcrumbs: [parent, category].filter(Boolean).map((item) => ({ name: item.name, slug: item.slug })),
      children,
      services,
      service_count: services.length,
      offices,
      is_empty: services.length === 0,
    })
  }),
)

/* Subresources by numeric service id ------------------------------------- */
function publicServiceById(id) {
  const service = get(
    `SELECT s.id, s.slug FROM government_services s WHERE s.id = ? AND ${PUBLISHED}`,
    [Number(id)],
  )
  if (!service) throw notFound('Service information not found.')
  return service
}

for (const [segment, table, order] of [
  ['requirements', 'service_requirements', 'is_required DESC, sort_order, id'],
  ['procedures', 'service_procedures', 'step_number, id'],
  ['fees', 'service_fees', 'sort_order, id'],
  ['documents', 'service_documents', "CASE WHEN status = 'published' THEN 0 ELSE 1 END, sort_order, id"],
  ['faqs', 'service_faqs', 'sort_order, id'],
  ['processing', 'service_processing', 'id'],
]) {
  servicesRouter.get(
    `/services/:id/${segment}`,
    asyncHandler(async (req, res) => {
      if (!/^\d+$/.test(req.params.id)) throw notFound('Service information not found.')
      const service = publicServiceById(req.params.id)
      const where = segment === 'faqs' || segment === 'documents' ? `service_id = ? AND status = 'published'` : `service_id = ?`
      res.json({ results: all(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${order}`, [service.id]) })
    }),
  )
}

servicesRouter.get(
  '/services/:id/coverage',
  asyncHandler(async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) throw notFound('Service information not found.')
    const service = publicServiceById(req.params.id)
    const results = all(
      `SELECT sc.*, m.name AS municipality_name, m.slug AS municipality_slug, b.name AS barangay_name, o.name AS office_name
       FROM service_coverage sc
       LEFT JOIN municipalities m ON m.id = sc.municipality_id
       LEFT JOIN barangays b ON b.id = sc.barangay_id
       LEFT JOIN government_offices o ON o.id = sc.office_id
       WHERE sc.service_id = ? ORDER BY m.sort_order, b.name`,
      [service.id],
    )
    res.json({ results })
  }),
)

servicesRouter.get(
  '/services/:slug',
  asyncHandler(async (req, res) => {
    const service = get(
      `SELECT s.*, c.name AS category_name, c.slug AS category_slug, c.parent_id AS category_parent_id,
              pc.name AS parent_category_name, pc.slug AS parent_category_slug,
              o.name AS office_name, o.slug AS office_slug, o.phone AS office_phone, o.email AS office_email,
              o.address AS office_address, o.operating_hours AS office_hours, o.website AS office_website,
              o.verification_status AS office_verification, o.last_verified_at AS office_last_verified,
              m.name AS municipality_name, m.slug AS municipality_slug,
              src.name AS source_name, src.organization AS source_organization, src.url AS source_registry_url,
              src.document_reference AS source_document_reference, src.verification_status AS source_verification,
              src.verified_at AS source_verified_at, src.next_review_at AS source_next_review_at
       FROM government_services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       LEFT JOIN service_categories pc ON pc.id = c.parent_id
       LEFT JOIN government_offices o ON o.id = s.office_id
       LEFT JOIN municipalities m ON m.id = s.municipality_id
       LEFT JOIN service_sources src ON src.id = s.source_id
       WHERE s.slug = ? AND ${PUBLISHED}`,
      [req.params.slug],
    )
    if (!service) throw notFound('Service information not found.')

    const favorites = Number(get(`SELECT COUNT(*) AS n FROM service_favorites WHERE service_id = ?`, [service.id]).n)
    const feedbackSummary = get(
      `SELECT COUNT(*) AS total, ROUND(AVG(rating), 1) AS average
       FROM service_feedback WHERE service_id = ? AND status = 'approved'`,
      [service.id],
    )
    let isFavorited = false
    let isSubscribed = false
    if (req.user) {
      isFavorited = Boolean(get(`SELECT id FROM service_favorites WHERE user_id = ? AND service_id = ?`, [req.user.id, service.id]))
      isSubscribed = Boolean(get(`SELECT id FROM service_subscriptions WHERE user_id = ? AND service_id = ?`, [req.user.id, service.id]))
    }

    const children = service.category_id
      ? all(`SELECT id, name, slug FROM service_categories WHERE parent_id = ? ORDER BY sort_order`, [service.category_id])
      : []

    // Capability labels reflect what the record actually offers. Nothing is
    // labelled as an authorised integration unless an administrator recorded it.
    const hasDownloadableForm = Boolean(
      get(
        `SELECT 1 AS found FROM service_documents
         WHERE service_id = ? AND status='published' AND (external_url IS NOT NULL OR file_reference IS NOT NULL) LIMIT 1`,
        [service.id],
      ),
    )
    const capability = capabilityFor(service, { hasDownloadableForm })

    const betterGoForm = get(
      `SELECT id, title, version FROM service_forms
       WHERE service_id = ? AND status = 'published' AND archived_at IS NULL
       ORDER BY id DESC LIMIT 1`,
      [service.id],
    )

    res.json({
      service,
      betterGoForm: betterGoForm || null,
      capability: { key: capability, ...capabilityMeta(capability) },
      category: service.category_id
        ? { id: service.category_id, name: service.category_name, slug: service.category_slug, parent_name: service.parent_category_name, parent_slug: service.parent_category_slug }
        : null,
      requirements: all(`SELECT * FROM service_requirements WHERE service_id = ? ORDER BY is_required DESC, sort_order, id`, [service.id]),
      procedures: all(`SELECT * FROM service_procedures WHERE service_id = ? ORDER BY step_number, id`, [service.id]),
      fees: all(`SELECT * FROM service_fees WHERE service_id = ? ORDER BY sort_order, id`, [service.id]),
      processing: all(`SELECT * FROM service_processing WHERE service_id = ? ORDER BY id`, [service.id]),
      coverage: all(
        `SELECT sc.*, m.name AS municipality_name, m.slug AS municipality_slug, b.name AS barangay_name, o.name AS office_name
         FROM service_coverage sc
         LEFT JOIN municipalities m ON m.id = sc.municipality_id
         LEFT JOIN barangays b ON b.id = sc.barangay_id
         LEFT JOIN government_offices o ON o.id = sc.office_id
         WHERE sc.service_id = ? ORDER BY m.sort_order, b.name`,
        [service.id],
      ),
      documents: all(`SELECT id, document_title, document_type, file_reference, external_url, publication_date FROM service_documents WHERE service_id = ? AND status='published' ORDER BY sort_order, id`, [service.id]),
      faqs: all(`SELECT id, question, answer FROM service_faqs WHERE service_id = ? AND status='published' ORDER BY sort_order, id`, [service.id]),
      updates: all(`SELECT id, summary, change_type, created_at FROM service_updates WHERE service_id = ? ORDER BY created_at DESC LIMIT 10`, [service.id]),
      related: all(
        `SELECT id, title, slug, short_description, description, verification_status
         FROM government_services
         WHERE publication_status = 'published' AND archived_at IS NULL AND category_id = ? AND id <> ?
         ORDER BY is_featured DESC, title LIMIT 4`,
        [service.category_id, service.id],
      ),
      siblingCategories: children,
      favorites,
      feedbackSummary: { total: Number(feedbackSummary.total || 0), average: feedbackSummary.average || null },
      isFavorited,
      isSubscribed,
    })
  }),
)

/* --------------------------------------------------------------------------
 * Municipality coverage, resources and FAQs
 * ------------------------------------------------------------------------ */
servicesRouter.get(
  '/service-coverage',
  asyncHandler(async (req, res) => {
    const municipalitySlug = req.query.municipality ? String(req.query.municipality) : null
    const municipalities = all(
      `SELECT id, name, slug, description FROM municipalities WHERE is_active = 1 ORDER BY sort_order`,
    ).filter((row) => !municipalitySlug || row.slug === municipalitySlug)

    const results = municipalities.map((municipality) => {
      const services = all(
        `SELECT ${RESULT_COLUMNS} FROM government_services s ${RESULT_JOINS}
         WHERE ${PUBLISHED} AND (
           s.municipality_id = ? OR s.coverage_type = 'province_wide'
           OR s.service_scope IN ('province_wide','online_province_wide')
           OR EXISTS (SELECT 1 FROM service_coverage sc WHERE sc.service_id = s.id AND sc.municipality_id = ?)
         )
         ORDER BY s.title LIMIT 200`,
        [municipality.id, municipality.id],
      )
      const byCategory = new Map()
      for (const service of services) {
        const key = service.category_slug || 'other-services'
        const entry = byCategory.get(key) || { slug: key, name: service.category_name || 'Other services', count: 0 }
        entry.count += 1
        byCategory.set(key, entry)
      }
      return {
        municipality,
        service_count: services.length,
        categories: [...byCategory.values()].sort((a, b) => b.count - a.count),
        services: services.slice(0, 12),
      }
    })

    res.json({
      results,
      total: results.reduce((sum, row) => sum + row.service_count, 0),
      policy:
        'Coverage reflects records published by BetterGo. A service listed here is not a guarantee that it is currently offered; confirm with the responsible office.',
    })
  }),
)

servicesRouter.get(
  '/service-resources',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination({ ...req.query, limit: req.query.limit || 20 })
    const clauses = [`s.publication_status = 'published'`, `s.archived_at IS NULL`, `d.status = 'published'`]
    const params = []
    if (req.query.type) {
      clauses.push(`d.document_type = ?`)
      params.push(String(req.query.type))
    }
    if (req.query.q) {
      clauses.push(`(lower(d.document_title) LIKE ? OR lower(s.title) LIKE ?)`)
      const like = `%${String(req.query.q).toLowerCase()}%`
      params.push(like, like)
    }
    const where = clauses.join(' AND ')
    const total = Number(
      get(
        `SELECT COUNT(*) AS n FROM service_documents d JOIN government_services s ON s.id = d.service_id WHERE ${where}`,
        params,
      ).n,
    )
    const results = all(
      `SELECT d.id, d.document_title, d.document_type, d.external_url, d.file_reference, d.publication_date,
              s.title AS service_title, s.slug AS service_slug, c.name AS category_name
       FROM service_documents d
       JOIN government_services s ON s.id = d.service_id
       LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE ${where} ORDER BY d.publication_date DESC, d.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    res.json({ ...paginated(results, total, page, limit), types: all(`SELECT DISTINCT document_type FROM service_documents ORDER BY document_type`) })
  }),
)

servicesRouter.get(
  '/service-faqs',
  asyncHandler(async (req, res) => {
    const clauses = [`s.publication_status = 'published'`, `s.archived_at IS NULL`, `f.status = 'published'`]
    const params = []
    if (req.query.q) {
      clauses.push(`(lower(f.question) LIKE ? OR lower(f.answer) LIKE ? OR lower(s.title) LIKE ?)`)
      const like = `%${String(req.query.q).toLowerCase()}%`
      params.push(like, like, like)
    }
    if (req.query.service) {
      clauses.push(`s.slug = ?`)
      params.push(String(req.query.service))
    }
    const rows = all(
      `SELECT f.id, f.question, f.answer, f.sort_order, s.title AS service_title, s.slug AS service_slug,
              c.name AS category_name
       FROM service_faqs f JOIN government_services s ON s.id = f.service_id
       LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE ${clauses.join(' AND ')} ORDER BY c.name, s.title, f.sort_order LIMIT 300`,
      params,
    )
    const grouped = new Map()
    for (const row of rows) {
      const key = row.service_slug
      if (!grouped.has(key)) grouped.set(key, { service_title: row.service_title, service_slug: row.service_slug, category: row.category_name, items: [] })
      grouped.get(key).items.push({ id: row.id, question: row.question, answer: row.answer })
    }
    res.json({ results: [...grouped.values()], total: rows.length })
  }),
)

/* --------------------------------------------------------------------------
 * Citizen features: favorites, feedback, subscriptions, suggestions
 * ------------------------------------------------------------------------ */
function requireCitizen(req) {
  if (!req.user) throw unauthorized('Sign in to use this feature.')
  if (req.user.account_status === 'suspended' || req.user.account_status === 'disabled') {
    throw unauthorized('This account cannot use this feature.')
  }
}

function serviceBySlug(slug) {
  const service = get(`SELECT id, slug, title FROM government_services s WHERE slug = ? AND ${PUBLISHED}`, [slug])
  if (!service) throw notFound('Service information not found.')
  return service
}

servicesRouter.post(
  '/services/:slug/favorite',
  asyncHandler(async (req, res) => {
    requireCitizen(req)
    const service = serviceBySlug(req.params.slug)
    if (get(`SELECT id FROM service_favorites WHERE user_id = ? AND service_id = ?`, [req.user.id, service.id])) {
      return res.json({ message: 'This service is already in your saved list.', favorited: true })
    }
    run(`INSERT INTO service_favorites (user_id, service_id) VALUES (?, ?)`, [req.user.id, service.id])
    // The unified saved list (Prompt 63) is the single bookmark source of truth.
    run(`INSERT OR IGNORE INTO saved_items (user_id, content_type, content_id) VALUES (?, 'service', ?)`, [req.user.id, service.id])
    logAudit(req, { action: 'services.favorited', module: 'services', entityType: 'service', entityId: service.id })
    res.status(201).json({ message: 'Service saved to your private list.', favorited: true })
  }),
)

servicesRouter.delete(
  '/services/:slug/favorite',
  asyncHandler(async (req, res) => {
    requireCitizen(req)
    const service = serviceBySlug(req.params.slug)
    run(`DELETE FROM service_favorites WHERE user_id = ? AND service_id = ?`, [req.user.id, service.id])
    run(`DELETE FROM saved_items WHERE user_id = ? AND content_type = 'service' AND content_id = ?`, [req.user.id, service.id])
    res.json({ message: 'Service removed from your saved list.', favorited: false })
  }),
)

servicesRouter.post(
  '/services/:slug/subscribe',
  asyncHandler(async (req, res) => {
    requireCitizen(req)
    const service = serviceBySlug(req.params.slug)
    if (!get(`SELECT id FROM service_subscriptions WHERE user_id = ? AND service_id = ?`, [req.user.id, service.id])) {
      run(`INSERT INTO service_subscriptions (user_id, service_id) VALUES (?, ?)`, [req.user.id, service.id])
    }
    res.status(201).json({ message: 'You will be notified in your account when this service information changes.', subscribed: true })
  }),
)

servicesRouter.delete(
  '/services/:slug/subscribe',
  asyncHandler(async (req, res) => {
    requireCitizen(req)
    const service = serviceBySlug(req.params.slug)
    run(`DELETE FROM service_subscriptions WHERE user_id = ? AND service_id = ?`, [req.user.id, service.id])
    res.json({ message: 'Update notifications for this service are turned off.', subscribed: false })
  }),
)

servicesRouter.get(
  '/services/:slug/feedback',
  asyncHandler(async (req, res) => {
    const service = serviceBySlug(req.params.slug)
    const summary = get(
      `SELECT COUNT(*) AS total, ROUND(AVG(rating), 1) AS average,
              SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS five,
              SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) AS four,
              SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) AS three,
              SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) AS two,
              SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS one
       FROM service_feedback WHERE service_id = ? AND status = 'approved'`,
      [service.id],
    )
    res.json({
      summary: {
        total: Number(summary.total || 0),
        average: summary.average || null,
        distribution: { 5: Number(summary.five || 0), 4: Number(summary.four || 0), 3: Number(summary.three || 0), 2: Number(summary.two || 0), 1: Number(summary.one || 0) },
      },
      // Public feedback is published anonymously. No account details are exposed.
      results: all(
        `SELECT id, rating, comment, created_at FROM service_feedback
         WHERE service_id = ? AND status = 'approved' AND is_public = 1
         ORDER BY created_at DESC LIMIT 20`,
        [service.id],
      ),
      notice: 'Feedback is citizen input for BetterGo. It is not an official complaint or a government service rating.',
    })
  }),
)

servicesRouter.post(
  '/services/:slug/feedback',
  rateLimit({ windowMs: 60_000, max: 5, key: (req) => `feedback:${req.ip}` }),
  asyncHandler(async (req, res) => {
    requireCitizen(req)
    const service = serviceBySlug(req.params.slug)
    const rating = Number(req.body?.rating)
    const comment = cleanText(req.body?.comment, 2000)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw badRequest('Choose a rating between 1 and 5.')
    if (comment && comment.length < 10) throw badRequest('Please write at least 10 characters so the feedback is useful.')
    if (!comment && !rating) throw badRequest('Provide a rating or a comment.')
    const recent = get(
      `SELECT id FROM service_feedback WHERE service_id = ? AND user_id = ? AND datetime(created_at) > datetime('now','-1 day')`,
      [service.id, req.user.id],
    )
    if (recent) throw tooMany('You already submitted feedback for this service today. Thank you.')
    const result = run(
      `INSERT INTO service_feedback (service_id, user_id, rating, comment, status, is_public) VALUES (?, ?, ?, ?, 'pending', 0)`,
      [service.id, req.user.id, rating, comment],
    )
    logAudit(req, { action: 'services.feedback_submitted', module: 'services', entityType: 'service', entityId: service.id })
    res.status(201).json({
      message: 'Thank you. Your feedback was received and will be reviewed before it is shown publicly.',
      id: Number(result.lastInsertRowid),
    })
  }),
)

/* --------------------------------------------------------------------------
 * Developer API (versioned, read-only, rate limited)
 * ------------------------------------------------------------------------ */
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

const apiKeyLimiter = rateLimit({ windowMs: 60_000, max: 120, key: (req) => `apiv1:${req.ip}` })

function optionalApiClient(req, _res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : req.get('x-api-key')
  if (!token) {
    req.apiClient = null
    return next()
  }
  const client = get(`SELECT * FROM api_clients WHERE key_hash = ? AND status = 'active' AND revoked_at IS NULL`, [sha256(token)])
  req.apiClient = client || null
  if (client) run(`UPDATE api_clients SET last_used_at = ? WHERE id = ?`, [nowIso(), client.id])
  next()
}

servicesRouter.use('/v1', apiKeyLimiter, optionalApiClient)

function logApi(req, endpoint, statusCode) {
  try {
    run(`INSERT INTO api_request_log (api_client_id, endpoint, status_code) VALUES (?, ?, ?)`, [
      req.apiClient?.id ?? null,
      endpoint,
      statusCode,
    ])
  } catch {
    /* analytics must never break a public request */
  }
}

servicesRouter.get(
  '/v1/meta',
  asyncHandler(async (req, res) => {
    logApi(req, '/v1/meta', 200)
    res.json({
      api: 'BetterGo Marinduque Government Services API',
      version: 'v1',
      status: 'stable',
      licence: 'Public information published by BetterGo Marinduque. Verify against the responsible office before relying on it.',
      disclaimer:
        'BetterGo Marinduque is an independent civic platform and is not an official government website. Records show their verification status.',
      authentication: 'Anonymous access is rate limited. An API key can be supplied with the Authorization: Bearer header when developer access is enabled.',
      endpoints: [
        'GET /api/v1/services',
        'GET /api/v1/services/{slug}',
        'GET /api/v1/categories',
        'GET /api/v1/offices',
        'GET /api/v1/municipalities',
        'GET /api/v1/coverage',
        'GET /api/v1/resources',
        'GET /api/v1/faqs',
      ],
      generated_at: nowIso(),
    })
  }),
)

servicesRouter.get(
  '/v1/services',
  asyncHandler(async (req, res) => {
    const payload = searchServices(req)
    logApi(req, '/v1/services', 200)
    res.json({
      data: payload.results,
      meta: { total: payload.total, page: payload.page, limit: payload.limit, totalPages: payload.totalPages, query_terms: payload.terms },
      disclaimer: 'Published by BetterGo Marinduque. Check verification status and confirm with the responsible office.',
    })
  }),
)

servicesRouter.get(
  '/v1/services/:slug',
  asyncHandler(async (req, res) => {
    const service = get(
      `SELECT s.*, c.name AS category_name, c.slug AS category_slug,
              o.name AS office_name, o.slug AS office_slug, o.address AS office_address, o.operating_hours AS office_hours,
              o.phone AS office_phone, o.email AS office_email, o.website AS office_website,
              m.name AS municipality_name, m.slug AS municipality_slug
       FROM government_services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       LEFT JOIN government_offices o ON o.id = s.office_id
       LEFT JOIN municipalities m ON m.id = s.municipality_id
       WHERE s.slug = ? AND ${PUBLISHED}`,
      [req.params.slug],
    )
    if (!service) throw notFound('Service information not found.')
    logApi(req, '/v1/services/:slug', 200)
    res.json({
      data: {
        service,
        requirements: all(`SELECT requirement_name, description, is_required, sort_order FROM service_requirements WHERE service_id = ? ORDER BY is_required DESC, sort_order, id`, [service.id]),
        procedures: all(`SELECT step_number, title, description, office, location, link FROM service_procedures WHERE service_id = ? ORDER BY step_number, id`, [service.id]),
        fees: all(`SELECT fee_name, amount_cents, currency, fee_type, conditions FROM service_fees WHERE service_id = ? ORDER BY sort_order, id`, [service.id]),
        processing: all(`SELECT processing_time, processing_unit, conditions FROM service_processing WHERE service_id = ? ORDER BY id`, [service.id]),
        coverage: all(
          `SELECT m.name AS municipality_name, m.slug AS municipality_slug, sc.availability_status, sc.local_instructions
           FROM service_coverage sc LEFT JOIN municipalities m ON m.id = sc.municipality_id WHERE sc.service_id = ? ORDER BY m.sort_order`,
          [service.id],
        ),
        documents: all(`SELECT document_title, document_type, external_url, publication_date FROM service_documents WHERE service_id = ? AND status='published' ORDER BY sort_order, id`, [service.id]),
        faqs: all(`SELECT question, answer FROM service_faqs WHERE service_id = ? AND status='published' ORDER BY sort_order, id`, [service.id]),
      },
      disclaimer: 'Published by BetterGo Marinduque. Not an official government publication. Verify with the responsible office.',
    })
  }),
)

servicesRouter.get(
  '/v1/categories',
  asyncHandler(async (req, res) => {
    logApi(req, '/v1/categories', 200)
    const rows = categoryRows().filter((row) => row.status === 'active')
    const counts = new Map(
      all(`SELECT category_id, COUNT(*) AS n FROM government_services s WHERE ${PUBLISHED} GROUP BY category_id`).map((row) => [
        Number(row.category_id),
        Number(row.n),
      ]),
    )
    res.json({
      data: rows.map((row) => ({ ...row, is_featured: Boolean(row.is_featured), service_count: counts.get(Number(row.id)) || 0 })),
      meta: { total: rows.length },
    })
  }),
)

servicesRouter.get(
  '/v1/offices',
  asyncHandler(async (req, res) => {
    logApi(req, '/v1/offices', 200)
    const { page, limit, offset } = pagination({ ...req.query, limit: req.query.limit || 25 })
    const total = Number(get(`SELECT COUNT(*) AS n FROM government_offices WHERE publication_status = 'published'`).n)
    res.json({
      data: all(
        `SELECT o.id, o.name, o.slug, o.category, o.government_level, o.description, o.address, o.operating_hours,
                o.phone, o.email, o.website, o.verification_status, o.last_verified_at, m.name AS municipality_name
         FROM government_offices o LEFT JOIN municipalities m ON m.id = o.municipality_id
         WHERE o.publication_status = 'published' ORDER BY o.name LIMIT ? OFFSET ?`,
        [limit, offset],
      ),
      meta: { total, page, limit },
    })
  }),
)

servicesRouter.get(
  '/v1/municipalities',
  asyncHandler(async (req, res) => {
    logApi(req, '/v1/municipalities', 200)
    res.json({
      data: all(`SELECT id, name, slug, municipal_code, description FROM municipalities WHERE is_active = 1 ORDER BY sort_order`),
    })
  }),
)

servicesRouter.get(
  '/v1/coverage',
  asyncHandler(async (req, res) => {
    logApi(req, '/v1/coverage', 200)
    res.json({
      data: all(
        `SELECT sc.id, s.slug AS service_slug, s.title AS service_title, m.name AS municipality_name,
                b.name AS barangay_name, sc.availability_status, sc.local_instructions
         FROM service_coverage sc
         JOIN government_services s ON s.id = sc.service_id
         LEFT JOIN municipalities m ON m.id = sc.municipality_id
         LEFT JOIN barangays b ON b.id = sc.barangay_id
         WHERE s.publication_status = 'published' AND s.archived_at IS NULL ORDER BY m.sort_order LIMIT 500`,
      ),
    })
  }),
)

servicesRouter.get(
  '/v1/resources',
  asyncHandler(async (req, res) => {
    logApi(req, '/v1/resources', 200)
    res.json({
      data: all(
        `SELECT d.id, d.document_title, d.document_type, d.external_url, s.slug AS service_slug, s.title AS service_title
         FROM service_documents d JOIN government_services s ON s.id = d.service_id
         WHERE s.publication_status='published' AND s.archived_at IS NULL AND d.status='published' ORDER BY d.id LIMIT 300`,
      ),
    })
  }),
)

servicesRouter.get(
  '/v1/faqs',
  asyncHandler(async (req, res) => {
    logApi(req, '/v1/faqs', 200)
    res.json({
      data: all(
        `SELECT f.id, f.question, f.answer, s.slug AS service_slug, s.title AS service_title
         FROM service_faqs f JOIN government_services s ON s.id = f.service_id
         WHERE s.publication_status='published' AND s.archived_at IS NULL AND f.status='published' ORDER BY f.id LIMIT 300`,
      ),
    })
  }),
)

/**
 * OpenAPI description of the public read-only API. Kept intentionally small but
 * accurate: it only advertises endpoints that are implemented above.
 */
servicesRouter.get(
  '/openapi.json',
  asyncHandler(async (_req, res) => {
    const serviceFields = {
      id: { type: 'integer' },
      title: { type: 'string' },
      slug: { type: 'string' },
      short_description: { type: 'string', nullable: true },
      category_name: { type: 'string', nullable: true },
      category_slug: { type: 'string', nullable: true },
      office_name: { type: 'string', nullable: true },
      availability_status: { type: 'string' },
      verification_status: { type: 'string' },
      service_scope: { type: 'string' },
    }
    res.json({
      openapi: '3.0.3',
      info: {
        title: 'BetterGo Marinduque — Government Services API',
        version: '1.0.0',
        description:
          'Read-only access to published government service information. BetterGo Marinduque is an independent civic platform, not an official government website.',
      },
      servers: [{ url: '/api' }],
      paths: {
        '/v1/services': {
          get: {
            summary: 'Search published services',
            parameters: [
              { name: 'q', in: 'query', schema: { type: 'string' } },
              { name: 'category', in: 'query', schema: { type: 'string' } },
              { name: 'municipality', in: 'query', schema: { type: 'string' } },
              { name: 'office', in: 'query', schema: { type: 'string' } },
              { name: 'availability', in: 'query', schema: { type: 'string' } },
              { name: 'verification', in: 'query', schema: { type: 'string' } },
              { name: 'page', in: 'query', schema: { type: 'integer' } },
              { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } },
            ],
            responses: { 200: { description: 'Published services' } },
          },
        },
        '/v1/services/{slug}': {
          get: {
            summary: 'Full published service record',
            parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { 200: { description: 'Service record' }, 404: { description: 'Not found' } },
          },
        },
        '/v1/categories': { get: { summary: 'Service category hierarchy', responses: { 200: { description: 'Categories' } } } },
        '/v1/offices': { get: { summary: 'Published government offices', responses: { 200: { description: 'Offices' } } } },
        '/v1/municipalities': { get: { summary: 'Municipalities', responses: { 200: { description: 'Municipalities' } } } },
        '/v1/coverage': { get: { summary: 'Municipality service coverage', responses: { 200: { description: 'Coverage records' } } } },
        '/v1/resources': { get: { summary: 'Forms and external application resources', responses: { 200: { description: 'Resources' } } } },
        '/v1/faqs': { get: { summary: 'Service FAQs', responses: { 200: { description: 'FAQs' } } } },
      },
      components: {
        schemas: {
          Service: { type: 'object', properties: serviceFields },
          Error: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
      'x-disclaimer': 'Verify information with the responsible government office before relying on it.',
    })
  }),
)
