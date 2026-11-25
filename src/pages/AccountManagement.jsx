import { useEffect, useState } from 'react'
import { UserX, PauseCircle } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, Field, Input, SkeletonList, Textarea, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

export default function AccountManagementPage() {
  useDocumentTitle('Account management')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [reason, setReason] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [deactivateText, setDeactivateText] = useState('')

  const load = async () => {
    try {
      setData(await api.get('/account/account-management'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="section-tight"><SkeletonList count={3} height={70} /></div>

  const deletion = data.deletion
  const createDraft = async () => {
    try {
      const result = await api.post('/account/deletion-requests', { reason: reason || undefined })
      toast.push(result.message)
      setReason('')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Account management"
        description="Pause or close your BetterGo account with a clear view of what happens to your records."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Account management' }]}
      />
      <Alert tone="info" title="No instant erasure">{data.note}</Alert>

      <div className="grid grid-3">
        <div className="card"><div className="side-label">Account status</div><strong>{data.account.status}</strong></div>
        <div className="card"><div className="side-label">Active sessions</div><strong>{data.sessions}</strong></div>
        <div className="card"><div className="side-label">Representatives</div><strong>{data.representatives.length}</strong></div>
      </div>

      <div className="card">
        <h2 className="side-label">Temporary deactivation</h2>
        <p className="text-xs text-muted">Deactivation ends sessions and delegated access, blocks new submissions and keeps your records. Reactivate by signing in with your email and password.</p>
        {data.deactivation ? (
          <div className="stack-tight">
            <div className="row-between">
              <strong>{data.deactivation.reference}</strong>
              <Badge tone={data.deactivation.status === 'active' ? 'warning' : 'neutral'}>{data.deactivation.statusLabel}</Badge>
            </div>
            <span className="text-xs text-muted">Effective {data.deactivation.effectiveAt?.slice(0, 16)}</span>
          </div>
        ) : null}
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Type DEACTIVATE to confirm">
          <Input value={deactivateText} onChange={(e) => setDeactivateText(e.target.value)} />
        </Field>
        <Button
          variant="outline"
          icon={PauseCircle}
          disabled={deactivateText !== 'DEACTIVATE'}
          onClick={async () => {
            try {
              const result = await api.post('/account/deactivate', { reason: reason || undefined, confirm: 'DEACTIVATE' })
              toast.push(result.message)
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Deactivate account
        </Button>
        <p className="text-xs text-muted">{data.recovery}</p>
      </div>

      <div className="card">
        <h2 className="side-label">Permanent deletion request</h2>
        <p className="text-xs text-muted">Deletion is reviewed. Some records may be anonymised instead of erased, and records under an approved retention rule may be kept.</p>
        {deletion ? (
          <div className="stack-tight">
            <div className="row-between">
              <strong>{deletion.reference}</strong>
              <Badge tone={deletion.status === 'completed' ? 'success' : deletion.status === 'rejected' ? 'neutral' : 'warning'}>{deletion.statusLabel}</Badge>
            </div>
            {deletion.reviewNote ? <span className="text-xs text-muted">Review note: {deletion.reviewNote}</span> : null}
            {deletion.status === 'draft' ? (
              <>
                <Alert tone="warning" title="Consequences before submitting">
                  Sign-in ends after processing. Sessions and delegated access are revoked. Some records may be anonymised, while retained records and official office records remain.
                </Alert>
                <Field label="Type your account email exactly">
                  <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
                </Field>
                <Button
                  disabled={confirmText.toLowerCase() !== data.account.email.toLowerCase()}
                  onClick={async () => {
                    try {
                      const result = await api.post(`/account/deletion-requests/${deletion.id}/submit`, { confirmationText: confirmText, confirm: true })
                      toast.push(result.message)
                      setConfirmText('')
                      await load()
                    } catch (err) {
                      toast.push(err.message, 'error')
                    }
                  }}
                >
                  Submit deletion request
                </Button>
              </>
            ) : null}
            {!['completed', 'rejected', 'withdrawn'].includes(deletion.status) ? (
              <Button size="sm" variant="ghost" onClick={async () => {
                try {
                  const result = await api.post(`/account/deletion-requests/${deletion.id}/withdraw`, {})
                  toast.push(result.message)
                  await load()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}>Withdraw request</Button>
            ) : null}
          </div>
        ) : null}
        {!deletion || ['completed', 'rejected', 'withdrawn'].includes(deletion.status) ? (
          <>
            <Field label="Why are you closing the account? (optional)">
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button variant="outline" icon={UserX} onClick={createDraft}>Start deletion request</Button>
          </>
        ) : null}
        {data.deletionHistory.length > 1 ? (
          <div className="stack-tight">
            <h3 className="side-label">Request history</h3>
            {data.deletionHistory.map((row) => (
              <div key={row.id} className="row-between text-xs text-muted"><span>{row.reference}</span><span>{row.statusLabel}</span></div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2 className="side-label">Retention categories</h2>
        <p className="text-xs text-muted">BetterGo does not invent legal retention periods. Rules stay marked pending until legal and privacy review approves them.</p>
        {data.retention.map((rule) => (
          <div key={rule.category} className="stack-tight">
            <div className="row-between">
              <strong>{rule.categoryLabel}</strong>
              <Badge tone={rule.legalReviewStatus === 'approved' ? 'success' : 'warning'}>{rule.legalReviewLabel}</Badge>
            </div>
            <span className="text-xs text-muted">{rule.retentionRule}</span>
            {rule.exceptions ? <span className="text-xs text-muted">{rule.exceptions}</span> : null}
          </div>
        ))}
      </div>

      {data.privacyRequests.length ? (
        <div className="card">
          <h2 className="side-label">Privacy requests</h2>
          {data.privacyRequests.map((row) => (
            <div key={row.reference} className="row-between text-sm"><span>{row.reference} · {row.request_type}</span><span>{row.status}</span></div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
