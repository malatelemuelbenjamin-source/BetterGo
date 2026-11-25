import { useEffect, useState } from 'react'
import { Bell, Mail, MapPin, MessageSquare, MonitorSmartphone } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, Field, Input, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

/**
 * Citizen notification preferences (Prompt 68 §9).
 * Only channels the deployment actually supports are presented as available.
 */
export default function NotificationSettings() {
  useDocumentTitle('Notification settings')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      setData(await api.get('/account/notification-settings'))
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (key, value) => {
    if (key === 'security') return
    setData((current) => ({
      ...current,
      categories: current.categories.map((entry) => (entry.key === key ? { ...entry, value } : entry)),
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const body = Object.fromEntries(data.categories.map((entry) => [entry.key, entry.value]))
      await api.put('/account/notification-settings', body)
      toast.push('Notification preferences saved.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const follow = async (id) => {
    try {
      await api.post(`/account/notification-settings/municipalities/${id}`)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const unfollow = async (id) => {
    try {
      await api.delete(`/account/notification-settings/municipalities/${id}`)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Notification settings"
        description="Choose which BetterGo notifications you receive and which municipalities you follow."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Notification settings' }]}
        actions={<Button onClick={save} disabled={saving || loading}>{saving ? 'Saving…' : 'Save preferences'}</Button>}
      />

      {loading || !data ? (
        <SkeletonList count={4} height={70} />
      ) : (
        <>
          <div className="grid grid-2 mt-4">
            <div className="card">
              <div className="row"><Bell size={18} /><strong>In-app notifications</strong><Badge tone="success">Active</Badge></div>
              <p className="text-sm text-muted">{data.channels.inApp.label}. These appear in your notification centre and dashboard.</p>
            </div>
            <div className="card">
              <div className="row"><Mail size={18} /><strong>Email</strong><Badge tone={data.channels.email.available ? 'info' : 'neutral'}>{data.channels.email.available ? 'Configured' : 'Unavailable'}</Badge></div>
              <p className="text-sm text-muted">{data.channels.email.label}. BetterGo does not claim an email was delivered unless the mail provider confirms it.</p>
            </div>
            <div className="card">
              <div className="row"><MessageSquare size={18} /><strong>SMS</strong><Badge tone="neutral">Unavailable</Badge></div>
              <p className="text-sm text-muted">{data.channels.sms.label}.</p>
            </div>
            <div className="card">
              <div className="row"><MonitorSmartphone size={18} /><strong>Push</strong><Badge tone="neutral">Unavailable</Badge></div>
              <p className="text-sm text-muted">{data.channels.push.label}.</p>
            </div>
          </div>

          <div className="card mt-4">
            <h2 className="side-label">Categories</h2>
            <div className="stack">
              {data.categories.map((entry) => (
                <label key={entry.key} className="row-between" style={{ padding: '0.4rem 0' }}>
                  <span>
                    <strong>{entry.label}</strong>
                    {entry.alwaysOn ? <span className="text-xs text-muted"> — required for account protection</span> : null}
                  </span>
                  <input
                    type="checkbox"
                    checked={entry.value}
                    disabled={entry.alwaysOn}
                    onChange={(event) => toggle(entry.key, event.target.checked)}
                    aria-label={entry.label}
                  />
                </label>
              ))}
            </div>
            <p className="text-sm text-muted mt-2">{data.note}</p>
          </div>

          <div className="card mt-4">
            <div className="row"><MapPin size={18} /><strong>Municipalities you follow</strong></div>
            <p className="text-sm text-muted">Published announcements and advisories from these municipalities appear in your notification centre.</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
              {data.municipalities.map((municipality) => {
                const following = data.follows.some((row) => row.municipality_id === municipality.id)
                return (
                  <button
                    key={municipality.id}
                    type="button"
                    className={`pill ${following ? 'is-active' : ''}`}
                    aria-pressed={following}
                    onClick={() => (following ? unfollow(municipality.id) : follow(municipality.id))}
                  >
                    {municipality.name}
                  </button>
                )
              })}
            </div>
          </div>

          <Alert tone="info" title="Emergency information">
            Emergency notices are only sent from verified official sources. Quiet hours never delay emergency information, and security notices cannot be switched off.
          </Alert>
        </>
      )}
    </div>
  )
}
