import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ClipboardList, FileCheck2 } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Field, Input, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

const ITEM_LABELS = {
  not_started: 'Not started',
  preparing: 'Preparing',
  ready: 'Ready',
  unavailable: 'I cannot get this',
  not_applicable: 'Not applicable to me',
}

function Checklist({ data, reload }) {
  const toast = useToast()
  const [notes, setNotes] = useState({})
  const [reminder, setReminder] = useState({ remindAt: '', message: '' })

  const update = async (item, changes) => {
    try {
      await api.patch(`/account/assistance/plans/${data.plan.id}/items/${item.id}`, changes)
      await reload()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="row-between">
          <h2 className="side-label">Your private checklist</h2>
          <Badge tone="info">{data.plan.progress.percent}% prepared</Badge>
        </div>
        <p className="text-sm text-muted">
          {data.plan.progress.ready} of {data.plan.progress.mandatory} required items ready. This is your own preparation progress, not an official assessment.
        </p>
        {data.plan.items.map((item) => (
          <div key={item.id} className="checklist-item">
            <div className="row-between">
              <label htmlFor={`item-${item.id}`}>
                <strong>{item.label}</strong> {item.mandatory ? <Badge tone="warning">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
              </label>
              <Select
                id={`item-${item.id}`}
                value={item.status}
                onChange={(e) => update(item, { status: e.target.value })}
                aria-label={`Status for ${item.label}`}
              >
                {Object.entries(ITEM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </div>
            <div className="row">
              <Input
                aria-label={`Private note for ${item.label}`}
                placeholder="Private note (optional)"
                value={notes[item.id] ?? item.note ?? ''}
                onChange={(e) => setNotes({ ...notes, [item.id]: e.target.value })}
              />
              <Button size="sm" variant="ghost" onClick={() => update(item, { note: notes[item.id] ?? item.note ?? '' })}>Save note</Button>
              <Select
                aria-label={`Vault document for ${item.label}`}
                value={item.document_id || ''}
                onChange={(e) => update(item, { documentId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Link a vault document</option>
                {data.documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}
              </Select>
            </div>
            {item.document_id ? <span className="text-xs text-muted">Linked to your vault. Nothing was sent to an office.</span> : null}
          </div>
        ))}
        <div className="row">
          <Button variant="outline" onClick={async () => { await api.post(`/account/assistance/plans/${data.plan.id}/reset`); await reload() }}>Reset progress</Button>
          <Button variant="ghost" onClick={async () => { await api.delete(`/account/assistance/plans/${data.plan.id}`); await reload() }}>Delete plan</Button>
        </div>
      </div>

      <div className="card">
        <h2 className="side-label">Personal reminders</h2>
        <p className="text-xs text-muted">Reminders are yours alone and are not official government deadlines.</p>
        <div className="row">
          <Input type="date" value={reminder.remindAt} onChange={(e) => setReminder({ ...reminder, remindAt: e.target.value })} aria-label="Reminder date" />
          <Input value={reminder.message} onChange={(e) => setReminder({ ...reminder, message: e.target.value })} placeholder="Message (optional)" aria-label="Reminder message" />
          <Button
            size="sm"
            onClick={async () => {
              try {
                await api.post(`/account/assistance/plans/${data.plan.id}/reminders`, reminder)
                setReminder({ remindAt: '', message: '' })
                await reload()
              } catch (err) {
                toast.push(err.message, 'error')
              }
            }}
          >
            Add reminder
          </Button>
        </div>
        {data.reminders.map((entry) => (
          <div className="row-between text-sm" key={entry.id}>
            <span>{entry.remind_at} · {entry.message || 'Prepare documents'}</span>
            <Button size="sm" variant="ghost" onClick={async () => { await api.delete(`/account/assistance/plans/${data.plan.id}/reminders/${entry.id}`); await reload() }}>Remove</Button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AssistancePage() {
  useDocumentTitle('Application assistance')
  const { slug } = useParams()
  const toast = useToast()
  const [overview, setOverview] = useState(null)
  const [data, setData] = useState(null)

  const loadOverview = async () => {
    try {
      setOverview(await api.get('/account/assistance'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }
  const loadDetail = async (value) => {
    try {
      setData(await api.get(`/account/assistance/${value}`))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { loadOverview() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (slug) loadDetail(slug); else setData(null) }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!overview) return <div className="section-tight"><SkeletonList count={4} height={70} /></div>

  if (slug) {
    if (!data) return <div className="section-tight"><SkeletonList count={3} height={90} /></div>
    return (
      <div className="section-tight">
        <PageHeader
          eyebrow="Application assistance"
          title={data.service.title}
          description={data.service.summary}
          breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Application assistance', to: '/dashboard/assistance' }, { label: data.service.title }]}
        />
        <Alert tone="info" title="Requirements checker">{data.notice}</Alert>
        <div className="grid grid-2">
          <div className="card">
            <h2 className="side-label">Document requirements</h2>
            {data.requirements.length ? data.requirements.map((requirement) => (
              <div key={requirement.id} className="stack-tight">
                <div className="row-between">
                  <strong>{requirement.name}</strong>
                  <Badge tone={requirement.reviewStatus === 'approved' ? 'success' : 'warning'}>{requirement.label}</Badge>
                </div>
                {requirement.description ? <p className="text-sm text-muted">{requirement.description}</p> : null}
                {requirement.issuingOffice ? <p className="text-xs text-muted">Issuing office recorded: {requirement.issuingOffice}</p> : null}
                {requirement.verifiedAt ? <p className="text-xs text-muted">Reviewed {requirement.verifiedAt.slice(0, 10)}</p> : null}
                {requirement.sourceUrl ? <a className="text-xs" href={requirement.sourceUrl} rel="noreferrer noopener" target="_blank">Recorded source</a> : null}
              </div>
            )) : <p className="text-sm text-muted">No verified requirements are recorded for this service. Confirm with the responsible office before travelling.</p>}
          </div>
          <div className="card">
            <h2 className="side-label">Recorded procedure</h2>
            {data.procedures.length ? data.procedures.map((step) => (
              <div key={step.step_number} className="stack-tight">
                <strong>Step {step.step_number}: {step.title}</strong>
                {step.description ? <p className="text-sm text-muted">{step.description}</p> : null}
                {step.office ? <span className="text-xs text-muted">{step.office}{step.location ? ` · ${step.location}` : ''}</span> : null}
              </div>
            )) : <p className="text-sm text-muted">No procedure steps are recorded. BetterGo does not invent steps.</p>}
            {data.faqs.length ? <><h3 className="side-label">Questions</h3>{data.faqs.map((faq) => <details key={faq.question}><summary>{faq.question}</summary><p className="text-sm text-muted">{faq.answer}</p></details>)}</> : null}
          </div>
        </div>

        {data.plan ? <Checklist data={data} reload={() => loadDetail(slug)} /> : (
          <div className="card">
            <h2 className="side-label">Prepare with a private checklist</h2>
            <p className="text-sm text-muted">Create a checklist from the recorded requirements, track your progress and link files already in your vault.</p>
            <Button
              icon={ClipboardList}
              onClick={async () => {
                try {
                  await api.post(`/account/assistance/${slug}/plan`)
                  await loadDetail(slug)
                  await loadOverview()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Create preparation checklist
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Application assistance"
        description="Check recorded requirements, follow procedure steps and prepare your documents at your own pace."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Application assistance' }]}
      />
      <Alert tone="info" title="Independent preparation aid">{overview.note}</Alert>
      {overview.plans.length ? (
        <div className="card">
          <h2 className="side-label">Your preparation plans</h2>
          {overview.plans.map((plan) => (
            <div key={plan.id} className="row-between">
              <Link to={`/dashboard/assistance/${plan.slug}`}>{plan.title}</Link>
              <span className="text-sm text-muted">{plan.progress.percent}% prepared</span>
            </div>
          ))}
        </div>
      ) : null}
      <h2 className="side-label">Services with recorded requirements</h2>
      {overview.services.length ? (
        <div className="grid grid-2">
          {overview.services.map((service) => (
            <div className="card" key={service.id}>
              <Link to={`/dashboard/assistance/${service.slug}`}><strong>{service.title}</strong></Link>
              <p className="text-sm text-muted">{service.short_description}</p>
              <div className="card-meta">
                {service.municipality_name ? <span>{service.municipality_name}</span> : <span>Province-wide record</span>}
                <span>{service.requirement_count} recorded requirements</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={FileCheck2} title="No recorded requirements yet" description="Services appear here once their offices' requirements are recorded. Missing information never means a service is unavailable." />
      )}
    </div>
  )
}
