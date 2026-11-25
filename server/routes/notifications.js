/**
 * Citizen notifications centre (Prompt 68).
 *
 * Extends the existing notifications table instead of creating a parallel
 * system. Every query is scoped to the authenticated account. Email and SMS are
 * reported as available only when a provider is configured; nothing claims a
 * delivery was made unless a provider confirmed it.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { env } from '../env.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import {
  ALWAYS_ON_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  PREFERENCE_COLUMNS,
  PROTECTED_CATEGORIES,
  categoryFor,
} from '../lib/notifications.js'

export const notificationsRouter = Router()
notificationsRouter.use(requireAuth)

const bit = (value) => (value === true || value === 'true' || value === 'on' || value === 1 || value === '1' ? 1 : 0)

function shape(row) {
  if (!row) return row
  const category = NOTIFICATION_CATEGORIES[row.category] ? row.category : categoryFor(row.notification_type)
  return {
    ...row,
    category,
    categoryLabel: NOTIFICATION_CATEGORIES[category],
    important: Boolean(row.important_at),
    archived: Boolean(row.archived_at),
    read: Boolean(row.read_at),
  }
}

function baseQuery(userId, { includeArchived = false, includeDeleted = false } = {}) {
  let sql = `SELECT * FROM notifications WHERE user_id = ?`
  if (!includeDeleted) sql += ` AND deleted_at IS NULL`
  if (!includeArchived) sql += ` AND archived_at IS NULL`
  return { sql, params: [userId] }
}

notificationsRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const status = ['all', 'unread', 'read', 'important', 'archived'].includes(String(req.query.status)) ? String(req.query.status) : 'all'
    const category = NOTIFICATION_CATEGORIES[String(req.query.category)] ? String(req.query.category) : null
    const term = cleanText(req.query.q, 120)?.toLowerCase() || ''
    const from = cleanText(req.query.from, 30)
    const to = cleanText(req.query.to, 30)
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))

    // Archived and deleted rows are excluded unless the citizen asks for them.
    const includeArchived = status === 'archived' || Boolean(req.query.includeArchived)
    const { sql, params } = baseQuery(req.user.id, { includeArchived })
    let rows = all(`${sql} ORDER BY id DESC LIMIT 500`, params).map(shape)

    if (status === 'archived') rows = rows.filter((row) => row.archived)
    if (status === 'unread') rows = rows.filter((row) => !row.read_at)
    if (status === 'read') rows = rows.filter((row) => row.read_at)
    if (status === 'important') rows = rows.filter((row) => row.important)
    if (category) rows = rows.filter((row) => row.category === category)
    if (from) rows = rows.filter((row) => String(row.created_at).slice(0, 10) >= from)
    if (to) rows = rows.filter((row) => String(row.created_at).slice(0, 10) <= to)
    if (term) {
      rows = rows.filter((row) => [row.title, row.message, row.categoryLabel].filter(Boolean).join(' ').toLowerCase().includes(term))
    }

    const unread = Number(
      get(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL AND deleted_at IS NULL AND archived_at IS NULL`, [req.user.id]).n,
    )
    const counters = Object.fromEntries(Object.keys(NOTIFICATION_CATEGORIES).map((key) => [key, 0]))
    for (const row of all(`SELECT notification_type, category FROM notifications WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL`, [req.user.id])) {
      const key = NOTIFICATION_CATEGORIES[row.category] ? row.category : categoryFor(row.notification_type)
      counters[key] = (counters[key] || 0) + 1
    }
    const counts = counters
    res.json({
      results: rows.slice((page - 1) * limit, page * limit),
      total: rows.length,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(rows.length / limit)),
      unread,
      counts,
      categories: Object.entries(NOTIFICATION_CATEGORIES).map(([key, label]) => ({ key, label })),
      status,
      pollSeconds: 30,
      channels: {
        inApp: true,
        email: Boolean(env.smtpUrl),
        sms: false,
        push: false,
      },
      note: 'In-app notifications are active. Email is only sent when a mail provider is configured; no SMS or push provider is connected on this deployment.',
    })
  }),
)

notificationsRouter.get(
  '/notifications/poll',
  asyncHandler(async (req, res) => {
    const since = Math.max(0, Number(req.query.since) || 0)
    const rows = all(
      `SELECT * FROM notifications WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL AND id > ? ORDER BY id ASC LIMIT 50`,
      [req.user.id, since],
    ).map(shape)
    const latest = rows.length ? rows[rows.length - 1].id : since
    const unread = Number(
      get(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL AND deleted_at IS NULL AND archived_at IS NULL`, [req.user.id]).n,
    )
    res.setHeader('Cache-Control', 'no-store')
    res.json({ results: rows, latestId: latest, unread, pollSeconds: 30 })
  }),
)

notificationsRouter.patch(
  '/notifications/:id',
  validate(
    z.object({
      read: z.boolean().optional(),
      important: z.boolean().optional(),
      archived: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM notifications WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Notification not found.')
    if (req.body.read !== undefined) run(`UPDATE notifications SET read_at = ? WHERE id = ?`, [req.body.read ? nowIso() : null, row.id])
    if (req.body.important !== undefined) {
      const category = NOTIFICATION_CATEGORIES[row.category] ? row.category : categoryFor(row.notification_type)
      if (req.body.important) run(`UPDATE notifications SET important_at = ? WHERE id = ?`, [nowIso(), row.id])
      else run(`UPDATE notifications SET important_at = NULL WHERE id = ?`, [row.id])
      // Security reminders stay in the inbox; importance is separate.
      if (category) { /* no-op, kept for clarity */ }
    }
    if (req.body.archived !== undefined) {
      if (req.body.archived && PROTECTED_CATEGORIES.includes(shape(row).category)) {
        throw unprocessable('Security and privacy notifications cannot be archived. They stay in your inbox for account protection.')
      }
      run(`UPDATE notifications SET archived_at = ? WHERE id = ?`, [req.body.archived ? nowIso() : null, row.id])
    }
    res.json({ message: 'Notification updated.', notification: shape(get(`SELECT * FROM notifications WHERE id = ?`, [row.id])) })
  }),
)

notificationsRouter.delete(
  '/notifications/:id',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM notifications WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Notification not found.')
    const category = shape(row).category
    if (PROTECTED_CATEGORIES.includes(category)) {
      throw unprocessable('Security, emergency and privacy notifications are kept for your account protection and cannot be deleted.')
    }
    run(`UPDATE notifications SET deleted_at = ? WHERE id = ?`, [nowIso(), row.id])
    res.json({ message: 'Notification removed from your inbox. The related application, document or service record was not changed.' })
  }),
)

notificationsRouter.post(
  '/notifications/archive-all',
  asyncHandler(async (req, res) => {
    const result = run(
      `UPDATE notifications SET archived_at = ?
       WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL
         AND COALESCE(category, 'account') NOT IN ('security','privacy','emergency')`,
      [nowIso(), req.user.id],
    )
    res.json({ message: 'Read notifications archived. Security and privacy notices were kept.', archived: Number(result.changes || 0) })
  }),
)

/* --------------------------- Notification settings ----------------------- */

const settingsSchema = z.object({
  applications: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  security: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  documents: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  announcements: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  advisories: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  emergency: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  platform: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  privacy: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  inApp: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  email: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  sms: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  municipalityUpdates: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal('')),
  quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal('')),
})

const SETTINGS_COLUMNS = {
  applications: 'applications_enabled',
  security: 'security_enabled',
  documents: 'documents_enabled',
  announcements: 'announcements_enabled',
  advisories: 'advisories_enabled',
  emergency: 'emergency_enabled',
  platform: 'updates_enabled',
  privacy: 'privacy_enabled',
  inApp: 'in_app_enabled',
  email: 'email_enabled',
  sms: 'sms_enabled',
  municipalityUpdates: 'municipality_updates_enabled',
}

notificationsRouter.get(
  '/notification-settings',
  asyncHandler(async (req, res) => {
    run(`INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)`, [req.user.id])
    const prefs = get(`SELECT * FROM notification_preferences WHERE user_id = ?`, [req.user.id])
    const follows = all(
      `SELECT s.municipality_id, m.name, m.slug FROM notification_subscriptions s JOIN municipalities m ON m.id = s.municipality_id
       WHERE s.user_id = ? ORDER BY m.name`,
      [req.user.id],
    )
    const municipalities = all(`SELECT id, name, slug FROM municipalities ORDER BY name`)
    res.json({
      preferences: prefs,
      categories: Object.entries(NOTIFICATION_CATEGORIES).map(([key, label]) => ({
        key,
        label,
        setting: SETTINGS_COLUMNS[key] || 'in_app_enabled',
        value: Boolean(prefs?.[SETTINGS_COLUMNS[key] ?? 'in_app_enabled'] ?? 1),
        alwaysOn: ALWAYS_ON_CATEGORIES.includes(key),
      })),
      follows,
      municipalities,
      channels: {
        inApp: { available: true, label: 'In-app (active)' },
        email: { available: Boolean(env.smtpUrl), label: env.smtpUrl ? 'Email (provider configured)' : 'Email (no provider configured)' },
        sms: { available: false, label: 'SMS (no authorised provider configured)' },
        push: { available: false, label: 'Push (not implemented)' },
      },
      note: 'Security notices cannot be switched off. Quiet hours only delay non-emergency notifications; emergency information is never delayed.',
    })
  }),
)

notificationsRouter.put(
  '/notification-settings',
  validate(settingsSchema),
  asyncHandler(async (req, res) => {
    run(`INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)`, [req.user.id])
    const current = get(`SELECT * FROM notification_preferences WHERE user_id = ?`, [req.user.id])
    for (const [field, column] of Object.entries(SETTINGS_COLUMNS)) {
      if (req.body[field] === undefined) continue
      // Security cannot be muted from the interface or the API.
      if (column === 'security_enabled' && !bit(req.body[field])) continue
      run(`UPDATE notification_preferences SET ${column} = ? WHERE user_id = ?`, [bit(req.body[field]), req.user.id])
    }
    run(`UPDATE notification_preferences SET quiet_hours_start = ?, quiet_hours_end = ?, updated_at = ? WHERE user_id = ?`, [
      req.body.quietHoursStart || null,
      req.body.quietHoursEnd || null,
      nowIso(),
      req.user.id,
    ])
    logAudit(req, { action: 'notifications.preferences_updated', module: 'accounts', entityType: 'notification_preferences', entityId: req.user.id })
    res.json({
      message: 'Notification preferences saved. Security notices remain enabled.',
      preferences: get(`SELECT * FROM notification_preferences WHERE user_id = ?`, [req.user.id]),
      unchanged: current ? undefined : null,
    })
  }),
)

notificationsRouter.post(
  '/notification-settings/municipalities/:id',
  asyncHandler(async (req, res) => {
    const municipality = get(`SELECT id, name FROM municipalities WHERE id = ?`, [Number(req.params.id)])
    if (!municipality) throw notFound('Municipality not found.')
    const count = Number(get(`SELECT COUNT(*) AS n FROM notification_subscriptions WHERE user_id = ?`, [req.user.id]).n)
    if (count >= 6) throw unprocessable('You can follow up to six municipalities.')
    run(`INSERT OR IGNORE INTO notification_subscriptions (user_id, municipality_id) VALUES (?, ?)`, [req.user.id, municipality.id])
    res.status(201).json({ message: `You will receive published updates from ${municipality.name}.`, municipalityId: municipality.id })
  }),
)

notificationsRouter.delete(
  '/notification-settings/municipalities/:id',
  asyncHandler(async (req, res) => {
    run(`DELETE FROM notification_subscriptions WHERE user_id = ? AND municipality_id = ?`, [req.user.id, Number(req.params.id)])
    res.json({ message: 'Municipality unfollowed.', municipalityId: Number(req.params.id) })
  }),
)

notificationsRouter.get(
  '/notifications/delivery-status',
  rateLimit({ windowMs: 60 * 1000, max: 60 }),
  asyncHandler(async (req, res) => {
    res.json({
      channels: {
        in_app: { state: 'active', providerConfirmed: true },
        email: env.smtpUrl ? { state: 'configured', providerConfirmed: false } : { state: 'unavailable', providerConfirmed: false },
        sms: { state: 'unavailable', providerConfirmed: false },
        push: { state: 'unavailable', providerConfirmed: false },
      },
      recent: all(
        `SELECT channel, state, provider_confirmed, detail, created_at FROM notification_deliveries WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
        [req.user.id],
      ),
      note: 'Only provider-confirmed states are marked delivered. Nothing on this deployment confirms email or SMS delivery.',
    })
  }),
)
