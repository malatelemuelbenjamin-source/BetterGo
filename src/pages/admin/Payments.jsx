import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

export function AdminPayments() {
  useDocumentTitle('Payments administration')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [status, setStatus] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [fees, setFees] = useState(null)
  const [feeForm, setFeeForm] = useState({ feeType: 'fixed', amount: '', feeDescription: '', sourceTitle: '', sourceUrl: '' })

  const load = async () => {
    try {
      setData(await api.get(`/admin/payments?${status ? `status=${status}` : ''}`))
      setAnalytics(await api.get('/admin/payments/analytics').catch(() => null))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const loadFees = async () => {
    try {
      setFees(await api.get(`/admin/service-fees?serviceId=${serviceId}`))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const feeAction = async (fee, action) => {
    try {
      await api.post(`/admin/service-fees/${fee.id}/${action}`)
      toast.push('Fee record updated.')
      await loadFees()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Payments and fees"
        description="Approve verified fee information and monitor transactions. Administrators can never mark a payment as paid."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Payments' }]}
      />

      <Alert tone="info" title="No secrets, no revenue claims">{data?.note || 'Loading payment records.'}</Alert>

      <div className="card">
        <div className="row">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
            <option value="">All statuses</option>
            {['pending_payment', 'paid', 'failed', 'under_reconciliation', 'refunded'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
          </Select>
          <Input value={serviceId} onChange={(e) => setServiceId(e.target.value)} placeholder="Service ID for fees" inputMode="numeric" aria-label="Service ID" />
          <Button variant="outline" onClick={loadFees} disabled={!serviceId}>Load fee records</Button>
        </div>
        {data ? (
          <div className="grid grid-4">
            <div className="stat-card"><span className="stat-label">Pending</span><div className="stat-value">{data.totals.pending}</div></div>
            <div className="stat-card"><span className="stat-label">Provider-confirmed</span><div className="stat-value">{data.totals.paid}</div></div>
            <div className="stat-card"><span className="stat-label">Failed</span><div className="stat-value">{data.totals.failed}</div></div>
            <div className="stat-card"><span className="stat-label">Reconciliation</span><div className="stat-value">{data.totals.reconciliation}</div></div>
          </div>
        ) : null}
      </div>

      {!data ? <SkeletonList count={3} height={70} /> : data.results.map((transaction) => (
        <div className="card" key={transaction.id}>
          <div className="row-between">
            <strong>{transaction.reference} · {transaction.serviceTitle}</strong>
            <Badge tone={transaction.status === 'paid' ? 'success' : 'neutral'}>{transaction.status.replaceAll('_', ' ')}</Badge>
          </div>
          <div className="card-meta">
            <span>{transaction.amountLabel}</span>
            <span>{transaction.provider || 'No provider'}</span>
            {transaction.providerReference ? <span>Provider ref {transaction.providerReference}</span> : null}
          </div>
          {['pending_payment', 'processing', 'failed'].includes(transaction.status) ? (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await api.post(`/admin/payments/${transaction.id}/reconcile`, { note: 'Review requested' })
                  toast.push('Flagged for reconciliation.')
                  await load()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Flag for reconciliation
            </Button>
          ) : null}
        </div>
      ))}

      {data ? (
        <div className="card">
          <h2 className="side-label">Payment method configuration</h2>
          {data.providerStatus.map((method) => (
            <div className="row-between text-sm" key={method.slug}>
              <span>{method.name} <span className="text-muted">({method.provider || method.method_type})</span></span>
              <Badge tone={method.configured ? 'success' : 'warning'}>{method.configured ? 'Configured' : 'Not configured'}</Badge>
            </div>
          ))}
          <p className="text-xs text-muted">Provider credentials live only in environment secrets and are never displayed here.</p>
        </div>
      ) : null}

      {fees ? (
        <div className="stack">
          <h2 className="side-label">Fees for {fees.service.title}</h2>
          {fees.results.map((fee) => (
            <div className="card" key={fee.id}>
              <div className="row-between">
                <strong>{fee.fee_type === 'free' ? 'Free' : fee.amount_cents === null ? 'No confirmed amount' : `PHP ${(fee.amount_cents / 100).toFixed(2)}`}</strong>
                <Badge tone={fee.review_status === 'approved' ? 'success' : 'warning'}>{fee.review_status.replaceAll('_', ' ')}</Badge>
              </div>
              <p className="text-sm text-muted">{fee.fee_description || 'No description'}{fee.source_title ? ` · Source: ${fee.source_title}` : ''}</p>
              <div className="row">
                {['draft'].includes(fee.review_status) ? <Button size="sm" variant="outline" onClick={() => feeAction(fee, 'submit-review')}>Submit for review</Button> : null}
                {fee.review_status === 'pending_review' ? <Button size="sm" onClick={() => feeAction(fee, 'approve')}>Approve with source</Button> : null}
                {fee.review_status !== 'archived' ? <Button size="sm" variant="ghost" onClick={() => feeAction(fee, 'archive')}>Archive</Button> : null}
              </div>
            </div>
          ))}

          <form
            className="card"
            onSubmit={async (event) => {
              event.preventDefault()
              try {
                await api.post('/admin/service-fees', { ...feeForm, serviceId: Number(serviceId), amount: feeForm.amount === '' ? undefined : Number(feeForm.amount) })
                toast.push('Fee draft saved.')
                await loadFees()
              } catch (err) {
                toast.push(err.message, 'error')
              }
            }}
          >
            <h3 className="side-label">Add a fee draft</h3>
            <Field label="Fee type">
              <Select value={feeForm.feeType} onChange={(e) => setFeeForm({ ...feeForm, feeType: e.target.value })}>
                {Object.entries(fees.feeTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            {feeForm.feeType === 'fixed' ? <Field label="Amount (PHP)"><Input type="number" min="0" step="0.01" value={feeForm.amount} onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })} required /></Field> : null}
            <Field label="Description"><Input value={feeForm.feeDescription} onChange={(e) => setFeeForm({ ...feeForm, feeDescription: e.target.value })} /></Field>
            <Field label="Official source title"><Input value={feeForm.sourceTitle} onChange={(e) => setFeeForm({ ...feeForm, sourceTitle: e.target.value })} /></Field>
            <Field label="Official source URL (optional)"><Input type="url" value={feeForm.sourceUrl} onChange={(e) => setFeeForm({ ...feeForm, sourceUrl: e.target.value })} /></Field>
            <Button type="submit">Save fee draft</Button>
          </form>
        </div>
      ) : null}

      {analytics ? (
        <div className="card">
          <h2 className="side-label">Verified platform records</h2>
          <div className="grid grid-3">
            <div className="stat-card"><span className="stat-label">Transactions</span><div className="stat-value">{analytics.totals.transactions}</div></div>
            <div className="stat-card"><span className="stat-label">Provider-confirmed amount</span><div className="stat-value">PHP {analytics.totals.providerConfirmedAmount.toFixed(2)}</div></div>
            <div className="stat-card"><span className="stat-label">Refund statuses</span><div className="stat-value">{analytics.totals.refunded}</div></div>
          </div>
          <p className="text-sm text-muted">{analytics.note}</p>
        </div>
      ) : null}
    </div>
  )
}
