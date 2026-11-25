import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

const empty = { title: '', summary: '', requirements: '', fees: '', procedure: '', notes: '', source: '', status: 'draft' }

export function AdminTranslations() {
  useDocumentTitle('Language access')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState('')
  const [form, setForm] = useState(empty)

  const load = async () => {
    try {
      const result = await api.get('/admin/translations')
      setData(result)
      if (!selected && result.services[0]) setSelected(String(result.services[0].id))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const service = data?.services.find((entry) => String(entry.id) === selected)
    setForm(service?.translation ? { ...empty, ...service.translation } : empty)
  }, [selected, data])

  const decide = async (row, decision) => {
    const note = window.prompt(decision === 'completed' ? 'What was confirmed?' : 'Why is this not available?') || ''
    try {
      const result = await api.post(`/admin/translations/requests/${row.id}/decision`, { decision, note })
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
        title="Language access"
        description="Publish Filipino readings and respond to translation requests truthfully."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Language access' }]}
      />
      <Alert tone="info" title="Never label a reading aid as official">{data?.note || 'Loading records.'}</Alert>

      {!data ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="card">
            <h2 className="side-label">Service translation</h2>
            <Field label="Published service">
              <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
                {data.services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.title} {service.translationStatus ? `(${service.translationStatus})` : '(no translation)'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Filipino title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Summary"><Textarea rows={2} value={form.summary || ''} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></Field>
            <Field label="Requirements"><Textarea rows={2} value={form.requirements || ''} onChange={(e) => setForm({ ...form, requirements: e.target.value })} /></Field>
            <Field label="Fees"><Input value={form.fees || ''} onChange={(e) => setForm({ ...form, fees: e.target.value })} /></Field>
            <Field label="Procedure"><Textarea rows={2} value={form.procedure || ''} onChange={(e) => setForm({ ...form, procedure: e.target.value })} /></Field>
            <Field label="Source (office document, page or staff confirmation)"><Input value={form.source || ''} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="draft">BetterGo reading aid (not office-confirmed)</option>
                <option value="office_confirmed">Confirmed by the responsible office</option>
              </Select>
            </Field>
            <Button
              disabled={!selected || form.title.trim().length < 3}
              onClick={async () => {
                try {
                  const result = await api.put(`/admin/translations/services/${selected}`, { ...form, title: form.title.trim() })
                  toast.push(result.message)
                  await load()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Save translation
            </Button>
          </div>

          <div className="card">
            <h2 className="side-label">Translation requests</h2>
            {data.requests.length ? data.requests.map((request) => (
              <div key={request.id} className="stack-tight">
                <div className="row-between">
                  <strong>{request.reference} · {request.serviceTitle}</strong>
                  <Badge tone={request.status === 'completed' ? 'success' : request.status === 'pending' ? 'warning' : 'neutral'}>{request.statusLabel}</Badge>
                </div>
                <span className="text-xs text-muted">{request.citizenName} · {request.languageLabel} · {request.createdAt?.slice(0, 10)}</span>
                {request.note ? <span className="text-xs text-muted">Citizen note: {request.note}</span> : null}
                {request.responseNote ? <span className="text-xs text-muted">Response: {request.responseNote}</span> : null}
                {request.status === 'pending' ? (
                  <div className="row">
                    <Button size="sm" onClick={() => decide(request, 'completed')}>Mark completed</Button>
                    <Button size="sm" variant="outline" onClick={() => decide(request, 'declined')}>Decline</Button>
                  </div>
                ) : null}
              </div>
            )) : <p className="text-sm text-muted">No translation requests in your scope.</p>}
          </div>
        </>
      )}
    </div>
  )
}
