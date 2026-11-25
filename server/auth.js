import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from './env.js'
import { all, get, run, nowIso } from './db.js'
import { unauthorized, forbidden, tooMany } from './lib/http.js'

export const SESSION_COOKIE = 'bg_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7

if (!env.sessionSecret) {
  throw new Error('SESSION_SECRET is required in production.')
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password, hash) {
  if (!hash) return false
  return bcrypt.compare(password, hash)
}

/** Returns a list of human readable problems, empty when the password is acceptable. */
export function passwordIssues(password, { email } = {}) {
  const problems = []
  const value = String(password || '')
  if (value.length < 12) problems.push('Use at least 12 characters.')
  if (!/[a-z]/.test(value)) problems.push('Include a lowercase letter.')
  if (!/[A-Z]/.test(value)) problems.push('Include an uppercase letter.')
  if (!/[0-9]/.test(value)) problems.push('Include a number.')
  if (!/[^A-Za-z0-9]/.test(value)) problems.push('Include a symbol.')
  if (email && value.toLowerCase().includes(String(email).toLowerCase().split('@')[0])) {
    problems.push('Do not use your email address as your password.')
  }
  const common = ['password', '123456789012', 'qwertyuiop12', 'letmein123456', 'administrator']
  if (common.some((item) => value.toLowerCase().includes(item))) {
    problems.push('Avoid common or easily guessed passwords.')
  }
  return problems
}

/**
 * Sign a session token for a user row. The `sv` claim mirrors
 * users.session_version so bumping that column (on password change or reset)
 * immediately invalidates every token issued before it.
 */
export function signSession(user, sessionId = null) {
  const userId = typeof user === 'object' ? user.id : user
  const version = typeof user === 'object' ? Number(user.session_version || 0) : 0
  const payload = { sub: String(userId), sv: version }
  if (sessionId) payload.sid = sessionId
  return jwt.sign(payload, env.sessionSecret, { expiresIn: '7d' })
}

/**
 * Create a registry row and issue the signed cookie. Only a hash of the token is
 * stored, so a database leak cannot be replayed as a session.
 */
export function startSession(req, res, user) {
  const sessionId = crypto.randomUUID()
  const token = signSession(user, sessionId)
  run(
    `INSERT INTO auth_sessions (session_id, user_id, token_hash, user_agent, ip_address, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      user.id,
      sha256(token),
      String(req.get('user-agent') || '').slice(0, 255),
      String(req.ip || '').slice(0, 64),
      nowIso(),
    ],
  )
  setSessionCookie(res, token)
  return { sessionId, token }
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    maxAge: SESSION_TTL_MS,
    path: '/',
  })
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: env.isProduction })
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

export function randomToken() {
  return crypto.randomBytes(32).toString('hex')
}

/** Persist a single-use token and return the raw value (only the hash is stored). */
export function createEmailToken(userId, type, ttlMs) {
  const raw = randomToken()
  const expires = new Date(Date.now() + ttlMs).toISOString()
  run(
    `INSERT INTO email_tokens (user_id, token_hash, type, expires_at) VALUES (?, ?, ?, ?)`,
    [userId, sha256(raw), type, expires],
  )
  return raw
}

/** Validate and consume a token. Returns the owning user id or null. */
export function consumeEmailToken(raw, type) {
  if (!raw) return null
  const row = get(
    `SELECT * FROM email_tokens WHERE token_hash = ? AND type = ? AND used_at IS NULL`,
    [sha256(raw), type],
  )
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null
  run(`UPDATE email_tokens SET used_at = ? WHERE id = ?`, [nowIso(), row.id])
  return row.user_id
}

/** Public shape of a signed-in user, without secrets. */
export function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    accountStatus: user.account_status,
    emailVerified: Boolean(user.email_verified_at),
    createdAt: user.created_at,
  }
}

/** Attach req.user (with roles and permissions) when a valid session exists. */
export function attachUser(req, _res, next) {
  req.user = null
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token) return next()
  try {
    const payload = jwt.verify(token, env.sessionSecret)
    const user = get(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL`, [Number(payload.sub)])
    // A token signed before the last password change is no longer valid.
    if (user && Number(payload.sv ?? 0) === Number(user.session_version ?? 0)) {
      if (payload.sid) {
        const session = get(`SELECT * FROM auth_sessions WHERE session_id = ? AND user_id = ?`, [String(payload.sid), user.id])
        if (!session || session.revoked_at) return next()
        req.sessionId = session.session_id
        run(
          `UPDATE auth_sessions SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-5 minutes'))`,
          [nowIso(), session.id],
        )
      }
      req.user = user
    }
  } catch {
    // Invalid or expired session: treat as guest.
  }
  next()
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized())
  if (req.user.account_status === 'suspended' || req.user.account_status === 'disabled') {
    return next(forbidden('This account is not permitted to sign in.'))
  }
  next()
}

/** Blocks unverified accounts from actions that require a verified email. */
export function requireVerified(req, _res, next) {
  if (!req.user) return next(unauthorized())
  if (!req.user.email_verified_at) {
    return next(forbidden('Please verify your email address to continue.'))
  }
  next()
}

/**
 * Simple in-memory rate limiter. Suitable for a single-process deployment;
 * swap for a shared store when running multiple instances.
 */
export function rateLimit({ windowMs = 60_000, max = 30, key } = {}) {
  const hits = new Map()
  return (req, res, next) => {
    const bucket = key ? key(req) : `${req.ip}:${req.path}`
    const now = Date.now()
    const entry = hits.get(bucket)
    if (!entry || entry.reset < now) {
      hits.set(bucket, { count: 1, reset: now + windowMs })
      return next()
    }
    entry.count += 1
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000))
      return next(tooMany())
    }
    next()
  }
}

/** Per-identifier login throttling backed by the database. */
export function tooManyRecentFailures(identifier, ip) {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const row = get(
    `SELECT COUNT(*) AS total FROM login_attempts
     WHERE success = 0 AND created_at >= ? AND (identifier = ? OR ip_address = ?)`,
    [since, identifier, ip],
  )
  return Number(row?.total || 0) >= 8
}

export function recordLoginAttempt(identifier, ip, success) {
  run(`INSERT INTO login_attempts (identifier, ip_address, success) VALUES (?, ?, ?)`, [
    identifier,
    ip,
    success ? 1 : 0,
  ])
}

/** Load every active role assignment for a user (expired/revoked ignored). */
export function activeAssignments(userId) {
  return all(
    `SELECT ura.id, ura.scope_type, ura.municipality_id, ura.expires_at, r.slug AS role_slug, r.name AS role_name
     FROM user_role_assignments ura
     JOIN user_roles r ON r.id = ura.role_id
     WHERE ura.user_id = ?
       AND ura.status = 'active'
       AND ura.revoked_at IS NULL
       AND (ura.expires_at IS NULL OR datetime(ura.expires_at) > datetime('now'))`,
    [userId],
  )
}
