import { useEffect, useState } from 'react'
import { LifeBuoy, Send, UserCheck } from 'lucide-react'
import { api, fmtDateTime } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, EmptyState, Field, Input, Modal, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

const STATUS_TONE = { new: 'info', open: 'info', assigned: 'neutral', in_progress: 'info', waiting_citizen: 'warning', resolved: 'success', closed: 'neutral', reopened: 'warning' }

/** Administrative support desk (Prompt 69 §10). */
export function AdminSupport() {
  useDocumentTitle('Support desk')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [filters, setFilters] = useState({ status: '', q: '', unassigned: false })
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [update, setUpdate] = useState({ status: '', priority: '', assignedTo: '' })

  const load = async () => {
    try {
      const params = new URLSearchParams()
      if (filters.status) params.set('status', filters.status)
      if (filters.q) params.set('q', filters.q)
      if (filters.unassigned) params.set('unassigned', '1')
      const [list, stats] = await Promise.all([api.get(`/admin/support/tickets?${params.toString()}`), api.get('/admin/support/metrics')])
      setData(list)
      setMetrics(stats)
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.unassigned])

  const open = async (row) => {
    setSelected(row)
    setDetail(null)
    setUpdate({ status: row.status, priority: row.priority, assignedTo: row.assigned_to || '' })
    try {
      setDetail(await api.get(`/admin/support/tickets/${row.reference}`))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const refreshDetail = async () => {
    if (!selected) return
    setDetail(await api.get(`/admin/support/tickets/${selected.reference}`))
    await load()
  }

  const saveTicket = async () => {
    try {
      await api.patch(`/admin/support/tickets/${selected.reference}`, {
        status: update.status || undefined,
        priority: update.priority || undefined,
        assignedTo: update.assignedTo === '' ? null : Number(update.assignedTo),
      })
      toast.push('Ticket updated.')
      await refreshDetail()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const sendReply = async () => {
    try {
      await api.post(`/admin/support/tickets/${selected.reference}/messages`, { body: reply, internal })
      toast.push(internal ? 'Internal note added.' : 'Reply sent.')
      setReply('')
      setInternal(false)
      await refreshDetail()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Support desk"
        description="BetterGo platform support tickets within your municipality scope. These are not LGU complaints."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Support' }]}
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />

      {metrics ? (
        <div className="grid grid-4">
          <div className="card stat-card"><span className="stat-label">Total</span><div className="stat-value">{metrics.totals.total}</div></div>
          <div className="card stat-card"><span className="stat-label">Open</span><div className="stat-value">{metrics.totals.open}</div></div>
          <div className="card stat-card"><span className="stat-label">Unassigned</span><div className="stat-value">{metrics.totals.unassigned}</div></div>
          <div className="card stat-card"><span className="stat-label">Average rating</span><div className="stat-value">{metrics.totals.averageRating ?? '—'}</div></div>
        </div>
      ) : null}

      <div className="card mt-4">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Reference or subject" aria-label="Search tickets" />
          <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Status filter">
            <option value="">All statuses</option>
            {Object.entries(data?.statuses || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
          <label className="row" style={{ gap: '0.35rem' }}>
            <input type="checkbox" checked={filters.unassigned} onChange={(e) => setFilters({ ...filters, unassigned: e.target.checked })} /> Unassigned only
          </label>
          <Button variant="outline" onClick={load}>Apply</Button>
        </div>
      </div>

      {!data ? <SkeletonList count={4} height={60} /> : data.results.length ? (
        <div className="stack mt-3">
          {data.results.map((row) => (
            <button key={row.reference} type="button" className="card" style={{ textAlign: 'left' }} onClick={() => open(row)}>
              <div className="row-between">
                <strong>{row.subject}</strong>
                <div className="row">
                  <Badge tone={row.priority === 'urgent' ? 'warning' : 'neutral'}>{row.priority}</Badge>
                  <Badge tone={STATUS_TONE[row.status] || 'neutral'}>{row.status}</Badge>
                </div>
              </div>
              <div className="card-meta">
                <span>{row.reference}</span>
                <span>{row.category_name}</span>
                <span>{row.municipality_name || 'No municipality'}</span>
                <span>{row.assigned_name || 'Unassigned'}</span>
                <span>{fmtDateTime(row.created_at)}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState icon={LifeBuoy} title="No tickets in this view" description="Tickets appear here when citizens ask the BetterGo platform team for help within your scope." />
      )}

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? `${selected.reference} · ${selected.subject}` : 'Ticket'}>
        {!detail ? <SkeletonList count={3} height={50} /> : (
          <div className="stack">
            <p className="text-sm text-muted">{detail.citizenEmail} · {detail.ticket.category} · {fmtDateTime(detail.ticket.created_at)}</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{detail.description}</p>

            <div className="grid grid-3">
              <Field label="Status">
                <Select value={update.status} onChange={(e) => setUpdate({ ...update, status: e.target.value })}>
                  {Object.entries(data.statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
              </Field>
              <Field label="Priority">
                <Select value={update.priority} onChange={(e) => setUpdate({ ...update, priority: e.target.value })}>
                  {Object.entries(data.priorities).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
              </Field>
              <Field label="Assign to staff user ID" hint="Leave blank to unassign.">
                <Input value={update.assignedTo} onChange={(e) => setUpdate({ ...update, assignedTo: e.target.value })} placeholder="User ID" />
              </Field>
            </div>
            <Button icon={UserCheck} onClick={saveTicket}>Save ticket changes</Button>

            <div>
              <h3 className="side-label">Conversation</h3>
              {detail.messages.map((message) => (
                <div key={message.id} className="card" style={{ marginBottom: '0.5rem', opacity: message.internal ? 0.8 : 1 }}>
                  <div className="row-between">
                    <strong className="text-sm">{message.author_role === 'support' ? 'Support' : 'Citizen'}{message.internal ? ' · internal note' : ''}</strong>
                    <span className="text-xs text-muted">{fmtDateTime(message.created_at)}</span>
                  </div>
                  <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{message.body}</p>
                </div>
              ))}
            </div>

            <Field label={internal ? 'Internal note (citizens never see this)' : 'Reply to citizen'}>
              <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
            </Field>
            <label className="row" style={{ gap: '0.35rem' }}>
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note
            </label>
            <Button icon={Send} onClick={sendReply} disabled={reply.trim().length < 2}>{internal ? 'Add note' : 'Send reply'}</Button>

            {detail.attachments.length ? (
              <div>
                <h3 className="side-label">Attachments</h3>
                {detail.attachments.map((file) => (
                  <a key={file.id} className="text-sm" href={`/api/admin/support/attachments/${file.id}`}>{file.original_filename}</a>
                ))}
              </div>
            ) : null}

            <div>
              <h3 className="side-label">History</h3>
              {detail.history.map((event, index) => (
                <div className="text-sm text-muted" key={index}>{fmtDateTime(event.created_at)} · {event.from_status || '—'} → {event.to_status}{event.note ? ` · ${event.note}` : ''}</div>
              ))}
            </div>

            {detail.feedback ? <Alert tone="info" title="Citizen feedback">{detail.feedback.rating} / 5 · {detail.feedback.comment || 'No comment'}</Alert> : null}
          </div>
        )}
      </Modal>

      <Alert tone="warning" title="Government-related inquiries">
        BetterGo support is not the relevant LGU office. Do not claim an inquiry was filed with a government office, and do not forward personal information without the citizen's consent.
      </Alert>
    </div>
  )
}
