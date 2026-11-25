import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

const emptyIncident = { title: '', severity: 'medium', detectionSource: '', affectedScope: '', summary: '' }

export function AdminSecurity() {
  useDocumentTitle('Security monitoring')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [incident, setIncident] = useState(emptyIncident)

  const load = async () => {
    try {
      setData(await api.get('/admin/security'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const decideReport = async (row, status) => {
    const note = window.prompt('What did the review find?') || ''
    try {
      const result = await api.post(`/admin/security/reports/${row.id}/decision`, { status, note })
      toast.push(result.message)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const restrict = async (row, action) => {
    if (!row.userId) return
    const note = window.prompt(action === 'restrict' ? 'Why is access being restricted?' : 'Why is access being restored?') || ''
    try {
      const result = await api.post(`/admin/security/users/${row.userId}/restrict`, { action, note })
      toast.push(result.message)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const updateIncident = async (row, status) => {
    const note = window.prompt('What changed?') || ''
    try {
      const result = await api.post(`/admin/security/incidents/${row.id}/update`, { status, note })
      toast.push(result.message)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Security monitoring"
        description="Review indicators, citizen reports and security incidents. Never browse private content without an authorized purpose."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Security monitoring' }]}
      />
      <Alert tone="warning" title="Indicators are not confirmed incidents">{data?.note || 'Loading security data.'}</Alert>

      {!data ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="grid grid-4">
            <div className="card"><div className="side-label">Active sessions</div><strong>{data.summary.activeSessions}</strong></div>
            <div className="card"><div className="side-label">Failed logins (24h)</div><strong>{data.summary.failedLoginsLastDay}</strong></div>
            <div className="card"><div className="side-label">Pending reports</div><strong>{data.summary.pendingReports}</strong></div>
            <div className="card"><div className="side-label">Open incidents</div><strong>{data.summary.openIncidents}</strong></div>
          </div>

          <div className="card">
            <h2 className="side-label">Citizen security reports</h2>
            {data.reports.length ? data.reports.map((row) => (
              <div key={row.id} className="stack-tight">
                <div className="row-between">
                  <strong>{row.reference} · {row.categoryLabel}</strong>
                  <Badge tone={row.status === 'resolved' ? 'success' : row.status === 'dismissed' ? 'neutral' : 'warning'}>{row.statusLabel}</Badge>
                </div>
                <span className="text-xs text-muted">{row.citizenName} · {row.createdAt?.slice(0, 16)}</span>
                <p className="text-sm">{row.description}</p>
                {row.evidenceNote ? <p className="text-xs text-muted">Supporting detail: {row.evidenceNote}</p> : null}
                {row.reviewNote ? <p className="text-xs text-muted">Review: {row.reviewNote}</p> : null}
                {['submitted', 'under_review'].includes(row.status) ? (
                  <div className="row">
                    <Button size="sm" variant="outline" onClick={() => decideReport(row, 'under_review')}>Mark under review</Button>
                    <Button size="sm" onClick={() => decideReport(row, 'resolved')}>Resolve</Button>
                    <Button size="sm" variant="ghost" onClick={() => decideReport(row, 'dismissed')}>Dismiss</Button>
                  </div>
                ) : null}
              </div>
            )) : <p className="text-sm text-muted">No security reports in your scope.</p>}
          </div>

          <div className="card">
            <h2 className="side-label">Repeated failed sign-ins</h2>
            {data.suspiciousLogins.length ? data.suspiciousLogins.map((row) => (
              <div key={row.identifier} className="row-between text-sm">
                <span>{row.identifier} · {row.failures} failures in 24 hours</span>
                <span className="row">
                  <Button size="sm" variant="ghost" onClick={() => restrict(row, 'restrict')}>Restrict</Button>
                  <Button size="sm" variant="ghost" onClick={() => restrict(row, 'restore')}>Restore</Button>
                </span>
              </div>
            )) : <p className="text-sm text-muted">No repeated failure pattern in your scope.</p>}
          </div>

          <div className="card">
            <h2 className="side-label">Security incidents</h2>
            <Field label="Title"><Input value={incident.title} onChange={(e) => setIncident({ ...incident, title: e.target.value })} /></Field>
            <Field label="Severity">
              <Select value={incident.severity} onChange={(e) => setIncident({ ...incident, severity: e.target.value })}>
                {Object.entries(data.severities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <Field label="Detection source"><Input value={incident.detectionSource} onChange={(e) => setIncident({ ...incident, detectionSource: e.target.value })} /></Field>
            <Field label="Affected scope"><Input value={incident.affectedScope} onChange={(e) => setIncident({ ...incident, affectedScope: e.target.value })} /></Field>
            <Field label="Summary"><Textarea rows={2} value={incident.summary} onChange={(e) => setIncident({ ...incident, summary: e.target.value })} /></Field>
            <Button
              disabled={incident.title.trim().length < 5}
              onClick={async () => {
                try {
                  const result = await api.post('/admin/security/incidents', incident)
                  toast.push(result.message)
                  setIncident(emptyIncident)
                  await load()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Record incident
            </Button>

            {data.incidents.map((row) => (
              <div key={row.id} className="stack-tight">
                <div className="row-between">
                  <strong>{row.reference} · {row.title}</strong>
                  <Badge tone={['resolved', 'closed'].includes(row.status) ? 'success' : 'warning'}>{row.statusLabel} · {row.severityLabel}</Badge>
                </div>
                <span className="text-xs text-muted">Detected via {row.detectionSource || 'not recorded'} · {row.createdAt?.slice(0, 16)}</span>
                {row.summary ? <p className="text-sm">{row.summary}</p> : null}
                <div className="row">
                  {Object.entries(data.incidentStatuses).filter(([status]) => status !== row.status).map(([status, label]) => (
                    <Button key={status} size="sm" variant="ghost" onClick={() => updateIncident(row, status)}>{label}</Button>
                  ))}
                </div>
                {row.events.map((event, index) => (
                  <span key={index} className="text-xs text-muted">{event.created_at?.slice(0, 16)} · {event.action} · {event.note}</span>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
