/**
 * Personalization, accessibility and inclusive services (Prompt 81).
 *
 * Declared assistance needs are self-declared and optional. They are never
 * eligibility decisions, are never treated as verified, and only adjust which
 * published service information is surfaced first.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, notFound } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const TEXT_SCALES = { default: 'Default text size', large: 'Larger text', larger: 'Largest text' }
const NEEDS = {
  senior: 'Senior citizen',
  pwd: 'Person with disability',
  pregnant: 'Pregnant or postpartum',
  solo_parent: 'Solo parent',
  caregiving: 'Caring for a dependent',
  low_connectivity: 'Limited internet or device',
  language_assistance: 'Language assistance',
}
const FEATURES = {
  wheelchair_access: 'Wheelchair-accessible office',
  sign_language: 'Sign language assistance',
  large_print: 'Large-print forms',
  home_visit: 'Home or community visit',
  phone_assistance: 'Assistance by phone',
  online_form: 'Online form available',
  priority_lane: 'Priority lane',
  braille: 'Braille materials',
}

const parseList = (value, allowed) => {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.filter((entry) => allowed[entry]) : []
  } catch {
    return []
  }
}

const bool = (value) => (value === true || value === 'true' || value === 'on' ? 1 : 0)

function shapeProfile(profile) {
  return {
    language: profile?.preferred_language || 'en',
    display: profile?.display_preference || 'system',
    reducedMotion: Boolean(profile?.reduced_motion),
    textScale: profile?.text_scale || 'default',
    highContrast: Boolean(profile?.high_contrast),
    simplifiedView: Boolean(profile?.simplified_view),
    screenReaderHints: Boolean(profile?.screen_reader_hints ?? 1),
    personalizationOptIn: Boolean(profile?.personalization_opt_in ?? 1),
    assistanceNeeds: parseList(profile?.assistance_needs, NEEDS),
  }
}

function shapeService(row) {
  const features = parseList(row.accessibility_features, FEATURES)
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    municipalityId: row.municipality_id,
    verificationStatus: row.verification_status,
    features,
    featureLabels: features.map((entry) => FEATURES[entry]),
    notes: row.accessibility_notes,
  }
}

export const personalizationRouter = Router()
personalizationRouter.use(requireAuth)

personalizationRouter.get(
  '/personalization',
  asyncHandler(async (req, res) => {
    const profile = get(
      `SELECT preferred_language, display_preference, reduced_motion, text_scale, high_contrast,
              simplified_view, screen_reader_hints, personalization_opt_in, assistance_needs
       FROM user_profiles WHERE user_id = ?`,
      [req.user.id],
    )
    const settings = shapeProfile(profile)
    const services = settings.personalizationOptIn
      ? all(
          `SELECT id, title, slug, municipality_id, verification_status, accessibility_features, accessibility_notes
           FROM government_services
           WHERE publication_status = 'published'
             AND accessibility_features IS NOT NULL AND accessibility_features <> '[]'
           ORDER BY title LIMIT 30`,
        ).map(shapeService)
      : []
    res.json({
      settings,
      textScales: TEXT_SCALES,
      needs: NEEDS,
      features: FEATURES,
      services,
      note: 'Assistance needs are self-declared, optional and never verified here. They do not decide eligibility for any service. Accessibility details come from published office information; confirm them with the office before travelling.',
      personalizedNote: settings.personalizationOptIn
        ? 'Personalization is on. Only published service information is shown, ordered from your declared needs and saved services.'
        : 'Personalization is off. Declared needs are still saved for you but no suggestions are generated.',
    })
  }),
)

personalizationRouter.put(
  '/personalization',
  validate(
    z.object({
      language: z.enum(['en', 'fil']).optional(),
      display: z.enum(['light', 'dark', 'system']).optional(),
      reducedMotion: z.union([z.boolean(), z.literal('true'), z.literal('on'), z.literal('false')]).optional(),
      textScale: z.enum(Object.keys(TEXT_SCALES)).optional(),
      highContrast: z.union([z.boolean(), z.literal('true'), z.literal('on'), z.literal('false')]).optional(),
      simplifiedView: z.union([z.boolean(), z.literal('true'), z.literal('on'), z.literal('false')]).optional(),
      screenReaderHints: z.union([z.boolean(), z.literal('true'), z.literal('on'), z.literal('false')]).optional(),
      personalizationOptIn: z.union([z.boolean(), z.literal('true'), z.literal('on'), z.literal('false')]).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const d = req.body
    run(
      `UPDATE user_profiles SET
        preferred_language = COALESCE(?, preferred_language),
        display_preference = COALESCE(?, display_preference),
        reduced_motion = COALESCE(?, reduced_motion),
        text_scale = COALESCE(?, text_scale),
        high_contrast = COALESCE(?, high_contrast),
        simplified_view = COALESCE(?, simplified_view),
        screen_reader_hints = COALESCE(?, screen_reader_hints),
        personalization_opt_in = COALESCE(?, personalization_opt_in),
        updated_at = ?
       WHERE user_id = ?`,
      [
        d.language || null,
        d.display || null,
        d.reducedMotion === undefined ? null : bool(d.reducedMotion),
        d.textScale || null,
        d.highContrast === undefined ? null : bool(d.highContrast),
        d.simplifiedView === undefined ? null : bool(d.simplifiedView),
        d.screenReaderHints === undefined ? null : bool(d.screenReaderHints),
        d.personalizationOptIn === undefined ? null : bool(d.personalizationOptIn),
        nowIso(),
        req.user.id,
      ],
    )
    const profile = get(
      `SELECT preferred_language, display_preference, reduced_motion, text_scale, high_contrast,
              simplified_view, screen_reader_hints, personalization_opt_in, assistance_needs
       FROM user_profiles WHERE user_id = ?`,
      [req.user.id],
    )
    logAudit(req, { action: 'personalization.updated', module: 'personalization', entityType: 'user_profile', entityId: req.user.id })
    res.json({ message: 'Accessibility settings saved.', settings: shapeProfile(profile) })
  }),
)

personalizationRouter.put(
  '/personalization/needs',
  validate(z.object({ assistanceNeeds: z.array(z.enum(Object.keys(NEEDS))).max(7) })),
  asyncHandler(async (req, res) => {
    run(`UPDATE user_profiles SET assistance_needs = ?, updated_at = ? WHERE user_id = ?`, [
      JSON.stringify([...new Set(req.body.assistanceNeeds)]),
      nowIso(),
      req.user.id,
    ])
    logAudit(req, { action: 'personalization.needs_updated', module: 'personalization', entityType: 'user_profile', entityId: req.user.id })
    res.json({
      message: 'Assistance needs saved. They are self-declared and do not decide eligibility.',
      assistanceNeeds: [...new Set(req.body.assistanceNeeds)],
      note: 'Nothing here is shared with an office as verified information, and these needs do not decide eligibility. Tell the office directly about any assistance you need.',
    })
  }),
)


// Consolidated preferences centre (Prompt 81): one place for language, display,
// accessibility, default municipality, search preferences and a true reset.
const DEFAULTS = {
  language: 'en',
  display: 'system',
  reducedMotion: 0,
  textScale: 'default',
  highContrast: 0,
  simplifiedView: 0,
  screenReaderHints: 1,
}

function preferencePayload(userId) {
  const profile = get(
    `SELECT preferred_language, display_preference, reduced_motion, text_scale, high_contrast,
            simplified_view, screen_reader_hints, assistance_needs, municipality_id
     FROM user_profiles WHERE user_id = ?`,
    [userId],
  )
  const discovery = get(`SELECT personalization_enabled, history_enabled FROM discovery_preferences WHERE user_id = ?`, [userId])
  const layout = all(`SELECT widget_key, sort_order, visible FROM dashboard_preferences WHERE user_id = ? ORDER BY sort_order`, [userId])
  return {
    settings: {
      ...shapeProfile(profile),
      defaultMunicipalityId: profile?.municipality_id || null,
      searchPersonalization: discovery ? Boolean(discovery.personalization_enabled) : true,
      searchHistory: discovery ? Boolean(discovery.history_enabled) : true,
    },
    dashboard: {
      order: layout.filter((row) => Number(row.visible) === 1).map((row) => row.widget_key),
      hidden: layout.filter((row) => Number(row.visible) === 0).map((row) => row.widget_key),
      customized: layout.length > 0,
    },
    municipalities: all(`SELECT id, name FROM municipalities ORDER BY name`),
    textScales: TEXT_SCALES,
    languages: { en: 'English', fil: 'Filipino' },
    defaults: {
      language: 'en',
      display: 'system',
      textScale: 'default',
      reducedMotion: false,
      highContrast: false,
      simplifiedView: false,
      defaultMunicipalityId: null,
      searchPersonalization: true,
      searchHistory: true,
    },
    note: 'Preferences apply the next time a page loads. Simplified mode never removes access to advanced features, and resetting restores the standard interface. Translating official requirements never changes their meaning.',
  }
}

personalizationRouter.get(
  '/preferences',
  asyncHandler(async (req, res) => {
    res.json(preferencePayload(req.user.id))
  }),
)

personalizationRouter.put(
  '/preferences',
  validate(
    z.object({
      language: z.enum(['en', 'fil']).optional(),
      display: z.enum(['light', 'dark', 'system']).optional(),
      textScale: z.enum(Object.keys(TEXT_SCALES)).optional(),
      reducedMotion: z.boolean().optional(),
      highContrast: z.boolean().optional(),
      simplifiedView: z.boolean().optional(),
      screenReaderHints: z.boolean().optional(),
      defaultMunicipalityId: z.coerce.number().int().positive().nullable().optional(),
      searchPersonalization: z.boolean().optional(),
      searchHistory: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const d = req.body
    if (d.defaultMunicipalityId) {
      const municipality = get(`SELECT id FROM municipalities WHERE id = ?`, [d.defaultMunicipalityId])
      if (!municipality) throw notFound('That municipality does not exist.')
    }
    run(
      `UPDATE user_profiles SET
        preferred_language = COALESCE(?, preferred_language),
        display_preference = COALESCE(?, display_preference),
        text_scale = COALESCE(?, text_scale),
        reduced_motion = COALESCE(?, reduced_motion),
        high_contrast = COALESCE(?, high_contrast),
        simplified_view = COALESCE(?, simplified_view),
        screen_reader_hints = COALESCE(?, screen_reader_hints),
        municipality_id = CASE WHEN ? IS NULL THEN municipality_id ELSE ? END,
        updated_at = ?
       WHERE user_id = ?`,
      [
        d.language || null,
        d.display || null,
        d.textScale || null,
        d.reducedMotion === undefined ? null : bool(d.reducedMotion),
        d.highContrast === undefined ? null : bool(d.highContrast),
        d.simplifiedView === undefined ? null : bool(d.simplifiedView),
        d.screenReaderHints === undefined ? null : bool(d.screenReaderHints),
        d.defaultMunicipalityId === undefined ? null : d.defaultMunicipalityId,
        d.defaultMunicipalityId || null,
        nowIso(),
        req.user.id,
      ],
    )
    if (d.searchPersonalization !== undefined || d.searchHistory !== undefined) {
      run(
        `INSERT INTO discovery_preferences (user_id, personalization_enabled, history_enabled, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           personalization_enabled = COALESCE(?, personalization_enabled),
           history_enabled = COALESCE(?, history_enabled),
           updated_at = ?`,
        [
          req.user.id,
          d.searchPersonalization === undefined ? 1 : bool(d.searchPersonalization),
          d.searchHistory === undefined ? 1 : bool(d.searchHistory),
          nowIso(),
          d.searchPersonalization === undefined ? null : bool(d.searchPersonalization),
          d.searchHistory === undefined ? null : bool(d.searchHistory),
          nowIso(),
        ],
      )
    }
    logAudit(req, { action: 'preferences.updated', module: 'personalization', entityType: 'user_profile', entityId: req.user.id })
    res.json({ message: 'Preferences saved. They apply the next time a page loads.', ...preferencePayload(req.user.id) })
  }),
)

personalizationRouter.post(
  '/preferences/reset',
  asyncHandler(async (req, res) => {
    run(
      `UPDATE user_profiles SET preferred_language = ?, display_preference = ?, reduced_motion = ?, text_scale = ?,
        high_contrast = ?, simplified_view = ?, screen_reader_hints = ?, updated_at = ? WHERE user_id = ?`,
      [DEFAULTS.language, DEFAULTS.display, DEFAULTS.reducedMotion, DEFAULTS.textScale, DEFAULTS.highContrast, DEFAULTS.simplifiedView, DEFAULTS.screenReaderHints, nowIso(), req.user.id],
    )
    run(`DELETE FROM dashboard_preferences WHERE user_id = ?`, [req.user.id])
    run(
      `INSERT INTO discovery_preferences (user_id, personalization_enabled, history_enabled, updated_at)
       VALUES (?, 1, 1, ?) ON CONFLICT(user_id) DO UPDATE SET personalization_enabled = 1, history_enabled = 1, updated_at = ?`,
      [req.user.id, nowIso(), nowIso()],
    )
    logAudit(req, { action: 'preferences.reset', module: 'personalization', entityType: 'user_profile', entityId: req.user.id })
    res.json({ message: 'Preferences reset to the standard interface. Your declared assistance needs were kept.', ...preferencePayload(req.user.id) })
  }),
)

/* -------------------------------- Admin --------------------------------- */

export const adminPersonalizationRouter = Router()
adminPersonalizationRouter.use(requireAuth, requireAdmin)

function scopedService(req, row) {
  const context = ctx(req)
  if (context.hasGlobalScope) return true
  return Boolean(row.municipality_id && canUseMunicipality(context, row.municipality_id))
}

adminPersonalizationRouter.get(
  '/personalization',
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const scopedMunicipalities = context.hasGlobalScope ? null : context.municipalityIds
    const profiles = scopedMunicipalities
      ? scopedMunicipalities.length
        ? all(
            `SELECT p.assistance_needs FROM user_profiles p WHERE p.municipality_id IN (${scopedMunicipalities.map(() => '?').join(',')})`,
            scopedMunicipalities,
          )
        : []
      : all(`SELECT assistance_needs FROM user_profiles`)

    const needCounts = Object.fromEntries(Object.keys(NEEDS).map((key) => [key, 0]))
    for (const row of profiles) {
      for (const need of parseList(row.assistance_needs, NEEDS)) needCounts[need] += 1
    }

    const services = all(
      `SELECT id, title, slug, municipality_id, publication_status, verification_status, accessibility_features, accessibility_notes
       FROM government_services
       WHERE publication_status = 'published'
       ORDER BY title LIMIT 200`,
    ).filter((row) => context.hasGlobalScope || scopedService(req, row))

    res.json({
      summary: {
        accountsWithDeclaredNeeds: profiles.filter((row) => parseList(row.assistance_needs, NEEDS).length > 0).length,
        publishedServices: services.length,
        withAccessibilityInfo: services.filter((row) => parseList(row.accessibility_features, FEATURES).length > 0).length,
        missingAccessibilityInfo: services.filter((row) => parseList(row.accessibility_features, FEATURES).length === 0).length,
      },
      needCounts,
      needs: NEEDS,
      features: FEATURES,
      services: services.map(shapeService),
      note: 'Counts are aggregate only and come from optional self-declarations; they are not eligibility records. Publish accessibility details only from the responsible office source, and never claim a service is accessible without that confirmation.',
    })
  }),
)

adminPersonalizationRouter.put(
  '/personalization/services/:id',
  requirePermission('services.update'),
  validate(
    z.object({
      accessibilityFeatures: z.array(z.enum(Object.keys(FEATURES))).max(8),
      accessibilityNotes: z.string().trim().max(1000).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = get(
      `SELECT id, title, slug, municipality_id, publication_status, verification_status, accessibility_features, accessibility_notes
       FROM government_services WHERE id = ?`,
      [Number(req.params.id)],
    )
    if (!row || !scopedService(req, row)) throw notFound('Service not found in your scope.')
    run(`UPDATE government_services SET accessibility_features = ?, accessibility_notes = ?, updated_by = ?, updated_at = ? WHERE id = ?`, [
      JSON.stringify([...new Set(req.body.accessibilityFeatures)]),
      cleanText(req.body.accessibilityNotes, 1000),
      req.user.id,
      nowIso(),
      row.id,
    ])
    logAudit(req, { action: 'personalization.accessibility_updated', module: 'personalization', entityType: 'government_service', entityId: row.id })
    res.json({
      message: 'Accessibility information saved for this published service.',
      service: shapeService(get(
        `SELECT id, title, slug, municipality_id, verification_status, accessibility_features, accessibility_notes FROM government_services WHERE id = ?`,
        [row.id],
      )),
    })
  }),
)
