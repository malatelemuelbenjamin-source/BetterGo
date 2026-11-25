/**
 * Notification centre domain helpers (Prompt 68).
 *
 * Categories describe what a stored notification is actually about. A legacy
 * or unknown type falls back to the platform category rather than being
 * presented as a government message.
 */

export const NOTIFICATION_CATEGORIES = {
  account: 'Account',
  security: 'Security',
  application: 'Applications',
  service: 'Digital services',
  document: 'Documents',
  announcement: 'Municipal announcements',
  advisory: 'Public advisories',
  emergency: 'Emergency information',
  platform: 'Platform updates',
  privacy: 'Privacy and data',
  transparency: 'Transparency alerts',
  community: 'Community moderation',
}

/** Categories whose records must never be deletable by the citizen. */
export const PROTECTED_CATEGORIES = ['security', 'privacy', 'emergency']

const TYPE_TO_CATEGORY = {
  account: 'account',
  security: 'security',
  application: 'application',
  service: 'service',
  document: 'document',
  announcement: 'announcement',
  advisory: 'advisory',
  emergency: 'emergency',
  system: 'platform',
  platform: 'platform',
  privacy: 'privacy',
  data_request: 'privacy',
  transparency: 'transparency',
  community: 'community',
}

export function categoryFor(type) {
  return TYPE_TO_CATEGORY[String(type || '').toLowerCase()] || 'platform'
}

/** Preference column that controls a category, if the citizen can mute it. */
export const PREFERENCE_COLUMNS = {
  account: 'in_app_enabled',
  security: 'security_enabled',
  application: 'applications_enabled',
  service: 'in_app_enabled',
  document: 'documents_enabled',
  announcement: 'announcements_enabled',
  advisory: 'advisories_enabled',
  emergency: 'emergency_enabled',
  platform: 'updates_enabled',
  privacy: 'privacy_enabled',
  transparency: 'transparency_enabled',
  community: 'in_app_enabled',
}

/** Security notices cannot be muted off completely. */
export const ALWAYS_ON_CATEGORIES = ['security']

export const TEMPLATE_VARIABLES = [
  'citizen_name',
  'reference',
  'service_title',
  'municipality_name',
  'status',
  'document_title',
  'date',
]

/** Strip markup and reject unknown template variables. */
export function validateTemplateText(text, label) {
  const value = String(text || '')
  if (/<\s*[a-z!/]/i.test(value)) {
    return { ok: false, message: `${label} must be plain text, not HTML.` }
  }
  const tokens = [...value.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((match) => match[1].toLowerCase())
  const unknown = tokens.filter((token) => !TEMPLATE_VARIABLES.includes(token))
  if (unknown.length) {
    return { ok: false, message: `${label} uses unsupported variables: ${[...new Set(unknown)].join(', ')}.` }
  }
  return { ok: true, variables: [...new Set(tokens)] }
}

export function renderTemplate(text, values = {}) {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, token) => {
    const key = token.toLowerCase()
    if (!TEMPLATE_VARIABLES.includes(key)) return ''
    return values[key] === undefined || values[key] === null ? '' : String(values[key])
  })
}
