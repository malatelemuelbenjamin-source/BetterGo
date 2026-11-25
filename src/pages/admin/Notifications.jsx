import { useEffect, useState } from 'react'
import { Bell, Mail, Send, ShieldAlert } from 'lucide-react'
import { api, fmtDateTime } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

const TABS = [
  ['templates', 'Templates'],
  ['deliveries', 'Delivery log'],
  ['analytics', 'Analytics'],
  ['campaigns', 'Campaigns'],
]

export function AdminNotifications() {
  useDocumentTitle('Notifications administration')
  const toast = useToast()
  const [tab, setTab] = useState('templates')
  const [templates, setTemplates] = useState(null)
  const [deliveries, setDeliveries] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [campaigns, setCampaigns] = useState(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({ name: '', category: 'application', title: '', body: '', channel: 'in_app', language: 'en' })

  const load = async () => {
    setLoading(true)
    try {
      if (tab === 'templates') setTemplates(await api.get('/admin/notification-templates'))
      if (tab === 'deliveries') setDeliveries(await api.get('/admin/notification-deliveries'))
      if (tab === 'analytics') setAnalytics(await api.get('/admin/notification-analytics'))
      if (tab === 'campaigns') setCampaigns(await api.get('/admin/notification-campaigns'))
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const createTemplate = async (event) => {
    event.preventDefault()
    try {
      await api.post('/admin/notification-templates', draft)
      toast.push('Template created.')
      setDraft({ ...draft, name: '', title: '', body: '' })
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Notifications"
        description="Templates, delivery records, analytics and approved campaigns. In-app is the only active channel on this deployment."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Notifications' }]}
      />

      <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
        {TABS.map(([key, label]) => (
          <button key={key} type="button" className={`pill ${tab === key ? 'is-active' : ''}`} onClick={() => setTab(key)} aria-pressed={tab === key}>{label}</button>
        ))}
      </div>

      {tab === 'templates' ? (
        <div className="stack mt-4">
          <Alert tone="info" title="Template safety">
            Plain text only. Supported variables: {templates?.variables?.map((entry) => `{{${entry}}}`).join(', ') || '—'}. Templates never invent service details or government announcements.
          </Alert>
          <form className="card" onSubmit={createTemplate}>
            <div className="grid grid-2">
              <Field label="Template name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></Field>
              <Field label="Category">
                <Select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                  {(templates?.categories || []).map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Title"><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required /></Field>
            <Field label="Message body"><Textarea rows={3} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} required /></Field>
            <div className="grid grid-2">
              <Field label="Channel">
                <Select value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value })}>
                  <option value="in_app">In-app (available)</option>
                  <option value="email" disabled={!templates?.channels?.email?.available}>Email (provider not configured)</option>
                  <option value="sms" disabled>SMS (unavailable)</option>
                </Select>
              </Field>
              <Field label="Language">
                <Select value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })}>
                  <option value="en">English</option>
                  <option value="fil">Filipino</option>
                </Select>
              </Field>
            </div>
            <Button type="submit" icon={Bell}>Create template</Button>
          </form>
          {loading ? <SkeletonList count={3} height={60} /> : (templates?.results || []).map((template) => (
            <div className="card" key={template.id}>
              <div className="row-between"><strong>{template.name}</strong><Badge tone={template.status === 'active' ? 'success' : 'neutral'}>{template.status}</Badge></div>
              <p className="text-sm">{template.title}</p>
              <p className="text-sm text-muted">{template.body}</p>
              <div className="card-meta"><span>{template.category}</span><span>{template.channel}</span><span>{template.language}</span></div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'deliveries' ? (
        <div className="stack mt-4">
          <Alert tone="info" title="Only confirmed delivery counts">{deliveries?.note}</Alert>
          {loading ? <SkeletonList count={3} height={50} /> : (deliveries?.results || []).length ? deliveries.results.map((row) => (
            <div className="card" key={row.id}>
              <div className="row-between"><strong>{row.title || row.notification_type}</strong><Badge tone={row.provider_confirmed ? 'success' : 'neutral'}>{row.channel} · {row.state}</Badge></div>
              <div className="card-meta"><span>{fmtDateTime(row.created_at)}</span><span>{row.provider_confirmed ? 'Provider confirmed' : 'Not provider-confirmed'}</span></div>
            </div>
          )) : <p className="text-sm text-muted">No delivery records exist. In-app notifications do not require a delivery provider.</p>}
        </div>
      ) : null}

      {tab === 'analytics' ? (
        <div className="stack mt-4">
          {loading || !analytics ? <SkeletonList count={3} height={60} /> : (
            <>
              <div className="grid grid-4">
                <div className="card stat-card"><span className="stat-label">Created</span><div className="stat-value">{analytics.totals.created}</div></div>
                <div className="card stat-card"><span className="stat-label">Read (in-app)</span><div className="stat-value">{analytics.totals.read}</div></div>
                <div className="card stat-card"><span className="stat-label">Unread</span><div className="stat-value">{analytics.totals.unread}</div></div>
                <div className="card stat-card"><span className="stat-label">Archived</span><div className="stat-value">{analytics.totals.archived}</div></div>
              </div>
              <div className="card">
                <h2 className="side-label">By category</h2>
                {analytics.byCategory.map((row) => <div className="row-between" key={row.category}><span>{row.label}</span><strong>{row.total}</strong></div>)}
              </div>
              <div className="card">
                <h2 className="side-label">By municipality</h2>
                {analytics.byMunicipality.length ? analytics.byMunicipality.map((row) => <div className="row-between" key={row.municipality_name}><span>{row.municipality_name}</span><strong>{row.total}</strong></div>) : <p className="text-sm text-muted">No municipality-linked notifications yet.</p>}
              </div>
              <p className="text-sm text-muted">{analytics.note}</p>
            </>
          )}
        </div>
      ) : null}

      {tab === 'campaigns' ? (
        <div className="stack mt-4">
          <Alert tone="warning" title="Dispatch is disabled">{campaigns?.note}</Alert>
          {loading ? <SkeletonList count={2} height={50} /> : (campaigns?.results || []).length ? campaigns.results.map((row) => (
            <div className="card" key={row.id}>
              <div className="row-between"><strong>{row.title}</strong><Badge tone="neutral">{row.status}</Badge></div>
              <div className="card-meta"><span>{row.category}</span><span>{row.municipality_name || 'Province-wide'}</span><span>{fmtDateTime(row.created_at)}</span></div>
            </div>
          )) : <p className="text-sm text-muted">No campaigns have been drafted.</p>}
          <div className="card">
            <div className="row"><ShieldAlert size={18} /><strong>Emergency notifications</strong></div>
            <p className="text-sm text-muted">Emergency categories cannot be drafted here. They require a verified official source, approval and the emergency source workflow.</p>
          </div>
          <div className="card">
            <div className="row"><Mail size={18} /><strong>Email and SMS</strong></div>
            <p className="text-sm text-muted">Email requires a configured mail provider. No SMS provider is configured on this deployment, so no SMS may be sent or claimed.</p>
          </div>
          <div className="card">
            <div className="row"><Send size={18} /><strong>Send</strong></div>
            <p className="text-sm text-muted">The dispatch endpoint refuses every request on this deployment, so no bulk notification can be sent accidentally.</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
