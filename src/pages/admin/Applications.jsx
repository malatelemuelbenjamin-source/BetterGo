import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { api, fmtDate, fmtDateTime } from '../../api'
import { useApi, useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, EmptyState, Field, Input, Modal, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

const tone = (status) =>
  ['closed', 'completed'].includes(status) ? 'neutral' : ['withdrawn', 'cancelled'].includes(status) ? 'warning' : status === 'awaiting_citizen' ? 'info' : 'success'

export function AdminApplications() {
  useDocumentTitle('BetterGo submissions')
  const [params, setParams] = useSearchParams()
  const status = params.get('status') || ''
  const q = params.get('q') || ''
  const assigned = params.get('assigned') || ''
  const page = Number(params.get('page') || 1)
  const [term, setTerm] = useState(q)
  const { data, loading } = useApi(`/admin/applications?status=${status}&q=${encodeURIComponent(q)}&assigned=${assigned}&page=${page}`)
  const { data: analytics } = useApi('/admin/applications/analytics')

  const update = (patch) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([key, value]) => (value ? next.set(key, String(value)) : next.delete(key)))
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / (data?.limit || 25)))

  return (
    <div>
      <PageHeader
        title="BetterGo submissions"
        description="Platform intake records for your municipality scope. These are not government applications and no official status exists here."
      />

      {analytics ? (
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-label">All submissions</div><div className="stat-value">{analytics.total}</div></div>
          <div className="stat-card"><div className="stat-label">Last 30 days</div><div className="stat-value">{analytics.last30Days}</div></div>
          <div className="stat-card"><div className="stat-label">Information requests</div><div className="stat-value">{analytics.additionalInfoRequests}</div></div>
          <div className="stat-card"><div className="stat-label">Closures</div><div className="stat-value">{analytics.closures}</div></div>
        </div>
      ) : null}

      <div className="card mt-4">
        <form className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }} onSubmit={(event) => { event.preventDefault(); update({ q: term }) }}>
          <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search by reference" aria-label="Search by reference" style={{ flex: '1 1 200px' }} />
          <Select value={status} onChange={(event) => update({ status: event.target.value })} aria-label="Status" style={{ maxWidth: 220 }}>
            <option value="">Every status</option>
            {Object.entries(data?.statuses || {}).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select value={assigned} onChange={(event) => update({ assigned: event.target.value })} aria-label="Assignment" style={{ maxWidth: 180 }}>
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </Select>
          <Button type="submit" variant="outline" size="sm">Search</Button>
        </form>
      </div>

      {loading ? (
        <SkeletonList count={3} height={80} />
      ) : data?.results?.length ? (
        <>
          <div className="table-wrap mt-4">
            <table className="data">
              <thead><tr><th>Reference</th><th>Service</th><th>Municipality</th><th>Status</th><th>Reviewer</th><th>Submitted</th></tr></thead>
              <tbody>
                {data.results.map((row) => (
                  <tr key={row.id}>
                    <td><Link to={`/admin/applications/${row.id}`}>{row.reference}</Link></td>
                    <td>{row.service_title || '—'}</td>
                    <td>{row.municipality_name || '—'}</td>
                    <td><Badge tone={tone(row.status)}>{data.statuses?.[row.status] || row.status}</Badge></td>
                    <td>{row.reviewer_name || 'Unassigned'}</td>
                    <td className="nowrap">{row.submitted_at ? fmtDate(row.submitted_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <div className="row mt-3" style={{ gap: '0.5rem', alignItems: 'center' }}>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>Previous</Button>
              <span className="text-sm text-muted">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => update({ page: page + 1 })}>Next</Button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState title="No submissions in scope" description="Nothing matches those filters, or no records have been submitted for your municipality yet." />
      )}

      {analytics ? <p className="help mt-4">{analytics.disclaimer} {analytics.averageNote}</p> : null}
    </div>
  )
}

export function AdminApplicationDetail() {
  const { id } = useParams()
  const toast = useToast()
  const { data, loading, error, reload } = useApi(`/admin/applications/${id}`)
  const [note, setNote] = useState('')
  const [target, setTarget] = useState('in_review')
  const [busy, setBusy] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [requestMessage, setRequestMessage] = useState('')
  const [reviewer, setReviewer] = useState('')
  useDocumentTitle(data?.application?.reference || 'Submission')

  if (loading) return <SkeletonList count={2} height={140} />
  if (error) return <Alert tone="error">{error.message}</Alert>
  const application = data.application

  const run = async (fn, message) => {
    setBusy(true)
    try {
      await fn()
      toast.push(message)
      await reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = () =>
    run(
      () => api.post(`/admin/applications/${id}/status`, { status: target, note }),
      'Status updated. The citizen was notified.',
    )

  const requestInfo = () =>
    run(async () => {
      await api.post(`/admin/applications/${id}/request-info`, { message: requestMessage })
      setRequesting(false)
      setRequestMessage('')
    }, 'Information request sent.')

  const assign = () =>
    run(
      () => api.post(`/admin/applications/${id}/assign`, { reviewerId: reviewer ? Number(reviewer) : null }),
      'Assignment updated.',
    )

  return (
    <div>
      <PageHeader
        title={application.reference}
        description={`${application.serviceTitle || 'Service'} · ${application.formTitle || 'No form'} · ${application.statusLabel}`}
        breadcrumbs={[{ label: 'BetterGo submissions', to: '/admin/applications' }, { label: application.reference }]}
        actions={<Link className="btn btn-ghost btn-sm" to="/admin/applications"><ArrowLeft size={14} /> All submissions</Link>}
      />

      <Alert tone="info" title="BetterGo platform record">{data.disclaimer}</Alert>

      <div className="grid grid-2 mt-4" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Citizen submission</h2>
          <dl className="detail-list">
            <div><dt>Citizen</dt><dd>{application.citizenName || application.citizenEmail}</dd></div>
            <div><dt>Municipality</dt><dd>{application.municipalityName || 'Not set'}</dd></div>
            <div><dt>Submitted</dt><dd>{application.submittedAt ? fmtDateTime(application.submittedAt) : 'Not submitted'}</dd></div>
            <div><dt>Privacy notice</dt><dd>{application.privacyNoticeVersion || '—'}</dd></div>
            <div><dt>External reference</dt><dd>{application.externalReference || 'None — nothing transmitted'}</dd></div>
          </dl>
          {data.answers ? (
            <dl className="detail-list mt-3">
              {Object.entries(data.answers).map(([key, value]) => (
                <div key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value ?? '—')}</dd></div>
              ))}
            </dl>
          ) : <p className="text-sm text-muted mt-3">No structured answers were stored with this record.</p>}
          {data.documents?.length ? (
            <>
              <h3 style={{ fontSize: '1rem' }}>Supporting documents</h3>
              <ul className="stack-sm">
                {data.documents.map((document) => (
                  <li key={document.id} className="row-between"><span>{document.original_filename}</span><span className="text-xs text-muted">{fmtDate(document.created_at)}</span></li>
                ))}
              </ul>
              <p className="help">Files are private. Downloading requires the citizen's authorisation or a documented review need.</p>
            </>
          ) : null}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Platform actions</h2>
          <Field label="Status" htmlFor="app-status">
            <Select id="app-status" value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="in_review">Under BetterGo review</option>
              <option value="awaiting_citizen">Waiting for information</option>
              <option value="resubmitted">Information resubmitted</option>
              <option value="closed">Closed on BetterGo</option>
            </Select>
          </Field>
          <Field label="Citizen-facing note" htmlFor="app-note" help="Closures require an explanation.">
            <Textarea id="app-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} style={{ minHeight: 70 }} />
          </Field>
          <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
            <Button onClick={changeStatus} loading={busy}>Update status</Button>
            <Button variant="outline" onClick={() => setRequesting(true)}>Request information</Button>
          </div>

          <h3 style={{ fontSize: '1rem', marginTop: 'var(--space-4)' }}>Reviewer assignment</h3>
          <div className="row" style={{ gap: '0.4rem' }}>
            <Select value={reviewer} onChange={(event) => setReviewer(event.target.value)} aria-label="Reviewer">
              <option value="">Unassigned</option>
              {data.reviewers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </Select>
            <Button variant="outline" size="sm" onClick={assign} loading={busy}>Assign</Button>
          </div>
          <p className="help">BetterGo reviewers are platform volunteers or staff, not government officials.</p>
        </div>
      </div>

      <div className="card mt-4">
        <h2 style={{ fontSize: 'var(--text-h4)' }}>History</h2>
        <ul className="timeline mt-2">
          {data.history.map((event, index) => (
            <li key={index}>
              <div className="text-sm">{event.to_status.replace(/_/g, ' ')}{event.from_status ? ` (from ${event.from_status.replace(/_/g, ' ')})` : ''}</div>
              {event.note ? <div className="text-xs">{event.note}</div> : null}
              <div className="text-xs text-muted">{fmtDateTime(event.created_at)} · {event.actor_name || 'System'} · {event.citizen_visible ? 'visible to citizen' : 'internal'}</div>
            </li>
          ))}
        </ul>
      </div>

      <Modal open={requesting} onClose={() => setRequesting(false)} title="Request more information" actions={<><Button variant="outline" onClick={() => setRequesting(false)}>Cancel</Button><Button onClick={requestInfo} loading={busy}>Send request</Button></>}>
        <Field label="What is missing?" htmlFor="request-message" required help="Ask only for information this service actually needs.">
          <Textarea id="request-message" value={requestMessage} onChange={(event) => setRequestMessage(event.target.value)} maxLength={1000} style={{ minHeight: 100 }} />
        </Field>
      </Modal>
    </div>
  )
}
