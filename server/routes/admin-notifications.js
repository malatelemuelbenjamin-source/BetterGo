/**
 * Administrative notification management (Prompt 68 §14–16).
 *
 * Templates are plain text with a small allow-list of variables. Delivery logs
 * show only what actually happened: in-app rows exist, email/SMS rows appear
 * only when a provider is configured, and provider_confirmed marks the only
 * state that may be described as delivered. Bulk dispatch is deliberately
 * unavailable on this deployment; a campaign can be drafted and approved, but
 * nothing is sent and no counters are invented.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission } from '../rbac.js'
import { env } from '../env.js'
import { asyncHandler, cleanText, forbidden, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import {
  NOTIFICATION_CATEGORIES,
  TEMPLATE_VARIABLES,
  categoryFor,
  validateTemplateText,
} from '../lib/notifications.js'

export const adminNotificationsRouter = Router()
adminNotificationsRouter.use(requireAuth, requireAdmin)

const templateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  category: z.enum(Object.keys(NOTIFICATION_CATEGORIES)),
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(2).max(2000),
  channel: z.enum(['in_app', 'email', 'sms']).default('in_app'),
  language: z.enum(['en', 'fil']).default('en'),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
})

function checkText(title, body) {
  for (const [label, value] of [['Title', title], ['Message body', body]]) {
    const result = validateTemplateText(value, label)
    if (!result.ok) throw unprocessable(result.message)
  }
}

adminNotificationsRouter.get(
  '/notification-templates',
  requirePermission('announcements.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(`SELECT * FROM notification_templates ORDER BY name`),
      categories: Object.entries(NOTIFICATION_CATEGORIES).map(([key, label]) => ({ key, label })),
      variables: TEMPLATE_VARIABLES,
      channels: {
        in_app: { available: true },
        email: { available: Boolean(env.smtpUrl) },
        sms: { available: false },
      },
      note: 'Templates never contain service details or government announcements of their own; variables are filled from real records only.',
    })
  }),
)

adminNotificationsRouter.post(
  '/notification-templates',
  requirePermission('announcements.create'),
  validate(templateSchema),
  asyncHandler(async (req, res) => {
    checkText(req.body.title, req.body.body)
    if (req.body.channel === 'email' && !env.smtpUrl) {
      throw unprocessable('Email templates are unavailable because no mail provider is configured.')
    }
    if (req.body.channel === 'sms') throw unprocessable('SMS templates are unavailable because no authorised SMS provider is configured.')
    const existing = get(`SELECT id FROM notification_templates WHERE name = ?`, [req.body.name])
    if (existing) throw unprocessable('A template with that name already exists.')
    const result = run(
      `INSERT INTO notification_templates (name, category, title, body, variables, channel, language, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanText(req.body.name, 80),
        req.body.category,
        cleanText(req.body.title, 160),
        cleanText(req.body.body, 2000),
        JSON.stringify([...new Set([...req.body.title.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi), ...req.body.body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase()))]),
        req.body.channel,
        req.body.language,
        req.body.status,
        req.user.id,
        req.user.id,
      ],
    )
    logAudit(req, { action: 'notifications.template_created', module: 'notifications', entityType: 'notification_template', entityId: Number(result.lastInsertRowid) })
    res.status(201).json({ message: 'Template created.', id: Number(result.lastInsertRowid) })
  }),
)

adminNotificationsRouter.patch(
  '/notification-templates/:id',
  requirePermission('announcements.update'),
  validate(templateSchema.partial()),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM notification_templates WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Template not found.')
    const title = req.body.title ?? row.title
    const body = req.body.body ?? row.body
    checkText(title, body)
    if ((req.body.channel || row.channel) === 'sms') throw unprocessable('SMS templates are unavailable because no authorised SMS provider is configured.')
    run(
      `UPDATE notification_templates SET name = ?, category = ?, title = ?, body = ?, channel = ?, language = ?, status = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
      [
        req.body.name ? cleanText(req.body.name, 80) : row.name,
        req.body.category || row.category,
        cleanText(title, 160),
        cleanText(body, 2000),
        req.body.channel || row.channel,
        req.body.language || row.language,
        req.body.status || row.status,
        req.user.id,
        nowIso(),
        row.id,
      ],
    )
    res.json({ message: 'Template updated.' })
  }),
)

adminNotificationsRouter.delete(
  '/notification-templates/:id',
  requirePermission('announcements.archive'),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT id FROM notification_templates WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Template not found.')
    run(`UPDATE notification_templates SET status = 'archived', updated_at = ? WHERE id = ?`, [nowIso(), row.id])
    res.json({ message: 'Template archived. Existing notifications are unchanged.' })
  }),
)

adminNotificationsRouter.get(
  '/notification-deliveries',
  requirePermission('announcements.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(
        `SELECT d.id, d.channel, d.state, d.provider_confirmed, d.detail, d.created_at, n.title, n.notification_type
         FROM notification_deliveries d LEFT JOIN notifications n ON n.id = d.notification_id
         ORDER BY d.id DESC LIMIT 100`,
      ),
      channels: {
        in_app: { active: true },
        email: { configured: Boolean(env.smtpUrl) },
        sms: { configured: false },
        push: { configured: false },
      },
      note: 'Only rows with provider_confirmed = 1 may be described as delivered. In-app read activity is not email or SMS delivery.',
    })
  }),
)

adminNotificationsRouter.get(
  '/notification-analytics',
  requirePermission('announcements.view'),
  asyncHandler(async (_req, res) => {
    const totals = get(
      `SELECT COUNT(*) AS created,
              SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END) AS read,
              SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread,
              SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived
       FROM notifications WHERE deleted_at IS NULL`,
    )
    res.json({
      totals: {
        created: Number(totals.created || 0),
        read: Number(totals.read || 0),
        unread: Number(totals.unread || 0),
        archived: Number(totals.archived || 0),
      },
      byCategory: all(
        `SELECT COALESCE(category, 'account') AS category, COUNT(*) AS total
         FROM notifications WHERE deleted_at IS NULL GROUP BY COALESCE(category, 'account') ORDER BY total DESC`,
      ).map((row) => ({ ...row, label: NOTIFICATION_CATEGORIES[row.category] || NOTIFICATION_CATEGORIES.platform })),
      byMunicipality: all(
        `SELECT m.name AS municipality_name, COUNT(*) AS total
         FROM notifications n JOIN user_profiles p ON p.user_id = n.user_id
         JOIN municipalities m ON m.id = p.municipality_id
         WHERE n.deleted_at IS NULL GROUP BY m.name ORDER BY total DESC`,
      ),
      deliveries: all(`SELECT channel, state, provider_confirmed, COUNT(*) AS total FROM notification_deliveries GROUP BY channel, state, provider_confirmed`),
      note: 'Counts come from stored notification rows. In-app reads are tracked; email and SMS delivery is only counted when a provider confirmed it.',
    })
  }),
)

const campaignSchema = z.object({
  title: z.string().trim().min(3).max(160),
  category: z.enum(Object.keys(NOTIFICATION_CATEGORIES)),
  templateId: z.coerce.number().int().positive().optional().nullable(),
  municipalityId: z.coerce.number().int().positive().optional().nullable(),
})

adminNotificationsRouter.get(
  '/notification-campaigns',
  requirePermission('announcements.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(
        `SELECT c.*, m.name AS municipality_name, t.name AS template_name
         FROM notification_campaigns c
         LEFT JOIN municipalities m ON m.id = c.municipality_id
         LEFT JOIN notification_templates t ON t.id = c.template_id
         ORDER BY c.id DESC LIMIT 50`,
      ),
      dispatchAvailable: false,
      note: 'Bulk notification dispatch is not enabled on this deployment. Campaigns can be drafted and approved for review only; nothing is sent.',
    })
  }),
)

adminNotificationsRouter.post(
  '/notification-campaigns',
  requirePermission('announcements.create'),
  validate(campaignSchema),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    if (req.body.municipalityId && !context.hasGlobalScope && !context.municipalityIds.includes(Number(req.body.municipalityId))) {
      throw forbidden('You can only draft campaigns for your assigned municipality.')
    }
    if (req.body.category === 'emergency') {
      throw unprocessable('Emergency notifications require a verified emergency source and cannot be drafted from this screen.')
    }
    const result = run(
      `INSERT INTO notification_campaigns (title, category, template_id, municipality_id, status, created_by) VALUES (?, ?, ?, ?, 'draft', ?)`,
      [cleanText(req.body.title, 160), req.body.category, req.body.templateId || null, req.body.municipalityId || null, req.user.id],
    )
    logAudit(req, { action: 'notifications.campaign_drafted', module: 'notifications', entityType: 'notification_campaign', entityId: Number(result.lastInsertRowid) })
    res.status(201).json({ message: 'Campaign drafted. It cannot be sent from this deployment.', id: Number(result.lastInsertRowid) })
  }),
)

adminNotificationsRouter.post(
  '/notification-campaigns/:id/approve',
  requirePermission('announcements.approve'),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM notification_campaigns WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Campaign not found.')
    if (row.status !== 'draft') throw unprocessable('Only a draft campaign can be approved.')
    if (row.created_by === req.user.id) throw forbidden('The creator cannot approve their own campaign.')
    run(`UPDATE notification_campaigns SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?`, [req.user.id, nowIso(), row.id])
    logAudit(req, { action: 'notifications.campaign_approved', module: 'notifications', entityType: 'notification_campaign', entityId: row.id })
    res.json({ message: 'Campaign approved for a future dispatch. No notification was sent.' })
  }),
)

adminNotificationsRouter.post(
  '/notification-campaigns/:id/send',
  requirePermission('announcements.publish'),
  asyncHandler(async (_req, _res) => {
    throw unprocessable('Bulk dispatch is not enabled on this deployment. No notifications were sent.')
  }),
)

/** Category labels for the admin tables. */
adminNotificationsRouter.get(
  '/notification-categories',
  asyncHandler(async (_req, res) => {
    res.json({
      categories: Object.entries(NOTIFICATION_CATEGORIES).map(([key, label]) => ({ key, label })),
      legacyMapping: all(`SELECT DISTINCT notification_type FROM notifications`).map((row) => ({
        type: row.notification_type,
        category: categoryFor(row.notification_type),
      })),
    })
  }),
)
