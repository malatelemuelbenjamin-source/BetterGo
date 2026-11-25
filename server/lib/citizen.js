/**
 * Citizen digital-services domain helpers.
 *
 * Capability labels describe what a service record actually supports. They are
 * derived from recorded fields so the platform never claims a service is
 * online, integrated or government-authorised when it is not.
 */

export const CAPABILITIES = {
  information_only: {
    label: 'Information only',
    description: 'BetterGo publishes the requirements and procedure. No application is started here.',
  },
  external_website: {
    label: 'External official website',
    description: 'The responsible office publishes its own page. BetterGo only links to it.',
  },
  downloadable_form: {
    label: 'Downloadable form',
    description: 'A form published by the responsible office can be downloaded or opened.',
  },
  in_person_required: {
    label: 'In-person processing',
    description: 'The transaction is completed at the responsible office.',
  },
  bettergo_feature: {
    label: 'BetterGo digital feature',
    description: 'A feature hosted on BetterGo that does not issue or approve government records.',
  },
  government_integration: {
    label: 'Authorised government integration',
    description: 'An integration documented with the responsible office. None is active unless recorded here.',
  },
  temporarily_unavailable: {
    label: 'Temporarily unavailable',
    description: 'The record is published, but the service is currently marked unavailable.',
  },
}

/** Capability keys that must never be inferred, only recorded by an administrator. */
export const RECORDED_ONLY_CAPABILITIES = ['government_integration', 'bettergo_feature']

/**
 * Derive the capability for a published service.
 * @param {object} service row from government_services
 * @param {{ hasDownloadableForm?: boolean }} context
 */
export function capabilityFor(service, { hasDownloadableForm = false } = {}) {
  if (!service) return 'information_only'
  if (['temporarily_unavailable', 'archived'].includes(service.availability_status)) {
    return 'temporarily_unavailable'
  }
  if (service.digital_capability && CAPABILITIES[service.digital_capability]) {
    return service.digital_capability
  }
  if (service.is_online && service.official_link) return 'external_website'
  if (hasDownloadableForm) return 'downloadable_form'
  if (service.availability_status === 'in_person_required' || service.application_mode === 'in_person') {
    return 'in_person_required'
  }
  return 'information_only'
}

export function capabilityMeta(key) {
  return CAPABILITIES[key] || CAPABILITIES.information_only
}

/**
 * Activity types a citizen account may record about itself. Anything else is
 * rejected; the list is deliberately short and behaviour-related, not tracking.
 */
export const CITIZEN_ACTIVITY_TYPES = {
  service_viewed: 'Service viewed',
  service_saved: 'Service saved',
  announcement_viewed: 'Announcement viewed',
  program_viewed: 'Program viewed',
  document_downloaded: 'Public document downloaded',
  inquiry_submitted: 'Inquiry submitted',
  notification_received: 'Notification received',
  application_submitted: 'BetterGo submission recorded',
}

/** Which entity types each activity may reference. */
export const ACTIVITY_ENTITY_TYPES = [
  'application',
  'service',
  'announcement',
  'municipal_content',
  'public_document',
  'report',
  'notification',
]

/** Statuses the BetterGo tracker may use. These are platform states, not government decisions. */
export const APPLICATION_STATUSES = {
  draft: 'Draft (not submitted)',
  submitted: 'Submitted to BetterGo',
  in_review: 'Being reviewed by BetterGo',
  awaiting_citizen: 'Waiting for information from you',
  resubmitted: 'Information resubmitted',
  referred: 'Referred with your consent',
  closed: 'Closed on BetterGo',
  withdrawn: 'Withdrawn by you',
  // Legacy platform states kept so older records still read correctly.
  completed: 'Closed on BetterGo',
  cancelled: 'Cancelled',
}

/** Statuses a reviewer may set, and the ones citizens may act on. */
export const REVIEWER_STATUSES = ['in_review', 'awaiting_citizen', 'resubmitted', 'closed']
export const CITIZEN_WITHDRAWABLE = ['submitted', 'in_review', 'awaiting_citizen', 'resubmitted']


/**
 * Optional personalization interests (Prompt 61 §9). Keys are stable slugs;
 * labels live in the interface, never in citizen records.
 */
export const CITIZEN_INTERESTS = [
  'announcements',
  'advisories',
  'programs',
  'projects',
  'tourism',
  'education',
  'employment',
  'agriculture',
  'disaster_preparedness',
]


/**
 * Dashboard widgets a citizen may reorder or hide (Prompt 62 §14). Account
 * security and privacy shortcuts are deliberately not in this list: they must
 * always remain reachable.
 */
export const DASHBOARD_WIDGETS = [
  'stats',
  'checklist',
  'activity',
  'services',
  'notifications',
  'applications',
  'announcements',
  'advisories',
  'programs',
  'saved',
  'recentlyViewed',
  'recommended',
  'roles',
]

/** Widgets that cannot be hidden because they carry security information. */
export const DASHBOARD_ALWAYS_VISIBLE = ['security']
