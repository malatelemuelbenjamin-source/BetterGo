import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Field, Input, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

const STATUS_TONE = { submitted: 'warning', acknowledged: 'info', needs_information: 'warning', ready_for_office_release: 'info', completed: 'success', rejected: 'danger', cancelled: 'neutral', expired: 'neutral' }

function RequestCard({ request, actions = true, onCancel }) {
  const open = ['submitted', 'acknowledged', 'needs_information', 'ready_for_office_release'].includes(request.status)
  return (
    <div className="card">
      <div className="row-between">
        <strong>{request.serviceTitle}</strong>
        <Badge tone={STATUS_TONE[request.status] || 'neutral'}>{request.status.replaceAll('_', ' ')}</Badge>
      </div>
      <div className="card-meta">
        <span>{request.reference}</span>
        <span>{request.officeName || 'Office not recorded'}</span>
        <span>Submitted {request.submittedAt?.slice(0, 10)}</span>
      </div>
      {request.officeNote ? <p className="text-sm text-muted">Office note: {request.officeNote}</p> : null}
      {actions && open ? <Button size="sm" variant="ghost" onClick={() => onCancel(request)}>Cancel request</Button> : null}
    </div>
  )
}

export default function DocumentRequestsPage() {
  const { slug } = useParams()
  const { id } = useParams()
  const toast = useToast()
  useDocumentTitle('Document requests')
  const [center, setCenter] = useState(null)
  const [guidance, setGuidance] = useState(null)
  const [detail, setDetail] = useState(null)
  const [category, setCategory] = useState('')
  const [purpose, setPurpose] = useState('')

  const load = async () => {
    try {
      setCenter(await api.get('/account/document-requests'))
      if (slug) setGuidance(await api.get(`/account/document-requests/guidance/${slug}`))
      if (id) setDetail(await api.get(`/account/document-requests/${id}`))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, [slug, id]) // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async (request) => {
    if (!window.confirm('Cancel this request in BetterGo?')) return
    try {
      await api.post(`/account/document-requests/${request.id}/cancel`, {})
      toast.push('Request cancelled.')
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
          eyebrow="Document request"
          title={detail.request.serviceTitle}
          description={`Reference ${detail.request.reference}`}
          breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Document requests', to: '/dashboard/document-requests' }, { label: detail.request.reference }]}
        />
        <Alert tone="warning" title="Platform record">{detail.label}</Alert>
        <RequestCard request={detail.request} onCancel={cancel} />
        {detail.office ? (
          <div className="card">
            <h2 className="side-label">Issuing office</h2>
            <p className="text-sm">{detail.office.name}</p>
            <p className="text-xs text-muted">{[detail.office.address, detail.office.phone, detail.office.operating_hours, detail.office.website].filter(Boolean).join(' · ') || 'No verified office details recorded.'}</p>
          </div>
        ) : null}
        <div className="card">
          <h2 className="side-label">Status history</h2>
          {detail.request.events.map((event, index) => <div className="text-sm" key={index}>{event.created_at?.slice(0, 16)} · {event.action.replaceAll('_', ' ')}{event.note ? ` — ${event.note}` : ''}</div>)}
        </div>
        <a className="btn btn-ghost" href={`/api/account/document-requests/${detail.request.id}/summary`} target="_blank" rel="noreferrer">Download BetterGo request summary</a>
      </div>
    )
  }

  if (slug) {
    if (!guidance) return <div className="section-tight"><SkeletonList count={3} height={80} /></div>
    return (
      <div className="section-tight">
        <PageHeader
          eyebrow="Document guidance"
          title={guidance.service.title}
          description={guidance.service.summary}
          breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Document requests', to: '/dashboard/document-requests' }, { label: guidance.service.title }]}
        />
        <Alert tone="info" title="What BetterGo provides">{guidance.notice}</Alert>
        <div className="grid grid-2">
          <div className="card">
            <h2 className="side-label">Recorded requirements</h2>
            {guidance.requirements.length ? guidance.requirements.map((row, index) => (
              <div key={index} className="stack-tight">
                <div className="row-between"><strong>{row.requirement_name}</strong><Badge tone={row.verified ? 'success' : 'warning'}>{row.verified ? 'Reviewed' : 'Needs verification'}</Badge></div>
                {row.description ? <p className="text-sm text-muted">{row.description}</p> : null}
                {row.issuing_office ? <span className="text-xs text-muted">Issuing office: {row.issuing_office}</span> : null}
              </div>
            )) : <p className="text-sm text-muted">No requirements are recorded. Confirm with the office.</p>}
          </div>
          <div className="card">
            <h2 className="side-label">Issuing office</h2>
            {guidance.office ? (
              <p className="text-sm">{guidance.office.name}<br /><span className="text-muted">{[guidance.office.address, guidance.office.phone, guidance.office.operating_hours].filter(Boolean).join(' · ') || 'No verified details recorded.'}</span></p>
            ) : <p className="text-sm text-muted">No verified issuing office is recorded for this service.</p>}
            {guidance.service.instructions ? <p className="text-sm">{guidance.service.instructions}</p> : null}
            {guidance.service.externalUrl ? <a className="btn btn-outline" href={guidance.service.externalUrl} target="_blank" rel="noreferrer">Open official request portal</a> : null}
          </div>
        </div>
        {guidance.canSubmit ? (
          <div className="card">
            <h2 className="side-label">Record a BetterGo request</h2>
            <p className="text-xs text-muted">This records your intent and lets you track updates. It does not submit an official application or issue a document.</p>
            <Field label="Purpose (optional)"><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
            <Button
              icon={FileText}
              onClick={async () => {
                try {
                  const result = await api.post('/account/document-requests', { serviceSlug: slug, purpose })
                  toast.push(result.message)
                  setPurpose('')
                  await load()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Record request
            </Button>
          </div>
        ) : guidance.existingRequestId ? <p className="text-sm text-muted">You already have an open request for this service.</p> : <p className="text-sm text-muted">Follow the recorded official request method for this service.</p>}
      </div>
    )
  }

  const visible = center.guidance.filter((item) => !category || item.categoryName === category)
  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Document requests"
        description="Check recorded requirements and offices, then keep track of requests you have made."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Document requests' }]}
      />
      <Alert tone="info" title="Independent platform">{center.notice}</Alert>

      {center.requests.length ? <><h2 className="side-label">Open requests</h2>{center.requests.map((row) => <RequestCard key={row.id} request={row} onCancel={cancel} />)}</> : null}

      <div className="row">
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category filter">
          <option value="">All categories</option>
          {center.categories.map((name) => <option key={name} value={name}>{name}</option>)}
        </Select>
      </div>
      {visible.length ? (
        <div className="grid grid-2">
          {visible.map((item) => (
            <div className="card" key={item.id}>
              <a href={`/dashboard/document-requests/${item.slug}`}><strong>{item.title}</strong></a>
              <p className="text-sm text-muted">{item.summary}</p>
              <div className="card-meta">
                <span>{item.categoryName}</span>
                {item.municipalityName ? <span>{item.municipalityName}</span> : null}
                <span>{item.requirementCount} recorded requirements</span>
              </div>
              {item.externalUrl ? <a className="text-xs" href={item.externalUrl} target="_blank" rel="noreferrer">Official external portal</a> : null}
            </div>
          ))}
        </div>
      ) : <EmptyState icon={FileText} title="No document guidance recorded" description="Only services with recorded requirements or request guidance appear here." />}

      {center.history.length ? <><h2 className="side-label">Request history</h2>{center.history.map((row) => <RequestCard key={row.id} request={row} onCancel={cancel} actions={false} />)}</> : null}
    </div>
  )
}
