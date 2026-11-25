import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useSeo } from '../../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

function AdminHeader({ title, description, current }) {
  useSeo({ title: `${title} administration`, description, noindex: true })
  return (
    <PageHeader
      eyebrow="Administration"
      title={title}
      description={description}
      breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Transparency', to: '/admin/transparency' }, { label: current }]}
    />
  )
}

/* ------------------------------ 110 Monitoring --------------------------- */

export function AdminMonitoring() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState('')

  const load = () => api.get('/admin/transparency/financial-monitoring').then(setData).catch((err) => setError(err.message))
  useEffect(load, [])

  const run = async () => {
    try {
      const body = await api.post('/admin/transparency/financial-monitoring/run', {})
      toast.push(body.message)
      load()
    } catch (err) { toast.push(err.message, 'error') }
  }

  const findingAction = async (finding, action, extra = {}) => {
    const reason = ['approve', 'resolve', 'dismiss'].includes(action) ? window.prompt(`Record the ${action} explanation (required):`, note) : note
    if (['approve', 'resolve', 'dismiss'].includes(action) && reason === null) return
    try {
      const body = await api.patch(`/admin/transparency/financial-monitoring/findings/${finding.id}`, { action, note: reason || '', ...extra })
      toast.push(body.message)
      setNote('')
      load()
    } catch (err) { toast.push(err.message, 'error') }
  }

  const observationAction = async (observation, action) => {
    const reason = window.prompt(`Explain the ${action === 'link' ? 'link to review' : 'dismissal'}:`)
    if (!reason) return
    try {
      const body = await api.patch(`/admin/transparency/financial-monitoring/observations/${observation.id}`, { action, note: reason })
      toast.push(body.message)
      load()
    } catch (err) { toast.push(err.message, 'error') }
  }

  const updateRule = async (rule, patch) => {
    try {
      await api.patch(`/admin/transparency/financial-monitoring/rules/${rule.id}`, patch)
      toast.push('Rule updated.')
      load()
    } catch (err) { toast.push(err.message, 'error') }
  }

  return (
    <div className="section-tight">
      <AdminHeader title="Financial data-quality monitoring" current="Monitoring" description="Review automated data-quality prompts before any becomes a public finding. Severity describes documentation, not wrongdoing." />
      {error ? <Alert tone="error" title="Monitoring administration failed">{error}</Alert> : !data ? <SkeletonList count={3} height={70} /> : (
        <>
          <Alert tone="warning" title="Human review is mandatory">Nothing here is public until it is approved and published. This is not a corruption investigation, fraud determination or COA finding.</Alert>
          <div className="grid grid-4">
            <div className="card"><div className="side-label">Review items</div><strong>{data.summary.total}</strong></div>
            <div className="card"><div className="side-label">New</div><strong>{data.summary.new}</strong></div>
            <div className="card"><div className="side-label">In review</div><strong>{data.summary.review}</strong></div>
            <div className="card"><div className="side-label">Published</div><strong>{data.summary.published}</strong></div>
          </div>
          <div className="card">
            <div className="row-between"><h2 className="side-label">Rule engine</h2><Button size="sm" onClick={run}>Run checks now</Button></div>
            {data.rules.map((rule) => (
              <div key={rule.id} className="row-between text-sm" style={{ borderTop: '1px solid var(--border)', padding: '0.5rem 0' }}>
                <div><strong>{rule.name}</strong><div className="text-xs text-muted">{rule.description}</div></div>
                <div className="row"><Badge tone={rule.active ? 'success' : 'neutral'}>{rule.active ? 'Active' : 'Off'}</Badge><select className="input" aria-label={`Severity for ${rule.name}`} value={rule.severity} onChange={(e) => updateRule(rule, { severity: e.target.value })}>{data.severities.map((value) => <option key={value} value={value}>{value}</option>)}</select><Button variant="ghost" size="sm" onClick={() => updateRule(rule, { active: !rule.active })}>{rule.active ? 'Disable' : 'Enable'}</Button></div>
              </div>
            ))}
          </div>
          <div className="card">
            <h2 className="side-label">Review queue</h2>
            <Field label="Shared reviewer note" help="Used as the required explanation for approval, resolution or dismissal."><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {!data.findings.length ? <p className="text-sm text-muted">No review item has been detected. Empty does not mean the records are correct or complete.</p> : (
              <div className="table-wrap"><table className="data"><thead><tr><th scope="col">Issue</th><th scope="col">Record</th><th scope="col">Severity</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>{data.findings.map((finding) => (
                <tr key={finding.id}>
                  <td><strong>{finding.label}</strong><div className="text-xs text-muted">{finding.description}</div></td>
                  <td>{finding.recordReference || 'Unavailable'}<div className="text-xs text-muted">{finding.entity.name} · {finding.periodLabel}</div></td>
                  <td><Badge tone={finding.severity === 'critical' || finding.severity === 'high' ? 'danger' : 'neutral'}>{finding.severity}</Badge></td>
                  <td>{finding.reviewStatus}{finding.resolutionNotes ? <div className="text-xs text-muted">{finding.resolutionNotes}</div> : null}</td>
                  <td>
                    <div className="pill-group">
                      {['new', 'assigned'].includes(finding.reviewStatus) ? <Button variant="ghost" size="sm" onClick={() => findingAction(finding, 'review')}>Start review</Button> : null}
                      {['under_review', 'assigned', 'new'].includes(finding.reviewStatus) ? <Button variant="ghost" size="sm" onClick={() => findingAction(finding, 'approve')}>Approve</Button> : null}
                      {finding.reviewStatus === 'approved' ? <Button variant="ghost" size="sm" onClick={() => findingAction(finding, 'publish')}>Publish</Button> : null}
                      {!['resolved', 'dismissed'].includes(finding.reviewStatus) ? <Button variant="ghost" size="sm" onClick={() => findingAction(finding, 'dismiss')}>Dismiss</Button> : null}
                      {['published', 'approved'].includes(finding.reviewStatus) ? <Button variant="ghost" size="sm" onClick={() => findingAction(finding, 'resolve')}>Resolve</Button> : null}
                      {['resolved', 'dismissed'].includes(finding.reviewStatus) ? <Button variant="ghost" size="sm" onClick={() => findingAction(finding, 'reopen')}>Reopen</Button> : null}
                    </div>
                  </td>
                </tr>
              ))}</tbody></table></div>
            )}
          </div>
          <div className="card">
            <h2 className="side-label">Citizen observations</h2>
            <p className="text-xs text-muted">Submitter identity is restricted and never shown publicly. An observation is not evidence of wrongdoing.</p>
            {!data.observations.length ? <p className="text-sm text-muted">No observation is awaiting review.</p> : data.observations.map((observation) => (
              <div key={observation.id} className="stack-tight" style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
                <div className="row-between"><strong>{observation.reference} · {observation.recordReference || 'record unavailable'}</strong><Badge tone="neutral">{observation.status}</Badge></div>
                <p className="text-sm">{observation.description}</p>
                <div className="text-xs text-muted">{observation.submitter} · {String(observation.submitted).slice(0, 10)}{observation.sourceUrl ? <> · <a href={observation.sourceUrl} target="_blank" rel="noreferrer noopener">public link</a></> : null}</div>
                {observation.status === 'pending' ? <div className="pill-group"><Button size="sm" onClick={() => observationAction(observation, 'link')}>Create review item</Button><Button variant="ghost" size="sm" onClick={() => observationAction(observation, 'dismiss')}>Dismiss</Button></div> : null}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* -------------------------------- 111 Reports ---------------------------- */

export function AdminReports() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = () => api.get('/admin/transparency/reports').then(setData).catch((err) => setError(err.message))
  useEffect(load, [])
  const toggleTemplate = async (template) => {
    try { await api.patch(`/admin/transparency/reports/templates/${template.slug}`, { active: !template.active }); toast.push('Template updated.'); load() } catch (err) { toast.push(err.message, 'error') }
  }
  const toggleSharing = async (config) => {
    try { const body = await api.patch(`/admin/transparency/reports/configs/${config.publicId}`, { shared: !config.shared }); toast.push(body.message); load() } catch (err) { toast.push(err.message, 'error') }
  }
  return (
    <div className="section-tight">
      <AdminHeader title="Transparency reports" current="Reports" description="Review templates, shared configurations and export activity. Reports are not official government publications." />
      {error ? <Alert tone="error" title="Report administration failed">{error}</Alert> : !data ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="card"><h2 className="side-label">Templates</h2>{data.templates.map((template) => <div key={template.slug} className="row-between text-sm" style={{ padding: '0.4rem 0', borderTop: '1px solid var(--border)' }}><div><strong>{template.title}</strong><div className="text-xs text-muted">{template.description}</div></div><Button variant="ghost" size="sm" onClick={() => toggleTemplate(template)}>{template.active ? 'Disable' : 'Enable'}</Button></div>)}</div>
          <div className="card"><h2 className="side-label">Saved configurations</h2>{!data.configs.length ? <p className="text-sm text-muted">No saved report configuration yet.</p> : <div className="table-wrap"><table className="data"><thead><tr><th scope="col">Report</th><th scope="col">Owner</th><th scope="col">Version</th><th scope="col">Sharing</th><th scope="col">Action</th></tr></thead><tbody>{data.configs.map((config) => <tr key={config.publicId}><td>{config.title}<div className="text-xs text-muted">{config.publicId}</div></td><td>{config.owner || 'Account removed'}</td><td>{config.version}</td><td><Badge tone={config.shared ? 'success' : 'neutral'}>{config.shared ? 'Shared' : 'Private'}</Badge></td><td><Button variant="ghost" size="sm" onClick={() => toggleSharing(config)}>{config.shared ? 'Disable sharing' : 'Allow sharing'}</Button></td></tr>)}</tbody></table></div>}</div>
          <div className="grid grid-2">
            <div className="card"><h2 className="side-label">Recent exports</h2>{data.exports.length ? <ul className="text-sm">{data.exports.map((row, index) => <li key={`${row.public_id}-${index}`}>{row.public_id} · {row.format} · {row.row_count} row(s) · {String(row.created_at).slice(0, 10)}</li>)}</ul> : <p className="text-sm text-muted">No export has been requested.</p>}</div>
            <div className="card"><h2 className="side-label">Recent generations</h2>{data.generations.length ? <ul className="text-sm">{data.generations.map((row, index) => <li key={`${row.public_id}-${index}`}>{row.public_id} · {row.row_count} row(s) · {String(row.generated_at).slice(0, 10)}</li>)}</ul> : <p className="text-sm text-muted">No report has been generated.</p>}</div>
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------- 112 Open data --------------------------- */

const DEFAULT_DICTIONARY = JSON.stringify([
  { key: 'reference', label: 'Record reference', type: 'text', description: 'BetterGo reference.' },
  { key: 'amountCents', label: 'Amount (centavos)', type: 'currency', description: 'Empty when no amount is stated.' },
], null, 2)

export function AdminOpenData() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ title: '', description: '', category: 'budget', entityLevel: 'provincial', municipalityId: '', periodLabel: '', fiscalYear: '', sourceInstitution: '', sourceReference: '', sourceUrl: '', verificationStatus: 'pending', coverage: '', methodology: '', limitations: '', dataDictionary: DEFAULT_DICTIONARY, recordTypes: ['budget'] })
  const [analytics, setAnalytics] = useState(null)
  const load = () => {
    api.get('/admin/transparency/open-data').then(setData).catch((err) => setError(err.message))
    api.get('/admin/transparency/open-data/downloads/analytics').then(setAnalytics).catch(() => {})
  }
  useEffect(load, [])
  const create = async (event) => {
    event.preventDefault()
    try {
      const dictionary = JSON.parse(form.dataDictionary)
      const body = await api.post('/admin/transparency/open-data', {
        ...form,
        municipalityId: form.municipalityId ? Number(form.municipalityId) : null,
        fiscalYear: form.fiscalYear ? Number(form.fiscalYear) : null,
        dataDictionary: dictionary,
        recordTypes: form.recordTypes,
      })
      toast.push(body.message)
      load()
    } catch (err) { toast.push(err.message, 'error') }
  }
  const generate = async () => {
    try {
      const body = await api.post('/admin/transparency/open-data/generate', { title: form.title || 'Generated transparency dataset', category: form.category, recordTypes: form.recordTypes, periodLabel: form.periodLabel, fiscalYear: form.fiscalYear ? Number(form.fiscalYear) : null, municipalityId: form.municipalityId ? Number(form.municipalityId) : null })
      toast.push(body.message)
      load()
    } catch (err) { toast.push(err.message, 'error') }
  }
  const action = async (dataset, act) => {
    try { const body = await api.post(`/admin/transparency/open-data/${dataset.slug}/${act}`); toast.push(body.message); load() } catch (err) { toast.push(err.message, 'error') }
  }
  return (
    <div className="section-tight">
      <AdminHeader title="Open data repository" current="Open data" description="Register only verified, approved datasets. No licence is invented and no personal data may be published." />
      {error ? <Alert tone="error" title="Open-data administration failed">{error}</Alert> : !data ? <SkeletonList count={3} height={70} /> : (
        <>
          <Alert tone="warning" title="Publication gate">A dataset needs a source institution, source document, verified status and a data dictionary free of personal or sensitive fields before it can be published.</Alert>
          <div className="card"><h2 className="side-label">Existing datasets</h2>{!data.datasets.length ? <p className="text-sm text-muted">No dataset has been registered.</p> : data.datasets.map((dataset) => <div key={dataset.slug} className="row-between text-sm" style={{ borderTop: '1px solid var(--border)', padding: '0.5rem 0' }}><div><strong>{dataset.title}</strong><div className="text-xs text-muted">{dataset.slug} · v{dataset.version} · {dataset.status} · {dataset.verificationStatus}</div></div><div className="pill-group">{dataset.status !== 'published' ? <Button variant="ghost" size="sm" onClick={() => action(dataset, 'publish')}>Publish</Button> : <Button variant="ghost" size="sm" onClick={() => action(dataset, 'unpublish')}>Unpublish</Button>}<Button variant="ghost" size="sm" onClick={() => action(dataset, 'archive')}>Archive</Button></div></div>)}</div>
          <form className="card stack-tight" onSubmit={create}>
            <h2 className="side-label">Register a dataset</h2>
            <div className="grid grid-2">
              <Field label="Title" required><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <Field label="Category"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{data.categories.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}</Select></Field>
              <Field label="Government level"><Select value={form.entityLevel} onChange={(e) => setForm({ ...form, entityLevel: e.target.value, municipalityId: '' })}><option value="provincial">Provincial</option><option value="municipal">Municipal</option></Select></Field>
              <Field label="Municipality"><Select value={form.municipalityId} disabled={form.entityLevel === 'provincial'} onChange={(e) => setForm({ ...form, municipalityId: e.target.value })}><option value="">Select municipality</option>{[['boac',1],['mogpog',2],['gasan',3],['buenavista',4],['torrijos',5],['santa-cruz',6]].map(([slug,id]) => <option key={slug} value={id}>{slug}</option>)}</Select></Field>
              <Field label="Period label"><Input value={form.periodLabel} onChange={(e) => setForm({ ...form, periodLabel: e.target.value })} placeholder="FY 2025" /></Field>
              <Field label="Fiscal year"><Input value={form.fiscalYear} onChange={(e) => setForm({ ...form, fiscalYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></Field>
              <Field label="Source institution" required><Input value={form.sourceInstitution} onChange={(e) => setForm({ ...form, sourceInstitution: e.target.value })} /></Field>
              <Field label="Source document" required><Input value={form.sourceReference} onChange={(e) => setForm({ ...form, sourceReference: e.target.value })} /></Field>
              <Field label="Source URL"><Input type="url" value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} /></Field>
              <Field label="Verification status"><Select value={form.verificationStatus} onChange={(e) => setForm({ ...form, verificationStatus: e.target.value })}><option value="pending">Pending</option><option value="verified">Verified</option></Select></Field>
            </div>
            <Field label="Description" required><Textarea required rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid grid-2">
              <Field label="Coverage"><Input value={form.coverage} onChange={(e) => setForm({ ...form, coverage: e.target.value })} /></Field>
              <Field label="Record type"><Select value={form.recordTypes[0]} onChange={(e) => setForm({ ...form, recordTypes: [e.target.value] })}>{Object.entries(data.modules).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
            </div>
            <Field label="Limitations"><Textarea rows={2} value={form.limitations} onChange={(e) => setForm({ ...form, limitations: e.target.value })} /></Field>
            <Field label="Data dictionary (JSON array)" required help="Every field needs key, label and type. Personal fields block publication."><Textarea rows={6} value={form.dataDictionary} onChange={(e) => setForm({ ...form, dataDictionary: e.target.value })} /></Field>
            <div className="pill-group"><Button type="submit">Register draft</Button><Button type="button" variant="outline" onClick={generate}>Generate draft from published records</Button></div>
          </form>
          <div className="card"><h2 className="side-label">Download analytics</h2>{!analytics ? <p className="text-sm text-muted">No analytics available.</p> : <><p className="text-sm">{analytics.totals.downloads} aggregate download event(s). No individual history is collected.</p>{analytics.byFormat.map((row) => <div key={row.format} className="row-between text-sm"><span>{row.format.toUpperCase()}</span><strong>{row.downloads}</strong></div>)}</>}</div>
        </>
      )}
    </div>
  )
}

/* -------------------------------- 113 Alerts ----------------------------- */

export function AdminAlerts() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = () => api.get('/admin/transparency/alerts').then(setData).catch((err) => setError(err.message))
  useEffect(load, [])
  const retry = async (event) => {
    try { const body = await api.post(`/admin/transparency/alerts/events/${event.id}/retry`); toast.push(body.message); load() } catch (err) { toast.push(err.message, 'error') }
  }
  const pause = async (category) => {
    const hours = window.prompt(`Pause ${category} alerts for how many hours (1–720)?`)
    if (!hours) return
    const reason = window.prompt('Reason for the pause (recorded in the audit log):')
    if (!reason) return
    try { const body = await api.post(`/admin/transparency/alerts/categories/${category}/pause`, { pauseHours: Number(hours), reason }); toast.push(body.message); load() } catch (err) { toast.push(err.message, 'error') }
  }
  const runDigests = async () => {
    try { const body = await api.post('/admin/transparency/alerts/digests/run'); toast.push(body.message); load() } catch (err) { toast.push(err.message, 'error') }
  }
  return (
    <div className="section-tight">
      <AdminHeader title="Transparency alerts" current="Alerts" description="Monitor published update events, deliveries and digests. Subscriber identities are never listed." />
      {error ? <Alert tone="error" title="Alert administration failed">{error}</Alert> : !data ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="grid grid-3">
            <div className="card"><div className="side-label">Subscriptions</div><strong>{data.subscriberCounts.subscriptions}</strong><div className="text-xs text-muted">{data.subscriberCounts.users} account(s)</div></div>
            <div className="card"><div className="side-label">Events</div><strong>{data.events.length}</strong></div>
            <div className="card"><div className="side-label">In-app / email</div><span className="text-sm">In-app active · Email {data.channels.email ? 'configured (opt-in only)' : 'unavailable'} · SMS unavailable</span></div>
          </div>
          <div className="card"><div className="row-between"><h2 className="side-label">Generated events</h2><Button size="sm" onClick={runDigests}>Run due digests</Button></div>{!data.events.length ? <p className="text-sm text-muted">No published transparency event has been generated.</p> : <div className="table-wrap"><table className="data"><thead><tr><th scope="col">Event</th><th scope="col">Entity</th><th scope="col">Delivered</th><th scope="col">Failed</th><th scope="col">Date</th><th scope="col">Action</th></tr></thead><tbody>{data.events.map((event) => <tr key={event.id}><td>{event.title}<div className="text-xs text-muted">{event.recordReference || event.eventKey}</div></td><td>{event.municipality} · {event.category}</td><td>{event.delivered}</td><td>{event.failed}</td><td>{String(event.publishedAt).slice(0, 10)}</td><td><Button variant="ghost" size="sm" onClick={() => retry(event)}>Retry eligible</Button></td></tr>)}</tbody></table></div>}</div>
          <div className="card"><h2 className="side-label">Pause a category during an incident</h2><div className="pill-group">{data.categories.map((category) => <Button key={category.key} variant="outline" size="sm" onClick={() => pause(category.key)}>Pause {category.label}</Button>)}</div><p className="text-xs text-muted">Pauses suppress new event delivery; they do not delete history. Reasons are recorded in the audit log.</p></div>
          <div className="card"><h2 className="side-label">Failed deliveries</h2>{!data.failures.length ? <p className="text-sm text-muted">No failed delivery attempt.</p> : <ul className="text-sm">{data.failures.map((row) => <li key={row.id}>{row.title} · {row.channel} · {row.status} · attempts {row.attempts}</li>)}</ul>}</div>
        </>
      )}
    </div>
  )
}

/* ------------------------------- 114 Community --------------------------- */

export function AdminCommunity() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = () => api.get('/admin/transparency/community').then(setData).catch((err) => setError(err.message))
  useEffect(load, [])
  const act = async (path, body) => {
    try { const result = await api.patch(path, body); toast.push(result.message); load() } catch (err) { toast.push(err.message, 'error') }
  }
  const moderateThread = (thread, action) => {
    const note = ['request_changes', 'hide', 'remove', 'restore'].includes(action) ? window.prompt(`Reason for ${action}:`) : ''
    if (['request_changes', 'hide', 'remove'].includes(action) && !note) return
    act(`/admin/transparency/community/threads/${thread.id}`, { action, note: note || '' })
  }
  const moderatePost = (post, action) => {
    const note = ['request_changes', 'hide', 'remove', 'restore'].includes(action) ? window.prompt(`Reason for ${action}:`) : ''
    if (['request_changes', 'hide', 'remove'].includes(action) && !note) return
    act(`/admin/transparency/community/posts/${post.id}`, { action, note: note || '' })
  }
  return (
    <div className="section-tight">
      <AdminHeader title="Community moderation" current="Community" description="Review questions, answers, sources, reports and appeals. Private reporter identities and reviewer notes stay restricted." />
      {error ? <Alert tone="error" title="Community administration failed">{error}</Alert> : !data ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="grid grid-4">
            <div className="card"><div className="side-label">Pending threads</div><strong>{data.summary.pendingThreads}</strong></div>
            <div className="card"><div className="side-label">Pending answers</div><strong>{data.summary.pendingPosts}</strong></div>
            <div className="card"><div className="side-label">Open reports</div><strong>{data.summary.openReports}</strong></div>
            <div className="card"><div className="side-label">Open appeals</div><strong>{data.summary.openAppeals}</strong></div>
          </div>
          <Alert tone="warning" title="Moderation standard">Publish only content that follows the guidelines. Never verify credentials or sources without evidence. Community content is not an official government response.</Alert>
          <div className="card">
            <h2 className="side-label">Threads and answers</h2>
            {!data.threads.length ? <p className="text-sm text-muted">No community thread exists.</p> : data.threads.map((thread) => (
              <div key={thread.id} style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
                <div className="row-between"><div><strong>{thread.title}</strong><div className="text-xs text-muted">{thread.kind} · {thread.topicTitle} · {thread.municipalityName || 'Provincial'} · {thread.status}</div></div><div className="pill-group"><Button variant="ghost" size="sm" onClick={() => moderateThread(thread, 'publish')}>Publish</Button><Button variant="ghost" size="sm" onClick={() => moderateThread(thread, 'request_changes')}>Request changes</Button><Button variant="ghost" size="sm" onClick={() => moderateThread(thread, 'hide')}>Hide</Button><Button variant="ghost" size="sm" onClick={() => moderateThread(thread, 'restore')}>Restore</Button></div></div>
                <p className="text-sm">{thread.body}</p>
                {thread.moderationNote ? <p className="text-xs text-muted">Private note: {thread.moderationNote}</p> : null}
                {thread.posts.map((post) => <div key={post.id} className="text-sm" style={{ marginLeft: '1rem', borderLeft: '2px solid var(--border)', paddingLeft: '0.75rem' }}><div className="text-xs text-muted">Answer · {post.status}</div>{post.body}<div className="pill-group"><Button variant="ghost" size="sm" onClick={() => moderatePost(post, 'publish')}>Publish</Button><Button variant="ghost" size="sm" onClick={() => moderatePost(post, 'hide')}>Hide</Button></div></div>)}
              </div>
            ))}
          </div>
          <div className="grid grid-2">
            <div className="card"><h2 className="side-label">Reports</h2>{!data.reports.length ? <p className="text-sm text-muted">No report received.</p> : data.reports.map((report) => <div key={report.id} className="stack-tight" style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}><strong>{report.reference} · {report.reason}</strong><div className="text-xs text-muted">{report.targetType} · {report.targetLabel || 'target unavailable'} · {report.status}</div><p className="text-sm">{report.details}</p>{report.status === 'open' ? <div className="pill-group"><Button size="sm" onClick={() => { const note = window.prompt('Resolution note:'); if (note) act(`/admin/transparency/community/reports/${report.id}`, { action: 'resolve', note }) }}>Resolve</Button><Button variant="ghost" size="sm" onClick={() => { const note = window.prompt('Dismissal note:'); if (note) act(`/admin/transparency/community/reports/${report.id}`, { action: 'dismiss', note }) }}>Dismiss</Button></div> : null}</div>)}</div>
            <div className="card"><h2 className="side-label">Appeals</h2>{!data.appeals.length ? <p className="text-sm text-muted">No appeal received.</p> : data.appeals.map((appeal) => <div key={appeal.id} className="stack-tight" style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}><strong>{appeal.reference} · {appeal.status}</strong><div className="text-xs text-muted">{appeal.threadReference || 'answer appeal'}</div><p className="text-sm">{appeal.reason}</p>{appeal.status === 'pending' ? <div className="pill-group"><Button size="sm" onClick={() => { const note = window.prompt('Decision note:'); if (note) act(`/admin/transparency/community/appeals/${appeal.id}`, { action: 'accept', note }) }}>Accept and restore</Button><Button variant="ghost" size="sm" onClick={() => { const note = window.prompt('Decision note:'); if (note) act(`/admin/transparency/community/appeals/${appeal.id}`, { action: 'reject', note }) }}>Reject</Button></div> : null}</div>)}</div>
          </div>
          <div className="card"><h2 className="side-label">Sources and contributors</h2>{data.sources.map((source) => <div key={source.id} className="row-between text-sm" style={{ borderTop: '1px solid var(--border)', padding: '0.4rem 0' }}><div><a href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a><div className="text-xs text-muted">{source.institution || 'Institution unavailable'} · {source.verification_status}</div></div><Button variant="ghost" size="sm" onClick={() => act(`/admin/transparency/community/sources/${source.id}`, { action: 'verify' })}>Mark reviewed</Button></div>)}{data.contributors.map((contributor) => <div key={contributor.id} className="row-between text-sm" style={{ borderTop: '1px solid var(--border)', padding: '0.4rem 0' }}><div><strong>{contributor.display_name}</strong><div className="text-xs text-muted">{contributor.verification_status} · {contributor.credentials_text || 'No credentials recorded'}</div></div><Button variant="ghost" size="sm" onClick={() => act(`/admin/transparency/community/contributors/${contributor.id}`, { action: 'verify' })}>Verify credentials</Button></div>)}{!data.sources.length && !data.contributors.length ? <p className="text-sm text-muted">No source or contributor profile yet.</p> : null}</div>
        </>
      )}
    </div>
  )
}
