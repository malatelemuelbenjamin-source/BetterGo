import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, Bell, BellOff, CheckCheck, Star, Trash2 } from 'lucide-react'
import { api, fmtDateTime } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

const STATUS_FILTERS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['important', 'Important'],
  ['archived', 'Archived'],
]

const TONES = { security: 'warning', emergency: 'warning', privacy: 'info', application: 'info', document: 'neutral', announcement: 'info' }

/**
 * Citizen notifications centre (Prompt 68).
 * In-app is the only active channel on this deployment; the page polls for new
 * notifications rather than claiming a real-time channel it does not have.
 */
export default function NotificationsPage() {
  useDocumentTitle('Notifications')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')
  const latestId = useRef(0)

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams({ status })
      if (category) params.set('category', category)
      if (q) params.set('q', q)
      const payload = await api.get(`/account/notifications?${params.toString()}`)
      setData(payload)
      latestId.current = Math.max(latestId.current, ...(payload.results || []).map((row) => row.id), 0)
    } catch (err) {
      if (!silent) toast.push(err.message, 'error')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, category])

  // Secure polling fallback: only the signed-in citizen's own records.
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const payload = await api.get(`/account/notifications/poll?since=${latestId.current}`)
        if (payload.results?.length) {
          latestId.current = payload.latestId
          await load(true)
        }
      } catch { /* a failed poll must not interrupt reading */ }
    }, 30_000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = async (note, patch, message) => {
    try {
      await api.patch(`/account/notifications/${note.id}`, patch)
      if (message) toast.push(message)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const remove = async (note) => {
    try {
      await api.delete(`/account/notifications/${note.id}`)
      toast.push('Notification removed from your inbox.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Notifications"
        description="Messages about your BetterGo account, submissions, documents and followed municipalities."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Notifications' }]}
        actions={
          <div className="row">
            <Button
              variant="outline"
              icon={Archive}
              onClick={async () => {
                try {
                  await api.post('/account/notifications/archive-all')
                  await load()
                  toast.push('Notifications archived.')
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Archive all
            </Button>
            <Button
              variant="outline"
              icon={CheckCheck}
              onClick={async () => {
                try {
                  await api.post('/account/notifications/read-all')
                  toast.push('All notifications marked as read.')
                  await load()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Mark all read
            </Button>
          </div>
        }
      />

      {data ? (
        <div className="grid grid-3 mt-4">
          <div className="card stat-card"><span className="stat-label">Unread</span><div className="stat-value">{data.unread}</div></div>
          <div className="card stat-card"><span className="stat-label">In this view</span><div className="stat-value">{data.total}</div></div>
          <div className="card stat-card">
            <span className="stat-label">Channels</span>
            <p className="text-sm text-muted" style={{ marginTop: '0.4rem' }}>
              In-app active · Email {data.channels.email ? 'configured' : 'unavailable'} · SMS unavailable
            </p>
          </div>
        </div>
      ) : null}

      <div className="row mt-4" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map(([value, label]) => (
          <button key={value} type="button" className={`pill ${status === value ? 'is-active' : ''}`} onClick={() => setStatus(value)} aria-pressed={status === value}>
            {label}
          </button>
        ))}
      </div>

      <div className="card mt-3">
        <div className="row">
          <input
            className="input"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') load() }}
            placeholder="Search notifications"
            aria-label="Search notifications"
          />
          <Button variant="outline" onClick={() => load()}>Search</Button>
        </div>
        <div className="row mt-2" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
          <button type="button" className={`pill ${!category ? 'is-active' : ''}`} onClick={() => setCategory('')}>All categories</button>
          {(data?.categories || []).map((entry) => (
            <button key={entry.key} type="button" className={`pill ${category === entry.key ? 'is-active' : ''}`} onClick={() => setCategory(entry.key)} aria-pressed={category === entry.key}>
              {entry.label} ({data.counts?.[entry.key] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <SkeletonList count={3} height={90} />
      ) : data?.results?.length ? (
        <div className="stack mt-3">
          {data.results.map((note) => (
            <article className="card" key={note.id}>
              <div className="row-between">
                <strong>{note.title}</strong>
                <Badge tone={note.important ? 'info' : TONES[note.category] || 'neutral'}>{note.important ? 'Important' : note.categoryLabel}</Badge>
              </div>
              {note.message ? <p className="text-sm text-muted">{note.message}</p> : null}
              <div className="card-meta">
                <span>{fmtDateTime(note.created_at)}</span>
                <span>{note.read_at ? 'Read' : 'Unread'}</span>
                {note.archived_at ? <span>Archived</span> : null}
              </div>
              <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
                {!note.read_at ? (
                  <Button size="sm" variant="ghost" icon={Bell} onClick={() => update(note, { read: true })}>Mark read</Button>
                ) : null}
                <Button size="sm" variant="ghost" icon={Star} onClick={() => update(note, { important: !note.important }, note.important ? 'Unmarked important.' : 'Marked important.')}>
                  {note.important ? 'Unmark' : 'Important'}
                </Button>
                <Button size="sm" variant="ghost" icon={Archive} onClick={() => update(note, { archived: !note.archived_at }, note.archived_at ? 'Restored.' : 'Archived.')}>
                  {note.archived_at ? 'Restore' : 'Archive'}
                </Button>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(note)}>Delete</Button>
                {note.related_entity_type === 'application' && note.related_entity_id ? (
                  <Link className="btn btn-ghost btn-sm" to={`/dashboard/applications`}>Open applications</Link>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={BellOff} title="No notifications here" description="Notifications appear when an application, document, security event or followed municipality concerns your account." />
      )}

      <Alert tone="info" title="Delivery channels">
        {data?.note || 'In-app notifications work on this deployment.'} Security notices cannot be archived or deleted.{' '}
        <Link to="/account/notification-settings">Manage notification settings</Link>.
      </Alert>
    </div>
  )
}
