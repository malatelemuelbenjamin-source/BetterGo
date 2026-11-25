import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

const TONES = { verified: 'success', reviewed_by_office: 'success', pending: 'warning', unverified: 'neutral', unavailable: 'neutral', not_reviewed: 'neutral', rejected: 'danger', cancelled: 'neutral' }

export default function IdentityPage() {
  useDocumentTitle('Identity and trust')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [form, setForm] = useState({ type: 'resident', municipalityId: '', note: '' })

  const load = async () => {
    try {
      setData(await api.get('/account/identity'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="section-tight"><SkeletonList count={4} height={70} /></div>

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Identity and trust"
        description="See what BetterGo has actually verified and request an office review where supported."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Identity and trust' }]}
      />
      <Alert tone="info" title="What verification means here">{data.note}</Alert>

      <div className="grid grid-3">
        <div className="card">
          <h2 className="side-label">Email address</h2>
          <Badge tone={TONES[data.trust.email]}>{data.trust.email === 'verified' ? 'Verified' : 'Not verified'}</Badge>
          <p className="text-xs text-muted">Used for sign-in and important account notices.</p>
        </div>
        <div className="card">
          <h2 className="side-label">Mobile number</h2>
          <Badge tone={TONES[data.trust.phone]}>{data.trust.phone === 'unavailable' ? 'Verification unavailable' : data.account.phoneVerified ? 'Verified' : 'Not verified'}</Badge>
          <p className="text-xs text-muted">{data.smsAvailable ? 'An SMS provider is configured.' : 'No SMS provider is configured, so BetterGo does not offer pretend code verification.'}</p>
        </div>
        <div className="card">
          <h2 className="side-label">Resident review</h2>
          <Badge tone={TONES[data.trust.resident]}>{data.trust.resident === 'reviewed_by_office' ? 'Reviewed by office' : 'Not reviewed'}</Badge>
          <p className="text-xs text-muted">Requires an actual office review recorded by authorized staff.</p>
        </div>
      </div>

      <div className="card">
        <h2 className="side-label">Request a review</h2>
        <p className="text-xs text-muted">Never submit ID numbers or ID photos in BetterGo. The responsible office reviews residency in person or through its own verified process.</p>
        <Field label="Type">
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {Object.entries(data.types).map(([value, label]) => <option key={value} value={value} disabled={value === 'phone' && !data.smsAvailable}>{label}</option>)}
          </Select>
        </Field>
        <Field label="Municipality ID (optional)"><Input value={form.municipalityId} onChange={(e) => setForm({ ...form, municipalityId: e.target.value })} inputMode="numeric" /></Field>
        <Field label="Note (optional)"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        <Button
          icon={ShieldCheck}
          onClick={async () => {
            try {
              const result = await api.post('/account/identity/requests', {
                type: form.type,
                municipalityId: form.municipalityId ? Number(form.municipalityId) : undefined,
                note: form.note,
              })
              toast.push(result.message)
              setForm({ type: 'resident', municipalityId: '', note: '' })
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Submit review request
        </Button>
      </div>

      {data.verifications.length ? (
        <div className="card">
          <h2 className="side-label">Review history</h2>
          {data.verifications.map((row) => (
            <div key={row.id} className="stack-tight">
              <div className="row-between">
                <strong>{row.typeLabel} · {row.reference}</strong>
                <Badge tone={TONES[row.status]}>{row.statusLabel}</Badge>
              </div>
              {row.officeNote ? <p className="text-sm text-muted">Office note: {row.officeNote}</p> : null}
              {row.status === 'pending' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await api.post(`/account/identity/requests/${row.id}/cancel`, {})
                      await load()
                    } catch (err) {
                      toast.push(err.message, 'error')
                    }
                  }}
                >
                  Cancel request
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {data.recentSecurityEvents.length ? (
        <div className="card">
          <h2 className="side-label">Recent account security activity</h2>
          {data.recentSecurityEvents.map((event, index) => <div key={index} className="text-sm">{event.created_at?.slice(0, 16)} · {event.event_type.replaceAll('_', ' ')}</div>)}
        </div>
      ) : null}
    </div>
  )
}
