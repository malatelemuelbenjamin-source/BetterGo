import { useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Field, Input, Select, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

export function AdminRequirements() {
  useDocumentTitle('Service requirements')
  const toast = useToast()
  const [serviceId, setServiceId] = useState('')
  const [data, setData] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', mandatory: true, sourceTitle: '', sourceUrl: '', guidance: '' })

  const load = async () => {
    try {
      setData(await api.get(`/admin/service-requirements?serviceId=${serviceId}`))
      setAnalytics(await api.get('/admin/assistance/analytics').catch(() => null))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const act = async (requirement, action) => {
    try {
      await api.post(`/admin/service-requirements/${requirement.id}/${action}`)
      toast.push('Requirement updated.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Service requirements"
        description="Record requirements and sources, then submit them for review. Unreviewed content is never labelled official."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Service requirements' }]}
      />

      <div className="card">
        <div className="row">
          <Input value={serviceId} onChange={(e) => setServiceId(e.target.value)} placeholder="Service ID" inputMode="numeric" aria-label="Service ID" />
          <Button onClick={load}>Load service</Button>
        </div>
        <p className="text-xs text-muted">Only services inside your authorized municipality or province-wide records are accessible.</p>
      </div>

      {data ? (
        <div className="stack">
          <h2 className="side-label">{data.service.title}</h2>
          <Alert tone="info" title="Review workflow">{data.note}</Alert>
          {data.results.map((requirement) => (
            <div className="card" key={requirement.id}>
              <div className="row-between">
                <strong>{requirement.requirement_name}</strong>
                <Badge tone={requirement.review_status === 'approved' ? 'success' : requirement.review_status === 'archived' ? 'neutral' : 'warning'}>
                  {data.reviewStatuses[requirement.review_status] || requirement.review_status}
                </Badge>
              </div>
              <p className="text-sm text-muted">{requirement.description}</p>
              <p className="text-xs text-muted">
                {requirement.is_required ? 'Required' : 'Optional'}
                {requirement.source_title ? ` · Source: ${requirement.source_title}` : ' · No source recorded'}
                {requirement.verified_at ? ` · Reviewed ${requirement.verified_at.slice(0, 10)}` : ''}
              </p>
              <div className="row">
                {['draft', 'unverified'].includes(requirement.review_status) ? <Button size="sm" variant="outline" onClick={() => act(requirement, 'submit-review')}>Submit for review</Button> : null}
                {requirement.review_status === 'pending_review' ? <Button size="sm" onClick={() => act(requirement, 'approve')}>Approve with source</Button> : null}
                {requirement.review_status !== 'archived' ? <Button size="sm" variant="ghost" onClick={() => act(requirement, 'archive')}>Archive</Button> : null}
              </div>
            </div>
          ))}

          <form
            className="card"
            onSubmit={async (event) => {
              event.preventDefault()
              try {
                await api.post('/admin/service-requirements', { ...form, serviceId: Number(serviceId) })
                toast.push('Draft requirement saved.')
                setForm({ name: '', description: '', mandatory: true, sourceTitle: '', sourceUrl: '', guidance: '' })
                await load()
              } catch (err) {
                toast.push(err.message, 'error')
              }
            }}
          >
            <h3 className="side-label">Add a draft requirement</h3>
            <Field label="Requirement name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Preparation guidance"><Input value={form.guidance} onChange={(e) => setForm({ ...form, guidance: e.target.value })} /></Field>
            <Field label="Mandatory">
              <Select value={form.mandatory ? '1' : '0'} onChange={(e) => setForm({ ...form, mandatory: e.target.value === '1' })}>
                <option value="1">Required</option>
                <option value="0">Optional</option>
              </Select>
            </Field>
            <Field label="Source title"><Input value={form.sourceTitle} onChange={(e) => setForm({ ...form, sourceTitle: e.target.value })} placeholder="Official issuance or office page" /></Field>
            <Field label="Source URL (optional)"><Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} type="url" /></Field>
            <Button type="submit">Save draft</Button>
          </form>

          {analytics ? (
            <div className="card">
              <h2 className="side-label">Aggregated assistance activity</h2>
              <div className="grid grid-3">
                <div className="stat-card"><span className="stat-label">Checklists</span><div className="stat-value">{analytics.totals.plans}</div></div>
                <div className="stat-card"><span className="stat-label">Fully prepared</span><div className="stat-value">{analytics.totals.completedPlans}</div></div>
                <div className="stat-card"><span className="stat-label">Approved requirements</span><div className="stat-value">{analytics.totals.approvedRequirements}</div></div>
              </div>
              <p className="text-sm text-muted">{analytics.note}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
