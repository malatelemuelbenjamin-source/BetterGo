import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Receipt, Wallet } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Field, Input, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

const STATUS_TONES = { paid: 'success', pending_payment: 'warning', under_reconciliation: 'warning', failed: 'danger', cancelled: 'neutral', refunded: 'neutral' }

function TransactionCard({ transaction }) {
  return (
    <div className="card">
      <div className="row-between">
        <Link to={`/dashboard/payments/${transaction.id}`}><strong>{transaction.reference}</strong></Link>
        <Badge tone={STATUS_TONES[transaction.status] || 'neutral'}>{transaction.status.replaceAll('_', ' ')}</Badge>
      </div>
      <div className="card-meta">
        <span>{transaction.serviceTitle}</span>
        <span>{transaction.amountLabel}</span>
        <span>{transaction.provider || 'No online provider'}</span>
      </div>
      {transaction.status === 'paid' ? <p className="text-xs text-muted">Verified by provider {transaction.verifiedAt?.slice(0, 10)}. Not an official government receipt.</p> : null}
    </div>
  )
}

export default function PaymentsPage() {
  useDocumentTitle('Payments')
  const { id } = useParams()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [detail, setDetail] = useState(null)
  const [history, setHistory] = useState(null)
  const [filters, setFilters] = useState({ q: '', status: '' })
  const [form, setForm] = useState({ serviceSlug: '', methodSlug: '', purpose: '' })

  const load = async () => {
    try {
      setData(await api.get('/account/payments'))
      if (id) setDetail(await api.get(`/account/payments/${id}`))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const search = async () => {
    try {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
      setHistory(await api.get(`/account/payments/history?${params.toString()}`))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  if (!data) return <div className="section-tight"><SkeletonList count={4} height={70} /></div>

  if (id) {
    if (!detail) return <div className="section-tight"><SkeletonList count={3} height={70} /></div>
    const transaction = detail.transaction
    return (
      <div className="section-tight">
        <PageHeader
          eyebrow="Payment record"
          title={transaction.serviceTitle}
          description={`Reference ${transaction.reference}`}
          breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Payments', to: '/dashboard/payments' }, { label: transaction.reference }]}
        />
        <Alert tone="warning" title="Platform record">{detail.label}</Alert>
        <div className="card">
          <div className="row-between"><span>Amount</span><strong>{transaction.amountLabel}</strong></div>
          <div className="row-between"><span>Payee</span><span>{transaction.payee}</span></div>
          <div className="row-between"><span>Status</span><Badge tone={STATUS_TONES[transaction.status] || 'neutral'}>{transaction.status.replaceAll('_', ' ')}</Badge></div>
          <div className="row-between"><span>Provider</span><span>{transaction.provider || 'No online provider'}</span></div>
          {transaction.providerReference ? <div className="row-between"><span>Provider reference</span><span>{transaction.providerReference}</span></div> : null}
          {transaction.verifiedAt ? <p className="text-xs text-muted">Verified by the provider at {transaction.verifiedAt}.</p> : <p className="text-xs text-muted">This payment has not been verified by a provider.</p>}
          <a className="btn btn-ghost btn-sm" href={`/api/account/payments/${transaction.id}/summary`} target="_blank" rel="noreferrer">Download transaction summary</a>
        </div>
        <div className="card">
          <h2 className="side-label">Status history</h2>
          {transaction.events.map((entry, index) => (
            <div key={index} className="text-sm">{entry.created_at?.slice(0, 16)} · {entry.action.replaceAll('_', ' ')}{entry.note ? ` — ${entry.note}` : ''}</div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Payments"
        description="Review verified fee information, create payment references and keep your transaction records in one place."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Payments' }]}
      />
      <Alert tone="info" title="No live payment integration is assumed">{data.notices.payments}</Alert>

      <div className="grid grid-2">
        <div className="card">
          <h2 className="side-label">Service fees</h2>
          <p className="text-xs text-muted">{data.notices.fees}</p>
          {data.fees.length ? data.fees.map((fee) => (
            <div key={fee.id} className="stack-tight">
              <div className="row-between"><Link to={`/dashboard/assistance/${fee.serviceSlug}`}>{fee.serviceTitle}</Link><strong>{fee.amountLabel}</strong></div>
              <span className="text-xs text-muted">{fee.feeLabel}{fee.description ? ` · ${fee.description}` : ''}</span>
              {fee.verifiedAt ? <span className="text-xs text-muted">Reviewed {fee.verifiedAt.slice(0, 10)}</span> : null}
            </div>
          )) : <p className="text-sm text-muted">No approved fee information is available. Confirm fees with the responsible office.</p>}
        </div>

        <div className="card">
          <h2 className="side-label">Payment methods</h2>
          {data.methods.map((method) => (
            <div key={method.slug} className="row-between text-sm">
              <span>{method.name} <span className="text-muted">({method.typeLabel})</span></span>
              <Badge tone={method.operational ? 'success' : 'neutral'}>{method.operational ? 'Available' : 'Unavailable'}</Badge>
            </div>
          ))}
          <p className="text-xs text-muted">A method is available only when an authorized configuration exists. No credentials are shown.</p>
        </div>
      </div>

      <div className="card">
        <h2 className="side-label">Create a payment reference</h2>
        <p className="text-xs text-muted">This never charges you. BetterGo only records the transaction and instructions; a provider verifies any actual payment.</p>
        <div className="grid grid-3">
          <Field label="Service with a verified fee">
            <Select value={form.serviceSlug} onChange={(e) => setForm({ ...form, serviceSlug: e.target.value })}>
              <option value="">Choose a service</option>
              {data.fees.filter((fee) => fee.feeType === 'fixed').map((fee) => <option key={fee.id} value={fee.serviceSlug}>{fee.serviceTitle}</option>)}
            </Select>
          </Field>
          <Field label="Payment method">
            <Select value={form.methodSlug} onChange={(e) => setForm({ ...form, methodSlug: e.target.value })}>
              <option value="">Choose a method</option>
              {data.methods.filter((method) => method.operational).map((method) => <option key={method.slug} value={method.slug}>{method.name}</option>)}
            </Select>
          </Field>
          <Field label="Purpose (optional)"><Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></Field>
        </div>
        <Button
          icon={Wallet}
          onClick={async () => {
            try {
              const result = await api.post('/account/payments/requests', form)
              toast.push(result.message)
              if (result.redirectUrl) window.open(result.redirectUrl, '_blank', 'noopener')
              setForm({ serviceSlug: '', methodSlug: '', purpose: '' })
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Create payment reference
        </Button>
      </div>

      <div className="card">
        <h2 className="side-label">Search transaction history</h2>
        <div className="row">
          <Input placeholder="Reference" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} aria-label="Transaction reference" />
          <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {['pending_payment', 'paid', 'failed', 'cancelled', 'refund_requested', 'refunded', 'under_reconciliation'].map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
          </Select>
          <Button variant="outline" onClick={search}>Search</Button>
        </div>
        {(history?.results || data.transactions).map((transaction) => <TransactionCard key={transaction.id} transaction={transaction} />)}
        {!(history?.results || data.transactions).length ? <EmptyState icon={Receipt} title="No transactions yet" description="Payment references you create will appear here." /> : null}
      </div>

      <p className="text-xs text-muted">{data.notices.receipts} For payment problems, use the support centre and reference your transaction.</p>
      <Link className="btn btn-ghost" to="/dashboard/support">Get payment support</Link>
    </div>
  )
}
