/**
 * Citizen service journey planner (Prompt 83).
 *
 * A journey organises citizen preparation for a published service. Task progress
 * is never official application progress, eligibility or approval, and checking a
 * box never marks a government requirement as officially completed.
 */
import { Router } from 'express'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const STATUSES = { active: 'Active', paused: 'Paused', completed: 'Completed', archived: 'Archived' }
const TASK_STATUSES = { pending: 'Pending', done: 'Done (your own check)', skipped: 'Skipped' }
const STEP_TYPES = { preparation: 'Preparation', document: 'Document', appointment: 'Appointment', form: 'BetterGo form', review: 'Review instructions' }
const PRIORITIES = { low: 'Low', normal: 'Normal', high: 'High' }
const TEMPLATE_STATUSES = { draft: 'Draft', published: 'Published', archived: 'Archived' }

const reference = () => `BG-JRN-${randomBytes(4).toString('hex').toUpperCase()}`
const parseSteps = (value) => {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function activity(journeyId, actorId, action, note = null) {
  run(`INSERT INTO journey_activity (journey_id, actor_user_id, action, note) VALUES (?, ?, ?, ?)`, [journeyId, actorId, action, cleanText(note, 500)])
}

function shapeTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    stepType: row.step_type,
    stepTypeLabel: STEP_TYPES[row.step_type] || row.step_type,
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    statusLabel: TASK_STATUSES[row.status] || row.status,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  }
}

function linkedRecords(userId, serviceId) {
  return {
    applications: all(
      `SELECT reference, status, created_at FROM citizen_applications WHERE user_id = ? AND service_id = ? ORDER BY id DESC LIMIT 10`,
      [userId, serviceId],
    ),
    appointments: all(
      `SELECT reference, status, appointment_date FROM appointments WHERE user_id = ? AND service_id = ? ORDER BY id DESC LIMIT 10`,
      [userId, serviceId],
    ),
    documentRequests: all(
      `SELECT reference, status FROM document_requests WHERE user_id = ? AND service_id = ? ORDER BY id DESC LIMIT 10`,
      [userId, serviceId],
    ),
  }
}

function shapeJourney(row, includeDetail = false) {
  const service = get(`SELECT * FROM government_services WHERE id = ?`, [row.service_id])
  const tasks = all(`SELECT * FROM service_journey_tasks WHERE journey_id = ? ORDER BY id`, [row.id]).map(shapeTask)
  const done = tasks.filter((task) => task.status === 'done').length
  const changed = Boolean(service && row.service_snapshot_at && service.updated_at > row.service_snapshot_at)
  const base = {
    id: row.id,
    reference: row.reference,
    title: row.title,
    serviceId: row.service_id,
    serviceSlug: service?.slug || null,
    serviceTitle: service?.title || null,
    status: row.status,
    statusLabel: STATUSES[row.status] || row.status,
    priority: row.priority,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    progress: { done, total: tasks.length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 },
    labels: { progress: 'Your preparation only' },
    requirementsChanged: changed,
    tasks,
  }
  if (!includeDetail) return base
  const snapshotAt = row.service_snapshot_at
  return {
    ...base,
    service: service
      ? {
          title: service.title,
          slug: service.slug,
          publicationStatus: service.publication_status,
          verificationStatus: service.verification_status,
          eligibility: service.eligibility,
          fees: service.fees,
          processingTime: service.processing_time,
          procedure: service.application_procedure,
          officialLink: service.official_link,
          sourceReference: service.source_reference,
          updatedAt: service.updated_at,
          capturedAt: snapshotAt,
        }
      : null,
    linked: linkedRecords(row.user_id, row.service_id),
    activity: all(
      `SELECT action, note, created_at FROM journey_activity WHERE journey_id = ? ORDER BY id DESC LIMIT 30`,
      [row.id],
    ),
    note: 'Progress counts only the preparation tasks you checked yourself. It is not official application progress, eligibility or approval, and BetterGo does not mark government requirements as completed.',
  }
}

function ownJourney(req, id) {
  const row = get(`SELECT * FROM service_journeys WHERE id = ? AND user_id = ?`, [Number(id), req.user.id])
  if (!row) throw notFound('Journey not found.')
  return row
}

function defaultTasks(serviceId) {
  const template = get(
    `SELECT * FROM journey_templates WHERE service_id = ? AND status = 'published' ORDER BY version DESC LIMIT 1`,
    [serviceId],
  )
  if (template) {
    return {
      templateVersion: template.version,
      tasks: all(`SELECT * FROM journey_template_steps WHERE template_id = ? ORDER BY sort_order`, [template.id]).map((step) => ({
        title: step.title,
        description: step.description,
        stepType: step.step_type,
        sourceRequirement: null,
      })),
    }
  }
  const requirements = all(
    `SELECT requirement_name, description, is_required, review_status FROM service_requirements WHERE service_id = ? ORDER BY sort_order, id`,
    [serviceId],
  )
  const tasks = requirements.map((row) => ({
    title: `Prepare: ${row.requirement_name}`,
    description: row.description,
    stepType: 'document',
    sourceRequirement: row.requirement_name,
  }))
  tasks.push(
    { title: 'Read the published requirements and eligibility information', stepType: 'review', sourceRequirement: null },
    { title: 'Plan how to submit: office visit, phone or a BetterGo intake form', stepType: 'preparation', sourceRequirement: null },
    { title: 'Check whether an appointment is needed', stepType: 'appointment', sourceRequirement: null },
  )
  return { templateVersion: null, tasks }
}

export const journeysRouter = Router()
journeysRouter.use(requireAuth)

journeysRouter.get(
  '/service-journeys',
  asyncHandler(async (req, res) => {
    const rows = all(`SELECT * FROM service_journeys WHERE user_id = ? ORDER BY id DESC LIMIT 100`, [req.user.id])
    const filtered = rows.filter((row) => {
      const service = get(`SELECT title, category_id, municipality_id FROM government_services WHERE id = ?`, [row.service_id])
      if (req.query.status && row.status !== String(req.query.status)) return false
      if (req.query.municipalityId && String(service?.municipality_id || '') !== String(req.query.municipalityId)) return false
      if (req.query.categoryId && String(service?.category_id || '') !== String(req.query.categoryId)) return false
      if (req.query.q && !`${row.title} ${service?.title || ''}`.toLowerCase().includes(String(req.query.q).toLowerCase())) return false
      return true
    })
    filtered.sort((a, b) => (req.query.sort === 'priority'
      ? String(b.priority).localeCompare(String(a.priority))
      : String(b.created_at).localeCompare(String(a.created_at))))
    const activeServiceIds = new Set(rows.filter((row) => ['active', 'paused'].includes(row.status)).map((row) => row.service_id))
    res.json({
      journeys: filtered.map((row) => shapeJourney(row)),
      availableServices: all(
        `SELECT g.id, g.title, g.slug, g.municipality_id, g.category_id, c.name AS category_name, m.name AS municipality_name,
                (SELECT COUNT(*) FROM journey_templates t WHERE t.service_id = g.id AND t.status = 'published') AS template_count
         FROM government_services g
         LEFT JOIN service_categories c ON c.id = g.category_id
         LEFT JOIN municipalities m ON m.id = g.municipality_id
         WHERE g.publication_status = 'published' ORDER BY g.title LIMIT 100`,
      ).filter((row) => !activeServiceIds.has(row.id)).map((row) => ({
        id: row.id,
        title: row.title,
        category: row.category_name,
        municipality: row.municipality_name || 'Province-wide',
        hasTemplate: Number(row.template_count) > 0,
      })),
      statuses: STATUSES,
      taskStatuses: TASK_STATUSES,
      priorities: PRIORITIES,
      note: 'Journeys organise your own preparation. They never decide eligibility, guarantee approval or replace official government records.',
      progressNote: 'Progress is calculated only from preparation tasks you checked yourself.',
    })
  }),
)

journeysRouter.post(
  '/service-journeys',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }),
  validate(
    z.object({
      serviceId: z.coerce.number().int().positive(),
      title: z.string().trim().max(120).optional().or(z.literal('')),
      priority: z.enum(Object.keys(PRIORITIES)).optional(),
      notes: z.string().trim().max(1000).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const service = get(`SELECT * FROM government_services WHERE id = ? AND publication_status = 'published'`, [req.body.serviceId])
    if (!service) throw unprocessable('Only a published service can be used for a journey.')
    const existing = get(
      `SELECT id FROM service_journeys WHERE user_id = ? AND service_id = ? AND status IN ('active','paused')`,
      [req.user.id, service.id],
    )
    if (existing) throw unprocessable('You already have an active journey for this service.')
    const built = defaultTasks(service.id)
    const id = Number(
      run(
        `INSERT INTO service_journeys (reference, user_id, service_id, municipality_id, title, priority, notes, service_snapshot_at, template_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reference(),
          req.user.id,
          service.id,
          service.municipality_id || null,
          cleanText(req.body.title, 120) || service.title,
          req.body.priority || 'normal',
          cleanText(req.body.notes, 1000),
          service.updated_at || nowIso(),
          built.templateVersion,
        ],
      ).lastInsertRowid,
    )
    for (const task of built.tasks) {
      run(
        `INSERT INTO service_journey_tasks (journey_id, title, description, step_type, source_requirement) VALUES (?, ?, ?, ?, ?)`,
        [id, task.title, task.description || null, task.stepType, task.sourceRequirement || null],
      )
    }
    activity(id, req.user.id, 'journey_started', `Started from ${service.title}.`)
    logAudit(req, { action: 'journey.created', module: 'journeys', entityType: 'service_journey', entityId: id })
    res.status(201).json({
      message: 'Journey started. Every task is your own preparation step, not an official requirement confirmed by BetterGo.',
      journey: shapeJourney(get(`SELECT * FROM service_journeys WHERE id = ?`, [id]), true),
    })
  }),
)

journeysRouter.get(
  '/service-journeys/:id',
  asyncHandler(async (req, res) => {
    const row = ownJourney(req, req.params.id)
    res.json({ journey: shapeJourney(row, true), taskStatuses: TASK_STATUSES, stepTypes: STEP_TYPES })
  }),
)

journeysRouter.patch(
  '/service-journeys/:id',
  validate(
    z.object({
      title: z.string().trim().min(2).max(120).optional(),
      priority: z.enum(Object.keys(PRIORITIES)).optional(),
      notes: z.string().trim().max(1000).optional().or(z.literal('')),
      status: z.enum(['active', 'paused', 'completed', 'archived']).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = ownJourney(req, req.params.id)
    const status = req.body.status || row.status
    run(
      `UPDATE service_journeys SET title = ?, priority = ?, notes = ?, status = ?, updated_at = ?,
        completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE completed_at END,
        archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at, ?) ELSE archived_at END
       WHERE id = ?`,
      [
        req.body.title === undefined ? row.title : cleanText(req.body.title, 120),
        req.body.priority || row.priority,
        req.body.notes === undefined ? row.notes : cleanText(req.body.notes, 1000),
        status,
        nowIso(),
        status,
        nowIso(),
        status,
        nowIso(),
        row.id,
      ],
    )
    if (req.body.status && req.body.status !== row.status) activity(row.id, req.user.id, `journey_${req.body.status}`)
    res.json({ message: 'Journey updated.', journey: shapeJourney(get(`SELECT * FROM service_journeys WHERE id = ?`, [row.id])) })
  }),
)

journeysRouter.post(
  '/service-journeys/:id/acknowledge-update',
  asyncHandler(async (req, res) => {
    const row = ownJourney(req, req.params.id)
    const service = get(`SELECT updated_at FROM government_services WHERE id = ?`, [row.service_id])
    run(`UPDATE service_journeys SET service_snapshot_at = ?, updated_at = ? WHERE id = ?`, [service?.updated_at || nowIso(), nowIso(), row.id])
    activity(row.id, req.user.id, 'update_reviewed', 'Reviewed published service changes. Completed tasks were kept.')
    res.json({ message: 'Service changes marked as reviewed. Your completed tasks were not changed.' })
  }),
)

journeysRouter.post(
  '/service-journeys/:id/tasks',
  validate(
    z.object({
      title: z.string().trim().min(2).max(160),
      description: z.string().trim().max(1000).optional().or(z.literal('')),
      stepType: z.enum(Object.keys(STEP_TYPES)).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      priority: z.enum(Object.keys(PRIORITIES)).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = ownJourney(req, req.params.id)
    if (['completed', 'archived'].includes(row.status)) throw unprocessable('Reopen the journey before adding tasks.')
    const id = Number(
      run(
        `INSERT INTO service_journey_tasks (journey_id, title, description, step_type, due_date, priority) VALUES (?, ?, ?, ?, ?, ?)`,
        [row.id, cleanText(req.body.title, 160), cleanText(req.body.description, 1000), req.body.stepType || 'preparation', req.body.dueDate || null, req.body.priority || 'normal'],
      ).lastInsertRowid,
    )
    run(`UPDATE service_journeys SET updated_at = ? WHERE id = ?`, [nowIso(), row.id])
    activity(row.id, req.user.id, 'task_added', cleanText(req.body.title, 160))
    res.status(201).json({ message: 'Preparation task added.', task: shapeTask(get(`SELECT * FROM service_journey_tasks WHERE id = ?`, [id])) })
  }),
)

journeysRouter.patch(
  '/service-journeys/:id/tasks/:taskId',
  validate(
    z.object({
      title: z.string().trim().min(2).max(160).optional(),
      description: z.string().trim().max(1000).optional().or(z.literal('')),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      priority: z.enum(Object.keys(PRIORITIES)).optional(),
      status: z.enum(Object.keys(TASK_STATUSES)).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = ownJourney(req, req.params.id)
    const task = get(`SELECT * FROM service_journey_tasks WHERE id = ? AND journey_id = ?`, [Number(req.params.taskId), row.id])
    if (!task) throw notFound('Task not found.')
    const status = req.body.status || task.status
    run(
      `UPDATE service_journey_tasks SET title = ?, description = ?, due_date = ?, priority = ?, status = ?,
        completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, ?) ELSE completed_at END, updated_at = ?
       WHERE id = ?`,
      [
        req.body.title === undefined ? task.title : cleanText(req.body.title, 160),
        req.body.description === undefined ? task.description : cleanText(req.body.description, 1000),
        req.body.dueDate === undefined ? task.due_date : req.body.dueDate,
        req.body.priority || task.priority,
        status,
        status,
        nowIso(),
        nowIso(),
        task.id,
      ],
    )
    run(`UPDATE service_journeys SET updated_at = ? WHERE id = ?`, [nowIso(), row.id])
    if (req.body.status && req.body.status !== task.status) activity(row.id, req.user.id, `task_${req.body.status}`, task.title)
    res.json({
      message: 'Task updated. This records your own preparation only.',
      task: shapeTask(get(`SELECT * FROM service_journey_tasks WHERE id = ?`, [task.id])),
    })
  }),
)

journeysRouter.delete(
  '/service-journeys/:id/tasks/:taskId',
  asyncHandler(async (req, res) => {
    const row = ownJourney(req, req.params.id)
    const task = get(`SELECT * FROM service_journey_tasks WHERE id = ? AND journey_id = ?`, [Number(req.params.taskId), row.id])
    if (!task) throw notFound('Task not found.')
    run(`DELETE FROM service_journey_tasks WHERE id = ?`, [task.id])
    run(`UPDATE service_journeys SET updated_at = ? WHERE id = ?`, [nowIso(), row.id])
    activity(row.id, req.user.id, 'task_removed', task.title)
    res.json({ message: 'Task removed.' })
  }),
)

/* -------------------------------- Admin --------------------------------- */

export const adminJourneysRouter = Router()
adminJourneysRouter.use(requireAuth, requireAdmin)

function scopedService(req, serviceId) {
  const service = get(`SELECT id, municipality_id, publication_status FROM government_services WHERE id = ?`, [serviceId])
  if (!service) return null
  const context = ctx(req)
  return context.hasGlobalScope || (service.municipality_id && canUseMunicipality(context, service.municipality_id)) ? service : null
}

adminJourneysRouter.get(
  '/service-journeys',
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const services = all(
      `SELECT g.id, g.title, g.slug, g.municipality_id, g.publication_status, g.updated_at,
              (SELECT COUNT(*) FROM service_journeys j WHERE j.service_id = g.id AND j.status IN ('active','paused')) AS active_journeys,
              (SELECT COUNT(*) FROM service_journeys j WHERE j.service_id = g.id AND j.service_snapshot_at < g.updated_at AND j.status = 'active') AS changed_journeys,
              (SELECT COUNT(*) FROM journey_templates t WHERE t.service_id = g.id AND t.status = 'published') AS published_templates
       FROM government_services g WHERE g.publication_status = 'published' ORDER BY g.title LIMIT 200`,
    ).filter((row) => context.hasGlobalScope || (row.municipality_id && canUseMunicipality(context, row.municipality_id)))
    const templates = services.map((row) => {
      const template = get(
        `SELECT * FROM journey_templates WHERE service_id = ? ORDER BY version DESC LIMIT 1`,
        [row.id],
      )
      return {
        serviceId: row.id,
        serviceTitle: row.title,
        activeJourneys: Number(row.active_journeys),
        changedJourneys: Number(row.changed_journeys),
        publishedTemplates: Number(row.published_templates),
        template: template
          ? {
              id: template.id,
              version: template.version,
              title: template.title,
              notes: template.notes,
              status: template.status,
              statusLabel: TEMPLATE_STATUSES[template.status] || template.status,
              steps: all(`SELECT title, description, step_type, sort_order FROM journey_template_steps WHERE template_id = ? ORDER BY sort_order`, [template.id]).map((step) => ({
                title: step.title,
                description: step.description,
                stepType: step.step_type,
                required: true,
              })),
            }
          : null,
      }
    })
    res.json({
      templates,
      summary: {
        publishedServices: services.length,
        withTemplates: templates.filter((row) => row.publishedTemplates > 0).length,
        activeJourneys: services.reduce((total, row) => total + Number(row.active_journeys), 0),
        journeysAffectedByChanges: services.reduce((total, row) => total + Number(row.changed_journeys), 0),
      },
      templateStatuses: TEMPLATE_STATUSES,
      stepTypes: STEP_TYPES,
      note: 'Templates define preparation steps only. Administrators cannot read citizen notes, tasks or documents here, and a template never decides eligibility.',
    })
  }),
)

adminJourneysRouter.put(
  '/service-journeys/services/:serviceId',
  requirePermission('services.view'),
  validate(
    z.object({
      title: z.string().trim().min(3).max(160),
      notes: z.string().trim().max(1000).optional().or(z.literal('')),
      status: z.enum(['draft', 'published', 'archived']),
      steps: z.array(
        z.object({
          title: z.string().trim().min(3).max(160),
          description: z.string().trim().max(500).optional().or(z.literal('')),
          stepType: z.enum(Object.keys(STEP_TYPES)).optional(),
        }),
      ).min(1).max(20),
    }),
  ),
  asyncHandler(async (req, res) => {
    const service = scopedService(req, Number(req.params.serviceId))
    if (!service) throw notFound('Service not found in your scope.')
    const latest = get(`SELECT * FROM journey_templates WHERE service_id = ? ORDER BY version DESC LIMIT 1`, [service.id])
    let templateId
    let version = latest ? Number(latest.version) : 0
    if (!latest) version = 1
    if (latest && req.body.status === 'published') {
      version = Number(latest.version) + (latest.status === 'published' ? 1 : 0)
    }
    if (!latest) {
      templateId = Number(
        run(
          `INSERT INTO journey_templates (service_id, version, title, notes, status, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
          [service.id, version, cleanText(req.body.title, 160), cleanText(req.body.notes, 1000), req.body.status, req.user.id],
        ).lastInsertRowid,
      )
    } else {
      templateId = Number(latest.id)
      run(`UPDATE journey_templates SET version = ?, title = ?, notes = ?, status = ?, updated_at = ?, published_at = ? WHERE id = ?`, [
        version,
        cleanText(req.body.title, 160),
        cleanText(req.body.notes, 1000),
        req.body.status,
        nowIso(),
        req.body.status === 'published' ? nowIso() : latest.published_at,
        templateId,
      ])
      run(`DELETE FROM journey_template_steps WHERE template_id = ?`, [templateId])
    }
    req.body.steps.forEach((step, index) => {
      run(`INSERT INTO journey_template_steps (template_id, title, description, step_type, sort_order) VALUES (?, ?, ?, ?, ?)`, [
        templateId,
        cleanText(step.title, 160),
        cleanText(step.description, 500),
        step.stepType || 'preparation',
        index,
      ])
    })
    logAudit(req, { action: 'journey.template_saved', module: 'journeys', entityType: 'journey_template', entityId: templateId })
    res.json({
      message: req.body.status === 'published' ? 'Journey template published. New journeys will use it.' : 'Journey template saved.',
      template: { id: templateId, version, status: req.body.status, steps: req.body.steps.length },
    })
  }),
)
