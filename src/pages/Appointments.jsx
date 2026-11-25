import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { CalendarDays, Clock } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Field, Input, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

function AppointmentCard({ appointment, onCancel, actions = true }) {
  const closed = ['cancelled_citizen', 'cancelled_admin', 'completed', 'no_show', 'rejected', 'expired'].includes(appointment.status)
  return (
    <div className="card">
      <div className="row-between">
        <strong>{appointment.serviceTitle}</strong>
        <Badge tone={appointment.status === 'confirmed' ? 'success' : closed ? 'neutral' : 'warning'}>{appointment.statusLabel}</Badge>
      </div>
      <div className="card-meta">
        <span><Link to={`/dashboard/appointments/${appointment.id}`}>{appointment.reference}</Link></span>
        <span>{appointment.date || 'Date to be proposed'} {appointment.time || ''}</span>
        {appointment.officeName ? <span>{appointment.officeName}</span> : null}
      </div>
      {appointment.decisionReason ? <p className="text-sm text-muted">Office note: {appointment.decisionReason}</p> : null}
      {actions && !closed ? <Button size="sm" variant="ghost" onClick={() => onCancel(appointment)}>Cancel appointment</Button> : null}
      <p className="text-xs text-muted">BetterGo appointment record — not an official government certificate or approval.</p>
    </div>
  )
}

export default function AppointmentsPage() {
  useDocumentTitle('Appointments')
  const { id } = useParams()
  const toast = useToast()
  const [center, setCenter] = useState(null)
  const [services, setServices] = useState([])
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState({ serviceSlug: '', date: '', slotId: '', note: '' })
  const [slots, setSlots] = useState([])

  const load = async () => {
    try {
      setCenter(await api.get('/account/appointments'))
      setServices((await api.get('/account/appointments/services')).results)
      if (id) setDetail((await api.get(`/account/appointments/${id}`)).appointment)
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadSlots = async (slug, date) => {
    try {
      setSlots((await api.get(`/account/appointments/services/${slug}/slots?date=${date}`)).slots)
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const cancel = async (appointment) => {
    if (!window.confirm('Cancel this appointment? No fee is recorded by BetterGo.')) return
    try {
      await api.post(`/account/appointments/${appointment.id}/cancel`, { reason: 'Cancelled by citizen' })
      toast.push('Appointment cancelled.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  if (!center) return <div className="section-tight"><SkeletonList count={4} height={80} /></div>

  if (id) {
    if (!detail) return <div className="section-tight"><SkeletonList count={3} height={80} /></div>
    return (
      <div className="section-tight">
        <PageHeader
          eyebrow="Appointment"
          title={detail.serviceTitle}
          description={`Reference ${detail.reference}`}
          breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Appointments', to: '/dashboard/appointments' }, { label: detail.reference }]}
        />
        <AppointmentCard appointment={detail} onCancel={cancel} />
        <div className="card">
          <h2 className="side-label">Status history</h2>
          {detail.events.map((event, index) => (
            <div className="text-sm" key={index}>{event.created_at?.slice(0, 16)} · {event.action.replaceAll('_', ' ')}{event.note ? ` — ${event.note}` : ''}</div>
          ))}
        </div>
        <a className="btn btn-ghost" href={`/api/account/appointments/${detail.id}/summary`} target="_blank" rel="noreferrer">Download BetterGo summary</a>
      </div>
    )
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Appointments"
        description="Request and manage appointments with services that have an office-configured appointment method."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Appointments' }]}
      />
      <Alert tone="info" title="What confirmation means">{center.notice}</Alert>

      <div className="grid grid-3">
        <div className="stat-card"><span className="stat-label">Pending</span><div className="stat-value">{center.totals.pending}</div></div>
        <div className="stat-card"><span className="stat-label">Confirmed</span><div className="stat-value">{center.totals.confirmed}</div></div>
        <div className="stat-card"><span className="stat-label">Completed</span><div className="stat-value">{center.totals.completed}</div></div>
      </div>

      {center.upcoming.length ? <><h2 className="side-label">Upcoming</h2>{center.upcoming.map((row) => <AppointmentCard key={row.id} appointment={row} onCancel={cancel} />)}</> : null}

      <div className="card">
        <h2 className="side-label">Request an appointment</h2>
        <div className="grid grid-2">
          <Field label="Service">
            <Select value={form.serviceSlug} onChange={(e) => { setForm({ ...form, serviceSlug: e.target.value, slotId: '' }); setSlots([]) }}>
              <option value="">Choose a service</option>
              {services.map((service) => <option key={service.id} value={service.slug}>{service.title} — {service.modeLabel}</option>)}
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => { setForm({ ...form, date: e.target.value }); if (form.serviceSlug) loadSlots(form.serviceSlug, e.target.value) }} />
          </Field>
        </div>
        {slots.length ? (
          <Field label="Office-configured time">
            <Select value={form.slotId} onChange={(e) => setForm({ ...form, slotId: e.target.value })}>
              <option value="">Request without a chosen time</option>
              {slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.start_time}–{slot.end_time}{slot.office_name ? ` · ${slot.office_name}` : ''}</option>)}
            </Select>
          </Field>
        ) : form.serviceSlug && form.date ? <p className="text-sm text-muted">No configured slots are recorded for that date. You can still submit a request for the office to schedule.</p> : null}
        <Field label="Note for the office (optional)"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        <Button
          icon={CalendarDays}
          onClick={async () => {
            try {
              const result = await api.post('/account/appointments', { serviceSlug: form.serviceSlug, slotId: form.slotId ? Number(form.slotId) : undefined, preferredDate: form.date || undefined, note: form.note })
              toast.push(result.message)
              setForm({ serviceSlug: '', date: '', slotId: '', note: '' })
              setSlots([])
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Submit appointment request
        </Button>
      </div>

      <h2 className="side-label">Appointment history</h2>
      {center.history.length ? center.history.map((row) => <AppointmentCard key={row.id} appointment={row} onCancel={cancel} />) : <EmptyState icon={Clock} title="No past appointments" description="Completed and cancelled appointments will appear here." />}
      <p className="text-xs text-muted">You can view an appointment from its card's reference in your history. BetterGo cannot confirm an appointment the office has not confirmed.</p>
      <Link className="btn btn-ghost" to="/dashboard/notifications">Notification settings</Link>
    </div>
  )
}
