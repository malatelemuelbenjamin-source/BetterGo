import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Copy, Plus, Save, Send, Trash2 } from 'lucide-react'
import { api, fmtDateTime } from '../../api'
import { useApi, useDocumentTitle } from '../../hooks'
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  SkeletonList,
  Textarea,
  useToast,
} from '../../components/ui'
import { PageHeader } from '../../components/layout'

const FIELD_TYPES = [
  ['short_text', 'Short text'],
  ['long_text', 'Long text'],
  ['number', 'Number'],
  ['date', 'Date'],
  ['select', 'Dropdown'],
  ['multiselect', 'Multiple selection'],
  ['radio', 'Radio buttons'],
  ['checkbox', 'Checkboxes'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['address', 'Address'],
  ['file', 'Private file (vault)'],
  ['consent', 'Consent checkbox'],
  ['heading', 'Section heading'],
  ['info', 'Informational text'],
]

const blankField = () => ({
  fieldKey: `field_${Math.random().toString(36).slice(2, 7)}`,
  label: '',
  fieldType: 'short_text',
  required: false,
  section: '',
  description: '',
  placeholder: '',
  optionsText: '',
  conditionalKey: '',
  conditionalEquals: '',
})

const toPayloadFields = (fields) =>
  fields.map((field) => ({
    fieldKey: field.fieldKey,
    label: field.label || 'Untitled field',
    fieldType: field.fieldType,
    required: field.required,
    section: field.section || null,
    description: field.description || null,
    placeholder: field.placeholder || null,
    options: field.optionsText
      ? field.optionsText.split(',').map((value) => value.trim()).filter(Boolean).map((value) => ({ value, label: value }))
      : [],
    conditional: field.conditionalKey && field.conditionalEquals ? { fieldKey: field.conditionalKey, equals: field.conditionalEquals } : null,
  }))

const fromApiFields = (fields = []) =>
  fields.map((field) => ({
    fieldKey: field.fieldKey,
    label: field.label,
    fieldType: field.fieldType,
    required: Boolean(field.required),
    section: field.section || '',
    description: field.description || '',
    placeholder: field.placeholder || '',
    optionsText: (field.options || []).map((option) => option.value).join(', '),
    conditionalKey: field.conditional?.fieldKey || '',
    conditionalEquals: field.conditional?.equals || '',
  }))

export function AdminForms() {
  useDocumentTitle('Digital forms')
  const { data, loading, reload } = useApi('/admin/forms')
  const [services, setServices] = useState([])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ serviceId: '', title: '', description: '', classification: 'bettergo_intake' })
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/admin/forms/services').then((result) => setServices(result.results || [])).catch(() => {})
  }, [])

  const create = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await api.post('/admin/forms', {
        serviceId: form.serviceId,
        title: form.title,
        description: form.description,
        submissionClassification: form.classification,
      })
      toast.push('Draft form created.')
      navigate(`/admin/forms/${result.id}`)
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const results = data?.results || []

  return (
    <div>
      <PageHeader
        title="Digital forms"
        description="Service-linked BetterGo intake forms. Nothing is filed with a government office; a published form records intake inside BetterGo only."
        actions={<Button icon={Plus} onClick={() => setCreating(true)}>New form</Button>}
      />

      {loading ? (
        <SkeletonList count={3} height={90} />
      ) : results.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Form</th><th>Service</th><th>Status</th><th>Fields</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr key={row.id}>
                  <td><Link to={`/admin/forms/${row.id}`}>{row.title}</Link></td>
                  <td>{row.service_title}</td>
                  <td><Badge tone={row.status === 'published' ? 'success' : row.status === 'archived' ? 'neutral' : 'info'}>{data.statuses?.[row.status] || row.status}</Badge></td>
                  <td>{row.field_count}</td>
                  <td className="nowrap">{fmtDateTime(row.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={Plus}
          title="No forms yet"
          description="Create a BetterGo intake form for an existing service. It stays a draft until it is reviewed and published."
          action={<Button onClick={() => setCreating(true)}>Create the first form</Button>}
        />
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New form" actions={<><Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={create} loading={busy}>Create draft</Button></>}>
        <form onSubmit={create}>
          <Field label="Service" htmlFor="form-service" required>
            <Select id="form-service" value={form.serviceId} onChange={(event) => setForm({ ...form, serviceId: event.target.value })}>
              <option value="">Choose a service…</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.title}{service.publication_status === 'published' ? '' : ` (${service.publication_status})`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Form title" htmlFor="form-title" required>
            <Input id="form-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={160} required />
          </Field>
          <Field label="Description" htmlFor="form-description">
            <Textarea id="form-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={1000} style={{ minHeight: 70 }} />
          </Field>
          <Field label="Submission classification" htmlFor="form-classification" help="BetterGo intake records answers inside BetterGo only. Information-only forms cannot be submitted.">
            <Select id="form-classification" value={form.classification} onChange={(event) => setForm({ ...form, classification: event.target.value })}>
              <option value="bettergo_intake">BetterGo citizen intake</option>
              <option value="information_only">Information only</option>
            </Select>
          </Field>
        </form>
      </Modal>

      <p className="help mt-4">No form is transmitted to an LGU. A BetterGo reference is not an official government transaction number.</p>
    </div>
  )
}

export function AdminFormEditor() {
  const { id } = useParams()
  const toast = useToast()
  const { data, loading, error, reload } = useApi(`/admin/forms/${id}`)
  const [meta, setMeta] = useState(null)
  const [fields, setFields] = useState([])
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  useDocumentTitle(data?.form?.title || 'Form editor')

  useEffect(() => {
    if (!data?.form) return
    setMeta({
      title: data.form.title,
      description: data.form.description || '',
      instructions: data.form.instructions || '',
      privacyNotice: data.form.privacyNotice || '',
      privacyNoticeVersion: data.form.privacyNoticeVersion || 'v1',
      audience: data.form.audience || '',
      submissionClassification: data.form.submissionClassification,
    })
    setFields(fromApiFields(data.form.fields))
  }, [data])

  if (loading || !meta) return <SkeletonList count={3} height={140} />
  if (error) return <Alert tone="error">{error.message}</Alert>

  const form = data.form
  const editable = ['draft', 'changes_requested'].includes(form.status)

  const run = async (path, body, success) => {
    setBusy(true)
    try {
      await api.post(`/admin/forms/${id}/${path}`, body || {})
      toast.push(success)
      await reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      await api.put(`/admin/forms/${id}`, { ...meta, fields: toPayloadFields(fields) })
      toast.push('Form saved.')
      await reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const updateField = (index, patch) => {
    setFields((current) => current.map((field, position) => (position === index ? { ...field, ...patch } : field)))
  }

  const moveField = (index, delta) => {
    setFields((current) => {
      const next = [...current]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      const swap = next[index]
      next[index] = next[target]
      next[target] = swap
      return next
    })
  }

  return (
    <div>
      <PageHeader
        title={form.title}
        description={`${form.serviceTitle || 'Service'} · version ${form.version} · ${form.statusLabel || form.status}`}
        breadcrumbs={[{ label: 'Digital forms', to: '/admin/forms' }, { label: form.title }]}
        actions={
          <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
            <Button variant="outline" icon={Copy} onClick={() => run('duplicate', {}, 'Form duplicated as a new draft.')} loading={busy}>Duplicate</Button>
            <Button variant="outline" onClick={() => setPreview((value) => !value)}>{preview ? 'Edit fields' : 'Preview'}</Button>
          </div>
        }
      />

      <Alert tone="info" title="BetterGo intake only">
        Published forms collect information inside BetterGo. They are not official government applications and are never transmitted to an office
        automatically.
      </Alert>

      <div className="grid grid-2 mt-4" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Form details</h2>
          <Field label="Title" htmlFor="meta-title">
            <Input id="meta-title" value={meta.title} onChange={(event) => setMeta({ ...meta, title: event.target.value })} disabled={!editable} maxLength={160} />
          </Field>
          <Field label="Description" htmlFor="meta-description">
            <Textarea id="meta-description" value={meta.description} onChange={(event) => setMeta({ ...meta, description: event.target.value })} disabled={!editable} maxLength={1000} style={{ minHeight: 70 }} />
          </Field>
          <Field label="Instructions" htmlFor="meta-instructions">
            <Textarea id="meta-instructions" value={meta.instructions} onChange={(event) => setMeta({ ...meta, instructions: event.target.value })} disabled={!editable} maxLength={4000} style={{ minHeight: 70 }} />
          </Field>
          <Field label="Privacy notice" htmlFor="meta-privacy" help="Shown before submission. The version is stored with every submission.">
            <Textarea id="meta-privacy" value={meta.privacyNotice} onChange={(event) => setMeta({ ...meta, privacyNotice: event.target.value })} disabled={!editable} maxLength={4000} style={{ minHeight: 70 }} />
          </Field>
          <Field label="Notice version" htmlFor="meta-version">
            <Input id="meta-version" value={meta.privacyNoticeVersion} onChange={(event) => setMeta({ ...meta, privacyNoticeVersion: event.target.value })} disabled={!editable} maxLength={20} />
          </Field>
          <Field label="Intended audience" htmlFor="meta-audience">
            <Input id="meta-audience" value={meta.audience} onChange={(event) => setMeta({ ...meta, audience: event.target.value })} disabled={!editable} maxLength={300} />
          </Field>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Workflow</h2>
          <p className="text-sm text-muted">Status: <strong>{form.statusLabel || form.status}</strong></p>
          <div className="stack-sm mt-3">
            {editable ? <Button variant="outline" icon={Save} onClick={save} loading={busy}>Save draft</Button> : null}
            {editable ? <Button variant="outline" icon={Send} onClick={() => run('submit-review', {}, 'Sent for review.')} loading={busy}>Submit for review</Button> : null}
            {form.status === 'in_review' ? (
              <>
                <Button onClick={() => run('approve', {}, 'Form approved.')} loading={busy}>Approve</Button>
                <Button variant="ghost" onClick={() => run('request-changes', {}, 'Changes requested.')} loading={busy}>Request changes</Button>
              </>
            ) : null}
            {form.status === 'approved' ? <Button onClick={() => run('publish', {}, 'Form published.')} loading={busy}>Publish</Button> : null}
            {form.status !== 'archived' ? <Button variant="ghost" onClick={() => run('archive', {}, 'Form archived.')} loading={busy}>Archive</Button> : null}
          </div>
          <p className="help mt-3">
            A form you created must be published by a second reviewer unless you hold province-wide permissions.
          </p>
          {form.status === 'published' ? (
            <p className="mt-3"><Link to={`/apply/${form.serviceSlug}`}>Open the citizen form</Link></p>
          ) : null}
        </div>
      </div>

      <div className="card mt-4">
        <div className="row-between">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Fields</h2>
          {editable ? <Button size="sm" variant="outline" icon={Plus} onClick={() => setFields((current) => [...current, blankField()])}>Add field</Button> : null}
        </div>

        {preview ? (
          <div className="mt-3">
            <p className="help">Preview of the citizen layout. No data is collected here.</p>
            {fields.map((field) => (
              <Field key={field.fieldKey} label={field.label || 'Untitled field'} required={field.required} help={field.description}>
                {['heading', 'info'].includes(field.fieldType) ? (
                  <p className="text-sm text-muted">{field.fieldType === 'heading' ? 'Section heading' : field.description}</p>
                ) : ['select', 'radio', 'multiselect', 'checkbox'].includes(field.fieldType) ? (
                  <Select disabled><option>Choose…</option></Select>
                ) : (
                  <Input disabled placeholder={field.placeholder} />
                )}
              </Field>
            ))}
          </div>
        ) : fields.length ? (
          <div className="stack mt-3">
            {fields.map((field, index) => (
              <div className="field-editor" key={field.fieldKey}>
                <div className="row-between">
                  <strong>Field {index + 1}</strong>
                  {editable ? (
                    <span className="row" style={{ gap: '0.2rem' }}>
                      <button type="button" className="icon-btn" onClick={() => moveField(index, -1)} disabled={index === 0} aria-label="Move field up">↑</button>
                      <button type="button" className="icon-btn" onClick={() => moveField(index, 1)} disabled={index === fields.length - 1} aria-label="Move field down">↓</button>
                      <button type="button" className="icon-btn" onClick={() => setFields((current) => current.filter((_, position) => position !== index))} aria-label="Remove field"><Trash2 size={13} /></button>
                    </span>
                  ) : null}
                </div>
                <div className="form-grid">
                  <Field label="Label" htmlFor={`label-${index}`}>
                    <Input id={`label-${index}`} value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} disabled={!editable} maxLength={160} />
                  </Field>
                  <Field label="Key" htmlFor={`key-${index}`} help="Lowercase letters, numbers and underscores.">
                    <Input id={`key-${index}`} value={field.fieldKey} onChange={(event) => updateField(index, { fieldKey: event.target.value })} disabled={!editable} maxLength={50} />
                  </Field>
                  <Field label="Type" htmlFor={`type-${index}`}>
                    <Select id={`type-${index}`} value={field.fieldType} onChange={(event) => updateField(index, { fieldType: event.target.value })} disabled={!editable}>
                      {FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Section" htmlFor={`section-${index}`}>
                    <Input id={`section-${index}`} value={field.section} onChange={(event) => updateField(index, { section: event.target.value })} disabled={!editable} maxLength={120} />
                  </Field>
                  <Field label="Choices (comma separated)" htmlFor={`options-${index}`}>
                    <Input id={`options-${index}`} value={field.optionsText} onChange={(event) => updateField(index, { optionsText: event.target.value })} disabled={!editable} />
                  </Field>
                  <Field label="Conditional on" htmlFor={`cond-${index}`} help="Show only when another field equals a value.">
                    <div className="row" style={{ gap: '0.35rem' }}>
                      <Input id={`cond-${index}`} value={field.conditionalKey} onChange={(event) => updateField(index, { conditionalKey: event.target.value })} disabled={!editable} placeholder="field_key" maxLength={50} />
                      <Input value={field.conditionalEquals} onChange={(event) => updateField(index, { conditionalEquals: event.target.value })} disabled={!editable} placeholder="value" maxLength={80} aria-label="Conditional value" />
                    </div>
                  </Field>
                  <Field label="Description" htmlFor={`desc-${index}`}>
                    <Input id={`desc-${index}`} value={field.description} onChange={(event) => updateField(index, { description: event.target.value })} disabled={!editable} maxLength={400} />
                  </Field>
                  <Field label="Placeholder" htmlFor={`ph-${index}`}>
                    <Input id={`ph-${index}`} value={field.placeholder} onChange={(event) => updateField(index, { placeholder: event.target.value })} disabled={!editable} maxLength={160} />
                  </Field>
                </div>
                <label className="check-row">
                  <input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} disabled={!editable} />
                  <span>Required</span>
                </label>
              </div>
            ))}
            {editable ? <div><Button icon={Save} onClick={save} loading={busy}>Save all changes</Button></div> : null}
          </div>
        ) : (
          <EmptyState icon={Plus} title="No fields yet" description="Add the information this form should collect." action={editable ? <Button onClick={() => setFields([blankField()])}>Add the first field</Button> : null} />
        )}
      </div>

      <p className="help mt-4">
        Hidden conditional fields are never required. Answers are validated on the server, and only documents from a citizen's private vault can be
        attached.
      </p>
      <Link className="btn btn-ghost mt-3" to="/admin/forms"><ArrowLeft size={14} /> All forms</Link>
    </div>
  )
}
