import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

export function AdminDocumentRequests() {
  useDocumentTitle('Document request administration')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('')
  const [guidance, setGuidance] = useState({ serviceId: '', requestMethod: 'information', externalUrl: '', instructions: '' })

  const load = async () => {
    try {
      setData(await api.get(`/admin/document-requests?${status ? `status=${status}` : ''}`))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = async (request, nextStatus) => {
    const note = window.prompt('Note shown to the citizen (required when rejecting)') || ''
    try {
      await api.post(`/admin/document-requests/${request.id}/status`, { status: nextStatus, note })
      toast.push('Status recorded.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Document requests"
        description="Record office-supplied status updates for BetterGo requests. BetterGo never issues or certifies a document."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Document requests' }]}
      />

      <div className="card">
        <div className="row">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
            <option value="">All statuses</option>
            {['submitted', 'acknowledged', 'needs_information', 'ready_for_office_release', 'completed', 'rejected', 'cancelled'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
          </Select>
        </div>
        {data ? <p className="text-sm text-muted">{data.note}</p> : null}
      </div>

      {!data ? <SkeletonList count={3} height={80} /> : data.results.map((request) => (
        <div className="card" key={request.id}>
          <div className="row-between">
            <strong>{request.reference} · {request.serviceTitle}</strong>
            <Badge tone={request.status === 'completed' ? 'success' : 'neutral'}>{request.status.replaceAll('_', ' ')}</Badge>
          </div>
          <div className="card-meta">
            <span>{request.citizenName}</span>
            <span>{request.officeName || 'Office not recorded'}</span>
            <span>{request.purpose || 'No purpose recorded'}</span>
          </div>
          {request.officeNote ? <p className="text-sm text-muted">Citizen-visible note: {request.officeNote}</p> : null}
          {['submitted', 'acknowledged', 'needs_information', 'ready_for_office_release'].includes(request.status) ? (
            <div className="row">
              {['acknowledged', 'needs_information', 'ready_for_office_release', 'completed', 'rejected'].map((next) => (
                <Button key={next} size="sm" variant="outline" onClick={() => update(request, next)}>{next.replaceAll('_', ' ')}</Button>
              ))}
            </div>
          ) : null}
        </div>
      ))}

      <form
        className="card"
        onSubmit={async (event) => {
          event.preventDefault()
          try {
            await api.put(`/admin/document-requests/services/${guidance.serviceId}/guidance`, guidance)
            toast.push('Request guidance saved.')
          } catch (err) {
            toast.push(err.message, 'error')
          }
        }}
      >
        <h2 className="side-label">Service request guidance</h2>
        <Alert tone="info" title="Verified arrangements only">Only record an external portal or BetterGo request method when the office has confirmed it.</Alert>
        <Field label="Service ID"><Input value={guidance.serviceId} onChange={(e) => setGuidance({ ...guidance, serviceId: e.target.value })} inputMode="numeric" required /></Field>
        <Field label="Request method">
          <Select value={guidance.requestMethod} onChange={(e) => setGuidance({ ...guidance, requestMethod: e.target.value })}>
            <option value="information">Information only</option>
            <option value="external">Official external portal</option>
            <option value="bettergo">BetterGo request record</option>
            <option value="request">Request record</option>
            <option value="none">No request functionality</option>
          </Select>
        </Field>
        <Field label="External URL (external only)"><Input type="url" value={guidance.externalUrl} onChange={(e) => setGuidance({ ...guidance, externalUrl: e.target.value })} /></Field>
        <Field label="Instructions"><Input value={guidance.instructions} onChange={(e) => setGuidance({ ...guidance, instructions: e.target.value })} /></Field>
        <Button type="submit">Save guidance</Button>
      </form>
    </div>
  )
}
