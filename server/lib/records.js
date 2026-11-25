/**
 * Digital records centre helpers (Prompt 67).
 *
 * Every item in the timeline is derived from a stored row the citizen owns.
 * Nothing is estimated, back-filled or invented, and an event that was never
 * recorded simply does not appear.
 */

export const RECORD_CATEGORIES = {
  applications: 'Applications and submissions',
  documents: 'Document activity',
  saved: 'Saved services',
  security: 'Account security',
  account: 'Account updates',
  privacy: 'Privacy requests and consents',
}

export const RECORD_TYPES = {
  application_submitted: { category: 'applications', label: 'BetterGo submission' },
  application_status: { category: 'applications', label: 'Application update' },
  application_withdrawn: { category: 'applications', label: 'Application withdrawn' },
  application_closed: { category: 'applications', label: 'Application closed' },
  document_uploaded: { category: 'documents', label: 'Document uploaded' },
  document_replaced: { category: 'documents', label: 'Document replaced' },
  document_deleted: { category: 'documents', label: 'Document removed' },
  document_accessed: { category: 'documents', label: 'Document accessed' },
  document_shared: { category: 'documents', label: 'Document share recorded' },
  saved_added: { category: 'saved', label: 'Service saved' },
  saved_removed: { category: 'saved', label: 'Service unsaved' },
  security_event: { category: 'security', label: 'Account security' },
  profile_change: { category: 'account', label: 'Profile update' },
  preference_change: { category: 'account', label: 'Preference update' },
  privacy_request: { category: 'privacy', label: 'Privacy request' },
  privacy_decision: { category: 'privacy', label: 'Privacy request update' },
  consent: { category: 'privacy', label: 'Consent recorded' },
}

export const PRIVACY_REQUEST_STATUSES = {
  submitted: 'Submitted',
  under_review: 'Under review',
  awaiting_citizen: 'Additional information required',
  processing: 'Processing',
  completed: 'Completed',
  rejected: 'Rejected with explanation',
}

export const ARCHIVABLE_RECORD_TYPES = ['application', 'document', 'privacy_request']

/** Retention is configured per record type; NULL days means "keep, no expiry". */
export const DEFAULT_RETENTION = [
  { recordType: 'application', retentionDays: null, description: 'BetterGo application records' },
  { recordType: 'document', retentionDays: null, description: 'Personal vault document metadata' },
  { recordType: 'privacy_request', retentionDays: null, description: 'Privacy request records' },
  { recordType: 'account_activity', retentionDays: null, description: 'Account activity and security events' },
]

export const DISCLAIMER =
  'These are BetterGo platform records. They are not official government records, certificates, receipts or proof of government approval.'

export function recordPath(type, row) {
  switch (type) {
    case 'application':
      return row.reference ? `/dashboard/applications/${row.reference}` : null
    case 'document':
      return '/dashboard/documents'
    case 'privacy_request':
      return '/dashboard/privacy/requests'
    default:
      return null
  }
}

/** CSV escaping that also neutralises spreadsheet formula prefixes. */
export function csvCell(value) {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function recordsToCsv(items) {
  const header = ['Category', 'Activity', 'Description', 'Reference', 'Record date', 'Source']
  const lines = [header.map(csvCell).join(',')]
  for (const item of items) {
    lines.push(
      [
        RECORD_CATEGORIES[item.category] || item.category,
        item.typeLabel,
        item.description,
        item.reference,
        item.occurredAt,
        'BetterGo platform record',
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return `${lines.join('\n')}\n`
}
