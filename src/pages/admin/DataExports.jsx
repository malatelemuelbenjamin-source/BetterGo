import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, SkeletonList, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

export function AdminDataExports() {
  useDocumentTitle('Data export queue')
  const toast = useToast()
  const [data, setData] = useState(null)

  const load = async () => {
    try {
      setData(await api.get('/admin/data-exports'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const purge = async (row) => {
    const note = window.prompt('What operational reason and retention rule applies?') || ''
    try {
      const result = await api.post(`/admin/data-exports/${row.id}/purge`, { note })
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
        title="Data export queue"
        description="Monitor export requests and apply retention without reading citizens' packages."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Data export queue' }]}
      />
      <Alert tone="info" title="Metadata only">{data?.note || 'Loading exports.'}</Alert>

      {!data ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="grid grid-4">
            <div className="card"><div className="side-label">Requests</div><strong>{data.summary.total}</strong></div>
            <div className="card"><div className="side-label">Available</div><strong>{data.summary.completed}</strong></div>
            <div className="card"><div className="side-label">Failed</div><strong>{data.summary.failed}</strong></div>
            <div className="card"><div className="side-label">Expired / purged</div><strong>{data.summary.expired}</strong></div>
          </div>
          <div className="card">
            <h2 className="side-label">Export requests</h2>
            {data.results.length ? data.results.map((row) => (
              <div key={row.id} className="stack-tight">
                <div className="row-between">
                  <strong>{row.reference} · {row.citizenName}</strong>
                  <Badge tone={row.status === 'completed' ? 'success' : row.status === 'failed' ? 'warning' : 'neutral'}>{row.statusLabel}</Badge>
                </div>
                <span className="text-xs text-muted">{row.citizenEmail} · {row.categoryLabels.join(', ')}</span>
                <span className="text-xs text-muted">Created {row.createdAt?.slice(0, 16)} · expires {row.expiresAt?.slice(0, 10)} {row.errorReason ? `· ${row.errorReason}` : ''}</span>
                {row.status !== 'expired' ? <Button size="sm" variant="ghost" onClick={() => purge(row)}>Purge contents (retention)</Button> : null}
              </div>
            )) : <p className="text-sm text-muted">No export requests in your scope.</p>}
          </div>
        </>
      )}
    </div>
  )
}
