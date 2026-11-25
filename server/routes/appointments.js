/**
 * Appointment scheduling (Prompt 74).
 *
 * Confirmed booking is only possible when an office has configured real slots.
 * Otherwise an appointment is a request awaiting office confirmation. A BetterGo
 * reference is a platform record, never an official government reference.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run, transaction } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const MODES = { none: 'No appointment functionality', walk_in: 'Walk-in information only', information_only: 'Information only', request: 'Request awaiting office confirmation', confirmed_booking: 'Slot-based booking request', external: 'External appointment booking' }
const STATUSES = ['draft', 'submitted', 'pending_confirmation', 'confirmed', 'reschedule_requested', 'cancelled_citizen', 'cancelled_admin', 'completed', 'no_show', 'rejected', 'expired']
const CLOSED = ['cancelled_citizen', 'cancelled_admin', 'completed', 'no_show', 'rejected', 'expired']
const PUBLISHED = `s.publication_status = 'published' AND s.archived_at IS NULL`

const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())

function notify(userId, title, message, appointmentId) {
  const prefs = get(`SELECT in_app_enabled FROM notification_preferences WHERE user_id = ?`, [userId])
  if (prefs && Number(prefs.in_app_enabled) === 0) return
  run(
    `INSERT INTO notifications (user_id, title, message, notification_type, category, related_entity_type, related_entity_id)
     VALUES (?, ?, ?, 'appointment', 'account', 'appointment', ?)`,
    [userId, title, message, appointmentId],
  )
}

function addEvent(id, action, from, to, actorType, actorId, note = null) {
  run(`INSERT INTO appointment_events (appointment_id, actor_type, actor_id, action, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    id,
    actorType,
    actorId,
    action,
    from || null,
    to || null,
    note ? cleanText(note, 500) : null,
  ])
}

function reference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let code = 'BG-APT-'
    for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)]
    if (!get(`SELECT id FROM appointments WHERE reference = ?`, [code])) return code
  }
  throw unprocessable('Could not generate an appointment reference. Please retry.')
}

function settingsFor(serviceId) {
  return get(`SELECT * FROM appointment_settings WHERE service_id = ?`, [serviceId])
}

function assertSlot(serviceId, slotId) {
  const slot = get(`SELECT * FROM appointment_slots WHERE id = ? AND service_id = ?`, [Number(slotId), serviceId])
  if (!slot) throw unprocessable('That time slot is not available for this service.')
  if (slot.status !== 'open') throw unprocessable('That time slot is closed.')
  if (slot.slot_date < manilaToday()) throw unprocessable('That time slot is in the past.')
  if (Number(slot.booked) >= Number(slot.capacity)) throw unprocessable('That time slot is already full.')
  return slot
}

function shape(row) {
  const service = get(`SELECT title, slug FROM government_services WHERE id = ?`, [row.service_id])
  return {
    id: row.id,
    reference: row.reference,
    serviceTitle: service?.title,
    serviceSlug: service?.slug,
    mode: row.appointment_mode_snapshot || null,
    date: row.appointment_date,
    time: row.appointment_time,
    officeName: row.office_name,
    location: row.location,
    status: row.status,
    statusLabel: STATUSES.includes(row.status) ? row.status.replaceAll('_', ' ') : row.status,
    citizenNote: row.citizen_note,
    decisionReason: row.decision_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events: all(`SELECT action, from_status, to_status, note, actor_type, created_at FROM appointment_events WHERE appointment_id = ? ORDER BY id`, [row.id]),
  }
}

function citizenAppointment(userId, id) {
  const row = get(`SELECT * FROM appointments WHERE id = ? AND user_id = ?`, [Number(id), userId])
  if (!row) throw notFound('Appointment not found.')
  return row
}

function releaseSlot(row) {
  if (row.slot_id) run(`UPDATE appointment_slots SET booked = MAX(booked - 1, 0) WHERE id = ?`, [row.slot_id])
}

export const appointmentsRouter = Router()
appointmentsRouter.use(requireAuth)

appointmentsRouter.get(
  '/appointments',
  asyncHandler(async (req, res) => {
    const rows = all(`SELECT * FROM appointments WHERE user_id = ? ORDER BY COALESCE(appointment_date, created_at) DESC LIMIT 100`, [req.user.id])
    const shaped = rows.map(shape)
    res.json({
      upcoming: shaped.filter((row) => ['pending_confirmation', 'confirmed', 'reschedule_requested'].includes(row.status)),
      history: shaped.filter((row) => CLOSED.includes(row.status)),
      totals: {
        pending: shaped.filter((row) => row.status === 'pending_confirmation').length,
        confirmed: shaped.filter((row) => row.status === 'confirmed').length,
        completed: shaped.filter((row) => row.status === 'completed').length,
      },
      notice: 'A BetterGo appointment record is not an official government confirmation until the responsible office confirms it.',
    })
  }),
)

appointmentsRouter.get(
  '/appointments/services',
  asyncHandler(async (_req, res) => {
    res.json({
      results: all(
        `SELECT s.id, s.title, s.slug, a.appointment_mode, a.instructions, a.external_url, a.office_name, a.location, m.name AS municipality_name
         FROM government_services s JOIN appointment_settings a ON a.service_id = s.id
         LEFT JOIN municipalities m ON m.id = s.municipality_id
         WHERE ${PUBLISHED} AND a.appointment_mode IN ('request','confirmed_booking','walk_in','information_only','external')
         ORDER BY s.title LIMIT 60`,
      ).map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        mode: row.appointment_mode,
        modeLabel: MODES[row.appointment_mode],
        instructions: row.instructions,
        externalUrl: row.appointment_mode === 'external' ? row.external_url : null,
        officeName: row.office_name,
        location: row.location,
        municipalityName: row.municipality_name,
      })),
      modes: MODES,
      note: 'Only services with an office-configured appointment method appear here.',
    })
  }),
)

appointmentsRouter.get(
  '/appointments/services/:slug/slots',
  asyncHandler(async (req, res) => {
    const service = get(`SELECT id, title FROM government_services WHERE slug = ? AND ${PUBLISHED}`, [String(req.params.slug)])
    if (!service) throw notFound('Service not found.')
    const settings = settingsFor(service.id)
    if (!settings || !['request', 'confirmed_booking'].includes(settings.appointment_mode)) {
      throw unprocessable('This service does not take BetterGo appointment requests.')
    }
    const date = req.query.date ? String(req.query.date) : manilaToday()
    const slots = all(
      `SELECT id, slot_date, start_time, end_time, capacity, booked, office_name, location, notes FROM appointment_slots
       WHERE service_id = ? AND slot_date = ? AND status = 'open' AND booked < capacity AND slot_date >= ?
       ORDER BY start_time`,
      [service.id, date, manilaToday()],
    )
    const blackout = get(`SELECT reason FROM appointment_blackouts WHERE blackout_date = ? AND (service_id = ? OR service_id IS NULL) LIMIT 1`, [date, service.id])
    res.json({
      service: { id: service.id, title: service.title },
      date,
      slots: blackout ? [] : slots.map((slot) => ({ ...slot, location: slot.location || settings.location })),
      blackoutReason: blackout?.reason || null,
      mode: settings.appointment_mode,
      instructions: settings.instructions,
      note: slots.length ? 'Times are shown as configured by the responsible office.' : 'No office-configured slots are recorded for this date. This does not mean the office is closed.',
    })
  }),
)

appointmentsRouter.get(
  '/appointments/:id',
  asyncHandler(async (req, res) => {
    res.json({ appointment: shape(citizenAppointment(req.user.id, req.params.id)) })
  }),
)

appointmentsRouter.get(
  '/appointments/:id/summary',
  asyncHandler(async (req, res) => {
    const row = citizenAppointment(req.user.id, req.params.id)
    const shaped = shape(row)
    const lines = [
      'BetterGo appointment record — not an official government certificate or approval.',
      `Reference: ${shaped.reference}`,
      `Service: ${shaped.serviceTitle}`,
      `Status: ${shaped.statusLabel}`,
      `Date: ${shaped.date || 'To be proposed'} ${shaped.time || ''}`,
      `Office: ${shaped.officeName || 'Not recorded'}`,
      `Location: ${shaped.location || 'Not recorded'}`,
      'Confirm details with the responsible office.',
    ]
    res.type('text/plain').send(lines.join('\n'))
  }),
)

appointmentsRouter.post(
  '/appointments',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 12 }),
  validate(
    z.object({
      serviceSlug: z.string().trim().min(1).max(160),
      slotId: z.coerce.number().int().positive().optional(),
      preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      preferredTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      note: z.string().trim().max(500).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const service = get(`SELECT id, title, municipality_id FROM government_services WHERE slug = ? AND publication_status = 'published' AND archived_at IS NULL`, [req.body.serviceSlug])
    if (!service) throw notFound('Service not found.')
    const settings = settingsFor(service.id)
    if (!settings || !['request', 'confirmed_booking'].includes(settings.appointment_mode)) {
      throw unprocessable('This service does not accept BetterGo appointment requests.')
    }
    const openCount = Number(
      get(`SELECT COUNT(*) AS n FROM appointments WHERE user_id = ? AND status IN ('pending_confirmation','confirmed','reschedule_requested')`, [req.user.id]).n,
    )
    if (openCount >= 5) throw unprocessable('You already have several open appointment requests. Cancel one before adding another.')

    let slot = null
    if (req.body.slotId) slot = assertSlot(service.id, req.body.slotId)

    const confirmed = Boolean(slot && settings.appointment_mode === 'confirmed_booking')
    const status = confirmed ? 'confirmed' : 'pending_confirmation'
    const ref = reference()

    const id = transaction(() => {
      if (slot) {
        const updated = run(`UPDATE appointment_slots SET booked = booked + 1 WHERE id = ? AND status = 'open' AND booked < capacity`, [slot.id])
        if (!updated.changes) throw unprocessable('That time slot was just taken. Choose another.')
      }
      const inserted = run(
        `INSERT INTO appointments (reference, user_id, service_id, slot_id, municipality_id, office_name, location, appointment_date, appointment_time, status, citizen_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ref,
          req.user.id,
          service.id,
          slot?.id || null,
          slot?.municipality_id || service.municipality_id || null,
          slot?.office_name || settings.office_name || null,
          settings.location || null,
          slot?.slot_date || req.body.preferredDate || null,
          slot?.start_time || req.body.preferredTime || null,
          status,
          cleanText(req.body.note, 500),
        ],
      )
      const newId = Number(inserted.lastInsertRowid)
      addEvent(newId, 'submitted', null, status, 'citizen', req.user.id, req.body.note)
      if (confirmed) addEvent(newId, 'confirmed', status, status, 'system', null, 'Slot reserved by a configured booking arrangement.')
      return newId
    })

    notify(
      req.user.id,
      confirmed ? 'Appointment slot reserved' : 'Appointment request received',
      confirmed
        ? `Your BetterGo appointment ${ref} is reserved for ${slot.slot_date} ${slot.start_time}. The office may still contact you.`
        : `Your request ${ref} was submitted to BetterGo and is waiting for office confirmation.`,
      id,
    )
    res.status(201).json({
      message: confirmed
        ? 'Slot reserved. This is a BetterGo record; confirm with the office before travelling.'
        : 'Appointment request submitted. It is not confirmed until the responsible office confirms it.',
      appointment: shape(get(`SELECT * FROM appointments WHERE id = ?`, [id])),
    })
  }),
)

appointmentsRouter.post(
  '/appointments/:id/cancel',
  validate(z.object({ reason: z.string().trim().max(300).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const row = citizenAppointment(req.user.id, req.params.id)
    if (CLOSED.includes(row.status)) throw unprocessable('This appointment is already closed.')
    transaction(() => {
      releaseSlot(row)
      run(`UPDATE appointments SET status = 'cancelled_citizen', decision_reason = ?, updated_at = ? WHERE id = ?`, [cleanText(req.body.reason, 300), nowIso(), row.id])
      addEvent(row.id, 'cancelled_by_citizen', row.status, 'cancelled_citizen', 'citizen', req.user.id, req.body.reason)
    })
    notify(req.user.id, 'Appointment cancelled', `Your appointment ${row.reference} was cancelled. No fee or penalty is recorded by BetterGo.`, row.id)
    res.json({ message: 'Appointment cancelled.', appointment: shape(get(`SELECT * FROM appointments WHERE id = ?`, [row.id])) })
  }),
)

appointmentsRouter.post(
  '/appointments/:id/reschedule',
  validate(
    z.object({
      slotId: z.coerce.number().int().positive().optional(),
      preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      preferredTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      reason: z.string().trim().max(300).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = citizenAppointment(req.user.id, req.params.id)
    if (!['pending_confirmation', 'confirmed'].includes(row.status)) throw unprocessable('This appointment cannot be rescheduled now.')
    const settings = settingsFor(row.service_id)
    if (!settings) throw unprocessable('This service has no appointment configuration.')
    const slot = req.body.slotId ? assertSlot(row.service_id, req.body.slotId) : null
    if (!slot && !req.body.preferredDate) throw unprocessable('Choose a slot or a preferred date.')

    transaction(() => {
      if (slot) {
        const updated = run(`UPDATE appointment_slots SET booked = booked + 1 WHERE id = ? AND status = 'open' AND booked < capacity`, [slot.id])
        if (!updated.changes) throw unprocessable('That time slot was just taken. Choose another.')
      }
      releaseSlot(row)
      run(
        `UPDATE appointments SET status = 'reschedule_requested', slot_id = ?, appointment_date = ?, appointment_time = ?, decision_reason = ?, updated_at = ? WHERE id = ?`,
        [
          slot?.id || null,
          slot?.slot_date || req.body.preferredDate,
          slot?.start_time || req.body.preferredTime || null,
          cleanText(req.body.reason, 300),
          nowIso(),
          row.id,
        ],
      )
      addEvent(row.id, 'reschedule_requested', row.status, 'reschedule_requested', 'citizen', req.user.id, req.body.reason)
    })
    notify(req.user.id, 'Reschedule requested', `Your request to change ${row.reference} is waiting for office confirmation.`, row.id)
    res.json({ message: 'Reschedule request submitted. The appointment is not changed until the office confirms.', appointment: shape(get(`SELECT * FROM appointments WHERE id = ?`, [row.id])) })
  }),
)

/* ------------------------------ Admin ---------------------------------- */

export const adminAppointmentsRouter = Router()
adminAppointmentsRouter.use(requireAuth, requireAdmin)

function scopedAppointment(req, id) {
  const row = get(`SELECT * FROM appointments WHERE id = ?`, [Number(id)])
  if (!row) throw notFound('Appointment not found.')
  if (!canUseAppointment(req, row)) throw notFound('Appointment not found.')
  return row
}

function canUseAppointment(req, row) {
  const context = ctx(req)
  if (context.hasGlobalScope) return true
  return Boolean(row.municipality_id && canUseMunicipality(context, row.municipality_id))
}

adminAppointmentsRouter.get(
  '/appointments',
  requirePermission('services.view'),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const filters = []
    const params = []
    if (req.query.status) {
      filters.push('a.status = ?')
      params.push(String(req.query.status))
    }
    if (req.query.serviceId) {
      filters.push('a.service_id = ?')
      params.push(Number(req.query.serviceId))
    }
    if (!context.hasGlobalScope) {
      if (!context.municipalityIds.length) return res.json({ results: [], totals: {}, note: 'No municipality scope assigned.' })
      filters.push(`a.municipality_id IN (${context.municipalityIds.map(() => '?').join(',')})`)
      params.push(...context.municipalityIds)
    }
    const rows = all(
      `SELECT a.*, s.title AS service_title, u.name AS citizen_name FROM appointments a JOIN government_services s ON s.id = a.service_id JOIN users u ON u.id = a.user_id
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY COALESCE(a.appointment_date, a.created_at) DESC LIMIT 100`,
      params,
    )
    res.json({
      results: rows.map((row) => ({ ...shape(row), serviceTitle: row.service_title, citizenName: row.citizen_name })),
      totals: {
        pending: rows.filter((row) => row.status === 'pending_confirmation').length,
        confirmed: rows.filter((row) => row.status === 'confirmed').length,
        reschedule: rows.filter((row) => row.status === 'reschedule_requested').length,
      },
      statuses: STATUSES,
      note: 'Aggregated office workload only. Do not use these records as official LGU performance data.',
    })
  }),
)

adminAppointmentsRouter.get(
  '/appointments/:id',
  requirePermission('services.view'),
  asyncHandler(async (req, res) => {
    res.json({ appointment: shape(scopedAppointment(req, req.params.id)) })
  }),
)

async function adminAction(req, res, status, action, noteLabel, notifyText) {
  const row = scopedAppointment(req, req.params.id)
  if (CLOSED.includes(row.status)) throw unprocessable('This appointment is already closed.')
  if (status === 'rejected' && !String(req.body.reason || '').trim()) throw unprocessable('An explanation is required when rejecting a request.')
  transaction(() => {
    if (['rejected', 'cancelled_admin', 'no_show'].includes(status)) releaseSlot(row)
    run(`UPDATE appointments SET status = ?, decision_reason = ?, updated_at = ? WHERE id = ?`, [status, cleanText(req.body.reason, 500), nowIso(), row.id])
    addEvent(row.id, action, row.status, status, 'admin', req.user.id, req.body.reason || req.body.note)
  })
  notify(row.user_id, notifyText, `Appointment ${row.reference}: ${noteLabel}${req.body.reason ? ` — ${req.body.reason}` : ''}`, row.id)
  res.json({ message: `Appointment marked ${noteLabel}.`, appointment: shape(get(`SELECT * FROM appointments WHERE id = ?`, [row.id])) })
}

for (const [path, status, action, label, text] of [
  ['confirm', 'confirmed', 'confirmed', 'confirmed', 'Appointment confirmed'],
  ['reject', 'rejected', 'rejected', 'rejected', 'Appointment request rejected'],
  ['cancel', 'cancelled_admin', 'cancelled_by_admin', 'cancelled by the office', 'Appointment cancelled by the office'],
  ['complete', 'completed', 'completed', 'completed', 'Appointment completed'],
  ['no-show', 'no_show', 'no_show', 'recorded as no-show', 'No-show recorded'],
  ['propose-schedule', 'pending_confirmation', 'schedule_proposed', 'schedule proposed', 'Another schedule proposed'],
]) {
  adminAppointmentsRouter.post(
    `/appointments/:id/${path}`,
    requirePermission('services.update'),
    validate(z.object({ reason: z.string().trim().max(500).optional().or(z.literal('')), note: z.string().trim().max(500).optional().or(z.literal('')) })),
    asyncHandler((req, res) => adminAction(req, res, status, action, label, text)),
  )
}

adminAppointmentsRouter.patch(
  '/appointments/:id/note',
  requirePermission('services.update'),
  validate(z.object({ note: z.string().trim().max(1000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const row = scopedAppointment(req, req.params.id)
    run(`UPDATE appointments SET internal_note = ?, updated_at = ? WHERE id = ?`, [cleanText(req.body.note, 1000), nowIso(), row.id])
    res.json({ message: 'Internal note saved.' })
  }),
)

adminAppointmentsRouter.get(
  '/appointment-settings/:serviceId',
  requirePermission('services.view'),
  asyncHandler(async (req, res) => {
    const service = get(`SELECT * FROM government_services WHERE id = ?`, [Number(req.params.serviceId)])
    if (!service) throw notFound('Service not found.')
    if (!ctx(req).hasGlobalScope && !(service.municipality_id && canUseMunicipality(ctx(req), service.municipality_id))) throw notFound('Service not found.')
    res.json({
      settings: settingsFor(service.id),
      slots: all(`SELECT * FROM appointment_slots WHERE service_id = ? AND slot_date >= ? ORDER BY slot_date, start_time LIMIT 100`, [service.id, manilaToday()]),
      blackouts: all(`SELECT * FROM appointment_blackouts WHERE service_id = ? OR service_id IS NULL ORDER BY blackout_date LIMIT 50`, [service.id]),
      modes: MODES,
    })
  }),
)

adminAppointmentsRouter.put(
  '/appointment-settings/:serviceId',
  requirePermission('services.update'),
  validate(
    z.object({
      appointmentMode: z.enum(Object.keys(MODES)),
      externalUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
      instructions: z.string().trim().max(2000).optional().or(z.literal('')),
      officeName: z.string().trim().max(200).optional().or(z.literal('')),
      location: z.string().trim().max(300).optional().or(z.literal('')),
      bookingWindowDays: z.coerce.number().int().min(1).max(180).optional(),
      slotMinutes: z.coerce.number().int().min(5).max(240).optional(),
      capacityPerSlot: z.coerce.number().int().min(1).max(100).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const service = get(`SELECT * FROM government_services WHERE id = ?`, [Number(req.params.serviceId)])
    if (!service) throw notFound('Service not found.')
    if (!ctx(req).hasGlobalScope && !(service.municipality_id && canUseMunicipality(ctx(req), service.municipality_id))) throw notFound('Service not found.')
    if (req.body.appointmentMode === 'external' && !req.body.externalUrl) throw unprocessable('An external booking link is required for external appointment mode.')
    run(
      `INSERT INTO appointment_settings (service_id, appointment_mode, external_url, instructions, office_name, location, booking_window_days, slot_minutes, capacity_per_slot, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(service_id) DO UPDATE SET appointment_mode = excluded.appointment_mode, external_url = excluded.external_url,
         instructions = excluded.instructions, office_name = excluded.office_name, location = excluded.location,
         booking_window_days = excluded.booking_window_days, slot_minutes = excluded.slot_minutes,
         capacity_per_slot = excluded.capacity_per_slot, updated_at = excluded.updated_at`,
      [
        service.id,
        req.body.appointmentMode,
        cleanText(req.body.externalUrl, 500),
        cleanText(req.body.instructions, 2000),
        cleanText(req.body.officeName, 200),
        cleanText(req.body.location, 300),
        req.body.bookingWindowDays || 14,
        req.body.slotMinutes || 30,
        req.body.capacityPerSlot || 1,
        nowIso(),
      ],
    )
    logAudit(req, { action: 'appointments.settings_updated', module: 'appointments', entityType: 'government_service', entityId: service.id })
    res.json({ message: 'Appointment configuration saved. Only configured slots are ever shown.', settings: settingsFor(service.id) })
  }),
)

adminAppointmentsRouter.post(
  '/appointment-slots',
  requirePermission('services.update'),
  validate(
    z.object({
      serviceId: z.coerce.number().int().positive(),
      slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      capacity: z.coerce.number().int().min(1).max(100).optional(),
      officeName: z.string().trim().max(200).optional().or(z.literal('')),
      location: z.string().trim().max(300).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const service = get(`SELECT * FROM government_services WHERE id = ?`, [req.body.serviceId])
    if (!service) throw notFound('Service not found.')
    if (!ctx(req).hasGlobalScope && !(service.municipality_id && canUseMunicipality(ctx(req), service.municipality_id))) throw notFound('Service not found.')
    if (req.body.slotDate < manilaToday()) throw unprocessable('A slot cannot be created in the past.')
    try {
      const id = Number(
        run(
          `INSERT INTO appointment_slots (service_id, municipality_id, office_name, slot_date, start_time, end_time, capacity)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [service.id, service.municipality_id || null, cleanText(req.body.officeName, 200), req.body.slotDate, req.body.startTime, req.body.endTime, req.body.capacity || 1],
        ).lastInsertRowid,
      )
      res.status(201).json({ message: 'Slot created.', id })
    } catch {
      throw unprocessable('A slot with that service, date and start time already exists.')
    }
  }),
)

adminAppointmentsRouter.delete(
  '/appointment-slots/:id',
  requirePermission('services.update'),
  asyncHandler(async (req, res) => {
    const slot = get(`SELECT * FROM appointment_slots WHERE id = ?`, [Number(req.params.id)])
    if (!slot) throw notFound('Slot not found.')
    const service = get(`SELECT id, municipality_id FROM government_services WHERE id = ?`, [slot.service_id])
    if (!ctx(req).hasGlobalScope && !(service.municipality_id && canUseMunicipality(ctx(req), service.municipality_id))) throw notFound('Slot not found.')
    if (Number(slot.booked) > 0) throw unprocessable('This slot has reserved appointments. Close it instead of deleting it.')
    run(`DELETE FROM appointment_slots WHERE id = ?`, [slot.id])
    res.json({ message: 'Slot deleted.' })
  }),
)

adminAppointmentsRouter.post(
  '/appointment-blackouts',
  requirePermission('services.update'),
  validate(z.object({ serviceId: z.coerce.number().int().positive().optional(), blackoutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().max(300).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    if (!ctx(req).hasGlobalScope) throw unprocessable('Only province-level administrators can declare office closures.')
    run(`INSERT INTO appointment_blackouts (service_id, blackout_date, reason) VALUES (?, ?, ?)`, [req.body.serviceId || null, req.body.blackoutDate, cleanText(req.body.reason, 300)])
    res.status(201).json({ message: 'Unavailable date recorded.' })
  }),
)

adminAppointmentsRouter.get(
  '/appointments-analytics',
  requirePermission('province.analytics.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      totals: {
        requests: Number(get(`SELECT COUNT(*) AS n FROM appointments`).n),
        confirmed: Number(get(`SELECT COUNT(*) AS n FROM appointments WHERE status = 'confirmed'`).n),
        pending: Number(get(`SELECT COUNT(*) AS n FROM appointments WHERE status = 'pending_confirmation'`).n),
        completed: Number(get(`SELECT COUNT(*) AS n FROM appointments WHERE status = 'completed'`).n),
        cancelled: Number(get(`SELECT COUNT(*) AS n FROM appointments WHERE status LIKE 'cancelled%'`).n),
        noShow: Number(get(`SELECT COUNT(*) AS n FROM appointments WHERE status = 'no_show'`).n),
      },
      capacity: all(`SELECT slot_date, SUM(capacity) AS capacity, SUM(booked) AS booked FROM appointment_slots WHERE slot_date >= ? GROUP BY slot_date ORDER BY slot_date LIMIT 30`, [manilaToday()]),
      note: 'Actual BetterGo appointment records only. This is not official LGU performance data and never lists citizens.',
    })
  }),
)
