export class ApiError extends Error {
  constructor(message, status, details, payload) {
    super(message)
    this.status = status
    this.details = details || []
    // Full response body, so callers can react to flags such as mfaRequired.
    this.payload = payload || {}
  }
}

async function request(path, { method = 'GET', body, headers = {}, raw } = {}) {
  const options = {
    method,
    credentials: 'include',
    headers: { Accept: 'application/json', ...headers },
  }
  if (raw) {
    options.body = raw.body
    options.headers['Content-Type'] = raw.type
    if (raw.fileName) options.headers['X-File-Name'] = raw.fileName
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(`/api${path}`, options)
  } catch {
    throw new ApiError('Network error. Check your connection and try again.', 0)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!response.ok) {
    let payload = {}
    if (contentType.includes('application/json')) {
      try {
        payload = await response.json()
      } catch {
        payload = {}
      }
    }
    throw new ApiError(payload.error || `Request failed (${response.status}).`, response.status, payload.details, payload)
  }
  if (contentType.includes('application/json')) return response.json()
  return response.text()
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path, body) => request(path, { method: 'DELETE', body }),
  upload: (path, file) => request(path, { method: 'PUT', raw: { body: file, type: file.type, fileName: file.name } }),
  postFile: (path, file) => request(path, { method: 'POST', raw: { body: file, type: file.type, fileName: file.name } }),
}

export function query(params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

const dateFormatter = new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
const dateTimeFormatter = new Intl.DateTimeFormat('en-PH', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function toDate(value) {
  if (!value) return null
  // SQLite stores "YYYY-MM-DD HH:MM:SS" in UTC; make it explicit.
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? value.replace(' ', 'T') + 'Z' : value
  const date = new Date(normalised)
  return Number.isNaN(date.getTime()) ? null : date
}

export function fmtDate(value) {
  const date = toDate(value)
  return date ? dateFormatter.format(date) : '—'
}

export function fmtDateTime(value) {
  const date = toDate(value)
  return date ? dateTimeFormatter.format(date) : '—'
}

export function fmtNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return new Intl.NumberFormat('en-PH').format(number)
}

export function fmtPeso(cents) {
  const number = Number(cents)
  if (!Number.isFinite(number)) return '—'
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(number / 100)
}

export function relative(value) {
  const date = toDate(value)
  if (!date) return '—'
  const diff = Date.now() - date.getTime()
  const minutes = Math.round(diff / 60000)
  if (Math.abs(minutes) < 1) return 'just now'
  if (Math.abs(minutes) < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return `${days} d ago`
  return fmtDate(value)
}

export function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')
}

export const VERIFICATION_LABELS = {
  verified: { label: 'Verified source', tone: 'success' },
  pending: { label: 'Verification pending', tone: 'warning' },
  unverified: { label: 'Source not yet verified', tone: 'neutral' },
  rejected: { label: 'Verification rejected', tone: 'danger' },
  community: { label: 'Community submitted', tone: 'info' },
}

export const STATUS_LABELS = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted_for_review: { label: 'Submitted for review', tone: 'info' },
  under_review: { label: 'Under review', tone: 'info' },
  changes_requested: { label: 'Changes requested', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  published: { label: 'Published', tone: 'success' },
  archived: { label: 'Archived', tone: 'neutral' },
  rejected: { label: 'Rejected', tone: 'danger' },
  submitted: { label: 'Submitted', tone: 'info' },
  assigned: { label: 'Assigned', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'success' },
  active: { label: 'Active', tone: 'success' },
  suspended: { label: 'Suspended', tone: 'danger' },
  disabled: { label: 'Disabled', tone: 'danger' },
  pending_verification: { label: 'Pending verification', tone: 'warning' },
}
