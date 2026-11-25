import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, SkeletonList, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

export function AdminConsent() {
  useDocumentTitle('Consent and signature records')
  const toast = useToast()
  const [data, setData] = useState(null)

  const load = async () => {
    try {
      setData(await api.get('/admin/consent'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const acknowledge = async (row) => {
    const note = window.prompt('What did the office actually receive?') || ''
    try {
      const result = await api.post(`/admin/consent/signatures/${row.id}/acknowledge`, { note })
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
        title="Consent and signature records"
        description="Review platform consent and typed-name signature records within your municipality scope."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Consent and signatures' }]}
      />
      <Alert tone="info" title="Platform records only">{data?.note || 'Loading records.'}</Alert>

      {!data ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="grid grid-3">
            <div className="card"><div className="side-label">Recorded signatures</div><strong>{data.summary.recordedSignatures}</strong></div>
            <div className="card"><div className="side-label">Awaiting acknowledgement</div><strong>{data.summary.awaitingAcknowledgement}</strong></div>
            <div className="card"><div className="side-label">Active authorizations</div><strong>{data.summary.activeAuthorizations}</strong></div>
          </div>

          <div className="card">
            <h2 className="side-label">Signature records</h2>
            {data.signatures.length ? data.signatures.map((row) => (
              <div key={row.id} className="stack-tight">
                <div className="row-between">
                  <strong>{row.reference} · {row.statementLabel}</strong>
                  <Badge tone={row.status === 'recorded' ? 'success' : 'neutral'}>{row.status}</Badge>
                </div>
                <span className="text-xs text-muted">{row.citizenName} · signed {row.createdAt?.slice(0, 10)}</span>
                <span className="text-xs text-muted">{row.statementText}</span>
                {row.acknowledgedAt ? <span className="text-xs text-muted">Acknowledged as received on {row.acknowledgedAt.slice(0, 10)}</span> : row.status === 'recorded' ? (
                  <Button size="sm" variant="outline" onClick={() => acknowledge(row)}>Acknowledge receipt</Button>
                ) : null}
              </div>
            )) : <p className="text-sm text-muted">No signature records in your scope.</p>}
          </div>

          <div className="card">
            <h2 className="side-label">Data-sharing authorizations</h2>
            {data.authorizations.length ? data.authorizations.map((row) => (
              <div key={row.id} className="stack-tight">
                <div className="row-between">
                  <strong>{row.reference} · {row.recipientName}</strong>
                  <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>{row.status}</Badge>
                </div>
                <span className="text-xs text-muted">{row.citizenName} · {row.recipientOrganization} · {row.categoryLabels.join(' · ')}</span>
                <span className="text-xs text-muted">{row.purpose}</span>
              </div>
            )) : <p className="text-sm text-muted">No authorizations in your scope.</p>}
          </div>
        </>
      )}
    </div>
  )
}
