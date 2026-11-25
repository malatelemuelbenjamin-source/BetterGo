import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { requireAdmin, requirePermission } from '../rbac.js'
import { ctx, canUseMunicipality, hasPermission, invalidateAuthCache, permissionGroups, superAdminCount } from '../rbac.js'
import { asyncHandler, badRequest, cleanText, forbidden, notFound, paginated, pagination, safeUrl, uniqueSlug, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { env } from '../env.js'
import { hashPassword, passwordIssues } from '../auth.js'

export const adminRouter = Router()
adminRouter.use(requireAdmin)

const ADMIN_ROLE_SLUGS = ['government_employee', 'municipal_admin', 'provincial_admin', 'content_editor', 'super_admin']

// ---------------------------------------------------------------------------
// Overview & analytics
// ---------------------------------------------------------------------------
adminRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const scope = context.hasGlobalScope ? null : context.municipalityIds
    const municipalityClause = (column = 'municipality_id') =>
      scope && scope.length
        ? ` AND (${column} IN (${scope.map(() => '?').join(',')}) OR ${column} IS NULL)`
        : scope
          ? ' AND 1 = 0'
          : ''
    // Strict scope: rows that belong to the assigned municipality only. Used for
    // people and submissions, which are never shared across towns.
    const localClause = (column = 'municipality_id') =>
      scope && scope.length ? ` AND ${column} IN (${scope.map(() => '?').join(',')})` : scope ? ' AND 1 = 0' : ''
    const scopeParams = scope && scope.length ? scope : []
    const userClause = scope && scope.length ? localClause('p.municipality_id') : scope ? ' AND 1 = 0' : ''

    const count = (sql, params = []) => Number(get(sql, params)?.total || 0)
    const countUsers = (extra) =>
      count(
        `SELECT COUNT(*) AS total FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE u.deleted_at IS NULL${extra}${userClause}`,
        scopeParams,
      )

    res.json({
      scope: context.hasGlobalScope ? 'province' : context.municipalityIds,
      scopeInfo: {
        provinceWide: context.hasGlobalScope,
        municipalityIds: context.municipalityIds,
        municipalityNames: context.hasGlobalScope
          ? []
          : all(
              `SELECT name FROM municipalities WHERE id IN (${context.municipalityIds.map(() => '?').join(',') || 'NULL'}) ORDER BY sort_order`,
              context.municipalityIds,
            ).map((row) => row.name),
      },
      cards: {
        users: countUsers(''),
        activeUsers: countUsers(` AND u.account_status = 'active'`),
        suspendedUsers: countUsers(` AND u.account_status = 'suspended'`),
        unverifiedUsers: countUsers(' AND u.email_verified_at IS NULL'),
        publishedAnnouncements: count(
          `SELECT COUNT(*) AS total FROM announcements WHERE publication_status='published'${municipalityClause()}`,
          scopeParams,
        ),
        draftAnnouncements: count(
          `SELECT COUNT(*) AS total FROM announcements WHERE publication_status IN ('draft','submitted_for_review','under_review','changes_requested')${municipalityClause()}`,
          scopeParams,
        ),
        publishedServices: count(
          `SELECT COUNT(*) AS total FROM government_services WHERE publication_status='published'${municipalityClause()}`,
          scopeParams,
        ),
        offices: count(
          `SELECT COUNT(*) AS total FROM government_offices WHERE publication_status='published'${municipalityClause()}`,
          scopeParams,
        ),
        municipalities: count(
          `SELECT COUNT(*) AS total FROM municipalities WHERE is_active = 1${scope && scope.length ? ` AND id IN (${scope.map(() => '?').join(',')})` : scope ? ' AND 1 = 0' : ''}`,
          scopeParams,
        ),
        pendingSubmissions: count(
          `SELECT COUNT(*) AS total FROM citizen_reports WHERE status = 'submitted'${localClause()}`,
          scopeParams,
        ),
        // Corrections and data requests carry no municipality, so scoped staff
        // are not shown province-wide totals they cannot act on.
        pendingCorrections: scope ? 0 : count(`SELECT COUNT(*) AS total FROM correction_reports WHERE status = 'submitted'`),
        pendingDataRequests: scope ? 0 : count(`SELECT COUNT(*) AS total FROM data_requests WHERE status = 'submitted'`),
        transparencyRecords: count(
          `SELECT COUNT(*) AS total FROM transparency_records WHERE publication_status='published'${municipalityClause()}`,
          scopeParams,
        ),
        emergencyContacts: count(
          `SELECT COUNT(*) AS total FROM emergency_contacts WHERE publication_status='published'${municipalityClause()}`,
          scopeParams,
        ),
        publishedDocuments: count(
          `SELECT COUNT(*) AS total FROM public_documents WHERE publication_status='published'${municipalityClause()}`,
          scopeParams,
        ),
      },
      recentAudit: all(
        `SELECT a.id, a.action, a.module, a.created_at, a.result, u.name AS actor
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         ${hasPermission(context, 'audit_logs.view') ? '' : 'WHERE a.user_id = ' + Number(req.user.id)}
         ORDER BY a.id DESC LIMIT 10`,
      ),
      workflowQueue: all(
        `SELECT 'announcement' AS type, id, title, publication_status, updated_at FROM announcements
         WHERE publication_status IN ('submitted_for_review','under_review','changes_requested')${localClause()}
         UNION ALL
         SELECT 'service', id, title, publication_status, updated_at FROM government_services
         WHERE publication_status IN ('submitted_for_review','under_review','changes_requested')${localClause()}
         ORDER BY updated_at DESC LIMIT 10`,
        [...scopeParams, ...scopeParams],
      ),
      contentByMunicipality: all(
        `SELECT m.name, m.slug,
           (SELECT COUNT(*) FROM announcements a WHERE a.municipality_id = m.id AND a.publication_status='published') AS announcements,
           (SELECT COUNT(*) FROM government_services s WHERE s.municipality_id = m.id AND s.publication_status='published') AS services,
           (SELECT COUNT(*) FROM government_offices o WHERE o.municipality_id = m.id AND o.publication_status='published') AS offices
         FROM municipalities m WHERE m.is_active = 1${scope && scope.length ? ` AND m.id IN (${scope.map(() => '?').join(',')})` : scope ? ' AND 1 = 0' : ''}
         ORDER BY m.sort_order`,
        scopeParams,
      ),
    })
  }),
)

adminRouter.get(
  '/analytics',
  requirePermission('province.analytics.view', 'municipality_analytics.view'),
  asyncHandler(async (req, res) => {
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 30))
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    res.json({
      period: { days, since },
      registrations: all(
        `SELECT date(created_at) AS day, COUNT(*) AS total FROM users WHERE created_at >= ? GROUP BY day ORDER BY day`,
        [since],
      ),
      announcementsPublished: all(
        `SELECT date(published_at) AS day, COUNT(*) AS total FROM announcements
         WHERE published_at >= ? AND publication_status='published' GROUP BY day ORDER BY day`,
        [since],
      ),
      reportsByStatus: all(`SELECT status, COUNT(*) AS total FROM citizen_reports GROUP BY status`),
      servicesByCategory: all(
        `SELECT c.name, COUNT(s.id) AS total FROM service_categories c
         LEFT JOIN government_services s ON s.category_id = c.id AND s.publication_status='published'
         GROUP BY c.id ORDER BY total DESC`,
      ),
      verification: all(
        `SELECT verification_status, COUNT(*) AS total FROM government_services GROUP BY verification_status
         UNION ALL SELECT 'offices_' || verification_status, COUNT(*) FROM government_offices GROUP BY verification_status`,
      ),
      note: 'Metrics are calculated from published records only. Incomplete records are not presented as province-wide statistics.',
    })
  }),
)

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
adminRouter.get(
  '/users',
  requirePermission('users.view'),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const { page, limit, offset } = pagination(req.query)
    const params = []
    let where = `u.deleted_at IS NULL`
    if (req.query.q) {
      where += ` AND (lower(u.name) LIKE ? OR lower(u.email) LIKE ?)`
      params.push(`%${String(req.query.q).toLowerCase()}%`, `%${String(req.query.q).toLowerCase()}%`)
    }
    if (req.query.status) {
      where += ` AND u.account_status = ?`
      params.push(String(req.query.status))
    }
    if (req.query.verified === 'true') where += ` AND u.email_verified_at IS NOT NULL`
    if (req.query.municipality) {
      where += ` AND p.municipality_id = (SELECT id FROM municipalities WHERE slug = ?)`
      params.push(String(req.query.municipality))
    }
    if (req.query.role) {
      where += ` AND EXISTS (SELECT 1 FROM user_role_assignments ura JOIN user_roles r ON r.id = ura.role_id
        WHERE ura.user_id = u.id AND r.slug = ? AND ura.status='active' AND ura.revoked_at IS NULL)`
      params.push(String(req.query.role))
    }
    if (!context.hasGlobalScope) {
      if (context.municipalityIds.length === 0) {
        where += ` AND 1 = 0`
      } else {
        where += ` AND p.municipality_id IN (${context.municipalityIds.map(() => '?').join(',')})`
        params.push(...context.municipalityIds)
      }
    }
    const base = `FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id LEFT JOIN municipalities m ON m.id = p.municipality_id`
    const total = Number(get(`SELECT COUNT(*) AS total ${base} WHERE ${where}`, params).total)
    const results = all(
      `SELECT u.id, u.name, u.email, u.phone, u.account_status, u.email_verified_at, u.created_at, u.last_login_at,
              m.name AS municipality_name,
              (SELECT group_concat(r.slug) FROM user_role_assignments ura JOIN user_roles r ON r.id = ura.role_id
                WHERE ura.user_id = u.id AND ura.status='active' AND ura.revoked_at IS NULL) AS roles
       ${base} WHERE ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    res.json(paginated(results, total, page, limit))
  }),
)

adminRouter.get(
  '/users/:id',
  requirePermission('users.view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const context = ctx(req)
    const user = get(
      `SELECT u.id, u.name, u.email, u.phone, u.account_status, u.email_verified_at, u.created_at, u.last_login_at,
              p.first_name, p.middle_name, p.last_name, p.suffix, p.municipality_id, p.address, p.profile_photo,
              m.name AS municipality_name
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id LEFT JOIN municipalities m ON m.id = p.municipality_id
       WHERE u.id = ? AND u.deleted_at IS NULL`,
      [id],
    )
    if (!user) throw notFound('User not found.')
    if (!context.hasGlobalScope && (!user.municipality_id || !context.municipalityIds.includes(Number(user.municipality_id)))) {
      throw notFound('User not found.')
    }
    res.json({
      user,
      // Deliberately excludes password hashes, tokens and sessions.
      roles: all(
        `SELECT ura.id, r.name, r.slug, ura.scope_type, ura.municipality_id, ura.assigned_at, ura.expires_at, ura.status,
                m.name AS municipality_name
         FROM user_role_assignments ura JOIN user_roles r ON r.id = ura.role_id
         LEFT JOIN municipalities m ON m.id = ura.municipality_id
         WHERE ura.user_id = ? ORDER BY ura.id DESC`,
        [id],
      ),
      activity: all(`SELECT action, module, created_at, result FROM audit_logs WHERE user_id = ? ORDER BY id DESC LIMIT 20`, [id]),
    })
  }),
)

adminRouter.post(
  '/users/:id/status',
  requirePermission('users.suspend', 'users.activate'),
  validate(z.object({ status: z.enum(['active', 'suspended', 'disabled', 'pending_verification']), reason: z.string().trim().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const target = get(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL`, [id])
    if (!target) throw notFound('User not found.')
    if (id === req.user.id) throw forbidden('You cannot change the status of your own account from this screen.')
    const context = ctx(req)
    if (!context.isSuperAdmin) {
      const targetRoles = all(
        `SELECT r.slug FROM user_role_assignments ura JOIN user_roles r ON r.id = ura.role_id
         WHERE ura.user_id = ? AND ura.status='active' AND ura.revoked_at IS NULL`,
        [id],
      ).map((r) => r.slug)
      if (targetRoles.includes('super_admin') || targetRoles.includes('provincial_admin')) {
        throw forbidden('Only a super administrator may change the status of a privileged account.')
      }
    }
    run(`UPDATE users SET account_status = ?, updated_at = ? WHERE id = ?`, [req.body.status, nowIso(), id])
    invalidateAuthCache(id)
    logAudit(req, {
      action: 'users.status_changed',
      module: 'users',
      entityType: 'user',
      entityId: id,
      oldValues: { status: target.account_status },
      newValues: { status: req.body.status, reason: req.body.reason || null },
    })
    res.json({ message: `Account status set to ${req.body.status}.` })
  }),
)

adminRouter.patch(
  '/users/:id',
  requirePermission('users.update'),
  validate(
    z.object({
      firstName: z.string().trim().max(80).optional(),
      lastName: z.string().trim().max(80).optional(),
      phone: z.string().trim().max(30).optional(),
      municipalityId: z.coerce.number().int().positive().nullable().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const target = get(`SELECT u.*, p.municipality_id FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id = ?`, [id])
    if (!target) throw notFound('User not found.')
    const context = ctx(req)
    if (!context.hasGlobalScope && !canUseMunicipality(context, target.municipality_id)) {
      throw forbidden('This account is outside your assigned scope.')
    }
    const d = req.body
    if (d.firstName || d.lastName) {
      run(`UPDATE user_profiles SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), updated_at = ? WHERE user_id = ?`, [
        d.firstName || null,
        d.lastName || null,
        nowIso(),
        id,
      ])
      const profile = get(`SELECT first_name, middle_name, last_name FROM user_profiles WHERE user_id = ?`, [id])
      run(`UPDATE users SET name = ?, updated_at = ? WHERE id = ?`, [
        [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(' '),
        nowIso(),
        id,
      ])
    }
    if (d.phone !== undefined) run(`UPDATE users SET phone = ?, updated_at = ? WHERE id = ?`, [d.phone || null, nowIso(), id])
    if (d.municipalityId !== undefined) {
      if (d.municipalityId && !canUseMunicipality(context, d.municipalityId)) throw forbidden('Outside your assigned scope.')
      run(`UPDATE user_profiles SET municipality_id = ?, updated_at = ? WHERE user_id = ?`, [d.municipalityId || null, nowIso(), id])
    }
    logAudit(req, { action: 'users.updated', module: 'users', entityType: 'user', entityId: id, newValues: d })
    res.json({ message: 'Account details updated.' })
  }),
)

adminRouter.post(
  '/users/:id/roles',
  requirePermission('users.assign_roles', 'roles.assign'),
  validate(
    z.object({
      roleSlug: z.string().trim().min(1, 'Select a role.'),
      municipalityId: z.coerce.number().int().positive().nullable().optional(),
      expiresAt: z.string().trim().max(40).optional().or(z.literal('')),
      reason: z.string().trim().max(500).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const target = get(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL`, [id])
    if (!target) throw notFound('User not found.')
    const context = ctx(req)
    const role = get(`SELECT * FROM user_roles WHERE slug = ?`, [req.body.roleSlug])
    if (!role) throw notFound('Role not found.')
    if (role.slug === 'super_admin' && !context.isSuperAdmin) {
      throw forbidden('Only a super administrator may assign the super administrator role.')
    }
    if (role.slug === 'provincial_admin' && !context.isSuperAdmin) {
      throw forbidden('Only a super administrator may assign the provincial administrator role.')
    }
    if (!context.isSuperAdmin && !hasPermission(context, 'roles.assign') && !hasPermission(context, 'users.assign_roles')) {
      throw forbidden()
    }
    const municipalityId = req.body.municipalityId ? Number(req.body.municipalityId) : null
    if (role.slug === 'municipal_admin') {
      if (!municipalityId) throw badRequest('Municipal administrator assignments require a municipality.')
      if (!canUseMunicipality(context, municipalityId)) throw forbidden('You cannot assign a role outside your municipality scope.')
    } else if (!context.hasGlobalScope && role.slug !== 'citizen') {
      throw forbidden('Scoped administrators may only assign municipal-scoped roles.')
    }
    const existing = get(
      `SELECT id FROM user_role_assignments WHERE user_id = ? AND role_id = ? AND status='active'
        AND COALESCE(municipality_id, 0) = COALESCE(?, 0)`,
      [id, role.id, municipalityId],
    )
    if (existing) throw badRequest('That role is already assigned with the same scope.')
    const result = run(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type, municipality_id, assigned_by, expires_at, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
      [id, role.id, municipalityId ? 'municipality' : 'global', municipalityId, req.user.id, req.body.expiresAt || null, req.body.reason || null],
    )
    invalidateAuthCache(id)
    logAudit(req, {
      action: 'roles.assigned',
      module: 'roles',
      entityType: 'user',
      entityId: id,
      newValues: { role: role.slug, municipalityId, reason: req.body.reason || null },
    })
    run(`INSERT INTO notifications (user_id, title, message, notification_type) VALUES (?, ?, ?, 'account')`, [
      id,
      'Your account permissions changed',
      `The role ${role.name} was assigned to your account${municipalityId ? ' for a specific municipality' : ''}.`,
    ])
    res.status(201).json({ message: 'Role assigned.', assignmentId: Number(result.lastInsertRowid) })
  }),
)

adminRouter.delete(
  '/users/:id/roles/:assignmentId',
  requirePermission('users.assign_roles', 'roles.revoke'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const assignment = get(
      `SELECT ura.*, r.slug FROM user_role_assignments ura JOIN user_roles r ON r.id = ura.role_id WHERE ura.id = ? AND ura.user_id = ?`,
      [Number(req.params.assignmentId), id],
    )
    if (!assignment) throw notFound('Role assignment not found.')
    const context = ctx(req)
    if (assignment.slug === 'super_admin' && !context.isSuperAdmin) throw forbidden('Only a super administrator may revoke this role.')
    if (assignment.slug === 'provincial_admin' && !context.isSuperAdmin) {
      throw forbidden('Only a super administrator may revoke this role.')
    }
    if (assignment.slug === 'super_admin' && superAdminCount() <= 1) {
      throw forbidden('The last super administrator cannot be removed. Assign another super administrator first.')
    }
    if (id === req.user.id && assignment.slug === 'super_admin') {
      throw forbidden('Removing your own super administrator role could lock the platform. Ask another super administrator.')
    }
    run(`UPDATE user_role_assignments SET status='revoked', revoked_at=? WHERE id=?`, [nowIso(), assignment.id])
    invalidateAuthCache(id)
    logAudit(req, {
      action: 'roles.revoked',
      module: 'roles',
      entityType: 'user',
      entityId: id,
      oldValues: { role: assignment.slug },
    })
    res.json({ message: 'Role revoked. Permissions take effect immediately.' })
  }),
)

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------
adminRouter.get(
  '/roles',
  requirePermission('roles.view', 'permissions.view'),
  asyncHandler(async (req, res) => {
    res.json({
      results: all(
        `SELECT r.*, (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
                (SELECT COUNT(*) FROM user_role_assignments ura WHERE ura.role_id = r.id AND ura.status='active' AND ura.revoked_at IS NULL) AS user_count
         FROM user_roles r ORDER BY r.id`,
      ),
      groups: permissionGroups(),
    })
  }),
)

adminRouter.get(
  '/roles/:id/permissions',
  requirePermission('roles.view', 'permissions.view'),
  asyncHandler(async (req, res) => {
    const role = get(`SELECT * FROM user_roles WHERE id = ?`, [Number(req.params.id)])
    if (!role) throw notFound('Role not found.')
    res.json({
      role: { id: role.id, slug: role.slug, name: role.name },
      permissionSlugs: all(
        `SELECT p.slug FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? ORDER BY p.slug`,
        [role.id],
      ).map((row) => row.slug),
    })
  }),
)

adminRouter.put(
  '/roles/:id/permissions',
  requirePermission('permissions.manage'),
  validate(z.object({ permissionSlugs: z.array(z.string()).max(200) })),
  asyncHandler(async (req, res) => {
    const role = get(`SELECT * FROM user_roles WHERE id = ?`, [Number(req.params.id)])
    if (!role) throw notFound('Role not found.')
    if (role.slug === 'super_admin') throw forbidden('System owner permissions cannot be reduced through this screen.')
    const before = all(`SELECT p.slug FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`, [role.id]).map((r) => r.slug)
    run(`DELETE FROM role_permissions WHERE role_id = ?`, [role.id])
    for (const slug of req.body.permissionSlugs) {
      const permission = get(`SELECT id FROM permissions WHERE slug = ?`, [slug])
      if (permission) run(`INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [role.id, permission.id])
    }
    invalidateAuthCache()
    logAudit(req, {
      action: 'permissions.updated',
      module: 'roles',
      entityType: 'role',
      entityId: role.id,
      oldValues: { permissions: before },
      newValues: { permissions: req.body.permissionSlugs },
    })
    res.json({ message: 'Role permissions updated. Affected users lose removed permissions immediately.' })
  }),
)

adminRouter.get(
  '/permissions',
  requirePermission('permissions.view'),
  asyncHandler(async (_req, res) => {
    res.json({ groups: permissionGroups(), total: Number(get(`SELECT COUNT(*) AS t FROM permissions`).t) })
  }),
)

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------
adminRouter.get(
  '/audit-logs',
  requirePermission('audit_logs.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query)
    const params = []
    let where = '1 = 1'
    if (req.query.q) {
      where += ` AND (lower(a.action) LIKE ? OR lower(COALESCE(a.module,'')) LIKE ?)`
      params.push(`%${String(req.query.q).toLowerCase()}%`, `%${String(req.query.q).toLowerCase()}%`)
    }
    if (req.query.module) {
      where += ` AND a.module = ?`
      params.push(String(req.query.module))
    }
    if (req.query.actor) {
      where += ` AND a.user_id = ?`
      params.push(Number(req.query.actor))
    }
    if (req.query.from) {
      where += ` AND a.created_at >= ?`
      params.push(String(req.query.from))
    }
    if (req.query.to) {
      where += ` AND a.created_at <= ?`
      params.push(String(req.query.to))
    }
    const total = Number(get(`SELECT COUNT(*) AS total FROM audit_logs a WHERE ${where}`, params).total)
    const results = all(
      `SELECT a.id, a.action, a.module, a.entity_type, a.entity_id, a.result, a.created_at, a.ip_address,
              u.name AS actor, u.email AS actor_email
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    res.json({ ...paginated(results, total, page, limit), readOnly: true })
  }),
)

adminRouter.get(
  '/audit-logs/export',
  requirePermission('audit_logs.export'),
  asyncHandler(async (req, res) => {
    const rows = all(
      `SELECT a.id, a.created_at, a.action, a.module, a.entity_type, a.entity_id, a.result, u.email AS actor
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 5000`,
    )
    const header = 'id,created_at,action,module,entity_type,entity_id,result,actor\n'
    const csv = rows
      .map((r) => [r.id, r.created_at, r.action, r.module, r.entity_type ?? '', r.entity_id ?? '', r.result, r.actor ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    logAudit(req, { action: 'audit_logs.exported', module: 'audit', entityType: 'audit_logs' })
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="bettergo-audit-logs.csv"')
    res.send(header + csv)
  }),
)

// ---------------------------------------------------------------------------
// System settings
// ---------------------------------------------------------------------------
adminRouter.get(
  '/settings',
  requirePermission('settings.manage', 'province.settings.manage'),
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(
        `SELECT s.*, u.name AS updated_by_name FROM system_settings s LEFT JOIN users u ON u.id = s.updated_by ORDER BY s.setting_group, s.setting_key`,
      ),
    })
  }),
)

const SETTING_TYPES = ['string', 'number', 'boolean', 'json']

adminRouter.put(
  '/settings',
  requirePermission('settings.manage'),
  validate(
    z.object({
      settings: z
        .array(
          z.object({
            key: z.string().trim().min(1).max(120),
            value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
          }),
        )
        .min(1)
        .max(100),
    }),
  ),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    if (!context.isSuperAdmin && !hasPermission(context, 'province.settings.manage')) {
      throw forbidden('Province-wide settings require provincial administrator permission.')
    }
    const changed = []
    for (const item of req.body.settings) {
      const existing = get(`SELECT * FROM system_settings WHERE setting_key = ?`, [item.key])
      if (!existing) continue
      if (!SETTING_TYPES.includes(existing.setting_type)) continue
      let value = item.value === null ? '' : String(item.value)
      if (existing.setting_type === 'number' && value !== '' && !Number.isFinite(Number(value))) {
        throw unprocessable(`Setting ${item.key} must be a number.`, [{ field: item.key, message: 'Not a number.' }])
      }
      if (existing.setting_type === 'boolean' && !['true', 'false', ''].includes(value)) {
        throw unprocessable(`Setting ${item.key} must be true or false.`, [{ field: item.key, message: 'Invalid boolean.' }])
      }
      if (!['brand.logo_url', 'platform.domain', 'platform.contact_email'].includes(item.key) && /[<>]/.test(value)) {
        throw unprocessable('Settings cannot contain HTML tags.', [{ field: item.key, message: 'Unsafe characters.' }])
      }
      run(`UPDATE system_settings SET setting_value = ?, updated_by = ?, updated_at = ? WHERE id = ?`, [
        value,
        req.user.id,
        nowIso(),
        existing.id,
      ])
      changed.push({ key: item.key, from: existing.setting_value, to: value })
    }
    logAudit(req, { action: 'settings.updated', module: 'settings', entityType: 'system_settings', newValues: changed })
    res.json({ message: `${changed.length} setting(s) saved.`, changed })
  }),
)

// ---------------------------------------------------------------------------
// Citizen submissions, corrections, privacy
// ---------------------------------------------------------------------------
adminRouter.get(
  '/reports',
  requirePermission('reports.view'),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const { page, limit, offset } = pagination(req.query)
    const params = []
    let where = '1 = 1'
    if (req.query.status) {
      where += ` AND r.status = ?`
      params.push(String(req.query.status))
    }
    if (req.query.municipality) {
      where += ` AND r.municipality_id = (SELECT id FROM municipalities WHERE slug = ?)`
      params.push(String(req.query.municipality))
    }
    if (!context.hasGlobalScope) {
      if (context.municipalityIds.length === 0) where += ` AND 1 = 0`
      else {
        where += ` AND r.municipality_id IN (${context.municipalityIds.map(() => '?').join(',')})`
        params.push(...context.municipalityIds)
      }
    }
    const total = Number(get(`SELECT COUNT(*) AS total FROM citizen_reports r WHERE ${where}`, params).total)
    const results = all(
      `SELECT r.*, m.name AS municipality_name, u.name AS submitter
       FROM citizen_reports r LEFT JOIN municipalities m ON m.id = r.municipality_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    res.json(paginated(results, total, page, limit))
  }),
)

adminRouter.patch(
  '/reports/:id',
  requirePermission('reports.review', 'reports.resolve'),
  validate(
    z.object({
      status: z.enum(['submitted', 'under_review', 'assigned', 'resolved', 'archived']).optional(),
      assignedTo: z.coerce.number().int().positive().nullable().optional(),
      internalNotes: z.string().trim().max(4000).optional(),
      resolution: z.string().trim().max(2000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const report = get(`SELECT * FROM citizen_reports WHERE id = ?`, [Number(req.params.id)])
    if (!report) throw notFound('Report not found.')
    const context = ctx(req)
    if (!context.hasGlobalScope && !canUseMunicipality(context, report.municipality_id)) {
      throw forbidden('This report is outside your assigned scope.')
    }
    const sets = []
    const params = []
    if (req.body.status) {
      sets.push('status = ?')
      params.push(req.body.status)
    }
    if (req.body.assignedTo !== undefined) {
      sets.push('assigned_to = ?')
      params.push(req.body.assignedTo)
    }
    if (req.body.internalNotes !== undefined) {
      sets.push('internal_notes = ?')
      params.push(cleanText(req.body.internalNotes, 4000))
    }
    if (req.body.resolution !== undefined) {
      sets.push('resolution = ?')
      params.push(cleanText(req.body.resolution, 2000))
    }
    sets.push('updated_at = ?')
    params.push(nowIso())
    run(`UPDATE citizen_reports SET ${sets.join(', ')} WHERE id = ?`, [...params, report.id])
    if (report.user_id && req.body.status) {
      run(`INSERT INTO notifications (user_id, title, message, notification_type, related_entity_type, related_entity_id)
           VALUES (?, ?, ?, 'report', 'citizen_report', ?)`, [
        report.user_id,
        'Your submission was updated',
        `Reference ${report.reference} is now marked "${req.body.status.replace('_', ' ')}".`,
        report.id,
      ])
    }
    logAudit(req, {
      action: 'reports.updated',
      module: 'reports',
      entityType: 'citizen_report',
      entityId: report.id,
      oldValues: { status: report.status },
      newValues: { status: req.body.status || report.status },
    })
    res.json({ message: 'Report updated.', record: get(`SELECT * FROM citizen_reports WHERE id = ?`, [report.id]) })
  }),
)

adminRouter.get(
  '/corrections',
  requirePermission('directory.update', 'content.update'),
  asyncHandler(async (req, res) => {
    res.json({
      results: all(`SELECT * FROM correction_reports ORDER BY id DESC LIMIT 200`),
    })
  }),
)

adminRouter.patch(
  '/corrections/:id',
  requirePermission('directory.update', 'content.update'),
  validate(z.object({ status: z.enum(['submitted', 'under_review', 'resolved', 'rejected']), notes: z.string().trim().max(2000).optional() })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM correction_reports WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Correction report not found.')
    run(`UPDATE correction_reports SET status = ?, notes = ?, resolved_at = ? WHERE id = ?`, [
      req.body.status,
      cleanText(req.body.notes, 2000),
      req.body.status === 'resolved' || req.body.status === 'rejected' ? nowIso() : null,
      row.id,
    ])
    logAudit(req, { action: 'corrections.updated', module: 'directory', entityType: 'correction_report', entityId: row.id, newValues: { status: req.body.status } })
    res.json({ message: 'Correction report updated. Corrections are never published automatically.' })
  }),
)

adminRouter.get(
  '/data-requests',
  requirePermission('privacy.requests.manage'),
  asyncHandler(async (req, res) => {
    res.json({
      results: all(
        `SELECT d.*, u.name AS account_name FROM data_requests d LEFT JOIN users u ON u.id = d.user_id ORDER BY d.id DESC LIMIT 200`,
      ),
    })
  }),
)

adminRouter.patch(
  '/data-requests/:id',
  requirePermission('privacy.requests.manage'),
  validate(
    z.object({
      status: z.enum(['submitted', 'under_review', 'awaiting_verification', 'awaiting_clarification', 'approved', 'partially_approved', 'rejected', 'completed', 'closed']),
      reviewNotes: z.string().trim().max(3000).optional(),
      resolution: z.string().trim().max(3000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM data_requests WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Request not found.')
    run(
      `UPDATE data_requests SET status=?, review_notes=COALESCE(?, review_notes), resolution=COALESCE(?, resolution),
        assigned_to=COALESCE(assigned_to, ?), updated_at=?, resolved_at=? WHERE id=?`,
      [
        req.body.status,
        cleanText(req.body.reviewNotes, 3000),
        cleanText(req.body.resolution, 3000),
        req.user.id,
        nowIso(),
        ['completed', 'closed', 'rejected'].includes(req.body.status) ? nowIso() : null,
        row.id,
      ],
    )
    if (row.user_id) {
      run(`INSERT INTO notifications (user_id, title, message, notification_type) VALUES (?, ?, ?, 'privacy')`, [
        row.user_id,
        `Privacy request ${row.reference} updated`,
        `Your request is now marked "${req.body.status.replace(/_/g, ' ')}".`,
      ])
    }
    logAudit(req, { action: 'privacy.request_updated', module: 'privacy', entityType: 'data_request', entityId: row.id, newValues: { status: req.body.status } })
    res.json({ message: 'Request updated.' })
  }),
)

adminRouter.get(
  '/privacy-incidents',
  requirePermission('privacy.incidents.manage'),
  asyncHandler(async (_req, res) => {
    res.json({ results: all(`SELECT * FROM privacy_incidents ORDER BY id DESC`) })
  }),
)

adminRouter.post(
  '/privacy-incidents',
  requirePermission('privacy.incidents.manage'),
  validate(
    z.object({
      description: z.string().trim().min(10).max(4000),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
    }),
  ),
  asyncHandler(async (req, res) => {
    const ref = `BGINC-${Date.now().toString(36).toUpperCase()}`
    run(`INSERT INTO privacy_incidents (reference, description, severity) VALUES (?, ?, ?)`, [
      ref,
      cleanText(req.body.description, 4000),
      req.body.severity,
    ])
    logAudit(req, { action: 'privacy.incident_reported', module: 'privacy', entityType: 'privacy_incident', entityId: ref })
    res.status(201).json({
      message: 'Incident recorded privately. Not every incident is a reportable breach; assess obligations under RA 10173 and NPC rules.',
      reference: ref,
    })
  }),
)

adminRouter.patch(
  '/privacy-incidents/:id',
  requirePermission('privacy.incidents.manage'),
  validate(
    z.object({
      status: z.enum(['reported', 'under_investigation', 'containment_in_progress', 'contained', 'remediation_in_progress', 'resolved', 'closed']),
      resolution: z.string().trim().max(4000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM privacy_incidents WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Incident not found.')
    run(`UPDATE privacy_incidents SET status=?, resolution=COALESCE(?, resolution), resolved_at=? WHERE id=?`, [
      req.body.status,
      cleanText(req.body.resolution, 4000),
      ['resolved', 'closed'].includes(req.body.status) ? nowIso() : null,
      row.id,
    ])
    logAudit(req, { action: 'privacy.incident_updated', module: 'privacy', entityType: 'privacy_incident', entityId: row.id })
    res.json({ message: 'Incident updated.' })
  }),
)

adminRouter.get(
  '/security-reports',
  requirePermission('privacy.incidents.manage'),
  asyncHandler(async (_req, res) => {
    res.json({ results: all(`SELECT * FROM security_reports ORDER BY id DESC`) })
  }),
)

adminRouter.get(
  '/retention-rules',
  requirePermission('privacy.requests.manage'),
  asyncHandler(async (_req, res) => {
    res.json({ results: all(`SELECT * FROM retention_rules ORDER BY id`) })
  }),
)

adminRouter.patch(
  '/retention-rules/:id',
  requirePermission('privacy.requests.manage'),
  validate(z.object({ approvalStatus: z.enum(['pending', 'approved', 'rejected']), retentionPeriod: z.string().trim().max(200).optional() })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM retention_rules WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Retention rule not found.')
    run(`UPDATE retention_rules SET approval_status=?, retention_period=COALESCE(?, retention_period), updated_by=?, updated_at=? WHERE id=?`, [
      req.body.approvalStatus,
      req.body.retentionPeriod || null,
      req.user.id,
      nowIso(),
      row.id,
    ])
    logAudit(req, { action: 'privacy.retention_updated', module: 'privacy', entityType: 'retention_rule', entityId: row.id })
    res.json({ message: 'Retention rule updated.' })
  }),
)

// ---------------------------------------------------------------------------
// Homepage content management
// ---------------------------------------------------------------------------
adminRouter.get(
  '/homepage-sections',
  requirePermission('cms.manage'),
  asyncHandler(async (_req, res) => {
    res.json({ results: all(`SELECT * FROM homepage_sections ORDER BY sort_order`) })
  }),
)

adminRouter.put(
  '/homepage-sections/:id',
  requirePermission('cms.manage'),
  validate(
    z.object({
      title: z.string().trim().max(200).optional(),
      subtitle: z.string().trim().max(600).optional(),
      body: z.string().trim().max(4000).optional(),
      sortOrder: z.coerce.number().int().min(0).max(100).optional(),
      isEnabled: z.union([z.boolean(), z.literal('true'), z.literal('false')]).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM homepage_sections WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Homepage section not found.')
    if (row.section_key === 'emergency' && req.body.isEnabled === false) {
      throw forbidden('Emergency information cannot be disabled from homepage settings.')
    }
    run(
      `UPDATE homepage_sections SET title=COALESCE(?, title), subtitle=COALESCE(?, subtitle), body=COALESCE(?, body),
        sort_order=COALESCE(?, sort_order), is_enabled=COALESCE(?, is_enabled), updated_at=? WHERE id=?`,
      [
        req.body.title ?? null,
        req.body.subtitle ?? null,
        req.body.body ?? null,
        req.body.sortOrder ?? null,
        req.body.isEnabled === undefined ? null : req.body.isEnabled === true || req.body.isEnabled === 'true' ? 1 : 0,
        nowIso(),
        row.id,
      ],
    )
    logAudit(req, { action: 'cms.homepage_updated', module: 'cms', entityType: 'homepage_section', entityId: row.id })
    res.json({ message: 'Homepage section saved.', record: get(`SELECT * FROM homepage_sections WHERE id = ?`, [row.id]) })
  }),
)

// ---------------------------------------------------------------------------
// CMS pages, FAQs, media
// ---------------------------------------------------------------------------
adminRouter.get(
  '/cms',
  requirePermission('cms.manage'),
  asyncHandler(async (req, res) => {
    const params = []
    let where = '1 = 1'
    if (req.query.status) {
      where += ` AND c.status = ?`
      params.push(String(req.query.status))
    }
    if (req.query.q) {
      where += ` AND (lower(c.title) LIKE ? OR lower(c.slug) LIKE ?)`
      params.push(`%${String(req.query.q).toLowerCase()}%`, `%${String(req.query.q).toLowerCase()}%`)
    }
    res.json({
      results: all(
        `SELECT c.*, u.name AS author FROM cms_pages c LEFT JOIN users u ON u.id = c.author_id
         WHERE ${where} ORDER BY c.id DESC LIMIT 200`,
        params,
      ),
      sections: ['general', 'hero', 'about', 'faq', 'footer', 'legal'],
      statuses: ['draft', 'submitted_for_review', 'under_review', 'changes_requested', 'approved', 'published', 'archived'],
    })
  }),
)

adminRouter.post(
  '/cms',
  requirePermission('cms.manage'),
  validate(
    z.object({
      title: z.string().trim().min(3).max(200),
      section: z.enum(['general', 'hero', 'about', 'faq', 'footer', 'legal']).default('general'),
      excerpt: z.string().trim().max(500).optional(),
      content: z.string().trim().max(100000).optional(),
      seoTitle: z.string().trim().max(200).optional(),
      seoDescription: z.string().trim().max(300).optional(),
      status: z.enum(['draft', 'submitted_for_review']).default('draft'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const slug = uniqueSlug(run, get, 'cms_pages', 'slug', req.body.title)
    const result = run(
      `INSERT INTO cms_pages (title, slug, section, excerpt, content, status, author_id, seo_title, seo_description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanText(req.body.title, 200),
        slug,
        req.body.section,
        cleanText(req.body.excerpt, 500),
        cleanText(req.body.content, 100000),
        req.body.status,
        req.user.id,
        cleanText(req.body.seoTitle, 200),
        cleanText(req.body.seoDescription, 300),
      ],
    )
    const id = Number(result.lastInsertRowid)
    run(`INSERT INTO cms_revisions (content_type, content_id, revision_number, snapshot, editor_id, change_summary) VALUES ('cms_page', ?, 1, ?, ?, 'Created')`, [
      id,
      JSON.stringify(req.body),
      req.user.id,
    ])
    logAudit(req, { action: 'cms.page_created', module: 'cms', entityType: 'cms_page', entityId: id })
    res.status(201).json({ message: 'Page created.', id, page: get(`SELECT * FROM cms_pages WHERE id = ?`, [id]) })
  }),
)

adminRouter.patch(
  '/cms/:id',
  requirePermission('cms.manage'),
  validate(
    z.object({
      title: z.string().trim().min(3).max(200).optional(),
      section: z.enum(['general', 'hero', 'about', 'faq', 'footer', 'legal']).optional(),
      excerpt: z.string().trim().max(500).optional(),
      content: z.string().trim().max(100000).optional(),
      seoTitle: z.string().trim().max(200).optional(),
      seoDescription: z.string().trim().max(300).optional(),
      status: z.enum(['draft', 'submitted_for_review', 'under_review', 'changes_requested', 'approved', 'published', 'archived']).optional(),
      changeSummary: z.string().trim().max(300).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const page = get(`SELECT * FROM cms_pages WHERE id = ?`, [Number(req.params.id)])
    if (!page) throw notFound('Page not found.')
    const context = ctx(req)
    if (req.body.status && req.body.status !== page.status) {
      const allowed = { draft: ['submitted_for_review'], submitted_for_review: ['under_review', 'approved', 'changes_requested'], under_review: ['approved', 'changes_requested'], changes_requested: ['submitted_for_review', 'draft'], approved: ['published', 'archived'], published: ['archived'], archived: ['draft'] }
      if (!(allowed[page.status] || []).includes(req.body.status)) {
        throw badRequest(`Cannot move page from ${page.status} to ${req.body.status}.`)
      }
      if (req.body.status === 'published' && !hasPermission(context, 'content.publish') && !context.isSuperAdmin) {
        throw forbidden('You do not have permission to publish.')
      }
      if (['approved', 'under_review', 'changes_requested'].includes(req.body.status) && !hasPermission(context, 'content.approve') && !context.isSuperAdmin) {
        throw forbidden('You do not have permission to review content.')
      }
    }
    const revision = Number(get(`SELECT COALESCE(MAX(revision_number), 0) + 1 AS n FROM cms_revisions WHERE content_type='cms_page' AND content_id = ?`, [page.id]).n)
    run(`INSERT INTO cms_revisions (content_type, content_id, revision_number, snapshot, editor_id, change_summary) VALUES ('cms_page', ?, ?, ?, ?, ?)`, [
      page.id,
      revision,
      JSON.stringify(page),
      req.user.id,
      cleanText(req.body.changeSummary, 300) || 'Updated',
    ])
    run(
      `UPDATE cms_pages SET title=COALESCE(?, title), section=COALESCE(?, section), excerpt=COALESCE(?, excerpt),
        content=COALESCE(?, content), seo_title=COALESCE(?, seo_title), seo_description=COALESCE(?, seo_description),
        status=COALESCE(?, status), published_at=CASE WHEN ?='published' THEN COALESCE(published_at, ?) ELSE published_at END,
        updated_at=? WHERE id=?`,
      [
        req.body.title ? cleanText(req.body.title, 200) : null,
        req.body.section || null,
        req.body.excerpt !== undefined ? cleanText(req.body.excerpt, 500) : null,
        req.body.content !== undefined ? cleanText(req.body.content, 100000) : null,
        req.body.seoTitle !== undefined ? cleanText(req.body.seoTitle, 200) : null,
        req.body.seoDescription !== undefined ? cleanText(req.body.seoDescription, 300) : null,
        req.body.status || null,
        req.body.status || '',
        nowIso(),
        nowIso(),
        page.id,
      ],
    )
    logAudit(req, { action: 'cms.page_updated', module: 'cms', entityType: 'cms_page', entityId: page.id, newValues: { status: req.body.status || page.status } })
    res.json({ message: 'Page saved.', page: get(`SELECT * FROM cms_pages WHERE id = ?`, [page.id]) })
  }),
)

adminRouter.get(
  '/cms/:id/revisions',
  requirePermission('cms.manage'),
  asyncHandler(async (req, res) => {
    res.json({
      results: all(
        `SELECT r.id, r.revision_number, r.change_summary, r.created_at, u.name AS editor
         FROM cms_revisions r LEFT JOIN users u ON u.id = r.editor_id
         WHERE r.content_type='cms_page' AND r.content_id = ? ORDER BY r.revision_number DESC`,
        [Number(req.params.id)],
      ),
    })
  }),
)

adminRouter.get(
  '/faqs',
  requirePermission('cms.manage'),
  asyncHandler(async (_req, res) => {
    res.json({ results: all(`SELECT * FROM faqs ORDER BY sort_order, id`) })
  }),
)

adminRouter.post(
  '/faqs',
  requirePermission('cms.manage'),
  validate(
    z.object({
      question: z.string().trim().min(5).max(300),
      answer: z.string().trim().min(10).max(5000),
      category: z.string().trim().max(80).optional(),
      status: z.enum(['draft', 'published']).default('draft'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const result = run(`INSERT INTO faqs (question, answer, category, status, sort_order) VALUES (?, ?, ?, ?, ?)`, [
      cleanText(req.body.question, 300),
      cleanText(req.body.answer, 5000),
      cleanText(req.body.category, 80),
      req.body.status,
      Number(get(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM faqs`).n),
    ])
    logAudit(req, { action: 'cms.faq_created', module: 'cms', entityType: 'faq', entityId: Number(result.lastInsertRowid) })
    res.status(201).json({ message: 'FAQ saved.', id: Number(result.lastInsertRowid) })
  }),
)

adminRouter.patch(
  '/faqs/:id',
  requirePermission('cms.manage'),
  validate(
    z.object({
      question: z.string().trim().min(5).max(300).optional(),
      answer: z.string().trim().min(10).max(5000).optional(),
      category: z.string().trim().max(80).optional(),
      status: z.enum(['draft', 'published', 'archived']).optional(),
      sortOrder: z.coerce.number().int().min(0).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM faqs WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('FAQ not found.')
    run(
      `UPDATE faqs SET question=COALESCE(?, question), answer=COALESCE(?, answer), category=COALESCE(?, category),
        status=COALESCE(?, status), sort_order=COALESCE(?, sort_order), updated_at=? WHERE id=?`,
      [
        req.body.question ? cleanText(req.body.question, 300) : null,
        req.body.answer ? cleanText(req.body.answer, 5000) : null,
        req.body.category !== undefined ? cleanText(req.body.category, 80) : null,
        req.body.status || null,
        req.body.sortOrder ?? null,
        nowIso(),
        row.id,
      ],
    )
    logAudit(req, { action: 'cms.faq_updated', module: 'cms', entityType: 'faq', entityId: row.id })
    res.json({ message: 'FAQ updated.' })
  }),
)

const ALLOWED_UPLOAD_TYPES = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
}

adminRouter.get(
  '/media',
  requirePermission('media.manage', 'transparency.documents.manage', 'municipal.media.upload'),
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(
        `SELECT m.id, m.file_name, m.original_name, m.mime_type, m.file_size, m.created_at, u.name AS uploaded_by
         FROM media_assets m LEFT JOIN users u ON u.id = m.uploaded_by ORDER BY m.id DESC LIMIT 200`,
      ),
    })
  }),
)

adminRouter.post(
  '/media',
  requirePermission('media.manage', 'transparency.documents.manage', 'municipal.media.upload'),
  asyncHandler(async (req, res) => {
    const contentType = String(req.get('content-type') || '').split(';')[0].trim()
    const signature = ALLOWED_UPLOAD_TYPES[contentType]
    if (!signature) throw unprocessable('Upload a PDF, JPG, PNG or WebP file.', [{ field: 'file', message: 'Unsupported file type.' }])
    const buffer = req.body
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw unprocessable('No file data received.')
    if (buffer.length > env.maxUploadBytes) throw unprocessable('The file is larger than the configured limit.')
    if (!signature.every((byte, index) => buffer[index] === byte)) {
      throw unprocessable('The file content does not match its declared type.')
    }
    const dir = path.resolve(process.cwd(), env.uploadsDir, 'media')
    fs.mkdirSync(dir, { recursive: true })
    const ext = contentType === 'application/pdf' ? 'pdf' : contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`
    fs.writeFileSync(path.join(dir, filename), buffer)
    const publicPath = `/uploads/media/${filename}`
    const result = run(
      `INSERT INTO media_assets (file_name, original_name, file_path, mime_type, file_size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        filename,
        cleanText(req.get('x-file-name'), 200) || filename,
        publicPath,
        contentType,
        buffer.length,
        req.user.id,
      ],
    )
    logAudit(req, { action: 'media.uploaded', module: 'cms', entityType: 'media_asset', entityId: Number(result.lastInsertRowid) })
    res.status(201).json({ message: 'File uploaded.', id: Number(result.lastInsertRowid), path: publicPath })
  }),
)

adminRouter.delete(
  '/media/:id',
  requirePermission('media.manage'),
  asyncHandler(async (req, res) => {
    const asset = get(`SELECT * FROM media_assets WHERE id = ?`, [Number(req.params.id)])
    if (!asset) throw notFound('File not found.')
    // Refuse to remove a file still referenced by published content.
    const reference =
      get(`SELECT id FROM public_documents WHERE file_path = ? LIMIT 1`, [asset.file_path]) ||
      get(`SELECT id FROM announcement_attachments WHERE file_path = ? LIMIT 1`, [asset.file_path])
    if (reference) throw badRequest('This file is still referenced by a record. Remove the reference first.')
    const file = path.resolve(process.cwd(), env.uploadsDir, 'media', path.basename(asset.file_path))
    if (fs.existsSync(file)) fs.unlinkSync(file)
    run(`DELETE FROM media_assets WHERE id = ?`, [asset.id])
    logAudit(req, { action: 'media.deleted', module: 'cms', entityType: 'media_asset', entityId: asset.id })
    res.json({ message: 'File removed.' })
  }),
)
