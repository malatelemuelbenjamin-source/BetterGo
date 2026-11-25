import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

export default function DelegationsPage() {
  useDocumentTitle('Delegated access')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [form, setForm] = useState({ email: '', relationship: 'family', scopes: [], expiresAt: '' })
  const [overview, setOverview] = useState(null)

  const load = async () => {
    try {
      setData(await api.get('/account/delegations'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id, action) => {
    try {
      await api.post(`/account/delegations/${id}/${action}`, {})
      toast.push('Delegation updated.')
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
        title="Delegated access"
        description="Let someone you trust help you follow selected records, read-only."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Delegated access' }]}
      />
      <Alert tone="info" title="What delegates can and cannot do">{data.note}</Alert>

      <div className="card">
        <h2 className="side-label">Invite someone you trust</h2>
        <Field label="BetterGo account email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Relationship">
          <Select value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}>
            {Object.entries(data.relationships).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <fieldset>
          <legend className="field-label">What they can read</legend>
          {Object.entries(data.scopes).map(([value, label]) => (
            <label key={value} className="row text-sm">
              <input
                type="checkbox"
                checked={form.scopes.includes(value)}
                onChange={(e) => setForm({ ...form, scopes: e.target.checked ? [...form.scopes, value] : form.scopes.filter((scope) => scope !== value) })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <Field label="Expires on (optional)"><Input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field>
        <Button
          icon={Users}
          onClick={async () => {
            try {
              const result = await api.post('/account/delegations', {
                email: form.email,
                relationship: form.relationship,
                scopes: form.scopes,
                expiresAt: form.expiresAt || undefined,
              })
              toast.push(result.message)
              setForm({ email: '', relationship: 'family', scopes: [], expiresAt: '' })
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Send invitation
        </Button>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2 className="side-label">People you invited</h2>
          {data.given.length ? data.given.map((row) => (
            <div key={row.id} className="stack-tight">
              <div className="row-between"><strong>{row.delegateName}</strong><Badge tone={row.status === 'active' ? 'success' : 'neutral'}>{row.status}</Badge></div>
              <span className="text-xs text-muted">{row.scopeLabels.join(' · ')}</span>
              {['pending', 'active'].includes(row.status) ? <Button size="sm" variant="ghost" onClick={() => act(row.id, 'revoke')}>Revoke</Button> : null}
            </div>
          )) : <p className="text-sm text-muted">No invitations sent.</p>}
        </div>

        <div className="card">
          <h2 className="side-label">Invitations to help others</h2>
          {data.received.length ? data.received.map((row) => (
            <div key={row.id} className="stack-tight">
              <div className="row-between"><strong>{row.ownerName}</strong><Badge tone={row.status === 'active' ? 'success' : 'neutral'}>{row.status}</Badge></div>
              <span className="text-xs text-muted">{row.scopeLabels.join(' · ')}</span>
              {row.status === 'pending' ? (
                <div className="row">
                  <Button size="sm" onClick={() => act(row.id, 'accept')}>Accept</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(row.id, 'decline')}>Decline</Button>
                </div>
              ) : null}
              {row.status === 'active' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      setOverview(await api.get(`/account/delegations/${row.id}/overview`))
                    } catch (err) {
                      toast.push(err.message, 'error')
                    }
                  }}
                >
                  Open read-only summary
                </Button>
              ) : null}
              {['active', 'pending'].includes(row.status) ? <Button size="sm" variant="ghost" onClick={() => act(row.id, 'revoke')}>End access</Button> : null}
            </div>
          )) : <p className="text-sm text-muted">No invitations received.</p>}
        </div>
      </div>

      {overview ? (
        <div className="card">
          <h2 className="side-label">{overview.ownerName}'s shared summaries</h2>
          {Object.entries(overview.sections).map(([key, rows]) => (
            <div key={key}>
              <h3 className="side-label">{key}</h3>
              {rows.length ? rows.map((row, index) => <div key={index} className="text-sm">{row.reference} · {row.status}</div>) : <p className="text-sm text-muted">Nothing recorded.</p>}
            </div>
          ))}
          <p className="text-xs text-muted">{overview.note}</p>
        </div>
      ) : null}
    </div>
  )
}
