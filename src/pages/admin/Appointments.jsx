import { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

const ACTIONS = {
  pending_confirmation: [['confirm', 'Confirm'], ['reject', 'Reject']],
  confirmed: [['cancel', 'Cancel'], ['complete', 'Complete'], ['no-show', 'No-show']],
  reschedule_requested: [['confirm', 'Confirm new time'], ['propose-schedule', 'Propose another schedule']],
}

export function AdminAppointments() {
  useDocumentTitle('Appointments administration')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [config, setConfig] = useState(null)
  const [settingsForm, setSettingsForm] = useState({ appointmentMode: 'none', instructions: '', officeName: '', location: '', externalUrl: '' })
  const [slotForm, setSlotForm] = useState({ slotDate: '', startTime: '09:00', endTime: '09:30', capacity: 1 })
  const [analytics, setAnalytics] = useState(null)

  const load = async () => {
    try {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (serviceId) params.set('serviceId', serviceId)
      setData(await api.get(`/admin/appointments?${params.toString()}`))
      setAnalytics(await api.get('/admin/appointments-analytics').catch(() => null))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const loadConfig = async () => {
    try {
      const result = await api.get(`/admin/appointment-settings/${serviceId}`)
      setConfig(result)
      setSettingsForm({
        appointmentMode: result.settings?.appointment_mode || 'none',
        instructions: result.settings?.instructions || '',
        officeName: result.settings?.office_name || '',
        location: result.settings?.location || '',
        externalUrl: result.settings?.external_url || '',
      })
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (appointment, action) => {
    const reason = window.prompt('Reason shown to the citizen (optional)') || ''
    try {
      await api.post(`/admin/appointments/${appointment.id}/${action}`, { reason })
      toast.push('Appointment updated.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Appointments"
        description="Review requests, record office decisions and configure real appointment slots. Only configured slots are ever offered."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Appointments' }]}
      />

      <div className="card">
        <div className="row">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
            <option value="">All statuses</option>
            {Object.keys(ACTIONS).map((key) => <option key={key} value={key}>{key.replaceAll('_', ' ')}</option>)}
            <option value="completed">completed</option>
            <option value="cancelled_citizen">cancelled by citizen</option>
          </Select>
          <Input value={serviceId} onChange={(e) => setServiceId(e.target.value)} placeholder="Service ID for configuration" inputMode="numeric" aria-label="Service ID" />
          <Button variant="outline" onClick={loadConfig} disabled={!serviceId}>Load configuration</Button>
        </div>
        {data ? <p className="text-sm text-muted">{data.results.length} records in your authorized scope. {data.note}</p> : null}
      </div>

      {!data ? <SkeletonList count={3} height={80} /> : data.results.map((appointment) => (
        <div className="card" key={appointment.id}>
          <div className="row-between">
            <strong>{appointment.reference} · {appointment.serviceTitle}</strong>
            <Badge tone={appointment.status === 'confirmed' ? 'success' : 'warning'}>{appointment.status.replaceAll('_', ' ')}</Badge>
          </div>
          <div className="card-meta">
            <span>{appointment.date || 'No date'} {appointment.time || ''}</span>
            <span>{appointment.officeName || 'Office not recorded'}</span>
            <span>Citizen: {appointment.citizenName}</span>
          </div>
          <div className="row">
            {(ACTIONS[appointment.status] || []).map(([action, label]) => (
              <Button key={action} size="sm" variant="outline" onClick={() => act(appointment, action)}>{label}</Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const note = window.prompt('Private internal note') || ''
                try {
                  await api.patch(`/admin/appointments/${appointment.id}/note`, { note })
                  toast.push('Internal note saved.')
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Internal note
            </Button>
          </div>
        </div>
      ))}

      {config ? (
        <div className="stack">
          <Alert tone="info" title="Configuration is a platform record">BetterGo rules are not official office policies. Publish only arrangements confirmed by the responsible office.</Alert>
          <form
            className="card"
            onSubmit={async (event) => {
              event.preventDefault()
              try {
                await api.put(`/admin/appointment-settings/${serviceId}`, settingsForm)
                toast.push('Appointment configuration saved.')
                await loadConfig()
              } catch (err) {
                toast.push(err.message, 'error')
              }
            }}
          >
            <h2 className="side-label">Appointment method</h2>
            <Field label="Method">
              <Select value={settingsForm.appointmentMode} onChange={(e) => setSettingsForm({ ...settingsForm, appointmentMode: e.target.value })}>
                {Object.entries(config.modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <Field label="Office name"><Input value={settingsForm.officeName} onChange={(e) => setSettingsForm({ ...settingsForm, officeName: e.target.value })} /></Field>
            <Field label="Location"><Input value={settingsForm.location} onChange={(e) => setSettingsForm({ ...settingsForm, location: e.target.value })} /></Field>
            <Field label="Instructions"><Input value={settingsForm.instructions} onChange={(e) => setSettingsForm({ ...settingsForm, instructions: e.target.value })} /></Field>
            <Field label="External booking URL (external mode only)"><Input type="url" value={settingsForm.externalUrl} onChange={(e) => setSettingsForm({ ...settingsForm, externalUrl: e.target.value })} /></Field>
            <Button type="submit">Save configuration</Button>
          </form>

          <form
            className="card"
            onSubmit={async (event) => {
              event.preventDefault()
              try {
                await api.post('/admin/appointment-slots', { ...slotForm, serviceId: Number(serviceId), capacity: Number(slotForm.capacity) })
                toast.push('Slot created.')
                await loadConfig()
              } catch (err) {
                toast.push(err.message, 'error')
              }
            }}
          >
            <h2 className="side-label">Add an office slot</h2>
            <div className="grid grid-4">
              <Field label="Date"><Input type="date" value={slotForm.slotDate} onChange={(e) => setSlotForm({ ...slotForm, slotDate: e.target.value })} required /></Field>
              <Field label="Start"><Input type="time" value={slotForm.startTime} onChange={(e) => setSlotForm({ ...slotForm, startTime: e.target.value })} required /></Field>
              <Field label="End"><Input type="time" value={slotForm.endTime} onChange={(e) => setSlotForm({ ...slotForm, endTime: e.target.value })} required /></Field>
              <Field label="Capacity"><Input type="number" min="1" value={slotForm.capacity} onChange={(e) => setSlotForm({ ...slotForm, capacity: e.target.value })} /></Field>
            </div>
            <Button type="submit" icon={CalendarDays}>Create slot</Button>
            {config.slots.map((slot) => (
              <div className="row-between text-sm" key={slot.id}>
                <span>{slot.slot_date} {slot.start_time}–{slot.end_time} · {slot.booked}/{slot.capacity}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await api.delete(`/admin/appointment-slots/${slot.id}`)
                      await loadConfig()
                    } catch (err) {
                      toast.push(err.message, 'error')
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            ))}
          </form>
        </div>
      ) : null}

      {analytics ? (
        <div className="card">
          <h2 className="side-label">Appointment records</h2>
          <div className="grid grid-3">
            <div className="stat-card"><span className="stat-label">Requests</span><div className="stat-value">{analytics.totals.requests}</div></div>
            <div className="stat-card"><span className="stat-label">Confirmed</span><div className="stat-value">{analytics.totals.confirmed}</div></div>
            <div className="stat-card"><span className="stat-label">Completed</span><div className="stat-value">{analytics.totals.completed}</div></div>
          </div>
          <p className="text-sm text-muted">{analytics.note}</p>
        </div>
      ) : null}
    </div>
  )
}
