/**
 * Service status metadata shared by the public directory and the admin
 * dashboard. Labels live here once so a status cannot read differently in two
 * places.
 */

export const AVAILABILITY_META = {
  available: { label: 'Available', tone: 'success' },
  temporarily_unavailable: { label: 'Temporarily unavailable', tone: 'warning' },
  online_application: { label: 'Online application available', tone: 'info' },
  in_person_required: { label: 'In-person application required', tone: 'neutral' },
  needs_confirmation: { label: 'Availability needs confirmation', tone: 'warning' },
  archived: { label: 'Archived', tone: 'neutral' },
}

export const VERIFICATION_META = {
  verified: { label: 'Verified against a source', tone: 'success' },
  pending: { label: 'Verification pending', tone: 'warning' },
  needs_update: { label: 'Information needs updating', tone: 'warning' },
  unverified: { label: 'Not verified', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
}

/**
 * Digital service capability labels (Phase 4). A label describes what the
 * record actually offers, never what a future integration might offer.
 */
export const CAPABILITY_META = {
  information_only: { label: 'Information only', short: 'Information only', tone: 'neutral' },
  external_website: { label: 'External official website', short: 'Official website', tone: 'info' },
  downloadable_form: { label: 'Downloadable form', short: 'Downloadable form', tone: 'neutral' },
  in_person_required: { label: 'In-person processing', short: 'In person', tone: 'neutral' },
  bettergo_feature: { label: 'BetterGo digital feature', short: 'BetterGo feature', tone: 'info' },
  government_integration: { label: 'Authorised government integration', short: 'Government integration', tone: 'success' },
  temporarily_unavailable: { label: 'Temporarily unavailable', short: 'Unavailable', tone: 'warning' },
}

/** Same derivation as server/lib/citizen.js, for list results. */
export function capabilityFor(service, { hasDownloadableForm = false } = {}) {
  if (!service) return 'information_only'
  if (['temporarily_unavailable', 'archived'].includes(service.availability_status)) return 'temporarily_unavailable'
  if (service.digital_capability && CAPABILITY_META[service.digital_capability]) return service.digital_capability
  if (service.is_online && service.official_link) return 'external_website'
  if (hasDownloadableForm) return 'downloadable_form'
  if (service.availability_status === 'in_person_required' || service.application_mode === 'in_person') return 'in_person_required'
  return 'information_only'
}

const pairs = (meta) =>
  Object.entries(meta)
    .filter(([key]) => key !== 'archived')
    .map(([value, item]) => [value, item.label])

export const AVAILABILITY_OPTIONS = pairs(AVAILABILITY_META)
export const VERIFICATION_OPTIONS = pairs(VERIFICATION_META)

export const SCOPE_OPTIONS = [
  ['province_wide', 'Province-wide'],
  ['municipality_specific', 'Municipality-specific'],
  ['selected_municipalities', 'Selected municipalities'],
  ['national_service', 'National service available in Marinduque'],
  ['online_province_wide', 'Online service, province-wide'],
]

export const SERVICE_TRANSITIONS = {
  draft: [['submitted_for_review', 'Submit for review']],
  submitted_for_review: [['under_review', 'Begin review'], ['changes_requested', 'Request changes'], ['approved', 'Approve']],
  under_review: [['approved', 'Approve'], ['changes_requested', 'Request changes'], ['rejected', 'Reject']],
  changes_requested: [['submitted_for_review', 'Resubmit'], ['draft', 'Return to draft']],
  approved: [['published', 'Publish'], ['archived', 'Archive']],
  published: [['archived', 'Archive']],
  archived: [['draft', 'Restore as draft']],
  rejected: [['draft', 'Return to draft']],
}
