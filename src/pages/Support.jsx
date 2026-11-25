import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LifeBuoy, Paperclip, Send } from 'lucide-react'
import { api, fmtDateTime } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Field, Input, Select, SkeletonList, Textarea, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

const STATUS_TONE = { new: 'info', open: 'info', assigned: 'neutral', in_progress: 'info', waiting_citizen: 'warning', resolved: 'success', closed: 'neutral', reopened: 'warning' }

export function SupportPage() {
  useDocumentTitle('Help and support')
  const toast = useToast()
  const [tickets, setTickets] = useState(null)
  const [categories, setCategories] = useState([])
  const [status, setStatus] = useState('')
  const [form, setForm] = useState({ subject: '', category: 'technical', description: '', issueType: 'question', privacyAccepted: false })
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const [list, cats] = await Promise.all([api.get(`/account/support/tickets${status ? `?status=${status}` : ''}`), api.get('/help/categories')])
      setTickets(list)
      setCategories(cats.categories)
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await api.post('/account/support/tickets', form)
      toast.push(`Ticket ${result.reference} submitted.`)
      setForm({ subject: '', category: 'technical', description: '', issueType: 'question', privacyAccepted: false })
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Help and support"
        description="Ask the BetterGo platform team for help. Support tickets are not official LGU complaints or emergency requests."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Help and support' }]}
        actions={<Link className="btn btn-outline" to="/help">Browse help articles</Link>}
      />

      <div className="grid grid-2">
        <form className="card" onSubmit={submit}>
          <h2 className="side-label">Submit a support ticket</h2>
          <Field label="Subject"><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required minLength={5} maxLength={160} /></Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categories.map((entry) => <option key={entry.key} value={entry.key}>{entry.name}</option>)}
            </Select>
          </Field>
          <Field label="Issue type">
            <Select value={form.issueType} onChange={(e) => setForm({ ...form, issueType: e.target.value })}>
              <option value="question">Question</option>
              <option value="technical_problem">Technical problem</option>
              <option value="account_issue">Account issue</option>
              <option value="accessibility">Accessibility</option>
              <option value="suggestion">Suggestion</option>
            </Select>
          </Field>
          <Field label="Description" hint="Do not include passwords, verification codes or unnecessary sensitive information.">
            <Textarea rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required minLength={20} maxLength={5000} />
          </Field>
          <label className="row" style={{ gap: '0.5rem', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={form.privacyAccepted} onChange={(e) => setForm({ ...form, privacyAccepted: e.target.checked })} required />
            <span className="text-sm">I have read the privacy notice. My ticket, messages and attachments are visible to authorised BetterGo support staff only.</span>
          </label>
          <Button type="submit" icon={Send} disabled={busy}>{busy ? 'Submitting…' : 'Submit ticket'}</Button>
        </form>

        <div>
          <div className="row-between">
            <h2 className="side-label">My tickets</h2>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter tickets">
              <option value="">All statuses</option>
              {Object.entries(tickets?.statuses || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
          </div>
          {!tickets ? <SkeletonList count={3} height={60} /> : tickets.results.length ? (
            <div className="stack">
              {tickets.results.map((row) => (
                <Link key={row.reference} to={`/dashboard/support/${row.reference}`} className="card" style={{ display: 'block' }}>
                  <div className="row-between">
                    <strong>{row.subject}</strong>
                    <Badge tone={STATUS_TONE[row.status] || 'neutral'}>{row.statusLabel}</Badge>
                  </div>
                  <div className="card-meta">
                    <span>{row.reference}</span>
                    <span>{row.category}</span>
                    <span>{fmtDateTime(row.created_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={LifeBuoy} title="No support tickets yet" description="Tickets you submit to the BetterGo team appear here with their conversation history." />
          )}
        </div>
      </div>

      <Alert tone="warning" title="Not an emergency channel">
        BetterGo support cannot dispatch emergency services and does not represent a government office. For emergencies, use verified emergency contact channels.
      </Alert>
    </div>
  )
}

export function SupportDetailPage() {
  const { reference } = useParams()
  useDocumentTitle(`Ticket ${reference}`)
  const toast = useToast()
  const [data, setData] = useState(null)
  const [reply, setReply] = useState('')
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')

  const load = async () => {
    try {
      setData(await api.get(`/account/support/tickets/${reference}`))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference])

  const send = async () => {
    try {
      await api.post(`/account/support/tickets/${reference}/messages`, { body: reply })
      setReply('')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const act = async (path, body, message) => {
    try {
      await api.post(`/account/support/tickets/${reference}/${path}`, body)
      toast.push(message)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const attach = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const response = await fetch(`/api/account/support/tickets/${reference}/attachments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': file.type, 'X-Filename': file.name },
        body: await file.arrayBuffer(),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Upload failed.')
      toast.push('Attachment added.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  if (!data) return <div className="section-tight"><SkeletonList count={4} height={70} /></div>

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Support ticket"
        title={data.ticket.subject}
        description={`${data.ticket.reference} · ${data.ticket.category} · ${data.ticket.statusLabel}`}
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Help and support', to: '/dashboard/support' }, { label: data.ticket.reference }]}
      />

      <div className="grid grid-3">
        <div className="card stat-card"><span className="stat-label">Status</span><div className="stat-value" style={{ fontSize: '1rem' }}>{data.ticket.statusLabel}</div></div>
        <div className="card stat-card"><span className="stat-label">Priority</span><div className="stat-value" style={{ fontSize: '1rem' }}>{data.ticket.priorityLabel}</div></div>
        <div className="card stat-card"><span className="stat-label">Submitted</span><div className="stat-value" style={{ fontSize: '1rem' }}>{fmtDateTime(data.ticket.created_at)}</div></div>
      </div>

      <div className="stack mt-4">
        {data.messages.map((message) => (
          <div className="card" key={message.id}>
            <div className="row-between">
              <Badge tone={message.author_role === 'support' ? 'info' : 'neutral'}>{message.author_role === 'support' ? 'BetterGo support' : 'You'}</Badge>
              <span className="text-xs text-muted">{fmtDateTime(message.created_at)}</span>
            </div>
            <p style={{ whiteSpace: 'pre-wrap' }}>{message.body}</p>
          </div>
        ))}
      </div>

      {data.attachments.length ? (
        <div className="card mt-3">
          <h2 className="side-label">Attachments</h2>
          <ul className="text-sm">
            {data.attachments.map((file) => (
              <li key={file.id}>
                <a href={`/api/account/support/attachments/${file.id}`} rel="noreferrer">{file.original_filename}</a> · {Math.max(1, Math.round((file.file_size || 0) / 1024))} KB
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.canReply ? (
        <div className="card mt-3">
          <Field label="Reply"><Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} /></Field>
          <div className="row">
            <Button icon={Send} onClick={send} disabled={reply.trim().length < 2}>Send reply</Button>
            <label className="btn btn-outline btn-sm">
              <Paperclip size={14} /> Attach PDF or image
              <input type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={attach} />
            </label>
            {data.canReopen ? <Button variant="outline" onClick={() => act('reopen', {}, 'Ticket reopened.')}>Reopen</Button> : null}
            <Button variant="ghost" onClick={() => act('close', {}, 'Ticket closed.')}>Close ticket</Button>
          </div>
        </div>
      ) : data.canReopen ? (
        <div className="card mt-3">
          <p className="text-sm text-muted">This ticket is closed. Reopen it if you still need help.</p>
          <Button variant="outline" onClick={() => act('reopen', {}, 'Ticket reopened.')}>Reopen ticket</Button>
        </div>
      ) : null}

      {data.ticket.satisfactionRating ? (
        <Alert tone="info" title="Your feedback">{data.ticket.satisfactionRating} / 5 recorded. Thank you.</Alert>
      ) : ['resolved', 'closed'].includes(data.ticket.status) ? (
        <div className="card mt-3">
          <h2 className="side-label">Rate this support experience</h2>
          <div className="row">
            <Select value={String(rating)} onChange={(e) => setRating(Number(e.target.value))} aria-label="Satisfaction rating">
              <option value="0">Choose a rating</option>
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}
            </Select>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment" aria-label="Optional comment" />
            <Button
              disabled={!rating}
              onClick={async () => {
                try {
                  await api.post(`/account/support/tickets/${reference}/feedback`, { rating, comment })
                  toast.push('Thank you for the feedback.')
                  await load()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Submit feedback
            </Button>
          </div>
        </div>
      ) : null}

      <Alert tone="info" title="Conversation privacy">{data.note}</Alert>
    </div>
  )
}
