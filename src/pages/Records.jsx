import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileClock, FolderLock, ShieldCheck } from 'lucide-react'
import { api, fmtDate, fmtDateTime } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Input, Modal, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

const PAGE_SIZE = 20

/**
 * Citizen digital records centre (Prompt 67).
 * A unified, chronological view of records that already exist for this account.
 * Nothing here is an official government record or a certified document.
 */
export default function RecordsPage() {
  useDocumentTitle('My records')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ category: '', q: '', status: '', from: '', to: '', sort: 'newest', page: 1 })
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)

  const query = () => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(filters.page), sort: filters.sort })
    for (const key of ['category', 'q', 'status', 'from', 'to']) if (filters[key]) params.set(key, filters[key])
    return params.toString()
  }

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api.get(`/account/records?${query()}`))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.category, filters.q, filters.status, filters.from, filters.to, filters.sort, filters.page])

  const openDetail = async (row) => {
    if (!['application', 'document', 'privacy_request'].includes(row.recordType)) return
    setSelected(row)
    setDetail(null)
    try {
      const payload = await api.get(`/account/records/${row.recordType}/${row.recordId}`)
      setDetail(payload.record)
    } catch (err) {
      toast.push(err.message, 'error')
      setSelected(null)
    }
  }

  const download = async (format) => {
    try {
      const params = new URLSearchParams({ format })
      for (const key of ['category', 'q', 'status', 'from', 'to']) if (filters[key]) params.set(key, filters[key])
      const response = await fetch(`/api/account/records/export?${params.toString()}`, { credentials: 'include' })
      if (!response.ok) throw new Error('The export could not be generated.')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `bettergo-activity.${format}`
      link.click()
      URL.revokeObjectURL(url)
      toast.push('Activity summary downloaded.')
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value, page: 1 }))

  const groups = []
  for (const row of data?.results || []) {
    const day = String(row.occurredAt || '').slice(0, 10)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(row)
    else groups.push({ day, items: [row] })
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="My records"
        description="Your BetterGo submissions, document activity, saved services, security events and privacy requests in one place."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'My records' }]}
        actions={
          <div className="row">
            <Button variant="outline" icon={Download} onClick={() => download('csv')}>CSV summary</Button>
            <Button variant="outline" icon={Download} onClick={() => download('json')}>JSON summary</Button>
          </div>
        }
      />

      <div className="grid grid-3 mt-4">
        <div className="card stat-card"><span className="stat-label">Recorded events</span><div className="stat-value">{data?.counts ? Object.values(data.counts).reduce((sum, value) => sum + value, 0) : 0}</div></div>
        <div className="card stat-card"><span className="stat-label">Applications</span><div className="stat-value">{data?.counts?.applications ?? 0}</div></div>
        <div className="card stat-card"><span className="stat-label">Document activity</span><div className="stat-value">{data?.counts?.documents ?? 0}</div></div>
      </div>

      <div className="row mt-4" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
        <button type="button" className={`pill ${!filters.category ? 'is-active' : ''}`} onClick={() => setFilter('category', '')}>All records</button>
        {(data?.categories || []).map((category) => (
          <button
            key={category.key}
            type="button"
            className={`pill ${filters.category === category.key ? 'is-active' : ''}`}
            aria-pressed={filters.category === category.key}
            onClick={() => setFilter('category', category.key)}
          >
            {category.label} ({category.count})
          </button>
        ))}
      </div>

      <div className="card mt-3">
        <div className="grid grid-3">
          <label className="field">
            <span className="field-label">Search</span>
            <Input value={filters.q} onChange={(event) => setFilter('q', event.target.value)} placeholder="Reference, service or description" />
          </label>
          <label className="field">
            <span className="field-label">From</span>
            <Input type="date" value={filters.from} onChange={(event) => setFilter('from', event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">To</span>
            <Input type="date" value={filters.to} onChange={(event) => setFilter('to', event.target.value)} />
          </label>
        </div>
        <div className="row-between">
          <Select value={filters.sort} onChange={(event) => setFilter('sort', event.target.value)} aria-label="Sort order">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </Select>
          <Button variant="ghost" onClick={() => setFilters({ category: '', q: '', status: '', from: '', to: '', sort: 'newest', page: 1 })}>Clear filters</Button>
        </div>
      </div>

      {error ? <Alert tone="error" title="Records could not be loaded">{error}</Alert> : null}

      {loading ? (
        <SkeletonList count={4} height={90} />
      ) : groups.length ? (
        <div className="stack mt-4">
          {groups.map((group) => (
            <section key={group.day} aria-label={group.day}>
              <h2 className="side-label" style={{ marginTop: '0.6rem' }}>{fmtDate(group.day)}</h2>
              <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {group.items.map((row) => (
                  <li key={row.key} className="card">
                    <div className="row-between">
                      <div>
                        <div className="text-xs text-muted">{row.typeLabel}</div>
                        <strong>{row.title}</strong>
                      </div>
                      <Badge tone={row.category === 'security' ? 'warning' : row.category === 'privacy' ? 'info' : 'neutral'}>{row.status || row.category}</Badge>
                    </div>
                    {row.description ? <p className="text-sm text-muted">{row.description}</p> : null}
                    <div className="card-meta">
                      <span>{fmtDateTime(row.occurredAt)}</span>
                      {row.municipalityName ? <span>{row.municipalityName}</span> : null}
                      {row.reference ? <span>{row.reference}</span> : null}
                    </div>
                    <div className="row" style={{ gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      {['application', 'document', 'privacy_request'].includes(row.recordType) ? (
                        <Button size="sm" variant="outline" onClick={() => openDetail(row)}>View record</Button>
                      ) : null}
                      {row.url ? <Link className="btn btn-ghost btn-sm" to={row.url}>Open</Link> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}

          <div className="row-between">
            <span className="text-sm text-muted">Page {data.page} of {data.totalPages} · {data.total} records</span>
            <div className="row">
              <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Previous</Button>
              <Button variant="outline" size="sm" disabled={data.page >= data.totalPages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Next</Button>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={FileClock}
          title="No records match these filters"
          description="Records appear as you submit BetterGo forms, upload documents, save services or update your account. Nothing is generated to fill this page."
          action={<Link className="btn btn-primary" to="/services">Browse government services</Link>}
        />
      )}

      <Alert tone="info" title="What these records are">
        {data?.disclaimer || 'These are BetterGo platform records, not official government records.'}{' '}
        <Link to="/dashboard/privacy/requests">Privacy requests</Link> · <Link to="/dashboard/documents">My documents</Link>
      </Alert>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title || 'Record'}>
        {detail ? (
          <div className="stack">
            {Object.entries(detail)
              .filter(([key]) => !['type', 'history', 'events', 'url'].includes(key))
              .map(([key, value]) => (value === null || value === '' ? null : (
                <div className="row-between" key={key}>
                  <span className="text-sm text-muted">{key.replace(/([A-Z])/g, ' $1')}</span>
                  <strong className="text-sm">{String(value)}</strong>
                </div>
              )))}
            {(detail.history || detail.events || []).length ? (
              <div>
                <h3 className="side-label">History</h3>
                <ol className="stack" style={{ listStyle: 'none', padding: 0 }}>
                  {(detail.history || detail.events).map((event, index) => (
                    <li key={index} className="text-sm">
                      <span className="text-muted">{fmtDateTime(event.created_at)}</span> · {event.label || event.event_type || event.to_status}
                      {event.note || event.detail ? <div className="text-muted">{event.note || event.detail}</div> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {detail.type === 'application' ? <Link className="btn btn-outline btn-sm" to={detail.url}>Open application</Link> : null}
          </div>
        ) : (
          <SkeletonList count={3} height={40} />
        )}
      </Modal>

      <div className="grid grid-2 mt-4">
        <div className="card">
          <div className="row"><FolderLock size={18} /><strong>Document activity</strong></div>
          <p className="text-sm text-muted">Uploads, replacements and shares recorded in your private vault. Files are never attached to this page.</p>
          <Link className="btn btn-outline btn-sm" to="/dashboard/documents">Open my documents</Link>
        </div>
        <div className="card">
          <div className="row"><ShieldCheck size={18} /><strong>Data and privacy</strong></div>
          <p className="text-sm text-muted">Ask for a copy of your data, a correction or deletion. Some records may be retained where the law requires it.</p>
          <Link className="btn btn-outline btn-sm" to="/dashboard/privacy/requests">Open privacy requests</Link>
        </div>
      </div>
    </div>
  )
}
