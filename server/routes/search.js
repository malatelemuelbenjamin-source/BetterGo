import { Router } from 'express'
import { all, run } from '../db.js'
import { asyncHandler, pagination } from '../lib/http.js'
import { rateLimit } from '../auth.js'
import { expandServiceTerms, SERVICE_PUBLISHED_SQL as PUBLISHED } from '../lib/service-domain.js'
import { MUNICIPAL_CONTENT_TYPES } from '../lib/municipal.js'

/**
 * Global public search (Phase 1 Prompt 7, completed in Phase 2 Prompt 40).
 *
 * One implementation covers every public module, including the Phase 2
 * service categories, forms/resources and service FAQs. The same suggestion
 * endpoint feeds the header, the search page and the service directory.
 */
export const searchRouter = Router()

export const SEARCH_CATEGORIES = [
  { key: 'services', label: 'Government services' },
  { key: 'categories', label: 'Service categories' },
  { key: 'resources', label: 'Forms & resources' },
  { key: 'service_faqs', label: 'Service questions' },
  { key: 'offices', label: 'Government offices' },
  { key: 'municipal', label: 'Municipal updates' },
  { key: 'municipalities', label: 'Municipalities' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'transparency', label: 'Transparency' },
  { key: 'information', label: 'Public information' },
]

/** Portal section that lists each municipal content type. */
const MUNICIPAL_SECTION = {
  about: 'about',
  news: 'news',
  notice: 'news',
  program: 'programs',
  project: 'projects',
  resource: 'resources',
  faq: 'faqs',
  contact: 'contact',
}

function rankSql(columns) {
  return `CASE WHEN ${columns.map((column) => `lower(${column}) = ?`).join(' OR ')} THEN 3
            WHEN ${columns.map((column) => `lower(${column}) LIKE ?`).join(' OR ')} THEN 2 ELSE 1 END`
}

function rankParams(columns, raw) {
  const term = raw.toLowerCase()
  return [...columns.map(() => term), ...columns.map(() => `%${term}%`)]
}

searchRouter.get(
  '/search',
  rateLimit({ windowMs: 60_000, max: 120, key: (req) => `search:${req.ip}` }),
  asyncHandler(async (req, res) => {
    const raw = String(req.query.q || '').trim().slice(0, 120)
    const { page, limit, offset } = pagination({ ...req.query, limit: req.query.limit || 10 })
    const category = req.query.category ? String(req.query.category) : null
    const municipalitySlug = req.query.municipality ? String(req.query.municipality) : null
    const sort = req.query.sort === 'newest' ? 'newest' : req.query.sort === 'oldest' ? 'oldest' : 'relevance'

    if (raw.length < 2) {
      return res.json({
        query: raw,
        total: 0,
        page,
        limit,
        results: [],
        availableCategories: SEARCH_CATEGORIES,
        message: raw ? 'Enter at least two characters to search.' : 'Enter a search term to begin.',
      })
    }

    const terms = expandServiceTerms(raw)
    const results = []
    const wants = (key) => !category || category === key

    if (wants('services')) {
      const columns = ['s.title', 'COALESCE(s.short_description, s.description)']
      const perTerm = `(lower(s.title) LIKE ? OR lower(COALESCE(s.short_description,'')) LIKE ?
        OR lower(COALESCE(s.description,'')) LIKE ? OR lower(COALESCE(s.full_description,'')) LIKE ?
        OR lower(COALESCE(s.eligibility,'')) LIKE ? OR lower(COALESCE(c.name,'')) LIKE ?
        OR EXISTS (SELECT 1 FROM service_requirements r WHERE r.service_id = s.id AND lower(r.requirement_name) LIKE ?)
        OR EXISTS (SELECT 1 FROM service_procedures p WHERE p.service_id = s.id AND (lower(p.title) LIKE ? OR lower(COALESCE(p.description,'')) LIKE ?))
        OR EXISTS (SELECT 1 FROM service_fees fee WHERE fee.service_id = s.id AND lower(fee.fee_name) LIKE ?))`
      const rows = all(
        `SELECT s.id, s.title, s.slug, s.short_description AS description, s.updated_at, s.verification_status,
                c.name AS category_name, m.name AS municipality_name,
                ${rankSql(columns)} AS rank
         FROM government_services s
         LEFT JOIN service_categories c ON c.id = s.category_id
         LEFT JOIN municipalities m ON m.id = s.municipality_id
         WHERE ${PUBLISHED} AND (${terms.map(() => perTerm).join(' OR ')})
           ${municipalitySlug ? `AND (m.slug = ? OR s.service_scope IN ('province_wide','online_province_wide') OR s.coverage_type = 'province_wide' OR EXISTS (SELECT 1 FROM service_coverage sc WHERE sc.service_id = s.id AND sc.municipality_id = (SELECT id FROM municipalities WHERE slug = ?)))` : ''}
         ORDER BY rank DESC, s.title LIMIT 40`,
        [
          ...rankParams(columns, raw),
          ...terms.flatMap((term) => Array(10).fill(`%${term}%`)),
          ...(municipalitySlug ? [municipalitySlug, municipalitySlug] : []),
        ],
      )
      results.push(
        ...rows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          category: 'services',
          categoryLabel: row.category_name || 'Government service',
          url: `/services/${row.slug}`,
          municipality: row.municipality_name,
          date: row.updated_at,
          meta: row.verification_status,
          _rank: row.rank,
        })),
      )
    }

    if (wants('categories')) {
      const columns = ['c.name', `COALESCE(c.description,'')`]
      const rows = all(
        `SELECT c.id, c.name, c.slug, c.description, c.updated_at, c.parent_id,
                p.name AS parent_name, ${rankSql(columns)} AS rank,
                (SELECT COUNT(*) FROM government_services s WHERE s.category_id = c.id
                   AND s.publication_status = 'published' AND s.archived_at IS NULL) AS service_count
         FROM service_categories c LEFT JOIN service_categories p ON p.id = c.parent_id
         WHERE c.status = 'active' AND c.is_active = 1
           AND (${terms.map(() => `(lower(c.name) LIKE ? OR lower(COALESCE(c.description,'')) LIKE ? OR lower(COALESCE(c.keywords,'')) LIKE ?)`).join(' OR ')})
         ORDER BY rank DESC, c.parent_id IS NOT NULL, c.sort_order LIMIT 15`,
        [
          ...rankParams(columns, raw),
          ...terms.flatMap((term) => Array(3).fill(`%${term}%`)),
        ],
      )
      results.push(
        ...rows.map((row) => ({
          id: row.id,
          title: row.name,
          description: row.description || (row.parent_name ? `Subcategory of ${row.parent_name}.` : 'Service category group.'),
          category: 'categories',
          categoryLabel: row.parent_id ? 'Service subcategory' : 'Service category',
          url: `/services/category/${row.slug}`,
          municipality: null,
          date: row.updated_at,
          meta: Number(row.service_count) === 0 ? 'No published services yet' : `${row.service_count} published services`,
          _rank: row.rank,
        })),
      )
    }

    if (wants('resources')) {
      const columns = ['d.document_title', 's.title']
      const rows = all(
        `SELECT d.id, d.document_title, d.document_type, d.publication_date,
                s.title AS service_title, s.slug AS service_slug, c.name AS category_name,
                ${rankSql(columns)} AS rank
         FROM service_documents d
         JOIN government_services s ON s.id = d.service_id
         LEFT JOIN service_categories c ON c.id = s.category_id
         WHERE ${PUBLISHED} AND d.status = 'published'
           AND (${terms.map(() => `(lower(d.document_title) LIKE ? OR lower(s.title) LIKE ?)`).join(' OR ')})
         ORDER BY rank DESC, d.id DESC LIMIT 20`,
        [
          ...rankParams(columns, raw),
          ...terms.flatMap((term) => Array(2).fill(`%${term}%`)),
        ],
      )
      results.push(
        ...rows.map((row) => ({
          id: row.id,
          title: row.document_title,
          description: `Form or resource for ${row.service_title}${row.category_name ? ` · ${row.category_name}` : ''}`,
          category: 'resources',
          categoryLabel: `Form · ${String(row.document_type || 'resource').replace(/_/g, ' ')}`,
          url: `/services/${row.service_slug}#documents`,
          municipality: null,
          date: row.publication_date,
          meta: 'Form or resource',
          _rank: row.rank,
        })),
      )
    }

    if (wants('service_faqs')) {
      const columns = ['f.question', 's.title']
      const rows = all(
        `SELECT f.id, f.question, f.answer, s.title AS service_title, s.slug AS service_slug,
                ${rankSql(columns)} AS rank
         FROM service_faqs f JOIN government_services s ON s.id = f.service_id
         WHERE ${PUBLISHED} AND f.status = 'published'
           AND (${terms.map(() => `(lower(f.question) LIKE ? OR lower(f.answer) LIKE ? OR lower(s.title) LIKE ?)`).join(' OR ')})
         ORDER BY rank DESC, f.id DESC LIMIT 20`,
        [
          ...rankParams(columns, raw),
          ...terms.flatMap((term) => Array(3).fill(`%${term}%`)),
        ],
      )
      results.push(
        ...rows.map((row) => ({
          id: row.id,
          title: row.question,
          description: row.answer,
          category: 'service_faqs',
          categoryLabel: 'Service question',
          url: `/services/${row.service_slug}#faqs`,
          municipality: null,
          date: null,
          meta: row.service_title,
          _rank: row.rank,
        })),
      )
    }

    if (wants('offices')) {
      const columns = ['o.name', `COALESCE(o.responsibilities,'')`]
      const rows = all(
        `SELECT o.id, o.name, o.slug, o.description, o.updated_at, o.verification_status,
                m.name AS municipality_name, ${rankSql(columns)} AS rank
         FROM government_offices o LEFT JOIN municipalities m ON m.id = o.municipality_id
         WHERE o.publication_status = 'published'
           AND (${terms.map(() => `(lower(o.name) LIKE ? OR lower(COALESCE(o.description,'')) LIKE ? OR lower(COALESCE(o.responsibilities,'')) LIKE ?)`).join(' OR ')})
           ${municipalitySlug ? 'AND m.slug = ?' : ''}
         ORDER BY rank DESC, o.name LIMIT 30`,
        [
          ...rankParams(columns, raw),
          ...terms.flatMap((term) => Array(3).fill(`%${term}%`)),
          ...(municipalitySlug ? [municipalitySlug] : []),
        ],
      )
      results.push(
        ...rows.map((row) => ({
          id: row.id,
          title: row.name,
          description: row.description,
          category: 'offices',
          categoryLabel: 'Government office',
          url: `/government-directory/${row.slug}`,
          municipality: row.municipality_name,
          date: row.updated_at,
          meta: row.verification_status,
          _rank: row.rank,
        })),
      )
    }

    if (wants('municipalities')) {
      const rows = all(
        `SELECT id, name, slug, description, updated_at, verification_status,
                CASE WHEN lower(name) = ? THEN 3 WHEN lower(name) LIKE ? THEN 2 ELSE 1 END AS rank
         FROM municipalities
         WHERE is_active = 1 AND publication_status = 'published'
           AND (${terms.map(() => `(lower(name) LIKE ? OR lower(COALESCE(description,'')) LIKE ?)`).join(' OR ')})
           ${municipalitySlug ? 'AND slug = ?' : ''}
         ORDER BY rank DESC LIMIT 10`,
        [raw.toLowerCase(), `%${raw.toLowerCase()}%`, ...terms.flatMap((term) => Array(2).fill(`%${term}%`)), ...(municipalitySlug ? [municipalitySlug] : [])],
      )
      results.push(
        ...rows.map((row) => ({
          id: row.id,
          title: row.name,
          description: row.description,
          category: 'municipalities',
          categoryLabel: 'Municipality',
          url: `/municipalities/${row.slug}`,
          municipality: row.name,
          date: row.updated_at,
          meta: row.verification_status,
          _rank: row.rank,
        })),
      )
    }

    if (wants('announcements')) {
      const columns = ['a.title', `COALESCE(a.summary,'')`]
      const rows = all(
        `SELECT a.id, a.title, a.slug, a.summary, a.published_at, a.verification_status,
                c.name AS category_name, m.name AS municipality_name, ${rankSql(columns)} AS rank
         FROM announcements a
         LEFT JOIN announcement_categories c ON c.id = a.category_id
         LEFT JOIN municipalities m ON m.id = a.municipality_id
         WHERE a.publication_status = 'published'
           AND (a.expires_at IS NULL OR datetime(a.expires_at) > datetime('now'))
           AND (${terms.map(() => `(lower(a.title) LIKE ? OR lower(COALESCE(a.summary,'')) LIKE ? OR lower(COALESCE(a.content,'')) LIKE ?)`).join(' OR ')})
           ${municipalitySlug ? "AND (m.slug = ? OR a.coverage = 'province')" : ''}
         ORDER BY rank DESC, a.published_at DESC LIMIT 30`,
        [
          ...rankParams(columns, raw),
          ...terms.flatMap((term) => Array(3).fill(`%${term}%`)),
          ...(municipalitySlug ? [municipalitySlug] : []),
        ],
      )
      results.push(
        ...rows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.summary,
          category: 'announcements',
          categoryLabel: row.category_name || 'Announcement',
          url: `/announcements/${row.slug}`,
          municipality: row.municipality_name,
          date: row.published_at,
          meta: row.verification_status,
          _rank: row.rank,
        })),
      )
    }

    if (wants('transparency')) {
      const columns = ['t.title', `COALESCE(t.description,'')`]
      const rows = all(
        `SELECT t.id, t.title, t.slug, t.description, t.publication_date, t.record_category, t.verification_status,
                m.name AS municipality_name, ${rankSql(columns)} AS rank
         FROM transparency_records t LEFT JOIN municipalities m ON m.id = t.municipality_id
         WHERE t.publication_status = 'published'
           AND (${terms.map(() => `(lower(t.title) LIKE ? OR lower(COALESCE(t.description,'')) LIKE ?)`).join(' OR ')})
           ${municipalitySlug ? 'AND m.slug = ?' : ''}
         ORDER BY rank DESC LIMIT 20`,
        [
          ...rankParams(columns, raw),
          ...terms.flatMap((term) => Array(2).fill(`%${term}%`)),
          ...(municipalitySlug ? [municipalitySlug] : []),
        ],
      )
      results.push(
        ...rows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          category: 'transparency',
          categoryLabel: `Transparency · ${row.record_category}`,
          url: `/transparency/documents/${row.slug}`,
          municipality: row.municipality_name,
          date: row.publication_date,
          meta: row.verification_status,
          _rank: row.rank,
        })),
      )
    }

    if (wants('information')) {
      const rows = all(
        `SELECT id, question, answer, category,
                CASE WHEN lower(question) LIKE ? THEN 2 ELSE 1 END AS rank
         FROM faqs WHERE status = 'published'
           AND (${terms.map(() => `(lower(question) LIKE ? OR lower(answer) LIKE ?)`).join(' OR ')})
         ORDER BY rank DESC LIMIT 15`,
        [`%${raw.toLowerCase()}%`, ...terms.flatMap((term) => Array(2).fill(`%${term}%`))],
      )
      results.push(
        ...rows.map((row) => ({
          id: row.id,
          title: row.question,
          description: row.answer,
          category: 'information',
          categoryLabel: 'Public information',
          url: '/about#faq',
          municipality: null,
          date: null,
          meta: row.category,
          _rank: row.rank,
        })),
      )
    }

    if (wants('municipal')) {
      // Published municipal portal content: news, notices, programs, projects,
      // resources and municipal FAQs. Drafts never enter the index.
      const columns = ['c.title', `COALESCE(c.summary,'')`]
      const rows = all(
        `SELECT c.id, c.title, c.slug, c.content_type, c.summary, c.updated_at, c.published_at,
                c.verification_status, m.name AS municipality_name, m.slug AS municipality_slug,
                ${rankSql(columns)} AS rank
         FROM municipal_content c
         JOIN municipalities m ON m.id = c.municipality_id
         WHERE c.publication_status = 'published' AND c.archived_at IS NULL
           AND (c.published_at IS NULL OR datetime(c.published_at) <= datetime('now'))
           AND (c.ends_at IS NULL OR datetime(c.ends_at) > datetime('now'))
           AND m.is_active = 1 AND m.publication_status = 'published'
           AND (${terms.map(() => `(lower(c.title) LIKE ? OR lower(COALESCE(c.summary,'')) LIKE ? OR lower(COALESCE(c.body,'')) LIKE ?)`).join(' OR ')})
           ${municipalitySlug ? 'AND m.slug = ?' : ''}
         ORDER BY rank DESC, COALESCE(c.published_at, c.updated_at) DESC LIMIT 30`,
        [
          ...rankParams(columns, raw),
          ...terms.flatMap((term) => Array(3).fill(`%${term}%`)),
          ...(municipalitySlug ? [municipalitySlug] : []),
        ],
      )
      results.push(
        ...rows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.summary,
          category: 'municipal',
          categoryLabel: `Municipal · ${MUNICIPAL_CONTENT_TYPES[row.content_type] || row.content_type}`,
          url: `/municipalities/${row.municipality_slug}/${MUNICIPAL_SECTION[row.content_type] || 'news'}`,
          municipality: row.municipality_name,
          date: row.published_at || row.updated_at,
          meta: row.verification_status,
          _rank: row.rank,
        })),
      )
    }

    if (sort === 'newest') results.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    else if (sort === 'oldest') results.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    else results.sort((a, b) => b._rank - a._rank || String(b.date || '').localeCompare(String(a.date || '')))

    const clean = results.map(({ _rank, ...rest }) => rest)
    // Recorded so administrators can see which searches return nothing. No
    // personal data is stored; user_id is only set for signed-in searches.
    try {
      run(`INSERT INTO search_history (user_id, query) VALUES (?, ?)`, [req.user?.id ?? null, raw])
    } catch {
      /* history must never break search */
    }

    res.json({
      query: raw,
      total: clean.length,
      page,
      limit,
      results: clean.slice(offset, offset + limit),
      availableCategories: SEARCH_CATEGORIES,
      expandedTerms: terms,
      notice: 'Published public records only. Draft, archived and private records are never returned.',
    })
  }),
)

/** Shared suggestion query used by the header, search page and directory. */
searchRouter.get(
  '/search/suggest',
  rateLimit({ windowMs: 60_000, max: 180, key: (req) => `suggest:${req.ip}` }),
  asyncHandler(async (req, res) => {
    const raw = String(req.query.q || '').trim().slice(0, 80)
    if (raw.length < 2) {
      return res.json({ query: raw, suggestions: [], groups: { services: [], categories: [], offices: [], resources: [], faqs: [], announcements: [], municipalities: [] } })
    }
    const like = `%${raw.toLowerCase()}%`
    const groups = {
      services: all(
        `SELECT s.title, s.slug, c.name AS category_name
         FROM government_services s LEFT JOIN service_categories c ON c.id = s.category_id
         WHERE ${PUBLISHED} AND (lower(s.title) LIKE ? OR lower(COALESCE(s.short_description,'')) LIKE ? OR lower(COALESCE(s.description,'')) LIKE ?)
         ORDER BY CASE WHEN lower(s.title) LIKE ? THEN 0 ELSE 1 END, s.title LIMIT 6`,
        [like, like, like, `${raw.toLowerCase()}%`],
      ),
      categories: all(
        `SELECT name, slug, icon, parent_id FROM service_categories
         WHERE status = 'active' AND is_active = 1 AND (lower(name) LIKE ? OR lower(COALESCE(description,'')) LIKE ? OR lower(COALESCE(keywords,'')) LIKE ?)
         ORDER BY parent_id IS NOT NULL, sort_order LIMIT 5`,
        [like, like, like],
      ),
      offices: all(
        `SELECT name, slug FROM government_offices WHERE publication_status = 'published' AND lower(name) LIKE ? ORDER BY name LIMIT 3`,
        [like],
      ),
      resources: all(
        `SELECT d.id, d.document_title, d.document_type, s.slug AS service_slug
         FROM service_documents d JOIN government_services s ON s.id = d.service_id
         WHERE ${PUBLISHED} AND d.status = 'published' AND (lower(d.document_title) LIKE ? OR lower(s.title) LIKE ?)
         ORDER BY d.id LIMIT 4`,
        [like, like],
      ),
      faqs: all(
        `SELECT f.id, f.question, s.slug AS service_slug FROM service_faqs f
         JOIN government_services s ON s.id = f.service_id
         WHERE ${PUBLISHED} AND f.status = 'published' AND (lower(f.question) LIKE ? OR lower(f.answer) LIKE ?) LIMIT 4`,
        [like, like],
      ),
      announcements: all(
        `SELECT title, slug FROM announcements WHERE publication_status = 'published' AND lower(title) LIKE ? LIMIT 3`,
        [like],
      ),
      municipalities: all(`SELECT name, slug FROM municipalities WHERE is_active = 1 AND lower(name) LIKE ? LIMIT 3`, [like]),
    }

    const suggestions = [
      ...groups.services.map((item) => ({ label: item.title, category: 'Service', url: `/services/${item.slug}`, meta: item.category_name })),
      ...groups.categories.map((item) => ({ label: item.name, category: item.parent_id ? 'Subcategory' : 'Category', url: `/services/category/${item.slug}` })),
      ...groups.resources.map((item) => ({ label: item.document_title, category: 'Form', url: `/services/${item.service_slug}#documents`, meta: item.document_type })),
      ...groups.faqs.map((item) => ({ label: item.question, category: 'Question', url: `/services/${item.service_slug}#faqs` })),
      ...groups.offices.map((item) => ({ label: item.name, category: 'Office', url: `/government-directory/${item.slug}` })),
      ...groups.announcements.map((item) => ({ label: item.title, category: 'Announcement', url: `/announcements/${item.slug}` })),
      ...groups.municipalities.map((item) => ({ label: item.name, category: 'Municipality', url: `/municipalities/${item.slug}` })),
    ].slice(0, 12)

    // `groups` is the current shape; the spread keeps older clients that read
    // `services`, `categories`, … directly working.
    res.json({ query: raw, suggestions, groups, ...groups })
  }),
)

searchRouter.get(
  '/search/suggested',
  asyncHandler(async (_req, res) => {
    // Labelled suggested searches, not a "most popular" claim.
    res.json({
      suggestions: [
        'Birth certificate information',
        'Business permit',
        'Health services',
        'Scholarships',
        'Government assistance',
        'Agriculture programmes',
        'Emergency hotlines',
        'Municipal offices',
      ],
    })
  }),
)
