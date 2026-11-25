import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { requireAdmin, requirePermission, ctx, canUseMunicipality, hasAnyPermission, superAdminCount } from '../rbac.js'
import { asyncHandler, badRequest, cleanText, forbidden, notFound, safeUrl, uniqueSlug, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { contentModule, field } from '../lib/crud.js'
import { logAudit } from '../audit.js'

export const adminContentRouter = Router()
adminContentRouter.use(requireAdmin)

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------
adminContentRouter.use(
  '/announcements',
  contentModule({
    base: 'announcements',
    table: 'announcements',
    label: 'Announcement',
    searchColumns: ['title', 'summary'],
    listColumns:
      't.*, c.name AS category_name, m.name AS municipality_name, u.name AS author',
    joinSql:
      'LEFT JOIN announcement_categories c ON c.id = t.category_id LEFT JOIN municipalities m ON m.id = t.municipality_id LEFT JOIN users u ON u.id = t.created_by',
    listFilters: { category: 'category_id', type: 'announcement_type' },
    permissions: {
      view: ['announcements.view', 'content.view'],
      create: ['announcements.create'],
      update: ['announcements.update'],
      approve: ['announcements.approve', 'content.approve'],
      publish: ['announcements.publish', 'content.publish'],
      archive: ['announcements.archive', 'content.archive'],
    },
    fields: {
      title: field('text', { max: 200 }),
      slug: field('slug'),
      summary: field('text', { max: 600 }),
      content: field('longtext', { max: 100000 }),
      featured_image: field('text', { max: 500 }),
      category_id: field('int'),
      municipality_id: field('int'),
      announcement_type: field('text', { max: 40 }),
      priority: field('text', { max: 20 }),
      coverage: field('text', { max: 20 }),
      source_type: field('text', { max: 30 }),
      source_organization: field('text', { max: 200 }),
      source_url: field('url'),
      is_featured: field('bit'),
      expires_at: field('date'),
      effective_at: field('date'),
    },
    allowDelete: true,
  }),
)

// ---------------------------------------------------------------------------
// Government directory
// ---------------------------------------------------------------------------
adminContentRouter.use(
  '/directory',
  contentModule({
    base: 'directory',
    table: 'government_offices',
    label: 'Office',
    searchColumns: ['name', 'description', 'responsibilities'],
    listColumns: 't.*, m.name AS municipality_name, d.name AS department_name',
    joinSql: 'LEFT JOIN municipalities m ON m.id = t.municipality_id LEFT JOIN government_departments d ON d.id = t.department_id',
    listFilters: { level: 'government_level', category: 'category' },
    permissions: {
      view: ['directory.view', 'content.view'],
      create: ['directory.create'],
      update: ['directory.update'],
      approve: ['directory.approve', 'content.approve'],
      publish: ['directory.approve', 'content.publish'],
      archive: ['directory.approve', 'content.archive'],
    },
    fields: {
      name: field('text', { max: 200 }),
      slug: field('slug'),
      description: field('longtext', { max: 5000 }),
      responsibilities: field('plainlongtext', { max: 5000 }),
      office_type: field('text', { max: 80 }),
      category: field('text', { max: 80 }),
      government_level: field('text', { max: 30 }),
      department_id: field('int'),
      municipality_id: field('int'),
      email: field('email'),
      phone: field('text', { max: 40 }),
      address: field('text', { max: 300 }),
      operating_hours: field('text', { max: 200 }),
      website: field('url'),
      facebook: field('url'),
      image: field('text', { max: 500 }),
      latitude: field('int'),
      longitude: field('int'),
      source_reference: field('text', { max: 500 }),
      source_url: field('url'),
      last_verified_at: field('date'),
    },
    allowDelete: true,
  }),
)

// ---------------------------------------------------------------------------
// Transparency
// ---------------------------------------------------------------------------
adminContentRouter.use(
  '/transparency-records',
  contentModule({
    base: 'transparency-records',
    table: 'transparency_records',
    label: 'Transparency record',
    searchColumns: ['title', 'description'],
    listColumns: 't.*, m.name AS municipality_name',
    joinSql: 'LEFT JOIN municipalities m ON m.id = t.municipality_id',
    listFilters: { category: 'record_category', year: 'fiscal_year' },
    permissions: {
      view: ['transparency.view', 'content.view'],
      create: ['transparency.documents.manage'],
      update: ['transparency.documents.manage'],
      approve: ['transparency.data.approve'],
      publish: ['transparency.data.approve'],
      archive: ['transparency.documents.manage'],
    },
    fields: {
      title: field('text', { max: 250 }),
      slug: field('slug'),
      description: field('longtext', { max: 8000 }),
      record_category: field('text', { max: 40 }),
      government_level: field('text', { max: 30 }),
      municipality_id: field('int'),
      issuing_office: field('text', { max: 200 }),
      fiscal_year: field('int'),
      period_label: field('text', { max: 100 }),
      source_url: field('url'),
      source_organization: field('text', { max: 200 }),
      publication_date: field('date'),
      last_verified_at: field('date'),
    },
    allowDelete: true,
  }),
)

adminContentRouter.use(
  '/documents',
  contentModule({
    base: 'documents',
    table: 'public_documents',
    label: 'Document',
    searchColumns: ['title', 'description', 'issuing_organization'],
    listColumns: 't.*, m.name AS municipality_name',
    joinSql: 'LEFT JOIN municipalities m ON m.id = t.municipality_id',
    listFilters: { category: 'document_category', year: 'fiscal_year' },
    permissions: {
      view: ['transparency.view', 'content.view'],
      create: ['transparency.documents.manage'],
      update: ['transparency.documents.manage'],
      approve: ['transparency.data.approve'],
      publish: ['transparency.data.approve'],
      archive: ['transparency.documents.manage'],
    },
    fields: {
      title: field('text', { max: 250 }),
      slug: field('slug'),
      description: field('longtext', { max: 4000 }),
      document_category: field('text', { max: 60 }),
      issuing_organization: field('text', { max: 200 }),
      government_level: field('text', { max: 30 }),
      municipality_id: field('int'),
      fiscal_year: field('int'),
      publication_date: field('date'),
      file_name: field('text', { max: 300 }),
      file_path: field('text', { max: 500 }),
      file_type: field('text', { max: 100 }),
      file_size: field('int'),
      source_url: field('url'),
    },
    allowDelete: true,
  }),
)

adminContentRouter.get(
  '/financial-records',
  requirePermission('transparency.view'),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const params = []
    let where = '1 = 1'
    if (!context.hasGlobalScope) {
      if (context.municipalityIds.length === 0) where += ` AND 1 = 0`
      else {
        where += ` AND (municipality_id IS NULL OR municipality_id IN (${context.municipalityIds.map(() => '?').join(',')}))`
        params.push(...context.municipalityIds)
      }
    }
    res.json({
      results: all(`SELECT * FROM financial_records WHERE ${where} ORDER BY fiscal_year DESC, id DESC LIMIT 500`, params),
      note: 'Amounts are stored as integer centavos to avoid floating point rounding. Only verified records appear in public summaries.',
    })
  }),
)

adminContentRouter.post(
  '/financial-records',
  requirePermission('transparency.data.import'),
  validate(
    z.object({
      fiscalYear: z.coerce.number().int().min(1900).max(2200),
      financialCategory: z.enum(['proposed_budget', 'approved_budget', 'allocation', 'obligation', 'disbursement', 'expenditure']),
      governmentLevel: z.enum(['provincial', 'municipal', 'national']),
      municipalityId: z.coerce.number().int().positive().nullable().optional(),
      departmentName: z.string().trim().max(200).optional(),
      amount: z.coerce.number().min(0).max(1_000_000_000_000),
      periodLabel: z.string().trim().max(100).optional(),
      sourceReference: z.string().trim().max(500).optional(),
      sourceUrl: z.string().trim().max(500).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const municipalityId = req.body.municipalityId ? Number(req.body.municipalityId) : null
    if (municipalityId && !canUseMunicipality(context, municipalityId)) throw forbidden('Outside your municipality scope.')
    if (!municipalityId && !context.hasGlobalScope) throw forbidden('Scoped administrators must select their municipality.')
    const cents = Math.round(req.body.amount * 100)
    if (!Number.isSafeInteger(cents)) throw unprocessable('The amount is out of range.')
    const result = run(
      `INSERT INTO financial_records (fiscal_year, financial_category, government_level, municipality_id, department_name,
        amount_cents, currency, period_label, source_reference, source_url, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, 'PHP', ?, ?, ?, 'pending')`,
      [
        req.body.fiscalYear,
        req.body.financialCategory,
        req.body.governmentLevel,
        municipalityId,
        cleanText(req.body.departmentName, 200),
        cents,
        cleanText(req.body.periodLabel, 100),
        cleanText(req.body.sourceReference, 500),
        safeUrl(req.body.sourceUrl),
      ],
    )
    logAudit(req, {
      action: 'transparency.financial_record_added',
      module: 'transparency',
      entityType: 'financial_record',
      entityId: Number(result.lastInsertRowid),
      newValues: { fiscalYear: req.body.fiscalYear, cents },
    })
    res.status(201).json({ message: 'Financial record saved as pending verification.', id: Number(result.lastInsertRowid) })
  }),
)

adminContentRouter.post(
  '/financial-records/:id/verify',
  requirePermission('transparency.data.approve'),
  validate(z.object({ approved: z.boolean() })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM financial_records WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Financial record not found.')
    run(`UPDATE financial_records SET verification_status = ? WHERE id = ?`, [req.body.approved ? 'verified' : 'rejected', row.id])
    logAudit(req, {
      action: 'transparency.financial_record_verified',
      module: 'transparency',
      entityType: 'financial_record',
      entityId: row.id,
      newValues: { verification_status: req.body.approved ? 'verified' : 'rejected' },
    })
    res.json({ message: req.body.approved ? 'Record verified and included in public summaries.' : 'Record rejected.' })
  }),
)

// ---------------------------------------------------------------------------
// Emergency information
// ---------------------------------------------------------------------------
adminContentRouter.use(
  '/emergency',
  contentModule({
    base: 'emergency',
    table: 'emergency_contacts',
    label: 'Emergency record',
    searchColumns: ['organization_name', 'address'],
    listColumns: 't.*, m.name AS municipality_name',
    joinSql: 'LEFT JOIN municipalities m ON m.id = t.municipality_id',
    listFilters: { category: 'category', level: 'government_level' },
    permissions: {
      view: ['emergency.view', 'content.view'],
      create: ['emergency.manage'],
      update: ['emergency.manage'],
      approve: ['emergency.approve', 'content.approve'],
      publish: ['emergency.approve', 'content.publish'],
      archive: ['emergency.manage'],
    },
    fields: {
      organization_name: field('text', { max: 200 }),
      category: field('text', { max: 40 }),
      facility_type: field('text', { max: 80 }),
      government_level: field('text', { max: 30 }),
      municipality_id: field('int'),
      description: field('plainlongtext', { max: 2000 }),
      phone: field('text', { max: 40 }),
      alt_phone: field('text', { max: 40 }),
      address: field('text', { max: 300 }),
      email: field('email'),
      website: field('url'),
      operating_hours: field('text', { max: 200 }),
      services: field('plainlongtext', { max: 1000 }),
      latitude: field('int'),
      longitude: field('int'),
      source_reference: field('text', { max: 500 }),
      source_url: field('url'),
      last_verified_at: field('date'),
      next_review_at: field('date'),
    },
    allowDelete: true,
  }),
)

// ---------------------------------------------------------------------------
// Municipalities & departments
// ---------------------------------------------------------------------------
adminContentRouter.get(
  '/municipalities',
  requirePermission('municipalities.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(
        `SELECT m.*,
          (SELECT COUNT(*) FROM announcements a WHERE a.municipality_id = m.id AND a.publication_status='published') AS announcements,
          (SELECT COUNT(*) FROM government_services s WHERE s.municipality_id = m.id AND s.publication_status='published') AS services,
          (SELECT COUNT(*) FROM government_offices o WHERE o.municipality_id = m.id AND o.publication_status='published') AS offices,
          (SELECT COUNT(*) FROM user_role_assignments ura WHERE ura.municipality_id = m.id AND ura.status='active' AND ura.revoked_at IS NULL AND ura.role_id = (SELECT id FROM user_roles WHERE slug='municipal_admin')) AS administrators
         FROM municipalities m WHERE m.is_active = 1 ORDER BY m.sort_order`,
      ),
    })
  }),
)

adminContentRouter.patch(
  '/municipalities/:id',
  requirePermission('municipalities.manage'),
  validate(
    z.object({
      description: z.string().trim().max(2000).optional(),
      overview: z.string().trim().max(5000).optional(),
      officialWebsite: z.string().trim().max(500).optional(),
      email: z.string().trim().max(200).optional(),
      phone: z.string().trim().max(40).optional(),
      officeAddress: z.string().trim().max(300).optional(),
      coverImage: z.string().trim().max(500).optional(),
      population: z.coerce.number().int().min(0).max(100_000_000).nullable().optional(),
      geographicInfo: z.string().trim().max(2000).optional(),
      sourceReference: z.string().trim().max(500).optional(),
      sourceUrl: z.string().trim().max(500).optional(),
      verificationStatus: z.enum(['pending', 'verified', 'unverified']).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM municipalities WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Municipality not found.')
    const context = ctx(req)
    if (!canUseMunicipality(context, row.id)) throw forbidden('You may only manage your assigned municipality.')
    const d = req.body
    // Only store a website that is a real http(s) URL; official details must be verified.
    const website = d.officialWebsite !== undefined ? safeUrl(d.officialWebsite) : undefined
    if (d.officialWebsite && !website) throw unprocessable('Enter a valid http(s) official website URL.')
    run(
      `UPDATE municipalities SET description=COALESCE(?, description), overview=COALESCE(?, overview),
        official_website=COALESCE(?, official_website), email=COALESCE(?, email), phone=COALESCE(?, phone),
        office_address=COALESCE(?, office_address), cover_image=COALESCE(?, cover_image),
        population=COALESCE(?, population), geographic_info=COALESCE(?, geographic_info),
        source_reference=COALESCE(?, source_reference), source_url=COALESCE(?, source_url),
        verification_status=COALESCE(?, verification_status),
        last_verified_at=CASE WHEN ? = 'verified' THEN ? ELSE last_verified_at END, updated_at=?
       WHERE id=?`,
      [
        d.description ? cleanText(d.description, 2000) : null,
        d.overview ? cleanText(d.overview, 5000) : null,
        website ?? null,
        d.email ? cleanText(d.email, 200) : null,
        d.phone ? cleanText(d.phone, 40) : null,
        d.officeAddress ? cleanText(d.officeAddress, 300) : null,
        d.coverImage ? cleanText(d.coverImage, 500) : null,
        d.population ?? null,
        d.geographicInfo ? cleanText(d.geographicInfo, 2000) : null,
        d.sourceReference ? cleanText(d.sourceReference, 500) : null,
        d.sourceUrl ? safeUrl(d.sourceUrl) : null,
        d.verificationStatus || null,
        d.verificationStatus || '',
        nowIso(),
        nowIso(),
        row.id,
      ],
    )
    logAudit(req, { action: 'municipalities.updated', module: 'municipalities', entityType: 'municipality', entityId: row.id, newValues: d })
    res.json({ message: 'Municipality information updated.', record: get(`SELECT * FROM municipalities WHERE id = ?`, [row.id]) })
  }),
)

adminContentRouter.get(
  '/departments',
  requirePermission('directory.view'),
  asyncHandler(async (_req, res) => {
    res.json({ results: all(`SELECT d.*, m.name AS municipality_name FROM government_departments d LEFT JOIN municipalities m ON m.id = d.municipality_id ORDER BY d.name`) })
  }),
)

adminContentRouter.post(
  '/departments',
  requirePermission('directory.create'),
  validate(
    z.object({
      name: z.string().trim().min(2).max(200),
      description: z.string().trim().max(2000).optional(),
      departmentType: z.string().trim().max(80).optional(),
      governmentLevel: z.enum(['provincial', 'municipal', 'national']),
      municipalityId: z.coerce.number().int().positive().nullable().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const municipalityId = req.body.municipalityId ? Number(req.body.municipalityId) : null
    if (municipalityId && !canUseMunicipality(context, municipalityId)) throw forbidden('Outside your scope.')
    const slug = uniqueSlug(run, get, 'government_departments', 'slug', req.body.name)
    const result = run(
      `INSERT INTO government_departments (municipality_id, name, slug, description, department_type, government_level, publication_status)
       VALUES (?, ?, ?, ?, ?, ?, 'published')`,
      [municipalityId, cleanText(req.body.name, 200), slug, cleanText(req.body.description, 2000), cleanText(req.body.departmentType, 80), req.body.governmentLevel],
    )
    logAudit(req, { action: 'directory.department_created', module: 'directory', entityType: 'department', entityId: Number(result.lastInsertRowid) })
    res.status(201).json({ message: 'Department created.', id: Number(result.lastInsertRowid), slug })
  }),
)

// ---------------------------------------------------------------------------
// Content review queue (shared)
// ---------------------------------------------------------------------------
adminContentRouter.get(
  '/review-queue',
  requirePermission('content.approve', 'content.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      announcements: all(
        `SELECT id, title, publication_status, updated_at FROM announcements
         WHERE publication_status IN ('submitted_for_review','under_review') ORDER BY updated_at DESC`,
      ),
      services: all(
        `SELECT id, title, publication_status, updated_at FROM government_services
         WHERE publication_status IN ('submitted_for_review','under_review') ORDER BY updated_at DESC`,
      ),
      offices: all(
        `SELECT id, name, publication_status, updated_at FROM government_offices
         WHERE publication_status IN ('submitted_for_review','under_review') ORDER BY updated_at DESC`,
      ),
      cms: all(
        `SELECT id, title, status AS publication_status, updated_at FROM cms_pages
         WHERE status IN ('submitted_for_review','under_review') ORDER BY updated_at DESC`,
      ),
      corrections: all(`SELECT id, reference, target_type, description, created_at FROM correction_reports WHERE status='submitted' ORDER BY id DESC`),
    })
  }),
)
