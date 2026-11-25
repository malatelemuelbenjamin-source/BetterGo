import { useEffect, useState } from 'react'
import { FileCheck2 } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, Field, Input, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

export default function ConsentRequestsPage() {
  useDocumentTitle('Consent requests')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [selected, setSelected] = useState([])
  const [typedName, setTypedName] = useState('')

  const load = async () => {
    try {
      setData(await api.get('/account/consent-requests'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="section-tight"><SkeletonList count={3} height={70} /></div>

  const decide = async (request, decision) => {
    try {
      const result = await api.post(`/account/consent-requests/${request.id}/decide`, {
        decision,
        permissions: decision === 'accepted' ? [...request.requiredPermissions, ...selected] : [],
        typedName: typedName || undefined,
      })
      toast.push(result.message)
      setSelected([])
      setTypedName('')
      setOpenId(null)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Privacy"
        title="Consent requests"
        description="Review what an office or platform entity is asking for before you decide."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Consent requests' }]}
      />
      <Alert tone="info" title="Platform records only">{data.note}</Alert>

      {data.pending.length === 0 ? <p className="text-sm text-muted">No requests are waiting for your decision.</p> : data.pending.map((request) => (
        <div key={request.id} className="card">
          <div className="row-between">
            <strong>{request.title}</strong>
            <Badge tone="warning">Needs your decision</Badge>
          </div>
          <p className="text-sm">{request.purpose}</p>
          <span className="text-xs text-muted">Requested by {request.requestingEntity} · expires {request.expiresAt || 'no date recorded'}</span>
          {openId === request.id ? (
            <div className="stack-tight">
              <Alert tone="info" title="What this covers">
                {request.informationInvolved || 'Not specified.'} {request.intendedUse} {request.dataRecipients ? `Recipients: ${request.dataRecipients}.` : ''} {request.processingDuration}
              </Alert>
              <div>
                <h3 className="side-label">Required permissions</h3>
                {request.requiredPermissions.map((permission) => <div key={permission} className="text-sm">• {permission}</div>)}
              </div>
              {request.optionalPermissions.length ? (
                <div>
                  <h3 className="side-label">Optional permissions (choose only what you want)</h3>
                  {request.optionalPermissions.map((permission) => (
                    <label key={permission} className="row text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(permission)}
                        onChange={(e) => setSelected(e.target.checked ? [...selected, permission] : selected.filter((entry) => entry !== permission))}
                      />
                      {permission}
                    </label>
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-muted">{request.withdrawalInstructions || 'You can withdraw this consent from this page at any time.'}</p>
              <Field label="Type your full name to acknowledge (optional)"><Input value={typedName} onChange={(e) => setTypedName(e.target.value)} /></Field>
              <div className="row">
                <Button icon={FileCheck2} onClick={() => decide(request, 'accepted')}>Accept selected permissions</Button>
                <Button variant="outline" onClick={() => decide(request, 'declined')}>Decline</Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => { setOpenId(request.id); setSelected([]); setTypedName('') }}>Review request</Button>
          )}
        </div>
      ))}

      <div className="card">
        <h2 className="side-label">Your decisions</h2>
        {data.history.length ? data.history.map((item) => (
          <div key={item.id} className="stack-tight">
            <div className="row-between">
              <strong>{item.title}</strong>
              <Badge tone={item.decision?.decision === 'accepted' && !item.decision.withdrawnAt ? 'success' : 'neutral'}>
                {item.decision?.withdrawnAt ? 'Withdrawn' : item.decision?.decisionLabel || 'No decision'}
              </Badge>
            </div>
            <span className="text-xs text-muted">
              {item.decision ? `Decided ${item.decision.decidedAt?.slice(0, 16)} · receipt ${item.decision.reference} · granted: ${item.decision.grantedPermissions.join(', ') || 'none'}` : `Expired ${item.expiresAt || ''}`}
            </span>
            {item.decision ? (
              <div className="row">
                <a className="btn btn-ghost btn-sm" href={`/api/account/consent-requests/${item.id}/receipt`}>Download receipt</a>
                {item.decision.decision === 'accepted' && !item.decision.withdrawnAt ? (
                  <Button size="sm" variant="ghost" onClick={async () => {
                    try {
                      const result = await api.post(`/account/consent-requests/${item.id}/withdraw`, {})
                      toast.push(result.message)
                      await load()
                    } catch (err) {
                      toast.push(err.message, 'error')
                    }
                  }}>Withdraw</Button>
                ) : null}
              </div>
            ) : null}
          </div>
        )) : <p className="text-sm text-muted">No past decisions.</p>}
      </div>

      <div className="card">
        <h2 className="side-label">Activity log</h2>
        {data.activity?.length ? data.activity.map((entry, index) => (
          <span key={index} className="text-xs text-muted">{entry.created_at?.slice(0, 16)} · {entry.action} {entry.detail ? `· ${entry.detail}` : ''}</span>
        )) : <p className="text-sm text-muted">No history yet.</p>}
      </div>
    </div>
  )
}
