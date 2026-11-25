import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { requireAuth, rateLimit } from '../auth.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { parseFormRow, validateAnswers } from '../lib/forms.js'
import { APPLICATION_STATUSES } from '../lib/citizen.js'

export const formsRouter = Router()

function publishedForm(idOrSlug) {
  const form = get(
    `SELECT f.*, s.title AS service_title, s.slug AS service_slug, m.name AS municipality_name
     FROM service_forms f
     JOIN government_services s ON s.id = f.service_id
     LEFT JOIN municipalities m ON m.id = f.municipality_id
     WHERE f.status = 'published' AND f.archived_at IS NULL
       AND (f.id = ? OR s.slug = ?)
       AND s.publication_status = 'published' AND s.archived_at IS NULL
     ORDER BY f.id DESC LIMIT 1`,
    [Number(idOrSlug) || -1, String(idOrSlug)],
  )
  if (!form) return null
  const fields = all(`SELECT * FROM service_form_fields WHERE form_id = ? ORDER BY sort_order ASC, id ASC`, [form.id])
  return {
    ...parseFormRow(form, fields),
    serviceTitle: form.service_title,
    serviceSlug: form.service_slug,
    municipalityName: form.municipality_name,
  }
}

/** Public: the published form for a service (or by form id). */
formsRouter.get(
  '/forms/:idOrSlug',
  asyncHandler(async (req, res) => {
    const form = publishedForm(req.params.idOrSlug)
    if (!form) throw notFound('No published form is available for that service.')
    res.json({
      form: {
        id: form.id,
        title: form.title,
        description: form.description,
        instructions: form.instructions,
        privacyNotice: form.privacyNotice,
        privacyNoticeVersion: form.privacyNoticeVersion,
        audience: form.audience,
        version: form.version,
        status: form.status,
        submissionClassification: form.submissionClassification,
        serviceTitle: form.serviceTitle,
        serviceSlug: form.serviceSlug,
        municipalityName: form.municipalityName,
        fields: form.fields,
      },
      disclaimer:
        'A BetterGo submission is not an official government filing. It does not guarantee that any office has received, accepted, processed or approved it.',
    })
  }),
)

formsRouter.use('/account/forms', requireAuth)

/** The signed-in citizen's draft for one form. */
formsRouter.get(
  '/account/forms/:formId/draft',
  asyncHandler(async (req, res) => {
    const form = publishedForm(req.params.formId)
    if (!form) throw notFound('Form not found.')
    const draft = get(`SELECT answers, updated_at FROM service_form_drafts WHERE user_id = ? AND form_id = ?`, [req.user.id, form.id])
    res.json({ draft: draft ? { answers: JSON.parse(draft.answers || '{}'), updatedAt: draft.updated_at } : null })
  }),
)

formsRouter.put(
  '/account/forms/:formId/draft',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 120 }),
  validate(z.object({ answers: z.record(z.any()) })),
  asyncHandler(async (req, res) => {
    const form = publishedForm(req.params.formId)
    if (!form) throw notFound('Form not found.')
    const allowed = new Set(form.fields.map((field) => field.fieldKey))
    const answers = Object.fromEntries(
      Object.entries(req.body.answers || {})
        .filter(([key]) => allowed.has(key))
        .slice(0, 100),
    )
    const serialised = JSON.stringify(answers).slice(0, 200_000)
    run(
      `INSERT INTO service_form_drafts (user_id, form_id, form_version, answers, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, form_id) DO UPDATE SET answers = excluded.answers, form_version = excluded.form_version, updated_at = excluded.updated_at`,
      [req.user.id, form.id, form.version, serialised, nowIso()],
    )
    res.json({ message: 'Draft saved. Only you can see it.' })
  }),
)

formsRouter.delete(
  '/account/forms/:formId/draft',
  asyncHandler(async (req, res) => {
    run(`DELETE FROM service_form_drafts WHERE user_id = ? AND form_id = ?`, [req.user.id, Number(req.params.formId)])
    res.json({ message: 'Draft discarded.' })
  }),
)

/** BetterGo intake reference: random, clearly BetterGo-prefixed. */
function applicationReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(10)
  let body = ''
  for (const byte of bytes) body += alphabet[byte % alphabet.length]
  return `BG-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 10)}`
}

formsRouter.post(
  '/account/forms/:formId/submit',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  validate(
    z.object({
      answers: z.record(z.any()),
      consent: z.union([z.boolean(), z.literal('true'), z.literal('on')]),
      documentIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
      allowDuplicate: z.boolean().optional(),
      idempotencyKey: z.string().trim().min(8).max(100).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const form = publishedForm(req.params.formId)
    if (!form) throw notFound('Form not found.')
    if (form.submissionClassification !== 'bettergo_intake') {
      throw unprocessable('This form does not accept BetterGo intake submissions.')
    }
    if (!req.body.consent) {
      throw unprocessable('Accept the privacy notice before submitting.', [{ field: 'consent', message: 'Consent is required.' }])
    }

    const { errors, answers } = validateAnswers(form.fields, req.body.answers || {})
    if (errors.length) {
      const error = unprocessable('Please correct the highlighted answers.', errors)
      throw error
    }

    // Documents are only accepted from the caller's own private vault.
    const documentIds = [...new Set(req.body.documentIds || [])]
    for (const id of documentIds) {
      const owned = get(`SELECT id FROM citizen_documents WHERE id = ? AND user_id = ? AND status = 'active'`, [id, req.user.id])
      if (!owned) throw unprocessable('One of the attached documents is not in your vault.', [{ field: 'documents', message: 'Unknown document.' }])
    }

    // Idempotent submission: a repeated request with the same key returns the
    // record that was already created instead of creating another one.
    if (req.body.idempotencyKey) {
      const prior = get(`SELECT reference, id FROM citizen_applications WHERE user_id = ? AND source_reference = ?`, [
        req.user.id,
        `idem:${req.body.idempotencyKey}`,
      ])
      if (prior) {
        return res.status(200).json({
          message: 'This submission was already received. Nothing was recorded twice.',
          reference: prior.reference,
          applicationId: prior.id,
          status: 'submitted',
          idempotent: true,
        })
      }
    }

    // Duplicate detection warns before creating another record; it never rejects
    // an application on its own, and closed or withdrawn records never block.
    const possibleDuplicate = get(
      `SELECT reference FROM citizen_applications
       WHERE user_id = ? AND form_id = ?
         AND status IN ('submitted','in_review','awaiting_citizen','resubmitted')
         AND datetime(COALESCE(submitted_at, created_at)) >= datetime('now', '-7 days')
       ORDER BY id DESC LIMIT 1`,
      [req.user.id, form.id],
    )
    if (possibleDuplicate && !req.body.allowDuplicate) {
      return res.status(409).json({
        error: 'You already have a recent BetterGo submission for this form.',
        code: 'possible_duplicate',
        existingReference: possibleDuplicate.reference,
        canOverride: true,
        message:
          'Check your tracking page first. If this is a genuinely separate submission, confirm that you want to continue.',
      })
    }

    const profile = get(`SELECT municipality_id FROM user_profiles WHERE user_id = ?`, [req.user.id])
    let reference = applicationReference()
    for (let attempt = 0; attempt < 5 && get(`SELECT id FROM citizen_applications WHERE reference = ?`, [reference]); attempt += 1) {
      reference = applicationReference()
    }

    const result = run(
      `INSERT INTO citizen_applications
        (reference, user_id, municipality_id, service_id, status, submitted_at, form_id, form_version, form_answers,
         submission_classification, privacy_notice_version, consented_at, document_ids, source_reference)
       VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reference,
        req.user.id,
        profile?.municipality_id || null,
        form.serviceId,
        nowIso(),
        form.id,
        form.version,
        JSON.stringify(answers).slice(0, 200_000),
        form.submissionClassification,
        form.privacyNoticeVersion,
        nowIso(),
        JSON.stringify(documentIds),
        req.body.idempotencyKey ? `idem:${req.body.idempotencyKey}` : 'bettergo_platform',
      ],
    )
    const applicationId = Number(result.lastInsertRowid)
    run(
      `INSERT INTO citizen_application_events (application_id, from_status, to_status, citizen_visible, note, actor_id)
       VALUES (?, NULL, 'submitted', 1, ?, ?)`,
      [applicationId, 'Received by BetterGo. Not an official government filing.', req.user.id],
    )
    run(`DELETE FROM service_form_drafts WHERE user_id = ? AND form_id = ?`, [req.user.id, form.id])
    run(
      `INSERT INTO notifications (user_id, title, message, notification_type, related_entity_type, related_entity_id)
       VALUES (?, ?, ?, 'application', 'application', ?)`,
      [
        req.user.id,
        'BetterGo submission received',
        `Reference ${reference} was recorded on BetterGo. This is not an official government filing.`,
        applicationId,
      ],
    )
    run(
      `INSERT INTO citizen_activities (user_id, activity_type, entity_type, entity_id, entity_label, entity_slug) VALUES (?, 'application_submitted', 'application', ?, ?, ?)`,
      [req.user.id, applicationId, reference, reference],
    )
    logAudit(req, {
      action: 'citizen.application_submitted',
      module: 'citizen',
      entityType: 'citizen_application',
      entityId: applicationId,
      newValues: { reference, form_id: form.id, classification: form.submissionClassification },
    })

    res.status(201).json({
      message: 'Submitted to BetterGo. This is not an official government filing.',
      reference,
      applicationId,
      status: 'submitted',
      statusLabel: APPLICATION_STATUSES.submitted,
      disclaimer:
        'BetterGo recorded your answers for platform intake. No government office has received this submission, and submission does not guarantee acceptance, processing, approval or action.',
    })
  }),
)
