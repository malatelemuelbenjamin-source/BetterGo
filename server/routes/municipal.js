import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler, badRequest, pagination } from '../lib/http.js'
import { rateLimit } from '../auth.js'
import { validate } from '../lib/validate.js'
import {
  APPLICATION_STATUSES,
  CONTENT_PRIORITIES,
  FEEDBACK_KINDS,
  PROJECT_STATUSES,
  RESOURCE_TYPES,
  SUBSCRIPTION_TOPICS,
  confirmSubscription,
  createFeedback,
  municipalContentFeed,
  municipalDiscovery,
  municipalFaqs,
  municipalOfficeDirectory,
  municipalProjectDetail,
  municipalResourceCenter,
  recordPortalMetric,
  subscribeToMunicipality,
  trackFeedback,
  unsubscribe,
} from '../lib/municipal-modules.js'
import {
  MUNICIPAL_CONTENT_TYPES,
  municipalContentDetail,
  municipalContentList,
  municipalityAnnouncements,
  municipalityBySlug,
  municipalityOffices,
  municipalityMetrics,
  municipalityServices,
  municipalPortal,
  municipalPortalDirectory,
  publicMunicipality,
} from '../lib/municipal.js'

/**
 * Public municipal portal routes (Phase 3, Prompt 43).
 *
 * Every query here is limited to published public records. Drafts, content
 * awaiting review, archived records and municipality-private administrative
 * data are never returned by these endpoints.
 */
export const municipalRouter = Router()

const v1Limit = rateLimit({ windowMs: 60_000, max: 120, key: (req) => `municipal-v1:${req.ip}` })

municipalRouter.get(
  '/municipal-portals',
  asyncHandler(async (_req, res) => {
    const results = municipalPortalDirectory()
    res.json({
      results,
      total: results.length,
      notice:
        'Counts are published BetterGo records only. An empty portal means no verified public information has been published yet.',
    })
  }),
)

municipalRouter.get(
  '/municipal-portals/:slug',
  asyncHandler(async (req, res) => {
    const payload = municipalPortal(req.params.slug)
    recordPortalMetric(payload.municipality.id, 'portal_view')
    res.json({ ...payload, labels: { projectStatuses: PROJECT_STATUSES, applicationStatuses: APPLICATION_STATUSES, priorities: CONTENT_PRIORITIES } })
  }),
)

municipalRouter.get(
  '/municipal-portals/:slug/content',
  asyncHandler(async (req, res) => {
    const { page, limit } = pagination({ ...req.query, limit: req.query.limit || 12 })
    const type = req.query.type ? String(req.query.type) : null
    if (type && !MUNICIPAL_CONTENT_TYPES[type]) {
      return res.status(400).json({ error: 'Unknown municipal content type.' })
    }
    res.json(
      municipalContentList(req.params.slug, {
        type,
        q: req.query.q ? String(req.query.q).slice(0, 120) : '',
        page,
        limit: Math.min(limit, 50),
        featured: req.query.featured === 'true',
      }),
    )
  }),
)

municipalRouter.get(
  '/municipal-portals/:slug/content/:contentSlug',
  asyncHandler(async (req, res) => {
    res.json(municipalContentDetail(req.params.slug, req.params.contentSlug))
  }),
)

municipalRouter.get(
  '/municipal-portals/:slug/announcements',
  asyncHandler(async (req, res) => {
    const municipality = municipalityBySlug(req.params.slug)
    const { limit } = pagination({ ...req.query, limit: req.query.limit || 20 })
    res.json({ municipality: publicMunicipality(municipality), results: municipalityAnnouncements(municipality.id, limit) })
  }),
)

municipalRouter.get(
  '/municipal-portals/:slug/offices',
  asyncHandler(async (req, res) => {
    const municipality = municipalityBySlug(req.params.slug)
    const { limit } = pagination({ ...req.query, limit: req.query.limit || 30 })
    res.json({ municipality: publicMunicipality(municipality), results: municipalityOffices(municipality.id, limit) })
  }),
)

municipalRouter.get(
  '/municipal-portals/:slug/services',
  asyncHandler(async (req, res) => {
    const municipality = municipalityBySlug(req.params.slug)
    const { limit } = pagination({ ...req.query, limit: req.query.limit || 20 })
    res.json({ municipality: publicMunicipality(municipality), results: municipalityServices(municipality.id, limit) })
  }),
)

/* --------------------------------------------------------------------------
 * Read-only developer API (v1)
 * ------------------------------------------------------------------------ */

const API_DISCLAIMER =
  'Published by BetterGo Marinduque. Independent civic platform, not an official government website. Confirm with the responsible office.'

municipalRouter.get(
  '/v1/municipalities/:slug',
  v1Limit,
  asyncHandler(async (req, res) => {
    const municipality = municipalityBySlug(req.params.slug)
    res.json({
      data: { municipality: publicMunicipality(municipality), metrics: municipalityMetrics(municipality.id) },
      disclaimer: API_DISCLAIMER,
    })
  }),
)

municipalRouter.get(
  '/v1/municipalities/:slug/:resource',
  v1Limit,
  asyncHandler(async (req, res) => {
    const resource = String(req.params.resource || '')
    const allowed = ['announcements', 'news', 'notices', 'projects', 'resources', 'offices', 'services']
    if (!allowed.includes(resource)) {
      return res.status(404).json({ error: 'API endpoint not found.' })
    }
    const municipality = municipalityBySlug(req.params.slug)
    const { limit, page } = pagination({ ...req.query, limit: req.query.limit || 20 })

    if (resource === 'announcements') {
      return res.json({
        data: municipalityAnnouncements(municipality.id, limit),
        meta: { municipality: municipality.slug, resource },
        disclaimer: API_DISCLAIMER,
      })
    }
    if (resource === 'offices') {
      return res.json({
        data: municipalityOffices(municipality.id, limit),
        meta: { municipality: municipality.slug, resource },
        disclaimer: API_DISCLAIMER,
      })
    }
    if (resource === 'services') {
      return res.json({
        data: municipalityServices(municipality.id, limit),
        meta: { municipality: municipality.slug, resource },
        disclaimer: API_DISCLAIMER,
      })
    }

    const type = resource === 'news' ? 'news' : resource === 'notices' ? 'notice' : resource === 'projects' ? 'project' : 'resource'
    const payload = municipalContentList(municipality.slug, { type, page, limit })
    res.json({
      data: payload.results,
      meta: {
        municipality: municipality.slug,
        resource,
        content_type: type,
        total: payload.total,
        page: payload.page,
        limit: payload.limit,
        totalPages: payload.totalPages,
      },
      disclaimer: API_DISCLAIMER,
    })
  }),
)

municipalRouter.get(
  '/v1/municipal-portals',
  v1Limit,
  asyncHandler(async (_req, res) => {
    res.json({ data: municipalPortalDirectory(), disclaimer: API_DISCLAIMER })
  }),
)

/* --------------------------------------------------------------------------
 * Municipal portal modules (Prompts 44–56): projects, programs, resources,
 * offices, FAQs, discovery, feedback and subscriptions.
 * ------------------------------------------------------------------------ */

const feedbackLimit = rateLimit({ windowMs: 60_000, max: 6, key: (req) => `municipal-feedback:${req.ip}` })
const subscribeLimit = rateLimit({ windowMs: 60_000, max: 6, key: (req) => `municipal-subscribe:${req.ip}` })

const MUNICIPAL_FILTERS = {
  projectStatuses: PROJECT_STATUSES,
  applicationStatuses: APPLICATION_STATUSES,
  priorities: CONTENT_PRIORITIES,
  feedbackKinds: FEEDBACK_KINDS,
  resourceTypes: RESOURCE_TYPES,
  subscriptionTopics: SUBSCRIPTION_TOPICS,
}

municipalRouter.get(
  '/municipal-portal-meta',
  asyncHandler(async (_req, res) => {
    res.json({ filters: MUNICIPAL_FILTERS, contentTypes: MUNICIPAL_CONTENT_TYPES })
  }),
)

municipalRouter.get(
  '/municipal-projects',
  asyncHandler(async (req, res) => {
    if (req.query.status && !PROJECT_STATUSES[req.query.status]) {
      return res.status(400).json({ error: 'Unknown project status.' })
    }
    res.json({
      ...municipalContentFeed({
        type: 'project',
        municipality: req.query.municipality ? String(req.query.municipality) : null,
        q: req.query.q ? String(req.query.q).slice(0, 120) : '',
        status: req.query.status ? String(req.query.status) : null,
        office: req.query.office ? String(req.query.office) : null,
        featured: req.query.featured === 'true',
        sort: req.query.sort ? String(req.query.sort) : null,
        page: req.query.page,
        limit: req.query.limit,
      }),
      statuses: PROJECT_STATUSES,
    })
  }),
)

municipalRouter.get(
  '/municipal-programs',
  asyncHandler(async (req, res) => {
    res.json({
      ...municipalContentFeed({
        type: 'program',
        municipality: req.query.municipality ? String(req.query.municipality) : null,
        q: req.query.q ? String(req.query.q).slice(0, 120) : '',
        upcoming: req.query.upcoming === 'true',
        featured: req.query.featured === 'true',
        page: req.query.page,
        limit: req.query.limit,
      }),
      applicationStatuses: APPLICATION_STATUSES,
    })
  }),
)

municipalRouter.get(
  '/municipal-portals/:slug/projects/:projectSlug',
  asyncHandler(async (req, res) => {
    const payload = municipalProjectDetail(req.params.slug, req.params.projectSlug)
    recordPortalMetric(payload.municipality.id, 'project_view')
    res.json({
      ...payload,
      projectStatuses: PROJECT_STATUSES,
      applicationStatuses: APPLICATION_STATUSES,
    })
  }),
)

municipalRouter.get(
  '/municipal-resources',
  asyncHandler(async (req, res) => {
    res.json({
      ...municipalResourceCenter({
        municipality: req.query.municipality ? String(req.query.municipality) : null,
        category: req.query.category ? String(req.query.category) : null,
        q: req.query.q ? String(req.query.q).slice(0, 120) : '',
        limit: req.query.limit,
      }),
      resourceTypes: RESOURCE_TYPES,
    })
  }),
)

municipalRouter.get(
  '/municipal-faqs',
  asyncHandler(async (req, res) => {
    res.json({
      results: municipalFaqs({
        municipality: req.query.municipality ? String(req.query.municipality) : null,
        q: req.query.q ? String(req.query.q).slice(0, 120) : '',
        limit: req.query.limit,
      }),
    })
  }),
)

municipalRouter.get(
  '/municipal-offices',
  asyncHandler(async (req, res) => {
    res.json({
      ...municipalOfficeDirectory({
        municipality: req.query.municipality ? String(req.query.municipality) : null,
        q: req.query.q ? String(req.query.q).slice(0, 120) : '',
        level: req.query.level ? String(req.query.level) : null,
        limit: req.query.limit,
      }),
      notice:
        'Map markers are shown only for offices whose location an authorised administrator has verified. No coordinates are inferred.',
    })
  }),
)

municipalRouter.get(
  '/municipal-search',
  asyncHandler(async (req, res) => {
    res.json(
      municipalDiscovery({
        q: req.query.q,
        municipality: req.query.municipality ? String(req.query.municipality) : null,
        limit: 8,
      }),
    )
  }),
)

const feedbackSchema = z.object({
  municipality: z.string().trim().min(1).max(120).optional(),
  municipality_id: z.union([z.number(), z.string()]).optional(),
  content_slug: z.string().trim().max(200).optional(),
  content_type: z.string().trim().max(40).optional(),
  kind: z.enum(Object.keys(FEEDBACK_KINDS)).default('correction'),
  name: z.string().trim().max(120).optional().or(z.literal('')),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  message: z.string().trim().min(10).max(4000),
  page_url: z.string().trim().max(500).optional().or(z.literal('')),
})

municipalRouter.post(
  '/municipal-feedback',
  feedbackLimit,
  validate(feedbackSchema),
  asyncHandler(async (req, res) => {
    const body = req.body
    let municipalityId = null
    if (body.municipality) {
      municipalityId = municipalityBySlug(body.municipality).id
    } else if (body.municipality_id) {
      const found = get(`SELECT id FROM municipalities WHERE id = ? AND is_active = 1`, [Number(body.municipality_id)])
      if (found) municipalityId = found.id
    }
    let contentId = null
    if (municipalityId && body.content_slug) {
      const record = get(
        `SELECT id FROM municipal_content WHERE municipality_id = ? AND slug = ?`,
        [municipalityId, String(body.content_slug)],
      )
      if (record) contentId = record.id
    }
    const record = createFeedback({
      municipalityId,
      contentId,
      kind: body.kind,
      name: body.name || null,
      email: body.email ? String(body.email).toLowerCase() : null,
      message: body.message,
      pageUrl: body.page_url || null,
    })
    res.status(201).json({
      message:
        'Thank you. Your message was received and will be reviewed by an administrator. Submissions never change an official record directly.',
      feedback: {
        id: record.id,
        reference: record.reference,
        kind: record.kind,
        status: record.status,
        created_at: record.created_at,
      },
    })
  }),
)

const subscribeSchema = z.object({
  municipality: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  topics: z.array(z.enum(Object.keys(SUBSCRIPTION_TOPICS))).max(10).optional().default([]),
})

const trackSchema = z.object({
  reference: z.string().trim().min(4).max(40),
  email: z.string().trim().email().max(200),
})

municipalRouter.post(
  '/municipal-feedback/track',
  feedbackLimit,
  validate(trackSchema),
  asyncHandler(async (req, res) => {
    res.json({ inquiry: trackFeedback(req.body.reference, req.body.email) })
  }),
)

municipalRouter.post(
  '/municipal-subscriptions',
  subscribeLimit,
  validate(subscribeSchema),
  asyncHandler(async (req, res) => {
    const municipality = municipalityBySlug(req.body.municipality)
    const result = subscribeToMunicipality({
      municipalityId: municipality.id,
      email: String(req.body.email).toLowerCase(),
      topics: req.body.topics || [],
    })
    // No email provider is configured in this deployment, so the confirmation
    // link is returned to the caller and shown in the UI. It is single-use.
    res.status(201).json({
      message:
        'Subscription saved. Confirm it with the link below to start receiving updates. No email provider is configured yet, so the link is shown here instead of being emailed.',
      confirmation: {
        token: result.token,
        topicLabels: (req.body.topics || []).map((topic) => SUBSCRIPTION_TOPICS[topic]),
        url: `/api/municipal-subscriptions/confirm/${result.token}`,
      },
      topics: SUBSCRIPTION_TOPICS,
    })
  }),
)

municipalRouter.get(
  '/municipal-subscriptions/confirm/:token',
  asyncHandler(async (req, res) => {
    const result = confirmSubscription(req.params.token)
    res.json({ message: 'Subscription confirmed.', ...result })
  }),
)

municipalRouter.post(
  '/municipal-subscriptions/unsubscribe/:token',
  asyncHandler(async (req, res) => {
    res.json({ message: 'Subscription removed.', ...unsubscribe(req.params.token) })
  }),
)

/* --------------------------- v1 read-only API ---------------------------- */

municipalRouter.get(
  '/v1/municipal-projects',
  v1Limit,
  asyncHandler(async (req, res) => {
    const payload = municipalContentFeed({
      type: 'project',
      municipality: req.query.municipality ? String(req.query.municipality) : null,
      status: req.query.status ? String(req.query.status) : null,
      page: req.query.page,
      limit: req.query.limit,
    })
    res.json({
      data: payload.results,
      meta: { total: payload.total, page: payload.page, limit: payload.limit, totalPages: payload.totalPages },
      disclaimer: API_DISCLAIMER,
    })
  }),
)

municipalRouter.get(
  '/v1/municipal-programs',
  v1Limit,
  asyncHandler(async (req, res) => {
    const payload = municipalContentFeed({
      type: 'program',
      municipality: req.query.municipality ? String(req.query.municipality) : null,
      page: req.query.page,
      limit: req.query.limit,
    })
    res.json({
      data: payload.results,
      meta: { total: payload.total, page: payload.page, limit: payload.limit, totalPages: payload.totalPages },
      disclaimer: API_DISCLAIMER,
    })
  }),
)

municipalRouter.get(
  '/v1/municipal-offices',
  v1Limit,
  asyncHandler(async (req, res) => {
    res.json({
      data: municipalOfficeDirectory({
        municipality: req.query.municipality ? String(req.query.municipality) : null,
        limit: req.query.limit,
      }),
      disclaimer: API_DISCLAIMER,
    })
  }),
)
