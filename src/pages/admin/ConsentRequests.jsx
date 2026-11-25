import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Field, Input, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

const empty = {
  title: '',
  purpose: '',
  requestingEntity: 'BetterGo Marinduque (platform)',
  informationInvolved: '',
  intendedUse: '',
  dataRecipients: '',
  processingDuration: '',
  expiresAt: '',
  requiredPermissions: '',
  optionalPermissions: '',
  withdrawalInstructions: 'Withdraw any time from the consent centre.',
  privacyNoticeVersion: '0.9-draft',
}

const list = (value) => value.split(',').map((entry) => entry.trim()).filter(Boolean)

export function AdminConsentRequests() {
  useDocumentTitle('Consent requests')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [form, setForm] = useState(empty)

  const load = async () => {
    try {
      setData(await api.get('/admin/consent-requests'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const transition = async (row, action) => {
    const note = action === 'reject' ? window.prompt('Why is this request rejected?') || '' : undefined
    try {
      const result = await api.post(`/admin/consent-requests/${row.id}/transition`, { action, note })
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
        title="Consent requests"
        description="Build requests, review them and publish only what citizens can meaningfully decide on."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Consent requests' }]}
      />
      <Alert tone="info" title="No invented authority">{data?.note || 'Loading requests.'}</Alert>

      {!data ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="grid grid-5">
            <div className="card"><div className="side-label">Requests</div><strong>{data.summary.total}</strong></div>
            <div className="card"><div className="side-label">Pending review</div><strong>{data.summary.pendingReview}</strong></div>
            <div className="card"><div className="side-label">Published</div><strong>{data.summary.published}</strong></div>
            <div className="card"><div className="side-label">Accepted</div><strong>{data.summary.accepted}</strong></div>
            <div className="card"><div className="side-label">Declined / withdrawn</div><strong>{data.summary.declined} / {data.summary.withdrawn}</strong></div>
          </div>

          <div className="card">
            <h2 className="side-label">New consent request</h2>
            <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Purpose (why the data is needed)"><Textarea rows={2} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></Field>
            <Field label="Requesting entity"><Input value={form.requestingEntity} onChange={(e) => setForm({ ...form, requestingEntity: e.target.value })} /></Field>
            <Field label="Information or resources involved"><Textarea rows={2} value={form.informationInvolved} onChange={(e) => setForm({ ...form, informationInvolved: e.target.value })} /></Field>
            <Field label="Intended use"><Textarea rows={2} value={form.intendedUse} onChange={(e) => setForm({ ...form, intendedUse: e.target.value })} /></Field>
            <Field label="Data recipients"><Input value={form.dataRecipients} onChange={(e) => setForm({ ...form, dataRecipients: e.target.value })} /></Field>
            <Field label="Processing duration"><Input value={form.processingDuration} onChange={(e) => setForm({ ...form, processingDuration: e.target.value })} /></Field>
            <Field label="Expiry date"><Input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field>
            <Field label="Required permissions (comma separated)"><Input value={form.requiredPermissions} onChange={(e) => setForm({ ...form, requiredPermissions: e.target.value })} placeholder="share_contact_details" /></Field>
            <Field label="Optional permissions (comma separated)"><Input value={form.optionalPermissions} onChange={(e) => setForm({ ...form, optionalPermissions: e.target.value })} /></Field>
            <Field label="Withdrawal instructions"><Textarea rows={2} value={form.withdrawalInstructions} onChange={(e) => setForm({ ...form, withdrawalInstructions: e.target.value })} /></Field>
            <Field label="Privacy notice version"><Input value={form.privacyNoticeVersion} onChange={(e) => setForm({ ...form, privacyNoticeVersion: e.target.value })} /></Field>
            <Button
              disabled={form.title.trim().length < 5 || form.purpose.trim().length < 10}
              onClick={async () => {
                try {
                  const result = await api.post('/admin/consent-requests', {
                    ...form,
                    expiresAt: form.expiresAt || undefined,
                    requiredPermissions: list(form.requiredPermissions),
                    optionalPermissions: list(form.optionalPermissions),
                    references: [],
                  })
                  toast.push(result.message)
                  setForm(empty)
                  await load()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Save draft
            </Button>
          </div>

          <div className="card">
            <h2 className="side-label">Request queue</h2>
            {data.requests.length ? data.requests.map((row) => (
              <div key={row.id} className="stack-tight">
                <div className="row-between">
                  <strong>{row.reference} · {row.title}</strong>
                  <Badge tone={row.status === 'published' ? 'success' : row.status === 'rejected' ? 'warning' : 'neutral'}>{row.statusLabel}</Badge>
                </div>
                <span className="text-xs text-muted">
                  {row.requestingEntity} · v{row.version} · expires {row.expiresAt || 'not set'} · accepted {row.decisionCounts.accepted}, declined {row.decisionCounts.declined}, withdrawn {row.decisionCounts.withdrawn}
                </span>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {row.status === 'draft' || row.status === 'rejected' ? <Button size="sm" variant="outline" onClick={() => transition(row, 'submit')}>Submit for review</Button> : null}
                  {row.status === 'pending_review' ? <Button size="sm" onClick={() => transition(row, 'approve')}>Approve for publication</Button> : null}
                  {row.status === 'approved_for_publication' ? <Button size="sm" onClick={() => transition(row, 'publish')}>Publish</Button> : null}
                  {['draft', 'pending_review', 'approved_for_publication'].includes(row.status) ? <Button size="sm" variant="ghost" onClick={() => transition(row, 'reject')}>Reject</Button> : null}
                  {['published', 'expired', 'rejected'].includes(row.status) ? <Button size="sm" variant="ghost" onClick={() => transition(row, 'archive')}>Archive</Button> : null}
                </div>
              </div>
            )) : <p className="text-sm text-muted">No consent requests yet.</p>}
          </div>
        </>
      )}
    </div>
  )
}
