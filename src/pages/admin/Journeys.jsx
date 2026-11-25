import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Field, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

const toText = (steps = []) => steps.map((step) => [step.title, step.description || '', step.stepType || 'preparation'].join(' | ')).join('\n')

export function AdminJourneys() {
  useDocumentTitle('Service journey templates')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState('')
  const [form, setForm] = useState({ title: '', notes: '', status: 'draft', steps: '' })

  const load = async () => {
    try {
      const result = await api.get('/admin/service-journeys')
      setData(result)
      if (!selected && result.templates[0]) setSelected(String(result.templates[0].serviceId))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const entry = data?.templates.find((row) => String(row.serviceId) === selected)
    if (!entry) return
    setForm({
      title: entry.template?.title || `Prepare for ${entry.serviceTitle}`,
      notes: entry.template?.notes || '',
      status: entry.template?.status || 'draft',
      steps: toText(entry.template?.steps),
    })
  }, [selected, data])

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Service journey templates"
        description="Prepare guidance from published service information. Never decide eligibility or read citizen notes."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Service journey templates' }]}
      />
      <Alert tone="info" title="Preparation only">{data?.note || 'Loading templates.'}</Alert>

      {!data ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="grid grid-4">
            <div className="card"><div className="side-label">Published services</div><strong>{data.summary.publishedServices}</strong></div>
            <div className="card"><div className="side-label">With published templates</div><strong>{data.summary.withTemplates}</strong></div>
            <div className="card"><div className="side-label">Active journeys</div><strong>{data.summary.activeJourneys}</strong></div>
            <div className="card"><div className="side-label">Affected by service changes</div><strong>{data.summary.journeysAffectedByChanges}</strong></div>
          </div>

          <div className="card">
            <h2 className="side-label">Template editor</h2>
            <Field label="Published service">
              <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
                {data.templates.map((row) => (
                  <option key={row.serviceId} value={row.serviceId}>
                    {row.serviceTitle} {row.template ? `(v${row.template.version}, ${row.template.statusLabel})` : '(no template)'} {row.changedJourneys ? `· ${row.changedJourneys} affected` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Template title"><Textarea rows={1} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Notes for staff"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <Field label="Steps (one per line: title | description | step type)">
              <Textarea rows={6} value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} placeholder="Gather barangay clearance | Bring the original and one copy | document" />
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {Object.entries(data.templateStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <Button
              disabled={!selected || form.title.trim().length < 3 || !form.steps.trim()}
              onClick={async () => {
                const steps = form.steps.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
                  const [title, description, stepType] = line.split('|').map((part) => part.trim())
                  return { title, description, stepType: data.stepTypes[stepType] ? stepType : 'preparation' }
                })
                try {
                  const result = await api.put(`/admin/service-journeys/services/${selected}`, { ...form, steps })
                  toast.push(result.message)
                  await load()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Save template
            </Button>
            {data.templates.filter((row) => row.changedJourneys > 0).length ? (
              <div className="stack-tight">
                <h3 className="side-label">Services changed since journeys started</h3>
                {data.templates.filter((row) => row.changedJourneys > 0).map((row) => (
                  <div key={row.serviceId} className="row-between text-sm">
                    <span>{row.serviceTitle}</span>
                    <Badge tone="warning">{row.changedJourneys} affected</Badge>
                  </div>
                ))}
                <p className="text-xs text-muted">Citizens see a review prompt. Completed tasks are never overwritten.</p>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
