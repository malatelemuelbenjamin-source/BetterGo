import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Select, SkeletonList, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

export function AdminComplaints() {
  useDocumentTitle('Case administration')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [analytics, setAnalytics] = useState(null)

  const load = async () => {
    try {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (category) params.set('category', category)
      setData(await api.get(`/admin/complaints?${params.toString()}`))
      setAnalytics(await api.get('/admin/complaints/analytics').catch(() => null))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, [status, category]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = async (item, next) => {
    const note = window.prompt('Public explanation (required for resolved or referred)') || ''
    try {
      await api.post(`/admin/complaints/${item.id}/status`, { status: next, note })
      toast.push('Case updated.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Complaint cases"
        description="Record case handling. BetterGo statuses are not official government findings."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Complaints' }]}
      />
      <Alert tone="info" title="Municipality boundaries">{data?.note || 'Loading cases...'}</Alert>

      <div className="card">
        <div className="row">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
            <option value="">All statuses</option>
            {(data?.statuses || []).map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
          </Select>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category filter">
            <option value="">All categories</option>
            {Object.entries(data?.categories || {}).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </div>
      </div>

      {!data ? <SkeletonList count={3} height={80} /> : data.results.map((item) => (
        <div className="card" key={item.id}>
          <div className="row-between">
            <strong>{item.reference} · {item.subject}</strong>
            <Badge tone={item.status === 'resolved' ? 'success' : 'neutral'}>{item.status.replaceAll('_', ' ')}</Badge>
          </div>
          <div className="card-meta">
            <span>{item.categoryLabel}</span>
            <span>{item.severityLabel}</span>
            <span>{item.citizenName}</span>
            {item.officeName ? <span>{item.officeName}</span> : null}
          </div>
          <p className="text-sm">{item.description}</p>
          {item.events.length ? <p className="text-xs text-muted">Last event: {item.events[item.events.length - 1].action.replaceAll('_', ' ')}</p> : null}
          {['new', 'acknowledged', 'in_review', 'needs_information', 'referred'].includes(item.status) ? (
            <div className="row">
              {['acknowledged', 'in_review', 'needs_information', 'referred', 'resolved', 'closed'].map((next) => (
                <Button key={next} size="sm" variant="outline" onClick={() => update(item, next)}>{next.replaceAll('_', ' ')}</Button>
              ))}
            </div>
          ) : null}
        </div>
      ))}

      {analytics ? (
        <div className="card">
          <h2 className="side-label">Aggregated cases</h2>
          <div className="grid grid-3">
            <div className="stat-card"><span className="stat-label">Cases</span><div className="stat-value">{analytics.totals.cases}</div></div>
            <div className="stat-card"><span className="stat-label">Open</span><div className="stat-value">{analytics.totals.open}</div></div>
            <div className="stat-card"><span className="stat-label">Resolved</span><div className="stat-value">{analytics.totals.resolved}</div></div>
          </div>
          <p className="text-sm text-muted">{analytics.note}</p>
        </div>
      ) : null}
    </div>
  )
}
