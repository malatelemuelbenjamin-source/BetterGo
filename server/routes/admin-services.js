import crypto from 'node:crypto'
import { Router } from 'express'
import { all, get, nowIso, run } from '../db.js'
import { requireAdmin, requirePermission, ctx, canUseMunicipality, hasAnyPermission } from '../rbac.js'
import { asyncHandler, badRequest, cleanText, forbidden, notFound, safeUrl, uniqueSlug, unprocessable } from '../lib/http.js'
import { WORKFLOW, WORKFLOW_LABELS } from '../lib/crud.js'
import { logAudit, recordWorkflow } from '../audit.js'
import { AVAILABILITY, SERVICE_VERIFICATION, SERVICE_SCOPES } from '../lib/service-domain.js'

export const adminServicesRouter = Router()
adminServicesRouter.use(requireAdmin)

const VIEW = ['services.view', 'content.view']
const CREATE = ['services.create', 'content.create']
const UPDATE = ['services.update', 'content.update']
const APPROVE = ['services.approve', 'content.approve']
const PUBLISH = ['services.publish', 'content.publish']
const ARCHIVE = ['services.archive', 'content.archive']

function context(req) {
  return ctx(req)
}

function ensureLocalScope(contextValue, service) {
  if (contextValue.hasGlobalScope) return
  const ids = contextValue.municipalityIds || []
  const covered = all(`SELECT municipality_id FROM service_coverage WHERE service_id = ?`, [service.id]).map((row) =>
    Number(row.municipality_id),
  )
  const allowed =
    (service.municipality_id && ids.includes(Number(service.municipality_id))) || covered.some((id) => ids.includes(id))
  if (!allowed) throw forbidden('This service is outside your assigned municipality scope.')
}

function loadService(req, permission = VIEW) {
  const contextValue = context(req)
  if (!hasAnyPermission(contextValue, permission)) throw forbidden('You do not have permission to manage this service.')
  const service = get(`SELECT * FROM government_services WHERE id = ?`, [Number(req.params.id)])
  if (!service) throw notFound('Service record not found.')
  ensureLocalScope(contextValue, service)
  return { contextValue, service }
}

function recordRevision(service, userId, summary) {
  const last = get(`SELECT COALESCE(MAX(revision_number), 0) AS n FROM service_revisions WHERE service_id = ?`, [service.id])
  run(
    `INSERT INTO service_revisions (service_id, revision_number, snapshot, editor_id, change_summary) VALUES (?, ?, ?, ?, ?)`,
    [service.id, Number(last.n) + 1, JSON.stringify(service), userId, summary || 'Record updated'],
  )
}

function notifySubscribers(service, summary) {
  const subscribers = all(
    `SELECT s.user_id FROM service_subscriptions s
     LEFT JOIN notification_preferences p ON p.user_id = s.user_id
     WHERE s.service_id = ? AND s.email_enabled = 1 AND COALESCE(p.updates_enabled, 1) = 1`,
    [service.id],
  )
  for (const { user_id: userId } of subscribers) {
    try {
      run(
        `INSERT INTO notifications (user_id, title, message, notification_type, related_entity_type, related_entity_id)
         VALUES (?, ?, ?, 'service_update', 'service', ?)`,
        [userId, `Update: ${service.title}`, summary, service.id],
      )
    } catch (error) {
      console.error('[notify] failed', error.message)
    }
  }
  return subscribers.length
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
const CATEGORY_FIELDS = {
  name: (value) => cleanText(value, 160),
  description: (value) => cleanText(value, 2000),
  icon: (value) => cleanText(value, 60),
  seo_title: (value) => cleanText(value, 200),
  seo_description: (value) => cleanText(value, 320),
  keywords: (value) => cleanText(value, 500),
}

adminServicesRouter.get(
  '/service-categories',
  requirePermission('services.categories.view', ...VIEW),
  asyncHandler(async (req, res) => {
    const rows = all(
      `SELECT c.*,
        (SELECT COUNT(*) FROM government_services s WHERE s.category_id = c.id) AS service_count,
        (SELECT COUNT(*) FROM government_services s WHERE s.category_id = c.id AND s.publication_status = 'published' AND s.archived_at IS NULL) AS published_count,
        (SELECT COUNT(*) FROM service_categories child WHERE child.parent_id = c.id) AS child_count
       FROM service_categories c ORDER BY c.parent_id IS NOT NULL, c.sort_order, c.name`,
    ).map((row) => ({ ...row, is_featured: Boolean(row.is_featured), is_active: Boolean(row.is_active) }))
    const filtered = req.query.q
      ? rows.filter((row) => `${row.name} ${row.slug} ${row.description || ''}`.toLowerCase().includes(String(req.query.q).toLowerCase()))
      : rows
    res.json({
      results: filtered,
      total: filtered.length,
      parents: filtered.filter((row) => !row.parent_id),
      featured: filtered.filter((row) => row.is_featured),
      icons: ['FileText', 'HeartPulse', 'HandHeart', 'Users', 'Accessibility', 'UsersRound', 'BriefcaseBusiness', 'Receipt', 'Building2', 'GraduationCap', 'Briefcase', 'Store', 'Sprout', 'Fish', 'Trees', 'House', 'Car', 'ShieldCheck', 'LifeBuoy', 'Trophy', 'MapPinned', 'Scale', 'Landmark', 'ContactRound', 'FolderOpen'],
    })
  }),
)

adminServicesRouter.post(
  '/service-categories',
  requirePermission('services.categories.create'),
  asyncHandler(async (req, res) => {
    const name = cleanText(req.body?.name, 160)
    if (!name) throw badRequest('A category name is required.')
    const parentId = req.body?.parent_id ? Number(req.body.parent_id) : null
    if (parentId && !get(`SELECT id FROM service_categories WHERE id = ?`, [parentId])) {
      throw badRequest('The selected parent category does not exist.')
    }
    const slug = uniqueSlug(run, get, 'service_categories', 'slug', cleanText(req.body?.slug, 120) || name)
    const payload = { name, slug, parent_id: parentId }
    for (const [field, cleaner] of Object.entries(CATEGORY_FIELDS)) {
      if (req.body?.[field] !== undefined) payload[field] = cleaner(req.body[field])
    }
    payload.icon = payload.icon || 'FolderOpen'
    payload.sort_order = Number(req.body?.sort_order) || Number(get(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM service_categories`).n)
    payload.is_featured = req.body?.is_featured === true || req.body?.is_featured === 1 ? 1 : 0
    payload.status = req.body?.status === 'inactive' ? 'inactive' : 'active'
    payload.category_group = cleanText(req.body?.category_group, 60) || 'services'
    const columns = Object.keys(payload)
    const result = run(
      `INSERT INTO service_categories (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map((column) => payload[column]),
    )
    logAudit(req, { action: 'services.category_created', module: 'services', entityType: 'service_category', entityId: Number(result.lastInsertRowid) })
    res.status(201).json({ message: 'Category created.', id: Number(result.lastInsertRowid) })
  }),
)

adminServicesRouter.patch(
  '/service-categories/:id',
  requirePermission('services.categories.update'),
  asyncHandler(async (req, res) => {
    const category = get(`SELECT * FROM service_categories WHERE id = ?`, [Number(req.params.id)])
    if (!category) throw notFound('Category not found.')
    const payload = {}
    for (const [field, cleaner] of Object.entries(CATEGORY_FIELDS)) {
      if (req.body?.[field] !== undefined) payload[field] = cleaner(req.body[field])
    }
    if (req.body?.slug !== undefined) payload.slug = uniqueSlug(run, get, 'service_categories', 'slug', req.body.slug, category.id)
    if (req.body?.parent_id !== undefined) {
      const parentId = req.body.parent_id ? Number(req.body.parent_id) : null
      if (parentId === Number(category.id)) throw badRequest('A category cannot be its own parent.')
      // Walk up the proposed parent chain to reject circular relationships.
      let cursor = parentId
      const seen = new Set()
      while (cursor) {
        if (Number(cursor) === Number(category.id)) throw badRequest('That parent would create a circular category relationship.')
        if (seen.has(Number(cursor))) break
        seen.add(Number(cursor))
        const row = get(`SELECT parent_id FROM service_categories WHERE id = ?`, [cursor])
        if (!row) throw badRequest('The selected parent category does not exist.')
        cursor = row.parent_id ? Number(row.parent_id) : null
      }
      payload.parent_id = parentId
    }
    if (req.body?.sort_order !== undefined) payload.sort_order = Number(req.body.sort_order) || 0
    if (req.body?.is_featured !== undefined) {
      if (!hasAnyPermission(context(req), ['services.categories.manage_featured'])) throw forbidden('You cannot change featured categories.')
      payload.is_featured = req.body.is_featured === true || req.body.is_featured === 1 ? 1 : 0
    }
    if (req.body?.status !== undefined) {
      if (!hasAnyPermission(context(req), ['services.categories.archive'])) throw forbidden('You cannot change the category status.')
      payload.status = req.body.status === 'inactive' ? 'inactive' : 'active'
      payload.is_active = payload.status === 'active' ? 1 : 0
    }
    if (!Object.keys(payload).length) return res.json({ message: 'Nothing to update.' })
    payload.updated_at = nowIso()
    run(`UPDATE service_categories SET ${Object.keys(payload).map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, [
      ...Object.values(payload),
      category.id,
    ])
    logAudit(req, { action: 'services.category_updated', module: 'services', entityType: 'service_category', entityId: category.id })
    res.json({ message: 'Category updated.', record: get(`SELECT * FROM service_categories WHERE id = ?`, [category.id]) })
  }),
)

adminServicesRouter.delete(
  '/service-categories/:id',
  requirePermission('services.categories.archive'),
  asyncHandler(async (req, res) => {
    const category = get(`SELECT * FROM service_categories WHERE id = ?`, [Number(req.params.id)])
    if (!category) throw notFound('Category not found.')
    const children = Number(get(`SELECT COUNT(*) AS n FROM service_categories WHERE parent_id = ?`, [category.id]).n)
    if (children) throw badRequest('Archive or move the subcategories first.')
    // Categories are archived, never deleted, so services keep their classification.
    run(`UPDATE service_categories SET status = 'inactive', is_active = 0, updated_at = ? WHERE id = ?`, [nowIso(), category.id])
    logAudit(req, { action: 'services.category_archived', module: 'services', entityType: 'service_category', entityId: category.id })
    res.json({ message: 'Category archived. Existing services keep their category reference.' })
  }),
)

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
const SERVICE_FIELDS = {
  title: (value) => cleanText(value, 200),
  short_description: (value) => cleanText(value, 600),
  description: (value) => cleanText(value, 8000),
  full_description: (value) => cleanText(value, 40000),
  eligibility: (value) => cleanText(value, 6000),
  payment_instructions: (value) => cleanText(value, 4000),
  service_type: (value) => cleanText(value, 80),
  availability_status: (value) => cleanText(value, 40),
  service_scope: (value) => cleanText(value, 40),
  coverage_type: (value) => cleanText(value, 40),
  application_mode: (value) => cleanText(value, 40),
  source_reference: (value) => cleanText(value, 500),
  verification_notes: (value) => cleanText(value, 2000),
  next_review_at: (value) => (value ? cleanText(value, 40) : null),
}

function servicePayload(req, { partial = false } = {}) {
  const payload = {}
  for (const [field, cleaner] of Object.entries(SERVICE_FIELDS)) {
    if (req.body?.[field] !== undefined) payload[field] = cleaner(req.body[field])
  }
  if (!partial || req.body?.title !== undefined) {
    if (!cleanText(req.body?.title, 200)) throw badRequest('A service title is required.')
    payload.title = cleanText(req.body.title, 200)
  }
  if (req.body?.slug !== undefined) payload.slug = cleanText(req.body.slug, 120)
  for (const [field, table] of [
    ['category_id', 'service_categories'],
    ['office_id', 'government_offices'],
    ['department_id', 'government_departments'],
    ['municipality_id', 'municipalities'],
    ['source_id', 'service_sources'],
  ]) {
    if (req.body?.[field] !== undefined) {
      const value = req.body[field] === '' || req.body[field] === null ? null : Number(req.body[field])
      if (value !== null && !get(`SELECT id FROM ${table} WHERE id = ?`, [value])) {
        throw unprocessable(`The selected ${field.replace('_id', '').replace('_', ' ')} does not exist.`)
      }
      payload[field] = value
    }
  }
  if (req.body?.availability_status !== undefined) {
    if (!AVAILABILITY[req.body.availability_status]) throw unprocessable('Unknown availability status.')
    payload.availability_status = req.body.availability_status
  }
  if (req.body?.service_scope !== undefined) {
    if (!SERVICE_SCOPES[req.body.service_scope]) throw unprocessable('Unknown service scope.')
    payload.service_scope = req.body.service_scope
  }
  if (req.body?.verification_status !== undefined) {
    if (!SERVICE_VERIFICATION[req.body.verification_status]) throw unprocessable('Unknown verification status.')
    if (!hasAnyPermission(context(req), ['services.verify'])) throw forbidden('You do not have permission to set the verification status.')
    payload.verification_status = req.body.verification_status
  }
  if (req.body?.official_link !== undefined) {
    const url = safeUrl(req.body.official_link)
    if (req.body.official_link && !url) throw unprocessable('The official application link must be a valid http(s) URL.')
    payload.official_link = url
  }
  if (req.body?.source_url !== undefined) {
    const url = safeUrl(req.body.source_url)
    if (req.body.source_url && !url) throw unprocessable('The source URL must be a valid http(s) URL.')
    payload.source_url = url
  }
  if (req.body?.is_featured !== undefined) payload.is_featured = req.body.is_featured === true || req.body.is_featured === 1 ? 1 : 0
  if (req.body?.is_online !== undefined) payload.is_online = req.body.is_online === true || req.body.is_online === 1 ? 1 : 0
  return payload
}

adminServicesRouter.get(
  '/services/analytics',
  requirePermission('services.analytics.view', ...VIEW),
  asyncHandler(async (_req, res) => {
    const published = `publication_status = 'published' AND archived_at IS NULL`
    res.json({
      totals: {
        all: Number(get(`SELECT COUNT(*) AS n FROM government_services`).n),
        published: Number(get(`SELECT COUNT(*) AS n FROM government_services WHERE ${published}`).n),
        draft: Number(get(`SELECT COUNT(*) AS n FROM government_services WHERE publication_status = 'draft'`).n),
        review: Number(get(`SELECT COUNT(*) AS n FROM government_services WHERE publication_status IN ('submitted_for_review','under_review')`).n),
        verified: Number(get(`SELECT COUNT(*) AS n FROM government_services WHERE ${published} AND verification_status = 'verified'`).n),
        needs_update: Number(get(`SELECT COUNT(*) AS n FROM government_services WHERE ${published} AND verification_status IN ('needs_update','pending')`).n),
        categories: Number(get(`SELECT COUNT(*) AS n FROM service_categories WHERE status = 'active'`).n),
        municipalities_covered: Number(get(`SELECT COUNT(DISTINCT municipality_id) AS n FROM service_coverage`).n),
      },
      topSearches: all(`SELECT query, COUNT(*) AS searches FROM service_search_log WHERE query IS NOT NULL AND query <> '' GROUP BY lower(query) ORDER BY searches DESC LIMIT 10`),
      searchesWithoutResults: all(
        `SELECT query, COUNT(*) AS searches FROM service_search_log WHERE result_count = 0 AND query IS NOT NULL GROUP BY lower(query) ORDER BY searches DESC LIMIT 10`,
      ),
      feedback: get(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
                ROUND(AVG(CASE WHEN status = 'approved' THEN rating END), 1) AS average_rating
         FROM service_feedback`,
      ),
      coverageGaps: all(
        `SELECT m.name, m.slug,
          (SELECT COUNT(*) FROM government_services s WHERE s.publication_status='published' AND s.archived_at IS NULL
             AND (s.municipality_id = m.id OR s.service_scope IN ('province_wide','online_province_wide')
               OR EXISTS (SELECT 1 FROM service_coverage sc WHERE sc.service_id = s.id AND sc.municipality_id = m.id))) AS service_count
         FROM municipalities m WHERE m.is_active = 1 ORDER BY service_count ASC`,
      ),
      sources: all(`SELECT verification_status, COUNT(*) AS total FROM service_sources GROUP BY verification_status`),
    })
  }),
)

adminServicesRouter.get(
  '/services/export',
  requirePermission('services.export'),
  asyncHandler(async (req, res) => {
    const rows = all(
      `SELECT s.title, s.slug, s.short_description, s.description, s.eligibility, s.service_type,
              s.availability_status, s.verification_status, s.service_scope, c.name AS category,
              o.name AS office, m.name AS municipality, s.source_reference, s.source_url, s.last_reviewed_at,
              s.published_at, s.updated_at
       FROM government_services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       LEFT JOIN government_offices o ON o.id = s.office_id
       LEFT JOIN municipalities m ON m.id = s.municipality_id
       WHERE s.publication_status = 'published' AND s.archived_at IS NULL
       ORDER BY s.title`,
    )
    logAudit(req, { action: 'services.exported', module: 'services', entityType: 'service_export' })
    if (req.query.format === 'csv') {
      const headers = Object.keys(rows[0] || { title: '' })
      const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="bettergo-marinduque-services.csv"')
      return res.send([headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n'))
    }
    res.json({ data: rows, total: rows.length, generated_at: nowIso() })
  }),
)

adminServicesRouter.post(
  '/services/import',
  requirePermission('services.import'),
  asyncHandler(async (req, res) => {
    const dryRun = req.body?.dry_run !== false
    let rows = []
    if (Array.isArray(req.body?.rows)) rows = req.body.rows
    else if (typeof req.body?.csv === 'string') rows = parseCsv(req.body.csv)
    else if (typeof req.body?.json === 'string') {
      try {
        const parsed = JSON.parse(req.body.json)
        rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : []
      } catch {
        throw badRequest('The JSON payload could not be parsed.')
      }
    }
    if (!rows.length) throw badRequest('Provide an array of rows, a CSV string or a JSON string.')
    if (rows.length > 500) throw badRequest('Import at most 500 rows at a time.')

    const categories = new Map(all(`SELECT id, slug, lower(name) AS name FROM service_categories`).flatMap((row) => [[row.slug, row.id], [row.name, row.id]]))
    const offices = new Map(all(`SELECT id, slug, lower(name) AS name FROM government_offices`).flatMap((row) => [[row.slug, row.id], [row.name, row.id]]))
    const municipalities = new Map(all(`SELECT id, slug, lower(name) AS name FROM municipalities`).flatMap((row) => [[row.slug, row.id], [row.name, row.id]]))
    const existingTitles = new Set(all(`SELECT lower(title) AS title FROM government_services`).map((row) => row.title))
    const usedSlugs = new Set(all(`SELECT slug FROM government_services`).map((row) => row.slug))

    const results = rows.map((raw, index) => {
      const row = {}
      for (const [key, value] of Object.entries(raw || {})) row[String(key).trim().toLowerCase().replace(/\s+/g, '_')] = typeof value === 'string' ? value.trim() : value
      const errors = []
      const warnings = []
      const title = cleanText(row.service_name || row.title, 200)
      if (!title) errors.push('Service name is required.')
      else if (existingTitles.has(title.toLowerCase())) errors.push('A service with this name already exists.')
      const categoryKey = String(row.category || row.category_slug || '').toLowerCase()
      const categoryId = categories.get(categoryKey)
      if (!categoryKey) errors.push('Category is required.')
      else if (!categoryId) errors.push(`Unknown category: ${row.category}`)
      const officeKey = String(row.office || row.office_slug || '').toLowerCase()
      const officeId = officeKey ? offices.get(officeKey) : null
      if (officeKey && !officeId) warnings.push(`Unknown office: ${row.office}. The office will be left empty.`)
      const municipalityKey = String(row.municipality || '').toLowerCase()
      const municipalityId = municipalityKey ? municipalities.get(municipalityKey) : null
      if (municipalityKey && !municipalityId) warnings.push(`Unknown municipality: ${row.municipality}`)
      const sourceUrl = row.source_url ? safeUrl(row.source_url) : null
      if (row.source_url && !sourceUrl) errors.push('Source URL must be a valid http(s) URL.')
      const officialLink = row.official_link ? safeUrl(row.official_link) : null
      if (row.official_link && !officialLink) errors.push('Application link must be a valid http(s) URL.')
      if (!row.source_reference && !sourceUrl) warnings.push('No source reference or source URL was supplied. The draft will be marked pending verification.')
      let feeCents = null
      if (row.fee !== undefined && row.fee !== '' && row.fee !== null) {
        const fee = Number(String(row.fee).replace(/[^0-9.]/g, ''))
        if (!Number.isFinite(fee) || fee < 0) errors.push('Fee must be a non-negative number.')
        else feeCents = Math.round(fee * 100)
      }
      const availability = AVAILABILITY[String(row.availability_status || '').trim()] ? String(row.availability_status).trim() : 'needs_confirmation'
      const scope = SERVICE_SCOPES[String(row.service_scope || '').trim()] ? String(row.service_scope).trim() : 'province_wide'
      const baseSlug = uniqueSlug(run, get, 'government_services', 'slug', title || `import-${index + 1}`)
      let importSlug = baseSlug
      let suffix = 2
      while (usedSlugs.has(importSlug)) importSlug = `${baseSlug}-${suffix++}`
      usedSlugs.add(importSlug)
      return {
        row: index + 1,
        title,
        slug: importSlug,
        category_id: categoryId || null,
        office_id: officeId || null,
        municipality_id: municipalityId || null,
        availability_status: availability,
        service_scope: scope,
        short_description: cleanText(row.short_description || row.description, 600),
        description: cleanText(row.description, 8000),
        eligibility: cleanText(row.eligibility, 6000),
        source_reference: cleanText(row.source_reference, 500),
        source_url: sourceUrl,
        official_link: officialLink,
        fee_cents: feeCents,
        errors,
        warnings,
        valid: errors.length === 0,
      }
    })

    if (dryRun) {
      return res.json({
        dry_run: true,
        total: results.length,
        valid: results.filter((row) => row.valid).length,
        invalid: results.filter((row) => !row.valid).length,
        results,
        message: 'Validation only. No records were created.',
      })
    }

    const created = []
    for (const item of results.filter((row) => row.valid)) {
      const result = run(
        `INSERT INTO government_services
          (title, slug, description, short_description, eligibility, category_id, office_id, municipality_id,
           availability_status, service_scope, coverage_type, verification_status, publication_status,
           source_reference, source_url, official_link, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'province_wide', 'pending', 'draft', ?, ?, ?, ?, ?)`,
        [
          item.title,
          item.slug,
          item.description,
          item.short_description,
          item.eligibility,
          item.category_id,
          item.office_id,
          item.municipality_id,
          item.availability_status,
          item.service_scope,
          item.source_reference,
          item.source_url,
          item.official_link,
          req.user.id,
          req.user.id,
        ],
      )
      const id = Number(result.lastInsertRowid)
      if (item.fee_cents !== null) {
        run(`INSERT INTO service_fees (service_id, fee_name, amount_cents, fee_type) VALUES (?, 'Imported fee', ?, 'fixed')`, [id, item.fee_cents])
      }
      created.push(id)
    }
    logAudit(req, { action: 'services.imported', module: 'services', entityType: 'service_import', newValues: { created: created.length } })
    res.status(201).json({
      dry_run: false,
      created: created.length,
      skipped: results.length - created.length,
      message: `${created.length} draft service record(s) imported. They are not published and still need verification.`,
    })
  }),
)

adminServicesRouter.get(
  '/services',
  requirePermission(...VIEW),
  asyncHandler(async (req, res) => {
    const contextValue = context(req)
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const clauses = ['1 = 1']
    const params = []
    if (req.query.status) {
      clauses.push(`s.publication_status = ?`)
      params.push(String(req.query.status))
    }
    if (req.query.verification) {
      clauses.push(`s.verification_status = ?`)
      params.push(String(req.query.verification))
    }
    if (req.query.availability) {
      clauses.push(`s.availability_status = ?`)
      params.push(String(req.query.availability))
    }
    if (req.query.category) {
      clauses.push(`s.category_id = ?`)
      params.push(Number(req.query.category))
    }
    if (req.query.q) {
      clauses.push(`(lower(s.title) LIKE ? OR lower(COALESCE(s.short_description,'')) LIKE ? OR lower(COALESCE(s.description,'')) LIKE ?)`)
      const like = `%${String(req.query.q).toLowerCase()}%`
      params.push(like, like, like)
    }
    if (!contextValue.hasGlobalScope) {
      if (!contextValue.municipalityIds.length) clauses.push('1 = 0')
      else {
        clauses.push(
          `(s.municipality_id IN (${contextValue.municipalityIds.map(() => '?').join(',')})
            OR EXISTS (SELECT 1 FROM service_coverage sc WHERE sc.service_id = s.id AND sc.municipality_id IN (${contextValue.municipalityIds.map(() => '?').join(',')})))`,
        )
        params.push(...contextValue.municipalityIds, ...contextValue.municipalityIds)
      }
    }
    const where = clauses.join(' AND ')
    const total = Number(get(`SELECT COUNT(*) AS n FROM government_services s WHERE ${where}`, params).n)
    const results = all(
      `SELECT s.*, c.name AS category_name, o.name AS office_name, m.name AS municipality_name,
              (SELECT COUNT(*) FROM service_requirements r WHERE r.service_id = s.id) AS requirement_count
       FROM government_services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       LEFT JOIN government_offices o ON o.id = s.office_id
       LEFT JOIN municipalities m ON m.id = s.municipality_id
       WHERE ${where} ORDER BY s.updated_at DESC, s.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    )
    res.json({
      results,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      statuses: WORKFLOW_LABELS,
      availabilityOptions: AVAILABILITY,
      verificationOptions: SERVICE_VERIFICATION,
      scopeOptions: SERVICE_SCOPES,
    })
  }),
)

adminServicesRouter.post(
  '/services',
  requirePermission(...CREATE),
  asyncHandler(async (req, res) => {
    const contextValue = context(req)
    const payload = servicePayload(req)
    if (payload.municipality_id == null && !contextValue.hasGlobalScope) {
      throw forbidden('Select your municipality. Only province-wide administrators may create province-wide records.')
    }
    if (payload.municipality_id != null && !canUseMunicipality(contextValue, payload.municipality_id)) {
      throw forbidden('That municipality is outside your scope.')
    }
    payload.slug = uniqueSlug(run, get, 'government_services', 'slug', payload.slug || payload.title)
    payload.publication_status = 'draft'
    payload.verification_status = payload.verification_status || 'pending'
    payload.availability_status = payload.availability_status || 'needs_confirmation'
    payload.service_scope = payload.service_scope || 'province_wide'
    payload.created_by = req.user.id
    payload.updated_by = req.user.id
    const columns = Object.keys(payload)
    const result = run(
      `INSERT INTO government_services (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map((column) => payload[column]),
    )
    const id = Number(result.lastInsertRowid)
    const created = get(`SELECT * FROM government_services WHERE id = ?`, [id])
    recordRevision(created, req.user.id, 'Record created')
    recordWorkflow(run, { contentType: 'Service', contentId: id, from: null, to: 'draft', actorId: req.user.id, note: 'Created' })
    logAudit(req, { action: 'services.created', module: 'services', entityType: 'government_services', entityId: id, newValues: { title: payload.title } })
    res.status(201).json({ message: 'Service record created as a draft.', id, record: created })
  }),
)

adminServicesRouter.get(
  '/services/:id',
  requirePermission(...VIEW),
  asyncHandler(async (req, res) => {
    const { service } = loadService(req, VIEW)
    res.json({
      record: service,
      requirements: all(`SELECT * FROM service_requirements WHERE service_id = ? ORDER BY is_required DESC, sort_order, id`, [service.id]),
      procedures: all(`SELECT * FROM service_procedures WHERE service_id = ? ORDER BY step_number, id`, [service.id]),
      fees: all(`SELECT * FROM service_fees WHERE service_id = ? ORDER BY sort_order, id`, [service.id]),
      processing: all(`SELECT * FROM service_processing WHERE service_id = ? ORDER BY id`, [service.id]),
      coverage: all(
        `SELECT sc.*, m.name AS municipality_name, b.name AS barangay_name FROM service_coverage sc
         LEFT JOIN municipalities m ON m.id = sc.municipality_id LEFT JOIN barangays b ON b.id = sc.barangay_id
         WHERE sc.service_id = ? ORDER BY m.sort_order`,
        [service.id],
      ),
      documents: all(`SELECT * FROM service_documents WHERE service_id = ? ORDER BY sort_order, id`, [service.id]),
      faqs: all(`SELECT * FROM service_faqs WHERE service_id = ? ORDER BY sort_order, id`, [service.id]),
      revisions: all(`SELECT id, revision_number, editor_id, change_summary, created_at FROM service_revisions WHERE service_id = ? ORDER BY revision_number DESC`, [service.id]),
      workflow: all(`SELECT * FROM workflow_events WHERE content_type = 'Service' AND content_id = ? ORDER BY id DESC LIMIT 30`, [service.id]),
      sources: all(`SELECT id, name, organization, url, verification_status, verified_at, next_review_at FROM service_sources ORDER BY name`),
      statuses: WORKFLOW_LABELS,
      availabilityOptions: AVAILABILITY,
      verificationOptions: SERVICE_VERIFICATION,
      scopeOptions: SERVICE_SCOPES,
    })
  }),
)

adminServicesRouter.patch(
  '/services/:id',
  requirePermission(...UPDATE),
  asyncHandler(async (req, res) => {
    const { contextValue, service } = loadService(req, UPDATE)
    if (service.publication_status === 'published' && !hasAnyPermission(contextValue, PUBLISH)) {
      throw forbidden('Published records can only be changed by a user with publish permission.')
    }
    const payload = servicePayload(req, { partial: true })
    if (payload.municipality_id !== undefined && payload.municipality_id !== null && !canUseMunicipality(contextValue, payload.municipality_id)) {
      throw forbidden('That municipality is outside your scope.')
    }
    if (payload.municipality_id === null && !contextValue.hasGlobalScope) throw forbidden('Only province-wide administrators may clear the municipality.')
    if (payload.slug) payload.slug = uniqueSlug(run, get, 'government_services', 'slug', payload.slug, service.id)
    recordRevision(service, req.user.id, 'Updated before edit')
    payload.updated_by = req.user.id
    payload.updated_at = nowIso()
    payload.version_number = Number(service.version_number || 1) + 1
    run(`UPDATE government_services SET ${Object.keys(payload).map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, [
      ...Object.values(payload),
      service.id,
    ])
    if (service.publication_status === 'published') {
      const summary = cleanText(req.body?.change_summary, 500) || 'Service information updated.'
      run(`INSERT INTO service_updates (service_id, summary, change_type, published_by) VALUES (?, ?, 'information_update', ?)`, [service.id, summary, req.user.id])
      notifySubscribers(service, summary)
    }
    logAudit(req, { action: 'services.updated', module: 'services', entityType: 'government_services', entityId: service.id })
    res.json({ message: 'Service record updated.', record: get(`SELECT * FROM government_services WHERE id = ?`, [service.id]) })
  }),
)

adminServicesRouter.post(
  '/services/:id/status',
  asyncHandler(async (req, res) => {
    const { contextValue, service } = loadService(req, ['services.view', 'content.view'])
    const next = cleanText(req.body?.status, 40)
    if (!next || !WORKFLOW_LABELS[next]) throw badRequest('Unknown workflow status.')
    if (!(WORKFLOW[service.publication_status] || []).includes(next)) {
      throw badRequest(`Cannot move a record from ${service.publication_status} to ${next}.`)
    }
    const required = next === 'published' ? PUBLISH : next === 'archived' ? ARCHIVE : APPROVE
    if (!hasAnyPermission(contextValue, required)) {
      throw forbidden(`You do not have permission to move a record to ${next}.`)
    }
    // Separation of duties: an editor cannot approve or publish their own work.
    if (['approved', 'published', 'rejected'].includes(next) && Number(service.created_by) === Number(req.user.id) && !contextValue.isSuperAdmin) {
      throw forbidden('You cannot approve or publish a record you created. Ask another reviewer.')
    }
    const payload = { publication_status: next, updated_by: req.user.id, updated_at: nowIso() }
    if (next === 'published') payload.published_at = service.published_at || nowIso()
    if (next === 'archived') payload.archived_at = nowIso()
    run(`UPDATE government_services SET ${Object.keys(payload).map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, [
      ...Object.values(payload),
      service.id,
    ])
    recordWorkflow(run, {
      contentType: 'Service',
      contentId: service.id,
      from: service.publication_status,
      to: next,
      actorId: req.user.id,
      note: cleanText(req.body?.note, 1000),
    })
    if (next === 'published') {
      const summary = cleanText(req.body?.note, 500) || 'Service information published.'
      run(`INSERT INTO service_updates (service_id, summary, change_type, published_by) VALUES (?, ?, 'published', ?)`, [service.id, summary, req.user.id])
      notifySubscribers(service, summary)
    }
    logAudit(req, {
      action: `services.${next}`,
      module: 'services',
      entityType: 'government_services',
      entityId: service.id,
      oldValues: { status: service.publication_status },
      newValues: { status: next },
    })
    res.json({ message: `Record moved to ${WORKFLOW_LABELS[next]}.`, record: get(`SELECT * FROM government_services WHERE id = ?`, [service.id]) })
  }),
)

adminServicesRouter.post(
  '/services/:id/verify',
  requirePermission('services.verify'),
  asyncHandler(async (req, res) => {
    const { contextValue, service } = loadService(req, ['services.verify'])
    const status = cleanText(req.body?.verification_status, 40) || 'verified'
    if (!SERVICE_VERIFICATION[status]) throw badRequest('Unknown verification status.')
    const sourceId = req.body?.source_id ? Number(req.body.source_id) : service.source_id
    let source = null
    if (sourceId) {
      source = get(`SELECT * FROM service_sources WHERE id = ?`, [sourceId])
      if (!source) throw badRequest('The selected source does not exist.')
    }
    if (status === 'verified' && !source && !cleanText(req.body?.source_reference, 500) && !safeUrl(req.body?.source_url)) {
      throw badRequest('A verified record needs an identified source (registry entry or source URL).')
    }
    const notes = cleanText(req.body?.verification_notes, 2000)
    run(
      `UPDATE government_services SET verification_status = ?, verified_at = ?, verified_by = ?, reviewed_by = ?, last_reviewed_at = ?,
        next_review_at = ?, source_id = ?, source_reference = COALESCE(?, source_reference), source_url = COALESCE(?, source_url),
        verification_notes = COALESCE(?, verification_notes), updated_by = ?, updated_at = ? WHERE id = ?`,
      [
        status,
        status === 'verified' ? nowIso() : service.verified_at,
        req.user.id,
        req.user.id,
        nowIso(),
        cleanText(req.body?.next_review_at, 40) || service.next_review_at,
        sourceId || null,
        cleanText(req.body?.source_reference, 500),
        safeUrl(req.body?.source_url),
        notes,
        req.user.id,
        nowIso(),
        service.id,
      ],
    )
    logAudit(req, {
      action: `services.verification_${status}`,
      module: 'services',
      entityType: 'government_services',
      entityId: service.id,
      oldValues: { verification_status: service.verification_status },
      newValues: { verification_status: status },
    })
    res.json({ message: `Verification recorded as ${SERVICE_VERIFICATION[status]}.`, record: get(`SELECT * FROM government_services WHERE id = ?`, [service.id]) })
  }),
)

adminServicesRouter.delete(
  '/services/:id',
  requirePermission(...ARCHIVE),
  asyncHandler(async (req, res) => {
    const { service } = loadService(req, ARCHIVE)
    run(`UPDATE government_services SET publication_status = 'archived', archived_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`, [
      nowIso(),
      nowIso(),
      req.user.id,
      service.id,
    ])
    logAudit(req, { action: 'services.archived', module: 'services', entityType: 'government_services', entityId: service.id })
    res.json({ message: 'Service archived. Records are never permanently deleted.' })
  }),
)

adminServicesRouter.post(
  '/services/:id/rollback',
  requirePermission(...UPDATE),
  asyncHandler(async (req, res) => {
    const { contextValue, service } = loadService(req, UPDATE)
    if (!hasAnyPermission(contextValue, ['content.approve', ...APPROVE]) && !contextValue.isSuperAdmin) {
      throw forbidden('Rolling back published information requires reviewer permission.')
    }
    const revision = get(`SELECT * FROM service_revisions WHERE id = ? AND service_id = ?`, [Number(req.body?.revision_id), service.id])
    if (!revision) throw notFound('That revision was not found.')
    const snapshot = JSON.parse(revision.snapshot)
    const allowed = ['title', 'slug', 'short_description', 'description', 'full_description', 'eligibility', 'service_type',
      'availability_status', 'service_scope', 'coverage_type', 'application_mode', 'source_reference', 'source_url',
      'official_link', 'category_id', 'office_id', 'department_id', 'municipality_id', 'payment_instructions']
    const payload = {}
    for (const key of allowed) if (snapshot[key] !== undefined) payload[key] = snapshot[key]
    recordRevision(service, req.user.id, `Before rollback to revision ${revision.revision_number}`)
    payload.updated_at = nowIso()
    payload.updated_by = req.user.id
    payload.version_number = Number(service.version_number || 1) + 1
    run(`UPDATE government_services SET ${Object.keys(payload).map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, [
      ...Object.values(payload),
      service.id,
    ])
    logAudit(req, {
      action: 'services.rolled_back',
      module: 'services',
      entityType: 'government_services',
      entityId: service.id,
      newValues: { revision: revision.revision_number },
    })
    res.json({ message: `Rolled back to revision ${revision.revision_number}.`, record: get(`SELECT * FROM government_services WHERE id = ?`, [service.id]) })
  }),
)

// ---------------------------------------------------------------------------
// Nested service information (requirements, procedures, fees, coverage, ...)
// ---------------------------------------------------------------------------
function parseMoney(value) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(String(value).replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(number) || number < 0) throw unprocessable('Enter a valid non-negative amount.')
  return Math.round(number * 100)
}

const NESTED = {
  requirements: {
    table: 'service_requirements',
    permission: ['services.requirements.manage', ...UPDATE],
    order: 'is_required DESC, sort_order, id',
    build: (body) => {
      const name = cleanText(body?.requirement_name, 200)
      if (!name) throw badRequest('A requirement name is required.')
      return {
        requirement_name: name,
        description: cleanText(body?.description, 2000),
        quantity: cleanText(body?.quantity, 60),
        accepted_format: cleanText(body?.accepted_format, 160),
        is_required: body?.is_required === false || body?.is_required === 'false' ? 0 : 1,
        sort_order: Number(body?.sort_order) || 0,
      }
    },
  },
  procedures: {
    table: 'service_procedures',
    permission: ['services.procedures.manage', ...UPDATE],
    order: 'step_number, id',
    build: (body) => {
      const title = cleanText(body?.title, 200)
      if (!title) throw badRequest('A step title is required.')
      const link = safeUrl(body?.link)
      if (body?.link && !link) throw unprocessable('Step links must be valid http(s) URLs.')
      return {
        step_number: Math.max(1, Number(body?.step_number) || 1),
        title,
        description: cleanText(body?.description, 3000),
        office: cleanText(body?.office, 200),
        location: cleanText(body?.location, 200),
        link,
        additional_instructions: cleanText(body?.additional_instructions, 2000),
        responsible_office_id: body?.responsible_office_id ? Number(body.responsible_office_id) : null,
      }
    },
  },
  fees: {
    table: 'service_fees',
    permission: ['services.fees.manage', ...UPDATE],
    order: 'sort_order, id',
    build: (body) => {
      const name = cleanText(body?.fee_name, 160)
      if (!name) throw badRequest('A fee name is required.')
      return {
        fee_name: name,
        amount_cents: parseMoney(body?.amount),
        currency: 'PHP',
        fee_type: cleanText(body?.fee_type, 40) || 'fixed',
        conditions: cleanText(body?.conditions, 1000),
        source_reference: cleanText(body?.source_reference, 500),
        source_url: safeUrl(body?.source_url),
        last_verified_at: cleanText(body?.last_verified_at, 40),
        sort_order: Number(body?.sort_order) || 0,
      }
    },
  },
  processing: {
    table: 'service_processing',
    permission: ['services.coverage.manage', ...UPDATE],
    order: 'id',
    build: (body) => {
      const time = cleanText(body?.processing_time, 160)
      if (!time) throw badRequest('A processing time is required.')
      return {
        processing_time: time,
        processing_unit: cleanText(body?.processing_unit, 60) || 'working days',
        conditions: cleanText(body?.conditions, 1000),
        source_reference: cleanText(body?.source_reference, 500),
        last_verified_at: cleanText(body?.last_verified_at, 40),
      }
    },
  },
  documents: {
    table: 'service_documents',
    permission: ['services.documents.manage', ...UPDATE],
    order: 'sort_order, id',
    build: (body) => {
      const title = cleanText(body?.document_title, 200)
      if (!title) throw badRequest('A document title is required.')
      const url = safeUrl(body?.external_url)
      if (body?.external_url && !url) throw unprocessable('Document links must be valid http(s) URLs.')
      return {
        document_title: title,
        document_type: cleanText(body?.document_type, 40) || 'form',
        file_reference: cleanText(body?.file_reference, 500),
        external_url: url,
        publication_date: cleanText(body?.publication_date, 40),
        status: body?.status === 'draft' ? 'draft' : 'published',
        sort_order: Number(body?.sort_order) || 0,
      }
    },
  },
  faqs: {
    table: 'service_faqs',
    permission: ['services.categories.update', ...UPDATE],
    order: 'sort_order, id',
    build: (body) => {
      const question = cleanText(body?.question, 400)
      const answer = cleanText(body?.answer, 4000)
      if (!question || !answer) throw badRequest('Both a question and an answer are required.')
      return {
        question,
        answer,
        sort_order: Number(body?.sort_order) || 0,
        status: body?.status === 'draft' ? 'draft' : 'published',
      }
    },
  },
  coverage: {
    table: 'service_coverage',
    permission: ['services.coverage.manage', ...UPDATE],
    order: 'id',
    build: (body) => {
      const municipalityId = body?.municipality_id ? Number(body.municipality_id) : null
      const barangayId = body?.barangay_id ? Number(body.barangay_id) : null
      if (municipalityId && !get(`SELECT id FROM municipalities WHERE id = ?`, [municipalityId])) throw badRequest('Unknown municipality.')
      if (barangayId && !get(`SELECT id FROM barangays WHERE id = ?`, [barangayId])) throw badRequest('Unknown barangay.')
      return {
        municipality_id: municipalityId,
        barangay_id: barangayId,
        availability_status: AVAILABILITY[body?.availability_status] ? body.availability_status : 'available',
        local_instructions: cleanText(body?.local_instructions, 2000),
        office_id: body?.office_id ? Number(body.office_id) : null,
      }
    },
  },
}

for (const [segment, config] of Object.entries(NESTED)) {
  adminServicesRouter.get(
    `/services/:id/${segment}`,
    requirePermission(...VIEW),
    asyncHandler(async (req, res) => {
      const { service } = loadService(req, VIEW)
      res.json({ results: all(`SELECT * FROM ${config.table} WHERE service_id = ? ORDER BY ${config.order}`, [service.id]) })
    }),
  )

  adminServicesRouter.post(
    `/services/:id/${segment}`,
    requirePermission(...config.permission),
    asyncHandler(async (req, res) => {
      const { contextValue, service } = loadService(req, config.permission)
      const payload = config.build(req.body)
      if (segment === 'coverage' && payload.municipality_id && !canUseMunicipality(contextValue, payload.municipality_id)) {
        throw forbidden('That municipality is outside your scope.')
      }
      if (segment === 'coverage') {
        if (!payload.municipality_id && !contextValue.hasGlobalScope) throw forbidden('Choose a municipality within your scope.')
        const duplicate = get(
          `SELECT id FROM service_coverage WHERE service_id = ? AND COALESCE(municipality_id, 0) = COALESCE(?, 0) AND COALESCE(barangay_id, 0) = COALESCE(?, 0)`,
          [service.id, payload.municipality_id, payload.barangay_id],
        )
        if (duplicate) throw badRequest('That coverage record already exists for this service.')
      }
      const columns = Object.keys(payload)
      const result = run(
        `INSERT INTO ${config.table} (service_id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`,
        [service.id, ...columns.map((column) => payload[column])],
      )
      logAudit(req, { action: `services.${segment}_added`, module: 'services', entityType: config.table, entityId: service.id })
      res.status(201).json({ message: 'Record added.', id: Number(result.lastInsertRowid) })
    }),
  )

  adminServicesRouter.patch(
    `/services/:id/${segment}/:itemId`,
    requirePermission(...config.permission),
    asyncHandler(async (req, res) => {
      const { service } = loadService(req, config.permission)
      const existing = get(`SELECT * FROM ${config.table} WHERE id = ? AND service_id = ?`, [Number(req.params.itemId), service.id])
      if (!existing) throw notFound('Record not found.')
      const payload = config.build(req.body)
      run(`UPDATE ${config.table} SET ${Object.keys(payload).map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, [
        ...Object.values(payload),
        existing.id,
      ])
      logAudit(req, { action: `services.${segment}_updated`, module: 'services', entityType: config.table, entityId: service.id })
      res.json({ message: 'Record updated.', record: get(`SELECT * FROM ${config.table} WHERE id = ?`, [existing.id]) })
    }),
  )

  adminServicesRouter.delete(
    `/services/:id/${segment}/:itemId`,
    requirePermission(...config.permission),
    asyncHandler(async (req, res) => {
      const { service } = loadService(req, config.permission)
      run(`DELETE FROM ${config.table} WHERE id = ? AND service_id = ?`, [Number(req.params.itemId), service.id])
      logAudit(req, { action: `services.${segment}_removed`, module: 'services', entityType: config.table, entityId: service.id })
      res.json({ message: 'Record removed.' })
    }),
  )
}

// ---------------------------------------------------------------------------
// Feedback moderation
// ---------------------------------------------------------------------------
adminServicesRouter.get(
  '/service-feedback',
  requirePermission('services.feedback.moderate', ...VIEW),
  asyncHandler(async (req, res) => {
    const clauses = ['1 = 1']
    const params = []
    if (req.query.status) {
      clauses.push('f.status = ?')
      params.push(String(req.query.status))
    }
    if (req.query.service) {
      clauses.push('s.slug = ?')
      params.push(String(req.query.service))
    }
    const contextValue = context(req)
    if (!contextValue.hasGlobalScope) {
      if (!contextValue.municipalityIds.length) clauses.push('1 = 0')
      else {
        clauses.push(
          `(s.municipality_id IN (${contextValue.municipalityIds.map(() => '?').join(',')})
            OR EXISTS (SELECT 1 FROM service_coverage sc WHERE sc.service_id = s.id AND sc.municipality_id IN (${contextValue.municipalityIds.map(() => '?').join(',')})))`,
        )
        params.push(...contextValue.municipalityIds, ...contextValue.municipalityIds)
      }
    }
    const rows = all(
      `SELECT f.id, f.rating, f.comment, f.status, f.is_public, f.admin_note, f.created_at, f.moderated_at,
              s.title AS service_title, s.slug AS service_slug, s.municipality_id
       FROM service_feedback f JOIN government_services s ON s.id = f.service_id
       WHERE ${clauses.join(' AND ')} ORDER BY f.created_at DESC LIMIT 200`,
      params,
    )
    res.json({ results: rows, total: rows.length, statuses: ['pending', 'approved', 'rejected', 'archived'] })
  }),
)

adminServicesRouter.patch(
  '/service-feedback/:id',
  requirePermission('services.feedback.moderate'),
  asyncHandler(async (req, res) => {
    const feedback = get(`SELECT f.*, s.municipality_id, s.title FROM service_feedback f JOIN government_services s ON s.id = f.service_id WHERE f.id = ?`, [
      Number(req.params.id),
    ])
    if (!feedback) throw notFound('Feedback not found.')
    const contextValue = context(req)
    if (!contextValue.hasGlobalScope && feedback.municipality_id && !canUseMunicipality(contextValue, feedback.municipality_id)) {
      throw forbidden('This feedback belongs to a service outside your scope.')
    }
    const status = ['pending', 'approved', 'rejected', 'archived'].includes(req.body?.status) ? req.body.status : feedback.status
    const isPublic = req.body?.is_public === undefined ? feedback.is_public : req.body.is_public ? 1 : 0
    run(`UPDATE service_feedback SET status = ?, is_public = ?, admin_note = COALESCE(?, admin_note), moderated_by = ?, moderated_at = ? WHERE id = ?`, [
      status,
      isPublic,
      cleanText(req.body?.admin_note, 1000),
      req.user.id,
      nowIso(),
      feedback.id,
    ])
    logAudit(req, { action: 'services.feedback_moderated', module: 'services', entityType: 'service_feedback', entityId: feedback.id, newValues: { status, is_public: isPublic } })
    res.json({ message: 'Feedback updated.', record: get(`SELECT * FROM service_feedback WHERE id = ?`, [feedback.id]) })
  }),
)

// ---------------------------------------------------------------------------
// Official sources
// ---------------------------------------------------------------------------
adminServicesRouter.get(
  '/service-sources',
  requirePermission('services.sources.manage', ...VIEW),
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(
        `SELECT s.*, u.name AS verified_by_name,
          (SELECT COUNT(*) FROM government_services g WHERE g.source_id = s.id) AS service_count
         FROM service_sources s LEFT JOIN users u ON u.id = s.verified_by ORDER BY s.name`,
      ),
    })
  }),
)

adminServicesRouter.post(
  '/service-sources',
  requirePermission('services.sources.manage'),
  asyncHandler(async (req, res) => {
    const name = cleanText(req.body?.name, 200)
    if (!name) throw badRequest('A source name is required.')
    const url = safeUrl(req.body?.url)
    if (req.body?.url && !url) throw unprocessable('Source URLs must be valid http(s) URLs.')
    if (!url && !cleanText(req.body?.document_reference, 300)) {
      throw badRequest('Record either a source URL or a document reference so the source can be checked.')
    }
    const result = run(
      `INSERT INTO service_sources (name, organization, source_type, url, document_reference, description, next_review_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        cleanText(req.body?.organization, 200),
        cleanText(req.body?.source_type, 40) || 'official_website',
        url,
        cleanText(req.body?.document_reference, 300),
        cleanText(req.body?.description, 1000),
        cleanText(req.body?.next_review_at, 40),
        req.user.id,
      ],
    )
    logAudit(req, { action: 'services.source_created', module: 'services', entityType: 'service_sources', entityId: Number(result.lastInsertRowid) })
    res.status(201).json({ message: 'Source recorded as pending verification.', id: Number(result.lastInsertRowid) })
  }),
)

adminServicesRouter.patch(
  '/service-sources/:id',
  requirePermission('services.sources.manage', 'services.verify'),
  asyncHandler(async (req, res) => {
    const source = get(`SELECT * FROM service_sources WHERE id = ?`, [Number(req.params.id)])
    if (!source) throw notFound('Source not found.')
    const status = SERVICE_VERIFICATION[req.body?.verification_status] ? req.body.verification_status : source.verification_status
    const payload = {
      name: req.body?.name !== undefined ? cleanText(req.body.name, 200) : source.name,
      organization: req.body?.organization !== undefined ? cleanText(req.body.organization, 200) : source.organization,
      url: req.body?.url !== undefined ? safeUrl(req.body.url) : source.url,
      document_reference: req.body?.document_reference !== undefined ? cleanText(req.body.document_reference, 300) : source.document_reference,
      next_review_at: req.body?.next_review_at !== undefined ? cleanText(req.body.next_review_at, 40) : source.next_review_at,
      verification_status: status,
      verified_at: status === 'verified' ? nowIso() : source.verified_at,
      verified_by: status === 'verified' ? req.user.id : source.verified_by,
      updated_at: nowIso(),
    }
    run(
      `UPDATE service_sources SET name = ?, organization = ?, url = ?, document_reference = ?, next_review_at = ?,
        verification_status = ?, verified_at = ?, verified_by = ?, updated_at = ? WHERE id = ?`,
      [payload.name, payload.organization, payload.url, payload.document_reference, payload.next_review_at,
        payload.verification_status, payload.verified_at, payload.verified_by, payload.updated_at, source.id],
    )
    logAudit(req, { action: 'services.source_updated', module: 'services', entityType: 'service_sources', entityId: source.id })
    res.json({ message: 'Source updated.', record: get(`SELECT * FROM service_sources WHERE id = ?`, [source.id]) })
  }),
)

// ---------------------------------------------------------------------------
// Public API keys (optional; no key is created automatically)
// ---------------------------------------------------------------------------
adminServicesRouter.get(
  '/api-keys',
  requirePermission('api.keys.manage'),
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(
        `SELECT c.id, c.name, c.key_prefix, c.scopes, c.status, c.last_used_at, c.created_at, c.revoked_at, u.name AS created_by_name
         FROM api_clients c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.id DESC`,
      ),
      note: 'Keys are shown once when created. Only a hash is stored.',
    })
  }),
)

adminServicesRouter.post(
  '/api-keys',
  requirePermission('api.keys.manage'),
  asyncHandler(async (req, res) => {
    const name = cleanText(req.body?.name, 120)
    if (!name) throw badRequest('A key label is required.')
    const raw = `bgm_${crypto.randomBytes(24).toString('hex')}`
    const prefix = raw.slice(0, 12)
    const hash = crypto.createHash('sha256').update(raw).digest('hex')
    const result = run(`INSERT INTO api_clients (name, key_prefix, key_hash, scopes, created_by) VALUES (?, ?, ?, ?, ?)`, [
      name,
      prefix,
      hash,
      cleanText(req.body?.scopes, 200) || 'services.read',
      req.user.id,
    ])
    logAudit(req, { action: 'api.key_created', module: 'api', entityType: 'api_clients', entityId: Number(result.lastInsertRowid) })
    res.status(201).json({
      message: 'API key created. Copy it now: it will not be shown again.',
      api_key: raw,
      id: Number(result.lastInsertRowid),
    })
  }),
)

adminServicesRouter.post(
  '/api-keys/:id/revoke',
  requirePermission('api.keys.manage'),
  asyncHandler(async (req, res) => {
    const client = get(`SELECT * FROM api_clients WHERE id = ?`, [Number(req.params.id)])
    if (!client) throw notFound('API key not found.')
    run(`UPDATE api_clients SET status = 'revoked', revoked_at = ? WHERE id = ?`, [nowIso(), client.id])
    logAudit(req, { action: 'api.key_revoked', module: 'api', entityType: 'api_clients', entityId: client.id })
    res.json({ message: 'API key revoked.' })
  }),
)

/** Minimal RFC-4180-ish CSV parser used by the import preview. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      field = ''
      if (row.some((value) => value.trim() !== '')) rows.push(row)
      row = []
    } else if (char !== '\r') field += char
  }
  row.push(field)
  if (row.some((value) => value.trim() !== '')) rows.push(row)
  if (rows.length < 2) return []
  const headers = rows[0].map((header) => header.trim())
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}
