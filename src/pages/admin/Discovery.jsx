import { useEffect, useState } from 'react'
import { Compass, Plus } from 'lucide-react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

export function AdminDiscovery() {
  useDocumentTitle('Service discovery settings')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [link, setLink] = useState({ serviceId: '', relatedServiceId: '', relationship: 'related', note: '' })
  const [question, setQuestion] = useState({ key: '', label: '', options: '' })

  const load = async () => {
    try {
      setData(await api.get('/admin/discovery'))
      setAnalytics(await api.get('/admin/discovery/analytics').catch(() => null))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addRelationship = async (event) => {
    event.preventDefault()
    try {
      await api.post('/admin/discovery/relationships', { ...link, serviceId: Number(link.serviceId), relatedServiceId: Number(link.relatedServiceId) })
      toast.push('Relationship saved.')
      setLink({ serviceId: '', relatedServiceId: '', relationship: 'related', note: '' })
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const addQuestion = async (event) => {
    event.preventDefault()
    try {
      await api.post('/admin/discovery/questions', {
        key: question.key,
        label: question.label,
        options: question.options.split(',').map((part) => part.trim()).filter(Boolean).map((value) => ({ value, label: value })),
      })
      toast.push('Finder question created.')
      setQuestion({ key: '', label: '', options: '' })
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Service discovery settings"
        description="Configure related services and finder questions. There is no paid placement or hidden ranking."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Service discovery' }]}
      />

      {!data ? <SkeletonList count={3} height={60} /> : (
        <div className="stack">
          <Alert tone="info" title="Editorial only">{data.note}</Alert>

          <div className="grid grid-2">
            <form className="card" onSubmit={addRelationship}>
              <h2 className="side-label">Related service</h2>
              <Field label="Service ID"><Input value={link.serviceId} onChange={(e) => setLink({ ...link, serviceId: e.target.value })} required inputMode="numeric" /></Field>
              <Field label="Related service ID"><Input value={link.relatedServiceId} onChange={(e) => setLink({ ...link, relatedServiceId: e.target.value })} required inputMode="numeric" /></Field>
              <Field label="Relationship">
                <Select value={link.relationship} onChange={(e) => setLink({ ...link, relationship: e.target.value })}>
                  <option value="related">Related service</option>
                  <option value="journey_next">Next step in a guide</option>
                  <option value="same_office">Same responsible office</option>
                </Select>
              </Field>
              <Field label="Note (optional)"><Input value={link.note} onChange={(e) => setLink({ ...link, note: e.target.value })} /></Field>
              <Button type="submit" icon={Plus}>Save relationship</Button>
            </form>

            <form className="card" onSubmit={addQuestion}>
              <h2 className="side-label">Finder question</h2>
              <Field label="Key"><Input value={question.key} onChange={(e) => setQuestion({ ...question, key: e.target.value })} required placeholder="e.g. concern" /></Field>
              <Field label="Question"><Input value={question.label} onChange={(e) => setQuestion({ ...question, label: e.target.value })} required /></Field>
              <Field label="Options (comma separated)"><Input value={question.options} onChange={(e) => setQuestion({ ...question, options: e.target.value })} required /></Field>
              <Button type="submit" icon={Compass}>Create question</Button>
            </form>
          </div>

          <div className="card">
            <h2 className="side-label">Configured relationships</h2>
            {data.relationships.length ? data.relationships.map((row) => (
              <div className="row-between text-sm" key={row.id}>
                <span>{row.service_title} → {row.related_title} <Badge tone="neutral">{row.relationship}</Badge></span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await api.delete(`/admin/discovery/relationships/${row.id}`)
                      await load()
                    } catch (err) {
                      toast.push(err.message, 'error')
                    }
                  }}
                >
                  Remove
                </Button>
              </div>
            )) : <p className="text-sm text-muted">No relationships configured.</p>}
          </div>

          <div className="card">
            <h2 className="side-label">Finder questions</h2>
            {data.questions.length ? data.questions.map((row) => <div key={row.id} className="text-sm">{row.label} <span className="text-muted">({row.question_key})</span></div>) : <p className="text-sm text-muted">No custom questions: the default category, municipality and preference questions are used.</p>}
          </div>

          {analytics ? (
            <div className="card">
              <h2 className="side-label">Aggregated activity</h2>
              <div className="grid grid-3">
                <div className="stat-card"><span className="stat-label">Service views</span><div className="stat-value">{analytics.totals.serviceViews}</div></div>
                <div className="stat-card"><span className="stat-label">Saved services</span><div className="stat-value">{analytics.totals.savedServices}</div></div>
                <div className="stat-card"><span className="stat-label">Relationships</span><div className="stat-value">{analytics.totals.recommendationsConfigured}</div></div>
              </div>
              <p className="text-sm text-muted">{analytics.note}</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
