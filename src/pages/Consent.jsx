import { useEffect, useState } from 'react'
import { PenLine, X } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

export default function ConsentPage() {
  useDocumentTitle('Consent and signatures')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [signature, setSignature] = useState({ statement: 'data_accuracy', signerName: '', subjectReference: '', agree: false })
  const [authorization, setAuthorization] = useState({ recipientName: '', recipientOrganization: '', purpose: '', categories: [], expiresAt: '' })

  const load = async () => {
    try {
      setData(await api.get('/account/consent'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setConsent = async (category, status) => {
    try {
      const result = await api.post(`/account/consent/${category}`, { status })
      toast.push(result.message)
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
        title="Consent and signatures"
        description="Review what you agreed to, authorize a named recipient, and record a typed-name signature."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Consent and signatures' }]}
      />
      <Alert tone="info" title="Platform records, not government records">{data.note}</Alert>

      <div className="card">
        <h2 className="side-label">Your consent choices</h2>
        <p className="text-xs text-muted">Current policy version: {data.policyVersion}</p>
        {data.catalog.map((category) => (
          <div key={category.key} className="row-between" style={{ alignItems: 'flex-start' }}>
            <div>
              <strong>{category.label}</strong>
              {category.required ? <span className="text-xs text-muted"> · required</span> : null}
              <p className="text-xs text-muted">{category.description}</p>
            </div>
            <div className="row">
              <Badge tone={category.status === 'granted' ? 'success' : category.status === 'withdrawn' ? 'warning' : 'neutral'}>{category.status.replace('_', ' ')}</Badge>
              {category.required ? (
                <span className="text-xs text-muted">Cannot be withdrawn while the account is active</span>
              ) : category.status === 'granted' ? (
                <Button size="sm" variant="ghost" onClick={() => setConsent(category.key, 'withdrawn')}>Withdraw</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setConsent(category.key, 'granted')}>Grant</Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="side-label">Record a typed-name signature</h2>
        <p className="text-xs text-muted">{data.signatureNote}</p>
        <Field label="What are you confirming?">
          <Select value={signature.statement} onChange={(e) => setSignature({ ...signature, statement: e.target.value })}>
            {Object.entries(data.statements).map(([value, entry]) => <option key={value} value={value}>{entry.label}</option>)}
          </Select>
        </Field>
        <p className="text-sm text-muted">{data.statements[signature.statement]?.text}</p>
        <Field label="Type your full name as it appears on your account">
          <Input value={signature.signerName} onChange={(e) => setSignature({ ...signature, signerName: e.target.value })} />
        </Field>
        <Field label="Related reference (optional)">
          <Input value={signature.subjectReference} onChange={(e) => setSignature({ ...signature, subjectReference: e.target.value })} placeholder="BG-DOC-…" />
        </Field>
        <label className="row text-sm">
          <input type="checkbox" checked={signature.agree} onChange={(e) => setSignature({ ...signature, agree: e.target.checked })} />
          I have read the statement and confirm it is mine.
        </label>
        <Button
          icon={PenLine}
          disabled={!signature.agree}
          onClick={async () => {
            try {
              const result = await api.post('/account/consent/signatures', {
                statement: signature.statement,
                signerName: signature.signerName,
                subjectReference: signature.subjectReference || undefined,
                agree: true,
              })
              toast.push(result.message)
              setSignature({ statement: signature.statement, signerName: '', subjectReference: '', agree: false })
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Record signature
        </Button>

        {data.signatures.length ? data.signatures.map((row) => (
          <div key={row.id} className="stack-tight">
            <div className="row-between">
              <strong>{row.reference} · {row.statementLabel}</strong>
              <Badge tone={row.status === 'recorded' ? 'success' : 'neutral'}>{row.status}</Badge>
            </div>
            <span className="text-xs text-muted">Signed {row.createdAt?.slice(0, 10)} · hash {row.contentHash.slice(0, 12)}…</span>
            {row.acknowledgedAt ? <span className="text-xs text-muted">Acknowledged by an office as received, not identity-verified.</span> : null}
            {row.status === 'recorded' ? (
              <Button
                size="sm"
                variant="ghost"
                icon={X}
                onClick={async () => {
                  try {
                    const result = await api.post(`/account/consent/signatures/${row.id}/revoke`, {})
                    toast.push(result.message)
                    await load()
                  } catch (err) {
                    toast.push(err.message, 'error')
                  }
                }}
              >
                Withdraw signature
              </Button>
            ) : null}
          </div>
        )) : <p className="text-sm text-muted">No signature records.</p>}
      </div>

      <div className="card">
        <h2 className="side-label">Authorize a named recipient</h2>
        <p className="text-xs text-muted">This records your instruction only. BetterGo does not send your records anywhere automatically.</p>
        <div className="grid grid-2">
          <Field label="Recipient name"><Input value={authorization.recipientName} onChange={(e) => setAuthorization({ ...authorization, recipientName: e.target.value })} /></Field>
          <Field label="Office or organization"><Input value={authorization.recipientOrganization} onChange={(e) => setAuthorization({ ...authorization, recipientOrganization: e.target.value })} /></Field>
        </div>
        <Field label="Purpose"><Input value={authorization.purpose} onChange={(e) => setAuthorization({ ...authorization, purpose: e.target.value })} placeholder="Why should they receive these records?" /></Field>
        <Field label="Expires on (optional)"><Input type="date" value={authorization.expiresAt} onChange={(e) => setAuthorization({ ...authorization, expiresAt: e.target.value })} /></Field>
        <fieldset>
          <legend className="field-label">Records covered</legend>
          {Object.entries(data.shareCategories).map(([value, label]) => (
            <label key={value} className="row text-sm">
              <input
                type="checkbox"
                checked={authorization.categories.includes(value)}
                onChange={(e) => setAuthorization({ ...authorization, categories: e.target.checked ? [...authorization.categories, value] : authorization.categories.filter((entry) => entry !== value) })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <Button
          onClick={async () => {
            try {
              const result = await api.post('/account/consent/authorizations', {
                ...authorization,
                expiresAt: authorization.expiresAt || undefined,
              })
              toast.push(result.message)
              setAuthorization({ recipientName: '', recipientOrganization: '', purpose: '', categories: [], expiresAt: '' })
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Record authorization
        </Button>

        {data.authorizations.length ? data.authorizations.map((row) => (
          <div key={row.id} className="stack-tight">
            <div className="row-between">
              <strong>{row.reference} · {row.recipientName}</strong>
              <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>{row.status}</Badge>
            </div>
            <span className="text-xs text-muted">{row.recipientOrganization} · {row.categoryLabels.join(' · ')}</span>
            <span className="text-xs text-muted">{row.purpose}</span>
            {row.status === 'active' ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    const result = await api.post(`/account/consent/authorizations/${row.id}/revoke`, {})
                    toast.push(result.message)
                    await load()
                  } catch (err) {
                    toast.push(err.message, 'error')
                  }
                }}
              >
                Revoke authorization
              </Button>
            ) : null}
          </div>
        )) : <p className="text-sm text-muted">No authorizations recorded.</p>}
      </div>
    </div>
  )
}
