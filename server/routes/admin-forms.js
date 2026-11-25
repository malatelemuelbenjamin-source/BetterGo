import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { requireAdmin, requirePermission, ctx } from '../rbac.js'
import { asyncHandler, cleanText, forbidden, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { normaliseFormFields, parseFormRow, FORM_STATUSES } from '../lib/forms.js'

export const adminFormsRouter = Router()
adminFormsRouter.use(requireAdmin)

const scopes = (req) => {
  const context = ctx(req)
  return context.hasGlobalScope ? null : context.municipalityIds || []
}

function scopedForm(req, id) {
  const form = get(`SELECT * FROM service_forms WHERE id = ?`, [Number(id)])
  if (!form) throw notFound('Form not found.')
  const scope = scopes(req)
  if (scope && form.municipality_id && !scope.includes(Number(form.municipality_id))) {
    throw notFound('Form not found.')
  }
  return form
}

function formPayload(form) {
  const fields = all(`SELECT * FROM service_form_fields WHERE form_id = ? ORDER BY sort_order ASC, id ASC`, [form.id])
  const service = get(`SELECT title, slug FROM government_services WHERE id = ?`, [form.service_id])
  return {
    ...parseFormRow(form, fields),
    serviceTitle: service?.title || null,
    serviceSlug: service?.slug || null,
    statusLabel: FORM_STATUSES[form.status] || form.status,
  }
}

adminFormsRouter.get(
  '/forms',
  requirePermission('services.view'),
  asyncHandler(async (req, res) => {
    const scope = scopes(req)
    const status = FORM_STATUSES[String(req.query.status)] ? String(req.query.status) : null
    const term = cleanText(req.query.q, 100)
    const rows = all(
      `SELECT f.*, s.title AS service_title, m.name AS municipality_name,
              (SELECT COUNT(*) FROM service_form_fields ff WHERE ff.form_id = f.id) AS field_count
       FROM service_forms f
       JOIN government_services s ON s.id = f.service_id
       LEFT JOIN municipalities m ON m.id = f.municipality_id
       WHERE 1 = 1
         ${scope ? `AND (f.municipality_id IS NULL OR f.municipality_id IN (${scope.map(() => '?').join(',')}))` : ''}
         ${status ? 'AND f.status = ?' : ''}
         ${term ? 'AND (f.title LIKE ? OR s.title LIKE ?)' : ''}
       ORDER BY f.updated_at DESC, f.id DESC LIMIT 100`,
      [
        ...(scope || []),
        ...(status ? [status] : []),
        ...(term ? [`%${term}%`, `%${term}%`] : []),
      ],
    )
    res.json({
      results: rows,
      statuses: FORM_STATUSES,
      note: 'Only published BetterGo intake forms appear to citizens. Nothing is transmitted to a government office.',
    })
  }),
)

adminFormsRouter.get(
  '/forms/services',
  requirePermission('services.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(
        `SELECT id, title, slug, publication_status FROM government_services
         WHERE archived_at IS NULL ORDER BY title ASC LIMIT 300`,
      ),
    })
  }),
)

adminFormsRouter.get(
  '/forms/:id',
  requirePermission('services.view'),
  asyncHandler(async (req, res) => {
    res.json({ form: formPayload(scopedForm(req, req.params.id)) })
  }),
)

const formSchema = z.object({
  serviceId: z.coerce.number().int().positive(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  instructions: z.string().trim().max(4000).optional().or(z.literal('')),
  privacyNotice: z.string().trim().max(4000).optional().or(z.literal('')),
  privacyNoticeVersion: z.string().trim().max(20).optional(),
  audience: z.string().trim().max(300).optional().or(z.literal('')),
  municipalityId: z.coerce.number().int().positive().optional().or(z.literal('')),
  submissionClassification: z.enum(['bettergo_intake', 'information_only']).optional(),
  sourceReference: z.string().trim().max(300).optional().or(z.literal('')),
  fields: z.array(z.record(z.any())).max(80).optional(),
})

function assertService(req, serviceId, municipalityId) {
  const service = get(`SELECT id, title, municipality_id FROM government_services WHERE id = ? AND archived_at IS NULL`, [Number(serviceId)])
  if (!service) throw unprocessable('Choose an existing service.', [{ field: 'serviceId', message: 'Unknown service.' }])
  const scope = scopes(req)
  if (scope && municipalityId && !scope.includes(Number(municipalityId))) {
    throw forbidden('You can only create forms for your own municipality.')
  }
  return service
}

adminFormsRouter.post(
  '/forms',
  requirePermission('services.update', 'content.create'),
  validate(formSchema),
  asyncHandler(async (req, res) => {
    assertService(req, req.body.serviceId, req.body.municipalityId)
    const { fields, errors } = normaliseFormFields(req.body.fields || [])
    if (errors.length) throw unprocessable('The form definition is invalid.', errors.map((message) => ({ field: 'fields', message })))
    const result = run(
      `INSERT INTO service_forms (service_id, municipality_id, title, description, instructions, privacy_notice,
        privacy_notice_version, audience, submission_classification, source_reference, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(req.body.serviceId),
        req.body.municipalityId ? Number(req.body.municipalityId) : null,
        cleanText(req.body.title, 160),
        cleanText(req.body.description, 1000),
        cleanText(req.body.instructions, 4000),
        cleanText(req.body.privacyNotice, 4000),
        cleanText(req.body.privacyNoticeVersion, 20) || 'v1',
        cleanText(req.body.audience, 300),
        req.body.submissionClassification || 'bettergo_intake',
        cleanText(req.body.sourceReference, 300),
        req.user.id,
      ],
    )
    const formId = Number(result.lastInsertRowid)
    fields.forEach((field) => {
      run(
        `INSERT INTO service_form_fields (form_id, field_key, label, field_type, section, description, placeholder, required, options, validation, conditional, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          formId,
          field.fieldKey,
          field.label,
          field.fieldType,
          field.section,
          field.description,
          field.placeholder,
          field.required ? 1 : 0,
          field.options.length ? JSON.stringify(field.options) : null,
          Object.keys(field.validation || {}).length ? JSON.stringify(field.validation) : null,
          field.conditional ? JSON.stringify(field.conditional) : null,
          field.sortOrder,
        ],
      )
    })
    logAudit(req, { action: 'forms.created', module: 'services', entityType: 'service_form', entityId: formId })
    res.status(201).json({ message: 'Form created as a draft.', id: formId })
  }),
)

adminFormsRouter.put(
  '/forms/:id',
  requirePermission('services.update', 'content.update'),
  validate(formSchema.partial()),
  asyncHandler(async (req, res) => {
    const form = scopedForm(req, req.params.id)
    if (!['draft', 'changes_requested'].includes(form.status)) {
      throw unprocessable('Only drafts or forms with requested changes can be edited. Duplicate a published form to change it.')
    }
    let fields = null
    if (req.body.fields) {
      const normalised = normaliseFormFields(req.body.fields)
      if (normalised.errors.length) {
        throw unprocessable('The form definition is invalid.', normalised.errors.map((message) => ({ field: 'fields', message })))
      }
      fields = normalised.fields
    }
    run(
      `UPDATE service_forms SET
        service_id = COALESCE(?, service_id),
        municipality_id = ?,
        title = COALESCE(?, title),
        description = ?, instructions = ?, privacy_notice = ?,
        privacy_notice_version = COALESCE(?, privacy_notice_version),
        audience = ?, submission_classification = COALESCE(?, submission_classification),
        source_reference = ?, updated_at = ?
       WHERE id = ?`,
      [
        req.body.serviceId ? Number(req.body.serviceId) : null,
        req.body.municipalityId !== undefined ? (req.body.municipalityId ? Number(req.body.municipalityId) : null) : form.municipality_id,
        req.body.title ? cleanText(req.body.title, 160) : null,
        req.body.description !== undefined ? cleanText(req.body.description, 1000) : form.description,
        req.body.instructions !== undefined ? cleanText(req.body.instructions, 4000) : form.instructions,
        req.body.privacyNotice !== undefined ? cleanText(req.body.privacyNotice, 4000) : form.privacy_notice,
        req.body.privacyNoticeVersion ? cleanText(req.body.privacyNoticeVersion, 20) : null,
        req.body.audience !== undefined ? cleanText(req.body.audience, 300) : form.audience,
        req.body.submissionClassification || null,
        req.body.sourceReference !== undefined ? cleanText(req.body.sourceReference, 300) : form.source_reference,
        nowIso(),
        form.id,
      ],
    )
    if (fields) {
      run(`DELETE FROM service_form_fields WHERE form_id = ?`, [form.id])
      fields.forEach((field) => {
        run(
          `INSERT INTO service_form_fields (form_id, field_key, label, field_type, section, description, placeholder, required, options, validation, conditional, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            form.id,
            field.fieldKey,
            field.label,
            field.fieldType,
            field.section,
            field.description,
            field.placeholder,
            field.required ? 1 : 0,
            field.options.length ? JSON.stringify(field.options) : null,
            Object.keys(field.validation || {}).length ? JSON.stringify(field.validation) : null,
            field.conditional ? JSON.stringify(field.conditional) : null,
            field.sortOrder,
          ],
        )
      })
    }
    logAudit(req, { action: 'forms.updated', module: 'services', entityType: 'service_form', entityId: form.id })
    res.json({ message: 'Form saved.', form: formPayload(get(`SELECT * FROM service_forms WHERE id = ?`, [form.id])) })
  }),
)

function transition(req, form, next, note) {
  run(`UPDATE service_forms SET status = ?, updated_at = ? WHERE id = ?`, [next, nowIso(), form.id])
  logAudit(req, {
    action: `forms.${next}`,
    module: 'services',
    entityType: 'service_form',
    entityId: form.id,
    newValues: { status: next, note },
  })
}

adminFormsRouter.post(
  '/forms/:id/submit-review',
  requirePermission('services.update', 'content.submit_for_review'),
  asyncHandler(async (req, res) => {
    const form = scopedForm(req, req.params.id)
    if (!['draft', 'changes_requested'].includes(form.status)) throw unprocessable('Only a draft can be sent for review.')
    const count = Number(get(`SELECT COUNT(*) AS n FROM service_form_fields WHERE form_id = ?`, [form.id]).n)
    if (!count) throw unprocessable('Add at least one field before requesting review.')
    transition(req, form, 'in_review')
    res.json({ message: 'Form sent for review.' })
  }),
)

adminFormsRouter.post(
  '/forms/:id/approve',
  requirePermission('content.approve'),
  asyncHandler(async (req, res) => {
    const form = scopedForm(req, req.params.id)
    if (form.status !== 'in_review') throw unprocessable('Only a form awaiting review can be approved.')
    run(`UPDATE service_forms SET status = 'approved', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`, [
      req.user.id,
      nowIso(),
      nowIso(),
      form.id,
    ])
    logAudit(req, { action: 'forms.approved', module: 'services', entityType: 'service_form', entityId: form.id })
    res.json({ message: 'Form approved.' })
  }),
)

adminFormsRouter.post(
  '/forms/:id/request-changes',
  requirePermission('content.approve', 'content.reject'),
  asyncHandler(async (req, res) => {
    const form = scopedForm(req, req.params.id)
    run(`UPDATE service_forms SET status = 'changes_requested', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`, [
      req.user.id,
      nowIso(),
      nowIso(),
      form.id,
    ])
    logAudit(req, { action: 'forms.changes_requested', module: 'services', entityType: 'service_form', entityId: form.id })
    res.json({ message: 'Changes requested.' })
  }),
)

adminFormsRouter.post(
  '/forms/:id/publish',
  requirePermission('content.publish', 'services.publish'),
  asyncHandler(async (req, res) => {
    const form = scopedForm(req, req.params.id)
    if (form.status !== 'approved') throw unprocessable('Only an approved form can be published.')
    const context = ctx(req)
    if (Number(form.created_by) === Number(req.user.id) && !context.hasGlobalScope) {
      throw forbidden('A second reviewer must publish a form you created.')
    }
    run(`UPDATE service_forms SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), form.id])
    logAudit(req, { action: 'forms.published', module: 'services', entityType: 'service_form', entityId: form.id })
    res.json({ message: 'Form published.' })
  }),
)

adminFormsRouter.post(
  '/forms/:id/archive',
  requirePermission('content.archive', 'services.archive'),
  asyncHandler(async (req, res) => {
    const form = scopedForm(req, req.params.id)
    run(`UPDATE service_forms SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), form.id])
    logAudit(req, { action: 'forms.archived', module: 'services', entityType: 'service_form', entityId: form.id })
    res.json({ message: 'Form archived. Existing submissions are unchanged.' })
  }),
)

adminFormsRouter.post(
  '/forms/:id/duplicate',
  requirePermission('services.create', 'services.update'),
  asyncHandler(async (req, res) => {
    const form = scopedForm(req, req.params.id)
    const fields = all(`SELECT * FROM service_form_fields WHERE form_id = ? ORDER BY sort_order`, [form.id])
    const result = run(
      `INSERT INTO service_forms (service_id, municipality_id, title, description, instructions, privacy_notice,
        privacy_notice_version, audience, version, status, submission_classification, source_reference, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [
        form.service_id,
        form.municipality_id,
        `${form.title} (copy)`.slice(0, 160),
        form.description,
        form.instructions,
        form.privacy_notice,
        form.privacy_notice_version,
        form.audience,
        Number(form.version) + 1,
        form.submission_classification,
        form.source_reference,
        req.user.id,
      ],
    )
    const newId = Number(result.lastInsertRowid)
    fields.forEach((field) => {
      run(
        `INSERT INTO service_form_fields (form_id, field_key, label, field_type, section, description, placeholder, required, options, validation, conditional, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId, field.field_key, field.label, field.field_type, field.section, field.description, field.placeholder, field.required, field.options, field.validation, field.conditional, field.sort_order],
      )
    })
    logAudit(req, { action: 'forms.duplicated', module: 'services', entityType: 'service_form', entityId: newId })
    res.status(201).json({ message: 'Form duplicated as a new draft version.', id: newId })
  }),
)

/** Citizen intake records for this form, without documents or internal notes. */
adminFormsRouter.get(
  '/forms/:id/submissions',
  requirePermission('services.view'),
  asyncHandler(async (req, res) => {
    const form = scopedForm(req, req.params.id)
    const scope = scopes(req)
    const rows = all(
      `SELECT a.id, a.reference, a.status, a.submitted_at, a.submission_classification, m.name AS municipality_name
       FROM citizen_applications a
       LEFT JOIN municipalities m ON m.id = a.municipality_id
       WHERE a.form_id = ?
         ${scope ? `AND (a.municipality_id IS NULL OR a.municipality_id IN (${scope.map(() => '?').join(',')}))` : ''}
       ORDER BY a.id DESC LIMIT 100`,
      [form.id, ...(scope || [])],
    )
    res.json({
      results: rows,
      note: 'Answers and attached documents are not shown in this summary. Open a record through the permitted review workflow.',
    })
  }),
)
