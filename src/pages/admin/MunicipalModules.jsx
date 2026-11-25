import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, ChartBar, Download, MapPin, MessageSquare, Plus } from 'lucide-react'
import { api, fmtDate, fmtNumber, query } from '../../api'
import { useApi, useDocumentTitle } from '../../hooks'
import { useAuth } from '../../auth'
import { Alert, Badge, Button, EmptyState, Field, Input, Select, SkeletonList, Tabs, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

/**
 * Municipal operations workspace (Prompts 46–53, 56): office directory
 * management, public feedback review, portal analytics and data export.
 * Content itself (news, notices, programs, projects, resources, FAQs) is
 * managed in the main municipal workspace.
 */
export function AdminMunicipalModules() {
  const { id } = useParams()
  const toast = useToast()
  const { can } = useAuth()
  const { data: portal, loading } = useApi(`/admin/municipal-portals/${id}`)
  const [tab, setTab] = useState('offices')
  const [offices, setOffices] = useState({ rows: [], error: null })
  const [feedback, setFeedback] = useState({ rows: [], error: null })
  const [analytics, setAnalytics] = useState(null)
  const [showOfficeForm, setShowOfficeForm] = useState(false)
  const [officeForm, setOfficeForm] = useState({
    name: '',
    office_type: 'Office',
    office_level: 'office',
    description: '',
    responsibilities: '',
    phone: '',
    email: '',
    address: '',
    operating_hours: '',
    source_reference: '',
    source_url: '',
    latitude: '',
    longitude: '',
    location_verified: false,
  })
  const [busy, setBusy] = useState(false)
  const municipality = portal?.municipality
  useDocumentTitle(municipality ? `${municipality.name} operations` : 'Municipal operations')

  const loadOffices = async () => {
    try {
      const result = await api.get(`/admin/municipal-offices`)
      setOffices({ rows: (result.results || []).filter((row) => Number(row.municipality_id) === Number(id)), error: null })
    } catch (err) {
      setOffices({ rows: [], error: err.message })
    }
  }

  const loadFeedback = async () => {
    try {
      const result = await api.get(`/admin/municipal-feedback${query({ municipality_id: id })}`)
      setFeedback({ rows: result.results || [], error: null })
    } catch (err) {
      setFeedback({ rows: [], error: err.message })
    }
  }

  useEffect(() => {
    if (!id) return
    loadOffices()
    loadFeedback()
    api
      .get(`/admin/municipal-analytics/${id}`)
      .then(setAnalytics)
      .catch(() => setAnalytics(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function createOffice(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await api.post('/admin/municipal-offices', { ...officeForm, municipality_id: Number(id) })
      toast.push('Office created as a draft. Publish it once verified.')
      setShowOfficeForm(false)
      setOfficeForm((current) => ({ ...current, name: '', description: '', phone: '', email: '', address: '' }))
      loadOffices()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggleOffice(office, status) {
    try {
      await api.patch(`/admin/municipal-offices/${office.id}`, { publication_status: status })
      toast.push(status === 'published' ? 'Office published.' : 'Office returned to draft.')
      loadOffices()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  async function updateFeedback(row, status, response) {
    try {
      await api.patch(`/admin/municipal-feedback/${row.id}`, { status, response })
      toast.push('Feedback updated.')
      loadFeedback()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  if (loading) return <div className="container section"><SkeletonList count={2} height={160} /></div>
  if (!municipality) {
    return (
      <div className="container section">
        <EmptyState
          icon={Building2}
          title="Operations workspace not available"
          description="This municipality does not exist, or it is outside your assigned scope."
          action={<Link className="btn btn-primary" to="/admin/municipalities">Municipalities</Link>}
        />
      </div>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Municipal operations"
        title={`${municipality.name} operations`}
        description="Offices, citizen feedback, portal analytics and data export. Published content is managed in the content workspace."
        breadcrumbs={[
          { label: 'Admin', to: '/admin' },
          { label: 'Municipalities', to: '/admin/municipalities' },
          { label: municipality.name, to: `/admin/municipalities/${id}` },
          { label: 'Operations' },
        ]}
        actions={
          <Link className="btn btn-outline btn-sm" to={`/admin/municipalities/${id}`}>
            <ArrowLeft size={14} aria-hidden="true" /> Content workspace
          </Link>
        }
      />

      <div className="container section-tight">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'offices', label: 'Offices' },
            { value: 'feedback', label: 'Feedback' },
            { value: 'analytics', label: 'Analytics' },
            { value: 'data', label: 'Data export' },
          ]}
        />

        {tab === 'offices' ? (
          <div className="stack mt-4">
            <div className="row-between">
              <h2 style={{ fontSize: 'var(--text-h3)' }}>Municipal offices</h2>
              {can('municipal.portal.manage') ? (
                <button className="btn btn-primary btn-sm" type="button" onClick={() => setShowOfficeForm((value) => !value)}>
                  <Plus size={14} aria-hidden="true" /> New office
                </button>
              ) : null}
            </div>
            <Alert tone="info">
              Offices are published only after verification. Coordinates are optional and are shown on the public map only when marked verified.
            </Alert>

            {showOfficeForm ? (
              <form className="card" onSubmit={createOffice}>
                <h3 style={{ fontSize: 'var(--text-h4)' }}>New office record</h3>
                <div className="form-grid mt-2">
                  <Field label="Office name" htmlFor="office-name" required>
                    <Input id="office-name" value={officeForm.name} onChange={(event) => setOfficeForm({ ...officeForm, name: event.target.value })} required minLength={2} maxLength={200} />
                  </Field>
                  <Field label="Level" htmlFor="office-level">
                    <Select id="office-level" value={officeForm.office_level} onChange={(event) => setOfficeForm({ ...officeForm, office_level: event.target.value })}>
                      <option value="department">Department</option>
                      <option value="office">Office</option>
                      <option value="division">Division</option>
                      <option value="unit">Unit</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Description" htmlFor="office-description">
                  <Textarea id="office-description" value={officeForm.description} onChange={(event) => setOfficeForm({ ...officeForm, description: event.target.value })} style={{ minHeight: 70 }} />
                </Field>
                <div className="form-grid">
                  <Field label="Phone" htmlFor="office-phone">
                    <Input id="office-phone" value={officeForm.phone} onChange={(event) => setOfficeForm({ ...officeForm, phone: event.target.value })} maxLength={40} />
                  </Field>
                  <Field label="Email" htmlFor="office-email">
                    <Input id="office-email" type="email" value={officeForm.email} onChange={(event) => setOfficeForm({ ...officeForm, email: event.target.value })} maxLength={200} />
                  </Field>
                </div>
                <Field label="Address" htmlFor="office-address">
                  <Input id="office-address" value={officeForm.address} onChange={(event) => setOfficeForm({ ...officeForm, address: event.target.value })} maxLength={300} />
                </Field>
                <div className="form-grid">
                  <Field label="Latitude" htmlFor="office-lat" help="From the official source only.">
                    <Input id="office-lat" type="number" step="0.000001" value={officeForm.latitude} onChange={(event) => setOfficeForm({ ...officeForm, latitude: event.target.value })} />
                  </Field>
                  <Field label="Longitude" htmlFor="office-lng">
                    <Input id="office-lng" type="number" step="0.000001" value={officeForm.longitude} onChange={(event) => setOfficeForm({ ...officeForm, longitude: event.target.value })} />
                  </Field>
                </div>
                <label className="checkbox-inline text-sm">
                  <input
                    type="checkbox"
                    checked={officeForm.location_verified}
                    onChange={(event) => setOfficeForm({ ...officeForm, location_verified: event.target.checked })}
                  />
                  Location verified against the recorded source
                </label>
                <div className="form-grid mt-2">
                  <Field label="Source reference" htmlFor="office-source">
                    <Input id="office-source" value={officeForm.source_reference} onChange={(event) => setOfficeForm({ ...officeForm, source_reference: event.target.value })} maxLength={500} />
                  </Field>
                  <Field label="Source URL" htmlFor="office-source-url">
                    <Input id="office-source-url" type="url" value={officeForm.source_url} onChange={(event) => setOfficeForm({ ...officeForm, source_url: event.target.value })} maxLength={500} />
                  </Field>
                </div>
                <div className="row mt-3">
                  <Button type="submit" loading={busy}>Create draft office</Button>
                  <Button type="button" variant="outline" onClick={() => setShowOfficeForm(false)}>Cancel</Button>
                </div>
              </form>
            ) : null}

            {offices.error ? <Alert tone="error" title="Offices could not be loaded">{offices.error}</Alert> : null}
            {offices.rows.length ? (
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">Municipal offices</caption>
                  <thead>
                    <tr><th scope="col">Office</th><th scope="col">Level</th><th scope="col">Status</th><th scope="col">Verification</th><th scope="col">Location</th><th scope="col">Actions</th></tr>
                  </thead>
                  <tbody>
                    {offices.rows.map((office) => (
                      <tr key={office.id}>
                        <td>
                          <strong>{office.name}</strong>
                          {office.phone ? <div className="text-xs text-muted">{office.phone}</div> : null}
                        </td>
                        <td>{office.office_level}</td>
                        <td><Badge tone={office.publication_status === 'published' ? 'success' : 'neutral'}>{String(office.publication_status).replace(/_/g, ' ')}</Badge></td>
                        <td>{String(office.verification_status).replace(/_/g, ' ')}</td>
                        <td>{office.location_verified === 1 ? <span className="text-xs"><MapPin size={12} aria-hidden="true" /> verified</span> : <span className="text-xs text-muted">not verified</span>}</td>
                        <td>
                          <div className="row" style={{ gap: '0.35rem' }}>
                            {can('municipal.portal.manage') && office.publication_status !== 'published' ? (
                              <button className="btn btn-ghost btn-sm" type="button" onClick={() => toggleOffice(office, 'published')}>Publish</button>
                            ) : null}
                            {can('municipal.portal.manage') && office.publication_status === 'published' ? (
                              <button className="btn btn-ghost btn-sm" type="button" onClick={() => toggleOffice(office, 'draft')}>Unpublish</button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={Building2} title="No office records yet" description="Add an office once its details and source are confirmed." />
            )}
          </div>
        ) : null}

        {tab === 'feedback' ? (
          <div className="stack mt-4">
            <h2 style={{ fontSize: 'var(--text-h3)' }}>Citizen feedback</h2>
            <p className="text-sm text-muted">Messages from the public portal. Reviewing a message never changes an official record.</p>
            {feedback.error ? <Alert tone="error" title="Feedback could not be loaded">{feedback.error}</Alert> : null}
            {feedback.rows.length ? (
              feedback.rows.map((row) => (
                <FeedbackRow key={row.id} row={row} canReview={can('municipal.content.review')} onSave={updateFeedback} />
              ))
            ) : (
              <EmptyState icon={MessageSquare} title="No feedback received" description="Public corrections and questions for this municipality appear here." />
            )}
          </div>
        ) : null}

        {tab === 'analytics' ? (
          <div className="stack mt-4">
            <h2 style={{ fontSize: 'var(--text-h3)' }}>Portal analytics</h2>
            {analytics ? (
              <>
                <p className="text-sm text-muted">{analytics.note}</p>
                <div className="grid grid-3">
                  {Object.entries(analytics.totals || {}).map(([metric, total]) => (
                    <div key={metric} className="card stat-card">
                      <span className="text-xs text-muted">{metric.replace(/_/g, ' ')}</span>
                      <strong style={{ fontSize: '1.4rem' }}>{fmtNumber(total)}</strong>
                      <span className="text-xs text-muted">last {analytics.days} days</span>
                    </div>
                  ))}
                  {!Object.keys(analytics.totals || {}).length ? (
                    <Alert tone="info">No page views recorded yet for this municipality.</Alert>
                  ) : null}
                </div>
                <div className="card">
                  <h3 style={{ fontSize: 'var(--text-h4)' }}>Published records by type</h3>
                  <ul className="link-list mt-2">
                    {Object.entries(analytics.published || {}).map(([type, statuses]) => (
                      <li key={type}>
                        {type.replace(/_/g, ' ')}: {Object.entries(statuses).map(([status, total]) => `${total} ${status.replace(/_/g, ' ')}`).join(', ')}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <Alert tone="info">Analytics are not available for this workspace.</Alert>
            )}
          </div>
        ) : null}

        {tab === 'data' ? (
          <div className="stack mt-4">
            <h2 style={{ fontSize: 'var(--text-h3)' }}>Data export</h2>
            <p className="text-sm text-muted">
              Export this municipality&apos;s content records for offline review or records management. Exports contain no user or reviewer personal data
              and every export is written to the audit log.
            </p>
            <div className="row">
              <a className="btn btn-outline" href={`/api/admin/municipal-export?municipality_id=${id}&format=json`} target="_blank" rel="noopener noreferrer">
                <Download size={14} aria-hidden="true" /> Export JSON
              </a>
              <a className="btn btn-outline" href={`/api/admin/municipal-export?municipality_id=${id}&format=csv`} target="_blank" rel="noopener noreferrer">
                <Download size={14} aria-hidden="true" /> Export CSV
              </a>
            </div>
            <Alert tone="info">
              <ChartBar size={14} aria-hidden="true" /> The read-only public API is documented at <Link to="/developers/api-docs">API documentation</Link>.
            </Alert>
          </div>
        ) : null}
      </div>
    </>
  )
}

function FeedbackRow({ row, canReview, onSave }) {
  const [status, setStatus] = useState(row.status)
  const [response, setResponse] = useState(row.response || '')
  const [busy, setBusy] = useState(false)

  return (
    <div className="card">
      <div className="row-between">
        <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
          <Badge>{row.kind}</Badge>
          <Badge tone={row.status === 'resolved' ? 'success' : row.status === 'new' ? 'warning' : 'neutral'}>{row.status}</Badge>
        </div>
        <span className="text-xs text-muted">{fmtDate(row.created_at)}</span>
      </div>
      <p className="text-sm mt-2" style={{ whiteSpace: 'pre-line' }}>{row.message}</p>
      <p className="help">
        {row.name ? `${row.name} · ` : ''}{row.email || 'No email provided'}{row.content_title ? ` · about ${row.content_title}` : ''}
      </p>
      {canReview ? (
        <div className="stack-sm mt-2">
          <div className="form-grid">
            <Field label="Status" htmlFor={`feedback-status-${row.id}`}>
              <Select id={`feedback-status-${row.id}`} value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="new">New</option>
                <option value="reviewing">Reviewing</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </Select>
            </Field>
            <Field label="Internal response note" htmlFor={`feedback-response-${row.id}`} help="Not published automatically.">
              <Input id={`feedback-response-${row.id}`} value={response} onChange={(event) => setResponse(event.target.value)} maxLength={4000} />
            </Field>
          </div>
          <div className="row">
            <button
              className="btn btn-outline btn-sm"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await onSave(row, status, response)
                setBusy(false)
              }}
            >
              {busy ? 'Saving…' : 'Save review'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
