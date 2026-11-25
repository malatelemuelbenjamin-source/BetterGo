import { useEffect, useState } from 'react'
import { Compass, Plus } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

export default function ServiceJourneysPage() {
  useDocumentTitle('Service journeys')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [detail, setDetail] = useState(null)
  const [filters, setFilters] = useState({ q: '', status: '', sort: 'created' })
  const [form, setForm] = useState({ serviceId: '', priority: 'normal' })
  const [task, setTask] = useState({ title: '', dueDate: '', priority: 'normal' })

  const load = async (id = detail?.id) => {
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString()
      setData(await api.get(`/account/service-journeys${params ? `?${params}` : ''}`))
      if (id) setDetail((await api.get(`/account/service-journeys/${id}`)).journey)
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load(null) }, [filters.status, filters.sort]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (id) => {
    try {
      setDetail((await api.get(`/account/service-journeys/${id}`)).journey)
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const updateTask = async (row, changes) => {
    try {
      await api.patch(`/account/service-journeys/${detail.id}/tasks/${row.id}`, changes)
      await open(detail.id)
      await load(detail.id)
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  if (!data) return <div className="section-tight"><SkeletonList count={3} height={70} /></div>

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Service journeys"
        description="Organise your own preparation for a published service, one step at a time."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Service journeys' }]}
      />
      <Alert tone="info" title="Preparation, not approval">{data.note}</Alert>

      <div className="card">
        <h2 className="side-label">Start a journey</h2>
        <Field label="Published service">
          <Select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
            {data.availableServices.map((service) => (
              <option key={service.id} value={service.id}>{service.title} · {service.municipality}{service.hasTemplate ? ' · guided template' : ''}</option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {Object.entries(data.priorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <Button
          icon={Plus}
          disabled={!form.serviceId}
          onClick={async () => {
            try {
              const result = await api.post('/account/service-journeys', { serviceId: Number(form.serviceId), priority: form.priority })
              toast.push(result.message)
              setForm({ serviceId: '', priority: 'normal' })
              await load(result.journey.id)
              setDetail(result.journey)
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Start journey
        </Button>
      </div>

      <div className="card">
        <h2 className="side-label">Your journeys</h2>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Input placeholder="Search journeys" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All statuses</option>
            {Object.entries(data.statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
            <option value="created">Newest first</option>
            <option value="priority">Priority</option>
          </Select>
          <Button size="sm" variant="outline" onClick={() => load(detail?.id)}>Search</Button>
        </div>

        {data.journeys.length ? data.journeys.map((journey) => (
          <div key={journey.id} className="stack-tight">
            <div className="row-between">
              <strong>{journey.title}</strong>
              <Badge tone={journey.status === 'active' ? 'success' : journey.status === 'completed' ? 'info' : 'neutral'}>{journey.statusLabel}</Badge>
            </div>
            <span className="text-xs text-muted">{journey.progress.done}/{journey.progress.total} preparation tasks done ({journey.progress.percent}%)</span>
            {journey.requirementsChanged ? <span className="text-xs text-muted">The published service information changed since you started. Review it, then mark the change as reviewed.</span> : null}
            <Button size="sm" variant="outline" onClick={() => open(journey.id)}>Open journey</Button>
          </div>
        )) : <p className="text-sm text-muted">No journeys yet.</p>}
      </div>

      {detail ? (
        <div className="card">
          <div className="row-between">
            <h2 className="side-label">{detail.title}</h2>
            <Badge tone={detail.status === 'active' ? 'success' : 'neutral'}>{detail.statusLabel}</Badge>
          </div>
          <p className="text-xs text-muted">{detail.note}</p>
          {detail.requirementsChanged ? (
            <Alert tone="warning" title="Published information changed">
              Check the service page again. Your completed preparation tasks were kept.
              <Button size="sm" onClick={async () => {
                try {
                  const result = await api.post(`/account/service-journeys/${detail.id}/acknowledge-update`, {})
                  toast.push(result.message)
                  await open(detail.id)
                  await load(detail.id)
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}>Mark reviewed</Button>
            </Alert>
          ) : null}

          {detail.service ? (
            <div className="card-meta">
              <span>Verification: {detail.service.verificationStatus || 'not recorded'}</span>
              <span>Source: {detail.service.sourceReference || 'not recorded'}</span>
              <span>Fees as published: {detail.service.fees || 'not recorded'}</span>
              <span>Processing time as published: {detail.service.processingTime || 'not recorded'}</span>
              {detail.service.officialLink ? <a href={detail.service.officialLink} target="_blank" rel="noreferrer">Official link</a> : null}
            </div>
          ) : null}

          <h3 className="side-label">Preparation tasks ({detail.progress.percent}%)</h3>
          {detail.tasks.map((row) => (
            <div key={row.id} className="stack-tight">
              <div className="row-between">
                <strong>{row.title}</strong>
                <Badge tone={row.status === 'done' ? 'success' : row.status === 'skipped' ? 'neutral' : 'warning'}>{row.statusLabel}</Badge>
              </div>
              <span className="text-xs text-muted">{row.stepTypeLabel}{row.dueDate ? ` · due ${row.dueDate}` : ''} · {row.priority}</span>
              {row.description ? <p className="text-sm text-muted">{row.description}</p> : null}
              <div className="row">
                {row.status !== 'done' ? <Button size="sm" onClick={() => updateTask(row, { status: 'done' })}>Mark prepared</Button> : null}
                {row.status === 'done' ? <Button size="sm" variant="ghost" onClick={() => updateTask(row, { status: 'pending' })}>Undo</Button> : null}
                {row.status === 'pending' ? <Button size="sm" variant="ghost" onClick={() => updateTask(row, { status: 'skipped' })}>Skip</Button> : null}
                <Button size="sm" variant="ghost" onClick={async () => {
                  try {
                    await api.del(`/account/service-journeys/${detail.id}/tasks/${row.id}`)
                    await open(detail.id)
                    await load(detail.id)
                  } catch (err) {
                    toast.push(err.message, 'error')
                  }
                }}>Remove</Button>
              </div>
            </div>
          ))}

          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Input placeholder="Add your own task" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
            <Input type="date" value={task.dueDate} onChange={(e) => setTask({ ...task, dueDate: e.target.value })} />
            <Button
              size="sm"
              disabled={task.title.trim().length < 2}
              onClick={async () => {
                try {
                  await api.post(`/account/service-journeys/${detail.id}/tasks`, { title: task.title, dueDate: task.dueDate || undefined, priority: task.priority })
                  setTask({ title: '', dueDate: '', priority: 'normal' })
                  await open(detail.id)
                  await load(detail.id)
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Add task
            </Button>
          </div>

          <div className="row" style={{ flexWrap: 'wrap' }}>
            {['active', 'paused', 'completed', 'archived'].filter((status) => status !== detail.status).map((status) => (
              <Button
                key={status}
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const result = await api.patch(`/account/service-journeys/${detail.id}`, { status })
                    toast.push(result.message)
                    await open(detail.id)
                    await load(detail.id)
                  } catch (err) {
                    toast.push(err.message, 'error')
                  }
                }}
              >
                {data.statuses[status]}
              </Button>
            ))}
          </div>

          {detail.linked.applications.length || detail.linked.appointments.length ? (
            <div className="stack-tight">
              <h3 className="side-label">Linked BetterGo records</h3>
              {detail.linked.applications.map((row) => <span key={row.reference} className="text-xs text-muted">Application {row.reference} · {row.status}</span>)}
              {detail.linked.appointments.map((row) => <span key={row.reference} className="text-xs text-muted">Appointment {row.reference} · {row.status}</span>)}
            </div>
          ) : null}

          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const notes = window.prompt('Private notes for yourself', detail.notes || '')
              if (notes === null) return
              try {
                await api.patch(`/account/service-journeys/${detail.id}`, { notes })
                await open(detail.id)
              } catch (err) {
                toast.push(err.message, 'error')
              }
            }}
          >
            Edit private notes
          </Button>
        </div>
      ) : null}

      <p className="text-xs text-muted"><Compass size={12} aria-hidden="true" /> {data.progressNote}</p>
    </div>
  )
}
