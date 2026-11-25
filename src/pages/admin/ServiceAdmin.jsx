import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  FolderTree,
  History,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
} from 'lucide-react'
import { api, fmtDate, fmtPeso, query } from '../../api'
import { useApi, useDocumentTitle } from '../../hooks'
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  SkeletonList,
  StatusBadge,
  Tabs,
  Textarea,
  useToast,
} from '../../components/ui'
import { PageHeader } from '../../components/layout'
import { ServiceStatusBadge, ServiceVerificationBadge, CategoryIcon } from '../../components/services'
import { useAuth } from '../../auth'

import {
  AVAILABILITY_OPTIONS as AVAILABILITY,
  SCOPE_OPTIONS as SCOPES,
  SERVICE_TRANSITIONS as TRANSITIONS,
  VERIFICATION_OPTIONS as VERIFICATION,
} from '../../lib/serviceMeta'

const SERVICE_FIELDS = [
  ['title', 'Service name', 'text', true],
  ['category_id', 'Category', 'category'],
  ['office_id', 'Responsible office', 'office'],
  ['municipality_id', 'Primary municipality', 'municipality'],
  ['service_type', 'Service type', 'text'],
  ['service_scope', 'Coverage scope', 'scope'],
  ['availability_status', 'Availability', 'availability'],
  ['short_description', 'Short description (card text)', 'textarea'],
  ['description', 'Description', 'textarea'],
  ['full_description', 'Full description', 'textarea'],
  ['eligibility', 'Who can apply', 'textarea'],
  ['application_mode', 'Application mode (e.g. walk-in, online)', 'text'],
  ['official_link', 'Official application link', 'url'],
  ['payment_instructions', 'Payment instructions', 'textarea'],
  ['source_reference', 'Source reference', 'text'],
  ['source_url', 'Source URL', 'url'],
  ['next_review_at', 'Next review date', 'date'],
]

/* ========================================================================== */
export function AdminServiceDashboard({ initialTab = 'services' }) {
  useDocumentTitle('Service management')
  const [tab, setTab] = useState(initialTab)
  const { data: analytics } = useApi('/admin/services/analytics')
  return (
    <>
      <PageHeader
        eyebrow="Phase 2 · Government services"
        title="Service management"
        description="Manage service records, the 25-category hierarchy, official sources, verification, citizen feedback and imports."
        breadcrumbs={[{ label: 'Administration', to: '/admin' }, { label: 'Service management' }]}
      />
      <div className="container section-tight">
        <div className="grid grid-4" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="card stat-card"><span className="stat-label">Published</span><span className="stat-value">{analytics?.totals?.published ?? '—'}</span></div>
          <div className="card stat-card"><span className="stat-label">In review</span><span className="stat-value">{analytics?.totals?.review ?? '—'}</span></div>
          <div className="card stat-card"><span className="stat-label">Verified</span><span className="stat-value">{analytics?.totals?.verified ?? '—'}</span></div>
          <div className="card stat-card"><span className="stat-label">Needs attention</span><span className="stat-value">{analytics?.totals?.needs_update ?? '—'}</span></div>
        </div>

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'services', label: 'Services' },
            { value: 'categories', label: 'Categories' },
            { value: 'verification', label: 'Sources & verification' },
            { value: 'feedback', label: 'Citizen feedback' },
            { value: 'import', label: 'Import & export' },
            { value: 'analytics', label: 'Analytics' },
          ]}
        />
        <div style={{ marginTop: 'var(--space-4)' }}>
          {tab === 'services' ? <ServicesTab /> : null}
          {tab === 'categories' ? <CategoriesTab /> : null}
          {tab === 'verification' ? <SourcesTab /> : null}
          {tab === 'feedback' ? <FeedbackTab /> : null}
          {tab === 'import' ? <ImportTab /> : null}
          {tab === 'analytics' ? <AnalyticsTab analytics={analytics} /> : null}
        </div>
      </div>
    </>
  )
}

/* ------------------------------- Services tab ---------------------------- */
function ServicesTab() {
  const toast = useToast()
  const { data: categories } = useApi('/services/categories')
  const [filters, setFilters] = useState({ q: '', status: '', verification: '', category: '', page: 1 })
  const [term, setTerm] = useState('')
  const { data, loading, error, reload } = useApi(`/admin/services${query({ ...filters, limit: 20 })}`)
  const { data: lookups } = useApi('/lookups')
  const [editorId, setEditorId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [statusTarget, setStatusTarget] = useState(null)
  const [nextStatus, setNextStatus] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value, ...(key !== 'page' ? { page: 1 } : {}) }))

  const applyStatus = async () => {
    setBusy(true)
    try {
      await api.post(`/admin/services/${statusTarget.id}/status`, { status: nextStatus, note })
      toast.push(`Record moved to ${nextStatus.replace(/_/g, ' ')}.`)
      setStatusTarget(null)
      setNextStatus('')
      setNote('')
      reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 0, alignItems: 'flex-end' }}>
          <div className="field grow" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="admin-service-search">Search</label>
            <Input
              id="admin-service-search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && setFilter('q', term.trim())}
              placeholder="Search service name or description"
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="admin-service-status">Workflow</label>
            <Select id="admin-service-status" value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
              <option value="">Any status</option>
              {['draft', 'submitted_for_review', 'under_review', 'approved', 'published', 'archived', 'changes_requested'].map((status) => (
                <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
              ))}
            </Select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="admin-service-verification">Verification</label>
            <Select id="admin-service-verification" value={filters.verification} onChange={(event) => setFilter('verification', event.target.value)}>
              <option value="">Any</option>
              {VERIFICATION.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="admin-service-category">Category</label>
            <Select id="admin-service-category" value={filters.category} onChange={(event) => setFilter('category', event.target.value)}>
              <option value="">All categories</option>
              {(categories?.flat || []).map((category) => (
                <option key={category.id} value={category.id}>{category.parent_id ? '— ' : ''}{category.name}</option>
              ))}
            </Select>
          </div>
          <Button variant="outline" onClick={() => setFilter('q', term.trim())} icon={Search}>Apply</Button>
          <Button onClick={() => { setCreating(true); setEditorId(null) }} icon={Plus}>New service</Button>
        </div>
      </div>

      {loading ? <SkeletonList count={4} height={140} /> : error ? <Alert tone="error">{error.message}</Alert> : data?.results?.length ? (
        <>
          <div className="table-wrap card" style={{ marginTop: 'var(--space-4)' }}>
            <table>
              <caption className="sr-only">Service records</caption>
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Category</th>
                  <th scope="col">Workflow</th>
                  <th scope="col">Verification</th>
                  <th scope="col">Availability</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong style={{ display: 'block' }}>{row.title}</strong>
                      <span className="text-xs text-muted">{row.municipality_name || 'Province-wide'} · {row.requirement_count} requirements</span>
                    </td>
                    <td>{row.category_name || '—'}</td>
                    <td><StatusBadge status={row.publication_status} /></td>
                    <td><ServiceVerificationBadge status={row.verification_status} /></td>
                    <td><ServiceStatusBadge status={row.availability_status} /></td>
                    <td className="text-xs">{fmtDate(row.updated_at)}</td>
                    <td>
                      <div className="row" style={{ gap: '0.25rem', flexWrap: 'wrap' }}>
                        <Button size="sm" variant="outline" onClick={() => setEditorId(row.id)} icon={Pencil}>Edit</Button>
                        {(TRANSITIONS[row.publication_status] || []).length ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setStatusTarget(row)
                              setNextStatus(TRANSITIONS[row.publication_status][0][0])
                            }}
                          >
                            Workflow
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 'var(--space-3)' }}>
            <span className="text-sm text-muted">{data.total} record{data.total === 1 ? '' : 's'}</span>
            <div className="row" style={{ marginLeft: 'auto', gap: '0.4rem' }}>
              <Button variant="outline" size="sm" disabled={filters.page <= 1} onClick={() => setFilter('page', filters.page - 1)}>Previous</Button>
              <span className="text-sm text-muted">Page {data.page} of {data.totalPages}</span>
              <Button variant="outline" size="sm" disabled={filters.page >= data.totalPages} onClick={() => setFilter('page', filters.page + 1)}>Next</Button>
            </div>
          </div>
        </>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title="No service records match"
          description="Create a draft record or adjust the filters. Nothing is published until it passes review."
          action={<Button onClick={() => setCreating(true)} icon={Plus}>Create the first draft</Button>}
        />
      )}

      <Modal open={Boolean(statusTarget)} onClose={() => setStatusTarget(null)} title="Move record through review"
        actions={<><Button variant="outline" onClick={() => setStatusTarget(null)}>Cancel</Button><Button onClick={applyStatus} loading={busy}>Apply</Button></>}>
        {statusTarget ? (
          <>
            <p className="text-sm text-muted">{statusTarget.title}</p>
            <Field label="Next status">
              {({ id }) => (
                <Select id={id} value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
                  {(TRANSITIONS[statusTarget.publication_status] || []).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Review note (recorded in history)" help="A note is optional but helps the next reviewer.">
              {({ id }) => <Textarea id={id} rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} />}
            </Field>
            <Alert tone="info">Editors cannot approve or publish records they created. A second reviewer is required.</Alert>
          </>
        ) : null}
      </Modal>

      <Modal open={creating || Boolean(editorId)} onClose={() => { setCreating(false); setEditorId(null) }} title={creating ? 'New service record' : 'Edit service record'} wide>
        <ServiceEditor
          id={editorId}
          creating={creating}
          lookups={lookups}
          categories={categories}
          onDone={() => { setCreating(false); setEditorId(null); reload() }}
          onCancel={() => { setCreating(false); setEditorId(null) }}
        />
      </Modal>
    </div>
  )
}

/* ------------------------------ Service editor --------------------------- */
function ServiceEditor({ id, creating, lookups, categories, onDone, onCancel }) {
  const toast = useToast()
  const { data: detail, loading, reload } = useApi(id ? `/admin/services/${id}` : null)
  const { data: offices } = useApi('/admin/directory?limit=100')
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('basics')

  useEffect(() => {
    if (detail?.record) {
      const record = detail.record
      const next = {}
      for (const [name, , type] of SERVICE_FIELDS) {
        const value = record[name] ?? ''
        next[name] = type === 'date' && typeof value === 'string' ? value.slice(0, 10) : value
      }
      next.is_online = Boolean(record.is_online)
      next.is_featured = Boolean(record.is_featured)
      next.source_id = record.source_id ?? ''
      next.verification_notes = record.verification_notes ?? ''
      setForm(next)
    } else if (creating) {
      setForm({ availability_status: 'needs_confirmation', service_scope: 'province_wide', is_online: false })
    }
  }, [detail, creating])

  const set = (name, value) => setForm((current) => ({ ...current, [name]: value }))

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const payload = { ...form }
      if (!payload.category_id) delete payload.category_id
      if (!payload.office_id) delete payload.office_id
      if (!payload.municipality_id) delete payload.municipality_id
      if (!payload.source_id) delete payload.source_id
      if (id) await api.patch(`/admin/services/${id}`, payload)
      else {
        const created = await api.post('/admin/services', payload)
        toast.push('Draft service created.')
        return onDone(created.id)
      }
      toast.push('Service record updated.')
      reload()
      onDone()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const fieldError = (name) => error?.details?.find((item) => item.field === name)?.message

  if (id && loading) return <SkeletonList count={3} height={120} />

  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'basics', label: 'Basics' },
          ...(id ? [
            { value: 'requirements', label: 'Requirements' },
            { value: 'procedures', label: 'Procedures' },
            { value: 'fees', label: 'Fees & time' },
            { value: 'coverage', label: 'Coverage' },
            { value: 'documents', label: 'Forms' },
            { value: 'faqs', label: 'FAQs' },
            { value: 'workflow', label: 'Verification & history' },
          ] : []),
        ]}
      />

      {tab === 'basics' ? (
        <div style={{ marginTop: 'var(--space-4)' }}>
          {error && !error.details?.length ? <Alert tone="error">{error.message}</Alert> : null}
          <div className="form-grid">
            {SERVICE_FIELDS.map(([name, label, type, required]) => {
              if (type === 'category') {
                return (
                  <Field key={name} label={label} error={fieldError(name)}>
                    {({ id: fieldId }) => (
                      <Select id={fieldId} value={form[name] ?? ''} onChange={(event) => set(name, event.target.value)}>
                        <option value="">Not set</option>
                        {(categories?.flat || []).map((category) => (
                          <option key={category.id} value={category.id}>{category.parent_id ? '— ' : ''}{category.name}</option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )
              }
              if (type === 'office') {
                return (
                  <Field key={name} label={label} error={fieldError(name)} help="Only published or draft offices already in the directory can be linked.">
                    {({ id: fieldId }) => (
                      <Select id={fieldId} value={form[name] ?? ''} onChange={(event) => set(name, event.target.value)}>
                        <option value="">Not set</option>
                        {(offices?.results || []).map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
                      </Select>
                    )}
                  </Field>
                )
              }
              if (type === 'municipality') {
                return (
                  <Field key={name} label={label} error={fieldError(name)} help="Leave empty only for province-wide records.">
                    {({ id: fieldId }) => (
                      <Select id={fieldId} value={form[name] ?? ''} onChange={(event) => set(name, event.target.value)}>
                        <option value="">Province-wide</option>
                        {(lookups?.municipalities || []).map((municipality) => <option key={municipality.id} value={municipality.id}>{municipality.name}</option>)}
                      </Select>
                    )}
                  </Field>
                )
              }
              if (type === 'scope') {
                return (
                  <Field key={name} label={label}>
                    {({ id: fieldId }) => (
                      <Select id={fieldId} value={form[name] ?? 'province_wide'} onChange={(event) => set(name, event.target.value)}>
                        {SCOPES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                      </Select>
                    )}
                  </Field>
                )
              }
              if (type === 'availability') {
                return (
                  <Field key={name} label={label}>
                    {({ id: fieldId }) => (
                      <Select id={fieldId} value={form[name] ?? 'needs_confirmation'} onChange={(event) => set(name, event.target.value)}>
                        {AVAILABILITY.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                      </Select>
                    )}
                  </Field>
                )
              }
              if (type === 'textarea') {
                return (
                  <Field key={name} label={label} error={fieldError(name)} className="span-full">
                    {({ id: fieldId }) => <Textarea id={fieldId} rows={3} value={form[name] ?? ''} onChange={(event) => set(name, event.target.value)} />}
                  </Field>
                )
              }
              return (
                <Field key={name} label={label} required={required} error={fieldError(name)}>
                  {({ id: fieldId }) => (
                    <Input
                      id={fieldId}
                      type={type === 'date' ? 'date' : 'text'}
                      value={form[name] ?? ''}
                      onChange={(event) => set(name, event.target.value)}
                      placeholder={type === 'url' ? 'https://…' : undefined}
                    />
                  )}
                </Field>
              )
            })}
            <Field label="Official source registry entry" help="Register a source under Sources & verification first, then link it here.">
              {({ id: fieldId }) => (
                <Select id={fieldId} value={form.source_id ?? ''} onChange={(event) => set('source_id', event.target.value)}>
                  <option value="">Not linked</option>
                  {(detail?.sources || []).map((source) => (
                    <option key={source.id} value={source.id}>{source.name} ({source.verification_status})</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Change summary" help="Recorded in the public update history and used for subscriber notifications." className="span-full">
              {({ id: fieldId }) => (
                <Input id={fieldId} value={form.change_summary ?? ''} onChange={(event) => set('change_summary', event.target.value)} placeholder="e.g. Updated the fee schedule from the 2026 office order" />
              )}
            </Field>
          </div>
          <div className="checkbox-row">
            <input id="service-online" type="checkbox" checked={Boolean(form.is_online)} onChange={(event) => set('is_online', event.target.checked)} />
            <label htmlFor="service-online">Application can be started online</label>
          </div>
          <div className="checkbox-row">
            <input id="service-featured" type="checkbox" checked={Boolean(form.is_featured)} onChange={(event) => set('is_featured', event.target.checked)} />
            <label htmlFor="service-featured">Feature this service in listings</label>
          </div>
          <div className="modal-actions">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button onClick={save} loading={busy}>{id ? 'Save changes' : 'Create draft'}</Button>
          </div>
        </div>
      ) : null}

      {id && tab === 'requirements' ? (
        <NestedEditor
          serviceId={id}
          segment="requirements"
          title="Requirements and document checklist"
          items={detail?.requirements}
          reload={reload}
          fields={[
            ['requirement_name', 'Requirement', 'text', true],
            ['description', 'Description', 'textarea'],
            ['quantity', 'Quantity (e.g. 2 copies)', 'text'],
            ['accepted_format', 'Accepted format (e.g. original, photocopy)', 'text'],
            ['is_required', 'Required', 'bit'],
            ['sort_order', 'Order', 'number'],
          ]}
          empty={{ is_required: true }}
          render={(item) => (
            <>
              <strong>{item.requirement_name}</strong>
              <span className="text-xs text-muted">{item.is_required ? 'Required' : 'Optional'}{item.quantity ? ` · ${item.quantity}` : ''}{item.accepted_format ? ` · ${item.accepted_format}` : ''}</span>
            </>
          )}
        />
      ) : null}

      {id && tab === 'procedures' ? (
        <NestedEditor
          serviceId={id}
          segment="procedures"
          title="Application procedure"
          items={detail?.procedures}
          reload={reload}
          fields={[
            ['step_number', 'Step number', 'number', true],
            ['title', 'Step title', 'text', true],
            ['description', 'Instructions', 'textarea'],
            ['office', 'Office for this step', 'text'],
            ['location', 'Location', 'text'],
            ['additional_instructions', 'Additional instructions', 'textarea'],
            ['link', 'Step link (https://…)', 'url'],
          ]}
          empty={{ step_number: (detail?.procedures?.length || 0) + 1 }}
          render={(item) => (
            <>
              <strong>{item.step_number}. {item.title}</strong>
              <span className="text-xs text-muted">{item.office || ''}{item.location ? ` · ${item.location}` : ''}</span>
            </>
          )}
        />
      ) : null}

      {id && tab === 'fees' ? (
        <div>
          <NestedEditor
            serviceId={id}
            segment="fees"
            title="Fees (amounts in pesos)"
            items={detail?.fees}
            reload={reload}
            fields={[
              ['fee_name', 'Fee name', 'text', true],
              ['amount', 'Amount (₱)', 'number'],
              ['fee_type', 'Fee type', 'text'],
              ['conditions', 'Conditions', 'textarea'],
              ['source_reference', 'Source reference', 'text'],
              ['last_verified_at', 'Last verified', 'date'],
            ]}
            empty={{ fee_type: 'fixed' }}
            format={(item) => `${item.fee_name}: ${item.amount_cents === null ? 'amount not recorded' : fmtPeso(item.amount_cents)}`}
          />
          <NestedEditor
            serviceId={id}
            segment="processing"
            title="Processing time"
            items={detail?.processing}
            reload={reload}
            fields={[
              ['processing_time', 'Processing time (e.g. 3–5)', 'text', true],
              ['processing_unit', 'Unit (e.g. working days)', 'text'],
              ['conditions', 'Conditions', 'textarea'],
              ['source_reference', 'Source reference', 'text'],
            ]}
            empty={{ processing_unit: 'working days' }}
            format={(item) => `${item.processing_time} ${item.processing_unit}`}
          />
        </div>
      ) : null}

      {id && tab === 'coverage' ? (
        <NestedEditor
          serviceId={id}
          segment="coverage"
          title="Municipality and barangay coverage"
          items={detail?.coverage}
          reload={reload}
          fields={[
            ['municipality_id', 'Municipality', 'municipalities', true],
            ['availability_status', 'Availability', 'availability'],
            ['local_instructions', 'Local instructions', 'textarea'],
          ]}
          empty={{ availability_status: 'available' }}
          render={(item) => (
            <>
              <strong>{item.barangay_name ? `${item.barangay_name}, ` : ''}{item.municipality_name || 'Province-wide'}</strong>
              <span className="text-xs text-muted">{String(item.availability_status).replace(/_/g, ' ')}</span>
            </>
          )}
          extra={<p className="help">Coverage must be recorded explicitly. A province-wide service is not automatically assumed to operate in every municipality.</p>}
        />
      ) : null}

      {id && tab === 'documents' ? (
        <NestedEditor
          serviceId={id}
          segment="documents"
          title="Forms and downloadable documents"
          items={detail?.documents}
          reload={reload}
          fields={[
            ['document_title', 'Document title', 'text', true],
            ['document_type', 'Type (form, checklist, guide)', 'text'],
            ['external_url', 'External URL (https://…)', 'url'],
            ['file_reference', 'File reference (no upload)', 'text'],
            ['publication_date', 'Publication date', 'date'],
            ['status', 'Status (published, draft)', 'text'],
          ]}
          empty={{ document_type: 'form', status: 'published' }}
          format={(item) => `${item.document_title} (${item.document_type})`}
        />
      ) : null}

      {id && tab === 'faqs' ? (
        <NestedEditor
          serviceId={id}
          segment="faqs"
          title="Service questions and answers"
          items={detail?.faqs}
          reload={reload}
          fields={[
            ['question', 'Question', 'text', true],
            ['answer', 'Answer', 'textarea', true],
            ['sort_order', 'Order', 'number'],
            ['status', 'Status (published, draft)', 'text'],
          ]}
          empty={{ status: 'published' }}
          format={(item) => item.question}
        />
      ) : null}

      {id && tab === 'workflow' ? (
        <WorkflowPanel detail={detail} reload={reload} id={id} />
      ) : null}
    </div>
  )
}

/* ------------------------------- Nested editor --------------------------- */
function NestedEditor({ serviceId, segment, title, items, reload, fields, empty, render, format, extra }) {
  const toast = useToast()
  const [form, setForm] = useState(empty || {})
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { data: lookups } = useApi('/lookups')

  const reset = () => {
    setForm(empty || {})
    setEditingId(null)
    setError(null)
  }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const payload = { ...form }
      for (const [name, , type] of fields) {
        if (type === 'number' && payload[name] === '') delete payload[name]
        if (type === 'bit') payload[name] = Boolean(payload[name])
      }
      if (editingId) await api.patch(`/admin/services/${serviceId}/${segment}/${editingId}`, payload)
      else await api.post(`/admin/services/${serviceId}/${segment}`, payload)
      toast.push(editingId ? 'Record updated.' : 'Record added.')
      reset()
      reload()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const edit = (item) => {
    const next = {}
    for (const [name] of fields) next[name] = item[name] ?? ''
    if (next.amount === undefined && item.amount_cents !== undefined && item.amount_cents !== null) next.amount = item.amount_cents / 100
    setForm(next)
    setEditingId(item.id)
  }

  const remove = async (item) => {
    if (!window.confirm('Remove this record? This cannot be undone.')) return
    try {
      await api.del(`/admin/services/${serviceId}/${segment}/${item.id}`)
      toast.push('Record removed.')
      reload()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {extra}
      {items?.length ? (
        <ul className="detail-list detail-list-rows">
          {items.map((item) => (
            <li key={item.id}>
              <span>{render ? render(item) : format ? format(item) : item.title}</span>
              <span className="row" style={{ gap: '0.3rem' }}>
                <Button size="sm" variant="ghost" onClick={() => edit(item)} icon={Pencil}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(item)} icon={Trash2}>Remove</Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">Nothing recorded yet.</p>
      )}

      <form onSubmit={submit} className="card" style={{ marginTop: 'var(--space-3)' }}>
        <h4 style={{ marginTop: 0 }}>{editingId ? 'Edit record' : 'Add record'}</h4>
        <div className="form-grid">
          {fields.map(([name, label, type, required]) => (
            <Field key={name} label={label} required={required} error={error?.details?.find((detail) => detail.field === name)?.message}>
              {({ id: fieldId }) => {
                if (type === 'textarea') return <Textarea id={fieldId} rows={2} value={form[name] ?? ''} onChange={(event) => setForm({ ...form, [name]: event.target.value })} />
                if (type === 'bit') {
                  return (
                    <div className="checkbox-row">
                      <input id={fieldId} type="checkbox" checked={Boolean(form[name])} onChange={(event) => setForm({ ...form, [name]: event.target.checked })} />
                      <label htmlFor={fieldId}>Yes</label>
                    </div>
                  )
                }
                if (type === 'municipalities') {
                  return (
                    <Select id={fieldId} value={form[name] ?? ''} onChange={(event) => setForm({ ...form, [name]: event.target.value })}>
                      <option value="">Choose municipality</option>
                      {(lookups?.municipalities || []).map((municipality) => <option key={municipality.id} value={municipality.id}>{municipality.name}</option>)}
                    </Select>
                  )
                }
                if (type === 'availability') {
                  return (
                    <Select id={fieldId} value={form[name] ?? 'available'} onChange={(event) => setForm({ ...form, [name]: event.target.value })}>
                      {AVAILABILITY.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                    </Select>
                  )
                }
                return (
                  <Input
                    id={fieldId}
                    type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
                    value={form[name] ?? ''}
                    onChange={(event) => setForm({ ...form, [name]: event.target.value })}
                  />
                )
              }}
            </Field>
          ))}
        </div>
        {error && !error.details?.length ? <Alert tone="error">{error.message}</Alert> : null}
        <div className="row">
          {editingId ? <Button type="button" variant="ghost" onClick={reset}>Cancel edit</Button> : null}
          <Button type="submit" loading={busy} icon={editingId ? Pencil : Plus} style={{ marginLeft: 'auto' }}>
            {editingId ? 'Save record' : 'Add record'}
          </Button>
        </div>
      </form>
    </div>
  )
}

/* --------------------------- Verification & history ---------------------- */
function WorkflowPanel({ detail, reload, id }) {
  const toast = useToast()
  const [verify, setVerify] = useState({ verification_status: detail?.record?.verification_status || 'pending', source_id: detail?.record?.source_id || '', source_reference: detail?.record?.source_reference || '', source_url: detail?.record?.source_url || '', next_review_at: detail?.record?.next_review_at || '', verification_notes: detail?.record?.verification_notes || '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!detail?.record) return
    setVerify({
      verification_status: detail.record.verification_status || 'pending',
      source_id: detail.record.source_id || '',
      source_reference: detail.record.source_reference || '',
      source_url: detail.record.source_url || '',
      next_review_at: detail.record.next_review_at || '',
      verification_notes: detail.record.verification_notes || '',
    })
  }, [detail?.record?.id])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api.post(`/admin/services/${id}/verify`, verify)
      toast.push('Verification recorded.')
      reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const rollback = async (revisionId, revisionNumber) => {
    if (!window.confirm(`Roll back to revision ${revisionNumber}? The current version is saved first.`)) return
    try {
      await api.post(`/admin/services/${id}/rollback`, { revision_id: revisionId })
      toast.push(`Rolled back to revision ${revisionNumber}.`)
      reload()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      <form className="card" onSubmit={submit}>
        <h3 style={{ marginTop: 0 }}>Verification</h3>
        <p className="text-sm text-muted">Approval to publish is separate from source verification. Record what was checked and when it should be reviewed again.</p>
        <div className="form-grid">
          <Field label="Verification status">
            {({ id: fieldId }) => (
              <Select id={fieldId} value={verify.verification_status} onChange={(event) => setVerify({ ...verify, verification_status: event.target.value })}>
                {VERIFICATION.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Linked source">
            {({ id: fieldId }) => (
              <Select id={fieldId} value={verify.source_id} onChange={(event) => setVerify({ ...verify, source_id: event.target.value })}>
                <option value="">No registry entry</option>
                {(detail?.sources || []).map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Source reference">
            {({ id: fieldId }) => <Input id={fieldId} value={verify.source_reference} onChange={(event) => setVerify({ ...verify, source_reference: event.target.value })} />}
          </Field>
          <Field label="Source URL">
            {({ id: fieldId }) => <Input id={fieldId} type="url" value={verify.source_url} onChange={(event) => setVerify({ ...verify, source_url: event.target.value })} />}
          </Field>
          <Field label="Next review date">
            {({ id: fieldId }) => <Input id={fieldId} type="date" value={verify.next_review_at ? String(verify.next_review_at).slice(0, 10) : ''} onChange={(event) => setVerify({ ...verify, next_review_at: event.target.value })} />}
          </Field>
          <Field label="Internal verification notes" className="span-full" help="Internal notes are not shown publicly.">
            {({ id: fieldId }) => <Textarea id={fieldId} rows={2} value={verify.verification_notes} onChange={(event) => setVerify({ ...verify, verification_notes: event.target.value })} />}
          </Field>
        </div>
        <Button type="submit" loading={busy} icon={ShieldCheck}>Record verification</Button>
      </form>

      <section className="card" style={{ marginTop: 'var(--space-3)' }}>
        <h3 style={{ marginTop: 0 }}>Workflow history</h3>
        {detail?.workflow?.length ? (
          <ul className="timeline">
            {detail.workflow.map((event) => (
              <li key={event.id}>
                <strong>{event.from_status || 'created'} → {event.to_status}</strong>
                <span className="text-xs text-muted"> {fmtDate(event.created_at)}</span>
                {event.note ? <p className="text-sm" style={{ margin: 0 }}>{event.note}</p> : null}
              </li>
            ))}
          </ul>
        ) : <p className="text-muted">No workflow events recorded.</p>}
      </section>

      <section className="card" style={{ marginTop: 'var(--space-3)' }}>
        <h3 style={{ marginTop: 0 }}><History size={16} aria-hidden="true" /> Revision history</h3>
        {detail?.revisions?.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Revision history</caption>
              <thead><tr><th scope="col">Revision</th><th scope="col">Change</th><th scope="col">When</th><th scope="col">Action</th></tr></thead>
              <tbody>
                {detail.revisions.map((revision) => (
                  <tr key={revision.id}>
                    <td>{revision.revision_number}</td>
                    <td>{revision.change_summary || '—'}</td>
                    <td className="text-xs">{fmtDate(revision.created_at)}</td>
                    <td><Button size="sm" variant="outline" onClick={() => rollback(revision.id, revision.revision_number)}>Roll back</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-muted">No revisions recorded.</p>}
      </section>
    </div>
  )
}

/* ------------------------------ Categories tab --------------------------- */
const ICON_CHOICES = ['FileText', 'HeartPulse', 'HandHeart', 'Users', 'Accessibility', 'UsersRound', 'BriefcaseBusiness', 'Receipt', 'Building2', 'GraduationCap', 'Briefcase', 'Store', 'Sprout', 'Fish', 'Trees', 'House', 'Car', 'ShieldCheck', 'LifeBuoy', 'Trophy', 'MapPinned', 'Scale', 'Landmark', 'ContactRound', 'FolderOpen']

function CategoriesTab() {
  const toast = useToast()
  const { data, loading, reload } = useApi('/admin/service-categories')
  const [editor, setEditor] = useState(null)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)

  const open = (category) => {
    setEditor(category || { new: true })
    setForm(
      category
        ? { name: category.name, description: category.description || '', icon: category.icon || 'FolderOpen', parent_id: category.parent_id || '', sort_order: category.sort_order || 0, is_featured: category.is_featured, status: category.status || 'active', seo_title: category.seo_title || '', seo_description: category.seo_description || '', keywords: category.keywords || '' }
        : { name: '', description: '', icon: 'FolderOpen', parent_id: '', sort_order: 0, is_featured: false, status: 'active' },
    )
  }

  const save = async () => {
    setBusy(true)
    try {
      if (editor?.new) await api.post('/admin/service-categories', form)
      else await api.patch(`/admin/service-categories/${editor.id}`, form)
      toast.push('Category saved.')
      setEditor(null)
      reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const archive = async (category) => {
    if (!window.confirm(`Archive “${category.name}”? Services keep their category reference.`)) return
    try {
      await api.del(`/admin/service-categories/${category.id}`)
      toast.push('Category archived.')
      reload()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 'var(--space-3)' }}>
        <p className="text-sm text-muted" style={{ margin: 0 }}>
          {data?.parents?.length || 0} parent groups · {data?.total || 0} categories. Counts include drafts in this administrative view.
        </p>
        <Button onClick={() => open(null)} icon={Plus}>New category</Button>
      </div>
      {loading ? <SkeletonList count={4} height={120} /> : data?.results?.length ? (
        <div className="table-wrap card">
          <table>
            <caption className="sr-only">Service category hierarchy</caption>
            <thead><tr><th scope="col">Category</th><th scope="col">Parent</th><th scope="col">Services</th><th scope="col">Published</th><th scope="col">Order</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {data.results.map((category) => (
                <tr key={category.id}>
                  <td>
                    <span className="row" style={{ gap: '0.35rem' }}>
                      <CategoryIcon name={category.icon} size={16} />
                      <strong>{category.parent_id ? '— ' : ''}{category.name}</strong>
                      {category.is_featured ? <Badge tone="info">Featured</Badge> : null}
                    </span>
                    <span className="text-xs text-muted">{category.slug}</span>
                  </td>
                  <td>{data.results.find((row) => row.id === category.parent_id)?.name || '—'}</td>
                  <td>{category.service_count}</td>
                  <td>{category.published_count}</td>
                  <td>{category.sort_order}</td>
                  <td><Badge tone={category.status === 'active' ? 'success' : 'neutral'}>{category.status}</Badge></td>
                  <td>
                    <div className="row" style={{ gap: '0.25rem' }}>
                      <Button size="sm" variant="outline" onClick={() => open(category)} icon={Pencil}>Edit</Button>
                      {category.status === 'active' ? <Button size="sm" variant="ghost" onClick={() => archive(category)}>Archive</Button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState icon={FolderTree} title="No categories" description="Seed the category structure or create a category." />}

      <Modal open={Boolean(editor)} onClose={() => setEditor(null)} title={editor?.new ? 'New category' : `Edit ${editor?.name || 'category'}`}
        actions={<><Button variant="outline" onClick={() => setEditor(null)}>Cancel</Button><Button onClick={save} loading={busy}>Save category</Button></>}>
        <div className="form-grid">
          <Field label="Name" required>{({ id }) => <Input id={id} value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
          <Field label="Parent category">{({ id }) => (
            <Select id={id} value={form.parent_id || ''} onChange={(event) => setForm({ ...form, parent_id: event.target.value })}>
              <option value="">Top-level category</option>
              {(data?.parents || []).filter((row) => row.id !== editor?.id).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </Select>
          )}</Field>
          <Field label="Icon">{({ id }) => (
            <Select id={id} value={form.icon || 'FolderOpen'} onChange={(event) => setForm({ ...form, icon: event.target.value })}>
              {ICON_CHOICES.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
            </Select>
          )}</Field>
          <Field label="Display order">{({ id }) => <Input id={id} type="number" value={form.sort_order ?? 0} onChange={(event) => setForm({ ...form, sort_order: event.target.value })} />}</Field>
          <Field label="Description" className="span-full">{({ id }) => <Textarea id={id} rows={2} value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} />}</Field>
          <Field label="SEO title">{({ id }) => <Input id={id} value={form.seo_title || ''} onChange={(event) => setForm({ ...form, seo_title: event.target.value })} />}</Field>
          <Field label="SEO description">{({ id }) => <Input id={id} value={form.seo_description || ''} onChange={(event) => setForm({ ...form, seo_description: event.target.value })} />}</Field>
          <Field label="Search keywords (Filipino / English)" className="span-full" help="Comma-separated terms used to improve category search.">
            {({ id }) => <Input id={id} value={form.keywords || ''} onChange={(event) => setForm({ ...form, keywords: event.target.value })} />}
          </Field>
        </div>
        <div className="checkbox-row">
          <input id="category-featured" type="checkbox" checked={Boolean(form.is_featured)} onChange={(event) => setForm({ ...form, is_featured: event.target.checked })} />
          <label htmlFor="category-featured">Featured category</label>
        </div>
        <div className="checkbox-row">
          <input id="category-active" type="checkbox" checked={form.status !== 'inactive'} onChange={(event) => setForm({ ...form, status: event.target.checked ? 'active' : 'inactive' })} />
          <label htmlFor="category-active">Active (visible publicly)</label>
        </div>
      </Modal>
    </div>
  )
}

/* -------------------------------- Sources tab ---------------------------- */
function SourcesTab() {
  const toast = useToast()
  const { data, loading, reload } = useApi('/admin/service-sources')
  const [form, setForm] = useState({ name: '', organization: '', url: '', document_reference: '', description: '', next_review_at: '' })
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api.post('/admin/service-sources', form)
      toast.push('Source recorded as pending verification.')
      setForm({ name: '', organization: '', url: '', document_reference: '', description: '', next_review_at: '' })
      reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const verify = async (source, status) => {
    try {
      await api.patch(`/admin/service-sources/${source.id}`, { verification_status: status })
      toast.push(`Source marked ${status.replace(/_/g, ' ')}.`)
      reload()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div>
      <form className="card" onSubmit={submit}>
        <h3 style={{ marginTop: 0 }}>Register an official source</h3>
        <div className="form-grid">
          <Field label="Source name" required>{({ id }) => <Input id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
          <Field label="Organization">{({ id }) => <Input id={id} value={form.organization} onChange={(event) => setForm({ ...form, organization: event.target.value })} />}</Field>
          <Field label="Source URL" help="Only http(s) links are accepted.">{({ id }) => <Input id={id} type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />}</Field>
          <Field label="Document reference" help="Required when no URL is available.">{({ id }) => <Input id={id} value={form.document_reference} onChange={(event) => setForm({ ...form, document_reference: event.target.value })} />}</Field>
          <Field label="Next review date">{({ id }) => <Input id={id} type="date" value={form.next_review_at} onChange={(event) => setForm({ ...form, next_review_at: event.target.value })} />}</Field>
          <Field label="Notes" className="span-full">{({ id }) => <Input id={id} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />}</Field>
        </div>
        <Button type="submit" loading={busy} icon={Plus}>Record source</Button>
      </form>

      {loading ? <SkeletonList count={3} height={100} /> : data?.results?.length ? (
        <div className="table-wrap card" style={{ marginTop: 'var(--space-3)' }}>
          <table>
            <caption className="sr-only">Official sources</caption>
            <thead><tr><th scope="col">Source</th><th scope="col">Reference</th><th scope="col">Status</th><th scope="col">Used by</th><th scope="col">Next review</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {data.results.map((source) => (
                <tr key={source.id}>
                  <td><strong>{source.name}</strong><span className="text-xs text-muted" style={{ display: 'block' }}>{source.organization || '—'}</span></td>
                  <td>{source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">Open link</a> : source.document_reference || '—'}</td>
                  <td><ServiceVerificationBadge status={source.verification_status} /></td>
                  <td>{source.service_count}</td>
                  <td className="text-xs">{source.next_review_at ? fmtDate(source.next_review_at) : '—'}</td>
                  <td>
                    <div className="row" style={{ gap: '0.25rem' }}>
                      <Button size="sm" variant="outline" onClick={() => verify(source, 'verified')} icon={CheckCircle2}>Verify</Button>
                      <Button size="sm" variant="ghost" onClick={() => verify(source, 'needs_update')}>Needs update</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-muted" style={{ marginTop: 'var(--space-3)' }}>No sources registered yet. Verified service records must cite one.</p>}
    </div>
  )
}

/* -------------------------------- Feedback tab --------------------------- */
function FeedbackTab() {
  const toast = useToast()
  const [status, setStatus] = useState('pending')
  const { data, loading, reload } = useApi(`/admin/service-feedback${query({ status })}`)
  const moderate = async (item, next, isPublic) => {
    try {
      await api.patch(`/admin/service-feedback/${item.id}`, { status: next, is_public: isPublic })
      toast.push('Feedback updated.')
      reload()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }
  return (
    <div>
      <div className="toolbar card">
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label" htmlFor="feedback-status">Status</label>
          <Select id="feedback-status" value={status} onChange={(event) => setStatus(event.target.value)}>
            {['pending', 'approved', 'rejected', 'archived'].map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        </div>
        <p className="text-sm text-muted" style={{ margin: 0 }}>Feedback is never published with account details attached. Only approved, public comments appear on a service page.</p>
      </div>
      {loading ? <SkeletonList count={3} height={110} /> : data?.results?.length ? (
        <div style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
          {data.results.map((item) => (
            <div className="card" key={item.id}>
              <div className="row-between">
                <strong>{item.service_title}</strong>
                <span className="row" style={{ gap: '0.3rem' }}>
                  <Badge tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : 'warning'}>{item.status}</Badge>
                  {item.rating ? <Badge tone="info"><Star size={11} aria-hidden="true" /> {item.rating}/5</Badge> : null}
                </span>
              </div>
              <p className="text-sm" style={{ margin: '0.35rem 0' }}>{item.comment || 'No comment supplied.'}</p>
              <span className="text-xs text-muted">Submitted {fmtDate(item.created_at)}</span>
              <div className="card-actions">
                <Button size="sm" variant="success" onClick={() => moderate(item, 'approved', true)}>Approve &amp; publish</Button>
                <Button size="sm" variant="outline" onClick={() => moderate(item, 'approved', false)}>Approve privately</Button>
                <Button size="sm" variant="ghost" onClick={() => moderate(item, 'rejected', false)}>Reject</Button>
                <Link className="btn btn-ghost btn-sm" to={`/services/${item.service_slug}`} style={{ marginLeft: 'auto' }}>View service</Link>
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyState icon={Star} title={`No ${status} feedback`} description="Citizen feedback submitted from service pages appears here for moderation." />}
    </div>
  )
}

/* --------------------------------- Import tab ---------------------------- */
function ImportTab() {
  const toast = useToast()
  const [format, setFormat] = useState('csv')
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  const payload = () => (format === 'csv' ? { csv: text } : { json: text })

  const validate = async (dryRun) => {
    setBusy(true)
    try {
      const result = await api.post('/admin/services/import', { ...payload(), dry_run: dryRun })
      setPreview(result)
      if (!dryRun) toast.push(`${result.created} draft record(s) imported.`)
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Bulk import service information</h3>
        <p className="text-sm text-muted">
          Import CSV, JSON or XLSX-exported CSV. Imports always create <strong>drafts</strong> with pending verification; nothing is
          published automatically. Preview the validation results before importing.
        </p>
        <div className="form-grid">
          <Field label="Format">
            {({ id }) => (
              <Select id={id} value={format} onChange={(event) => { setFormat(event.target.value); setPreview(null) }}>
                <option value="csv">CSV</option>
                <option value="json">JSON array</option>
              </Select>
            )}
          </Field>
          <Field label="Paste data" className="span-full" help="Required columns: service_name, category. Recommended: office, municipality, description, eligibility, source_reference, source_url, fee. Maximum 500 rows.">
            {({ id }) => (
              <Textarea
                id={id}
                rows={10}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={format === 'csv' ? 'service_name,category,office,municipality,description,source_url\n…' : '[{"service_name":"…","category":"…"}]'}
                spellCheck={false}
              />
            )}
          </Field>
        </div>
        <div className="row">
          <Button variant="outline" onClick={() => validate(true)} loading={busy} icon={Search}>Validate only</Button>
          <Button onClick={() => validate(false)} disabled={!preview?.valid} icon={Upload}>Import valid drafts</Button>
        </div>
      </div>

      {preview ? (
        <div className="card" style={{ marginTop: 'var(--space-3)' }}>
          <h3 style={{ marginTop: 0 }}>{preview.dry_run ? 'Validation preview' : 'Import result'}</h3>
          <p className="text-sm">
            {preview.total} row(s) · <strong>{preview.valid}</strong> valid · <strong>{preview.invalid}</strong> with errors
            {preview.created !== undefined ? ` · ${preview.created} created` : ''}
          </p>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Import validation results</caption>
              <thead><tr><th scope="col">Row</th><th scope="col">Service</th><th scope="col">Valid</th><th scope="col">Errors</th><th scope="col">Warnings</th></tr></thead>
              <tbody>
                {(preview.results || []).map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.title || '—'}</td>
                    <td><Badge tone={row.valid ? 'success' : 'danger'}>{row.valid ? 'Yes' : 'No'}</Badge></td>
                    <td className="text-xs">{row.errors?.join(' ') || '—'}</td>
                    <td className="text-xs text-muted">{row.warnings?.join(' ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 'var(--space-3)' }}>
        <h3 style={{ marginTop: 0 }}><FileSpreadsheet size={16} aria-hidden="true" /> Export published records</h3>
        <p className="text-sm text-muted">Exports contain published, non-archived records only. Drafts and internal notes are never included.</p>
        <div className="row">
          <a className="btn btn-outline btn-sm" href="/api/admin/services/export" target="_blank" rel="noopener noreferrer">Export JSON</a>
          <a className="btn btn-outline btn-sm" href="/api/admin/services/export?format=csv" target="_blank" rel="noopener noreferrer">Export CSV</a>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------- Analytics tab -------------------------- */
function AnalyticsTab({ analytics }) {
  if (!analytics) return <SkeletonList count={3} height={130} />
  return (
    <div>
      <div className="grid grid-3">
        <div className="card"><span className="stat-label">All records</span><span className="stat-value">{analytics.totals.all}</span></div>
        <div className="card"><span className="stat-label">Published</span><span className="stat-value">{analytics.totals.published}</span></div>
        <div className="card"><span className="stat-label">Active categories</span><span className="stat-value">{analytics.totals.categories}</span></div>
      </div>
      <div className="grid grid-2" style={{ marginTop: 'var(--space-3)' }}>
        <section className="card">
          <h3 style={{ marginTop: 0 }}><BarChart3 size={16} aria-hidden="true" /> Top searches</h3>
          {analytics.topSearches?.length ? (
            <ul className="detail-list detail-list-rows">
              {analytics.topSearches.map((row, index) => <li key={index}><span>{row.query}</span><span>{row.searches}</span></li>)}
            </ul>
          ) : <p className="text-muted">No searches recorded yet.</p>}
          <h4>Searches with no results</h4>
          {analytics.searchesWithoutResults?.length ? (
            <ul className="detail-list detail-list-rows">
              {analytics.searchesWithoutResults.map((row, index) => <li key={index}><span>{row.query}</span><span>{row.searches}</span></li>)}
            </ul>
          ) : <p className="text-muted">None recorded.</p>}
        </section>
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Municipality coverage gaps</h3>
          <ul className="detail-list detail-list-rows">
            {(analytics.coverageGaps || []).map((row) => (
              <li key={row.slug}><span>{row.name}</span><span>{row.service_count} published service{row.service_count === 1 ? '' : 's'}</span></li>
            ))}
          </ul>
          <p className="help">A low count usually means no records have been published, not that no services exist.</p>
        </section>
      </div>
      <section className="card" style={{ marginTop: 'var(--space-3)' }}>
        <h3 style={{ marginTop: 0 }}>Feedback moderation</h3>
        <p className="text-sm">Total: {analytics.feedback?.total || 0} · Pending: {analytics.feedback?.pending || 0} · Average published rating: {analytics.feedback?.average_rating || '—'}</p>
      </section>
    </div>
  )
}
