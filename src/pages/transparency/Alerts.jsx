import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDateTime } from '../../api'
import { useSeo } from '../../hooks'
import { useAuth } from '../../auth'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'
import TransparencyNav from './TransparencyNav'

const TOPICS_FALLBACK = [
  ['all', 'All transparency updates'],
  ['budget', 'Budgets and appropriations'],
  ['revenue', 'Revenue and tax collections'],
  ['expenditure', 'Expenditures'],
  ['procurement', 'Procurement and contracts'],
  ['open_data', 'Open-data dataset updates'],
  ['monitoring', 'Approved data-quality observations'],
]

export default function Alerts({ mode = 'hub' }) {
  const { user } = useAuth()
  const toast = useToast()
  const [catalog, setCatalog] = useState(null)
  const [data, setData] = useState(null)
  const [history, setHistory] = useState(null)
  const [digest, setDigest] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [subscribe, setSubscribe] = useState({ topic: 'all', municipalityId: '' })
  const [preferences, setPreferences] = useState(null)

  useSeo({ title: 'Transparency alerts', description: 'Follow published Marinduque budget, expenditure, procurement, monitoring and open-data updates. Opt-in, privacy-conscious and never a government announcement.', noindex: mode !== 'hub' })

  const load = () => {
    api.get('/transparency/alerts/catalog').then(setCatalog).catch((err) => setError(err.message))
    if (!user) return
    if (mode === 'history') api.get('/transparency/alerts/history').then(setHistory).catch((err) => setError(err.message))
    else if (mode === 'preferences') api.get('/transparency/alerts/preferences').then((body) => setPreferences(body.preferences)).catch((err) => setError(err.message))
    else api.get('/transparency/alerts').then((body) => { setData(body); setPreferences(body.preferences) }).catch((err) => setError(err.message))
    if (mode === 'hub') api.get('/transparency/alerts/digest?frequency=daily').then(setDigest).catch(() => {})
  }

  useEffect(load, [mode, user])

  const addSubscription = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const body = await api.post('/transparency/alerts/subscriptions', { topic: subscribe.topic, municipalityId: subscribe.municipalityId ? Number(subscribe.municipalityId) : null })
      toast.push(body.message)
      setSubscribe({ ...subscribe, municipalityId: '' })
      load()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally { setBusy(false) }
  }

  const removeSubscription = async (id) => {
    try {
      await api.del(`/transparency/alerts/subscriptions/${id}`)
      toast.push('Subscription removed.')
      load()
    } catch (err) { toast.push(err.message, 'error') }
  }

  const savePreferences = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const body = await api.put('/transparency/alerts/preferences', {
        inApp: preferences.inApp,
        emailOptIn: preferences.emailOptIn,
        frequency: preferences.frequency,
        quietStart: preferences.quietStart || '',
        quietEnd: preferences.quietEnd || '',
        pauseDays: preferences.pauseDays === undefined ? undefined : Number(preferences.pauseDays),
        timezone: preferences.timezone,
      })
      setPreferences(body.preferences)
      toast.push(body.message)
    } catch (err) { toast.push(err.message, 'error') } finally { setBusy(false) }
  }

  const header = (
    <>
      <PageHeader
        eyebrow="Transparency"
        title={mode === 'history' ? 'Alert history' : mode === 'preferences' ? 'Alert preferences' : mode === 'subscriptions' ? 'My subscriptions' : 'Transparency alerts'}
        description="Follow published financial transparency records. Alerts are opt-in, factual and never describe a person or institution as corrupt, fraudulent or guilty."
        breadcrumbs={[{ label: 'Transparency', to: '/transparency' }, { label: 'Alerts', to: '/transparency/alerts' }, ...(mode !== 'hub' ? [{ label: mode }] : [])]}
      />
      <TransparencyNav />
    </>
  )

  if (error) return <div className="section-tight">{header}<Alert tone="error" title="Alerts could not load">{error}</Alert></div>
  if (!catalog) return <div className="section-tight">{header}<SkeletonList count={2} height={70} /></div>

  const topics = data?.topics || catalog.topics
  const entities = data?.entities || catalog.entities

  if (!user) {
    return (
      <div className="section-tight">
        {header}
        <Alert tone="info" title="Sign in to follow updates">Subscriptions belong to a verified BetterGo account so that preferences, history and unsubscribe controls stay private. You can read the catalog without signing in.</Alert>
        <div className="card">
          <h2 className="side-label">Available topics</h2>
          <div className="grid grid-3">{catalog.topics.map((topic) => <div key={topic.key}><strong>{topic.label}</strong></div>)}</div>
          <div className="pill-group" style={{ marginTop: '1rem' }}>
            <Link className="btn btn-primary btn-sm" to={`/login?next=${encodeURIComponent('/transparency/alerts')}`}>Sign in</Link>
            <Link className="btn btn-outline btn-sm" to="/transparency/open-data">Browse open data instead</Link>
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'history') {
    return (
      <div className="section-tight">
        {header}
        {!history ? <SkeletonList count={2} height={60} /> : (
          <div className="card">
            <h2 className="side-label">Your alert deliveries</h2>
            {!history.results.length ? <p className="text-sm text-muted">No transparency alert has been delivered to your account yet. New alerts appear only after a record is published.</p> : (
              <div className="table-wrap"><table className="data"><caption className="text-xs">Only your own history is shown. Email is marked pending unless a provider confirmed delivery.</caption><thead><tr><th scope="col">Update</th><th scope="col">Category</th><th scope="col">Period</th><th scope="col">Channel</th><th scope="col">Status</th><th scope="col">Date</th></tr></thead><tbody>{history.results.map((row) => <tr key={row.id}><td>{row.recordReference ? <Link to={`/transparency/finance/record/${row.recordReference}`}>{row.title}</Link> : row.title}<div className="text-xs text-muted">{row.summary}</div></td><td>{row.categoryLabel}</td><td>{row.periodLabel || 'Unavailable'}</td><td>{row.channel}</td><td><Badge tone={row.status === 'delivered' ? 'success' : 'warning'}>{row.status}</Badge></td><td>{fmtDateTime(row.createdAt)}</td></tr>)}</tbody></table></div>
            )}
            <p className="text-xs text-muted">{history.note}</p>
          </div>
        )}
      </div>
    )
  }

  if (mode === 'preferences') {
    if (!preferences) return <div className="section-tight">{header}<SkeletonList count={2} height={60} /></div>
    return (
      <div className="section-tight">
        {header}
        <form className="card stack-tight" onSubmit={savePreferences}>
          <h2 className="side-label">Delivery preferences</h2>
          <label className="checkbox-row"><input type="checkbox" checked={preferences.inApp} onChange={(e) => setPreferences({ ...preferences, inApp: e.target.checked })} /><span>In-app notifications</span></label>
          <label className="checkbox-row"><input type="checkbox" checked={preferences.emailOptIn} onChange={(e) => setPreferences({ ...preferences, emailOptIn: e.target.checked })} /><span>Email (only when a provider is configured and you opt in)</span></label>
          <Field label="Frequency"><Select value={preferences.frequency} onChange={(e) => setPreferences({ ...preferences, frequency: e.target.value })}><option value="immediate">Immediate</option><option value="daily">Daily digest</option><option value="weekly">Weekly digest</option></Select></Field>
          <div className="grid grid-3">
            <Field label="Quiet hours start" help="HH:MM in your timezone"><Input type="time" value={preferences.quietStart || ''} onChange={(e) => setPreferences({ ...preferences, quietStart: e.target.value })} /></Field>
            <Field label="Quiet hours end"><Input type="time" value={preferences.quietEnd || ''} onChange={(e) => setPreferences({ ...preferences, quietEnd: e.target.value })} /></Field>
            <Field label="Timezone"><Input value={preferences.timezone} onChange={(e) => setPreferences({ ...preferences, timezone: e.target.value })} /></Field>
          </div>
          <Field label="Pause all transparency alerts for (days)" help="0 removes an existing pause."><Input inputMode="numeric" value={preferences.pauseDays ?? ''} onChange={(e) => setPreferences({ ...preferences, pauseDays: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="0" /></Field>
          <Alert tone="info" title="Channels">{preferences.note} SMS and push are not available on this deployment.</Alert>
          <Button type="submit" loading={busy}>Save preferences</Button>
        </form>
      </div>
    )
  }

  return (
    <div className="section-tight">
      {header}
      <Alert tone="info" title="Consent and accuracy">{catalog.consent}</Alert>
      {!data ? <SkeletonList count={2} height={70} /> : (
        <>
          <div className="grid grid-3">
            <div className="card"><div className="side-label">Your subscriptions</div><strong>{data.subscriptions.length}</strong></div>
            <div className="card"><div className="side-label">Delivery mode</div><strong>{data.preferences.frequency}</strong><div className="text-xs text-muted">{data.preferences.inApp ? 'In-app on' : 'In-app off'} · {data.preferences.emailOptIn ? 'Email opt-in' : 'No email opt-in'}</div></div>
            <div className="card"><div className="side-label">Recent deliveries</div><strong>{data.recent.length}</strong></div>
          </div>

          <form className="card stack-tight" onSubmit={addSubscription}>
            <h2 className="side-label">Add a subscription</h2>
            <div className="grid grid-2">
              <Field label="Topic"><Select value={subscribe.topic} onChange={(e) => setSubscribe({ ...subscribe, topic: e.target.value })}>{topics.map((topic) => <option key={topic.key} value={topic.key}>{topic.label}</option>)}</Select></Field>
              <Field label="Government entity"><Select value={subscribe.municipalityId} onChange={(e) => setSubscribe({ ...subscribe, municipalityId: e.target.value })}><option value="">Provincial / all municipalities</option>{entities.filter((entity) => entity.id).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</Select></Field>
            </div>
            <Button type="submit" loading={busy}>Subscribe</Button>
            <p className="text-xs text-muted">Selecting a municipality limits alerts to that municipality. Leaving it empty covers provincial records and all municipalities for the chosen topic.</p>
          </form>

          <div className="card">
            <div className="row-between"><h2 className="side-label">Your subscriptions</h2><div className="pill-group"><Link className="pill" to="/transparency/alerts/preferences">Preferences</Link><Link className="pill" to="/transparency/alerts/history">History</Link></div></div>
            {!data.subscriptions.length ? <p className="text-sm text-muted">You are not following any transparency topic yet. No notifications will be sent until you subscribe.</p> : data.subscriptions.map((item) => (
              <div key={item.id} className="row-between" style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                <div><strong>{item.topicLabel}</strong><div className="text-xs text-muted">{item.municipalityName || 'Provincial / all municipalities'}</div></div>
                <Button variant="ghost" size="sm" onClick={() => removeSubscription(item.id)}>Unsubscribe</Button>
              </div>
            ))}
          </div>

          <div className="card">
            <h2 className="side-label">Digest preview</h2>
            {!digest ? <p className="text-sm text-muted">Digest information is unavailable.</p> : digest.empty ? <p className="text-sm text-muted">{digest.note}</p> : (
              <>
                <p className="text-sm text-muted">{digest.count} update(s) in the last day. {digest.note}</p>
                {digest.groups.map((group) => <div key={`${group.municipalityId}-${group.category}`} className="stack-tight"><strong>{group.categoryLabel}</strong><ul>{group.items.map((item) => <li key={`${item.recordReference}-${item.title}`}>{item.title} · {item.periodLabel || 'period unavailable'}</li>)}</ul></div>)}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
