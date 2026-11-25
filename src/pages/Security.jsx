import { useEffect, useState } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, Field, Select, SkeletonList, Textarea, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

export default function SecurityPage() {
  useDocumentTitle('Account security')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [form, setForm] = useState({ category: 'unknown_login', description: '', evidenceNote: '' })

  const load = async () => {
    try {
      setData(await api.get('/account/security'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (url, message) => {
    try {
      const result = await api.post(url, {})
      toast.push(result.message || message)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  if (!data) return <div className="section-tight"><SkeletonList count={4} height={70} /></div>

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Account security"
        description="Review sessions, recent security events and report anything unfamiliar."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Account security' }]}
      />
      <Alert tone="info" title="Indicators, not accusations">{data.indicators.note}</Alert>

      <div className="grid grid-3">
        <div className="card"><div className="side-label">Email</div><strong>{data.account.emailVerified ? 'Verified' : 'Not verified'}</strong></div>
        <div className="card"><div className="side-label">Multi-factor</div><strong>{data.mfa.enabled ? 'Enabled' : 'Not enabled'}</strong></div>
        <div className="card"><div className="side-label">Active sessions</div><strong>{data.sessions.length}</strong></div>
      </div>

      {data.recommendations.length ? (
        <div className="card">
          <h2 className="side-label">Protection recommendations</h2>
          {data.recommendations.map((item) => <p key={item.key} className="text-sm">• {item.label}</p>)}
          <p className="text-xs text-muted">{data.protection.note}</p>
        </div>
      ) : null}

      <div className="card">
        <div className="row-between">
          <h2 className="side-label">Active sessions</h2>
          {data.sessions.length > 1 ? <Button size="sm" variant="outline" onClick={() => act('/account/security/sessions/revoke-others', 'Other sessions ended.')}>Sign out all other sessions</Button> : null}
        </div>
        {data.sessions.map((session) => (
          <div key={session.id} className="stack-tight">
            <div className="row-between">
              <strong>{session.agent}</strong>
              <Badge tone={session.current ? 'success' : 'neutral'}>{session.current ? 'This device' : 'Active'}</Badge>
            </div>
            <span className="text-xs text-muted">Started {session.createdAt?.slice(0, 16)} · last seen {session.lastSeenAt?.slice(0, 16) || 'unknown'} · address {session.ip || 'hidden'}</span>
            <Button size="sm" variant="ghost" onClick={() => act(`/account/security/sessions/${session.sessionId}/revoke`, 'Session ended.')}>End session</Button>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="side-label">Recent security events</h2>
        {data.recentEvents.length ? data.recentEvents.map((event, index) => (
          <div key={index} className="row-between text-sm">
            <span>{event.event_type.replaceAll('.', ' ')}</span>
            <span className="text-muted">{event.created_at?.slice(0, 16)}</span>
          </div>
        )) : <p className="text-sm text-muted">No security events recorded.</p>}
      </div>

      <div className="card">
        <h2 className="side-label">Report suspicious activity</h2>
        <p className="text-xs text-muted">{data.note}</p>
        <Field label="What happened?">
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(data.reportCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What did you notice, and when?" />
        </Field>
        <Field label="Supporting detail (optional)">
          <Textarea rows={2} value={form.evidenceNote} onChange={(e) => setForm({ ...form, evidenceNote: e.target.value })} placeholder="Do not paste passwords or one-time codes." />
        </Field>
        <Button
          icon={AlertTriangle}
          disabled={form.description.trim().length < 10}
          onClick={async () => {
            try {
              const result = await api.post('/account/security/reports', {
                category: form.category,
                description: form.description,
                evidenceNote: form.evidenceNote || undefined,
              })
              toast.push(result.message)
              setForm({ category: form.category, description: '', evidenceNote: '' })
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Submit security report
        </Button>

        {data.reports.length ? data.reports.map((report) => (
          <div key={report.id} className="stack-tight">
            <div className="row-between">
              <strong>{report.reference} · {report.categoryLabel}</strong>
              <Badge tone={report.status === 'resolved' ? 'success' : report.status === 'dismissed' ? 'neutral' : 'warning'}>{report.statusLabel}</Badge>
            </div>
            <span className="text-xs text-muted">Submitted {report.createdAt?.slice(0, 16)}</span>
            {report.reviewNote ? <span className="text-xs text-muted">Review note: {report.reviewNote}</span> : null}
          </div>
        )) : <p className="text-sm text-muted">You have not submitted a security report.</p>}
      </div>

      <div className="card">
        <h2 className="side-label"><ShieldCheck size={14} aria-hidden="true" /> Avoiding scams</h2>
        <ul className="text-sm">
          {data.phishingTips.map((tip) => <li key={tip}>{tip}</li>)}
        </ul>
      </div>
    </div>
  )
}
