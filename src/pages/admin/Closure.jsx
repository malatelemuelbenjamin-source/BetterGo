import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, SkeletonList, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

export function AdminClosure() {
  useDocumentTitle('Account closure requests')
  const toast = useToast()
  const [data, setData] = useState(null)

  const load = async () => {
    try {
      setData(await api.get('/admin/closure-requests'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (row, decision) => {
    const note = window.prompt(decision === 'approved' ? 'What did you check before approving?' : 'Why is the request declined?') || ''
    try {
      const result = await api.post(`/admin/closure-requests/${row.id}/decision`, { decision, note })
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
        title="Account closure requests"
        description="Review requests truthfully. A decision never deletes data by itself."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Account closure requests' }]}
      />
      <Alert tone="warning" title="No automatic deletion">{data?.note || 'Loading requests.'}</Alert>

      {!data ? <SkeletonList count={3} height={70} /> : data.results.map((row) => (
        <div key={row.id} className="card">
          <div className="row-between">
            <strong>{row.reference} · {row.citizenName}</strong>
            <Badge tone={row.status === 'pending_review' ? 'info' : row.status === 'approved' ? 'warning' : 'neutral'}>{row.statusLabel}</Badge>
          </div>
          <div className="card-meta">
            <span>{row.citizenEmail}</span>
            <span>Requested {row.requestedAt?.slice(0, 10)}</span>
          </div>
          {row.reason ? <p className="text-sm text-muted">Reason: {row.reason}</p> : null}
          {row.reviewNote ? <p className="text-sm text-muted">Review: {row.reviewNote}</p> : null}
          {row.status === 'pending_review' ? (
            <div className="row">
              <Button size="sm" onClick={() => decide(row, 'approved')}>Approve for manual closure</Button>
              <Button size="sm" variant="outline" onClick={() => decide(row, 'declined')}>Decline</Button>
            </div>
          ) : null}
        </div>
      ))}
      {data && !data.results.length ? <p className="text-sm text-muted">No closure requests in your scope.</p> : null}
    </div>
  )
}
