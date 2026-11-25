/**
 * Citizen service discovery, explained recommendations and the guided finder
 * (Prompt 72).
 *
 * Only published service records are exposed. Recommendations are rules-based
 * on stored preferences and activity, and every item carries a reason. A
 * missing municipality coverage record never means "unavailable".
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission } from '../rbac.js'
import { asyncHandler, cleanText, forbidden, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { capabilityFor, capabilityMeta } from '../lib/citizen.js'

export const discoveryRouter = Router()
discoveryRouter.use(requireAuth)

const PUBLISHED = `s.publication_status = 'published' AND s.archived_at IS NULL`

function presentService(row) {
  const capability = capabilityFor(row)
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.short_description || row.description || null,
    categoryName: row.category_name || null,
    categoryKey: row.category_slug || null,
    municipalityName: row.municipality_name || null,
    municipalityId: row.municipality_id || null,
    officeName: row.office_name || null,
    isOnline: Boolean(row.is_online),
    officialLink: row.official_link || null,
    applicationMode: row.application_mode || null,
    availability: row.availability_status || null,
    capability,
    capabilityLabel: capabilityMeta(capability).label,
    url: `/services/${row.slug}`,
    sourceUrl: row.source_url || null,
  }
}

function baseServiceQuery() {
  return `SELECT s.*, c.name AS category_name, c.slug AS category_slug, m.name AS municipality_name,
                 o.name AS office_name
          FROM government_services s
          LEFT JOIN service_categories c ON c.id = s.category_id
          LEFT JOIN municipalities m ON m.id = s.municipality_id
          LEFT JOIN service_procedures sp ON sp.service_id = s.id
          LEFT JOIN government_offices o ON o.id = sp.responsible_office_id`
}

function serviceFilter(query, profileMunicipalityId) {
  const clauses = [PUBLISHED]
  const params = []
  const term = cleanText(query.q, 120)
  if (term) {
    clauses.push('(s.title LIKE ? OR s.description LIKE ? OR s.short_description LIKE ?)')
    params.push(`%${term}%`, `%${term}%`, `%${term}%`)
  }
  if (query.category) {
    clauses.push('c.slug = ?')
    params.push(String(query.category))
  }
  if (query.municipalityId) {
    clauses.push(`(s.municipality_id = ? OR s.service_scope IN ('province_wide','online_province_wide')
      OR EXISTS (SELECT 1 FROM service_coverage sc WHERE sc.service_id = s.id AND sc.municipality_id = ?))`)
    params.push(Number(query.municipalityId), Number(query.municipalityId))
  }
  if (query.officeId) {
    clauses.push('sp.responsible_office_id = ?')
    params.push(Number(query.officeId))
  }
  if (String(query.online) === '1') clauses.push('s.is_online = 1')
  if (query.mode) {
    clauses.push('s.application_mode = ?')
    params.push(String(query.mode))
  }
  if (query.availability) {
    clauses.push('s.availability_status = ?')
    params.push(String(query.availability))
  }
  return { clauses, params, term }
}

discoveryRouter.get(
  '/discovery/services',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12))
    const { clauses, params } = serviceFilter(req.query)
    const sort = ['relevance', 'title', 'newest'].includes(String(req.query.sort)) ? String(req.query.sort) : 'relevance'
    const total = Number(get(`SELECT COUNT(DISTINCT s.id) AS n FROM government_services s LEFT JOIN service_categories c ON c.id = s.category_id LEFT JOIN service_procedures sp ON sp.service_id = s.id WHERE ${clauses.join(' AND ')}`, params).n)
    const rows = all(
      `${baseServiceQuery()} WHERE ${clauses.join(' AND ')}
       GROUP BY s.id
       ORDER BY ${sort === 'title' ? 's.title ASC' : sort === 'newest' ? 's.published_at DESC' : 's.is_featured DESC, s.title ASC'}
       LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    )
    res.json({
      results: rows.map(presentService),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      filters: {
        categories: all(`SELECT name, slug FROM service_categories WHERE status = 'active' ORDER BY name`),
        municipalities: all(`SELECT id, name, slug FROM municipalities ORDER BY name`),
      },
      note: 'Search covers published service information only. A missing coverage record does not mean a service is unavailable; confirm with the responsible office.',
    })
  }),
)

discoveryRouter.get(
  '/discovery/services/:slug/related',
  asyncHandler(async (req, res) => {
    const service = get(`${baseServiceQuery()} WHERE s.slug = ? AND ${PUBLISHED} GROUP BY s.id`, [String(req.params.slug)])
    if (!service) throw notFound('Service not found.')
    const explicit = all(
      `SELECT s.*, c.name AS category_name, c.slug AS category_slug, m.name AS municipality_name, r.relationship, r.note
       FROM service_relationships r JOIN government_services s ON s.id = r.related_service_id
       LEFT JOIN service_categories c ON c.id = s.category_id LEFT JOIN municipalities m ON m.id = s.municipality_id
       WHERE r.service_id = ? AND ${PUBLISHED} LIMIT 8`,
      [service.id],
    )
    const sameCategory = all(
      `${baseServiceQuery()} WHERE ${PUBLISHED} AND s.category_id = ? AND s.id <> ? GROUP BY s.id LIMIT 6`,
      [service.category_id, service.id],
    )
    const seen = new Set()
    const results = []
    for (const row of explicit) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      results.push({ ...presentService(row), reason: row.relationship === 'journey_next' ? 'Next step in a BetterGo information guide' : 'Related service recorded by BetterGo editors', note: row.note || null })
    }
    for (const row of sameCategory) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      results.push({ ...presentService(row), reason: 'Same service category', note: null })
    }
    res.json({ service: presentService(service), results, note: 'Related items are information links, not official procedures or mandatory sequences.' })
  }),
)

function preferenceOf(userId) {
  run(`INSERT OR IGNORE INTO discovery_preferences (user_id) VALUES (?)`, [userId])
  return get(`SELECT * FROM discovery_preferences WHERE user_id = ?`, [userId])
}

discoveryRouter.get(
  '/discovery',
  asyncHandler(async (req, res) => {
    const prefs = preferenceOf(req.user.id)
    const profile = get(`SELECT municipality_id FROM user_profiles WHERE user_id = ?`, [req.user.id])
    const municipalityId = profile?.municipality_id || null
    const municipality = municipalityId ? get(`SELECT name FROM municipalities WHERE id = ?`, [municipalityId]) : null

    const savedCategories = all(
      `SELECT DISTINCT s.category_id, c.name FROM saved_items si
       JOIN government_services s ON s.id = si.content_id AND si.content_type = 'service'
       LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE si.user_id = ? AND s.category_id IS NOT NULL`,
      [req.user.id],
    )
    const viewed = all(
      `SELECT entity_id, entity_label, MAX(created_at) AS viewed_at FROM citizen_activities
       WHERE user_id = ? AND activity_type = 'service_viewed' AND entity_id IS NOT NULL
       GROUP BY entity_id ORDER BY viewed_at DESC LIMIT 6`,
      [req.user.id],
    ).map((row) => ({ ...row, url: null }))

    const recommendations = []
    if (Number(prefs.personalization_enabled) === 1) {
      const candidates = all(
        `${baseServiceQuery()} WHERE ${PUBLISHED}
         ${municipalityId ? `AND (s.municipality_id = ? OR s.service_scope IN ('province_wide','online_province_wide')
            OR EXISTS (SELECT 1 FROM service_coverage sc WHERE sc.service_id = s.id AND sc.municipality_id = ?))` : ''}
         GROUP BY s.id ORDER BY s.is_featured DESC, s.published_at DESC LIMIT 12`,
        municipalityId ? [municipalityId, municipalityId] : [],
      )
      for (const row of candidates) {
        if (recommendations.some((entry) => entry.id === row.id)) continue
        const savedMatch = savedCategories.find((entry) => Number(entry.category_id) === Number(row.category_id))
        const viewedMatch = viewed.find((entry) => Number(entry.entity_id) === Number(row.id))
        let reason = null
        if (municipality && Number(row.municipality_id || municipalityId) === Number(municipalityId)) {
          reason = `Recommended because you selected ${municipality.name} as your municipality.`
        } else if (savedMatch) {
          reason = `Suggested because you saved services in ${savedMatch.name}.`
        } else if (viewedMatch) {
          reason = 'Related to a service you recently viewed.'
        }
        if (!reason) continue
        recommendations.push({ ...presentService(row), reason })
        if (recommendations.length >= 6) break
      }
    }

    const popular = all(
      `SELECT s.id, s.title, s.slug, s.short_description, COUNT(a.id) AS views
       FROM citizen_activities a JOIN government_services s ON s.id = a.entity_id
       WHERE a.activity_type = 'service_viewed' AND ${PUBLISHED}
       GROUP BY s.id HAVING COUNT(a.id) >= 2 ORDER BY views DESC LIMIT 6`,
    )

    const featured = all(`${baseServiceQuery()} WHERE ${PUBLISHED} AND s.is_featured = 1 GROUP BY s.id LIMIT 6`)

    const saved = all(
      `SELECT s.id, s.title, s.slug FROM saved_items si JOIN government_services s ON s.id = si.content_id
       WHERE si.user_id = ? AND si.content_type = 'service' AND ${PUBLISHED} ORDER BY si.created_at DESC LIMIT 6`,
      [req.user.id],
    )

    res.json({
      preferences: {
        personalizationEnabled: Number(prefs.personalization_enabled) === 1,
        historyEnabled: Number(prefs.history_enabled) === 1,
      },
      categories: all(`SELECT name, slug, (SELECT COUNT(*) FROM government_services s WHERE s.category_id = service_categories.id AND ${PUBLISHED}) AS total FROM service_categories WHERE status = 'active' ORDER BY name`),
      municipalities: all(`SELECT id, name, slug FROM municipalities ORDER BY name`),
      recommendations,
      popular: popular.map((row) => ({ ...row, reason: 'Popular on BetterGo based on recorded service views.' })),
      featured: featured.map((row) => ({ ...presentService(row), reason: 'Featured by BetterGo editors.' })),
      saved,
      recentlyViewed: viewed,
      note: 'Recommendations use only your municipality, saved categories and recorded views. They are not eligibility assessments and never use sensitive characteristics.',
    })
  }),
)

discoveryRouter.get(
  '/discovery/history',
  asyncHandler(async (req, res) => {
    const prefs = preferenceOf(req.user.id)
    res.json({
      historyEnabled: Number(prefs.history_enabled) === 1,
      results: all(
        `SELECT id, activity_type, entity_id, entity_label AS label, entity_slug AS slug, created_at
         FROM citizen_activities WHERE user_id = ? AND activity_type IN ('service_viewed') ORDER BY id DESC LIMIT 50`,
        [req.user.id],
      ),
    })
  }),
)

discoveryRouter.delete(
  '/discovery/history/:id',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT id FROM citizen_activities WHERE id = ? AND user_id = ? AND activity_type = 'service_viewed'`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('History entry not found.')
    run(`DELETE FROM citizen_activities WHERE id = ?`, [row.id])
    res.json({ message: 'History entry removed.' })
  }),
)

discoveryRouter.delete(
  '/discovery/history',
  asyncHandler(async (req, res) => {
    run(`DELETE FROM citizen_activities WHERE user_id = ? AND activity_type = 'service_viewed'`, [req.user.id])
    res.json({ message: 'Browsing history cleared.' })
  }),
)

discoveryRouter.put(
  '/discovery/preferences',
  validate(z.object({ personalizationEnabled: z.boolean().optional(), historyEnabled: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    preferenceOf(req.user.id)
    if (req.body.personalizationEnabled !== undefined) {
      run(`UPDATE discovery_preferences SET personalization_enabled = ?, updated_at = ? WHERE user_id = ?`, [
        req.body.personalizationEnabled ? 1 : 0,
        nowIso(),
        req.user.id,
      ])
    }
    if (req.body.historyEnabled !== undefined) {
      run(`UPDATE discovery_preferences SET history_enabled = ?, updated_at = ? WHERE user_id = ?`, [req.body.historyEnabled ? 1 : 0, nowIso(), req.user.id])
      if (!req.body.historyEnabled) run(`DELETE FROM citizen_activities WHERE user_id = ? AND activity_type = 'service_viewed'`, [req.user.id])
    }
    logAudit(req, { action: 'discovery.preferences_updated', module: 'discovery', entityType: 'user', entityId: req.user.id, newValues: req.body })
    const prefs = preferenceOf(req.user.id)
    res.json({ message: 'Discovery preferences saved.', personalizationEnabled: Number(prefs.personalization_enabled) === 1, historyEnabled: Number(prefs.history_enabled) === 1 })
  }),
)

discoveryRouter.get(
  '/discovery/finder',
  asyncHandler(async (_req, res) => {
    const stored = all(`SELECT question_key, label, question_type, options, sort_order FROM finder_questions WHERE active = 1 ORDER BY sort_order, id`)
    const categories = all(`SELECT name AS label, slug AS value FROM service_categories WHERE status = 'active' ORDER BY name`)
    const municipalities = all(`SELECT name AS label, id AS value FROM municipalities ORDER BY name`)
    const questions = stored.length
      ? stored.map((row) => ({ key: row.question_key, label: row.label, type: row.question_type, options: row.options ? JSON.parse(row.options) : null }))
      : [
          { key: 'category', label: 'What kind of service are you looking for?', type: 'single_choice', options: categories },
          { key: 'municipality', label: 'Which municipality are you interested in?', type: 'single_choice', options: municipalities },
          { key: 'preference', label: 'Do you prefer an online or in-person option?', type: 'single_choice', options: [{ value: 'online', label: 'Online if one exists' }, { value: 'in_person', label: 'In-person' }, { value: 'any', label: 'No preference' }] },
        ]
    res.json({
      questions,
      note: 'The finder is informational. It is not an official eligibility assessment and does not guarantee that a service applies to you.',
    })
  }),
)

discoveryRouter.post(
  '/discovery/finder',
  validate(z.object({ category: z.string().trim().max(80).optional(), municipalityId: z.coerce.number().int().positive().optional(), preference: z.enum(['online', 'in_person', 'any']).optional() })),
  asyncHandler(async (req, res) => {
    const { clauses, params } = serviceFilter({ category: req.body.category, municipalityId: req.body.municipalityId })
    if (req.body.preference === 'online') clauses.push('s.is_online = 1')
    const rows = all(`${baseServiceQuery()} WHERE ${clauses.join(' AND ')} GROUP BY s.id ORDER BY s.is_featured DESC, s.title ASC LIMIT 10`, params)
    res.json({
      results: rows.map((row) => ({
        ...presentService(row),
        reason: req.body.municipalityId
          ? 'Matches the municipality and category you chose in the finder.'
          : 'Matches the category you chose in the finder.',
      })),
      note: 'These are published services that match your answers. Confirm requirements and availability with the responsible office.',
    })
  }),
)

/* --------------------------- Admin configuration ------------------------ */

export const adminDiscoveryRouter = Router()
adminDiscoveryRouter.use(requireAuth, requireAdmin)

adminDiscoveryRouter.get(
  '/discovery',
  requirePermission('services.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      relationships: all(
        `SELECT r.*, a.title AS service_title, b.title AS related_title
         FROM service_relationships r JOIN government_services a ON a.id = r.service_id JOIN government_services b ON b.id = r.related_service_id
         ORDER BY r.id DESC LIMIT 100`,
      ),
      questions: all(`SELECT * FROM finder_questions ORDER BY sort_order, id`),
      featured: all(`SELECT id, title, slug, is_featured FROM government_services WHERE publication_status = 'published' AND archived_at IS NULL AND is_featured = 1 ORDER BY title LIMIT 20`),
      note: 'No paid placement exists. Featured and related items are BetterGo editorial configuration, recorded in the audit log.',
    })
  }),
)

adminDiscoveryRouter.post(
  '/discovery/relationships',
  requirePermission('services.update'),
  validate(z.object({ serviceId: z.coerce.number().int().positive(), relatedServiceId: z.coerce.number().int().positive(), relationship: z.enum(['related', 'journey_next', 'same_office']).default('related'), note: z.string().trim().max(300).optional() })),
  asyncHandler(async (req, res) => {
    if (req.body.serviceId === req.body.relatedServiceId) throw unprocessable('A service cannot be related to itself.')
    for (const id of [req.body.serviceId, req.body.relatedServiceId]) {
      if (!get(`SELECT id FROM government_services WHERE id = ? AND publication_status = 'published' AND archived_at IS NULL`, [id])) throw notFound('Service not found.')
    }
    run(
      `INSERT OR IGNORE INTO service_relationships (service_id, related_service_id, relationship, note, created_by) VALUES (?, ?, ?, ?, ?)`,
      [req.body.serviceId, req.body.relatedServiceId, req.body.relationship, cleanText(req.body.note, 300), req.user.id],
    )
    logAudit(req, { action: 'discovery.relationship_created', module: 'discovery', entityType: 'service_relationship', entityId: req.body.serviceId })
    res.status(201).json({ message: 'Relationship saved.' })
  }),
)

adminDiscoveryRouter.delete(
  '/discovery/relationships/:id',
  requirePermission('services.update'),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT id FROM service_relationships WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Relationship not found.')
    run(`DELETE FROM service_relationships WHERE id = ?`, [row.id])
    res.json({ message: 'Relationship removed.' })
  }),
)

adminDiscoveryRouter.post(
  '/discovery/questions',
  requirePermission('services.update'),
  validate(
    z.object({
      key: z.string().trim().regex(/^[a-z0-9_]{2,40}$/),
      label: z.string().trim().min(5).max(200),
      options: z.array(z.object({ value: z.union([z.string(), z.number()]), label: z.string().trim().min(1).max(120) })).min(2).max(20),
      sortOrder: z.coerce.number().int().min(0).max(100).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (get(`SELECT id FROM finder_questions WHERE question_key = ?`, [req.body.key])) throw unprocessable('That question key already exists.')
    run(`INSERT INTO finder_questions (question_key, label, options, sort_order) VALUES (?, ?, ?, ?)`, [
      req.body.key,
      cleanText(req.body.label, 200),
      JSON.stringify(req.body.options),
      req.body.sortOrder || 0,
    ])
    logAudit(req, { action: 'discovery.finder_question_created', module: 'discovery', entityType: 'finder_question', entityId: req.body.key })
    res.status(201).json({ message: 'Finder question created.' })
  }),
)

adminDiscoveryRouter.get(
  '/discovery/analytics',
  requirePermission('province.analytics.view'),
  asyncHandler(async (_req, res) => {
    const views = Number(get(`SELECT COUNT(*) AS n FROM citizen_activities WHERE activity_type = 'service_viewed'`).n)
    res.json({
      totals: {
        serviceViews: views,
        savedServices: Number(get(`SELECT COUNT(*) AS n FROM saved_items WHERE content_type = 'service'`).n),
        searchViews: Number(get(`SELECT COUNT(*) AS n FROM citizen_activities WHERE activity_type = 'service_viewed'`).n),
        recommendationsConfigured: Number(get(`SELECT COUNT(*) AS n FROM service_relationships`).n),
      },
      topServices: all(
        `SELECT s.title, COUNT(a.id) AS views FROM citizen_activities a JOIN government_services s ON s.id = a.entity_id
         WHERE a.activity_type = 'service_viewed' GROUP BY s.id HAVING COUNT(a.id) >= 5 ORDER BY views DESC LIMIT 10`,
      ),
      note: 'Aggregated platform activity only, never individual browsing histories. These are not official LGU performance statistics.',
    })
  }),
)
