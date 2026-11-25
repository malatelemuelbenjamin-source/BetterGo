import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, FileText, History, Pencil } from 'lucide-react'
import { api, fmtDate, query } from '../../api'
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
  Pagination,
  Select,
  SkeletonList,
  StatusBadge,
  Tabs,
  Textarea,
  useToast,
} from '../../components/ui'
import { PageHeader } from '../../components/layout'
import { useAuth } from '../../auth'

const TRANSITIONS = {
  draft: ['submitted_for_review'],
  submitted_for_review: ['under_review', 'approved', 'changes_requested'],
  under_review: ['approved', 'changes_requested', 'rejected'],
  changes_requested: ['submitted_for_review', 'draft'],
  approved: ['published', 'archived'],
  published: ['archived'],
  archived: ['draft'],
  rejected: ['draft'],
}

const STATUS_LABEL = {
  submitted_for_review: 'Submit for review',
  under_review: 'Begin review',
  approved: 'Approve',
  changes_requested: 'Request changes',
  rejected: 'Reject',
  published: 'Publish',
  archived: 'Archive',
  draft: 'Return to draft',
}

function ResourceAdmin({ config }) {
  const toast = useToast()
  const { can, isSuperAdmin, hasGlobalScope, municipalityIds } = useAuth()
  const defaultMunicipalityId = municipalityIds?.length === 1 ? municipalityIds[0] : ''
  const { data: lookups } = useApi('/lookups')
  const [filters, setFilters] = useState({ q: '', status: '', page: 1, ...(config.defaultFilters || {}) })
  const [term, setTerm] = useState('')
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [statusTarget, setStatusTarget] = useState(null)
  const [nextStatus, setNextStatus] = useState('')
  const [note, setNote] = useState('')

  const path = `${config.endpoint}${query({ ...filters, limit: 20 })}`
  const { data, loading, error: loadError, reload } = useApi(path)
  useDocumentTitle(config.title)

  const openCreate = () => {
    const initial = config.defaultValues ? config.defaultValues(lookups) : {}
    // Scoped staff cannot create province-wide records, so start them on the
    // municipality they are assigned to instead of an empty coverage field.
    if (!hasGlobalScope && defaultMunicipalityId && !initial.municipality_id) initial.municipality_id = defaultMunicipalityId
    setForm(initial)
    setCreating(true)
    setEditing(null)
    setError(null)
  }

  const openEdit = (record) => {
    const initial = {}
    for (const fieldDef of config.fields) initial[fieldDef.name] = record[fieldDef.name] ?? ''
    setForm(initial)
    setEditing(record)
    setCreating(false)
    setError(null)
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      if (editing) await api.patch(`${config.endpoint}/${editing.id}`, form)
      else await api.post(config.endpoint, form)
      toast.push(editing ? 'Record updated.' : 'Record created as a draft.')
      setEditing(null)
      setCreating(false)
      reload()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const applyStatus = async () => {
    setBusy(true)
    try {
      await api.post(`${config.endpoint}/${statusTarget.id}/status`, { status: nextStatus, note })
      toast.push(`Record moved to ${STATUS_LABEL[nextStatus] || nextStatus}.`)
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

  const fieldError = (name) => error?.details?.find((detail) => detail.field === name)?.message

  return (
    <>
      <PageHeader
        eyebrow={config.eyebrow || 'Content'}
        title={config.title}
        description={config.description}
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: config.title }]}
        actions={
          can(config.createPermission || 'content.create') ? (
            <Button onClick={openCreate} icon={Plus}>New record</Button>
          ) : null
        }
      />

      <div className="card">
        <form
          className="toolbar"
          style={{ marginBottom: 0 }}
          onSubmit={(event) => {
            event.preventDefault()
            setFilters({ ...filters, q: term.trim(), page: 1 })
          }}
        >
          <input className="input grow" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search records" aria-label="Search records" />
          <Select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value, page: 1 })} aria-label="Filter by status">
            <option value="">Any status</option>
            {Object.keys(STATUS_LABEL).map((status) => (
              <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
            ))}
          </Select>
          {(config.filters || []).map((filter) => (
            <Select
              key={filter.name}
              value={filters[filter.name] || ''}
              onChange={(event) => setFilters({ ...filters, [filter.name]: event.target.value, page: 1 })}
              aria-label={filter.label}
            >
              <option value="">{filter.label}</option>
              {filter.options(lookups).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          ))}
          <Button type="submit" icon={Search}>Filter</Button>
        </form>
      </div>

      {loadError ? <Alert tone="error">{loadError.message}</Alert> : null}

      {!hasGlobalScope ? (
        <Alert tone="info" title="Your records are scoped to your municipality">
          You can create and edit records for your assigned municipality. Province-wide records are listed for reference and are
          read-only here; only provincial administrators can change them.
        </Alert>
      ) : null}

      {loading ? <SkeletonList count={3} height={90} /> : (
        <div className="table-wrap mt-4">
          <table className="data">
            <thead>
              <tr>
                <th>Record</th>
                {config.columns.map((column) => <th key={column.key}>{column.label}</th>)}
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data?.results || []).map((record) => {
                const readOnly = !hasGlobalScope && Boolean(record.is_province_wide)
                return (
                <tr key={record.id} className={readOnly ? 'row-readonly' : undefined}>
                  <td>
                    <strong style={{ display: 'block' }}>{record.title || record.name || record.organization_name || record.question}</strong>
                    <span className="text-xs text-muted">{record.slug}</span>
                  </td>
                  {config.columns.map((column) => (
                    <td key={column.key} className="text-xs">
                      {column.render ? column.render(record, lookups) : record[column.key] ?? '—'}
                    </td>
                  ))}
                  <td><StatusBadge status={record.publication_status || record.status} /></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {readOnly ? (
                      <Badge tone="neutral">Province-wide · read-only</Badge>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(record)}>Edit</Button>
                        {TRANSITIONS[record.publication_status || record.status]?.length ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setStatusTarget(record)
                              setNextStatus(TRANSITIONS[record.publication_status || record.status][0])
                            }}
                          >
                            Workflow
                          </Button>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
          {!data?.results?.length ? (
            <div style={{ padding: '2rem' }}>
              <EmptyState
                icon={FileText}
                title="No records"
                description={`No ${config.title.toLowerCase()} match these filters. Records are created as drafts and published only after review.`}
              />
            </div>
          ) : null}
        </div>
      )}

      {data ? <Pagination page={data.page} totalPages={data.totalPages} onChange={(next) => setFilters({ ...filters, page: next })} /> : null}

      <Modal
        open={creating || Boolean(editing)}
        onClose={() => { setCreating(false); setEditing(null) }}
        title={editing ? `Edit: ${editing.title || editing.name}` : `New ${config.singular || 'record'}`}
        wide
        actions={
          <>
            <Button variant="outline" onClick={() => { setCreating(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={save} loading={busy}>{editing ? 'Save changes' : 'Create draft'}</Button>
          </>
        }
      >
        {error && !error.details?.length ? <Alert tone="error">{error.message}</Alert> : null}
        {error?.details?.length ? (
          <Alert tone="error" title="Please check the form">
            <ul>{error.details.map((detail) => <li key={detail.field}>{detail.message}</li>)}</ul>
          </Alert>
        ) : null}
        <Alert tone="info">
          New and edited records stay in draft until they pass review. Publishing requires the appropriate permission and is recorded in
          the audit log.
        </Alert>
        <div className="form-grid mt-3">
          {config.fields.map((fieldDef) => {
            const id = `field-${fieldDef.name}`
            const scopedMunicipality = !hasGlobalScope && fieldDef.name === 'municipality_id'
            const common = {
              id,
              value: form[fieldDef.name] ?? '',
              onChange: (event) => setForm({ ...form, [fieldDef.name]: fieldDef.type === 'checkbox' ? event.target.checked : event.target.value }),
              required: fieldDef.required,
              maxLength: fieldDef.max,
            }
            return (
              <Field
                key={fieldDef.name}
                label={fieldDef.label}
                htmlFor={id}
                required={fieldDef.required || scopedMunicipality}
                help={scopedMunicipality ? 'Required: your account may only publish within its assigned municipality.' : fieldDef.help}
                error={fieldError(fieldDef.name)}
                className={fieldDef.full ? 'field-full' : ''}
                children={({ id: fieldId, invalid }) => {
                  if (fieldDef.type === 'textarea') {
                    return <Textarea {...common} id={fieldId} invalid={invalid} style={{ minHeight: fieldDef.tall ? 160 : 90 }} placeholder={fieldDef.placeholder} />
                  }
                  if (fieldDef.type === 'select') {
                    return (
                      <Select {...common} id={fieldId} invalid={invalid}>
                        {scopedMunicipality ? null : <option value="">{fieldDef.placeholder || 'Select…'}</option>}
                        {fieldDef.options(lookups)
                          .filter((option) => !scopedMunicipality || municipalityIds.includes(Number(option.value)))
                          .map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                      </Select>
                    )
                  }
                  if (fieldDef.type === 'checkbox') {
                    return (
                      <label className="checkbox-row">
                        <input type="checkbox" id={fieldId} checked={Boolean(form[fieldDef.name])} onChange={(event) => setForm({ ...form, [fieldDef.name]: event.target.checked })} />
                        <span>{fieldDef.checkboxLabel || fieldDef.label}</span>
                      </label>
                    )
                  }
                  return <Input {...common} id={fieldId} invalid={invalid} type={fieldDef.type || 'text'} placeholder={fieldDef.placeholder} />
                }}
              />
            )
          })}
        </div>
      </Modal>

      <Modal
        open={Boolean(statusTarget)}
        onClose={() => setStatusTarget(null)}
        title={statusTarget ? `Workflow: ${statusTarget.title || statusTarget.name}` : ''}
        actions={
          <>
            <Button variant="outline" onClick={() => setStatusTarget(null)}>Cancel</Button>
            <Button onClick={applyStatus} loading={busy} disabled={!nextStatus}>Apply</Button>
          </>
        }
      >
        {statusTarget ? (
          <>
            <p className="text-sm text-muted">
              Current status: <StatusBadge status={statusTarget.publication_status || statusTarget.status} />
            </p>
            <Field label="Next status" htmlFor="next-status" required>
              <Select id="next-status" value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
                {(TRANSITIONS[statusTarget.publication_status || statusTarget.status] || []).map((status) => (
                  <option key={status} value={status}>{STATUS_LABEL[status] || status}</option>
                ))}
              </Select>
            </Field>
            <Field label="Review note (optional)" htmlFor="status-note" help="Stored with the workflow history and audit log.">
              <Textarea id="status-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} style={{ minHeight: 80 }} />
            </Field>
            <Alert tone="warning" title="Permissions are enforced on the server">
              Moving a record to approved, published or archived requires the matching permission. Unauthorised transitions are rejected
              even if attempted directly against the API.
            </Alert>
          </>
        ) : null}
      </Modal>
    </>
  )
}

/* ----------------------------- Announcements ----------------------------- */
export function AdminAnnouncements() {
  return (
    <ResourceAdmin
      config={{
        title: 'Announcements',
        singular: 'announcement',
        eyebrow: 'Content',
        description: 'Draft, review and publish public announcements. Unpublished records never appear publicly.',
        endpoint: '/admin/announcements',
        createPermission: 'announcements.create',
        columns: [
          { key: 'category_name', label: 'Category' },
          { key: 'municipality_name', label: 'Coverage', render: (r) => r.municipality_name || 'Province-wide' },
          { key: 'updated_at', label: 'Updated', render: (r) => fmtDate(r.updated_at) },
        ],
        filters: [{ name: 'municipality', label: 'All municipalities', options: (l) => (l?.municipalities || []).map((m) => ({ value: m.slug, label: m.name })) }],
        defaultValues: () => ({ announcement_type: 'update', priority: 'normal', coverage: 'province', source_type: 'bettergo' }),
        fields: [
          { name: 'title', label: 'Title', required: true, max: 200, full: true },
          { name: 'summary', label: 'Summary', type: 'textarea', max: 600, full: true },
          { name: 'content', label: 'Full content', type: 'textarea', max: 100000, tall: true, full: true },
          {
            name: 'category_id',
            label: 'Category',
            type: 'select',
            options: (l) => (l?.announcementCategories || []).map((c) => ({ value: c.id, label: c.name })),
          },
          {
            name: 'municipality_id',
            label: 'Municipality',
            type: 'select',
            help: 'Leave empty for province-wide coverage.',
            options: (l) => (l?.municipalities || []).map((m) => ({ value: m.id, label: m.name })),
          },
          {
            name: 'announcement_type',
            label: 'Type',
            type: 'select',
            options: () => [
              { value: 'update', label: 'Update' },
              { value: 'advisory', label: 'Advisory' },
              { value: 'emergency', label: 'Emergency' },
              { value: 'event', label: 'Event' },
              { value: 'consultation', label: 'Consultation' },
            ],
          },
          {
            name: 'priority',
            label: 'Priority',
            type: 'select',
            options: () => [
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
              { value: 'urgent', label: 'Urgent' },
            ],
          },
          {
            name: 'source_type',
            label: 'Source type',
            type: 'select',
            help: 'Be accurate: reproduced content must not be presented as original.',
            options: () => [
              { value: 'bettergo', label: 'Original BetterGo content' },
              { value: 'official', label: 'Officially sourced' },
              { value: 'reproduced', label: 'Reproduced public information' },
              { value: 'community', label: 'Community submission' },
            ],
          },
          { name: 'source_organization', label: 'Source organisation', max: 200 },
          { name: 'source_url', label: 'Source URL', type: 'url', placeholder: 'https://' },
          { name: 'featured_image', label: 'Featured image URL', placeholder: '/uploads/media/…' },
          { name: 'expires_at', label: 'Expires at', help: 'Optional. Expired announcements stop appearing publicly.' },
          { name: 'is_featured', label: 'Feature on homepage', type: 'checkbox' },
        ],
      }}
    />
  )
}

/* ------------------------------- Directory ------------------------------- */
export function AdminDirectory() {
  return (
    <ResourceAdmin
      config={{
        title: 'Government directory',
        singular: 'office',
        eyebrow: 'Platform',
        description: 'Offices, departments and public contact information. Only verified public details should be published.',
        endpoint: '/admin/directory',
        createPermission: 'directory.create',
        columns: [
          { key: 'government_level', label: 'Level' },
          { key: 'category', label: 'Category' },
          { key: 'municipality_name', label: 'Municipality', render: (r) => r.municipality_name || 'Province-wide' },
          { key: 'verification_status', label: 'Verification', render: (r) => <Badge tone={r.verification_status === 'verified' ? 'success' : 'warning'}>{r.verification_status}</Badge> },
        ],
        filters: [
          {
            name: 'level',
            label: 'All levels',
            options: () => [
              { value: 'provincial', label: 'Provincial' },
              { value: 'municipal', label: 'Municipal' },
              { value: 'national', label: 'National' },
            ],
          },
        ],
        defaultValues: () => ({ government_level: 'municipal' }),
        fields: [
          { name: 'name', label: 'Office name', required: true, max: 200, full: true },
          { name: 'description', label: 'Description', type: 'textarea', max: 5000, full: true },
          { name: 'responsibilities', label: 'Responsibilities', type: 'textarea', max: 5000, full: true },
          {
            name: 'government_level',
            label: 'Government level',
            type: 'select',
            required: true,
            options: () => [
              { value: 'provincial', label: 'Provincial office' },
              { value: 'municipal', label: 'Municipal office' },
              { value: 'national', label: 'National agency' },
            ],
          },
          { name: 'category', label: 'Category', max: 80, placeholder: 'e.g. Health, Civil Registry' },
          { name: 'office_type', label: 'Office type', max: 80 },
          { name: 'municipality_id', label: 'Municipality', type: 'select', options: (l) => (l?.municipalities || []).map((m) => ({ value: m.id, label: m.name })) },
          { name: 'phone', label: 'Public telephone', max: 40 },
          { name: 'email', label: 'Public email', type: 'email' },
          { name: 'address', label: 'Public address', max: 300, full: true },
          { name: 'operating_hours', label: 'Operating hours', max: 200 },
          { name: 'website', label: 'Official website', type: 'url', placeholder: 'https://' },
          { name: 'facebook', label: 'Official social page', type: 'url', placeholder: 'https://' },
          { name: 'source_reference', label: 'Source reference', max: 500, full: true },
          { name: 'source_url', label: 'Source URL', type: 'url', placeholder: 'https://' },
          { name: 'last_verified_at', label: 'Last verified date' },
        ],
      }}
    />
  )
}

/* ------------------------------ Transparency ----------------------------- */
export function AdminTransparency() {
  const [tab, setTab] = useState('records')
  const toast = useToast()
  const { data: lookups } = useApi('/lookups')
  const { data, reload } = useApi(tab === 'financial' ? '/admin/financial-records' : null)
  const [busy, setBusy] = useState(false)

  return (
    <>
      <Tabs
        tabs={[
          { value: 'records', label: 'Transparency records' },
          { value: 'documents', label: 'Public documents' },
          { value: 'financial', label: 'Financial data' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'records' ? (
        <ResourceAdmin
          config={{
            title: 'Transparency records',
            singular: 'record',
            eyebrow: 'Transparency',
            description: 'Budget, expenditure, procurement and accountability records with source attribution.',
            endpoint: '/admin/transparency-records',
            createPermission: 'transparency.documents.manage',
            columns: [
              { key: 'record_category', label: 'Category' },
              { key: 'government_level', label: 'Level' },
              { key: 'fiscal_year', label: 'Year' },
              { key: 'municipality_name', label: 'Municipality', render: (r) => r.municipality_name || 'Province-wide' },
            ],
            filters: [
              {
                name: 'category',
                label: 'All categories',
                options: () => [
                  { value: 'budget', label: 'Budget' },
                  { value: 'expenditure', label: 'Expenditure' },
                  { value: 'procurement', label: 'Procurement' },
                  { value: 'accountability', label: 'Accountability' },
                ],
              },
            ],
            defaultValues: () => ({ record_category: 'budget', government_level: 'provincial' }),
            fields: [
              { name: 'title', label: 'Title', required: true, max: 250, full: true },
              { name: 'description', label: 'Description', type: 'textarea', max: 8000, full: true },
              {
                name: 'record_category',
                label: 'Record category',
                type: 'select',
                required: true,
                options: () => [
                  { value: 'budget', label: 'Budget' },
                  { value: 'expenditure', label: 'Expenditure' },
                  { value: 'procurement', label: 'Procurement' },
                  { value: 'accountability', label: 'Accountability' },
                ],
              },
              {
                name: 'government_level',
                label: 'Government level',
                type: 'select',
                options: () => [
                  { value: 'provincial', label: 'Provincial' },
                  { value: 'municipal', label: 'Municipal' },
                  { value: 'national', label: 'National' },
                ],
              },
              { name: 'municipality_id', label: 'Municipality', type: 'select', options: (l) => (l?.municipalities || []).map((m) => ({ value: m.id, label: m.name })) },
              { name: 'issuing_office', label: 'Issuing office', max: 200 },
              { name: 'fiscal_year', label: 'Fiscal year', type: 'number' },
              { name: 'period_label', label: 'Reporting period', max: 100 },
              { name: 'publication_date', label: 'Publication date' },
              { name: 'source_organization', label: 'Source organisation', max: 200 },
              { name: 'source_url', label: 'Source URL', type: 'url', placeholder: 'https://', full: true },
            ],
          }}
        />
      ) : null}

      {tab === 'documents' ? (
        <ResourceAdmin
          config={{
            title: 'Public documents',
            singular: 'document',
            eyebrow: 'Transparency',
            description: 'Downloadable public documents. Upload files through the media library, then reference the stored path.',
            endpoint: '/admin/documents',
            createPermission: 'transparency.documents.manage',
            columns: [
              { key: 'document_category', label: 'Category' },
              { key: 'fiscal_year', label: 'Year' },
              { key: 'issuing_organization', label: 'Issuer' },
              { key: 'file_type', label: 'File type' },
            ],
            filters: [
              {
                name: 'category',
                label: 'All categories',
                options: () => [
                  { value: 'budget', label: 'Budget' },
                  { value: 'expenditure', label: 'Expenditure' },
                  { value: 'procurement', label: 'Procurement' },
                  { value: 'audit', label: 'Audit' },
                  { value: 'accountability', label: 'Accountability' },
                ],
              },
            ],
            defaultValues: () => ({ document_category: 'budget', government_level: 'provincial' }),
            fields: [
              { name: 'title', label: 'Document title', required: true, max: 250, full: true },
              { name: 'description', label: 'Description', type: 'textarea', max: 4000, full: true },
              {
                name: 'document_category',
                label: 'Category',
                type: 'select',
                required: true,
                options: () => [
                  { value: 'budget', label: 'Budget' },
                  { value: 'expenditure', label: 'Expenditure' },
                  { value: 'procurement', label: 'Procurement' },
                  { value: 'audit', label: 'Audit' },
                  { value: 'accountability', label: 'Accountability' },
                ],
              },
              { name: 'issuing_organization', label: 'Issuing organisation', max: 200 },
              { name: 'government_level', label: 'Government level', type: 'select', options: () => [
                { value: 'provincial', label: 'Provincial' },
                { value: 'municipal', label: 'Municipal' },
                { value: 'national', label: 'National' },
              ] },
              { name: 'municipality_id', label: 'Municipality', type: 'select', options: (l) => (l?.municipalities || []).map((m) => ({ value: m.id, label: m.name })) },
              { name: 'fiscal_year', label: 'Fiscal year', type: 'number' },
              { name: 'publication_date', label: 'Publication date' },
              { name: 'source_url', label: 'Original source URL', type: 'url', placeholder: 'https://', full: true },
              { name: 'file_name', label: 'Stored file name', max: 300 },
              { name: 'file_path', label: 'Stored file path', max: 500, help: 'Must be a path produced by the media library upload.' },
              { name: 'file_type', label: 'MIME type', max: 100 },
            ],
          }}
        />
      ) : null}

      {tab === 'financial' ? (
        <>
          <div className="card">
            <h2 style={{ fontSize: 'var(--text-h4)' }}>Record a financial figure</h2>
            <p className="help">
              Amounts are entered in pesos and stored as integer centavos. New figures are pending verification and are excluded from
              public summaries until verified.
            </p>
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                setBusy(true)
                try {
                  const formData = new FormData(event.currentTarget)
                  await api.post('/admin/financial-records', Object.fromEntries(formData.entries()))
                  toast.push('Financial record saved as pending verification.')
                  event.currentTarget.reset()
                  reload()
                } catch (err) {
                  toast.push(err.message, 'error')
                } finally {
                  setBusy(false)
                }
              }}
            >
              <div className="form-grid">
                <Field label="Fiscal year" htmlFor="fin-year" required>
                  <Input id="fin-year" name="fiscalYear" type="number" required min="1900" max="2200" defaultValue={new Date().getFullYear()} />
                </Field>
                <Field label="Financial category" htmlFor="fin-category" required>
                  <Select id="fin-category" name="financialCategory" required defaultValue="approved_budget">
                    <option value="proposed_budget">Proposed budget</option>
                    <option value="approved_budget">Approved budget</option>
                    <option value="allocation">Allocation</option>
                    <option value="obligation">Obligation</option>
                    <option value="disbursement">Disbursement</option>
                    <option value="expenditure">Expenditure</option>
                  </Select>
                </Field>
                <Field label="Government level" htmlFor="fin-level" required>
                  <Select id="fin-level" name="governmentLevel" required defaultValue="provincial">
                    <option value="provincial">Provincial</option>
                    <option value="municipal">Municipal</option>
                    <option value="national">National</option>
                  </Select>
                </Field>
                <Field label="Department or office" htmlFor="fin-dept">
                  <Input id="fin-dept" name="departmentName" maxLength={200} />
                </Field>
                <Field label="Municipality" htmlFor="fin-municipality" help="Required for municipal administrators.">
                  <select id="fin-municipality" name="municipalityId" className="select" defaultValue="">
                    <option value="">Province-wide</option>
                    {(lookups?.municipalities || []).map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Amount (PHP)" htmlFor="fin-amount" required>
                  <Input id="fin-amount" name="amount" type="number" step="0.01" min="0" required />
                </Field>
                <Field label="Reporting period" htmlFor="fin-period">
                  <Input id="fin-period" name="periodLabel" maxLength={100} placeholder="e.g. FY 2026 Q1" />
                </Field>
                <Field label="Source reference" htmlFor="fin-source" className="field-full">
                  <Input id="fin-source" name="sourceReference" maxLength={500} placeholder="Document title and section" />
                </Field>
              </div>
              <Button type="submit" loading={busy}>Save figure</Button>
            </form>
          </div>

          <div className="table-wrap mt-4">
            <table className="data">
              <thead><tr><th>Year</th><th>Category</th><th>Department</th><th style={{ textAlign: 'right' }}>Amount</th><th>Verified</th><th /></tr></thead>
              <tbody>
                {(data?.results || []).map((row) => (
                  <tr key={row.id}>
                    <td>{row.fiscal_year}</td>
                    <td style={{ textTransform: 'capitalize' }}>{row.financial_category.replace(/_/g, ' ')}</td>
                    <td>{row.department_name || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>₱{(row.amount_cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                    <td><Badge tone={row.verification_status === 'verified' ? 'success' : 'warning'}>{row.verification_status}</Badge></td>
                    <td style={{ textAlign: 'right' }}>
                      {row.verification_status !== 'verified' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              await api.post(`/admin/financial-records/${row.id}/verify`, { approved: true })
                              toast.push('Record verified.')
                              reload()
                            } catch (err) {
                              toast.push(err.message, 'error')
                            }
                          }}
                        >
                          Verify
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.results?.length ? <div style={{ padding: '2rem' }}><EmptyState title="No financial records" description="Figures appear here once entered. Public charts only use verified rows." /></div> : null}
          </div>
        </>
      ) : null}
    </>
  )
}

/* -------------------------------- Emergency ------------------------------ */
export function AdminEmergency() {
  return (
    <ResourceAdmin
      config={{
        title: 'Emergency information',
        singular: 'emergency record',
        eyebrow: 'Content',
        description: 'Verified emergency contacts and facilities. Incorrect emergency numbers can put people at risk — verify every entry.',
        endpoint: '/admin/emergency',
        createPermission: 'emergency.manage',
        columns: [
          { key: 'category', label: 'Category' },
          { key: 'government_level', label: 'Level' },
          { key: 'phone', label: 'Telephone' },
          { key: 'municipality_name', label: 'Municipality', render: (r) => r.municipality_name || 'National' },
          { key: 'last_verified_at', label: 'Verified', render: (r) => (r.last_verified_at ? fmtDate(r.last_verified_at) : 'Not recorded') },
        ],
        filters: [
          {
            name: 'category',
            label: 'All categories',
            options: () => [
              { value: 'national', label: 'National' },
              { value: 'police', label: 'Police' },
              { value: 'fire', label: 'Fire and rescue' },
              { value: 'hospital', label: 'Hospital' },
              { value: 'health', label: 'Health facility' },
              { value: 'disaster', label: 'Disaster response' },
              { value: 'ambulance', label: 'Ambulance' },
            ],
          },
        ],
        defaultValues: () => ({ category: 'disaster', government_level: 'municipal' }),
        fields: [
          { name: 'organization_name', label: 'Organisation or facility name', required: true, max: 200, full: true },
          {
            name: 'category',
            label: 'Category',
            type: 'select',
            required: true,
            options: () => [
              { value: 'police', label: 'Police' },
              { value: 'fire', label: 'Fire and rescue' },
              { value: 'hospital', label: 'Hospital' },
              { value: 'health', label: 'Health facility' },
              { value: 'disaster', label: 'Disaster response' },
              { value: 'ambulance', label: 'Ambulance' },
              { value: 'national', label: 'National resource' },
            ],
          },
          {
            name: 'government_level',
            label: 'Government level',
            type: 'select',
            options: () => [
              { value: 'provincial', label: 'Provincial' },
              { value: 'municipal', label: 'Municipal' },
              { value: 'national', label: 'National' },
            ],
          },
          { name: 'municipality_id', label: 'Municipality', type: 'select', options: (l) => (l?.municipalities || []).map((m) => ({ value: m.id, label: m.name })) },
          { name: 'phone', label: 'Telephone number', max: 40, help: 'Only verified numbers are shown with a call action.' },
          { name: 'alt_phone', label: 'Alternative number', max: 40 },
          { name: 'address', label: 'Address', max: 300, full: true },
          { name: 'operating_hours', label: 'Operating information', max: 200 },
          { name: 'services', label: 'Available services', type: 'textarea', max: 1000, full: true, help: 'Do not claim 24/7 service or emergency capability unless verified.' },
          { name: 'description', label: 'Description', type: 'textarea', max: 2000, full: true },
          { name: 'website', label: 'Official website', type: 'url', placeholder: 'https://' },
          { name: 'source_reference', label: 'Source reference', max: 500, full: true },
          { name: 'source_url', label: 'Source URL', type: 'url', placeholder: 'https://' },
          { name: 'last_verified_at', label: 'Last verified date' },
          { name: 'next_review_at', label: 'Next review date' },
        ],
      }}
    />
  )
}

/* ---------------------------------- CMS ---------------------------------- */
export function AdminCms() {
  useDocumentTitle('Pages and FAQs')
  const [tab, setTab] = useState('pages')
  const { data, loading, reload } = useApi('/admin/cms')
  const { data: faqs, reload: reloadFaqs } = useApi('/admin/faqs')
  const { data: homepage, reload: reloadHomepage } = useApi('/admin/homepage-sections')
  const { can } = useAuth()
  const toast = useToast()
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [revisions, setRevisions] = useState(null)
  const [faqForm, setFaqForm] = useState({ question: '', answer: '', category: '', status: 'draft' })

  const save = async () => {
    setBusy(true)
    try {
      const payload = {
        title: editor.title,
        section: editor.section,
        excerpt: editor.excerpt,
        content: editor.content,
        seoTitle: editor.seo_title,
        seoDescription: editor.seo_description,
        status: editor.id
          ? editor.status
          : ['draft', 'submitted_for_review'].includes(editor.status)
            ? editor.status
            : 'draft',
      }
      if (editor.id) await api.patch(`/admin/cms/${editor.id}`, { ...payload, changeSummary: editor.changeSummary || 'Updated' })
      else await api.post('/admin/cms', payload)
      toast.push('Page saved.')
      setEditor(null)
      reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Content"
        title="Pages, FAQs and homepage"
        description="Manage CMS pages, frequently asked questions and editable homepage sections."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Pages & FAQs' }]}
        actions={
          tab === 'pages' && can('cms.manage') ? (
            <Button icon={Plus} onClick={() => setEditor({ title: '', section: 'general', excerpt: '', content: '', status: 'draft' })}>New page</Button>
          ) : null
        }
      />
      <Tabs
        tabs={[
          { value: 'pages', label: 'Pages' },
          { value: 'faqs', label: 'FAQs' },
          { value: 'homepage', label: 'Homepage sections' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'pages' ? (
        loading ? <SkeletonList count={2} height={100} /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Title</th><th>Section</th><th>Status</th><th>Updated</th><th /></tr></thead>
              <tbody>
                {(data?.results || []).map((page) => (
                  <tr key={page.id}>
                    <td><strong>{page.title}</strong><div className="text-xs text-muted">/{page.slug}</div></td>
                    <td style={{ textTransform: 'capitalize' }}>{page.section}</td>
                    <td><StatusBadge status={page.status} /></td>
                    <td className="text-xs nowrap">{fmtDate(page.updated_at)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditor({ ...page })}>Edit</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={History}
                        onClick={async () => {
                          try {
                            const result = await api.get(`/admin/cms/${page.id}/revisions`)
                            setRevisions({ page, items: result.results })
                          } catch (err) {
                            toast.push(err.message, 'error')
                          }
                        }}
                      >
                        History
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.results?.length ? <div style={{ padding: '2rem' }}><EmptyState icon={FileText} title="No CMS pages" description="Create a page to publish general information, help content or legal documents." /></div> : null}
          </div>
        )
      ) : null}

      {tab === 'faqs' ? (
        <>
          <div className="card mb-4">
            <h2 style={{ fontSize: 'var(--text-h4)' }}>Add an FAQ</h2>
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                setBusy(true)
                try {
                  await api.post('/admin/faqs', faqForm)
                  toast.push('FAQ saved.')
                  setFaqForm({ question: '', answer: '', category: '', status: 'draft' })
                  reloadFaqs()
                } catch (err) {
                  toast.push(err.message, 'error')
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Field label="Question" htmlFor="faq-q" required>
                <Input id="faq-q" value={faqForm.question} onChange={(event) => setFaqForm({ ...faqForm, question: event.target.value })} required minLength={5} maxLength={300} />
              </Field>
              <Field label="Answer" htmlFor="faq-a" required>
                <Textarea id="faq-a" value={faqForm.answer} onChange={(event) => setFaqForm({ ...faqForm, answer: event.target.value })} required minLength={10} maxLength={5000} />
              </Field>
              <div className="form-grid">
                <Field label="Category" htmlFor="faq-c"><Input id="faq-c" value={faqForm.category} onChange={(event) => setFaqForm({ ...faqForm, category: event.target.value })} maxLength={80} /></Field>
                <Field label="Status" htmlFor="faq-s">
                  <Select id="faq-s" value={faqForm.status} onChange={(event) => setFaqForm({ ...faqForm, status: event.target.value })}>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                  </Select>
                </Field>
              </div>
              <Button type="submit" loading={busy}>Save FAQ</Button>
            </form>
          </div>
          <div className="stack">
            {(faqs?.results || []).map((faq) => (
              <div key={faq.id} className="card">
                <div className="row-between">
                  <strong style={{ fontSize: '0.9rem' }}>{faq.question}</strong>
                  <Badge tone={faq.status === 'published' ? 'success' : 'neutral'}>{faq.status}</Badge>
                </div>
                <p className="text-sm text-muted mt-2">{faq.answer}</p>
                <div className="card-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await api.patch(`/admin/faqs/${faq.id}`, { status: faq.status === 'published' ? 'draft' : 'published' })
                        toast.push('FAQ status updated.')
                        reloadFaqs()
                      } catch (err) {
                        toast.push(err.message, 'error')
                      }
                    }}
                  >
                    {faq.status === 'published' ? 'Unpublish' : 'Publish'}
                  </Button>
                  <span className="text-xs text-muted">{faq.category || 'Uncategorised'}</span>
                </div>
              </div>
            ))}
            {!faqs?.results?.length ? <EmptyState icon={FileText} title="No FAQs yet" /> : null}
          </div>
        </>
      ) : null}

      {tab === 'homepage' ? (
        <div className="stack">
          <Alert tone="info" title="Homepage content">
            Section headings and descriptions are editable. Emergency information cannot be disabled. Dynamic sections still read from real
            database records.
          </Alert>
          {(homepage?.results || []).map((section) => (
            <form
              key={section.id}
              className="card"
              onSubmit={async (event) => {
                event.preventDefault()
                const formData = new FormData(event.currentTarget)
                setBusy(true)
                try {
                  const body = {
                    title: formData.get('title'),
                    subtitle: formData.get('subtitle'),
                    sortOrder: formData.get('sortOrder'),
                  }
                  const enabled = formData.get('isEnabled')
                  if (enabled !== null) body.isEnabled = enabled
                  await api.put(`/admin/homepage-sections/${section.id}`, body)
                  toast.push('Section saved.')
                  reloadHomepage()
                } catch (err) {
                  toast.push(err.message, 'error')
                } finally {
                  setBusy(false)
                }
              }}
            >
              <div className="row-between">
                <h3 style={{ fontSize: 'var(--text-h4)', textTransform: 'capitalize' }}>{section.section_key.replace(/_/g, ' ')}</h3>
                <Badge tone={section.is_enabled ? 'success' : 'neutral'}>{section.is_enabled ? 'Enabled' : 'Disabled'}</Badge>
              </div>
              <div className="form-grid mt-2">
                <Field label="Title" htmlFor={`hs-title-${section.id}`}>
                  <Input id={`hs-title-${section.id}`} name="title" defaultValue={section.title || ''} maxLength={200} />
                </Field>
                <Field label="Sort order" htmlFor={`hs-order-${section.id}`}>
                  <Input id={`hs-order-${section.id}`} name="sortOrder" type="number" defaultValue={section.sort_order} min="0" max="100" />
                </Field>
                <Field label="Description" htmlFor={`hs-sub-${section.id}`} className="field-full">
                  <Textarea id={`hs-sub-${section.id}`} name="subtitle" defaultValue={section.subtitle || ''} maxLength={600} style={{ minHeight: 70 }} />
                </Field>
                {section.section_key !== 'emergency' ? (
                  <Field label="Visibility" htmlFor={`hs-enabled-${section.id}`} className="field-full">
                    <Select id={`hs-enabled-${section.id}`} name="isEnabled" defaultValue={String(section.is_enabled)}>
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </Select>
                  </Field>
                ) : null}
              </div>
              <Button type="submit" size="sm" loading={busy}>Save section</Button>
            </form>
          ))}
        </div>
      ) : null}

      <Modal
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={editor?.id ? `Edit page: ${editor.title}` : 'New page'}
        wide
        actions={
          <>
            <Button variant="outline" onClick={() => setEditor(null)}>Cancel</Button>
            <Button onClick={save} loading={busy}>Save page</Button>
          </>
        }
      >
        {editor ? (
          <div className="form-grid">
            <Field label="Title" htmlFor="cms-title" required className="field-full">
              <Input id="cms-title" value={editor.title || ''} onChange={(event) => setEditor({ ...editor, title: event.target.value })} required maxLength={200} />
            </Field>
            <Field label="Section" htmlFor="cms-section">
              <Select id="cms-section" value={editor.section || 'general'} onChange={(event) => setEditor({ ...editor, section: event.target.value })}>
                {['general', 'hero', 'about', 'faq', 'footer', 'legal'].map((section) => <option key={section} value={section}>{section}</option>)}
              </Select>
            </Field>
            <Field label="Status" htmlFor="cms-status">
              <Select id="cms-status" value={editor.status || 'draft'} onChange={(event) => setEditor({ ...editor, status: event.target.value })}>
                {['draft', 'submitted_for_review', 'under_review', 'changes_requested', 'approved', 'published', 'archived'].map((status) => (
                  <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
                ))}
              </Select>
            </Field>
            <Field label="Excerpt" htmlFor="cms-excerpt" className="field-full">
              <Textarea id="cms-excerpt" value={editor.excerpt || ''} onChange={(event) => setEditor({ ...editor, excerpt: event.target.value })} maxLength={500} style={{ minHeight: 70 }} />
            </Field>
            <Field label="Content" htmlFor="cms-content" className="field-full" help="Plain text with optional # headings and - lists. Scripts and embedded HTML are stripped.">
              <Textarea id="cms-content" value={editor.content || ''} onChange={(event) => setEditor({ ...editor, content: event.target.value })} maxLength={100000} style={{ minHeight: 240 }} />
            </Field>
            <Field label="SEO title" htmlFor="cms-seo-title">
              <Input id="cms-seo-title" value={editor.seo_title || ''} onChange={(event) => setEditor({ ...editor, seo_title: event.target.value })} maxLength={200} />
            </Field>
            <Field label="SEO description" htmlFor="cms-seo-desc">
              <Input id="cms-seo-desc" value={editor.seo_description || ''} onChange={(event) => setEditor({ ...editor, seo_description: event.target.value })} maxLength={300} />
            </Field>
            <Field label="Change summary" htmlFor="cms-change" className="field-full">
              <Input id="cms-change" value={editor.changeSummary || ''} onChange={(event) => setEditor({ ...editor, changeSummary: event.target.value })} maxLength={300} />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(revisions)} onClose={() => setRevisions(null)} title={revisions ? `Revision history: ${revisions.page.title}` : ''}>
        {revisions?.items?.length ? (
          <ul className="timeline">
            {revisions.items.map((revision) => (
              <li key={revision.id}>
                <div className="text-sm">Revision {revision.revision_number} · {revision.change_summary}</div>
                <div className="text-xs text-muted">{revision.editor || 'unknown'} · {fmtDate(revision.created_at)}</div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No revisions recorded.</p>}
        <p className="help mt-2">Revisions are preserved. Restoring older content creates a new revision rather than deleting history.</p>
      </Modal>
    </>
  )
}
