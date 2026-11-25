import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { requireAuth, rateLimit } from '../auth.js'
import { env } from '../env.js'
import { asyncHandler, cleanText, forbidden, notFound, reference, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import {
  APPLICATION_STATUSES,
  CITIZEN_ACTIVITY_TYPES,
  ACTIVITY_ENTITY_TYPES,
  CITIZEN_INTERESTS,
  DASHBOARD_WIDGETS,
  DASHBOARD_ALWAYS_VISIBLE,
} from '../lib/citizen.js'
import { PRIVACY_REQUEST_STATUSES } from '../lib/records.js'

export const accountRouter = Router()
accountRouter.use(requireAuth)

function profileOf(userId) {
  return get(
    `SELECT p.*, m.name AS municipality_name, m.slug AS municipality_slug, b.name AS barangay_name,
            u.email, u.phone, u.account_status, u.email_verified_at, u.phone_verified_at, u.created_at AS account_created_at,
            np.email_enabled, np.sms_enabled, np.in_app_enabled, np.announcements_enabled,
            np.advisories_enabled, np.updates_enabled
     FROM user_profiles p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN municipalities m ON m.id = p.municipality_id
     LEFT JOIN barangays b ON b.id = p.barangay_id
     LEFT JOIN notification_preferences np ON np.user_id = u.id
     WHERE p.user_id = ?`,
    [userId],
  )
}

/** Profile completion is calculated from real stored fields only. */
export function completion(profile) {
  const checks = [
    { label: 'First name', done: Boolean(profile?.first_name) },
    { label: 'Last name', done: Boolean(profile?.last_name) },
    { label: 'Valid email address', done: Boolean(profile?.email) },
    { label: 'Email verified', done: Boolean(profile?.email_verified_at) },
    { label: 'Municipality selected', done: Boolean(profile?.municipality_id) },
    { label: 'Contact number added (optional)', done: Boolean(profile?.phone), optional: true },
  ]
  const required = checks.filter((c) => !c.optional)
  const percent = Math.round((required.filter((c) => c.done).length / required.length) * 100)
  return { percent, checks }
}

accountRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const profile = profileOf(req.user.id)
    const unread = Number(get(`SELECT COUNT(*) AS t FROM notifications WHERE user_id = ? AND read_at IS NULL`, [req.user.id]).t)
    const assignments = all(
      `SELECT r.name, r.slug, ura.scope_type, m.name AS municipality_name
       FROM user_role_assignments ura JOIN user_roles r ON r.id = ura.role_id
       LEFT JOIN municipalities m ON m.id = ura.municipality_id
       WHERE ura.user_id = ? AND ura.status='active' AND ura.revoked_at IS NULL`,
      [req.user.id],
    )
    // Phase 4 dashboard foundation. Every list is the caller's own data or a
    // real published record; nothing is estimated or invented.
    const municipalityId = profile?.municipality_id ? Number(profile.municipality_id) : null
    const localScope = municipalityId ? [municipalityId, municipalityId] : [0, 0]

    const quickServices = all(
      `SELECT s.id, s.title, s.slug, s.short_description, s.description, s.verification_status,
              s.availability_status, s.is_online, s.official_link, c.name AS category_name
       FROM government_services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE s.publication_status = 'published' AND s.archived_at IS NULL
         AND (s.service_scope IN ('province_wide','online_province_wide')
              OR s.municipality_id = ?
              OR EXISTS (SELECT 1 FROM service_coverage sc WHERE sc.service_id = s.id AND sc.municipality_id = ?))
       ORDER BY s.is_featured DESC, s.title ASC LIMIT 6`,
      localScope,
    )

    const savedServices = all(
      `SELECT s.id, s.title, s.slug, s.short_description, s.description, f.created_at
       FROM service_favorites f JOIN government_services s ON s.id = f.service_id
       WHERE f.user_id = ? AND s.publication_status = 'published' AND s.archived_at IS NULL
       ORDER BY f.created_at DESC LIMIT 3`,
      [req.user.id],
    )

    const recentActivity = all(
      `SELECT id, activity_type, entity_type, entity_id, entity_label, entity_slug, created_at
       FROM citizen_activities WHERE user_id = ? ORDER BY id DESC LIMIT 6`,
      [req.user.id],
    )

    const applications = all(
      `SELECT a.id, a.reference, a.status, a.submitted_at, a.created_at,
              m.name AS municipality_name, s.title AS service_title, s.slug AS service_slug
       FROM citizen_applications a
       LEFT JOIN municipalities m ON m.id = a.municipality_id
       LEFT JOIN government_services s ON s.id = a.service_id
       WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 3`,
      [req.user.id],
    )

    const municipalAnnouncements = municipalityId
      ? all(
          `SELECT a.id, a.title, a.slug, a.summary, a.published_at
           FROM announcements a
           WHERE a.publication_status = 'published' AND a.municipality_id = ?
           ORDER BY a.published_at DESC LIMIT 3`,
          [municipalityId],
        )
      : all(
          `SELECT a.id, a.title, a.slug, a.summary, a.published_at
           FROM announcements a
           WHERE a.publication_status = 'published' AND a.municipality_id IS NULL
           ORDER BY a.published_at DESC LIMIT 3`,
        )

    // Advisories reuse published announcements explicitly typed as advisories or
    // notices; nothing is relabelled to look like an emergency warning.
    const advisories = all(
      `SELECT a.id, a.title, a.slug, a.summary, a.published_at, a.announcement_type,
              m.name AS municipality_name
       FROM announcements a
       LEFT JOIN municipalities m ON m.id = a.municipality_id
       WHERE a.publication_status = 'published' AND a.archived_at IS NULL
         AND a.announcement_type IN ('advisory','public_notice','weather','health','transport','utility')
       ORDER BY a.published_at DESC LIMIT 3`,
    )

    const recommended = all(
      `SELECT s.id, s.title, s.slug, s.short_description, c.name AS category_name
       FROM government_services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE s.publication_status = 'published' AND s.archived_at IS NULL
         AND s.id NOT IN (
           SELECT entity_id FROM citizen_activities
           WHERE user_id = ? AND entity_type = 'service' AND entity_id IS NOT NULL
         )
       ORDER BY s.is_featured DESC, s.published_at DESC LIMIT 3`,
      [req.user.id],
    )

    const recentlyViewed = all(
      `SELECT entity_label, entity_slug, MAX(created_at) AS viewed_at
       FROM citizen_activities
       WHERE user_id = ? AND activity_type = 'service_viewed' AND entity_slug IS NOT NULL
       GROUP BY entity_slug ORDER BY viewed_at DESC LIMIT 4`,
      [req.user.id],
    )

    res.json({
      profile,
      completion: completion(profile),
      roles: assignments,
      unreadNotifications: unread,
      counts: {
        reports: Number(get(`SELECT COUNT(*) AS t FROM citizen_reports WHERE user_id = ?`, [req.user.id]).t),
        favorites: Number(get(`SELECT COUNT(*) AS t FROM service_favorites WHERE user_id = ?`, [req.user.id]).t),
        privacyRequests: Number(get(`SELECT COUNT(*) AS t FROM data_requests WHERE user_id = ?`, [req.user.id]).t),
        applications: Number(get(`SELECT COUNT(*) AS t FROM citizen_applications WHERE user_id = ?`, [req.user.id]).t),
        documents: Number(
          get(`SELECT COUNT(*) AS t FROM citizen_documents WHERE user_id = ? AND status = 'active'`, [req.user.id]).t,
        ),
      },
      activity: all(
        `SELECT action, module, created_at FROM audit_logs WHERE user_id = ? ORDER BY id DESC LIMIT 8`,
        [req.user.id],
      ),
      quickServices,
      savedServices,
      recentActivity,
      applications,
      applicationStatuses: APPLICATION_STATUSES,
      municipalAnnouncements,
      advisories,
      // No verified community programme records exist yet, so the widget is
      // empty rather than filled with invented programmes.
      programs: [],
      programsPublished: false,
      recommended,
      personalizationOptIn: Boolean(profile?.personalization_opt_in ?? 1),
      interests: interestsOf(req.user.id),
      recentlyViewed,
      notifications: all(
        `SELECT id, title, message, notification_type, read_at, created_at FROM notifications
         WHERE user_id = ? ORDER BY id DESC LIMIT 5`,
        [req.user.id],
      ),
      security: {
        emailVerifiedAt: profile?.email_verified_at || null,
        lastLoginAt: get(`SELECT last_login_at FROM users WHERE id = ?`, [req.user.id])?.last_login_at || null,
        accountStatus: profile?.account_status || null,
      },
      notice:
        'Application tracking is a BetterGo container only. No government application is submitted, approved or issued from this platform.',
    })
  }),
)

function interestsOf(userId) {
  return all(`SELECT interest_key FROM citizen_interests WHERE user_id = ? ORDER BY interest_key`, [userId]).map((row) => row.interest_key)
}

/** Field categories only — never old values of personal data. */
function recordProfileChange(userId, category, fields, outcome = 'success') {
  run(
    `INSERT INTO profile_change_events (user_id, field_category, changed_fields, outcome) VALUES (?, ?, ?, ?)`,
    [userId, category, fields.filter(Boolean).join(', ') || null, outcome],
  )
}

accountRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const profile = profileOf(req.user.id)
    res.json({ profile, completion: completion(profile), interests: interestsOf(req.user.id), availableInterests: CITIZEN_INTERESTS })
  }),
)

accountRouter.get(
  '/dashboard/preferences',
  asyncHandler(async (req, res) => {
    const rows = all(`SELECT widget_key, sort_order, visible FROM dashboard_preferences WHERE user_id = ? ORDER BY sort_order ASC`, [
      req.user.id,
    ])
    const known = new Map(rows.map((row) => [row.widget_key, row]))
    const order = [
      ...rows.map((row) => row.widget_key).filter((key) => DASHBOARD_WIDGETS.includes(key)),
      ...DASHBOARD_WIDGETS.filter((key) => !known.has(key)),
    ]
    res.json({
      order,
      hidden: rows.filter((row) => !row.visible).map((row) => row.widget_key),
      available: DASHBOARD_WIDGETS,
      alwaysVisible: DASHBOARD_ALWAYS_VISIBLE,
      customized: rows.length > 0,
    })
  }),
)

const dashboardPrefsSchema = z.object({
  order: z.array(z.enum(DASHBOARD_WIDGETS)).max(DASHBOARD_WIDGETS.length).optional(),
  hidden: z.array(z.enum(DASHBOARD_WIDGETS)).max(DASHBOARD_WIDGETS.length).optional(),
})

accountRouter.put(
  '/dashboard/preferences',
  validate(dashboardPrefsSchema),
  asyncHandler(async (req, res) => {
    const hidden = new Set((req.body.hidden || []).filter((key) => !DASHBOARD_ALWAYS_VISIBLE.includes(key)))
    const order = req.body.order ? [...new Set(req.body.order.filter((key) => DASHBOARD_WIDGETS.includes(key)))] : null
    const current = all(`SELECT widget_key, sort_order, visible FROM dashboard_preferences WHERE user_id = ?`, [req.user.id])
    const currentOrder = current.sort((a, b) => a.sort_order - b.sort_order).map((row) => row.widget_key)
    const finalOrder = order
      ? [...order, ...DASHBOARD_WIDGETS.filter((key) => !order.includes(key))]
      : currentOrder.length
        ? [...currentOrder, ...DASHBOARD_WIDGETS.filter((key) => !currentOrder.includes(key))]
        : [...DASHBOARD_WIDGETS]

    run(`DELETE FROM dashboard_preferences WHERE user_id = ?`, [req.user.id])
    finalOrder.forEach((key, index) => {
      run(`INSERT INTO dashboard_preferences (user_id, widget_key, sort_order, visible, updated_at) VALUES (?, ?, ?, ?, ?)`, [
        req.user.id,
        key,
        index,
        hidden.has(key) ? 0 : 1,
        nowIso(),
      ])
    })
    recordProfileChange(req.user.id, 'dashboard_layout', [
      order ? 'widget order' : null,
      req.body.hidden ? 'widget visibility' : null,
    ])
    res.json({ message: 'Dashboard layout saved.', order: finalOrder, hidden: [...hidden] })
  }),
)

accountRouter.post(
  '/dashboard/preferences/reset',
  asyncHandler(async (req, res) => {
    run(`DELETE FROM dashboard_preferences WHERE user_id = ?`, [req.user.id])
    recordProfileChange(req.user.id, 'dashboard_layout', ['restored default layout'])
    res.json({ message: 'Default dashboard layout restored.', order: [...DASHBOARD_WIDGETS], hidden: [] })
  }),
)

accountRouter.get(
  '/profile/history',
  asyncHandler(async (req, res) => {
    const rows = all(
      `SELECT id, field_category, changed_fields, outcome, created_at FROM profile_change_events
       WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 30`,
      [req.user.id],
    )
    res.json({ results: rows })
  }),
)

const profileSchema = z.object({
  displayName: z.string().trim().max(80).optional().or(z.literal('')),
  firstName: z.string().trim().min(1, 'First name is required.').max(80),
  middleName: z.string().trim().max(80).optional().or(z.literal('')),
  lastName: z.string().trim().min(1, 'Last name is required.').max(80),
  suffix: z.string().trim().max(20).optional().or(z.literal('')),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^(\+63|0)[0-9\s()-]{7,25}$/, 'Use a Philippine mobile or landline format, e.g. 09171234567.')
    .optional()
    .or(z.literal('')),
  municipalityId: z.coerce.number().int().positive().optional().or(z.literal('')),
  barangayId: z.coerce.number().int().positive().optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  language: z.enum(['en', 'fil']).optional(),
})

accountRouter.patch(
  '/profile',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 40 }),
  validate(profileSchema),
  asyncHandler(async (req, res) => {
    const data = req.body
    if (data.municipalityId) {
      const m = get(`SELECT id FROM municipalities WHERE id = ?`, [Number(data.municipalityId)])
      if (!m) throw unprocessable('Select a valid municipality.', [{ field: 'municipalityId', message: 'Unknown municipality.' }])
    }
    if (data.barangayId) {
      const b = get(`SELECT id, municipality_id FROM barangays WHERE id = ?`, [Number(data.barangayId)])
      if (!b || Number(b.municipality_id) !== Number(data.municipalityId)) {
        throw unprocessable('Select a barangay that belongs to your municipality.', [
          { field: 'barangayId', message: 'Barangay does not match the selected municipality.' },
        ])
      }
    }
    const before = profileOf(req.user.id)
    // An omitted display name keeps the stored value; only an explicit empty
    // string clears it.
    const displayName = data.displayName !== undefined ? data.displayName || null : before?.display_name ?? null
    run(
      `UPDATE user_profiles SET display_name=?, first_name=?, middle_name=?, last_name=?, suffix=?, municipality_id=?,
        barangay_id=?, address=?, preferred_language=COALESCE(?, preferred_language), updated_at=?
       WHERE user_id = ?`,
      [
        displayName,
        data.firstName,
        data.middleName || null,
        data.lastName,
        data.suffix || null,
        data.municipalityId ? Number(data.municipalityId) : null,
        data.barangayId ? Number(data.barangayId) : null,
        data.address || null,
        data.language || null,
        nowIso(),
        req.user.id,
      ],
    )
    let phoneChanged = false
    if (data.phone !== undefined) {
      const nextPhone = data.phone || null
      const currentPhone = get(`SELECT phone FROM users WHERE id = ?`, [req.user.id])?.phone || null
      phoneChanged = nextPhone !== currentPhone
      // A changed number is never treated as verified until the owner proves it.
      run(`UPDATE users SET phone = ?, phone_verified_at = ?, updated_at = ? WHERE id = ?`, [
        nextPhone,
        phoneChanged ? null : get(`SELECT phone_verified_at FROM users WHERE id = ?`, [req.user.id])?.phone_verified_at ?? null,
        nowIso(),
        req.user.id,
      ])
    }
    run(`UPDATE users SET name = ?, updated_at = ? WHERE id = ?`, [
      [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' '),
      nowIso(),
      req.user.id,
    ])
    recordProfileChange(req.user.id, 'personal_information', [
      'name', data.displayName !== undefined && data.displayName !== (before?.display_name || '') ? 'display name' : null,
      Number(data.municipalityId || 0) !== Number(before?.municipality_id || 0) ? 'municipality' : null,
      (data.address || '') !== (before?.address || '') ? 'address' : null,
      data.language && data.language !== before?.preferred_language ? 'language' : null,
      phoneChanged ? 'mobile number (verification reset)' : null,
    ])
    logAudit(req, {
      action: 'profile.updated',
      module: 'accounts',
      entityType: 'user_profile',
      entityId: req.user.id,
      oldValues: { municipality_id: before?.municipality_id, address: before?.address },
      newValues: { municipality_id: data.municipalityId || null, address: data.address || null },
    })
    const profile = profileOf(req.user.id)
    res.json({ message: 'Profile updated.', profile, completion: completion(profile) })
  }),
)

const prefsSchema = z.object({
  language: z.enum(['en', 'fil']).optional(),
  display: z.enum(['light', 'dark', 'system']).optional(),
  reducedMotion: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  emailEnabled: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  smsEnabled: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  inAppEnabled: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  announcementsEnabled: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  advisoriesEnabled: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  updatesEnabled: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
})

const bit = (v) => (v === true || v === 'true' || v === 'on' ? 1 : 0)

accountRouter.put(
  '/preferences',
  validate(prefsSchema),
  asyncHandler(async (req, res) => {
    const d = req.body
    run(
      `UPDATE user_profiles SET preferred_language = COALESCE(?, preferred_language),
        display_preference = COALESCE(?, display_preference),
        reduced_motion = COALESCE(?, reduced_motion), updated_at = ? WHERE user_id = ?`,
      [d.language || null, d.display || null, d.reducedMotion === undefined ? null : bit(d.reducedMotion), nowIso(), req.user.id],
    )
    run(`INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)`, [req.user.id])
    const current = get(`SELECT * FROM notification_preferences WHERE user_id = ?`, [req.user.id])
    run(
      `UPDATE notification_preferences SET email_enabled=?, sms_enabled=?, in_app_enabled=?,
        announcements_enabled=?, advisories_enabled=?, updates_enabled=?, updated_at=? WHERE user_id=?`,
      [
        d.emailEnabled === undefined ? current.email_enabled : bit(d.emailEnabled),
        d.smsEnabled === undefined ? current.sms_enabled : bit(d.smsEnabled),
        d.inAppEnabled === undefined ? current.in_app_enabled : bit(d.inAppEnabled),
        d.announcementsEnabled === undefined ? current.announcements_enabled : bit(d.announcementsEnabled),
        d.advisoriesEnabled === undefined ? current.advisories_enabled : bit(d.advisoriesEnabled),
        d.updatesEnabled === undefined ? current.updates_enabled : bit(d.updatesEnabled),
        nowIso(),
        req.user.id,
      ],
    )
    logAudit(req, { action: 'profile.preferences_updated', module: 'accounts', entityType: 'user', entityId: req.user.id })
    res.json({ message: 'Preferences saved.', preferences: get(`SELECT * FROM notification_preferences WHERE user_id = ?`, [req.user.id]) })
  }),
)

accountRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    res.json({
      results: all(`SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50`, [req.user.id]),
      unread: Number(get(`SELECT COUNT(*) AS t FROM notifications WHERE user_id = ? AND read_at IS NULL`, [req.user.id]).t),
    })
  }),
)

accountRouter.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    run(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`, [nowIso(), req.user.id])
    res.json({ message: 'Notifications marked as read.' })
  }),
)

accountRouter.post(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM notifications WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Notification not found.')
    run(`UPDATE notifications SET read_at = ? WHERE id = ?`, [nowIso(), row.id])
    res.json({ message: 'Notification marked as read.' })
  }),
)

accountRouter.get(
  '/favorites',
  asyncHandler(async (req, res) => {
    res.json({
      results: all(
        `SELECT s.id, s.title, s.slug, s.description, c.name AS category_name, f.created_at
         FROM service_favorites f JOIN government_services s ON s.id = f.service_id
         LEFT JOIN service_categories c ON c.id = s.category_id
         WHERE f.user_id = ? AND s.publication_status='published' ORDER BY f.created_at DESC`,
        [req.user.id],
      ),
    })
  }),
)

accountRouter.post(
  '/favorites/:serviceId',
  asyncHandler(async (req, res) => {
    const service = get(`SELECT id, title FROM government_services WHERE id = ? AND publication_status='published'`, [
      Number(req.params.serviceId),
    ])
    if (!service) throw notFound('Service not found.')
    run(`INSERT OR IGNORE INTO service_favorites (user_id, service_id) VALUES (?, ?)`, [req.user.id, service.id])
    res.status(201).json({ message: 'Service saved to your list.', saved: true })
  }),
)

accountRouter.delete(
  '/favorites/:serviceId',
  asyncHandler(async (req, res) => {
    run(`DELETE FROM service_favorites WHERE user_id = ? AND service_id = ?`, [req.user.id, Number(req.params.serviceId)])
    res.json({ message: 'Service removed from your list.', saved: false })
  }),
)

accountRouter.get(
  '/reports',
  asyncHandler(async (req, res) => {
    res.json({
      results: all(
        `SELECT r.id, r.reference, r.kind, r.subject, r.description, r.status, r.resolution, r.created_at, r.updated_at,
                m.name AS municipality_name
         FROM citizen_reports r LEFT JOIN municipalities m ON m.id = r.municipality_id
         WHERE r.user_id = ? ORDER BY r.id DESC`,
        [req.user.id],
      ),
    })
  }),
)

/* --------------------------------------------------------------------------
 * Activity history (Prompt 58 §8)
 *
 * Two sources are merged for the owner only: the citizen activity list (service
 * views, saved services, downloads) and the account's own audit entries. No
 * other citizen can read this, and no administrator sees it through a citizen
 * endpoint.
 * ------------------------------------------------------------------------ */
accountRouter.get(
  '/activity',
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40))
    res.json({
      results: all(
        `SELECT id, activity_type AS action, entity_id, entity_label AS label, entity_slug AS slug,
                'activity' AS source, created_at
         FROM citizen_activities WHERE user_id = ?
         UNION ALL
         SELECT id, action, NULL AS entity_id, module AS label, NULL AS slug, 'account' AS source, created_at
         FROM audit_logs WHERE user_id = ?
         ORDER BY created_at DESC LIMIT ?`,
        [req.user.id, req.user.id, limit],
      ),
      types: CITIZEN_ACTIVITY_TYPES,
    })
  }),
)

const activitySchema = z.object({
  type: z.enum(Object.keys(CITIZEN_ACTIVITY_TYPES)),
  entityType: z.enum(ACTIVITY_ENTITY_TYPES).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  label: z.string().trim().max(200).optional(),
  slug: z.string().trim().max(200).optional(),
})

accountRouter.post(
  '/activity',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 120 }),
  validate(activitySchema),
  asyncHandler(async (req, res) => {
    const { type, entityType, entityId, label, slug } = req.body
    // Browsing history is opt-out (Prompt 72). When it is off, no view is stored.
    if (type === 'service_viewed') {
      const discovery = get(`SELECT history_enabled FROM discovery_preferences WHERE user_id = ?`, [req.user.id])
      if (discovery && Number(discovery.history_enabled) === 0) {
        return res.json({ message: 'Browsing history is disabled, so nothing was recorded.', recorded: false })
      }
    }
    // Views are deduplicated for half an hour so browsing does not create a
    // detailed behavioural trail.
    if (type.endsWith('_viewed')) {
      const recent = get(
        `SELECT id FROM citizen_activities
         WHERE user_id = ? AND activity_type = ? AND COALESCE(entity_slug,'') = ?
           AND datetime(created_at) > datetime('now','-30 minutes') LIMIT 1`,
        [req.user.id, type, slug || ''],
      )
      if (recent) return res.json({ message: 'Already recorded recently.', recorded: false })
    }
    run(
      `INSERT INTO citizen_activities (user_id, activity_type, entity_type, entity_id, entity_label, entity_slug)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, type, entityType || null, entityId || null, cleanText(label, 200), cleanText(slug, 200)],
    )
    res.status(201).json({ message: 'Activity recorded.', recorded: true })
  }),
)

accountRouter.delete(
  '/activity',
  asyncHandler(async (req, res) => {
    run(`DELETE FROM citizen_activities WHERE user_id = ?`, [req.user.id])
    logAudit(req, { action: 'privacy.activity_cleared', module: 'accounts', entityType: 'user', entityId: req.user.id })
    res.json({ message: 'Your activity history has been cleared.' })
  }),
)

/* --------------------------------------------------------------------------
 * Application tracking foundation (Prompt 58 §9) — read only.
 * ------------------------------------------------------------------------ */
/* The personal document vault now owns /account/documents (Prompt 66). */

accountRouter.get(
  '/privacy/requests',
  asyncHandler(async (req, res) => {
    res.json({
      results: all(
        `SELECT id, reference, category, status, description, resolution, created_at, updated_at, resolved_at
         FROM data_requests WHERE user_id = ? ORDER BY id DESC`,
        [req.user.id],
      ).map((row) => ({ ...row, statusLabel: PRIVACY_REQUEST_STATUSES[row.status] || row.status })),
      statuses: PRIVACY_REQUEST_STATUSES,
      note: 'These statuses describe the BetterGo privacy request workflow. They are not government decisions and do not automatically approve deletion where records must be retained.',
    })
  }),
)

accountRouter.post(
  '/privacy/requests',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 6 }),
  validate(
    z.object({
      category: z.enum(['access', 'correction', 'deletion', 'restriction', 'withdraw_consent', 'concern', 'question']),
      description: z.string().trim().min(10, 'Describe your request.').max(3000),
    }),
  ),
  asyncHandler(async (req, res) => {
    const ref = reference('BGDR')
    run(
      `INSERT INTO data_requests (reference, user_id, requester_name, requester_email, category, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ref, req.user.id, req.user.name, req.user.email, req.body.category, cleanText(req.body.description, 3000)],
    )
    const created = get(`SELECT id FROM data_requests WHERE reference = ?`, [ref])
    if (created) {
      run(`INSERT INTO privacy_request_events (request_id, from_status, to_status, note, actor_id) VALUES (?, NULL, 'submitted', 'Request received', ?)`, [created.id, req.user.id])
    }
    logAudit(req, { action: 'privacy.request_submitted', module: 'privacy', entityType: 'data_request', entityId: ref })
    res.status(201).json({
      message: 'Request received. We may verify your identity before actioning it. Some records may need to be retained where the law requires it.',
      reference: ref,
    })
  }),
)

/**
 * Personal data export. Contains only the caller's own data and never
 * credentials, tokens, audit internals or third-party information.
 */
accountRouter.get(
  '/privacy/export',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 3 }),
  asyncHandler(async (req, res) => {
    const user = get(`SELECT id, name, email, phone, account_status, email_verified_at, created_at FROM users WHERE id = ?`, [
      req.user.id,
    ])
    const payload = {
      exportedAt: nowIso(),
      note: 'This export contains only your own account data. Credentials and internal security records are excluded.',
      account: user,
      profile: profileOf(req.user.id),
      roles: all(
        `SELECT r.slug, ura.scope_type, ura.assigned_at FROM user_role_assignments ura JOIN user_roles r ON r.id = ura.role_id WHERE ura.user_id = ?`,
        [req.user.id],
      ),
      preferences: get(`SELECT * FROM notification_preferences WHERE user_id = ?`, [req.user.id]),
      consents: all(`SELECT consent_category, status, policy_version, created_at, withdrawn_at FROM consent_records WHERE user_id = ?`, [
        req.user.id,
      ]),
      favorites: all(
        `SELECT s.title, s.slug, f.created_at FROM service_favorites f JOIN government_services s ON s.id = f.service_id WHERE f.user_id = ?`,
        [req.user.id],
      ),
      reports: all(`SELECT reference, kind, subject, description, status, resolution, created_at FROM citizen_reports WHERE user_id = ?`, [
        req.user.id,
      ]),
      privacyRequests: all(`SELECT reference, category, status, created_at FROM data_requests WHERE user_id = ?`, [req.user.id]),
    }
    run(`INSERT INTO data_exports (user_id, expires_at) VALUES (?, ?)`, [
      req.user.id,
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ])
    logAudit(req, { action: 'privacy.data_exported', module: 'privacy', entityType: 'user', entityId: req.user.id })
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="bettergo-personal-data-${req.user.id}.json"`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(JSON.stringify(payload, null, 2))
  }),
)

accountRouter.post(
  '/privacy/deletion-request',
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 3 }),
  validate(z.object({ confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm that you understand the effects.' }) }), reason: z.string().trim().max(1000).optional() })),
  asyncHandler(async (req, res) => {
    const ref = reference('BGDR')
    run(
      `INSERT INTO data_requests (reference, user_id, requester_name, requester_email, category, description)
       VALUES (?, ?, ?, ?, 'deletion', ?)`,
      [
        ref,
        req.user.id,
        req.user.name,
        req.user.email,
        cleanText(`Account deletion requested. ${req.body.reason || ''}`, 1000),
      ],
    )
    logAudit(req, { action: 'privacy.deletion_requested', module: 'privacy', entityType: 'user', entityId: req.user.id })
    res.status(201).json({
      message:
        'Deletion request recorded. Accounts are not deleted automatically: an administrator verifies the request and checks whether records must be retained. You will be contacted through your registered email.',
      reference: ref,
    })
  }),
)

const personalizationSchema = z.object({
  personalizationOptIn: z.union([z.boolean(), z.literal('true'), z.literal('on')]).optional(),
  interests: z.array(z.enum(CITIZEN_INTERESTS)).max(CITIZEN_INTERESTS.length).optional(),
})

accountRouter.get(
  '/preferences/personalization',
  asyncHandler(async (req, res) => {
    const profile = get(`SELECT personalization_opt_in FROM user_profiles WHERE user_id = ?`, [req.user.id])
    res.json({
      personalizationOptIn: Boolean(profile?.personalization_opt_in ?? 1),
      interests: interestsOf(req.user.id),
      availableInterests: CITIZEN_INTERESTS,
      note: 'These preferences only shape what BetterGo suggests. They are optional and never shared with other citizens or offices.',
    })
  }),
)

accountRouter.put(
  '/preferences/personalization',
  validate(personalizationSchema),
  asyncHandler(async (req, res) => {
    const d = req.body
    if (d.personalizationOptIn !== undefined) {
      run(`UPDATE user_profiles SET personalization_opt_in = ?, updated_at = ? WHERE user_id = ?`, [
        bit(d.personalizationOptIn),
        nowIso(),
        req.user.id,
      ])
    }
    if (Array.isArray(d.interests)) {
      const wanted = [...new Set(d.interests)]
      run(`DELETE FROM citizen_interests WHERE user_id = ?`, [req.user.id])
      for (const key of wanted) {
        run(`INSERT INTO citizen_interests (user_id, interest_key, updated_at) VALUES (?, ?, ?)`, [req.user.id, key, nowIso()])
      }
    }
    recordProfileChange(req.user.id, 'personalization', [
      d.personalizationOptIn !== undefined ? 'personalization opt-in' : null,
      Array.isArray(d.interests) ? 'interests' : null,
    ])
    res.json({
      message: 'Personalization preferences saved.',
      personalizationOptIn: Boolean(get(`SELECT personalization_opt_in FROM user_profiles WHERE user_id = ?`, [req.user.id])?.personalization_opt_in ?? 1),
      interests: interestsOf(req.user.id),
    })
  }),
)

// Profile photo upload (raw body, magic-byte validated, no executable content).
const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
}

accountRouter.put(
  '/photo',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  asyncHandler(async (req, res) => {
    const contentType = String(req.get('content-type') || '').split(';')[0].trim()
    const signature = ALLOWED_IMAGE_TYPES[contentType]
    if (!signature) {
      throw unprocessable('Upload a JPG, PNG or WebP image.', [{ field: 'photo', message: 'Unsupported image type.' }])
    }
    const buffer = req.body
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw unprocessable('No image data received.', [{ field: 'photo', message: 'Empty upload.' }])
    }
    if (buffer.length > 2 * 1024 * 1024) {
      throw unprocessable('Profile photos must be 2 MB or smaller.', [{ field: 'photo', message: 'File too large.' }])
    }
    if (!signature.every((byte, index) => buffer[index] === byte)) {
      throw unprocessable('The uploaded file is not a valid image.', [{ field: 'photo', message: 'File content mismatch.' }])
    }
    const dir = path.resolve(process.cwd(), env.uploadsDir, 'avatars')
    fs.mkdirSync(dir, { recursive: true })
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
    const filename = `${req.user.id}-${crypto.randomBytes(8).toString('hex')}.${ext}`
    fs.writeFileSync(path.join(dir, filename), buffer)
    const publicPath = `/uploads/avatars/${filename}`
    const previous = get(`SELECT profile_photo FROM user_profiles WHERE user_id = ?`, [req.user.id])?.profile_photo
    run(`UPDATE user_profiles SET profile_photo = ?, updated_at = ? WHERE user_id = ?`, [publicPath, nowIso(), req.user.id])
    if (previous && previous.startsWith('/uploads/avatars/')) {
      const oldFile = path.resolve(process.cwd(), env.uploadsDir, 'avatars', path.basename(previous))
      if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile)
    }
    recordProfileChange(req.user.id, 'profile_photo', ['uploaded or replaced'])
    logAudit(req, { action: 'profile.photo_updated', module: 'accounts', entityType: 'user', entityId: req.user.id })
    res.json({ message: 'Profile photo updated.', profilePhoto: publicPath })
  }),
)

accountRouter.delete(
  '/photo',
  asyncHandler(async (req, res) => {
    const previous = get(`SELECT profile_photo FROM user_profiles WHERE user_id = ?`, [req.user.id])?.profile_photo
    run(`UPDATE user_profiles SET profile_photo = NULL, updated_at = ? WHERE user_id = ?`, [nowIso(), req.user.id])
    recordProfileChange(req.user.id, 'profile_photo', ['removed'])
    if (previous && previous.startsWith('/uploads/avatars/')) {
      const oldFile = path.resolve(process.cwd(), env.uploadsDir, 'avatars', path.basename(previous))
      if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile)
    }
    res.json({ message: 'Profile photo removed.' })
  }),
)

accountRouter.get(
  '/consents',
  asyncHandler(async (req, res) => {
    res.json({
      results: all(
        `SELECT id, consent_category, status, policy_version, source, created_at, withdrawn_at
         FROM consent_records WHERE user_id = ? ORDER BY id DESC`,
        [req.user.id],
      ),
    })
  }),
)

accountRouter.post(
  '/consents/:category/withdraw',
  asyncHandler(async (req, res) => {
    const row = get(
      `SELECT * FROM consent_records WHERE user_id = ? AND consent_category = ? AND status = 'granted' ORDER BY id DESC LIMIT 1`,
      [req.user.id, req.params.category],
    )
    if (!row) throw notFound('No active consent of that type was found.')
    if (['terms_of_use', 'privacy_policy'].includes(req.params.category)) {
      throw forbidden('Acceptance of the Terms of Use and Privacy Policy cannot be withdrawn while the account is active.')
    }
    run(`UPDATE consent_records SET status = 'withdrawn', withdrawn_at = ? WHERE id = ?`, [nowIso(), row.id])
    logAudit(req, { action: 'privacy.consent_withdrawn', module: 'privacy', entityType: 'consent', entityId: row.id })
    res.json({ message: 'Consent withdrawn.', category: req.params.category })
  }),
)

/* --------------------------------------------------------------------------
 * Saved items and collections (Prompt 63)
 *
 * One bookmark system for every saveable public record type. Every query is
 * filtered by the owning user, so one citizen can never read or change
 * another's saved items or collections.
 * ------------------------------------------------------------------------ */
const SAVED_TYPES = ['service', 'office', 'announcement', 'document']

const SAVED_QUERIES = {
  service: `SELECT s.id, s.title, s.short_description AS summary, s.slug,
                   s.publication_status AS status, s.archived_at, m.name AS municipality_name
            FROM government_services s LEFT JOIN municipalities m ON m.id = s.municipality_id
            WHERE s.id = ? OR s.slug = ?`,
  office: `SELECT o.id, o.name AS title, o.description AS summary, o.slug,
                  o.publication_status AS status, NULL AS archived_at, m.name AS municipality_name
           FROM government_offices o LEFT JOIN municipalities m ON m.id = o.municipality_id
           WHERE o.id = ? OR o.slug = ?`,
  announcement: `SELECT a.id, a.title, a.summary, a.slug, a.publication_status AS status, a.archived_at,
                        m.name AS municipality_name
                 FROM announcements a LEFT JOIN municipalities m ON m.id = a.municipality_id
                 WHERE a.id = ? OR a.slug = ?`,
  document: `SELECT d.id, d.title, d.description AS summary, d.slug, d.publication_status AS status,
                    NULL AS archived_at, m.name AS municipality_name
             FROM public_documents d LEFT JOIN municipalities m ON m.id = d.municipality_id
             WHERE d.id = ? OR d.slug = ?`,
}

const SAVED_PATHS = {
  service: (slug) => `/services/${slug}`,
  office: (slug) => `/government-directory/${slug}`,
  announcement: (slug) => `/announcements/${slug}`,
  document: (slug) => `/transparency/documents/${slug}`,
}

const SAVED_LABELS = {
  service: 'Government service',
  office: 'Government office',
  announcement: 'Announcement',
  document: 'Public document',
}

function resolveSavedRecord(type, key) {
  const query = SAVED_QUERIES[type]
  if (!query) return null
  const numeric = Number(key)
  const row = get(query, [Number.isFinite(numeric) ? numeric : -1, String(key)])
  if (!row) return null
  return row
}

/** A saved record is only shown in detail while it is still published. */
function presentSaved(row) {
  const published = row.status === 'published' && !row.archived_at
  if (!published) {
    return {
      contentType: row.content_type,
      contentId: row.content_id,
      typeLabel: SAVED_LABELS[row.content_type] || row.content_type,
      available: false,
      title: 'This record is no longer published',
      summary: 'It was removed from public view. Your bookmark is kept so you can see that it existed.',
      url: null,
      savedAt: row.created_at,
    }
  }
  return {
    contentType: row.content_type,
    contentId: row.content_id,
    typeLabel: SAVED_LABELS[row.content_type] || row.content_type,
    available: true,
    title: row.title,
    summary: row.summary || null,
    slug: row.slug,
    url: SAVED_PATHS[row.content_type] ? SAVED_PATHS[row.content_type](row.slug) : null,
    municipalityName: row.municipality_name || null,
    savedAt: row.created_at,
  }
}

/** Resolves one bookmark row; keeps an unavailable record as a stub. */
function hydrateSaved(row) {
  const record = resolveSavedRecord(row.content_type, row.content_id)
  if (!record) {
    return {
      contentType: row.content_type,
      contentId: row.content_id,
      typeLabel: SAVED_LABELS[row.content_type] || row.content_type,
      available: false,
      title: 'This record is no longer available',
      summary: 'The underlying public record was removed. Your bookmark is kept as a reference.',
      url: null,
      savedAt: row.created_at,
    }
  }
  return presentSaved({ ...record, content_type: row.content_type, content_id: row.content_id, created_at: row.created_at })
}

function savedStatusFor(userId, type, contentId) {
  return Boolean(get(`SELECT id FROM saved_items WHERE user_id = ? AND content_type = ? AND content_id = ?`, [userId, type, contentId]))
}

accountRouter.get(
  '/saved',
  asyncHandler(async (req, res) => {
    const type = SAVED_TYPES.includes(String(req.query.type)) ? String(req.query.type) : null
    const sort = ['recent', 'oldest', 'alpha', 'municipality'].includes(String(req.query.sort)) ? String(req.query.sort) : 'recent'
    const term = cleanText(req.query.q, 120)?.toLowerCase() || ''
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))

    const rows = all(
      `SELECT * FROM saved_items WHERE user_id = ? ${type ? 'AND content_type = ?' : ''} ORDER BY created_at DESC, id DESC`,
      type ? [req.user.id, type] : [req.user.id],
    )
    let items = rows.map(hydrateSaved)
    if (term) {
      items = items.filter((item) => [item.title, item.summary, item.municipalityName, item.typeLabel].filter(Boolean).join(' ').toLowerCase().includes(term))
    }
    items.sort((a, b) => {
      if (sort === 'oldest') return String(a.savedAt).localeCompare(String(b.savedAt))
      if (sort === 'alpha') return String(a.title).localeCompare(String(b.title))
      if (sort === 'municipality') return String(a.municipalityName || '~').localeCompare(String(b.municipalityName || '~'))
      return String(b.savedAt).localeCompare(String(a.savedAt))
    })

    const counts = Object.fromEntries(SAVED_TYPES.map((key) => [key, 0]))
    for (const row of rows) counts[row.content_type] = (counts[row.content_type] || 0) + 1

    res.json({
      results: items.slice((page - 1) * limit, page * limit),
      total: items.length,
      page,
      limit,
      counts,
      types: SAVED_TYPES.map((key) => ({ key, label: SAVED_LABELS[key] })),
      sort,
      note: 'Saved items are private to your account. A bookmark is not an application, reservation or government record.',
    })
  }),
)

accountRouter.get(
  '/saved/status',
  asyncHandler(async (req, res) => {
    const type = String(req.query.contentType || '')
    if (!SAVED_TYPES.includes(type)) throw unprocessable('Unsupported content type.', [{ field: 'contentType', message: 'Unknown type.' }])
    const record = resolveSavedRecord(type, req.query.slug || req.query.contentId)
    if (!record) return res.json({ saved: false })
    res.json({ saved: savedStatusFor(req.user.id, type, record.id), contentId: record.id })
  }),
)

accountRouter.post(
  '/saved',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 120 }),
  validate(
    z.object({
      contentType: z.enum(SAVED_TYPES),
      contentId: z.coerce.number().int().positive().optional(),
      slug: z.string().trim().max(200).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const record = resolveSavedRecord(req.body.contentType, req.body.contentId || req.body.slug)
    if (!record || record.status !== 'published' || record.archived_at) throw notFound('That record is not available to save.')
    if (savedStatusFor(req.user.id, req.body.contentType, record.id)) {
      return res.json({ message: 'This item is already saved.', saved: true, contentId: record.id })
    }
    run(`INSERT INTO saved_items (user_id, content_type, content_id) VALUES (?, ?, ?)`, [req.user.id, req.body.contentType, record.id])
    res.status(201).json({ message: 'Saved to your private list.', saved: true, contentId: record.id })
  }),
)

accountRouter.delete(
  '/saved/:type/:id',
  asyncHandler(async (req, res) => {
    if (!SAVED_TYPES.includes(req.params.type)) throw notFound('Saved item not found.')
    run(`DELETE FROM saved_items WHERE user_id = ? AND content_type = ? AND content_id = ?`, [req.user.id, req.params.type, Number(req.params.id)])
    res.json({ message: 'Removed from your saved list.', saved: false })
  }),
)

const collectionSchema = z.object({
  name: z.string().trim().min(1, 'Give the collection a name.').max(80),
  description: z.string().trim().max(300).optional().or(z.literal('')),
  icon: z.enum(['folder', 'briefcase', 'home', 'education', 'health', 'travel', 'alert', 'document']).optional(),
})

function ownedCollection(userId, id) {
  const row = get(`SELECT * FROM service_collections WHERE id = ? AND user_id = ?`, [Number(id), userId])
  if (!row) throw notFound('Collection not found.')
  return row
}

function collectionItems(collectionId) {
  const rows = all(`SELECT * FROM service_collection_items WHERE collection_id = ? ORDER BY sort_order ASC, id ASC`, [collectionId])
  return rows.map((row) => {
    const contentType = row.content_type || 'service'
    const contentId = row.content_id || row.service_id
    return { itemId: row.id, note: row.note, ...hydrateSaved({ content_type: contentType, content_id: contentId, created_at: row.created_at }) }
  })
}

accountRouter.get(
  '/collections',
  asyncHandler(async (req, res) => {
    const collections = all(
      `SELECT c.id, c.name, c.description, c.icon, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM service_collection_items i WHERE i.collection_id = c.id) AS item_count
       FROM service_collections c WHERE c.user_id = ? ORDER BY c.updated_at DESC`,
      [req.user.id],
    )
    res.json({ results: collections.map((collection) => ({ ...collection, items: collectionItems(collection.id) })) })
  }),
)

accountRouter.get(
  '/collections/:id',
  asyncHandler(async (req, res) => {
    const collection = ownedCollection(req.user.id, req.params.id)
    res.json({ collection: { ...collection, items: collectionItems(collection.id) } })
  }),
)

accountRouter.post(
  '/collections',
  validate(collectionSchema),
  asyncHandler(async (req, res) => {
    const count = Number(get(`SELECT COUNT(*) AS n FROM service_collections WHERE user_id = ?`, [req.user.id]).n)
    if (count >= 30) throw unprocessable('You can keep up to 30 collections.')
    const result = run(`INSERT INTO service_collections (user_id, name, description, icon) VALUES (?, ?, ?, ?)`, [
      req.user.id,
      cleanText(req.body.name, 80),
      cleanText(req.body.description, 300),
      req.body.icon || 'folder',
    ])
    res.status(201).json({ message: 'Collection created.', id: Number(result.lastInsertRowid) })
  }),
)

accountRouter.patch(
  '/collections/:id',
  validate(collectionSchema.partial()),
  asyncHandler(async (req, res) => {
    const collection = ownedCollection(req.user.id, req.params.id)
    run(`UPDATE service_collections SET name = ?, description = ?, icon = ?, updated_at = ? WHERE id = ?`, [
      req.body.name !== undefined ? cleanText(req.body.name, 80) : collection.name,
      req.body.description !== undefined ? cleanText(req.body.description, 300) : collection.description,
      req.body.icon !== undefined ? req.body.icon : collection.icon,
      nowIso(),
      collection.id,
    ])
    res.json({ message: 'Collection updated.' })
  }),
)

accountRouter.delete(
  '/collections/:id',
  asyncHandler(async (req, res) => {
    const collection = ownedCollection(req.user.id, req.params.id)
    run(`DELETE FROM service_collections WHERE id = ?`, [collection.id])
    res.json({ message: 'Collection deleted. The saved public records themselves were not changed.' })
  }),
)

accountRouter.post(
  '/collections/:id/items',
  validate(
    z.object({
      contentType: z.enum(SAVED_TYPES).default('service'),
      contentId: z.coerce.number().int().positive().optional(),
      serviceId: z.coerce.number().int().positive().optional(),
      note: z.string().trim().max(300).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const collection = ownedCollection(req.user.id, req.params.id)
    const contentType = req.body.contentType || 'service'
    const contentId = req.body.contentId || req.body.serviceId
    if (!contentId) throw unprocessable('Choose a record to add.', [{ field: 'contentId', message: 'Required.' }])
    const record = resolveSavedRecord(contentType, contentId)
    if (!record || record.status !== 'published' || record.archived_at) throw notFound('That record is not available.')
    const nextOrder = Number(get(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM service_collection_items WHERE collection_id = ?`, [collection.id]).n)
    run(
      `INSERT OR IGNORE INTO service_collection_items (collection_id, service_id, content_type, content_id, note, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [collection.id, contentType === 'service' ? record.id : null, contentType, record.id, cleanText(req.body.note, 300), nextOrder],
    )
    run(`UPDATE service_collections SET updated_at = ? WHERE id = ?`, [nowIso(), collection.id])
    res.status(201).json({ message: 'Added to the collection.' })
  }),
)

accountRouter.delete(
  '/collections/:id/items/item/:itemId',
  asyncHandler(async (req, res) => {
    const collection = ownedCollection(req.user.id, req.params.id)
    run(`DELETE FROM service_collection_items WHERE collection_id = ? AND id = ?`, [collection.id, Number(req.params.itemId)])
    run(`UPDATE service_collections SET updated_at = ? WHERE id = ?`, [nowIso(), collection.id])
    res.json({ message: 'Removed from the collection.' })
  }),
)

accountRouter.delete(
  '/collections/:id/items/:serviceId',
  asyncHandler(async (req, res) => {
    const collection = ownedCollection(req.user.id, req.params.id)
    run(`DELETE FROM service_collection_items WHERE collection_id = ? AND service_id = ?`, [
      collection.id,
      Number(req.params.serviceId),
    ])
    res.json({ message: 'Service removed from the collection.' })
  }),
)

accountRouter.post(
  '/collections/:id/reorder',
  validate(z.object({ itemIds: z.array(z.coerce.number().int().positive()).max(200) })),
  asyncHandler(async (req, res) => {
    const collection = ownedCollection(req.user.id, req.params.id)
    const owned = new Set(
      all(`SELECT id FROM service_collection_items WHERE collection_id = ?`, [collection.id]).map((row) => Number(row.id)),
    )
    req.body.itemIds.forEach((itemId, index) => {
      if (!owned.has(Number(itemId))) return
      run(`UPDATE service_collection_items SET sort_order = ? WHERE id = ? AND collection_id = ?`, [index, Number(itemId), collection.id])
    })
    res.json({ message: 'Collection order saved.' })
  }),
)

accountRouter.post(
  '/collections/:id/move',
  validate(z.object({ itemId: z.coerce.number().int().positive(), collectionId: z.coerce.number().int().positive().nullable() })),
  asyncHandler(async (req, res) => {
    const collection = ownedCollection(req.user.id, req.params.id)
    const item = get(`SELECT * FROM service_collection_items WHERE id = ? AND collection_id = ?`, [Number(req.body.itemId), collection.id])
    if (!item) throw notFound('Saved item not found in this collection.')
    if (req.body.collectionId === null) {
      run(`DELETE FROM service_collection_items WHERE id = ?`, [item.id])
      return res.json({ message: 'Item removed from the collection.' })
    }
    const target = ownedCollection(req.user.id, req.body.collectionId)
    const nextOrder = Number(get(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM service_collection_items WHERE collection_id = ?`, [target.id]).n)
    run(`UPDATE service_collection_items SET collection_id = ?, sort_order = ? WHERE id = ?`, [target.id, nextOrder, item.id])
    run(`UPDATE service_collections SET updated_at = ? WHERE id IN (?, ?)`, [nowIso(), collection.id, target.id])
    res.json({ message: 'Moved to the selected collection.' })
  }),
)

/* Notification filtering for the notifications centre. */
accountRouter.get(
  '/notifications/summary',
  asyncHandler(async (req, res) => {
    res.json({
      total: Number(get(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?`, [req.user.id]).n),
      unread: Number(get(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`, [req.user.id]).n),
      byType: all(
        `SELECT notification_type, COUNT(*) AS total FROM notifications WHERE user_id = ? GROUP BY notification_type`,
        [req.user.id],
      ),
      channels: get(`SELECT email_enabled, sms_enabled, in_app_enabled FROM notification_preferences WHERE user_id = ?`, [
        req.user.id,
      ]) || { email_enabled: 0, sms_enabled: 0, in_app_enabled: 1 },
      note: 'Email and SMS delivery depend on providers configured for this deployment. In-app notifications always work.',
    })
  }),
)
