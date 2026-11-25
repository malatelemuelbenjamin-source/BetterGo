import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Field, Input, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

const TONES = { new: 'warning', acknowledged: 'info', in_review: 'info', needs_information: 'warning', referred: 'info', resolved: 'success', closed: 'neutral', withdrawn: 'neutral' }

function CaseCard({ item }) {
  return (
    <div className="card">
      <div className="row-between">
        <a href={`/dashboard/complaints/${item.id}`}><strong>{item.subject}</strong></a>
        <Badge tone={TONES[item.status] || 'neutral'}>{item.status.replaceAll('_', ' ')}</Badge>
      </div>
      <div className="card-meta">
        <span>{item.reference}</span>
        <span>{item.categoryLabel}</span>
        {item.officeName ? <span>{item.officeName}</span> : null}
        <span>Filed {item.createdAt?.slice(0, 10)}</span>
      </div>
      {item.resolutionSummary ? <p className="text-sm text-muted">Update: {item.resolutionSummary}</p> : null}
    </div>
  )
}

export default function ComplaintsPage() {
  useDocumentTitle('Complaints and cases')
  const { id } = useParams()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState({ category: 'service_quality', subject: '', description: '', locationText: '', severity: 'normal', confidential: false })
  const [comment, setComment] = useState('')

  const load = async () => {
    try {
      setData(await api.get('/account/complaints'))
      if (id) setDetail(await api.get(`/account/complaints/${id}`))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="section-tight"><SkeletonList count={4} height={70} /></div>

  if (id) {
    if (!detail) return <div className="section-tight"><SkeletonList count={3} height={80} /></div>
    const item = detail.case
    return (
      <div className="section-tight">
        <PageHeader
          eyebrow="Case"
          title={item.subject}
          description={`Reference ${item.reference}`}
          breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Complaints', to: '/dashboard/complaints' }, { label: item.reference }]}
        />
        <Alert tone="warning" title="Platform record">{detail.label}</Alert>
        <CaseCard item={item} />
        <div className="card">
          <h2 className="side-label">Case timeline</h2>
          {item.events.map((event, index) => <div className="text-sm" key={index}>{event.created_at?.slice(0, 16)} · {event.action.replaceAll('_', ' ')}{event.note ? ` — ${event.note}` : ''}</div>)}
        </div>
        <div className="card">
          <h2 className="side-label">Add information</h2>
          <div className="row">
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Additional details" aria-label="Case comment" />
            <Button
              onClick={async () => {
                try {
                  await api.post(`/account/complaints/${id}/comments`, { note: comment })
                  setComment('')
                  await load()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Add comment
            </Button>
          </div>
        </div>
        <a className="btn btn-ghost" href={`/api/account/complaints/${id}/summary`} target="_blank" rel="noreferrer">Download case summary</a>
      </div>
    )
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Complaints and cases"
        description="Report a concern with a public service and follow how BetterGo handles it."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Complaints' }]}
      />
      <Alert tone="info" title="Independent platform">{data.notice}</Alert>

      {data.open.length ? <><h2 className="side-label">Open cases</h2>{data.open.map((item) => <CaseCard key={item.id} item={item} />)}</> : null}

      <div className="card">
        <h2 className="side-label">File a concern</h2>
        <p className="text-xs text-muted">Describe facts only. Do not include ID numbers, health details or other sensitive information unless necessary.</p>
        <Field label="Category">
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(data.categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <Field label="Subject"><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
        <Field label="What happened"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="grid grid-2">
          <Field label="Location (optional)"><Input value={form.locationText} onChange={(e) => setForm({ ...form, locationText: e.target.value })} /></Field>
          <Field label="Severity">
            <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {Object.entries(data.severities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
        </div>
        <label className="row text-sm"><input type="checkbox" checked={form.confidential} onChange={(e) => setForm({ ...form, confidential: e.target.checked })} /> Keep my identity hidden from non-authorized staff</label>
        <Button
          icon={AlertCircle}
          onClick={async () => {
            try {
              const result = await api.post('/account/complaints', form)
              toast.push(result.message)
              setForm({ category: 'service_quality', subject: '', description: '', locationText: '', severity: 'normal', confidential: false })
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Submit case
        </Button>
      </div>

      {data.history.length ? <><h2 className="side-label">Case history</h2>{data.history.map((item) => <CaseCard key={item.id} item={item} />)}</> : <EmptyState icon={AlertCircle} title="No past cases" description="Closed and resolved cases will appear here." />}
    </div>
  )
}
