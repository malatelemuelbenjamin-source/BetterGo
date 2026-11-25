import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

export function AdminPersonalization() {
  useDocumentTitle('Accessibility and inclusive services')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [drafts, setDrafts] = useState({})

  const load = async () => {
    try {
      const result = await api.get('/admin/personalization')
      setData(result)
      setDrafts(Object.fromEntries(result.services.map((service) => [service.id, { features: service.features, notes: service.notes || '' }])))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (service) => {
    const draft = drafts[service.id]
    try {
      const result = await api.put(`/admin/personalization/services/${service.id}`, {
        accessibilityFeatures: draft.features,
        accessibilityNotes: draft.notes,
      })
      toast.push(result.message)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Accessibility and inclusive services"
        description="Record accessibility information only from the responsible office's own source."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Accessibility and inclusive services' }]}
      />
      <Alert tone="info" title="Aggregate and self-declared">{data?.note || 'Loading records.'}</Alert>

      {!data ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="grid grid-3">
            <div className="card"><div className="side-label">Accounts with declared needs</div><strong>{data.summary.accountsWithDeclaredNeeds}</strong></div>
            <div className="card"><div className="side-label">Published services</div><strong>{data.summary.publishedServices}</strong></div>
            <div className="card"><div className="side-label">Missing accessibility info</div><strong>{data.summary.missingAccessibilityInfo}</strong></div>
          </div>

          <div className="card">
            <h2 className="side-label">Declared needs (aggregate)</h2>
            {Object.entries(data.needCounts).map(([key, count]) => (
              <div key={key} className="row-between text-sm"><span>{data.needs[key]}</span><span>{count}</span></div>
            ))}
          </div>

          <div className="card">
            <h2 className="side-label">Published service accessibility information</h2>
            {data.services.map((service) => {
              const draft = drafts[service.id] || { features: [], notes: '' }
              return (
                <div key={service.id} className="stack-tight">
                  <div className="row-between">
                    <strong>{service.title}</strong>
                    {service.verificationStatus === 'verified' ? <Badge tone="success">office-confirmed</Badge> : <Badge tone="warning">not office-confirmed</Badge>}
                  </div>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    {Object.entries(data.features).map(([value, label]) => (
                      <label key={value} className="row text-xs">
                        <input
                          type="checkbox"
                          checked={draft.features.includes(value)}
                          onChange={(e) => setDrafts({
                            ...drafts,
                            [service.id]: {
                              ...draft,
                              features: e.target.checked ? [...draft.features, value] : draft.features.filter((entry) => entry !== value),
                            },
                          })}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <Textarea
                    rows={2}
                    value={draft.notes}
                    placeholder="What exactly does the office provide, and according to which source?"
                    onChange={(e) => setDrafts({ ...drafts, [service.id]: { ...draft, notes: e.target.value } })}
                  />
                  <Button size="sm" variant="outline" onClick={() => save(service)}>Save accessibility information</Button>
                </div>
              )
            })}
            {!data.services.length ? <p className="text-sm text-muted">No published services in your scope.</p> : null}
          </div>
        </>
      )}
    </div>
  )
}
