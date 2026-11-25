import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, SkeletonList, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

export function AdminOffline() {
  useDocumentTitle('Offline service packs')
  const toast = useToast()
  const [data, setData] = useState(null)

  useEffect(() => {
    api.get('/admin/offline-packs')
      .then(setData)
      .catch((err) => toast.push(err.message, 'error'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Offline service packs"
        description="Aggregate view only. Staff never see which services a resident saved."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Offline service packs' }]}
      />
      <Alert tone="info" title="Aggregate counts">{data?.note || 'Loading counts.'}</Alert>

      {!data ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="grid grid-3">
            <div className="card"><div className="side-label">Packs created</div><strong>{data.summary.packs}</strong></div>
            <div className="card"><div className="side-label">Past re-check date</div><strong>{data.summary.expiredPacks}</strong></div>
            <div className="card"><div className="side-label">Service entries</div><strong>{data.summary.servicesCovered}</strong></div>
          </div>
          <div className="card">
            <h2 className="side-label">By municipality</h2>
            {data.byMunicipality.length ? data.byMunicipality.map((row) => (
              <div key={row.municipality} className="row-between text-sm"><span>{row.municipality}</span><span>{row.packs}</span></div>
            )) : <p className="text-sm text-muted">No packs in your scope.</p>}
          </div>
        </>
      )}
    </div>
  )
}
