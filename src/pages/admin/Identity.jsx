import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Select, SkeletonList, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

export function AdminIdentity() {
  useDocumentTitle('Identity verification review')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('pending')

  const load = async () => {
    try {
      setData(await api.get(`/admin/identity-verifications?status=${status}`))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (row, decision) => {
    const note = window.prompt('What did the office review actually confirm?') || ''
    try {
      await api.post(`/admin/identity-verifications/${row.id}/decision`, { decision, note })
      toast.push('Review recorded.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Identity verification review"
        description="Record only reviews that actually happened with the responsible office."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Identity review' }]}
      />
      <Alert tone="info" title="No document collection">{data?.note || 'Loading requests.'}</Alert>

      <div className="card">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          {['pending', 'verified', 'rejected', 'cancelled'].map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
      </div>

      {!data ? <SkeletonList count={3} height={70} /> : data.results.map((row) => (
        <div className="card" key={row.id}>
          <div className="row-between">
            <strong>{row.reference} · {row.typeLabel}</strong>
            <Badge tone={row.status === 'verified' ? 'success' : row.status === 'pending' ? 'warning' : 'neutral'}>{row.statusLabel}</Badge>
          </div>
          <div className="card-meta">
            <span>{row.citizenName}</span>
            <span>{row.citizenEmail}</span>
            <span>Requested {row.requestedAt?.slice(0, 10)}</span>
          </div>
          {row.citizenNote ? <p className="text-sm text-muted">Citizen note: {row.citizenNote}</p> : null}
          {row.status === 'pending' ? (
            <div className="row">
              <Button size="sm" onClick={() => decide(row, 'verified')}>Record verified review</Button>
              <Button size="sm" variant="outline" onClick={() => decide(row, 'rejected')}>Reject</Button>
            </div>
          ) : row.officeNote ? <p className="text-sm text-muted">Office note: {row.officeNote}</p> : null}
        </div>
      ))}
    </div>
  )
}
