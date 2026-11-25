import { useEffect, useState } from 'react'
import { Download, Trash2, UserX } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, Field, SkeletonList, Textarea, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'


export default function PortabilityPage() {
  useDocumentTitle('Your data and account closure')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState([])
  const [reason, setReason] = useState('')

  const load = async () => {
    try {
      const result = await api.get('/account/portability')
      setData(result)
      if (!selected.length) setSelected(Object.keys(result.categories))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="section-tight"><SkeletonList count={3} height={70} /></div>

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Your data and account closure"
        description="Take a copy of your own BetterGo records, and ask for the account to be closed."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Your data and account closure' }]}
      />
      <Alert tone="info" title="BetterGo records only">{data.note}</Alert>

      <div className="card">
        <h2 className="side-label">Choose what to export</h2>
        {Object.entries(data.categories).map(([key, label]) => (
          <label key={key} className="row text-sm">
            <input
              type="checkbox"
              checked={selected.includes(key)}
              onChange={(e) => setSelected(e.target.checked ? [...selected, key] : selected.filter((entry) => entry !== key))}
            />
            {label}
          </label>
        ))}
        <p className="text-xs text-muted">Exports expire after {data.retentionDays} days and can only be downloaded while signed in to this account.</p>
        <Button
          icon={Download}
          disabled={!selected.length}
          onClick={async () => {
            try {
              const result = await api.post('/account/exports', { categories: selected, format: 'json' })
              toast.push(result.message)
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Create export
        </Button>

        <div className="stack-tight">
          <h3 className="side-label">What is excluded</h3>
          <ul className="text-xs text-muted">
            {data.exclusions.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p className="text-xs text-muted">{data.limitations.join(' ')}</p>
        </div>

        {data.exports.length ? data.exports.map((entry) => (
          <div key={entry.id} className="stack-tight">
            <div className="row-between">
              <strong>{entry.reference}</strong>
              <Badge tone={entry.status === 'completed' ? 'success' : entry.status === 'failed' ? 'warning' : 'neutral'}>{entry.statusLabel}</Badge>
            </div>
            <span className="text-xs text-muted">
              Created {entry.createdAt?.slice(0, 16)} · expires {entry.expiresAt?.slice(0, 10)} · {entry.categoryLabels.join(', ')}
            </span>
            {entry.errorReason ? <span className="text-xs text-muted">{entry.errorReason}</span> : null}
            {entry.status === 'completed' ? (
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <a className="btn btn-outline btn-sm" href={`/api/account/exports/${entry.id}`}>Download JSON</a>
                <a className="btn btn-outline btn-sm" href={`/api/account/exports/${entry.id}?format=readme`}>README</a>
                {entry.categories.map((category) => (
                  <a key={category} className="btn btn-ghost btn-sm" href={`/api/account/exports/${entry.id}?format=csv&section=${category}`}>
                    {category} CSV
                  </a>
                ))}
              </div>
            ) : null}
            {['completed', 'failed', 'queued'].includes(entry.status) ? (
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                onClick={async () => {
                  try {
                    const result = await api.del(`/account/exports/${entry.id}`)
                    toast.push(result.message)
                    await load()
                  } catch (err) {
                    toast.push(err.message, 'error')
                  }
                }}
              >
                Cancel and remove contents
              </Button>
            ) : null}
          </div>
        )) : <p className="text-sm text-muted">No exports yet.</p>}
      </div>

      <div className="card">
        <h2 className="side-label">Request account closure</h2>
        <Alert tone="warning" title="Nothing is deleted immediately">{data.closureNote}</Alert>
        {data.closure ? (
          <div className="stack-tight">
            <div className="row-between">
              <strong>{data.closure.reference}</strong>
              <Badge tone={data.closure.status === 'approved' ? 'warning' : data.closure.status === 'pending_review' ? 'info' : 'neutral'}>{data.closure.statusLabel}</Badge>
            </div>
            <span className="text-xs text-muted">Requested {data.closure.requestedAt?.slice(0, 10)}</span>
            {data.closure.reason ? <span className="text-xs text-muted">Your reason: {data.closure.reason}</span> : null}
            {data.closure.reviewNote ? <span className="text-xs text-muted">Review note: {data.closure.reviewNote}</span> : null}
            {data.closure.status === 'pending_review' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const result = await api.post(`/account/closure-requests/${data.closure.id}/cancel`, {})
                    toast.push(result.message)
                    await load()
                  } catch (err) {
                    toast.push(err.message, 'error')
                  }
                }}
              >
                Cancel closure request
              </Button>
            ) : null}
          </div>
        ) : null}
        {!data.closure || data.closure.status !== 'pending_review' ? (
          <>
            <Field label="Why do you want to close the account? (optional)">
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button
              variant="outline"
              icon={UserX}
              onClick={async () => {
                try {
                  const result = await api.post('/account/closure-requests', { reason: reason || undefined })
                  toast.push(result.message)
                  setReason('')
                  await load()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Request account closure
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}
