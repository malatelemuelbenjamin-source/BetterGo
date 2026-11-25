import { Router } from 'express'
import { all, get, nowIso, run } from '../db.js'
import { asyncHandler, badRequest, cleanText, forbidden, notFound, paginated, pagination, safeUrl, sanitizeRichText, uniqueSlug } from './http.js'
import { ctx, hasAnyPermission, canUseMunicipality } from '../rbac.js'
import { logAudit, recordWorkflow } from '../audit.js'

export const WORKFLOW = {
  draft: ['submitted_for_review'],
  submitted_for_review: ['under_review', 'changes_requested', 'approved', 'draft'],
  under_review: ['approved', 'changes_requested', 'rejected'],
  changes_requested: ['submitted_for_review', 'draft'],
  approved: ['published', 'archived'],
  published: ['archived'],
  archived: ['draft'],
  rejected: ['draft'],
}

export const WORKFLOW_LABELS = {
  draft: 'Draft',
  submitted_for_review: 'Submitted for review',
  under_review: 'Under review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  archived: 'Archived',
  rejected: 'Rejected',
}

const PERMISSION_FOR_STATUS = {
  published: 'publish',
  approved: 'approve',
  rejected: 'approve',
  under_review: 'approve',
  changes_requested: 'approve',
  archived: 'archive',
}

/** Column definitions describe how each incoming field is stored. */
export function field(type, { max, column } = {}) {
  return { type, max, column }
}

const CLEANERS = {
  text: (value, max = 300) => cleanText(value, max),
  longtext: (value, max = 100000) => sanitizeRichText(value)?.slice(0, max) ?? null,
  plainlongtext: (value, max = 100000) => cleanText(value, max),
  int: (value) => {
    if (value === '' || value === null || value === undefined) return null
    const n = Number(value)
    return Number.isFinite(n) ? Math.trunc(n) : null
  },
  bit: (value) => (value === true || value === 1 || value === '1' || value === 'true' || value === 'on' ? 1 : 0),
  url: (value) => safeUrl(value),
  email: (value) => cleanText(value, 200)?.toLowerCase() || null,
  slug: (value) => cleanText(value, 120),
  date: (value) => (value ? cleanText(value, 40) : null),
  json: (value) => (value === undefined || value === null || value === '' ? null : JSON.stringify(value)),
}

export function buildPayload(fields, body) {
  const payload = {}
  for (const [name, definition] of Object.entries(fields)) {
    const raw = body[name]
    if (raw === undefined) continue
    const cleaner = CLEANERS[definition.type]
    if (!cleaner) continue
    payload[definition.column || name] = cleaner(raw, definition.max)
  }
  return payload
}

function insert(table, payload) {
  const columns = Object.keys(payload)
  if (columns.length === 0) throw badRequest('No valid fields were provided.')
  const placeholders = columns.map(() => '?').join(', ')
  const result = run(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
    columns.map((c) => payload[c]),
  )
  return Number(result.lastInsertRowid)
}

function update(table, id, payload) {
  const columns = Object.keys(payload)
  if (columns.length === 0) return
  run(`UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [
    ...columns.map((c) => payload[c]),
    id,
  ])
}

/**
 * Build a content module router with scoped reads, guarded writes, workflow
 * transitions and audit logging.
 */
export function contentModule({
  base,
  table,
  label,
  fields,
  searchColumns = ['title'],
  slugFrom = 'title',
  listColumns = '*',
  joinSql = '',
  joinParams = () => [],
  municipalityColumn = 'municipality_id',
  permissions = {},
  listFilters = {},
  allowDelete = false,
  workflow = true,
  statusColumn = 'publication_status',
  publishedAtColumn = 'published_at',
  // Optional immutable version history: { table, contentColumn }.
  revisions = null,
}) {
  const router = Router()
  const perms = {
    view: ['content.view'],
    create: ['content.create'],
    update: ['content.update'],
    submit: ['content.create', 'content.update'],
    approve: ['content.approve'],
    publish: ['content.publish'],
    archive: ['content.archive'],
    ...permissions,
  }

  const ensure = (req, keys) => {
    const context = ctx(req)
    if (!hasAnyPermission(context, keys)) throw forbidden(`You do not have permission to ${label} this record.`)
    return context
  }

  const scopedWhere = (context, params) => {
    if (context?.hasGlobalScope) return ''
    if (!context || context.municipalityIds.length === 0) return ` AND 1 = 0`
    params.push(...context.municipalityIds)
    return ` AND (t.${municipalityColumn} IS NULL OR t.${municipalityColumn} IN (${context.municipalityIds.map(() => '?').join(', ')}))`
  }

  const writeRevision = (record, summary, actorId) => {
    if (!revisions) return
    try {
      run(
        `INSERT INTO ${revisions.table} (${revisions.contentColumn || 'content_id'}, municipality_id, snapshot, change_summary, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [record.id, record[municipalityColumn] ?? null, JSON.stringify(record), cleanText(summary, 500), actorId],
      )
    } catch (error) {
      console.error('[revisions] failed to record version', error.message)
    }
  }

  const guardMunicipality = (context, municipalityId) => {
    if (municipalityId === null || municipalityId === undefined) {
      if (!context.hasGlobalScope) {
        throw forbidden('Only province-wide administrators may manage province-wide records. Select your municipality.')
      }
      return
    }
    if (!canUseMunicipality(context, municipalityId)) {
      throw forbidden('This record belongs to a municipality outside your assigned scope.')
    }
  }

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      ensure(req, perms.view)
      const context = ctx(req)
      const { page, limit, offset } = pagination(req.query)
      const params = []
      let where = '1 = 1'
      if (req.query.status) {
        where += ` AND t.${statusColumn} = ?`
        params.push(String(req.query.status))
      }
      if (req.query.q) {
        where += ` AND (${searchColumns.map((c) => `lower(COALESCE(t.${c},'')) LIKE ?`).join(' OR ')})`
        searchColumns.forEach(() => params.push(`%${String(req.query.q).toLowerCase()}%`))
      }
      if (req.query.municipality) {
        where += ` AND m.slug = ?`
        params.push(String(req.query.municipality))
      }
      for (const [param, column] of Object.entries(listFilters)) {
        if (req.query[param]) {
          where += ` AND t.${column} = ?`
          params.push(String(req.query[param]))
        }
      }
      where += scopedWhere(context, params)
      const total = Number(
        get(
          `SELECT COUNT(*) AS total FROM ${table} t ${joinSql} WHERE ${where}`,
          [...joinParams(), ...params],
        ).total,
      )
      // Province-wide rows (no municipality) are visible to scoped staff as
      // reference only. The flag lets the interface show them without edit
      // actions; the write guards below already refuse those changes.
      const provinceWideFlag = context.hasGlobalScope
        ? '0 AS is_province_wide'
        : `(t.${municipalityColumn} IS NULL) AS is_province_wide`
      const rows = all(
        `SELECT ${listColumns}, ${provinceWideFlag} FROM ${table} t ${joinSql} WHERE ${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`,
        [...joinParams(), ...params, limit, offset],
      )
      res.json({
        ...paginated(rows, total, page, limit),
        statuses: WORKFLOW_LABELS,
        provinceWideReadOnly: !context.hasGlobalScope,
      })
    }),
  )

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      ensure(req, perms.view)
      const row = get(`SELECT t.* FROM ${table} t ${joinSql} WHERE t.id = ?`, [...joinParams(), Number(req.params.id)])
      if (!row) throw notFound(`${label} record not found.`)
      const context = ctx(req)
      if (!context.hasGlobalScope && row[municipalityColumn] && !canUseMunicipality(context, row[municipalityColumn])) {
        throw notFound(`${label} record not found.`)
      }
      res.json({ record: row, statuses: WORKFLOW_LABELS })
    }),
  )

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const context = ensure(req, perms.create)
      const payload = buildPayload(fields, req.body)
      guardMunicipality(context, payload[municipalityColumn] ?? null)

      const titleValue = payload.title || payload.name || payload.organization_name || payload.question || 'record'
      if (slugFrom && !payload.slug) {
        payload.slug = uniqueSlug(run, get, table, 'slug', titleValue)
      } else if (payload.slug) {
        payload.slug = uniqueSlug(run, get, table, 'slug', payload.slug)
      }
      payload.created_by = req.user.id
      payload.updated_by = req.user.id
      if (statusColumn === 'publication_status' && !payload.publication_status) payload.publication_status = 'draft'
      // Verification is a reviewer decision, so only approvers may state it on create.
      if (req.body.verification_status && hasAnyPermission(context, perms.approve)) {
        payload.verification_status = cleanText(req.body.verification_status, 40)
      }
      const id = insert(table, payload)
      recordWorkflow(run, { contentType: label, contentId: id, from: null, to: payload[statusColumn] || 'draft', actorId: req.user.id, note: 'Created' })
      logAudit(req, {
        action: 'content.created',
        module: label,
        entityType: table,
        entityId: id,
        newValues: { title: titleValue },
        municipalityId: payload[municipalityColumn] ?? null,
      })
      res.status(201).json({ message: `${label} record created as a draft.`, id, record: get(`SELECT * FROM ${table} WHERE id = ?`, [id]) })
    }),
  )

  if (revisions) {
    router.get(
      '/:id/revisions',
      asyncHandler(async (req, res) => {
        ensure(req, perms.view)
        const existing = get(`SELECT * FROM ${table} WHERE id = ?`, [Number(req.params.id)])
        if (!existing) throw notFound(`${label} record not found.`)
        const context = ctx(req)
        if (!context.hasGlobalScope && existing[municipalityColumn] && !canUseMunicipality(context, existing[municipalityColumn])) {
          throw notFound(`${label} record not found.`)
        }
        const rows = all(
          `SELECT r.id, r.change_summary, r.created_at, u.name AS created_by_name
           FROM ${revisions.table} r LEFT JOIN users u ON u.id = r.created_by
           WHERE r.${revisions.contentColumn || 'content_id'} = ? ORDER BY r.id DESC LIMIT 50`,
          [existing.id],
        )
        res.json({ results: rows, total: rows.length })
      }),
    )
  }

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const context = ensure(req, perms.update)
      const existing = get(`SELECT * FROM ${table} WHERE id = ?`, [Number(req.params.id)])
      if (!existing) throw notFound(`${label} record not found.`)
      guardMunicipality(context, existing[municipalityColumn])
      const payload = buildPayload(fields, req.body)
      if (payload[municipalityColumn] !== undefined) guardMunicipality(context, payload[municipalityColumn])
      if (existing[statusColumn] === 'published' && !hasAnyPermission(context, perms.publish)) {
        throw forbidden('Published records can only be changed by a user with publish permission.')
      }
      writeRevision(existing, req.body.note || 'Updated', req.user.id)
      payload.updated_by = req.user.id
      payload.updated_at = nowIso()
      if (workflow && payload[statusColumn] && payload[statusColumn] !== existing[statusColumn]) {
        const next = payload[statusColumn]
        if (!(WORKFLOW[existing[statusColumn]] || []).includes(next)) {
          throw badRequest(`Cannot move a record from ${existing[statusColumn]} to ${next}. Use the workflow actions.`)
        }
        const needed = PERMISSION_FOR_STATUS[next]
        if (needed && !hasAnyPermission(context, perms[needed])) {
          throw forbidden(`You do not have permission to move a record to ${next}.`)
        }
        if (next === 'published') payload[publishedAtColumn] = existing[publishedAtColumn] || nowIso()
        recordWorkflow(run, {
          contentType: label,
          contentId: existing.id,
          from: existing[statusColumn],
          to: next,
          actorId: req.user.id,
          note: req.body.note || null,
        })
      }
      update(table, existing.id, payload)
      logAudit(req, {
        municipalityId: existing[municipalityColumn],
        action: 'content.updated',
        module: label,
        entityType: table,
        entityId: existing.id,
        oldValues: { status: existing[statusColumn] },
        newValues: { status: payload[statusColumn] || existing[statusColumn] },
      })
      res.json({ message: `${label} record updated.`, record: get(`SELECT * FROM ${table} WHERE id = ?`, [existing.id]) })
    }),
  )

  router.post(
    '/:id/status',
    asyncHandler(async (req, res) => {
      const context = ctx(req)
      const existing = get(`SELECT * FROM ${table} WHERE id = ?`, [Number(req.params.id)])
      if (!existing) throw notFound(`${label} record not found.`)
      guardMunicipality(context, existing[municipalityColumn])
      const next = cleanText(req.body.status, 40)
      if (!next || !WORKFLOW_LABELS[next]) throw badRequest('Unknown workflow status.')
      if (!(WORKFLOW[existing[statusColumn]] || []).includes(next)) {
        throw badRequest(`Cannot move a record from ${existing[statusColumn]} to ${next}.`)
      }
      if (next === 'published') ensure(req, perms.publish)
      else if (next === 'archived') ensure(req, perms.archive)
      // Submitting your own draft is an author action, not a reviewer action.
      else if (next === 'submitted_for_review') ensure(req, perms.submit)
      else ensure(req, perms.approve)

      const payload = { [statusColumn]: next, updated_at: nowIso(), updated_by: req.user.id }
      writeRevision(existing, cleanText(req.body.note, 500) || `Moved to ${next}`, req.user.id)
      if (next === 'published') payload[publishedAtColumn] = existing[publishedAtColumn] || nowIso()
      if (next === 'approved' && ['government_services', 'announcements', 'government_offices', 'municipal_content'].includes(table)) {
        payload.verification_status = 'verified'
        if (table === 'government_services') payload.verified_at = nowIso()
        if (table === 'announcements') payload.verified_at = nowIso()
      }
      if (next === 'published' && table === 'government_offices') payload.verification_status = 'verified'
      update(table, existing.id, payload)
      recordWorkflow(run, {
        contentType: label,
        contentId: existing.id,
        from: existing[statusColumn],
        to: next,
        actorId: req.user.id,
        note: cleanText(req.body.note, 1000),
      })
      logAudit(req, {
        municipalityId: existing[municipalityColumn],
        action: `content.${next}`,
        module: label,
        entityType: table,
        entityId: existing.id,
        oldValues: { status: existing[statusColumn] },
        newValues: { status: next, note: cleanText(req.body.note, 500) },
      })
      res.json({ message: `Record moved to ${WORKFLOW_LABELS[next]}.`, record: get(`SELECT * FROM ${table} WHERE id = ?`, [existing.id]) })
    }),
  )

  if (allowDelete) {
    router.delete(
      '/:id',
      asyncHandler(async (req, res) => {
        const context = ensure(req, perms.archive)
        const existing = get(`SELECT * FROM ${table} WHERE id = ?`, [Number(req.params.id)])
        if (!existing) throw notFound(`${label} record not found.`)
        guardMunicipality(context, existing[municipalityColumn])
        // Government records are archived, never hard-deleted.
        update(table, existing.id, { [statusColumn]: 'archived', updated_at: nowIso(), updated_by: req.user.id })
        logAudit(req, {
          action: 'content.archived',
          module: label,
          entityType: table,
          entityId: existing.id,
          municipalityId: existing[municipalityColumn],
        })
        res.json({ message: 'Record archived. Government records are never permanently deleted.' })
      }),
    )
  }

  return router
}
