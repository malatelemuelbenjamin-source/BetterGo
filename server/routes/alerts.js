/**
 * Prompt 113 — transparency subscriptions and update notifications.
 *
 * Reuses the citizen notification centre. Only published events produce
 * notifications; category and municipality filters are enforced server-side;
 * one citizen can never read another's subscriptions or delivery history.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { requireAdmin, requirePermission } from '../rbac.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { TRANSPARENCY_TOPICS } from '../lib/transparency-alerts.js'
import { env } from '../env.js'

const shapeSubscription = (row) => ({
  id: row.id,
  topic: row.topic,
  topicLabel: TRANSPARENCY_TOPICS[row.topic] || row.topic,
  municipalityId: row.municipality_id,
  municipalityName: row.municipality_name || null,
  municipalitySlug: row.municipality_slug || null,
  createdAt: row.created_at,
})

function shapePreferences(row) {
  return {
    inApp: row ? Boolean(row.in_app) : true,
    emailOptIn: row ? Boolean(row.email_opt_in) : false,
    frequency: row?.frequency || 'immediate',
    quietStart: row?.quiet_start || null,
    quietEnd: row?.quiet_end || null,
    pausedUntil: row?.paused_until || null,
    timezone: row?.timezone || 'Asia/Manila',
    emailAvailable: Boolean(env.smtpUrl),
    smsAvailable: false,
    pushAvailable: false,
    note: env.smtpUrl ? 'Email is configured at platform level but is only queued when you opt in. Delivery is never assumed.' : 'No email provider is configured on this deployment, so only in-app alerts are delivered.',
  }
}

function ensurePreferences(userId) {
  run(`INSERT OR IGNORE INTO transparency_alert_preferences (user_id) VALUES (?)`, [userId])
  return get(`SELECT * FROM transparency_alert_preferences WHERE user_id = ?`, [userId])
}

export const alertsPublicRouter = Router()

alertsPublicRouter.get(
  '/transparency/alerts/catalog',
  asyncHandler(async (_req, res) => {
    res.json({
      topics: Object.entries(TRANSPARENCY_TOPICS).map(([key, label]) => ({ key, label })),
      entities: [
        { id: null, slug: 'provincial', name: 'Provincial Government of Marinduque' },
        ...all(`SELECT id, name, slug FROM municipalities WHERE is_active = 1 ORDER BY sort_order, name`),
      ],
      frequency: ['immediate', 'daily', 'weekly'],
      channels: { inApp: true, email: Boolean(env.smtpUrl), sms: false, push: false },
      consent: 'Alerts are opt-in and can be paused or removed at any time. Only verified, published records produce a notification. Messages never describe a person or institution as corrupt, fraudulent or guilty.',
      note: 'BetterGo transparency alerts are informational platform notices, not official government announcements.',
    })
  }),
)

export const alertsAccountRouter = Router()
alertsAccountRouter.use('/transparency/alerts', requireAuth)

alertsAccountRouter.get(
  '/transparency/alerts',
  asyncHandler(async (req, res) => {
    const preferences = ensurePreferences(req.user.id)
    const subscriptions = all(
      `SELECT s.*, m.name AS municipality_name, m.slug AS municipality_slug FROM transparency_subscriptions s
       LEFT JOIN municipalities m ON m.id = s.municipality_id WHERE s.user_id = ? ORDER BY s.id`,
      [req.user.id],
    ).map(shapeSubscription)
    const deliveries = all(
      `SELECT d.id, d.channel, d.status, d.created_at, e.title, e.period_label, e.record_reference, e.event_type
       FROM transparency_alert_deliveries d JOIN transparency_alert_events e ON e.id = d.event_id
       WHERE d.user_id = ? ORDER BY d.id DESC LIMIT 10`,
      [req.user.id],
    )
    res.json({
      subscriptions,
      preferences: shapePreferences(preferences),
      recent: deliveries,
      topics: Object.entries(TRANSPARENCY_TOPICS).map(([key, label]) => ({ key, label })),
      entities: [
        { id: null, slug: 'provincial', name: 'Provincial Government of Marinduque' },
        ...all(`SELECT id, name, slug FROM municipalities WHERE is_active = 1 ORDER BY sort_order, name`),
      ],
      note: 'Your preferences and history are visible only to you. In-app alerts are stored in your existing notification centre.',
    })
  }),
)

alertsAccountRouter.post(
  '/transparency/alerts/subscriptions',
  rateLimit({ windowMs: 60 * 1000, max: 20 }),
  validate(z.object({
    topic: z.enum(Object.keys(TRANSPARENCY_TOPICS)),
    municipalityId: z.coerce.number().int().positive().nullable().optional(),
  })),
  asyncHandler(async (req, res) => {
    if (req.body.municipalityId) {
      const municipality = get(`SELECT id FROM municipalities WHERE id = ? AND is_active = 1`, [req.body.municipalityId])
      if (!municipality) throw notFound('Municipality not found.')
    }
    const count = Number(get(`SELECT COUNT(*) AS n FROM transparency_subscriptions WHERE user_id = ?`, [req.user.id]).n)
    if (count >= 40) throw unprocessable('You can keep up to 40 transparency subscriptions. Remove one before adding another.')
    const existing = get(
      `SELECT id FROM transparency_subscriptions WHERE user_id = ? AND topic = ? AND COALESCE(municipality_id, -1) = ?`,
      [req.user.id, req.body.topic, req.body.municipalityId ?? -1],
    )
    if (existing) {
      return res.json({ message: 'You already follow this topic for this entity.', subscription: shapeSubscription(get(`SELECT * FROM transparency_subscriptions WHERE id = ?`, [existing.id])) })
    }
    const id = Number(run(
      `INSERT INTO transparency_subscriptions (user_id, topic, municipality_id) VALUES (?, ?, ?)`,
      [req.user.id, req.body.topic, req.body.municipalityId ?? null],
    ).lastInsertRowid)
    logAudit(req, { action: 'transparency.alert_subscribed', module: 'transparency', entityType: 'transparency_subscription', entityId: id })
    res.status(201).json({ message: 'Subscription saved. Only published updates will trigger an alert.', subscription: shapeSubscription(get(`SELECT * FROM transparency_subscriptions WHERE id = ?`, [id])) })
  }),
)

alertsAccountRouter.delete(
  '/transparency/alerts/subscriptions/:id',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM transparency_subscriptions WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Subscription not found.')
    run(`DELETE FROM transparency_subscriptions WHERE id = ?`, [row.id])
    res.json({ message: 'Subscription removed.' })
  }),
)

alertsAccountRouter.get(
  '/transparency/alerts/subscriptions',
  asyncHandler(async (req, res) => {
    res.json({
      results: all(`SELECT s.*, m.name AS municipality_name, m.slug AS municipality_slug FROM transparency_subscriptions s LEFT JOIN municipalities m ON m.id = s.municipality_id WHERE s.user_id = ? ORDER BY s.id`, [req.user.id]).map(shapeSubscription),
      topics: Object.entries(TRANSPARENCY_TOPICS).map(([key, label]) => ({ key, label })),
    })
  }),
)

alertsAccountRouter.get(
  '/transparency/alerts/preferences',
  asyncHandler(async (req, res) => {
    res.json({ preferences: shapePreferences(ensurePreferences(req.user.id)) })
  }),
)

alertsAccountRouter.put(
  '/transparency/alerts/preferences',
  validate(z.object({
    inApp: z.boolean().optional(),
    emailOptIn: z.boolean().optional(),
    frequency: z.enum(['immediate', 'daily', 'weekly']).optional(),
    quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal('')),
    quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal('')),
    pauseDays: z.coerce.number().int().min(0).max(365).optional(),
    timezone: z.string().trim().max(60).optional(),
  })),
  asyncHandler(async (req, res) => {
    ensurePreferences(req.user.id)
    const current = get(`SELECT * FROM transparency_alert_preferences WHERE user_id = ?`, [req.user.id])
    const pausedUntil = req.body.pauseDays ? new Date(Date.now() + req.body.pauseDays * 86400000).toISOString() : req.body.pauseDays === 0 ? null : current.paused_until
    run(
      `UPDATE transparency_alert_preferences SET in_app = ?, email_opt_in = ?, frequency = ?, quiet_start = ?, quiet_end = ?, paused_until = ?, timezone = ?, updated_at = ? WHERE user_id = ?`,
      [
        req.body.inApp === undefined ? current.in_app : req.body.inApp ? 1 : 0,
        req.body.emailOptIn === undefined ? current.email_opt_in : (req.body.emailOptIn && env.smtpUrl ? 1 : req.body.emailOptIn ? 1 : 0),
        req.body.frequency || current.frequency,
        req.body.quietStart === undefined ? current.quiet_start : req.body.quietStart || null,
        req.body.quietEnd === undefined ? current.quiet_end : req.body.quietEnd || null,
        pausedUntil || null,
        cleanText(req.body.timezone, 60) || current.timezone || 'Asia/Manila',
        nowIso(),
        req.user.id,
      ],
    )
    logAudit(req, { action: 'transparency.alert_preferences_updated', module: 'transparency', entityType: 'transparency_alert_preferences', entityId: req.user.id })
    res.json({ message: 'Alert preferences saved. Security notices are unaffected.', preferences: shapePreferences(get(`SELECT * FROM transparency_alert_preferences WHERE user_id = ?`, [req.user.id])) })
  }),
)

alertsAccountRouter.get(
  '/transparency/alerts/history',
  asyncHandler(async (req, res) => {
    const rows = all(
      `SELECT d.id, d.channel, d.status, d.attempts, d.error, d.delivered_at, d.created_at,
              e.title, e.summary, e.period_label, e.record_reference, e.event_type, e.published_at, e.category
       FROM transparency_alert_deliveries d JOIN transparency_alert_events e ON e.id = d.event_id
       WHERE d.user_id = ? ORDER BY d.id DESC LIMIT 100`,
      [req.user.id],
    )
    res.json({
      results: rows.map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        category: row.category,
        categoryLabel: TRANSPARENCY_TOPICS[row.category] || row.category,
        periodLabel: row.period_label,
        recordReference: row.record_reference,
        eventType: row.event_type,
        channel: row.channel,
        status: row.status,
        deliveredAt: row.delivered_at,
        createdAt: row.created_at,
        error: row.error,
      })),
      note: 'Only your own delivery records are shown. An email is never marked delivered unless a provider confirmed it.',
    })
  }),
)

alertsAccountRouter.get(
  '/transparency/alerts/digest',
  asyncHandler(async (req, res) => {
    const frequency = req.query.frequency === 'weekly' ? 'weekly' : 'daily'
    const since = new Date(Date.now() - (frequency === 'weekly' ? 7 : 1) * 86400000).toISOString()
    const rows = all(
      `SELECT e.* FROM transparency_alert_deliveries d JOIN transparency_alert_events e ON e.id = d.event_id
       WHERE d.user_id = ? AND d.status = 'delivered' AND d.created_at >= ? ORDER BY e.published_at DESC`,
      [req.user.id, since],
    )
    const groups = new Map()
    for (const row of rows) {
      const key = `${row.municipality_id || 'provincial'}|${row.category}`
      if (!groups.has(key)) groups.set(key, { municipalityId: row.municipality_id, category: row.category, categoryLabel: TRANSPARENCY_TOPICS[row.category] || row.category, items: [] })
      groups.get(key).items.push({ title: row.title, periodLabel: row.period_label, recordReference: row.record_reference, publishedAt: row.published_at })
    }
    res.json({
      frequency, since,
      groups: [...groups.values()],
      count: rows.length,
      empty: rows.length === 0,
      note: rows.length === 0 ? 'No new published transparency updates in this period. No empty digest is sent.' : 'Digest preview only; nothing is emailed unless an approved provider is configured.',
    })
  }),
)

/* --------------------------------- Admin -------------------------------- */

export const alertsAdminRouter = Router()
alertsAdminRouter.use(requireAuth, requireAdmin)

alertsAdminRouter.get(
  '/transparency/alerts',
  requirePermission('transparency.view'),
  asyncHandler(async (_req, res) => {
    const events = all(
      `SELECT e.*, m.name AS municipality_name,
         (SELECT COUNT(*) FROM transparency_alert_deliveries d WHERE d.event_id = e.id AND d.status = 'delivered') AS delivered,
         (SELECT COUNT(*) FROM transparency_alert_deliveries d WHERE d.event_id = e.id AND d.status IN ('failed','unavailable')) AS failed
       FROM transparency_alert_events e LEFT JOIN municipalities m ON m.id = e.municipality_id ORDER BY e.id DESC LIMIT 100`,
    )
    res.json({
      events: events.map((row) => ({
        id: row.id, eventKey: row.event_key, eventType: row.event_type, title: row.title, summary: row.summary,
        recordReference: row.record_reference, municipality: row.municipality_name || 'Provincial', category: row.category,
        periodLabel: row.period_label, publishedAt: row.published_at, delivered: row.delivered, failed: row.failed,
      })),
      categories: Object.entries(TRANSPARENCY_TOPICS).map(([key, label]) => ({ key, label })),
      failures: all(`SELECT d.id, d.channel, d.status, d.attempts, d.error, d.created_at, e.title FROM transparency_alert_deliveries d JOIN transparency_alert_events e ON e.id = d.event_id WHERE d.status IN ('failed','unavailable') ORDER BY d.id DESC LIMIT 50`),
      settings: all(`SELECT key, value, updated_at FROM transparency_alert_settings ORDER BY key`),
      channels: { inApp: true, email: Boolean(env.smtpUrl), sms: false, push: false },
      subscriberCounts: { subscriptions: Number(get(`SELECT COUNT(*) AS n FROM transparency_subscriptions`).n), users: Number(get(`SELECT COUNT(DISTINCT user_id) AS n FROM transparency_subscriptions`).n) },
      note: 'Subscriber identities are not listed. Retrying an in-app delivery is safe; email and SMS remain unavailable until an authorised provider is configured.',
    })
  }),
)

alertsAdminRouter.post(
  '/transparency/alerts/events/:id/retry',
  requirePermission('transparency.data.approve'),
  asyncHandler(async (req, res) => {
    const event = get(`SELECT * FROM transparency_alert_events WHERE id = ?`, [Number(req.params.id)])
    if (!event) throw notFound('Alert event not found.')
    const failed = all(`SELECT * FROM transparency_alert_deliveries WHERE event_id = ? AND status IN ('failed','unavailable') AND attempts < 3`, [event.id])
    for (const delivery of failed) {
      if (delivery.channel === 'in_app') {
        run(`UPDATE transparency_alert_deliveries SET status = 'delivered', attempts = attempts + 1, delivered_at = ?, error = NULL WHERE id = ?`, [nowIso(), delivery.id])
      } else {
        run(`UPDATE transparency_alert_deliveries SET attempts = attempts + 1, status = 'unavailable', error = 'No authorised provider is configured on this deployment.' WHERE id = ?`, [delivery.id])
      }
    }
    logAudit(req, { action: 'transparency.alert_retry', module: 'transparency', entityType: 'transparency_alert_event', entityId: event.id })
    res.json({ message: `${failed.length} delivery attempt(s) retried.`, retried: failed.length })
  }),
)

alertsAdminRouter.post(
  '/transparency/alerts/categories/:category/pause',
  requirePermission('transparency.data.approve'),
  validate(z.object({ pauseHours: z.coerce.number().int().min(1).max(720), reason: z.string().trim().min(5).max(300) })),
  asyncHandler(async (req, res) => {
    const category = String(req.params.category)
    if (!TRANSPARENCY_TOPICS[category]) throw notFound('Notification category not found.')
    const until = new Date(Date.now() + req.body.pauseHours * 3600000).toISOString()
    run(`INSERT INTO transparency_alert_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, [`pause:${category}`, until, nowIso()])
    logAudit(req, { action: 'transparency.alert_category_paused', module: 'transparency', entityType: 'transparency_alert_setting', detail: req.body.reason })
    res.json({ message: `${TRANSPARENCY_TOPICS[category]} alerts paused until ${until}.`, category, pausedUntil: until })
  }),
)

alertsAdminRouter.post(
  '/transparency/alerts/digests/run',
  requirePermission('transparency.data.approve'),
  asyncHandler(async (req, res) => {
    const users = all(`SELECT * FROM transparency_alert_preferences WHERE frequency IN ('daily','weekly') AND in_app = 1`)
    let digests = 0
    for (const preferences of users) {
      if (preferences.paused_until && preferences.paused_until > nowIso()) continue
      const windowHours = preferences.frequency === 'weekly' ? 168 : 24
      const since = new Date(Date.now() - windowHours * 3600000).toISOString()
      const last = get(`SELECT created_at FROM transparency_alert_digest_log WHERE user_id = ? AND frequency = ? ORDER BY id DESC LIMIT 1`, [preferences.user_id, preferences.frequency])
      if (last && last.created_at >= since) continue
      const events = all(
        `SELECT DISTINCT e.* FROM transparency_alert_deliveries d JOIN transparency_alert_events e ON e.id = d.event_id
         WHERE d.user_id = ? AND d.status = 'delivered' AND e.published_at >= ? ORDER BY e.published_at DESC`,
        [preferences.user_id, since],
      )
      if (!events.length) continue
      run(
        `INSERT INTO notifications (user_id, title, message, notification_type, category, related_entity_type, related_entity_id)
         VALUES (?, ?, ?, 'transparency', 'transparency', 'transparency_digest', ?)`,
        [preferences.user_id, `${preferences.frequency === 'weekly' ? 'Weekly' : 'Daily'} transparency digest`, `${events.length} published transparency update(s) in this digest. ${events.slice(0, 5).map((event) => event.title).join('; ')}${events.length > 5 ? '; and more' : ''}.`, events[0].id],
      )
      run(`INSERT INTO transparency_alert_digest_log (user_id, frequency, event_ids) VALUES (?, ?, ?)`, [preferences.user_id, preferences.frequency, JSON.stringify(events.map((event) => event.id))])
      digests += 1
    }
    logAudit(req, { action: 'transparency.alert_digests_run', module: 'transparency', entityType: 'transparency_alert_digest' })
    res.json({ message: `${digests} digest(s) generated from new published updates. Empty digests were skipped.`, digests })
  }),
)
