import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  History,
  ImagePlus,
  Megaphone,
  Pencil,
  Plus,
  Send,
  Settings,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { api, fmtDate, fmtDateTime, query } from '../../api'
import { useApi, useDocumentTitle } from '../../hooks'
import { useAuth } from '../../auth'
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
  StatusBadge,
  Textarea,
  useToast,
} from '../../components/ui'
import { PageHeader } from '../../components/layout'

const TYPES = [
  { value: 'about', label: 'Municipality profile' },
  { value: 'news', label: 'News and updates' },
  { value: 'notice', label: 'Public notice' },
  { value: 'program', label: 'Program and initiative' },
  { value: 'project', label: 'Project' },
  { value: 'resource', label: 'Public resource' },
  { value: 'faq', label: 'Frequently asked question' },
  { value: 'contact', label: 'Contact information' },
]

const STATUS_ACTIONS = {
  draft: [{ status: 'submitted_for_review', label: 'Submit for review', icon: Send }],
  submitted_for_review: [
    { status: 'under_review', label: 'Start review', icon: Clock },
    { status: 'changes_requested', label: 'Request changes', icon: Pencil },
  ],
  under_review: [
    { status: 'approved', label: 'Approve', icon: CheckCircle2 },
    { status: 'changes_requested', label: 'Request changes', icon: Pencil },
    { status: 'rejected', label: 'Reject', icon: XIcon },
  ],
  changes_requested: [{ status: 'submitted_for_review', label: 'Resubmit', icon: Send }],
  approved: [{ status: 'published', label: 'Publish', icon: ShieldCheck }],
  published: [{ status: 'archived', label: 'Archive', icon: ArrowLeft }],
  rejected: [{ status: 'draft', label: 'Reopen as draft', icon: Pencil }],
}

function XIcon(props) {
  return <span aria-hidden="true" style={{ fontWeight: 700, lineHeight: 1 }}>×</span>
}

const EMPTY_FORM = {
  title: '',
  content_type: 'news',
  summary: '',
  body: '',
  featured_image: '',
  image_alt: '',
  image_credit: '',
  external_url: '',
  contact_details: '',
  source_reference: '',
  source_url: '',
  is_featured: false,
  pinned: false,
  priority: 'normal',
  starts_at: '',
  ends_at: '',
  event_start: '',
  event_end: '',
  venue: '',
  project_status: 'proposed',
  application_status: 'not_stated',
  eligibility: '',
  beneficiaries: '',
  office_id: '',
  progress_percent: '',
  progress_note: '',
  address: '',
  barangay: '',
  attachment_url: '',
  attachment_label: '',
}

function MetricCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="card stat-card">
      <div className="row" style={{ gap: '0.5rem' }}>
        <Icon size={16} aria-hidden="true" />
        <span className="text-xs text-muted">{label}</span>
      </div>
      <strong style={{ fontSize: 'var(--text-h3)' }}>{value}</strong>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  )
}

/* --------------------------- Content editor ------------------------------ */

function ContentEditor({ open, onClose, municipality, record, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setForm(
      record
        ? {
            ...EMPTY_FORM,
            ...Object.fromEntries(Object.entries(EMPTY_FORM).map(([key]) => [key, record[key] ?? ''])),
            is_featured: Boolean(record.is_featured),
            pinned: Boolean(record.pinned),
          }
        : EMPTY_FORM,
    )
  }, [open, record])

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const uploadImage = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const result = await api.postFile('/admin/media', file)
      set('featured_image', result.path)
      toast.push('Image uploaded. Add alt text before publishing.')
    } catch (err) {
      setError(err)
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const payload = { ...form, municipality_id: municipality.id }
      if (record) await api.patch(`/admin/municipal-content/${record.id}`, payload)
      else await api.post('/admin/municipal-content', payload)
      toast.push(record ? 'Municipal content saved.' : 'Draft created. Submit it for review when it is ready.')
      onSaved()
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const fieldError = (name) => error?.details?.find((detail) => detail.field === name)?.message

  return (
    <Modal open={open} onClose={onClose} title={record ? 'Edit municipal content' : 'New municipal content'} wide>
      <form onSubmit={save}>
        {error && !error.details?.length ? <Alert tone="error">{error.message}</Alert> : null}
        <div className="form-grid">
          <Field label="Title" htmlFor="mc-title" required error={fieldError('title')}>
            <Input id="mc-title" value={form.title} onChange={(event) => set('title', event.target.value)} required minLength={3} maxLength={200} />
          </Field>
          <Field label="Content type" htmlFor="mc-type" required>
            <Select id="mc-type" value={form.content_type} onChange={(event) => set('content_type', event.target.value)}>
              {TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Summary" htmlFor="mc-summary" help="Shown in lists and search results." error={fieldError('summary')}>
          <Textarea id="mc-summary" value={form.summary} onChange={(event) => set('summary', event.target.value)} maxLength={600} style={{ minHeight: 80 }} />
        </Field>
        <Field
          label="Content"
          htmlFor="mc-body"
          help="Supports simple Markdown: **bold**, *italic*, links and - lists."
          error={fieldError('body')}
        >
          <Textarea id="mc-body" value={form.body} onChange={(event) => set('body', event.target.value)} style={{ minHeight: 200 }} />
        </Field>
        <div className="form-grid">
          <Field label="Featured image URL" htmlFor="mc-image" error={fieldError('featured_image')}>
            <Input id="mc-image" value={form.featured_image} onChange={(event) => set('featured_image', event.target.value)} maxLength={500} placeholder="/uploads/media/…" />
          </Field>
          <Field label="Upload image" htmlFor="mc-upload" help="JPEG, PNG or WebP up to 12 MB. Alt text is required before publishing.">
            <label className="btn btn-outline btn-sm" htmlFor="mc-upload" style={{ cursor: 'pointer' }}>
              <Upload size={14} aria-hidden="true" /> {uploading ? 'Uploading…' : 'Choose image'}
            </label>
            <input id="mc-upload" type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadImage} style={{ display: 'none' }} />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Image alt text" htmlFor="mc-alt" help="Describe the image for screen-reader users.">
            <Input id="mc-alt" value={form.image_alt} onChange={(event) => set('image_alt', event.target.value)} maxLength={300} />
          </Field>
          <Field label="Image credit" htmlFor="mc-credit" help="Required for images that are not owned by the municipality.">
            <Input id="mc-credit" value={form.image_credit} onChange={(event) => set('image_credit', event.target.value)} maxLength={300} />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Source reference" htmlFor="mc-source" error={fieldError('source_reference')} help="Where the information came from.">
            <Input id="mc-source" value={form.source_reference} onChange={(event) => set('source_reference', event.target.value)} maxLength={500} />
          </Field>
          <Field label="Source URL" htmlFor="mc-source-url" error={fieldError('source_url')}>
            <Input id="mc-source-url" type="url" value={form.source_url} onChange={(event) => set('source_url', event.target.value)} maxLength={500} />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="External resource link" htmlFor="mc-external">
            <Input id="mc-external" type="url" value={form.external_url} onChange={(event) => set('external_url', event.target.value)} maxLength={500} />
          </Field>
          <Field label="Starts / ends" htmlFor="mc-starts" help="Optional validity window for notices and programs.">
            <div className="row">
              <Input id="mc-starts" type="date" value={form.starts_at} onChange={(event) => set('starts_at', event.target.value)} aria-label="Starts on" />
              <Input type="date" value={form.ends_at} onChange={(event) => set('ends_at', event.target.value)} aria-label="Ends on" />
            </div>
          </Field>
        </div>
        <Field label="Contact details (optional)" htmlFor="mc-contact" help="For contact blocks and program enquiries.">
          <Textarea id="mc-contact" value={form.contact_details} onChange={(event) => set('contact_details', event.target.value)} style={{ minHeight: 70 }} />
        </Field>

        <fieldset className="card" style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <legend className="text-sm"><strong>Publishing and prominence</strong></legend>
          <div className="form-grid">
            <Field label="Priority" htmlFor="mc-priority" help="Urgent and important records appear in the public advisory strip.">
              <Select id="mc-priority" value={form.priority} onChange={(event) => set('priority', event.target.value)}>
                <option value="normal">Normal</option>
                <option value="important">Important</option>
                <option value="urgent">Urgent</option>
              </Select>
            </Field>
            <Field label="Event or activity dates" htmlFor="mc-event-start" help="Only for dated activities. Shown as upcoming when in the future.">
              <div className="row">
                <Input id="mc-event-start" type="date" value={form.event_start} onChange={(event) => set('event_start', event.target.value)} aria-label="Event starts" />
                <Input type="date" value={form.event_end} onChange={(event) => set('event_end', event.target.value)} aria-label="Event ends" />
              </div>
            </Field>
          </div>
          <Field label="Venue" htmlFor="mc-venue">
            <Input id="mc-venue" value={form.venue} onChange={(event) => set('venue', event.target.value)} maxLength={300} />
          </Field>
        </fieldset>

        <fieldset className="card" style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <legend className="text-sm"><strong>Programs and projects</strong></legend>
          <div className="form-grid">
            <Field label="Project status" htmlFor="mc-project-status" help="Projects only. Choose what the responsible office has reported.">
              <Select id="mc-project-status" value={form.project_status} onChange={(event) => set('project_status', event.target.value)}>
                <option value="proposed">Proposed</option>
                <option value="planned">Planned</option>
                <option value="approved">Approved</option>
                <option value="scheduled">Scheduled</option>
                <option value="ongoing">Ongoing</option>
                <option value="suspended">Temporarily suspended</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
            <Field label="Application status" htmlFor="mc-application" help="Programs only. Never state that applications are open unless confirmed.">
              <Select id="mc-application" value={form.application_status} onChange={(event) => set('application_status', event.target.value)}>
                <option value="not_stated">Not published</option>
                <option value="open">Applications open</option>
                <option value="closed">Applications closed</option>
                <option value="by_office">Apply at the responsible office</option>
              </Select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Reported progress (%)" htmlFor="mc-progress" help="Optional. Leave blank when no verified progress figure exists.">
              <Input id="mc-progress" type="number" min="0" max="100" value={form.progress_percent} onChange={(event) => set('progress_percent', event.target.value)} />
            </Field>
            <Field label="Progress note" htmlFor="mc-progress-note" help="Attributed to the cited source in public views.">
              <Input id="mc-progress-note" value={form.progress_note} onChange={(event) => set('progress_note', event.target.value)} maxLength={4000} />
            </Field>
          </div>
          <Field label="Eligibility" htmlFor="mc-eligibility" help="Who may apply or participate, exactly as published by the source.">
            <Textarea id="mc-eligibility" value={form.eligibility} onChange={(event) => set('eligibility', event.target.value)} style={{ minHeight: 70 }} />
          </Field>
          <Field label="Intended beneficiaries" htmlFor="mc-beneficiaries">
            <Textarea id="mc-beneficiaries" value={form.beneficiaries} onChange={(event) => set('beneficiaries', event.target.value)} style={{ minHeight: 70 }} />
          </Field>
          <div className="form-grid">
            <Field label="Location" htmlFor="mc-address">
              <Input id="mc-address" value={form.address} onChange={(event) => set('address', event.target.value)} maxLength={300} />
            </Field>
            <Field label="Barangay (verified only)" htmlFor="mc-barangay">
              <Input id="mc-barangay" value={form.barangay} onChange={(event) => set('barangay', event.target.value)} maxLength={150} />
            </Field>
          </div>
        </fieldset>

        <div className="form-grid">
          <Field label="Public attachment URL" htmlFor="mc-attachment" help="Uploaded document or image, if any.">
            <Input id="mc-attachment" value={form.attachment_url} onChange={(event) => set('attachment_url', event.target.value)} maxLength={500} />
          </Field>
          <Field label="Attachment label" htmlFor="mc-attachment-label">
            <Input id="mc-attachment-label" value={form.attachment_label} onChange={(event) => set('attachment_label', event.target.value)} maxLength={200} />
          </Field>
        </div>

        <label className="checkbox-row" style={{ marginBottom: 'var(--space-3)' }}>
          <input type="checkbox" checked={form.is_featured} onChange={(event) => set('is_featured', event.target.checked)} />
          <span>Feature this record on the municipal portal homepage</span>
        </label>
        <label className="checkbox-row" style={{ marginBottom: 'var(--space-3)' }}>
          <input type="checkbox" checked={form.pinned} onChange={(event) => set('pinned', event.target.checked)} />
          <span>Pin this record to the top of its section</span>
        </label>
        <Alert tone="info">
          Saving keeps this record as a draft revision. It becomes public only after a reviewer approves it and a publisher publishes it.
        </Alert>
        <div className="row mt-4">
          <Button type="submit" loading={busy}>{record ? 'Save changes' : 'Create draft'}</Button>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  )
}

/* ------------------------------ Workspace -------------------------------- */

export function AdminMunicipalWorkspace() {
  const { id } = useParams()
  const toast = useToast()
  const { can } = useAuth()
  const { data, loading, error, reload } = useApi(`/admin/municipal-portals/${id}`)
  const [tab, setTab] = useState('overview')
  const [editor, setEditor] = useState({ open: false, record: null })
  const [revisions, setRevisions] = useState({ open: false, rows: [], record: null })
  const [settings, setSettings] = useState(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const municipality = data?.municipality
  useDocumentTitle(municipality ? `${municipality.name} portal workspace` : 'Municipal workspace')

  const { data: contentList, loading: contentLoading, reload: reloadContent } = useApi(
    municipality ? `/admin/municipal-content${query({ municipality: municipality.slug, limit: 50 })}` : null,
  )

  useEffect(() => {
    if (!municipality) return
    setSettings({
      portal_title: municipality.portal_title || '',
      portal_description: municipality.portal_description || '',
      description: municipality.description || '',
      overview: municipality.overview || '',
      geographic_info: municipality.geographic_info || '',
      population: municipality.population ?? '',
      cover_image: municipality.cover_image || '',
      logo: municipality.logo || '',
      official_website: municipality.official_website || '',
      email: municipality.email || '',
      phone: municipality.phone || '',
      office_address: municipality.office_address || '',
      office_hours: municipality.office_hours || '',
      source_reference: municipality.source_reference || '',
      source_url: municipality.source_url || '',
      verification_status: municipality.verification_status || 'pending',
      social_links: municipality.social_links || {},
    })
  }, [municipality])

  if (loading) return <div className="container section"><SkeletonList count={3} height={160} /></div>
  if (error || !municipality) {
    return (
      <div className="container section">
        <EmptyState
          icon={Building2}
          title="Municipal workspace not available"
          description="This municipality does not exist, or it is outside your assigned scope."
          action={<Link className="btn btn-primary" to="/dashboard">Back to dashboard</Link>}
        />
      </div>
    )
  }

  const metrics = data.metrics || {}
  const statuses = data.statuses || {}
  const types = data.types || {}
  const records = contentList?.results || []
  const pending = Number(statuses.submitted_for_review || 0) + Number(statuses.under_review || 0)

  const runStatus = async (record, status, label) => {
    try {
      await api.post(`/admin/municipal-content/${record.id}/status`, { status, note: label })
      toast.push(`Record moved to ${status.replace(/_/g, ' ')}.`)
      reload()
      reloadContent()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const openRevisions = async (record) => {
    try {
      const result = await api.get(`/admin/municipal-content/${record.id}/revisions`)
      setRevisions({ open: true, rows: result.results || [], record })
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const uploadPortalImage = async (event, key) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const result = await api.postFile('/admin/media', file)
      setSettings((current) => ({ ...current, [key]: result.path }))
      toast.push('Image uploaded. Save the settings to apply it.')
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      event.target.value = ''
    }
  }

  const saveSettings = async (event) => {
    event.preventDefault()
    setSavingSettings(true)
    try {
      await api.patch(`/admin/municipal-portals/${municipality.id}`, settings)
      toast.push('Portal settings saved.')
      reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setSavingSettings(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Municipal portal workspace"
        title={`${municipality.name} portal`}
        description={`Municipality-scoped workspace. You can only manage records that belong to ${municipality.name}.`}
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Municipalities', to: '/admin/municipalities' }, { label: municipality.name }]}
        actions={
          <>
            <Badge tone={municipality.publication_status === 'published' ? 'success' : 'warning'}>
              {String(municipality.publication_status).replace(/_/g, ' ')}
            </Badge>
            <Link className="btn btn-outline btn-sm" to={`/admin/municipalities/${municipality.id}/modules`}>
              <Settings size={14} aria-hidden="true" /> Offices, feedback & analytics
            </Link>
            <Link className="btn btn-outline btn-sm" to={`/municipalities/${municipality.slug}`}>
              <ExternalLink size={14} aria-hidden="true" /> View public portal
            </Link>
          </>
        }
      />

      <div className="container section-tight">
        <div className="tabs" role="tablist">
          {[
            ['overview', 'Overview'],
            ['content', 'Content'],
            ['settings', 'Portal settings'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className="tab"
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'overview' ? (
          <>
            <div className="grid grid-4 mt-4">
              <MetricCard icon={Megaphone} label="Published announcements" value={metrics.announced ?? 0} />
              <MetricCard icon={FileText} label="Published content" value={metrics.content ?? 0} hint={`${pending} awaiting review`} />
              <MetricCard icon={Building2} label="Public offices" value={metrics.offices ?? 0} />
              <MetricCard icon={ShieldCheck} label="Published services" value={metrics.services ?? 0} />
            </div>

            <div className="grid mt-4" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', alignItems: 'start' }}>
              <div className="card">
                <div className="row-between">
                  <h2 style={{ fontSize: 'var(--text-h4)' }}>Recent content</h2>
                  {can('municipal.content.create') ? (
                    <Button size="sm" icon={Plus} onClick={() => setEditor({ open: true, record: null })}>New content</Button>
                  ) : null}
                </div>
                {data.recentContent.length ? (
                  <div className="table-wrap mt-3">
                    <table className="data">
                      <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Updated</th></tr></thead>
                      <tbody>
                        {data.recentContent.map((row) => (
                          <tr key={row.id}>
                            <td>{row.title}</td>
                            <td>{String(row.content_type).replace(/_/g, ' ')}</td>
                            <td><StatusBadge status={row.publication_status} /></td>
                            <td>{fmtDate(row.updated_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted mt-3">No municipal content has been created yet. Published municipal information stays empty until content passes review.</p>
                )}
              </div>

              <div className="stack">
                <div className="card">
                  <h2 style={{ fontSize: 'var(--text-h4)' }}>Content by type</h2>
                  <ul className="link-list mt-2 text-sm">
                    {TYPES.map((type) => (
                      <li key={type.value} className="row-between">
                        <span>{type.label}</span>
                        <strong>{types[type.value] || 0}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="card">
                  <h2 style={{ fontSize: 'var(--text-h4)' }}>Recent activity</h2>
                  {data.activity.length ? (
                    <ul className="link-list mt-2 text-sm">
                      {data.activity.map((entry) => (
                        <li key={entry.id}>
                          <span>{String(entry.action).replace(/[._]/g, ' ')}</span>
                          <span className="text-xs text-muted">{entry.actor || 'system'} · {fmtDateTime(entry.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted mt-2">No recorded municipal administrative activity yet.</p>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}

        {tab === 'content' ? (
          <div className="card mt-4">
            <div className="row-between">
              <div>
                <h2 style={{ fontSize: 'var(--text-h4)' }}>Municipal content</h2>
                <p className="help">Drafts, submissions and published records for {municipality.name} only.</p>
              </div>
              {can('municipal.content.create') ? (
                <Button size="sm" icon={Plus} onClick={() => setEditor({ open: true, record: null })}>New content</Button>
              ) : null}
            </div>

            {contentLoading ? (
              <SkeletonList count={3} />
            ) : records.length ? (
              <div className="table-wrap mt-3">
                <table className="data">
                  <thead>
                    <tr><th>Title</th><th>Type</th><th>Status</th><th>Verification</th><th>Updated</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record.id}>
                        <td>{record.title}</td>
                        <td>{String(record.content_type).replace(/_/g, ' ')}</td>
                        <td><StatusBadge status={record.publication_status} /></td>
                        <td>{String(record.verification_status).replace(/_/g, ' ')}</td>
                        <td>{fmtDate(record.updated_at)}</td>
                        <td>
                          <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
                            {can('municipal.content.update') ? (
                              <Button size="sm" variant="outline" icon={Pencil} onClick={() => setEditor({ open: true, record })}>Edit</Button>
                            ) : null}
                            {(STATUS_ACTIONS[record.publication_status] || [])
                              .filter((action) => {
                                if (action.status === 'published') return can('municipal.content.publish')
                                if (action.status === 'archived') return can('municipal.content.archive')
                                if (['approved', 'rejected', 'under_review', 'changes_requested'].includes(action.status)) {
                                  return can('municipal.content.review')
                                }
                                return true
                              })
                              .map((action) => (
                                <Button
                                  key={action.status}
                                  size="sm"
                                  variant="ghost"
                                  icon={action.icon}
                                  onClick={() => runStatus(record, action.status, action.label)}
                                >
                                  {action.label}
                                </Button>
                              ))}
                            <Button size="sm" variant="ghost" icon={History} onClick={() => openRevisions(record)}>History</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={FileText}
                title="No municipal content yet"
                description="Create a draft, then submit it for review. Content becomes public only after approval and publication."
                action={can('municipal.content.create') ? <Button icon={Plus} onClick={() => setEditor({ open: true, record: null })}>Create the first draft</Button> : null}
              />
            )}
          </div>
        ) : null}

        {tab === 'settings' && settings ? (
          <form className="card mt-4" onSubmit={saveSettings}>
            <h2 style={{ fontSize: 'var(--text-h4)' }}>Portal settings</h2>
            <p className="help">
              Settings affect the public portal. Do not add officials, contact details, population figures or logos unless you have a
              verified source and the right to publish them.
            </p>
            <div className="form-grid">
              <Field label="Portal display name" htmlFor="mp-title">
                <Input id="mp-title" value={settings.portal_title} onChange={(event) => setSettings({ ...settings, portal_title: event.target.value })} maxLength={120} />
              </Field>
              <Field label="Portal tagline" htmlFor="mp-tagline" help="One short line under the municipality name.">
                <Input id="mp-tagline" value={settings.portal_description} onChange={(event) => setSettings({ ...settings, portal_description: event.target.value })} maxLength={600} />
              </Field>
            </div>
            <Field label="Short description" htmlFor="mp-description">
              <Textarea id="mp-description" value={settings.description} onChange={(event) => setSettings({ ...settings, description: event.target.value })} maxLength={600} style={{ minHeight: 70 }} />
            </Field>
            <Field label="Municipality overview" htmlFor="mp-overview" help="Shown on the portal homepage and the About page.">
              <Textarea id="mp-overview" value={settings.overview} onChange={(event) => setSettings({ ...settings, overview: event.target.value })} style={{ minHeight: 140 }} />
            </Field>
            <Field label="Geographic information" htmlFor="mp-geo" help="Only publish sourced geographic facts.">
              <Textarea id="mp-geo" value={settings.geographic_info} onChange={(event) => setSettings({ ...settings, geographic_info: event.target.value })} style={{ minHeight: 90 }} />
            </Field>
            <div className="form-grid">
              <Field label="Cover image URL" htmlFor="mp-cover">
                <Input id="mp-cover" value={settings.cover_image} onChange={(event) => setSettings({ ...settings, cover_image: event.target.value })} maxLength={500} />
              </Field>
              <Field label="Upload cover image" htmlFor="mp-cover-upload" help="JPEG, PNG or WebP. Use an image you are allowed to publish.">
                <label className="btn btn-outline btn-sm" htmlFor="mp-cover-upload" style={{ cursor: 'pointer' }}>
                  <ImagePlus size={14} aria-hidden="true" /> Choose image
                </label>
                <input id="mp-cover-upload" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => uploadPortalImage(event, 'cover_image')} style={{ display: 'none' }} />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Approved logo URL" htmlFor="mp-logo" help="Only upload a seal or logo you have permission to use.">
                <Input id="mp-logo" value={settings.logo} onChange={(event) => setSettings({ ...settings, logo: event.target.value })} maxLength={500} />
              </Field>
              <Field label="Upload approved logo" htmlFor="mp-logo-upload">
                <label className="btn btn-outline btn-sm" htmlFor="mp-logo-upload" style={{ cursor: 'pointer' }}>
                  <ImagePlus size={14} aria-hidden="true" /> Choose image
                </label>
                <input id="mp-logo-upload" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => uploadPortalImage(event, 'logo')} style={{ display: 'none' }} />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Official website" htmlFor="mp-website" help="Only when you have verified the address.">
                <Input id="mp-website" type="url" value={settings.official_website} onChange={(event) => setSettings({ ...settings, official_website: event.target.value })} />
              </Field>
              <Field label="Population" htmlFor="mp-population" help="Include the source reference below.">
                <Input id="mp-population" type="number" min="0" value={settings.population} onChange={(event) => setSettings({ ...settings, population: event.target.value })} />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Office address" htmlFor="mp-address">
                <Input id="mp-address" value={settings.office_address} onChange={(event) => setSettings({ ...settings, office_address: event.target.value })} maxLength={300} />
              </Field>
              <Field label="Office hours" htmlFor="mp-hours">
                <Input id="mp-hours" value={settings.office_hours} onChange={(event) => setSettings({ ...settings, office_hours: event.target.value })} maxLength={200} />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Public telephone" htmlFor="mp-phone">
                <Input id="mp-phone" value={settings.phone} onChange={(event) => setSettings({ ...settings, phone: event.target.value })} maxLength={40} />
              </Field>
              <Field label="Public email" htmlFor="mp-email">
                <Input id="mp-email" type="email" value={settings.email} onChange={(event) => setSettings({ ...settings, email: event.target.value })} maxLength={200} />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Facebook page" htmlFor="mp-facebook">
                <Input id="mp-facebook" type="url" value={settings.social_links.facebook || ''} onChange={(event) => setSettings({ ...settings, social_links: { ...settings.social_links, facebook: event.target.value } })} />
              </Field>
              <Field label="YouTube channel" htmlFor="mp-youtube">
                <Input id="mp-youtube" type="url" value={settings.social_links.youtube || ''} onChange={(event) => setSettings({ ...settings, social_links: { ...settings.social_links, youtube: event.target.value } })} />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Source reference" htmlFor="mp-source" help="Required before a record can be marked verified.">
                <Input id="mp-source" value={settings.source_reference} onChange={(event) => setSettings({ ...settings, source_reference: event.target.value })} maxLength={500} />
              </Field>
              <Field label="Source URL" htmlFor="mp-source-url">
                <Input id="mp-source-url" type="url" value={settings.source_url} onChange={(event) => setSettings({ ...settings, source_url: event.target.value })} />
              </Field>
            </div>
            {can('municipal.portal.manage') ? (
              <Field label="Verification status" htmlFor="mp-verification" help="Only mark verified when the source above has been checked.">
                <Select id="mp-verification" value={settings.verification_status} onChange={(event) => setSettings({ ...settings, verification_status: event.target.value })}>
                  <option value="pending">Pending verification</option>
                  <option value="verified">Verified against a recorded source</option>
                  <option value="needs_update">Needs updating</option>
                  <option value="unverified">Not verified</option>
                </Select>
              </Field>
            ) : null}
            <Alert tone="warning" title="No unverified data">
              Saving settings updates the public portal immediately. Changes to the verification status are recorded in the audit log.
            </Alert>
            <div className="row mt-3">
              <Button type="submit" loading={savingSettings} icon={Settings}>Save portal settings</Button>
              <Link className="btn btn-outline" to={`/municipalities/${municipality.slug}`}>Preview public portal</Link>
            </div>
          </form>
        ) : null}
      </div>

      <ContentEditor
        open={editor.open}
        record={editor.record}
        municipality={municipality}
        onClose={() => setEditor({ open: false, record: null })}
        onSaved={() => {
          reload()
          reloadContent()
        }}
      />

      <Modal open={revisions.open} onClose={() => setRevisions({ open: false, rows: [], record: null })} title={`Version history — ${revisions.record?.title || ''}`}>
        {revisions.rows.length ? (
          <ol className="step-list">
            {revisions.rows.map((row) => (
              <li key={row.id}>
                <span className="step-num" aria-hidden="true">{row.id}</span>
                <div className="text-sm">
                  <strong>{row.change_summary || 'Updated'}</strong>
                  <div className="text-xs text-muted">{row.created_by_name || 'system'} · {fmtDateTime(row.created_at)}</div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">No saved versions yet. A version is recorded each time the record is saved or moved through the workflow.</p>
        )}
      </Modal>
    </>
  )
}

export default AdminMunicipalWorkspace
