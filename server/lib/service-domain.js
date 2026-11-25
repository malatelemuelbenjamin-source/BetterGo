/**
 * Shared Government Services domain constants.
 *
 * Used by the public directory (`routes/services.js`), global search
 * (`routes/search.js`) and the administration API (`routes/admin-services.js`)
 * so status labels, synonyms and the published-record rule live in one place.
 */

export const SERVICE_PUBLISHED_SQL = `s.publication_status = 'published' AND s.archived_at IS NULL
  AND (s.published_at IS NULL OR datetime(s.published_at) <= datetime('now'))`

export const AVAILABILITY = {
  available: 'Available',
  temporarily_unavailable: 'Temporarily unavailable',
  online_application: 'Online application available',
  in_person_required: 'In-person application required',
  needs_confirmation: 'Availability needs confirmation',
  archived: 'Archived',
}

export const SERVICE_VERIFICATION = {
  verified: 'Verified against a recorded source',
  pending: 'Pending verification',
  needs_update: 'Needs updating',
  unverified: 'Not verified',
  archived: 'Archived',
}

export const SERVICE_SCOPES = {
  province_wide: 'Province-wide',
  municipality_specific: 'Municipality-specific',
  selected_municipalities: 'Selected municipalities',
  national_service: 'National service available in Marinduque',
  online_province_wide: 'Online service, province-wide',
}

/** Filipino / Taglish keyword expansion used by both search endpoints. */
export const SERVICE_SYNONYMS = {
  tulong: ['assistance', 'aid', 'welfare'],
  ayuda: ['assistance', 'subsidy', 'financial'],
  sertipiko: ['certificate', 'certification'],
  sertipikasyon: ['certification', 'certificate'],
  permiso: ['permit', 'licence', 'license'],
  pahintulot: ['permit', 'clearance'],
  kalusugan: ['health', 'medical'],
  ospital: ['hospital', 'health'],
  edukasyon: ['education', 'school', 'scholarship'],
  paaralan: ['school', 'education'],
  trabaho: ['employment', 'job', 'livelihood'],
  hanapbuhay: ['livelihood', 'employment'],
  negosyo: ['business', 'enterprise', 'permit'],
  buwis: ['tax', 'taxation'],
  lupa: ['land', 'property', 'housing'],
  bahay: ['housing', 'house'],
  pamilya: ['family'],
  nakatatanda: ['senior', 'elderly'],
  matatanda: ['senior', 'elderly'],
  maykapansanan: ['pwd', 'disability'],
  magsasaka: ['farmer', 'agriculture'],
  mangingisda: ['fisherfolk', 'fisheries'],
  iskolar: ['scholarship', 'scholar'],
  libre: ['free', 'no fee'],
  bayad: ['fee', 'payment'],
  oras: ['processing time', 'days'],
  barangay: ['barangay', 'village'],
  munisipyo: ['municipality', 'municipal'],
  probinsya: ['provincial', 'province'],
}

const STOPWORDS = new Set(['the', 'and', 'for', 'ng', 'sa', 'na', 'mga', 'how', 'what', 'where'])

/** Split a query into search terms and add known synonyms. */
export function expandServiceTerms(raw, maxTerms = 8) {
  const words = String(raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .slice(0, 5)
  const terms = new Set(words)
  for (const word of words) {
    for (const synonym of SERVICE_SYNONYMS[word] || []) terms.add(synonym)
  }
  return [...terms].slice(0, maxTerms)
}

export const AVAILABILITY_OPTIONS = Object.entries(AVAILABILITY)
  .filter(([key]) => key !== 'archived')
  .map(([value, label]) => ({ value, label }))

export const VERIFICATION_OPTIONS = Object.entries(SERVICE_VERIFICATION)
  .filter(([key]) => key !== 'archived')
  .map(([value, label]) => ({ value, label }))
