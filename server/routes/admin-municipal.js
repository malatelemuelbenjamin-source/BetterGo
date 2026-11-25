import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { requireAdmin, requirePermission, ctx, canUseMunicipality, hasPermission } from '../rbac.js'
import { asyncHandler, badRequest, cleanText, forbidden, notFound, safeUrl, uniqueSlug } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { contentModule, field, WORKFLOW_LABELS } from '../lib/crud.js'
import { logAudit } from '../audit.js'
import { MUNICIPAL_CONTENT_TYPES, municipalityMetrics, parseSocialLinks } from '../lib/municipal.js'
import { listFeedback, portalAnalytics } from '../lib/municipal-modules.js'

/**
 * Municipal administrative workspace (Phase 3, Prompt 43).
 *
 * Mounted under /api/admin. Every endpoint is protected by requireAdmin and
 * then by an explicit permission plus a municipality scope check, so a
 * municipal administrator can never reach another municipality's records.
 */
export const adminMunicipalRouter = Router()
adminMunicipalRouter.use(requireAdmin)

function scopedMunicipalities(req) {
  const context = ctx(req)
  const rows = all(`SELECT * FROM municipalities WHERE is_active = 1 ORDER BY sort_order, name`)
  if (context.hasGlobalScope) return rows
  return rows.filter((row) => context.municipalityIds.includes(Number(row.id)))
}

function requireMunicipality(req, id) {
  const municipality = get(`SELECT * FROM municipalities WHERE id = ?`, [Number(id)])
  if (!municipality) throw notFound('Municipality not found.')
  const context = ctx(req)
  if (!context.hasGlobalScope && !canUseMunicipality(context, municipality.id)) {
    throw forbidden('This municipality is outside your assigned scope.')
  }
  return municipality
}

function statusCounts(municipalityId) {
  const counts = {}
  for (const key of Object.keys(WORKFLOW_LABELS)) counts[key] = 0
  const rows = all(
    `SELECT publication_status, COUNT(*) AS total FROM municipal_content
     WHERE municipality_id = ? GROUP BY publication_status`,
    [municipalityId],
  )
  for (const row of rows) counts[row.publication_status] = Number(row.total)
  return counts
}

function typeCounts(municipalityId) {
  const counts = {}
  for (const key of Object.keys(MUNICIPAL_CONTENT_TYPES)) counts[key] = 0
  const rows = all(
    `SELECT content_type, COUNT(*) AS total FROM municipal_content
     WHERE municipality_id = ? GROUP BY content_type`,
    [municipalityId],
  )
  for (const row of rows) counts[row.content_type] = Number(row.total)
  return counts
}

adminMunicipalRouter.get(
  '/municipal-portals',
  requirePermission('municipal.portal.view'),
  asyncHandler(async (req, res) => {
    const municipalities = scopedMunicipalities(req)
    const results = municipalities.map((municipality) => ({
      id: municipality.id,
      name: municipality.name,
      slug: municipality.slug,
      portal_title: municipality.portal_title || municipality.name,
      publication_status: municipality.publication_status,
      verification_status: municipality.verification_status,
      updated_at: municipality.updated_at,
      metrics: municipalityMetrics(municipality.id),
      statuses: statusCounts(municipality.id),
      types: typeCounts(municipality.id),
    }))
    res.json({ results, total: results.length, contentTypes: MUNICIPAL_CONTENT_TYPES })
  }),
)

adminMunicipalRouter.get(
  '/municipal-portals/:id',
  requirePermission('municipal.portal.view'),
  asyncHandler(async (req, res) => {
    const municipality = requireMunicipality(req, req.params.id)
    const metrics = municipalityMetrics(municipality.id)
    const recentContent = all(
      `SELECT c.id, c.content_type, c.title, c.slug, c.publication_status, c.verification_status,
              c.updated_at, c.published_at, u.name AS updated_by_name
       FROM municipal_content c LEFT JOIN users u ON u.id = c.updated_by
       WHERE c.municipality_id = ? ORDER BY c.updated_at DESC LIMIT 10`,
      [municipality.id],
    )
    const activity = all(
      `SELECT a.id, a.action, a.module, a.entity_type, a.entity_id, a.created_at, u.name AS actor
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.municipality_id = ? ORDER BY a.id DESC LIMIT 20`,
      [municipality.id],
    )
    res.json({
      municipality: {
        ...municipality,
        social_links: parseSocialLinks(municipality.social_links),
      },
      metrics,
      statuses: statusCounts(municipality.id),
      types: typeCounts(municipality.id),
      recentContent,
      activity,
      contentTypes: MUNICIPAL_CONTENT_TYPES,
      statusLabels: WORKFLOW_LABELS,
    })
  }),
)

const portalSettingsSchema = z.object({
  portal_title: z.string().trim().max(120).optional().or(z.literal('')),
  portal_description: z.string().trim().max(600).optional().or(z.literal('')),
  description: z.string().trim().max(600).optional().or(z.literal('')),
  overview: z.string().trim().max(20000).optional().or(z.literal('')),
  geographic_info: z.string().trim().max(5000).optional().or(z.literal('')),
  population: z.coerce.number().int().nonnegative().optional().or(z.literal('')),
  logo: z.string().trim().max(500).optional().or(z.literal('')),
  cover_image: z.string().trim().max(500).optional().or(z.literal('')),
  official_website: z.string().trim().max(300).optional().or(z.literal('')),
  email: z.string().trim().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  office_address: z.string().trim().max(300).optional().or(z.literal('')),
  office_hours: z.string().trim().max(200).optional().or(z.literal('')),
  social_links: z
    .object({
      facebook: z.string().trim().max(300).optional().or(z.literal('')),
      youtube: z.string().trim().max(300).optional().or(z.literal('')),
      instagram: z.string().trim().max(300).optional().or(z.literal('')),
      x: z.string().trim().max(300).optional().or(z.literal('')),
      website: z.string().trim().max(300).optional().or(z.literal('')),
    })
    .optional(),
  source_reference: z.string().trim().max(500).optional().or(z.literal('')),
  source_url: z.string().trim().max(500).optional().or(z.literal('')),
  verification_status: z.enum(['verified', 'pending', 'needs_update', 'unverified']).optional(),
})

adminMunicipalRouter.patch(
  '/municipal-portals/:id',
  requirePermission('municipal.portal.manage'),
  validate(portalSettingsSchema),
  asyncHandler(async (req, res) => {
    const municipality = requireMunicipality(req, req.params.id)
    const body = req.body
    const updates = {}
    const textFields = [
      'portal_title',
      'portal_description',
      'description',
      'overview',
      'geographic_info',
      'logo',
      'cover_image',
      'office_address',
      'office_hours',
      'phone',
      'source_reference',
    ]
    for (const key of textFields) {
      if (body[key] !== undefined) updates[key] = cleanText(body[key], key === 'overview' ? 20000 : 600)
    }
    if (body.email !== undefined) updates.email = cleanText(body.email, 200)?.toLowerCase() || null
    if (body.official_website !== undefined) {
      const url = body.official_website ? safeUrl(body.official_website) : null
      if (body.official_website && !url) throw badRequest('Official website must be a valid http(s) address.')
      updates.official_website = url
    }
    if (body.source_url !== undefined) {
      const url = body.source_url ? safeUrl(body.source_url) : null
      if (body.source_url && !url) throw badRequest('Source URL must be a valid http(s) address.')
      updates.source_url = url
    }
    if (body.population !== undefined && body.population !== '') {
      updates.population = Number(body.population)
    }
    if (body.social_links !== undefined) {
      const links = {}
      for (const [key, value] of Object.entries(body.social_links || {})) {
        if (!value) continue
        const url = safeUrl(value)
        if (!url) throw badRequest(`The ${key} link must be a valid http(s) address.`)
        links[key] = url
      }
      updates.social_links = Object.keys(links).length ? JSON.stringify(links) : null
    }
    if (body.verification_status !== undefined) {
      // Verification is a reviewer decision and always needs a recorded source.
      if (body.verification_status === 'verified' && !(updates.source_reference || municipality.source_reference)) {
        throw badRequest('Record a source reference before marking the municipal record as verified.')
      }
      updates.verification_status = body.verification_status
      updates.last_verified_at = nowIso()
    }
    if (!Object.keys(updates).length) throw badRequest('No portal settings were provided.')

    updates.updated_at = nowIso()
    const columns = Object.keys(updates)
    run(`UPDATE municipalities SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [
      ...columns.map((c) => updates[c]),
      municipality.id,
    ])
    logAudit(req, {
      action: 'municipal.portal_updated',
      module: 'municipal portals',
      entityType: 'municipality',
      entityId: municipality.id,
      municipalityId: municipality.id,
      oldValues: { portal_title: municipality.portal_title, verification_status: municipality.verification_status },
      newValues: { fields: columns.filter((c) => c !== 'updated_at') },
    })
    res.json({
      message: 'Municipal portal settings saved.',
      municipality: get(`SELECT * FROM municipalities WHERE id = ?`, [municipality.id]),
    })
  }),
)

/* --------------------------------------------------------------------------
 * Municipal content — reuses the shared Phase 2 workflow engine
 * ------------------------------------------------------------------------ */
adminMunicipalRouter.use(
  '/municipal-content',
  contentModule({
    base: 'municipal-content',
    table: 'municipal_content',
    label: 'Municipal content',
    searchColumns: ['title', 'summary'],
    listColumns: 't.*, m.name AS municipality_name, m.slug AS municipality_slug, u.name AS author_name',
    joinSql: 'LEFT JOIN municipalities m ON m.id = t.municipality_id LEFT JOIN users u ON u.id = t.created_by',
    listFilters: { type: 'content_type', featured: 'is_featured' },
    permissions: {
      view: ['municipal.content.view'],
      create: ['municipal.content.create'],
      update: ['municipal.content.update'],
      submit: ['municipal.content.create', 'municipal.content.update'],
      approve: ['municipal.content.review'],
      publish: ['municipal.content.publish'],
      archive: ['municipal.content.archive'],
    },
    fields: {
      title: field('text', { max: 200 }),
      slug: field('slug'),
      summary: field('text', { max: 600 }),
      body: field('longtext', { max: 100000 }),
      content_type: field('text', { max: 40 }),
      featured_image: field('text', { max: 500 }),
      image_alt: field('text', { max: 300 }),
      image_credit: field('text', { max: 300 }),
      external_url: field('url'),
      contact_details: field('plainlongtext', { max: 5000 }),
      source_reference: field('text', { max: 500 }),
      source_url: field('url'),
      is_featured: field('bit'),
      sort_order: field('int'),
      starts_at: field('date'),
      ends_at: field('date'),
      municipality_id: field('int'),
      // Prompts 44-49: publishing, program and project fields.
      priority: field('text', { max: 20 }),
      pinned: field('bit'),
      venue: field('text', { max: 300 }),
      event_start: field('date'),
      event_end: field('date'),
      eligibility: field('plainlongtext', { max: 6000 }),
      application_status: field('text', { max: 30 }),
      project_status: field('text', { max: 30 }),
      beneficiaries: field('plainlongtext', { max: 4000 }),
      office_id: field('int'),
      progress_percent: field('int'),
      progress_note: field('plainlongtext', { max: 4000 }),
      attachment_url: field('url'),
      attachment_label: field('text', { max: 200 }),
      address: field('text', { max: 300 }),
      barangay: field('text', { max: 150 }),
      latitude: field('int'),
      longitude: field('int'),
    },
    revisions: { table: 'municipal_content_revisions', contentColumn: 'content_id' },
    allowDelete: true,
  }),
)

adminMunicipalRouter.get(
  '/municipal-content-meta',
  requirePermission('municipal.content.view'),
  asyncHandler(async (_req, res) => {
    res.json({ contentTypes: MUNICIPAL_CONTENT_TYPES, statusLabels: WORKFLOW_LABELS })
  }),
)

/* --------------------------------------------------------------------------
 * Prompts 46-47 - municipal office and department directory management
 * ------------------------------------------------------------------------ */

const officeSchema = z.object({
  municipality_id: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(4000).optional().or(z.literal('')),
  responsibilities: z.string().trim().max(20000).optional().or(z.literal('')),
  office_type: z.string().trim().max(80).optional().or(z.literal('')),
  category: z.string().trim().max(80).optional().or(z.literal('')),
  office_level: z.enum(['department', 'office', 'division', 'unit']).optional(),
  parent_office_id: z.coerce.number().int().positive().optional().or(z.literal('')),
  email: z.string().trim().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  operating_hours: z.string().trim().max(200).optional().or(z.literal('')),
  website: z.string().trim().max(300).optional().or(z.literal('')),
  facebook: z.string().trim().max(300).optional().or(z.literal('')),
  latitude: z.coerce.number().min(-90).max(90).optional().or(z.literal('')),
  longitude: z.coerce.number().min(-180).max(180).optional().or(z.literal('')),
  location_verified: z.coerce.boolean().optional(),
  service_note: z.string().trim().max(2000).optional().or(z.literal('')),
  source_reference: z.string().trim().max(500).optional().or(z.literal('')),
  source_url: z.string().trim().max(500).optional().or(z.literal('')),
  verification_status: z.enum(['verified', 'pending', 'needs_update', 'unverified']).optional(),
  publication_status: z.enum(['draft', 'submitted_for_review', 'under_review', 'approved', 'published', 'archived']).optional(),
})

function officeWritePayload(body, existing = null) {
  const updates = {}
  const textFields = [
    'description',
    'responsibilities',
    'office_type',
    'category',
    'phone',
    'address',
    'operating_hours',
    'service_note',
    'source_reference',
  ]
  for (const key of textFields) {
    if (body[key] !== undefined) {
      updates[key] = cleanText(body[key], key === 'responsibilities' ? 20000 : 4000)
    }
  }
  if (body.name !== undefined) updates.name = cleanText(body.name, 200)
  if (body.email !== undefined) updates.email = cleanText(body.email, 200)?.toLowerCase() || null
  for (const key of ['website', 'facebook']) {
    if (body[key] === undefined) continue
    const url = body[key] ? safeUrl(body[key]) : null
    if (body[key] && !url) throw badRequest(`${key} must be a valid http(s) address.`)
    updates[key] = url
  }
  if (body.source_url !== undefined) {
    const url = body.source_url ? safeUrl(body.source_url) : null
    if (body.source_url && !url) throw badRequest('Source URL must be a valid http(s) address.')
    updates.source_url = url
  }
  if (body.office_level !== undefined) updates.office_level = body.office_level
  if (body.parent_office_id !== undefined) {
    updates.parent_office_id = body.parent_office_id === '' ? null : Number(body.parent_office_id)
  }
  if (body.verification_status !== undefined) updates.verification_status = body.verification_status

  // Coordinates are stored together and only count as a map location when an
  // administrator explicitly marks them verified. Nothing is inferred.
  const hasCoords = body.latitude !== undefined || body.longitude !== undefined
  if (hasCoords) {
    const lat = body.latitude === '' || body.latitude === undefined ? null : Number(body.latitude)
    const lng = body.longitude === '' || body.longitude === undefined ? null : Number(body.longitude)
    if ((lat === null) !== (lng === null)) throw badRequest('Latitude and longitude must be recorded together.')
    updates.latitude = lat
    updates.longitude = lng
    const verified = body.location_verified === undefined ? Boolean(existing?.location_verified) : Boolean(body.location_verified)
    updates.location_verified = lat !== null && verified ? 1 : 0
  } else if (body.location_verified !== undefined) {
    updates.location_verified = body.location_verified && existing?.latitude ? 1 : 0
  } else if (!existing || existing.latitude === null) {
    updates.location_verified = 0
  }
  if (updates.location_verified === 1 && !existing?.latitude && updates.latitude === null) {
    throw badRequest('Record coordinates before marking an office location as verified.')
  }
  return updates
}

adminMunicipalRouter.get(
  '/municipal-offices',
  requirePermission('municipal.portal.view'),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const rows = all(
      `SELECT o.*, m.name AS municipality_name, p.name AS parent_office_name
       FROM government_offices o
       LEFT JOIN municipalities m ON m.id = o.municipality_id
       LEFT JOIN government_offices p ON p.id = o.parent_office_id
       WHERE o.municipality_id IS NOT NULL
       ORDER BY m.name, o.office_level = 'department' DESC, o.name`,
    )
    const results = context.hasGlobalScope
      ? rows
      : rows.filter((row) => context.municipalityIds.includes(Number(row.municipality_id)))
    res.json({ results, total: results.length })
  }),
)

adminMunicipalRouter.post(
  '/municipal-offices',
  requirePermission('municipal.portal.manage'),
  validate(officeSchema),
  asyncHandler(async (req, res) => {
    const municipality = requireMunicipality(req, req.body.municipality_id)
    const payload = officeWritePayload(req.body)
    const slug = uniqueSlug(run, get, 'government_offices', 'slug', payload.name, null)
    const id = Number(
      run(
        `INSERT INTO government_offices (name, slug, municipality_id, government_level, publication_status,
           verification_status, description, responsibilities, office_type, category, phone, email, address,
           operating_hours, website, facebook, latitude, longitude, location_verified, source_reference,
           source_url, office_level, parent_office_id, service_note, created_by)
         VALUES (?, ?, ?, 'municipal', 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.name,
          slug,
          municipality.id,
          payload.verification_status || 'pending',
          payload.description || null,
          payload.responsibilities || null,
          payload.office_type || null,
          payload.category || null,
          payload.phone || null,
          payload.email || null,
          payload.address || null,
          payload.operating_hours || null,
          payload.website || null,
          payload.facebook || null,
          payload.latitude ?? null,
          payload.longitude ?? null,
          payload.location_verified ? 1 : 0,
          payload.source_reference || null,
          payload.source_url || null,
          payload.office_level || 'office',
          payload.parent_office_id || null,
          payload.service_note || null,
          ctx(req).id,
        ],
      ).lastInsertRowid,
    )
    logAudit(req, {
      action: 'municipal.office_created',
      module: 'municipal offices',
      entityType: 'government_office',
      entityId: id,
      municipalityId: municipality.id,
      newValues: { name: payload.name },
    })
    res.status(201).json({
      message: 'Office created as a draft. Publish it once its details are verified.',
      office: get(`SELECT * FROM government_offices WHERE id = ?`, [id]),
    })
  }),
)

adminMunicipalRouter.patch(
  '/municipal-offices/:id',
  requirePermission('municipal.portal.manage'),
  validate(officeSchema.partial().omit({ municipality_id: true })),
  asyncHandler(async (req, res) => {
    const existing = get(`SELECT * FROM government_offices WHERE id = ?`, [Number(req.params.id)])
    if (!existing) throw notFound('Office not found.')
    const municipality = requireMunicipality(req, existing.municipality_id)
    const updates = officeWritePayload(req.body, existing)
    if (req.body.publication_status !== undefined) {
      const status = String(req.body.publication_status)
      if (!['draft', 'submitted_for_review', 'under_review', 'approved', 'published', 'archived'].includes(status)) {
        throw badRequest('Unknown publication status.')
      }
      if (status !== existing.publication_status) {
        const permission =
          status === 'published'
            ? 'municipal.content.publish'
            : status === 'archived'
              ? 'municipal.content.archive'
              : 'municipal.content.review'
        if (!hasPermission(ctx(req), permission)) throw forbidden('You do not have permission for that office transition.')
      }
      updates.publication_status = status
      if (status === 'published') updates.last_verified_at = nowIso()
    }
    if (!Object.keys(updates).length) throw badRequest('No office fields were provided.')
    updates.updated_at = nowIso()
    const columns = Object.keys(updates)
    run(`UPDATE government_offices SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [
      ...columns.map((c) => updates[c]),
      existing.id,
    ])
    logAudit(req, {
      action: 'municipal.office_updated',
      module: 'municipal offices',
      entityType: 'government_office',
      entityId: existing.id,
      municipalityId: municipality.id,
      oldValues: { publication_status: existing.publication_status, verification_status: existing.verification_status },
      newValues: { fields: columns.filter((c) => c !== 'updated_at') },
    })
    res.json({ message: 'Office updated.', office: get(`SELECT * FROM government_offices WHERE id = ?`, [existing.id]) })
  }),
)

/* --------------------------------------------------------------------------
 * Prompt 49 - public project/program updates (reported progress)
 * ------------------------------------------------------------------------ */

adminMunicipalRouter.get(
  '/municipal-content/:id/updates',
  requirePermission('municipal.content.view'),
  asyncHandler(async (req, res) => {
    const record = get(`SELECT * FROM municipal_content WHERE id = ?`, [Number(req.params.id)])
    if (!record) throw notFound('Municipal content not found.')
    requireMunicipality(req, record.municipality_id)
    res.json({
      results: all(
        `SELECT * FROM municipal_content_updates WHERE content_id = ? ORDER BY COALESCE(reported_on, created_at) DESC`,
        [record.id],
      ),
    })
  }),
)

const updateSchema = z.object({
  title: z.string().trim().max(200).optional().or(z.literal('')),
  description: z.string().trim().max(4000).optional().or(z.literal('')),
  reported_on: z.string().trim().max(40).optional().or(z.literal('')),
  progress_percent: z.coerce.number().int().min(0).max(100).optional().or(z.literal('')),
  source_reference: z.string().trim().max(500).optional().or(z.literal('')),
  source_url: z.string().trim().max(500).optional().or(z.literal('')),
  publication_status: z.enum(['draft', 'published']).optional(),
})

adminMunicipalRouter.post(
  '/municipal-content/:id/updates',
  requirePermission('municipal.content.update'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const record = get(`SELECT * FROM municipal_content WHERE id = ?`, [Number(req.params.id)])
    if (!record) throw notFound('Municipal content not found.')
    requireMunicipality(req, record.municipality_id)
    const published = req.body.publication_status === 'published'
    if (published && !hasPermission(ctx(req), 'municipal.content.publish')) {
      throw forbidden('You do not have permission to publish progress updates.')
    }
    if (published && !req.body.source_reference) {
      throw badRequest('A source reference is required before a progress update can be published.')
    }
    const id = Number(
      run(
        `INSERT INTO municipal_content_updates (content_id, municipality_id, update_type, title, description,
           reported_on, progress_percent, source_reference, source_url, publication_status, created_by)
         VALUES (?, ?, 'progress', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.municipality_id,
          req.body.title || null,
          req.body.description || null,
          req.body.reported_on || nowIso().slice(0, 10),
          req.body.progress_percent === '' || req.body.progress_percent === undefined ? null : Number(req.body.progress_percent),
          req.body.source_reference || null,
          req.body.source_url ? safeUrl(req.body.source_url) : null,
          published ? 'published' : 'draft',
          ctx(req).id,
        ],
      ).lastInsertRowid,
    )
    if (published && req.body.progress_percent !== undefined && req.body.progress_percent !== '') {
      run(
        `UPDATE municipal_content SET progress_percent = ?, progress_note = ?, progress_updated_at = ?, updated_at = ? WHERE id = ?`,
        [Number(req.body.progress_percent), req.body.description || record.progress_note, nowIso(), nowIso(), record.id],
      )
    }
    logAudit(req, {
      action: published ? 'municipal.progress_published' : 'municipal.progress_drafted',
      module: 'municipal projects',
      entityType: 'municipal_content',
      entityId: record.id,
      municipalityId: record.municipality_id,
      newValues: { update: id, progress_percent: req.body.progress_percent ?? null },
    })
    res.status(201).json({
      message: 'Project update saved.',
      update: get(`SELECT * FROM municipal_content_updates WHERE id = ?`, [id]),
    })
  }),
)

/* --------------------------------------------------------------------------
 * Prompt 52 - feedback and correction moderation
 * ------------------------------------------------------------------------ */

adminMunicipalRouter.get(
  '/municipal-feedback',
  requirePermission('municipal.portal.view'),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const rows = listFeedback({
      municipalityId: req.query.municipality_id ? Number(req.query.municipality_id) : null,
      status: req.query.status ? String(req.query.status) : null,
      limit: req.query.limit,
    })
    const results = context.hasGlobalScope
      ? rows
      : rows.filter((row) => row.municipality_id && context.municipalityIds.includes(Number(row.municipality_id)))
    res.json({ results, total: results.length })
  }),
)

adminMunicipalRouter.patch(
  '/municipal-feedback/:id',
  requirePermission('municipal.content.review'),
  validate(
    z.object({
      status: z.enum(['new', 'reviewing', 'resolved', 'closed']).optional(),
      response: z.string().trim().max(4000).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const record = get(`SELECT * FROM municipal_feedback WHERE id = ?`, [Number(req.params.id)])
    if (!record) throw notFound('Feedback not found.')
    if (record.municipality_id) requireMunicipality(req, record.municipality_id)
    run(
      `UPDATE municipal_feedback SET status = ?, response = ?, handled_by = ?, handled_at = ?, updated_at = ? WHERE id = ?`,
      [
        req.body.status || record.status,
        req.body.response !== undefined ? req.body.response || null : record.response,
        ctx(req).id,
        nowIso(),
        nowIso(),
        record.id,
      ],
    )
    logAudit(req, {
      action: 'municipal.feedback_reviewed',
      module: 'municipal feedback',
      entityType: 'municipal_feedback',
      entityId: record.id,
      municipalityId: record.municipality_id,
      newValues: { status: req.body.status || record.status },
    })
    res.json({ message: 'Feedback updated.', feedback: get(`SELECT * FROM municipal_feedback WHERE id = ?`, [record.id]) })
  }),
)

/* --------------------------------------------------------------------------
 * Prompt 53 - municipal portal analytics (aggregated, no personal data)
 * ------------------------------------------------------------------------ */

adminMunicipalRouter.get(
  '/municipal-analytics/:id',
  requirePermission('municipal.portal.view'),
  asyncHandler(async (req, res) => {
    const municipality = requireMunicipality(req, req.params.id)
    res.json(portalAnalytics(municipality.id, req.query.days))
  }),
)

/* --------------------------------------------------------------------------
 * Prompt 56 - municipal data export (authorised administrators only)
 * ------------------------------------------------------------------------ */

adminMunicipalRouter.get(
  '/municipal-export',
  requirePermission('municipal.portal.view'),
  asyncHandler(async (req, res) => {
    const municipality = requireMunicipality(req, req.query.municipality_id)
    const format = String(req.query.format || 'json')
    const rows = all(
      `SELECT c.content_type, c.title, c.slug, c.summary, c.publication_status, c.verification_status,
              c.priority, c.project_status, c.application_status, c.progress_percent,
              c.event_start, c.published_at, c.updated_at, c.source_reference
       FROM municipal_content c WHERE c.municipality_id = ? ORDER BY c.content_type, c.title`,
      [municipality.id],
    )
    logAudit(req, {
      action: 'municipal.data_exported',
      module: 'municipal portals',
      entityType: 'municipality',
      entityId: municipality.id,
      municipalityId: municipality.id,
      newValues: { format, rows: rows.length },
    })
    if (format === 'csv') {
      const header = Object.keys(rows[0] || { content_type: '', title: '' })
      const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
      const csv = [header.join(','), ...rows.map((row) => header.map((key) => escape(row[key])).join(','))].join('\n')
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="municipal-${municipality.slug}-content.csv"`)
      return res.send(csv)
    }
    res.json({ municipality: municipality.slug, exported_at: nowIso(), results: rows })
  }),
)
