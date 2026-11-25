import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

export function AdminAccountDeletion() {
  useDocumentTitle('Account deletion and retention')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [rule, setRule] = useState({ category: '', retentionRule: '', retentionTrigger: '', deletionMethod: '', legalReviewStatus: 'pending_legal_review', exceptions: '' })

  const load = async () => {
    try {
      const result = await api.get('/admin/account-deletion')
      setData(result)
      if (!rule.category && result.retention[0]) {
        const first = result.retention[0]
        setRule({ ...first, category: first.category })
      }
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (row, decision) => {
    const note = window.prompt('Review note (recorded in the request history)') || ''
    const scheduledFor = decision === 'schedule' ? window.prompt('Scheduled processing date (YYYY-MM-DD)') || '' : undefined
    try {
      const result = await api.post(`/admin/account-deletion/${row.id}/decision`, { decision, note, scheduledFor })
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
        title="Account deletion and retention"
        description="Review deactivation and deletion requests honestly. Nothing is erased by a decision alone."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Account deletion and retention' }]}
      />
      <Alert tone="warning" title="No false completion">{data?.note || 'Loading requests.'}</Alert>

      {!data ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="grid grid-4">
            <div className="card"><div className="side-label">Open requests</div><strong>{data.summary.openRequests}</strong></div>
            <div className="card"><div className="side-label">Completed</div><strong>{data.summary.completed}</strong></div>
            <div className="card"><div className="side-label">Failed</div><strong>{data.summary.failed}</strong></div>
            <div className="card"><div className="side-label">Active deactivations</div><strong>{data.summary.activeDeactivations}</strong></div>
          </div>

          <div className="card">
            <h2 className="side-label">Deletion requests</h2>
            {data.requests.length ? data.requests.map((row) => (
              <div key={row.id} className="stack-tight">
                <div className="row-between">
                  <strong>{row.reference} · {row.citizenName}</strong>
                  <Badge tone={row.status === 'completed' ? 'success' : row.status === 'rejected' ? 'neutral' : 'warning'}>{row.statusLabel}</Badge>
                </div>
                <span className="text-xs text-muted">{row.citizenEmail} · requested {row.requestedAt?.slice(0, 10)}</span>
                {row.reason ? <span className="text-xs text-muted">Reason: {row.reason}</span> : null}
                {row.reviewNote ? <span className="text-xs text-muted">Review: {row.reviewNote}</span> : null}
                {!['completed', 'rejected', 'withdrawn'].includes(row.status) ? (
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <Button size="sm" variant="ghost" onClick={() => decide(row, 'request_info')}>Request information</Button>
                    <Button size="sm" variant="outline" onClick={() => decide(row, 'schedule')}>Schedule</Button>
                    <Button size="sm" variant="ghost" onClick={() => decide(row, 'reject')}>Reject</Button>
                    <Button size="sm" variant="outline" onClick={() => decide(row, 'complete_partial')}>Mark partially completed</Button>
                    <Button size="sm" onClick={() => decide(row, 'complete')}>Complete and anonymise</Button>
                  </div>
                ) : null}
                {row.events.map((event, index) => (
                  <span key={index} className="text-xs text-muted">{event.created_at?.slice(0, 16)} · {event.action} · {event.detail}</span>
                ))}
              </div>
            )) : <p className="text-sm text-muted">No deletion requests in your scope.</p>}
          </div>

          <div className="card">
            <h2 className="side-label">Retention rules</h2>
            <Field label="Category">
              <Select
                value={rule.category}
                onChange={(e) => {
                  const next = data.retention.find((row) => row.category === e.target.value)
                  if (next) setRule({ ...next, category: next.category })
                }}
              >
                {data.retention.map((row) => <option key={row.category} value={row.category}>{row.categoryLabel}</option>)}
              </Select>
            </Field>
            <Field label="Retention rule"><Textarea rows={2} value={rule.retentionRule || ''} onChange={(e) => setRule({ ...rule, retentionRule: e.target.value })} /></Field>
            <Field label="Retention trigger"><Input value={rule.retentionTrigger || ''} onChange={(e) => setRule({ ...rule, retentionTrigger: e.target.value })} /></Field>
            <Field label="Deletion or anonymisation method"><Input value={rule.deletionMethod || ''} onChange={(e) => setRule({ ...rule, deletionMethod: e.target.value })} /></Field>
            <Field label="Exceptions"><Textarea rows={2} value={rule.exceptions || ''} onChange={(e) => setRule({ ...rule, exceptions: e.target.value })} /></Field>
            <Field label="Legal and privacy review">
              <Select value={rule.legalReviewStatus} onChange={(e) => setRule({ ...rule, legalReviewStatus: e.target.value })}>
                {Object.entries(data.retentionReview).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <Button
              disabled={!rule.category || (rule.retentionRule || '').trim().length < 5}
              onClick={async () => {
                try {
                  const result = await api.put(`/admin/account-deletion/retention/${rule.category}`, {
                    retentionRule: rule.retentionRule,
                    retentionTrigger: rule.retentionTrigger,
                    deletionMethod: rule.deletionMethod,
                    legalReviewStatus: rule.legalReviewStatus,
                    exceptions: rule.exceptions || undefined,
                  })
                  toast.push(result.message)
                  await load()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Save retention rule
            </Button>
          </div>

          <div className="card">
            <h2 className="side-label">Deactivations</h2>
            {data.deactivations.length ? data.deactivations.map((row) => (
              <div key={row.id} className="row-between text-sm">
                <span>{row.reference} · {row.citizenName}</span>
                <Badge tone={row.status === 'active' ? 'warning' : 'neutral'}>{row.statusLabel}</Badge>
              </div>
            )) : <p className="text-sm text-muted">No deactivations in your scope.</p>}
          </div>
        </>
      )}
    </div>
  )
}
