import { useEffect, useState } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { api, fmtDateTime } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

const TABS = [['requests', 'Requests'], ['notices', 'Privacy notices'], ['incidents', 'Incidents'], ['analytics', 'Analytics']]

export function AdminPrivacyCenter() {
  useDocumentTitle('Privacy administration')
  const toast = useToast()
  const [tab, setTab] = useState('requests')
  const [data, setData] = useState(null)
  const [notice, setNotice] = useState({ docType: 'privacy_policy', title: '', body: '', version: '2.0', language: 'en' })
  const [incident, setIncident] = useState({ description: '', severity: 'medium', affectedSystems: '' })

  const load = async () => {
    try {
      if (tab === 'requests') setData(await api.get('/admin/records/privacy-requests'))
      if (tab === 'notices') setData(await api.get('/admin/privacy-notices'))
      if (tab === 'incidents') setData(await api.get('/admin/privacy-incidents'))
      if (tab === 'analytics') setData(await api.get('/admin/privacy/analytics'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => {
    setData(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const decide = async (row, status, note) => {
    try {
      await api.patch(`/admin/records/privacy-requests/${row.reference}`, { status, note, resolution: status === 'rejected' ? note : undefined })
      toast.push('Request updated.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const publishNotice = async (row) => {
    try {
      await api.post(`/admin/privacy-notices/${row.id}/publish`, {})
      toast.push('Notice published.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Privacy administration"
        description="Process privacy requests, version notices, record incidents and review real processing metrics."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Privacy' }]}
      />

      <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
        {TABS.map(([key, label]) => (
          <button key={key} type="button" className={`pill ${tab === key ? 'is-active' : ''}`} onClick={() => setTab(key)} aria-pressed={tab === key}>{label}</button>
        ))}
      </div>

      {!data ? <SkeletonList count={3} height={60} /> : null}

      {tab === 'requests' && data ? (
        <div className="stack mt-4">
          <Alert tone="info" title="Platform workflow">{data.statuses ? 'These are BetterGo privacy request statuses. They are not government decisions.' : ''}</Alert>
          {data.results?.length ? data.results.map((row) => (
            <div className="card" key={row.reference}>
              <div className="row-between"><strong>{row.reference} · {row.category}</strong><Badge tone="info">{row.status_label || row.statusLabel}</Badge></div>
              <p className="text-sm">{row.description}</p>
              <div className="card-meta"><span>{row.citizen_email}</span><span>{fmtDateTime(row.created_at)}</span></div>
              <div className="row">
                <Button size="sm" variant="outline" onClick={() => decide(row, 'under_review')}>Under review</Button>
                <Button size="sm" variant="outline" onClick={() => decide(row, 'awaiting_citizen', 'Please confirm your account email.')}>Request information</Button>
                <Button size="sm" onClick={() => decide(row, 'completed', 'Request completed.')}>Complete</Button>
                <Button size="sm" variant="ghost" onClick={() => decide(row, 'rejected', 'We could not verify ownership of this account.')}>Reject with reason</Button>
              </div>
            </div>
          )) : <p className="text-sm text-muted">No privacy requests in scope.</p>}
        </div>
      ) : null}

      {tab === 'notices' && data ? (
        <div className="stack mt-4">
          <form
            className="card"
            onSubmit={async (event) => {
              event.preventDefault()
              try {
                await api.post('/admin/privacy-notices', notice)
                toast.push('Notice draft created.')
                await load()
              } catch (err) {
                toast.push(err.message, 'error')
              }
            }}
          >
            <h2 className="side-label">New notice version</h2>
            <div className="grid grid-3">
              <Field label="Type">
                <Select value={notice.docType} onChange={(e) => setNotice({ ...notice, docType: e.target.value })}>
                  <option value="privacy_policy">Privacy policy</option>
                  <option value="terms_of_use">Terms of use</option>
                  <option value="notice">Other notice</option>
                </Select>
              </Field>
              <Field label="Version"><Input value={notice.version} onChange={(e) => setNotice({ ...notice, version: e.target.value })} required /></Field>
              <Field label="Language">
                <Select value={notice.language} onChange={(e) => setNotice({ ...notice, language: e.target.value })}>
                  <option value="en">English</option>
                  <option value="fil">Filipino</option>
                </Select>
              </Field>
            </div>
            <Field label="Title"><Input value={notice.title} onChange={(e) => setNotice({ ...notice, title: e.target.value })} required /></Field>
            <Field label="Full text"><Textarea rows={6} value={notice.body} onChange={(e) => setNotice({ ...notice, body: e.target.value })} required /></Field>
            <Button type="submit" icon={ShieldCheck}>Save draft</Button>
          </form>
          {data.results.map((row) => (
            <div className="card" key={row.id}>
              <div className="row-between"><strong>{row.title} (v{row.version})</strong><Badge tone={row.status === 'published' ? 'success' : 'neutral'}>{row.status}</Badge></div>
              <div className="card-meta"><span>{row.doc_type}</span><span>{row.language}</span><span>{fmtDateTime(row.created_at)}</span></div>
              {row.status === 'draft' ? <Button size="sm" onClick={() => publishNotice(row)}>Publish (second reviewer)</Button> : null}
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'incidents' && data ? (
        <div className="stack mt-4">
          <Alert tone="warning" title="Internal only">{data.note}</Alert>
          <form
            className="card"
            onSubmit={async (event) => {
              event.preventDefault()
              try {
                const result = await api.post('/admin/privacy-incidents', incident)
                toast.push(result.message)
                setIncident({ description: '', severity: 'medium', affectedSystems: '' })
                await load()
              } catch (err) {
                toast.push(err.message, 'error')
              }
            }}
          >
            <h2 className="side-label">Record an incident</h2>
            <Field label="Description"><Textarea rows={4} value={incident.description} onChange={(e) => setIncident({ ...incident, description: e.target.value })} required minLength={20} /></Field>
            <div className="grid grid-2">
              <Field label="Severity">
                <Select value={incident.severity} onChange={(e) => setIncident({ ...incident, severity: e.target.value })}>
                  {['low', 'medium', 'high', 'critical'].map((value) => <option key={value} value={value}>{value}</option>)}
                </Select>
              </Field>
              <Field label="Affected systems"><Input value={incident.affectedSystems} onChange={(e) => setIncident({ ...incident, affectedSystems: e.target.value })} /></Field>
            </div>
            <Button type="submit" icon={ShieldAlert}>Record incident</Button>
          </form>
          {data.results.map((row) => (
            <div className="card" key={row.reference}>
              <div className="row-between"><strong>{row.reference}</strong><Badge tone={row.severity === 'critical' ? 'warning' : 'neutral'}>{row.severity} · {row.status}</Badge></div>
              <p className="text-sm">{row.description}</p>
              <div className="card-meta"><span>Discovered {fmtDateTime(row.discovered_at)}</span><span>{row.assignee_name || 'Unassigned'}</span></div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'analytics' && data ? (
        <div className="stack mt-4">
          <div className="grid grid-4">
            <div className="card stat-card"><span className="stat-label">Requests</span><div className="stat-value">{data.requests.total}</div></div>
            <div className="card stat-card"><span className="stat-label">Open</span><div className="stat-value">{data.requests.open}</div></div>
            <div className="card stat-card"><span className="stat-label">Completed</span><div className="stat-value">{data.requests.completed}</div></div>
            <div className="card stat-card"><span className="stat-label">Avg days</span><div className="stat-value">{data.requests.averageProcessingDays ?? '—'}</div></div>
          </div>
          <div className="card">
            <h2 className="side-label">By category</h2>
            {data.byCategory.map((row) => <div className="row-between" key={row.category}><span>{row.category}</span><strong>{row.total}</strong></div>)}
          </div>
          <p className="text-sm text-muted">{data.note}</p>
        </div>
      ) : null}
    </div>
  )
}
