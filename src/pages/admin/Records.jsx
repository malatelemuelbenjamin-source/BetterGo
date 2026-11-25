import { useEffect, useState } from 'react'
import { Archive, RotateCcw, Search, ShieldCheck } from 'lucide-react'
import { api, fmtDateTime } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, EmptyState, Field, Input, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

const TABS = [
  { key: 'records', label: 'Application records' },
  { key: 'privacy', label: 'Privacy requests' },
  { key: 'retention', label: 'Retention settings' },
]

/**
 * Administrative records management (Prompt 67 §13).
 * Municipality-scoped: the API refuses records outside the administrator's
 * assigned municipalities, and retention settings are province-wide only.
 */
export function AdminRecords() {
  useDocumentTitle('Records management')
  const toast = useToast()
  const [tab, setTab] = useState('records')
  const [rows, setRows] = useState(null)
  const [term, setTerm] = useState('')
  const [policies, setPolicies] = useState(null)
  const [requests, setRequests] = useState(null)
  const [statuses, setStatuses] = useState({})
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      if (tab === 'records') setRows(await api.get(`/admin/records${term ? `?q=${encodeURIComponent(term)}` : ''}`))
      if (tab === 'privacy') setRequests(await api.get('/admin/records/privacy-requests'))
      if (tab === 'retention') setPolicies(await api.get('/admin/records/retention'))
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const archive = async (row) => {
    try {
      await api.post(`/admin/records/application/${row.id}/archive`, { reason: 'Retention review by records administrator' })
      toast.push('Record archived.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const restore = async (row) => {
    try {
      await api.post(`/admin/records/application/${row.id}/restore`, {})
      toast.push('Record restored.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const updateRequest = async (row) => {
    const next = statuses[row.reference] || { status: row.status, note: '' }
    try {
      await api.patch(`/admin/records/privacy-requests/${row.reference}`, {
        status: next.status,
        note: next.note || undefined,
        resolution: next.status === 'rejected' ? next.note : undefined,
      })
      toast.push('Privacy request updated.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const savePolicy = async (policy, days) => {
    try {
      await api.put('/admin/records/retention', { recordType: policy.recordType, retentionDays: days === '' ? null : Number(days) })
      toast.push('Retention policy saved.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Records management"
        description="Search BetterGo records within your scope, process privacy requests and configure retention. These are platform records, never government records."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Records' }]}
      />

      <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
        {TABS.map((entry) => (
          <button key={entry.key} type="button" className={`pill ${tab === entry.key ? 'is-active' : ''}`} onClick={() => setTab(entry.key)} aria-pressed={tab === entry.key}>
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'records' ? (
        <div className="mt-4">
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault()
              load()
            }}
          >
            <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search by BetterGo reference or service" aria-label="Search records" />
            <Button type="submit" icon={Search}>Search</Button>
          </form>

          {loading ? <SkeletonList count={3} height={70} /> : rows?.results?.length ? (
            <div className="stack mt-3">
              {rows.results.map((row) => (
                <div className="card" key={row.id}>
                  <div className="row-between">
                    <strong>{row.reference}</strong>
                    <Badge tone={row.archived_at ? 'neutral' : 'info'}>{row.archived_at ? 'Archived' : row.status}</Badge>
                  </div>
                  <p className="text-sm text-muted">{row.service_title || 'Service removed'} · {row.municipality_name || 'No municipality'}</p>
                  <div className="card-meta">
                    <span>Submitted {fmtDateTime(row.submitted_at || row.created_at)}</span>
                    <span>{row.submission_classification}</span>
                    <span>{row.citizen_email}</span>
                  </div>
                  {row.archived_at ? (
                    <Button size="sm" variant="outline" icon={RotateCcw} onClick={() => restore(row)}>Restore</Button>
                  ) : (
                    <Button size="sm" variant="outline" icon={Archive} onClick={() => archive(row)}>Archive</Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Archive} title="No records found" description="Search by BetterGo reference. Records outside your municipality scope are not shown." />
          )}
        </div>
      ) : null}

      {tab === 'privacy' ? (
        <div className="stack mt-4">
          <Alert tone="info" title="Platform workflow only">
            These statuses track the BetterGo privacy request. They do not approve or deny anything on behalf of a government office. Never delete records that must be retained.
          </Alert>
          {loading ? <SkeletonList count={3} height={80} /> : requests?.results?.length ? requests.results.map((row) => (
            <div className="card" key={row.id}>
              <div className="row-between">
                <strong>{row.reference} · {row.category}</strong>
                <Badge tone="info">{row.status_label || row.statusLabel}</Badge>
              </div>
              <p className="text-sm text-muted">{row.description}</p>
              <div className="card-meta"><span>{row.citizen_email}</span><span>{fmtDateTime(row.created_at)}</span></div>
              <div className="grid grid-2">
                <Field label="New status">
                  <Select
                    value={(statuses[row.reference]?.status) || row.status}
                    onChange={(event) => setStatuses((current) => ({ ...current, [row.reference]: { ...(current[row.reference] || {}), status: event.target.value } }))}
                  >
                    {Object.entries(requests.statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </Select>
                </Field>
                <Field label="Note to citizen (required when rejecting)">
                  <Textarea
                    rows={2}
                    value={statuses[row.reference]?.note || ''}
                    onChange={(event) => setStatuses((current) => ({ ...current, [row.reference]: { ...(current[row.reference] || {}), note: event.target.value } }))}
                  />
                </Field>
              </div>
              <Button size="sm" icon={ShieldCheck} onClick={() => updateRequest(row)}>Record decision</Button>
            </div>
          )) : <EmptyState icon={ShieldCheck} title="No privacy requests" description="Requests submitted by citizens appear here within your scope." />}
        </div>
      ) : null}

      {tab === 'retention' ? (
        <div className="stack mt-4">
          <Alert tone="warning" title="Retention is not deletion">
            A blank period keeps records with no automatic expiry. Active application records are never archived automatically; only closed or withdrawn records can be archived, and their audit history is preserved.
          </Alert>
          {loading ? <SkeletonList count={3} height={60} /> : policies?.policies?.map((policy) => (
            <div className="card" key={policy.recordType}>
              <div className="row-between">
                <strong>{policy.description}</strong>
                <span className="text-xs text-muted">{policy.recordType}</span>
              </div>
              <div className="row">
                <Input
                  type="number"
                  min="30"
                  max="36500"
                  defaultValue={policy.retentionDays ?? ''}
                  aria-label={`Retention days for ${policy.recordType}`}
                  onBlur={(event) => {
                    const next = event.target.value
                    if (String(policy.retentionDays ?? '') !== String(next)) savePolicy(policy, next)
                  }}
                />
                <span className="text-sm text-muted">days (leave blank for no expiry)</span>
              </div>
            </div>
          ))}
          {policies ? <p className="text-sm text-muted">{policies.note} · Active application records: {policies.activeApplications}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
