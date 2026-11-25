export class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details)
export const unauthorized = (message = 'Authentication required.') => new HttpError(401, message)
export const forbidden = (message = 'You are not authorised to perform this action.') =>
  new HttpError(403, message)
export const notFound = (message = 'The requested resource was not found.') => new HttpError(404, message)
export const tooMany = (message = 'Too many requests. Please try again later.') => new HttpError(429, message)
export const unprocessable = (message, details) => new HttpError(422, message, details)

/** Wrap async route handlers so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

/** Standard pagination parameters with hard limits. */
export function pagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 10))
  return { page, limit, offset: (page - 1) * limit }
}

/** Standard paginated payload shape. */
export function paginated(items, total, page, limit) {
  return {
    results: items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  }
}

export function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
}

/** Generate a unique slug for a table/column pair. */
export function uniqueSlug(dbRun, dbGet, table, column, base, excludeId = null) {
  const root = slugify(base) || 'record'
  let candidate = root
  let n = 2
  while (true) {
    const row = excludeId
      ? dbGet(`SELECT id FROM ${table} WHERE ${column} = ? AND id <> ?`, [candidate, excludeId])
      : dbGet(`SELECT id FROM ${table} WHERE ${column} = ?`, [candidate])
    if (!row) return candidate
    candidate = `${root}-${n++}`
  }
}

export function reference(prefix) {
  const stamp = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${prefix}-${stamp}-${rand}`
}

/** Strip control characters and trim user text. */
export function cleanText(value, max = 5000) {
  if (value === undefined || value === null) return null
  const text = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
  return text ? text.slice(0, max) : null
}

/** Remove script/event-handler content from rich text before storage. */
export function sanitizeRichText(html) {
  if (!html) return null
  return String(html)
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .slice(0, 200000)
}

/** Only allow http(s) URLs for stored links. */
export function safeUrl(value) {
  if (!value) return null
  try {
    const url = new URL(String(value))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}
