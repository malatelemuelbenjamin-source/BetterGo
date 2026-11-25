import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, ShieldCheck, Trash2 } from 'lucide-react'
import { api, fmtDateTime } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, Textarea, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

const REQUEST_TYPES = [
  ['access', 'Access my personal data'],
  ['correction', 'Correct my personal data'],
  ['deletion', 'Delete my account and data'],
  ['restriction', 'Restrict processing'],
  ['concern', 'Raise a privacy concern'],
  ['question', 'Ask a privacy question'],
]

/** Citizen privacy centre (Prompt 71). */
export default function PrivacyCenter() {
  useDocumentTitle('Privacy centre')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [sharing, setSharing] = useState(null)
  const [requestForm, setRequestForm] = useState({ category: 'access', description: '' })
  const [correction, setCorrection] = useState({ field: '', currentValue: '', proposedValue: '', explanation: '' })
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const [center, shares] = await Promise.all([api.get('/account/privacy-center'), api.get('/account/privacy-center/sharing')])
      setData(center)
      setSharing(shares)
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleConsent = async (category, action) => {
    try {
      const result = await api.put(`/account/privacy-center/consents/${category}`, { action })
      toast.push(result.message)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const submitRequest = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const payload = { ...requestForm }
      if (requestForm.category === 'correction') payload.correction = correction
      const result = await api.post('/account/privacy-center/requests', payload)
      toast.push(result.message)
      setRequestForm({ category: 'access', description: '' })
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const exportData = async (format) => {
    try {
      const response = await fetch(`/api/account/privacy-center/export`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      })
      if (!response.ok) throw new Error('The export could not be generated.')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `bettergo-personal-data.${format}`
      link.click()
      URL.revokeObjectURL(url)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  if (!data) return <div className="section-tight"><SkeletonList count={5} height={70} /></div>

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Privacy centre"
        description="Review what BetterGo stores, manage consent and exercise your data rights."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Privacy centre' }]}
      />

      <div className="grid grid-2">
        <div className="card">
          <h2 className="side-label">Personal information</h2>
          <div className="stack text-sm">
            <div className="row-between"><span>Name</span><strong>{data.profile.name || '—'}</strong></div>
            <div className="row-between"><span>Email</span><strong>{data.profile.email}</strong></div>
            <div className="row-between"><span>Email verified</span><Badge tone={data.profile.emailVerified ? 'success' : 'warning'}>{data.profile.emailVerified ? 'Yes' : 'No'}</Badge></div>
            <div className="row-between"><span>Phone</span><span>{data.profile.phone || 'Not provided'}</span></div>
            <div className="row-between"><span>Phone verified</span><Badge tone={data.profile.phoneVerified ? 'success' : 'neutral'}>{data.profile.phoneVerified ? 'Yes' : 'No'}</Badge></div>
            <div className="row-between"><span>Municipality</span><span>{data.profile.municipality || 'Not set'}</span></div>
            <div className="row-between"><span>Language</span><span>{data.profile.language}</span></div>
          </div>
          <p className="text-sm text-muted mt-2">{data.requiredInformation[0]}</p>
          <p className="text-sm text-muted">{data.optionalInformation[0]}</p>
          <Link className="btn btn-outline btn-sm" to="/dashboard/profile/edit">Edit my profile</Link>
        </div>

        <div className="card">
          <h2 className="side-label">What BetterGo stores about you</h2>
          <div className="stack text-sm">
            <div className="row-between"><span>Saved services</span><strong>{data.counts.saved}</strong></div>
            <div className="row-between"><span>Application records</span><strong>{data.counts.applications}</strong></div>
            <div className="row-between"><span>Vault documents</span><strong>{data.counts.documents}</strong></div>
            <div className="row-between"><span>Support tickets</span><strong>{data.counts.supportTickets}</strong></div>
            <div className="row-between"><span>Feedback</span><strong>{data.counts.feedback}</strong></div>
            <div className="row-between"><span>Survey responses</span><strong>{data.counts.surveyResponses}</strong></div>
            <div className="row-between"><span>Active sharing permissions</span><strong>{data.counts.sharingPermissions}</strong></div>
          </div>
          <div className="row mt-2">
            <Button variant="outline" icon={Download} onClick={() => exportData('json')}>Export JSON</Button>
            <Button variant="outline" icon={Download} onClick={() => exportData('csv')}>Export CSV</Button>
          </div>
          <p className="text-xs text-muted">Exports exclude passwords, session tokens, internal notes and other citizens’ records. Vault files are downloaded separately.</p>
        </div>
      </div>

      <div className="card mt-4">
        <h2 className="side-label">Consent</h2>
        <div className="stack">
          {data.consents.length ? data.consents.map((consent) => (
            <div key={`${consent.consent_category}-${consent.created_at}`} className="row-between">
              <span>
                <strong>{String(consent.consent_category).replace(/_/g, ' ')}</strong>
                <span className="text-xs text-muted"> · {consent.policy_version || 'no notice version'} · {fmtDateTime(consent.created_at)}</span>
              </span>
              <div className="row">
                <Badge tone={consent.status === 'granted' ? 'success' : 'neutral'}>{consent.status}</Badge>
                {consent.status === 'granted' && !['terms_of_use', 'privacy_policy'].includes(consent.consent_category) ? (
                  <Button size="sm" variant="ghost" onClick={() => toggleConsent(consent.consent_category, 'withdraw')}>Withdraw</Button>
                ) : null}
                {consent.status === 'withdrawn' ? (
                  <Button size="sm" variant="ghost" onClick={() => toggleConsent(consent.consent_category, 'grant')}>Grant again</Button>
                ) : null}
              </div>
            </div>
          )) : <p className="text-sm text-muted">No consent records have been recorded for this account.</p>}
        </div>
        <p className="text-sm text-muted mt-2">Terms of Use and Privacy Policy acceptance cannot be withdrawn while the account is active. Request deletion instead.</p>
      </div>

      <div className="grid grid-2 mt-4">
        <form className="card" onSubmit={submitRequest}>
          <h2 className="side-label">Make a privacy request</h2>
          <Field label="Request type">
            <Select value={requestForm.category} onChange={(e) => setRequestForm({ ...requestForm, category: e.target.value })}>
              {REQUEST_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="What are you asking for?">
            <Textarea rows={4} required minLength={10} maxLength={3000} value={requestForm.description} onChange={(e) => setRequestForm({ ...requestForm, description: e.target.value })} />
          </Field>
          {requestForm.category === 'correction' ? (
            <div className="card">
              <Field label="Field to correct"><Input required value={correction.field} onChange={(e) => setCorrection({ ...correction, field: e.target.value })} /></Field>
              <Field label="Current value"><Input value={correction.currentValue} onChange={(e) => setCorrection({ ...correction, currentValue: e.target.value })} /></Field>
              <Field label="Proposed correction"><Input required value={correction.proposedValue} onChange={(e) => setCorrection({ ...correction, proposedValue: e.target.value })} /></Field>
              <Field label="Explanation"><Textarea rows={2} value={correction.explanation} onChange={(e) => setCorrection({ ...correction, explanation: e.target.value })} /></Field>
            </div>
          ) : null}
          <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</Button>
          <p className="text-xs text-muted">Requests are reviewed. Deletion is not automatic where records must be retained for security or legal reasons.</p>
        </form>

        <div className="stack">
          <div className="card">
            <h2 className="side-label">My privacy requests</h2>
            {data.requests.length ? data.requests.map((row) => (
              <div key={row.reference} className="row-between text-sm">
                <span>{row.reference} · {row.category}</span>
                <Badge tone="info">{row.statusLabel}</Badge>
              </div>
            )) : <p className="text-sm text-muted">No privacy requests yet.</p>}
            <Link className="btn btn-ghost btn-sm" to="/dashboard/privacy/requests">Open privacy requests</Link>
          </div>

          <div className="card">
            <h2 className="side-label">Authorised sharing</h2>
            {sharing?.results?.length ? sharing.results.map((share) => (
              <div key={share.id} className="text-sm" style={{ marginBottom: '0.5rem' }}>
                <div className="row-between">
                  <strong>{share.document_title}</strong>
                  <Badge tone={share.revoked_at ? 'neutral' : 'info'}>{share.revoked_at ? 'Revoked' : 'Active'}</Badge>
                </div>
                <p className="text-muted">Shared with {share.recipient_label} for {share.purpose} · {fmtDateTime(share.consented_at)}</p>
                {share.revoked_at ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    onClick={async () => {
                      try {
                        await api.delete(`/account/privacy-center/sharing/${share.id}`)
                        toast.push('Sharing permission revoked.')
                        await load()
                      } catch (err) {
                        toast.push(err.message, 'error')
                      }
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            )) : <p className="text-sm text-muted">You have not shared a vault document.</p>}
            <p className="text-xs text-muted">{sharing?.note}</p>
          </div>

          <div className="card">
            <h2 className="side-label">Account status</h2>
            <p className="text-sm">Current status: <strong>{data.profile.accountStatus}</strong></p>
            {data.deactivation?.status === 'deactivated' ? (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await api.post('/account/privacy-center/reactivate', {})
                    toast.push('Account reactivated.')
                    await load()
                  } catch (err) {
                    toast.push(err.message, 'error')
                  }
                }}
              >
                Reactivate my account
              </Button>
            ) : (
              <Button
                variant="outline"
                icon={ShieldCheck}
                onClick={async () => {
                  try {
                    await api.post('/account/privacy-center/deactivate', { confirm: true, reason: 'Requested from privacy centre' })
                    toast.push('Account deactivated.')
                    await load()
                  } catch (err) {
                    toast.push(err.message, 'error')
                  }
                }}
              >
                Temporarily deactivate
              </Button>
            )}
            <p className="text-xs text-muted">Deactivation keeps your records and is not a deletion. Permanent deletion is a tracked request.</p>
          </div>
        </div>
      </div>

      <Alert tone="info" title="Legal review needed">{data.note}</Alert>
    </div>
  )
}
