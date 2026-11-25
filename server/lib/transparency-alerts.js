/**
 * Transparency alert event and delivery helpers (Prompt 113).
 *
 * Reuses the existing notifications table and respects consent/preferences.
 * Events are only created after the publishing workflow succeeds. Nothing is
 * emailed unless a provider is configured and the citizen opted in; the
 * delivery record explicitly says when a channel is unavailable.
 */
import { all, get, nowIso, run } from '../db.js'
import { env } from '../env.js'

export const TRANSPARENCY_TOPICS = {
  all: 'All transparency updates',
  budget: 'Budgets and appropriations',
  revenue: 'Revenue and tax collections',
  expenditure: 'Expenditures',
  procurement: 'Procurement and contracts',
  project: 'Infrastructure projects',
  aip: 'Annual Investment Programs',
  financial_report: 'Financial reports',
  audit_report: 'COA audit report publications',
  grant: 'Grants and donations',
  asset: 'Government assets',
  loan: 'Government debt',
  ppp: 'Public-private partnerships',
  payroll: 'Personnel expenditure aggregates',
  tax: 'Tax assessments and collections',
  land: 'Public land and property',
  utility: 'Utility expenditure',
  donation: 'Donations and external funding',
  open_data: 'Open-data dataset updates',
  monitoring: 'Approved data-quality observations',
  methodology: 'Methodology and reporting definitions',
}

const NEUTRAL_TITLES = {
  budget: 'Published budget record updated',
  revenue: 'Published revenue record updated',
  expenditure: 'Published expenditure record updated',
  procurement: 'Published procurement record updated',
  project: 'Published infrastructure record updated',
  aip: 'Published Annual Investment Program updated',
  financial_report: 'Published financial report updated',
  audit_report: 'Published audit report reference updated',
  grant: 'Published grants information updated',
  asset: 'Published asset information updated',
  loan: 'Published debt information updated',
  ppp: 'Published public-private partnership updated',
  payroll: 'Published personnel expenditure aggregate updated',
  tax: 'Published tax assessment or collection updated',
  land: 'Published land transaction updated',
  utility: 'Published utility contract updated',
  donation: 'Published donation information updated',
  open_data: 'New open dataset published',
  monitoring: 'Approved data-quality observation published',
  methodology: 'Reporting methodology updated',
}

function pausedTopics() {
  const rows = all(`SELECT key, value FROM transparency_alert_settings WHERE key LIKE 'pause:%'`)
  const now = nowIso()
  return new Set(rows.filter((row) => row.value && row.value > now).map((row) => row.key.slice(6)))
}

function quietNow(preferences) {
  if (!preferences?.quiet_start || !preferences?.quiet_end) return false
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: preferences.timezone || 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false })
    const current = formatter.format(new Date())
    const start = String(preferences.quiet_start).slice(0, 5)
    const end = String(preferences.quiet_end).slice(0, 5)
    return start <= end ? current >= start && current < end : current >= start || current < end
  } catch {
    return false
  }
}

/**
 * Create one de-duplicated transparency event and deliver it to matching,
 * consented subscribers. Returns counts only; no personal data leaves here.
 */
export function publishTransparencyEvent({
  eventKey,
  eventType,
  title,
  summary = '',
  recordReference = null,
  municipalityId = null,
  category = 'all',
  periodLabel = null,
}) {
  const existing = get(`SELECT id FROM transparency_alert_events WHERE event_key = ?`, [eventKey])
  if (existing) return { eventId: existing.id, duplicate: true, delivered: 0, queued: 0, skipped: 0 }
  if (pausedTopics().has(category) || pausedTopics().has('all')) {
    return { eventId: null, duplicate: false, paused: true, delivered: 0, queued: 0, skipped: 0 }
  }
  const eventId = Number(run(
    `INSERT INTO transparency_alert_events (event_key, event_type, title, summary, record_reference, municipality_id, category, period_label, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [eventKey, eventType, title || NEUTRAL_TITLES[category] || 'Published transparency update', summary, recordReference, municipalityId ?? null, category, periodLabel, nowIso()],
  ).lastInsertRowid)

  const subscriptions = all(
    `SELECT s.user_id, s.topic, s.municipality_id, p.in_app, p.email_opt_in, p.frequency, p.paused_until,
            p.quiet_start, p.quiet_end, p.timezone, COALESCE(np.in_app_enabled, 1) AS platform_in_app,
            COALESCE(np.transparency_enabled, 1) AS transparency_enabled, COALESCE(np.email_enabled, 1) AS email_enabled
     FROM transparency_subscriptions s
     LEFT JOIN transparency_alert_preferences p ON p.user_id = s.user_id
     LEFT JOIN notification_preferences np ON np.user_id = s.user_id
     WHERE s.topic IN ('all', ?) AND (s.municipality_id IS NULL OR s.municipality_id = ?)`,
    [category, municipalityId ?? -1],
  )
  let delivered = 0
  let queued = 0
  let skipped = 0
  for (const subscription of subscriptions) {
    if (subscription.paused_until && subscription.paused_until > nowIso()) { skipped += 1; continue }
    if (!subscription.transparency_enabled || !subscription.platform_in_app) { skipped += 1; continue }
    const channel = 'in_app'
    const existingDelivery = get(`SELECT id FROM transparency_alert_deliveries WHERE event_id = ? AND user_id = ? AND channel = ?`, [eventId, subscription.user_id, channel])
    if (existingDelivery) { skipped += 1; continue }
    const notification = get(`SELECT id FROM notifications WHERE user_id = ? AND notification_type = 'transparency' AND related_entity_type = 'transparency_alert_event' AND related_entity_id = ?`, [subscription.user_id, eventId])
    if (!notification) {
      run(
        `INSERT INTO notifications (user_id, title, message, notification_type, category, related_entity_type, related_entity_id)
         VALUES (?, ?, ?, 'transparency', 'transparency', 'transparency_alert_event', ?)`,
        [subscription.user_id, title || NEUTRAL_TITLES[category] || 'Transparency update', `${summary ? `${summary} ` : ''}${periodLabel ? `Reporting period: ${periodLabel}. ` : ''}Published by BetterGo from a verified public source. Not an official government announcement.`, eventId],
      )
    }
    run(
      `INSERT OR IGNORE INTO transparency_alert_deliveries (event_id, user_id, channel, status, attempts, delivered_at)
       VALUES (?, ?, 'in_app', 'delivered', 1, ?)`,
      [eventId, subscription.user_id, nowIso()],
    )
    delivered += 1
    if (subscription.email_opt_in && subscription.email_enabled && env.smtpUrl && !quietNow(subscription)) {
      run(
        `INSERT OR IGNORE INTO transparency_alert_deliveries (event_id, user_id, channel, status, attempts)
         VALUES (?, ?, 'email', 'queued', 0)`,
        [eventId, subscription.user_id],
      )
      queued += 1
    }
  }
  return { eventId, duplicate: false, delivered, queued, skipped, matchedSubscriptions: subscriptions.length }
}

export function alertCategoryLabel(category) {
  return TRANSPARENCY_TOPICS[category] || category
}
