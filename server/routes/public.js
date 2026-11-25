import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { asyncHandler, notFound, paginated, pagination, reference, tooMany, cleanText, HttpError } from '../lib/http.js'
import { rateLimit } from '../auth.js'
import { logAudit } from '../audit.js'
import { validate } from '../lib/validate.js'

export const publicRouter = Router()

// ---------------------------------------------------------------------------
// Configuration & shared lookups
// ---------------------------------------------------------------------------
publicRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const rows = all(`SELECT setting_key, setting_value FROM system_settings WHERE is_public = 1`)
    const settings = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]))
    res.json({ settings: { ...settings, 'platform.domain': settings['platform.domain'] || '' } })
  }),
)

publicRouter.get(
  '/lookups',
  asyncHandler(async (_req, res) => {
    res.json({
      municipalities: all(
        `SELECT id, name, slug, description, verification_status FROM municipalities WHERE is_active = 1 ORDER BY sort_order`,
      ),
      serviceCategories: all(`SELECT id, name, slug, description, icon FROM service_categories WHERE is_active = 1 ORDER BY sort_order`),
      announcementCategories: all(`SELECT id, name, slug, description FROM announcement_categories ORDER BY sort_order`),
      province: get(`SELECT id, name, code, region FROM provinces LIMIT 1`),
    })
  }),
)

publicRouter.get(
  '/homepage',
  asyncHandler(async (_req, res) => {
    const sections = all(`SELECT * FROM homepage_sections ORDER BY sort_order`).map((row) => ({
      ...row,
      settings: row.settings ? JSON.parse(row.settings) : null,
      is_enabled: Boolean(row.is_enabled),
    }))
    res.json({ sections })
  }),
)

// ---------------------------------------------------------------------------
// Municipalities
// ---------------------------------------------------------------------------
publicRouter.get(
  '/municipalities',
  asyncHandler(async (_req, res) => {
    const rows = all(
      `SELECT m.*,
        (SELECT COUNT(*) FROM announcements a WHERE a.municipality_id = m.id AND a.publication_status = 'published') AS announcement_count,
        (SELECT COUNT(*) FROM government_services s WHERE s.municipality_id = m.id AND s.publication_status = 'published') AS service_count,
        (SELECT COUNT(*) FROM government_offices o WHERE o.municipality_id = m.id AND o.publication_status = 'published') AS office_count
       FROM municipalities m WHERE m.is_active = 1 AND m.publication_status = 'published'
       ORDER BY m.sort_order, m.name`,
    )
    res.json({ results: rows, total: rows.length })
  }),
)

publicRouter.get(
  '/municipalities/:slug',
  asyncHandler(async (req, res) => {
    const municipality = get(`SELECT * FROM municipalities WHERE slug = ? AND is_active = 1`, [req.params.slug])
    if (!municipality) throw notFound('Municipality not found.')
    const offices = all(
      `SELECT id, name, slug, category, office_type, description, phone, email, address, operating_hours, website, verification_status, last_verified_at
       FROM government_offices WHERE municipality_id = ? AND publication_status = 'published' ORDER BY name`,
      [municipality.id],
    )
    const services = all(
      `SELECT s.id, s.title, s.slug, s.description, s.coverage_type, c.name AS category_name, c.slug AS category_slug
       FROM government_services s LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE s.publication_status = 'published' AND (s.municipality_id = ? OR s.coverage_type = 'province_wide')
       ORDER BY s.title LIMIT 12`,
      [municipality.id],
    )
    const announcements = all(
      `SELECT a.id, a.title, a.slug, a.summary, a.published_at, a.is_featured, c.name AS category_name
       FROM announcements a LEFT JOIN announcement_categories c ON c.id = a.category_id
       WHERE a.publication_status = 'published' AND a.municipality_id = ?
       ORDER BY a.published_at DESC LIMIT 6`,
      [municipality.id],
    )
    const barangays = all(`SELECT id, name FROM barangays WHERE municipality_id = ? AND is_active = 1 ORDER BY name`, [
      municipality.id,
    ])
    const documents = all(
      `SELECT id, title, slug, document_category, fiscal_year, publication_date, verification_status
       FROM public_documents WHERE municipality_id = ? AND publication_status = 'published'
       ORDER BY publication_date DESC LIMIT 5`,
      [municipality.id],
    )
    res.json({ municipality, offices, services, announcements, barangays, documents })
  }),
)

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------
publicRouter.get(
  '/announcements/categories',
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(
        `SELECT c.*, (SELECT COUNT(*) FROM announcements a WHERE a.category_id = c.id AND a.publication_status = 'published') AS announcement_count
         FROM announcement_categories c ORDER BY c.sort_order`,
      ),
    })
  }),
)

publicRouter.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query)
    const clauses = [
      `a.publication_status = 'published'`,
      `(a.expires_at IS NULL OR datetime(a.expires_at) > datetime('now'))`,
      `(a.published_at IS NULL OR datetime(a.published_at) <= datetime('now'))`,
    ]
    const params = []
    if (req.query.category) {
      clauses.push(`c.slug = ?`)
      params.push(String(req.query.category))
    }
    if (req.query.municipality) {
      clauses.push(`m.slug = ?`)
      params.push(String(req.query.municipality))
    }
    if (req.query.featured === 'true') clauses.push(`a.is_featured = 1`)
    if (req.query.q) {
      clauses.push(`(lower(a.title) LIKE ? OR lower(COALESCE(a.summary,'')) LIKE ? OR lower(COALESCE(a.content,'')) LIKE ?)`)
      const like = `%${String(req.query.q).toLowerCase()}%`
      params.push(like, like, like)
    }
    const where = clauses.join(' AND ')
    const total = Number(
      get(
        `SELECT COUNT(*) AS total FROM announcements a
         LEFT JOIN announcement_categories c ON c.id = a.category_id
         LEFT JOIN municipalities m ON m.id = a.municipality_id
         WHERE ${where}`,
        params,
      ).total,
    )
    const order =
      req.query.sort === 'oldest' ? 'a.published_at ASC' : req.query.sort === 'title' ? 'a.title ASC' : 'a.published_at DESC'
    const results = all(
      `SELECT a.id, a.title, a.slug, a.summary, a.featured_image, a.announcement_type, a.priority,
              a.coverage, a.source_organization, a.source_type, a.verification_status,
              a.published_at, a.updated_at, a.is_featured,
              c.name AS category_name, c.slug AS category_slug,
              m.name AS municipality_name, m.slug AS municipality_slug
       FROM announcements a
       LEFT JOIN announcement_categories c ON c.id = a.category_id
       LEFT JOIN municipalities m ON m.id = a.municipality_id
       WHERE ${where} ORDER BY a.is_featured DESC, ${order} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    res.json(paginated(results, total, page, limit))
  }),
)

publicRouter.get(
  '/announcements/:slug',
  asyncHandler(async (req, res) => {
    const announcement = get(
      `SELECT a.*, c.name AS category_name, c.slug AS category_slug,
              m.name AS municipality_name, m.slug AS municipality_slug,
              u.name AS publisher_name
       FROM announcements a
       LEFT JOIN announcement_categories c ON c.id = a.category_id
       LEFT JOIN municipalities m ON m.id = a.municipality_id
       LEFT JOIN users u ON u.id = a.created_by
       WHERE a.slug = ? AND a.publication_status = 'published'`,
      [req.params.slug],
    )
    if (!announcement) throw notFound('Announcement not found.')
    res.json({
      announcement,
      attachments: all(
        `SELECT id, title, file_name, file_type, file_size, created_at FROM announcement_attachments WHERE announcement_id = ?`,
        [announcement.id],
      ),
      related: all(
        `SELECT id, title, slug, summary, published_at FROM announcements
         WHERE publication_status = 'published' AND id <> ?
           AND (category_id = ? OR municipality_id = ?)
         ORDER BY published_at DESC LIMIT 4`,
        [announcement.id, announcement.category_id, announcement.municipality_id],
      ),
    })
  }),
)

// ---------------------------------------------------------------------------
// Government directory
// ---------------------------------------------------------------------------
publicRouter.get(
  '/directory',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query)
    const clauses = [`o.publication_status = 'published'`]
    const params = []
    if (req.query.level) {
      clauses.push(`o.government_level = ?`)
      params.push(String(req.query.level))
    }
    if (req.query.category) {
      clauses.push(`o.category = ?`)
      params.push(String(req.query.category))
    }
    if (req.query.municipality) {
      clauses.push(
        `(o.municipality_id = (SELECT id FROM municipalities WHERE slug = ?) OR EXISTS (SELECT 1 FROM office_municipalities om JOIN municipalities m2 ON m2.id = om.municipality_id WHERE om.office_id = o.id AND m2.slug = ?))`,
      )
      params.push(String(req.query.municipality), String(req.query.municipality))
    }
    if (req.query.verified === 'true') clauses.push(`o.verification_status = 'verified'`)
    if (req.query.q) {
      clauses.push(`(lower(o.name) LIKE ? OR lower(COALESCE(o.description,'')) LIKE ? OR lower(COALESCE(o.responsibilities,'')) LIKE ?)`)
      const like = `%${String(req.query.q).toLowerCase()}%`
      params.push(like, like, like)
    }
    const where = clauses.join(' AND ')
    const total = Number(get(`SELECT COUNT(*) AS total FROM government_offices o WHERE ${where}`, params).total)
    const results = all(
      `SELECT o.id, o.name, o.slug, o.category, o.office_type, o.government_level, o.description,
              o.phone, o.email, o.address, o.operating_hours, o.website, o.verification_status, o.last_verified_at,
              m.name AS municipality_name, m.slug AS municipality_slug
       FROM government_offices o LEFT JOIN municipalities m ON m.id = o.municipality_id
       WHERE ${where} ORDER BY o.government_level, o.name LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    res.json({
      ...paginated(results, total, page, limit),
      categories: all(
        `SELECT DISTINCT category FROM government_offices WHERE publication_status = 'published' AND category IS NOT NULL ORDER BY category`,
      ).map((r) => r.category),
    })
  }),
)

publicRouter.get(
  '/directory/:slug',
  asyncHandler(async (req, res) => {
    const office = get(
      `SELECT o.*, m.name AS municipality_name, m.slug AS municipality_slug, d.name AS department_name
       FROM government_offices o
       LEFT JOIN municipalities m ON m.id = o.municipality_id
       LEFT JOIN government_departments d ON d.id = o.department_id
       WHERE o.slug = ? AND o.publication_status = 'published'`,
      [req.params.slug],
    )
    if (!office) throw notFound('Office not found.')
    res.json({
      office,
      services: all(
        `SELECT id, title, slug, description FROM government_services WHERE office_id = ? AND publication_status = 'published' LIMIT 10`,
        [office.id],
      ),
      announcements: all(
        `SELECT id, title, slug, published_at FROM announcements
         WHERE publication_status = 'published' AND municipality_id = ? ORDER BY published_at DESC LIMIT 5`,
        [office.municipality_id],
      ),
      coverage: all(
        `SELECT m.id, m.name, m.slug FROM office_municipalities om JOIN municipalities m ON m.id = om.municipality_id WHERE om.office_id = ?`,
        [office.id],
      ),
      relatedOffices: all(
        `SELECT id, name, slug, category FROM government_offices
         WHERE publication_status = 'published' AND category = ? AND id <> ? LIMIT 4`,
        [office.category, office.id],
      ),
    })
  }),
)

// ---------------------------------------------------------------------------
// Transparency
// ---------------------------------------------------------------------------
publicRouter.get(
  '/transparency',
  asyncHandler(async (_req, res) => {
    const counts = {
      budget: Number(
        get(
          `SELECT COUNT(*) AS t FROM transparency_records WHERE publication_status='published' AND record_category='budget'`,
        ).t,
      ),
      expenditure: Number(
        get(
          `SELECT COUNT(*) AS t FROM transparency_records WHERE publication_status='published' AND record_category='expenditure'`,
        ).t,
      ),
      procurement: Number(
        get(
          `SELECT COUNT(*) AS t FROM transparency_records WHERE publication_status='published' AND record_category='procurement'`,
        ).t,
      ),
      accountability: Number(
        get(
          `SELECT COUNT(*) AS t FROM transparency_records WHERE publication_status='published' AND record_category='accountability'`,
        ).t,
      ),
      documents: Number(get(`SELECT COUNT(*) AS t FROM public_documents WHERE publication_status='published'`).t),
    }
    const latest = get(
      `SELECT MAX(updated_at) AS last_updated FROM transparency_records WHERE publication_status='published'`,
    )
    res.json({
      counts,
      lastUpdated: latest?.last_updated || null,
      records: all(
        `SELECT t.*, m.name AS municipality_name, m.slug AS municipality_slug
         FROM transparency_records t LEFT JOIN municipalities m ON m.id = t.municipality_id
         WHERE t.publication_status='published' ORDER BY t.publication_date DESC, t.id DESC LIMIT 12`,
      ),
      documents: all(
        `SELECT id, title, slug, document_category, fiscal_year, publication_date, verification_status, issuing_organization
         FROM public_documents WHERE publication_status='published' ORDER BY publication_date DESC LIMIT 8`,
      ),
      budget: all(
        `SELECT fiscal_year, financial_category, SUM(amount_cents) AS total_cents, currency
         FROM financial_records WHERE verification_status = 'verified'
         GROUP BY fiscal_year, financial_category, currency ORDER BY fiscal_year DESC`,
      ),
      byMunicipality: all(
        `SELECT m.id, m.name, m.slug, COUNT(t.id) AS records
         FROM municipalities m LEFT JOIN transparency_records t
           ON t.municipality_id = m.id AND t.publication_status='published'
         WHERE m.is_active = 1 GROUP BY m.id ORDER BY m.sort_order`,
      ),
      byDepartment: all(
        `SELECT department_name, fiscal_year, SUM(amount_cents) AS total_cents
         FROM financial_records WHERE verification_status='verified' AND department_name IS NOT NULL
         GROUP BY department_name, fiscal_year ORDER BY fiscal_year DESC, total_cents DESC LIMIT 12`,
      ),
    })
  }),
)

publicRouter.get(
  '/transparency/documents',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query)
    const clauses = [`d.publication_status = 'published'`]
    const params = []
    if (req.query.category) {
      clauses.push(`d.document_category = ?`)
      params.push(String(req.query.category))
    }
    if (req.query.municipality) {
      clauses.push(`m.slug = ?`)
      params.push(String(req.query.municipality))
    }
    if (req.query.year) {
      clauses.push(`d.fiscal_year = ?`)
      params.push(Number(req.query.year))
    }
    if (req.query.q) {
      clauses.push(`(lower(d.title) LIKE ? OR lower(COALESCE(d.description,'')) LIKE ?)`)
      const like = `%${String(req.query.q).toLowerCase()}%`
      params.push(like, like)
    }
    const where = clauses.join(' AND ')
    const total = Number(
      get(
        `SELECT COUNT(*) AS total FROM public_documents d LEFT JOIN municipalities m ON m.id = d.municipality_id WHERE ${where}`,
        params,
      ).total,
    )
    const results = all(
      `SELECT d.id, d.title, d.slug, d.description, d.document_category, d.issuing_organization,
              d.government_level, d.fiscal_year, d.publication_date, d.file_type, d.file_size,
              d.source_url, d.verification_status, m.name AS municipality_name, m.slug AS municipality_slug
       FROM public_documents d LEFT JOIN municipalities m ON m.id = d.municipality_id
       WHERE ${where} ORDER BY d.publication_date DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    res.json(paginated(results, total, page, limit))
  }),
)

publicRouter.get(
  '/transparency/documents/:slug',
  asyncHandler(async (req, res) => {
    const document = get(
      `SELECT d.*, m.name AS municipality_name, m.slug AS municipality_slug
       FROM public_documents d LEFT JOIN municipalities m ON m.id = d.municipality_id
       WHERE d.slug = ? AND d.publication_status = 'published'`,
      [req.params.slug],
    )
    if (!document) throw notFound('Document not found.')
    delete document.file_path
    res.json({
      document,
      related: all(
        `SELECT id, title, slug, document_category FROM public_documents
         WHERE publication_status='published' AND document_category = ? AND id <> ? LIMIT 4`,
        [document.document_category, document.id],
      ),
    })
  }),
)

publicRouter.get(
  '/transparency/documents/:slug/download',
  asyncHandler(async (req, res) => {
    const document = get(
      `SELECT * FROM public_documents WHERE slug = ? AND publication_status = 'published'`,
      [req.params.slug],
    )
    if (!document) throw notFound('Document not found.')
    if (document.source_url) return res.json({ redirect: document.source_url })
    if (!document.file_path) throw notFound('No public file is attached to this record.')
    res.json({ redirect: document.file_path })
  }),
)

// ---------------------------------------------------------------------------
// Emergency
// ---------------------------------------------------------------------------
publicRouter.get(
  '/emergency',
  asyncHandler(async (req, res) => {
    const clauses = [`e.publication_status = 'published'`]
    const params = []
    if (req.query.category) {
      clauses.push(`e.category = ?`)
      params.push(String(req.query.category))
    }
    if (req.query.municipality) {
      clauses.push(`e.municipality_id = (SELECT id FROM municipalities WHERE slug = ?)`)
      params.push(String(req.query.municipality))
    }
    if (req.query.q) {
      clauses.push(`(lower(e.organization_name) LIKE ? OR lower(COALESCE(e.address,'')) LIKE ?)`)
      const like = `%${String(req.query.q).toLowerCase()}%`
      params.push(like, like)
    }
    const results = all(
      `SELECT e.*, m.name AS municipality_name, m.slug AS municipality_slug
       FROM emergency_contacts e LEFT JOIN municipalities m ON m.id = e.municipality_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY CASE e.government_level WHEN 'national' THEN 1 WHEN 'provincial' THEN 2 ELSE 3 END, e.organization_name`,
      params,
    )
    const provinces = all(
      `SELECT e.*, m.name AS municipality_name, m.slug AS municipality_slug
       FROM emergency_contacts e LEFT JOIN municipalities m ON m.id = e.municipality_id
       WHERE e.publication_status='published' AND e.government_level <> 'national'`,
    ).reduce((acc, item) => {
      const key = item.municipality_slug || 'provincial'
      if (!acc[key]) acc[key] = []
      acc[key].push(item)
      return acc
    }, {})
    res.json({
      results,
      national: results.filter((r) => r.government_level === 'national'),
      provincial: results.filter((r) => r.government_level === 'provincial'),
      byMunicipality: provinces,
      emergencyAnnouncements: all(
        `SELECT a.id, a.title, a.slug, a.summary, a.published_at, a.priority, a.verification_status, c.name AS category_name
         FROM announcements a LEFT JOIN announcement_categories c ON c.id = a.category_id
         WHERE a.publication_status='published' AND (c.slug = 'disaster-emergency' OR a.announcement_type = 'emergency')
         ORDER BY a.published_at DESC LIMIT 6`,
      ),
    })
  }),
)

publicRouter.get(
  '/emergency/:municipality',
  asyncHandler(async (req, res) => {
    const municipality = get(`SELECT * FROM municipalities WHERE slug = ? AND is_active = 1`, [req.params.municipality])
    if (!municipality) throw notFound('Municipality not found.')
    res.json({
      municipality,
      contacts: all(
        `SELECT * FROM emergency_contacts WHERE publication_status='published'
         AND (municipality_id = ? OR government_level = 'national') ORDER BY category, organization_name`,
        [municipality.id],
      ),
      announcements: all(
        `SELECT id, title, slug, summary, published_at FROM announcements
         WHERE publication_status='published' AND municipality_id = ? ORDER BY published_at DESC LIMIT 5`,
        [municipality.id],
      ),
    })
  }),
)

// ---------------------------------------------------------------------------
// CMS content, FAQs, legal documents
// ---------------------------------------------------------------------------
publicRouter.get(
  '/pages/:slug',
  asyncHandler(async (req, res) => {
    const page = get(`SELECT * FROM cms_pages WHERE slug = ? AND status = 'published'`, [req.params.slug])
    if (!page) throw notFound('Page not found.')
    res.json({ page })
  }),
)

publicRouter.get(
  '/pages',
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(`SELECT id, title, slug, section, excerpt, updated_at FROM cms_pages WHERE status='published' ORDER BY title`),
    })
  }),
)

publicRouter.get(
  '/faqs',
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(`SELECT id, question, answer, category FROM faqs WHERE status = 'published' ORDER BY sort_order, id`),
    })
  }),
)

publicRouter.get(
  '/legal/:docType',
  asyncHandler(async (req, res) => {
    const doc = get(
      `SELECT id, doc_type, title, version, content, status, effective_date, approved_by, updated_at
       FROM legal_documents WHERE doc_type = ? ORDER BY id DESC LIMIT 1`,
      [req.params.docType],
    )
    if (!doc) throw notFound('Document not found.')
    res.json({
      document: doc,
      // A document is only "in force" when it has been approved and given an effective date.
      inForce: Boolean(doc.approved_by) && Boolean(doc.effective_date),
      versions: all(
        `SELECT version, status, effective_date, created_at FROM legal_documents WHERE doc_type = ? ORDER BY id DESC`,
        [req.params.docType],
      ),
    })
  }),
)

// ---------------------------------------------------------------------------
// Public submissions (feedback, corrections, privacy requests, security reports)
// ---------------------------------------------------------------------------
const submissionLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 12, key: (req) => `submit:${req.ip}` })

publicRouter.post(
  '/reports',
  submissionLimit,
  validate(
    z.object({
      kind: z.enum(['feedback', 'concern', 'suggestion', 'consultation']),
      subject: z.string().trim().min(5, 'Give your submission a short title.').max(160),
      description: z.string().trim().min(20, 'Describe your submission in at least 20 characters.').max(5000),
      municipalityId: z.coerce.number().int().positive().optional().or(z.literal('')),
      contactEmail: z.string().trim().toLowerCase().email('Enter a valid email address.').max(200).optional().or(z.literal('')),
      isPublic: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const ref = reference('BGR')
    run(
      `INSERT INTO citizen_reports (reference, user_id, kind, subject, description, municipality_id, contact_email, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ref,
        req.user?.id ?? null,
        req.body.kind,
        cleanText(req.body.subject, 160),
        cleanText(req.body.description, 5000),
        req.body.municipalityId ? Number(req.body.municipalityId) : null,
        req.body.contactEmail || req.user?.email || null,
        req.body.isPublic === true || req.body.isPublic === 'true' || req.body.isPublic === 'on' ? 1 : 0,
      ],
    )
    res.status(201).json({
      message:
        'Thank you. Your submission has been received for review. BetterGo is an independent initiative and this does not create an official government case or guarantee government action.',
      reference: ref,
    })
  }),
)

publicRouter.post(
  '/corrections',
  submissionLimit,
  validate(
    z.object({
      targetType: z.enum(['office', 'service', 'announcement', 'municipality', 'document', 'emergency', 'other']),
      targetId: z.coerce.number().int().positive().optional().or(z.literal('')),
      targetLabel: z.string().trim().max(200).optional().or(z.literal('')),
      field: z.string().trim().max(80).optional().or(z.literal('')),
      description: z.string().trim().min(10, 'Describe what needs correcting.').max(3000),
      contactEmail: z.string().trim().toLowerCase().email('Enter a valid email address.').max(200).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const ref = reference('BGC')
    run(
      `INSERT INTO correction_reports (reference, target_type, target_id, target_label, field, description, contact_email)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ref,
        req.body.targetType,
        req.body.targetId ? Number(req.body.targetId) : null,
        req.body.targetLabel || null,
        req.body.field || null,
        cleanText(req.body.description, 3000),
        req.body.contactEmail || null,
      ],
    )
    res.status(201).json({
      message: 'Thank you. Correction reports are reviewed by an administrator before any change is published.',
      reference: ref,
    })
  }),
)

publicRouter.post(
  '/data-requests',
  submissionLimit,
  validate(
    z.object({
      category: z.enum(['access', 'correction', 'deletion', 'restriction', 'withdraw_consent', 'concern', 'question']),
      description: z.string().trim().min(10, 'Describe your request.').max(3000),
      requesterName: z.string().trim().min(1, 'Enter your name.').max(120),
      requesterEmail: z.string().trim().toLowerCase().email('Enter a valid email address.'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const ref = reference('BGDR')
    run(
      `INSERT INTO data_requests (reference, user_id, requester_name, requester_email, category, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ref, req.user?.id ?? null, cleanText(req.body.requesterName, 120), req.body.requesterEmail, req.body.category, cleanText(req.body.description, 3000)],
    )
    logAudit(req, { action: 'privacy.request_submitted', module: 'privacy', entityType: 'data_request', entityId: ref })
    res.status(201).json({
      message:
        'Your request has been received. We may contact you to verify your identity before releasing or changing personal information. Some records may need to be retained where the law requires it.',
      reference: ref,
    })
  }),
)

publicRouter.post(
  '/security-reports',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5, key: (req) => `sec:${req.ip}` }),
  validate(
    z.object({
      title: z.string().trim().min(5, 'Add a short title.').max(160),
      description: z.string().trim().min(20, 'Describe the issue.').max(5000),
      affectedArea: z.string().trim().max(200).optional().or(z.literal('')),
      reproductionSteps: z.string().trim().max(4000).optional().or(z.literal('')),
      impact: z.string().trim().max(2000).optional().or(z.literal('')),
      contactEmail: z.string().trim().toLowerCase().email('Enter a valid email address.').max(200).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const ref = reference('BGS')
    run(
      `INSERT INTO security_reports (reference, title, description, affected_area, reproduction_steps, impact, contact_email)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ref,
        cleanText(req.body.title, 160),
        cleanText(req.body.description, 5000),
        req.body.affectedArea || null,
        req.body.reproductionSteps || null,
        req.body.impact || null,
        req.body.contactEmail || null,
      ],
    )
    res.status(201).json({
      message:
        'Thank you for the responsible disclosure. Reports are reviewed privately and are never published automatically. Please do not access or modify other people\'s data while testing.',
      reference: ref,
    })
  }),
)
