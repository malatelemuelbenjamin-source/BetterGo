import { all, get } from './db.js'
import { activeAssignments } from './auth.js'
import { forbidden, unauthorized } from './lib/http.js'

export const ROLES = {
  CITIZEN: 'citizen',
  EMPLOYEE: 'government_employee',
  MUNICIPAL_ADMIN: 'municipal_admin',
  MUNICIPAL_CONTENT_EDITOR: 'municipal_content_editor',
  MUNICIPAL_REVIEWER: 'municipal_reviewer',
  PROVINCIAL_ADMIN: 'provincial_admin',
  CONTENT_EDITOR: 'content_editor',
  SUPER_ADMIN: 'super_admin',
}

/** Roles that can reach the administrative dashboard at all. */
export const ADMIN_ROLES = [
  ROLES.EMPLOYEE,
  ROLES.MUNICIPAL_ADMIN,
  ROLES.MUNICIPAL_CONTENT_EDITOR,
  ROLES.MUNICIPAL_REVIEWER,
  ROLES.PROVINCIAL_ADMIN,
  ROLES.CONTENT_EDITOR,
  ROLES.SUPER_ADMIN,
]

const ROLE_RANK = {
  citizen: 1,
  content_editor: 2,
  government_employee: 2,
  municipal_content_editor: 2,
  municipal_reviewer: 2,
  municipal_admin: 3,
  provincial_admin: 4,
  super_admin: 5,
}

// Short-lived cache so authorisation stays cheap without surviving a revocation
// for longer than a few seconds. Cleared explicitly on every role/permission write.
const cache = new Map()
const CACHE_TTL_MS = 15_000

export function invalidateAuthCache(userId) {
  if (userId === undefined) cache.clear()
  else cache.delete(Number(userId))
}

/** Build the authorisation context for a user: roles, scopes and permissions. */
export function authContext(user) {
  if (!user) return null
  const cached = cache.get(Number(user.id))
  if (cached && cached.expires > Date.now()) return cached.context

  const assignments = activeAssignments(user.id)
  const roleSlugs = [...new Set(assignments.map((a) => a.role_slug))]
  const permissions = new Set(
    all(
      `SELECT DISTINCT p.slug
       FROM user_role_assignments ura
       JOIN role_permissions rp ON rp.role_id = ura.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ura.user_id = ?
         AND ura.status = 'active'
         AND ura.revoked_at IS NULL
         AND (ura.expires_at IS NULL OR datetime(ura.expires_at) > datetime('now'))`,
      [user.id],
    ).map((row) => row.slug),
  )

  const context = {
    id: user.id,
    email: user.email,
    name: user.name,
    accountStatus: user.account_status,
    emailVerified: Boolean(user.email_verified_at),
    assignments,
    roles: roleSlugs,
    permissions,
    isAdmin: roleSlugs.some((slug) => ADMIN_ROLES.includes(slug)),
    isSuperAdmin: roleSlugs.includes(ROLES.SUPER_ADMIN),
    // Global scope: province-wide roles and super admins.
    hasGlobalScope: roleSlugs.some((slug) => [ROLES.PROVINCIAL_ADMIN, ROLES.SUPER_ADMIN].includes(slug)),
    municipalityIds: [
      ...new Set(assignments.filter((a) => a.municipality_id).map((a) => Number(a.municipality_id))),
    ],
  }
  cache.set(Number(user.id), { context, expires: Date.now() + CACHE_TTL_MS })
  return context
}

export const ctx = (req) => authContext(req.user)

export function hasPermission(context, permission) {
  if (!context) return false
  return context.permissions.has(permission)
}

export function hasAnyPermission(context, permissions) {
  return permissions.some((permission) => hasPermission(context, permission))
}

/** Middleware: requires an authenticated user with the given permission. */
export function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized())
    const context = ctx(req)
    if (!hasAnyPermission(context, permissions)) return next(forbidden())
    next()
  }
}

/** Middleware: requires one of the administrative roles (any permission level). */
export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized())
  if (!ctx(req).isAdmin) return next(forbidden())
  next()
}

export function isAdmin(context) {
  return Boolean(context?.isAdmin)
}

export function roleRank(roleSlug) {
  return ROLE_RANK[roleSlug] || 0
}

/**
 * Municipality scope check. Global-scope users may act anywhere; scoped users
 * only within their assigned municipalities. A null municipality id means
 * province-wide content and therefore requires global scope.
 */
export function canUseMunicipality(context, municipalityId) {
  if (!context) return false
  if (context.hasGlobalScope) return true
  if (municipalityId === null || municipalityId === undefined) return false
  if (context.municipalityIds.length === 0) return false
  return context.municipalityIds.includes(Number(municipalityId))
}

/** True when the user may read provincial content (global scope or admin). */
export function canReadProvinceWide(context) {
  return Boolean(context?.hasGlobalScope || context?.isAdmin)
}

/** Restrict a query's municipality filter to what the user may see. */
export function scopedMunicipalityFilter(context, requestedId) {
  if (context?.hasGlobalScope) return requestedId ? Number(requestedId) : null
  if (requestedId && context?.municipalityIds.includes(Number(requestedId))) return Number(requestedId)
  if (context?.municipalityIds.length === 1) return context.municipalityIds[0]
  return null
}

/** Number of active super administrators (used to protect the last one). */
export function superAdminCount() {
  const row = get(
    `SELECT COUNT(DISTINCT ura.user_id) AS total
     FROM user_role_assignments ura
     JOIN user_roles r ON r.id = ura.role_id
     WHERE r.slug = 'super_admin' AND ura.status = 'active' AND ura.revoked_at IS NULL
       AND (ura.expires_at IS NULL OR datetime(ura.expires_at) > datetime('now'))`,
  )
  return Number(row?.total || 0)
}

/** All permissions grouped by module, for the admin permission screens. */
export function permissionGroups() {
  const rows = all(`SELECT * FROM permissions ORDER BY module, slug`)
  const groups = new Map()
  for (const row of rows) {
    if (!groups.has(row.module)) groups.set(row.module, [])
    groups.get(row.module).push(row)
  }
  return [...groups.entries()].map(([module, items]) => ({ module, items }))
}
