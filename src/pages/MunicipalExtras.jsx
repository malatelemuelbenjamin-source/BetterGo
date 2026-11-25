import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarDays,
  Download,
  ExternalLink,
  FileText,
  FolderKanban,
  HelpCircle,
  Mail,
  MapPin,
  Search,
  Sparkles,
  Users,
} from 'lucide-react'
import { api, fmtDate, fmtNumber, query } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { Alert, Badge, EmptyState, Field, Input, Pagination, Select, SkeletonList, Textarea, VerificationBadge } from '../components/ui'
import { PageHeader } from '../components/layout'
import { SectionHeading } from '../components/cards'
import { Markdown } from './Info'

export const PROJECT_STATUS_LABELS = {
  proposed: 'Proposed',
  planned: 'Planned',
  approved: 'Approved',
  scheduled: 'Scheduled',
  ongoing: 'Ongoing',
  suspended: 'Temporarily suspended',
  completed: 'Completed',
  cancelled: 'Cancelled',
  archived: 'Archived',
}

export const APPLICATION_STATUS_LABELS = {
  open: 'Applications open',
  closed: 'Applications closed',
  by_office: 'Apply at the responsible office',
  not_stated: 'Application details not published',
}

const STATUS_TONES = {
  ongoing: 'info',
  completed: 'success',
  planned: 'neutral',
  approved: 'neutral',
  scheduled: 'neutral',
  proposed: 'neutral',
  suspended: 'warning',
  cancelled: 'danger',
  archived: 'neutral',
}

export function statusTone(status) {
  return STATUS_TONES[status] || 'neutral'
}

export function MunicipalStatusPill({ status }) {
  if (!status) return null
  return <Badge tone={statusTone(status)}>{PROJECT_STATUS_LABELS[status] || status}</Badge>
}

/**
 * Small circular progress indicator. The numeric value is always rendered as
 * text as well, so the ring is decorative and never the only signal.
 */
export function ProgressRing({ percent, size = 64, label = 'Reported progress' }) {
  if (percent === null || percent === undefined) return null
  const value = Math.max(0, Math.min(100, Number(percent)))
  const radius = (size - 8) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <span className="progress-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle className="progress-ring-track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth="6" />
        <circle
          className="progress-ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={circumference - (value / 100) * circumference}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="progress-ring-text" aria-label={`${label}: ${value}%`}>{value}%</span>
    </span>
  )
}

/**
 * Honest, published-only snapshot of what a portal currently holds. Renders
 * nothing when the portal has no published records, so it can never suggest
 * activity that does not exist.
 */
export function PortalPulse({ byType, services, offices, announced }) {
  const rows = [
    ['Services', Number(services || 0)],
    ['Offices', Number(offices || 0)],
    ['Announcements', Number(announced || 0)],
    ['News', Number(byType?.news || 0)],
    ['Notices', Number(byType?.notice || 0)],
    ['Projects', Number(byType?.project || 0)],
    ['Programs', Number(byType?.program || 0)],
    ['Resources', Number(byType?.resource || 0)],
    ['FAQs', Number(byType?.faq || 0)],
  ].filter(([, value]) => value > 0)
  if (!rows.length) return null
  const max = Math.max(...rows.map(([, value]) => value))
  return (
    <figure className="pulse-card">
      <figcaption>
        <strong>What this portal publishes</strong>
        <span className="text-xs text-muted">Published records only. Nothing is estimated.</span>
      </figcaption>
      <ul className="pulse-list">
        {rows.map(([label, value]) => (
          <li key={label}>
            <span className="pulse-label">{label}</span>
            <span className="pulse-track" aria-hidden="true">
              <span style={{ width: `${Math.max(6, (value / max) * 100)}%` }} />
            </span>
            <span className="pulse-value">{fmtNumber(value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function ProgressBar({ percent, note }) {
  if (percent === null || percent === undefined) return null
  const value = Math.max(0, Math.min(100, Number(percent)))
  return (
    <div className="progress-block">
      <div className="row-between text-xs">
        <span>Reported progress</span>
        <strong>{value}%</strong>
      </div>
      <div className="progress-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label="Reported project progress">
        <span style={{ width: `${value}%` }} />
      </div>
      <p className="help">
        {note || 'Reported by the responsible office. Progress figures are published only when supported by a recorded public source.'}
      </p>
    </div>
  )
}

function ProjectCard({ item }) {
  return (
    <Link to={`/municipalities/${item.municipality_slug}/projects/${item.slug}`} className="card card-interactive card-link">
      <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
        <MunicipalStatusPill status={item.project_status} />
        {item.is_featured ? <Badge tone="info">Featured</Badge> : null}
        <VerificationBadge status={item.verification_status} />
      </div>
      <div className="project-card-head">
        <div>
          <h3 style={{ fontSize: '1.02rem' }}>{item.title}</h3>
          {item.summary ? <p>{item.summary}</p> : null}
        </div>
        {item.progress_percent !== null && item.progress_percent !== undefined ? (
          <ProgressRing percent={item.progress_percent} size={58} />
        ) : null}
      </div>
      <div className="card-meta">
        <span><MapPin size={11} aria-hidden="true" /> {item.municipality_name}</span>
        {item.office_name ? <span><Building2 size={11} aria-hidden="true" /> {item.office_name}</span> : null}
        {item.progress_percent !== null && item.progress_percent !== undefined ? <span>{item.progress_percent}% reported</span> : null}
      </div>
    </Link>
  )
}

function MunicipalityFilter({ value, onChange, portals }) {
  return (
    <Field label="Municipality" htmlFor="municipality-filter">
      <Select id="municipality-filter" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All municipalities</option>
        {(portals || []).map((portal) => (
          <option key={portal.slug} value={portal.slug}>{portal.name}</option>
        ))}
      </Select>
    </Field>
  )
}

/* ------------------------------- Projects -------------------------------- */

export function MunicipalProjects() {
  const [params, setParams] = useSearchParams()
  const [term, setTerm] = useState(params.get('q') || '')
  useDocumentTitle('Municipal projects')
  const page = Number(params.get('page') || 1)
  const { data: portals } = useApi('/municipal-portals')
  const { data, loading } = useApi(
    `/municipal-projects${query({
      municipality: params.get('municipality'),
      status: params.get('status'),
      q: params.get('q'),
      sort: params.get('sort'),
      page,
      limit: 12,
    })}`,
  )

  const update = (key, value) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      next.delete('page')
      return next
    })
  }

  return (
    <>
      <PageHeader
        eyebrow="Municipal projects"
        title="Public projects across Marinduque"
        description="Development projects published by each municipal portal. Status and progress are shown only as reported by the responsible office with a recorded source."
        breadcrumbs={[{ label: 'Municipalities', to: '/municipalities' }, { label: 'Projects' }]}
      />
      <div className="container section-tight">
        <Alert tone="info" title="Project information is reported, not inspected">
          BetterGo does not inspect construction sites, verify budgets or track contractors in this module. Projects appear only after an authorised
          municipal administrator publishes them, and progress figures are attributed to their cited source.
        </Alert>

        <form
          className="card filter-row mt-4"
          onSubmit={(event) => {
            event.preventDefault()
            update('q', term.trim())
          }}
        >
          <Field label="Search projects" htmlFor="project-search">
            <Input id="project-search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Title or description" />
          </Field>
          <MunicipalityFilter value={params.get('municipality') || ''} onChange={(value) => update('municipality', value)} portals={portals?.results} />
          <Field label="Status" htmlFor="project-status">
            <Select id="project-status" value={params.get('status') || ''} onChange={(event) => update('status', event.target.value)}>
              <option value="">Any reported status</option>
              {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </Field>
          <div className="filter-actions">
            <button className="btn btn-primary" type="submit"><Search size={14} aria-hidden="true" /> Apply filters</button>
          </div>
        </form>

        <div className="mt-4">
          {loading ? (
            <SkeletonList count={3} />
          ) : data?.results?.length ? (
            <>
              <p className="text-sm text-muted">{fmtNumber(data.total)} published project record{data.total === 1 ? '' : 's'}.</p>
              <div className="grid grid-2 mt-3">
                {data.results.map((item) => <ProjectCard key={item.id} item={item} />)}
              </div>
              {data.totalPages > 1 ? (
                <Pagination
                  page={data.page}
                  totalPages={data.totalPages}
                  onChange={(next) => setParams((current) => {
                    const updated = new URLSearchParams(current)
                    updated.set('page', String(next))
                    return updated
                  })}
                />
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={FolderKanban}
              title="No published municipal projects yet"
              description="Projects appear here only after a municipality publishes them through its review workflow. BetterGo does not create project records from news reports or estimates."
              action={<Link className="btn btn-outline" to="/municipalities">Browse municipal portals</Link>}
            />
          )}
        </div>
      </div>
    </>
  )
}

/* --------------------------- Project detail ------------------------------ */

export function MunicipalProjectDetail() {
  const { slug, projectSlug } = useParams()
  const { data, loading, error } = useApi(slug && projectSlug ? `/municipal-portals/${slug}/projects/${projectSlug}` : null)
  useDocumentTitle(data?.record?.title || 'Municipal project')

  if (loading) return <div className="container section"><SkeletonList count={2} height={220} /></div>
  if (error || !data?.record) {
    return (
      <div className="container section">
        <EmptyState
          icon={FolderKanban}
          title="This project is not available"
          description="It may have been unpublished, archived, or not yet approved for public view."
          action={<Link className="btn btn-primary" to="/municipal-projects">All municipal projects</Link>}
        />
      </div>
    )
  }

  const { municipality, record, updates, related, services } = data
  const isProgram = record.content_type === 'program'

  return (
    <>
      <PageHeader
        eyebrow={`${isProgram ? 'Municipal program' : 'Municipal project'} · ${municipality.name}`}
        title={record.title}
        description={record.summary}
        breadcrumbs={[
          { label: 'Municipalities', to: '/municipalities' },
          { label: municipality.name, to: `/municipalities/${municipality.slug}` },
          { label: isProgram ? 'Programs' : 'Projects', to: `/municipalities/${municipality.slug}/${isProgram ? 'programs' : 'projects'}` },
          { label: record.title },
        ]}
        actions={
          <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
            {isProgram ? <Badge tone="info">{APPLICATION_STATUS_LABELS[record.application_status] || 'Application details not published'}</Badge> : <MunicipalStatusPill status={record.project_status} />}
            <VerificationBadge status={record.verification_status} />
          </div>
        }
      />
      <div className="container section-tight">
        <div className="grid grid-main-aside">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <article className="card">
              {record.featured_image ? (
                <figure className="content-figure">
                  <img src={record.featured_image} alt={record.image_alt || record.title} />
                  {record.image_credit ? <figcaption className="help">Image: {record.image_credit}</figcaption> : null}
                </figure>
              ) : null}
              <div className="prose">
                <Markdown text={record.body || record.summary || ''} />
              </div>
              {!isProgram ? (
                record.progress_percent !== null && record.progress_percent !== undefined ? (
                  <ProgressBar percent={record.progress_percent} note={record.progress_note} />
                ) : (
                  <p className="help mt-3">Project progress information has not been verified or published.</p>
                )
              ) : null}
            </article>

            {record.eligibility || record.beneficiaries ? (
              <section className="card">
                <h2 style={{ fontSize: 'var(--text-h3)' }}>Who can participate</h2>
                {record.eligibility ? (
                  <>
                    <h3 style={{ fontSize: 'var(--text-h4)', marginTop: 'var(--space-3)' }}>Eligibility</h3>
                    <p className="text-muted" style={{ whiteSpace: 'pre-line' }}>{record.eligibility}</p>
                  </>
                ) : null}
                {record.beneficiaries ? (
                  <>
                    <h3 style={{ fontSize: 'var(--text-h4)', marginTop: 'var(--space-3)' }}>Intended beneficiaries</h3>
                    <p className="text-muted" style={{ whiteSpace: 'pre-line' }}>{record.beneficiaries}</p>
                  </>
                ) : null}
              </section>
            ) : null}

            {updates.length ? (
              <section className="card">
                <h2 style={{ fontSize: 'var(--text-h3)' }}>Public updates</h2>
                <ol className="timeline mt-3">
                  {updates.map((update) => (
                    <li key={update.id}>
                      <div className="row-between">
                        <strong>{update.title || 'Progress update'}</strong>
                        <span className="text-xs text-muted">{fmtDate(update.reported_on || update.created_at)}</span>
                      </div>
                      {update.description ? <p className="text-sm text-muted">{update.description}</p> : null}
                      {update.progress_percent !== null && update.progress_percent !== undefined ? (
                        <p className="text-xs"><Badge tone="info">{update.progress_percent}% reported</Badge></p>
                      ) : null}
                      {update.source_reference ? <p className="help">Source: {update.source_reference}</p> : null}
                      {update.source_url ? (
                        <a className="text-xs" href={update.source_url} target="_blank" rel="noopener noreferrer">View source</a>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {record.attachment_url ? (
              <p>
                <a className="btn btn-outline" href={record.attachment_url} target="_blank" rel="noopener noreferrer">
                  <Download size={14} aria-hidden="true" /> {record.attachment_label || 'Public attachment'}
                </a>
              </p>
            ) : null}

            <div className="card-meta">
              {record.published_at ? <span>Published {fmtDate(record.published_at)}</span> : null}
              {record.progress_updated_at ? <span>Progress last reported {fmtDate(record.progress_updated_at)}</span> : null}
              {record.source_reference ? <span>Source: {record.source_reference}</span> : null}
            </div>
          </div>

          <aside className="stack">
            <div className="card">
              <h2 style={{ fontSize: 'var(--text-h4)' }}>Reported schedule</h2>
              <dl className="detail-list mt-2">
                <div className="detail-item"><dt>Start</dt><dd>{record.starts_at || record.event_start ? fmtDate(record.starts_at || record.event_start) : 'Not published'}</dd></div>
                <div className="detail-item"><dt>Expected end</dt><dd>{record.ends_at || record.event_end ? fmtDate(record.ends_at || record.event_end) : 'Not published'}</dd></div>
                {record.venue ? <div className="detail-item"><dt>Venue</dt><dd>{record.venue}</dd></div> : null}
                {record.address ? <div className="detail-item"><dt>Location</dt><dd>{record.address}</dd></div> : null}
                {record.barangay ? <div className="detail-item"><dt>Barangay</dt><dd>{record.barangay}</dd></div> : null}
              </dl>
              <p className="help mt-2">Planned and actual dates are shown separately and only when published.</p>
            </div>

            {record.office_name ? (
              <div className="card">
                <h2 style={{ fontSize: 'var(--text-h4)' }}>Responsible office</h2>
                <p className="text-sm"><Link to={`/government-directory/${record.office_slug}`}>{record.office_name}</Link></p>
                {record.office_address ? <p className="text-sm text-muted">{record.office_address}</p> : null}
                {record.office_phone ? <p className="text-sm"><a href={`tel:${String(record.office_phone).replace(/[^0-9+]/g, '')}`}>{record.office_phone}</a></p> : null}
                {record.office_email ? <p className="text-sm"><a href={`mailto:${record.office_email}`}>{record.office_email}</a></p> : null}
              </div>
            ) : null}

            {services.length ? (
              <div className="card">
                <h2 style={{ fontSize: 'var(--text-h4)' }}>Related municipal services</h2>
                <ul className="link-list mt-2">
                  {services.map((service) => <li key={service.id}><Link to={`/services/${service.slug}`}>{service.title}</Link></li>)}
                </ul>
              </div>
            ) : null}

            {related.length ? (
              <div className="card">
                <h2 style={{ fontSize: 'var(--text-h4)' }}>More from {municipality.name}</h2>
                <ul className="link-list mt-2">
                  {related.map((item) => (
                    <li key={item.id}><Link to={`/municipalities/${municipality.slug}/content/${item.slug}`}>{item.title}</Link></li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Alert tone="warning" title="Report outdated information">
              If this record looks wrong or out of date, send a correction. Submissions are reviewed by an administrator and never change the record
              directly.{' '}
              <Link to={`/municipal-feedback?municipality=${municipality.slug}&content=${record.slug}`}>Report a correction</Link>.
            </Alert>
          </aside>
        </div>
      </div>
    </>
  )
}

/* -------------------------------- Programs ------------------------------- */

export function MunicipalPrograms() {
  const [params, setParams] = useSearchParams()
  useDocumentTitle('Municipal programs')
  const { data: portals } = useApi('/municipal-portals')
  const { data, loading } = useApi(
    `/municipal-programs${query({
      municipality: params.get('municipality'),
      upcoming: params.get('upcoming') === 'true' ? 'true' : '',
      page: params.get('page') || 1,
      limit: 12,
    })}`,
  )

  return (
    <>
      <PageHeader
        eyebrow="Programs and initiatives"
        title="Community programs across Marinduque"
        description="Municipal programs, activities and initiatives published by each portal. Application availability is stated only when a municipality publishes it."
        breadcrumbs={[{ label: 'Municipalities', to: '/municipalities' }, { label: 'Programs' }]}
      />
      <div className="container section-tight">
        <div className="card filter-row">
          <MunicipalityFilter
            value={params.get('municipality') || ''}
            onChange={(value) => setParams((current) => {
              const next = new URLSearchParams(current)
              if (value) next.set('municipality', value)
              else next.delete('municipality')
              return next
            })}
            portals={portals?.results}
          />
          <div className="filter-actions">
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={params.get('upcoming') === 'true'}
                onChange={(event) => setParams((current) => {
                  const next = new URLSearchParams(current)
                  if (event.target.checked) next.set('upcoming', 'true')
                  else next.delete('upcoming')
                  return next
                })}
              />
              Upcoming only
            </label>
          </div>
        </div>

        <div className="mt-4">
          {loading ? (
            <SkeletonList count={3} />
          ) : data?.results?.length ? (
            <>
              <div className="grid grid-2">
                {data.results.map((item) => (
                  <Link key={item.id} to={`/municipalities/${item.municipality_slug}/programs/${item.slug}`} className="card card-interactive card-link">
                    <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                      <Badge tone={item.application_status === 'open' ? 'success' : 'neutral'}>
                        {APPLICATION_STATUS_LABELS[item.application_status] || 'Application details not published'}
                      </Badge>
                      <VerificationBadge status={item.verification_status} />
                    </div>
                    <h3 style={{ fontSize: '1.02rem' }}>{item.title}</h3>
                    {item.summary ? <p>{item.summary}</p> : null}
                    <div className="card-meta">
                      <span><MapPin size={11} aria-hidden="true" /> {item.municipality_name}</span>
                      {item.event_start ? <span><CalendarDays size={11} aria-hidden="true" /> {fmtDate(item.event_start)}</span> : null}
                    </div>
                  </Link>
                ))}
              </div>
              {data.totalPages > 1 ? (
                <Pagination
                  page={data.page}
                  totalPages={data.totalPages}
                  onChange={(next) => setParams((current) => {
                    const updated = new URLSearchParams(current)
                    updated.set('page', String(next))
                    return updated
                  })}
                />
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="No published municipal programs yet"
              description="Programs appear here only after a municipality publishes them through its review workflow."
            />
          )}
        </div>
      </div>
    </>
  )
}

/* ------------------------------- Resources ------------------------------- */

export function MunicipalResources() {
  const [params, setParams] = useSearchParams()
  const [term, setTerm] = useState(params.get('q') || '')
  useDocumentTitle('Municipal public resources')
  const { data: portals } = useApi('/municipal-portals')
  const { data, loading } = useApi(
    `/municipal-resources${query({
      municipality: params.get('municipality'),
      category: params.get('category'),
      q: params.get('q'),
    })}`,
  )

  return (
    <>
      <PageHeader
        eyebrow="Resources and documents"
        title="Municipal public resource center"
        description="Forms, guides, notices and public documents published by the municipal portals. Unofficial materials are never presented as government-issued documents."
        breadcrumbs={[{ label: 'Municipalities', to: '/municipalities' }, { label: 'Resources' }]}
      />
      <div className="container section-tight">
        <form
          className="card filter-row"
          onSubmit={(event) => {
            event.preventDefault()
            setParams((current) => {
              const next = new URLSearchParams(current)
              if (term.trim()) next.set('q', term.trim())
              else next.delete('q')
              return next
            })
          }}
        >
          <Field label="Search resources" htmlFor="resource-search">
            <Input id="resource-search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Title or description" />
          </Field>
          <MunicipalityFilter
            value={params.get('municipality') || ''}
            onChange={(value) => setParams((current) => {
              const next = new URLSearchParams(current)
              if (value) next.set('municipality', value)
              else next.delete('municipality')
              return next
            })}
            portals={portals?.results}
          />
          {data?.categories?.length ? (
            <Field label="Document category" htmlFor="resource-category">
              <Select
                id="resource-category"
                value={params.get('category') || ''}
                onChange={(event) => setParams((current) => {
                  const next = new URLSearchParams(current)
                  if (event.target.value) next.set('category', event.target.value)
                  else next.delete('category')
                  return next
                })}
              >
                <option value="">All categories</option>
                {data.categories.map((category) => (
                  <option key={category.value} value={category.value}>{category.value.replace(/_/g, ' ')}</option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="filter-actions">
            <button className="btn btn-primary" type="submit"><Search size={14} aria-hidden="true" /> Search</button>
          </div>
        </form>

        <div className="mt-4">
          {loading ? (
            <SkeletonList count={3} />
          ) : data?.results?.length ? (
            <div className="stack">
              {data.results.map((item) => (
                item.source_kind === 'document' ? (
                  <div key={`doc-${item.id}`} className="card">
                    <div className="row-between">
                      <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                        <Badge>{String(item.document_category || 'Document').replace(/_/g, ' ')}</Badge>
                        {item.resource_type ? <Badge tone="info">{item.resource_type}</Badge> : null}
                        <VerificationBadge status={item.verification_status} />
                      </div>
                      <span className="text-xs text-muted">{item.municipality_name || 'Province-wide'}</span>
                    </div>
                    <h3 style={{ fontSize: '1rem' }}>{item.title}</h3>
                    {item.description ? <p>{item.description}</p> : null}
                    <div className="row mt-2" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                      <Link className="btn btn-outline btn-sm" to={`/transparency/documents/${item.slug}`}>
                        <FileText size={13} aria-hidden="true" /> View document record
                      </Link>
                      {item.external_url ? (
                        <a className="btn btn-ghost btn-sm" href={item.external_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink size={13} aria-hidden="true" /> Official link
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <Link key={`content-${item.id}`} to={`/municipalities/${item.municipality_slug}/content/${item.slug}`} className="card card-interactive card-link">
                    <div className="row-between">
                      <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                        <Badge>Public resource</Badge>
                        <VerificationBadge status={item.verification_status} />
                      </div>
                      <span className="text-xs text-muted">{item.municipality_name}</span>
                    </div>
                    <h3 style={{ fontSize: '1rem' }}>{item.title}</h3>
                    {item.summary ? <p>{item.summary}</p> : null}
                  </Link>
                )
              ))}
            </div>
          ) : (
            <EmptyState
              icon={FileText}
              title="No published resources yet"
              description="Municipal forms, guides and documents appear here after an authorised administrator publishes them."
              action={<Link className="btn btn-outline" to="/transparency/documents">Browse provincial documents</Link>}
            />
          )}
        </div>
      </div>
    </>
  )
}

/* --------------------------------- FAQs ---------------------------------- */

export function MunicipalFaqs() {
  const [params, setParams] = useSearchParams()
  useDocumentTitle('Municipal frequently asked questions')
  const { data: portals } = useApi('/municipal-portals')
  const { data, loading } = useApi(`/municipal-faqs${query({ municipality: params.get('municipality') })}`)
  const grouped = useMemo(() => {
    const map = new Map()
    for (const row of data?.results || []) {
      const key = row.municipality_name || 'Province-wide'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(row)
    }
    return [...map.entries()]
  }, [data])

  return (
    <>
      <PageHeader
        eyebrow="Citizen guidance"
        title="Municipal frequently asked questions"
        description="Answers published by municipal portals about services, requirements and procedures. Answers are not legal advice."
        breadcrumbs={[{ label: 'Municipalities', to: '/municipalities' }, { label: 'FAQs' }]}
      />
      <div className="container section-tight">
        <div className="card filter-row">
          <MunicipalityFilter
            value={params.get('municipality') || ''}
            onChange={(value) => setParams((current) => {
              const next = new URLSearchParams(current)
              if (value) next.set('municipality', value)
              else next.delete('municipality')
              return next
            })}
            portals={portals?.results}
          />
        </div>

        <div className="mt-4">
          {loading ? (
            <SkeletonList count={3} />
          ) : grouped.length ? (
            <div className="stack" style={{ gap: 'var(--space-5)' }}>
              {grouped.map(([name, rows]) => (
                <section key={name} aria-labelledby={`faq-${name}`}>
                  <h2 id={`faq-${name}`} style={{ fontSize: 'var(--text-h3)' }}>{name}</h2>
                  <div className="stack mt-2">
                    {rows.map((row) => (
                      <details key={row.id} className="faq-item">
                        <summary>{row.title}</summary>
                        <div className="prose mt-2"><Markdown text={row.body || row.summary || ''} /></div>
                        {row.source_reference ? <p className="help">Source: {row.source_reference}</p> : null}
                      </details>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={HelpCircle}
              title="No published FAQs yet"
              description="Municipal FAQs appear here after an authorised editor publishes them with a source."
            />
          )}
        </div>
      </div>
    </>
  )
}

/* --------------------------------- Map ----------------------------------- */

export function MunicipalOfficeMap() {
  const [params, setParams] = useSearchParams()
  useDocumentTitle('Municipal office map')
  const { data: portals } = useApi('/municipal-portals')
  const municipality = params.get('municipality') || ''
  const { data, loading } = useApi(`/municipal-offices${query({ municipality })}`)
  const markers = data?.markers || []
  const center = markers.length
    ? markers.reduce((acc, marker) => ({ lat: acc.lat + marker.latitude / markers.length, lng: acc.lng + marker.longitude / markers.length }), { lat: 0, lng: 0 })
    : null
  const bbox = center ? [center.lng - 0.03, center.lat - 0.02, center.lng + 0.03, center.lat + 0.02].join('%2C') : null

  return (
    <>
      <PageHeader
        eyebrow="Office locations"
        title="Municipal office map"
        description="Locations of municipal offices whose coordinates have been verified by an authorised administrator. Unverified addresses are listed without a map marker."
        breadcrumbs={[{ label: 'Municipalities', to: '/municipalities' }, { label: 'Office map' }]}
      />
      <div className="container section-tight">
        <div className="card filter-row">
          <MunicipalityFilter
            value={municipality}
            onChange={(value) => setParams(value ? { municipality: value } : {})}
            portals={portals?.results}
          />
        </div>

        <div className="mt-4">
          {loading ? (
            <SkeletonList count={2} height={240} />
          ) : (
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              {markers.length ? (
                <div className="map-frame">
                  <iframe
                    title="Municipal office locations on OpenStreetMap"
                    loading="lazy"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${center.lat}%2C${center.lng}`}
                  />
                  <p className="help">
                    Map tiles by OpenStreetMap contributors, available under the Open Database License. Only the average verified location is shown
                    here; each office below links to its own marker.
                  </p>
                </div>
              ) : (
                <Alert tone="info" title="No verified office coordinates yet">
                  BetterGo does not estimate or infer locations. A map marker appears only after an authorised administrator records coordinates and
                  marks them verified. The offices below are published without a map location.
                </Alert>
              )}

              {data?.results?.length ? (
                <div className="stack">
                  {data.results.map((office) => (
                    <div key={office.id} className="card">
                      <div className="row-between">
                        <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                          <Badge>{office.office_level === 'department' ? 'Department' : office.office_type || 'Office'}</Badge>
                          <VerificationBadge status={office.verification_status} />
                          {office.location_verified === 1 ? <Badge tone="success">Verified location</Badge> : null}
                        </div>
                        <span className="text-xs text-muted">{office.municipality_name}</span>
                      </div>
                      <h3 style={{ fontSize: '1rem' }}><Link to={`/government-directory/${office.slug}`}>{office.name}</Link></h3>
                      {office.parent_office_name ? <p className="text-xs text-muted">Part of {office.parent_office_name}</p> : null}
                      {office.address ? <p className="text-sm text-muted">{office.address}</p> : null}
                      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                        {office.location_verified === 1 && office.latitude !== null ? (
                          <a
                            className="btn btn-ghost btn-sm"
                            href={`https://www.openstreetmap.org/?mlat=${office.latitude}&mlon=${office.longitude}#map=17/${office.latitude}/${office.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <MapPin size={13} aria-hidden="true" /> Open in OpenStreetMap
                          </a>
                        ) : (
                          <span className="text-xs text-muted">Map location not verified</span>
                        )}
                        {office.phone ? <a className="btn btn-ghost btn-sm" href={`tel:${String(office.phone).replace(/[^0-9+]/g, '')}`}>{office.phone}</a> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Building2}
                  title="No published municipal offices yet"
                  description="Office records are added by authorised administrators after verification."
                  action={<Link className="btn btn-outline" to="/government-directory">Browse the government directory</Link>}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/* ------------------------------- Discovery ------------------------------- */

export function MunicipalDiscovery() {
  const [params, setParams] = useSearchParams()
  const [term, setTerm] = useState(params.get('q') || '')
  useDocumentTitle('Search municipal information')
  const q = params.get('q') || ''
  const { data, loading } = useApi(q ? `/municipal-search${query({ q, municipality: params.get('municipality') })}` : null)
  const { data: portals } = useApi('/municipal-portals')

  return (
    <>
      <PageHeader
        eyebrow="Cross-municipality search"
        title="Search all six municipal portals"
        description="Search published municipal updates, offices, services and public documents across Marinduque. Draft and unpublished records are never searchable."
      />
      <div className="container section-tight">
        <form
          className="card filter-row"
          onSubmit={(event) => {
            event.preventDefault()
            setParams(term.trim() ? { q: term.trim(), ...(params.get('municipality') ? { municipality: params.get('municipality') } : {}) } : {})
          }}
        >
          <Field label="Search municipal information" htmlFor="municipal-search-q">
            <Input id="municipal-search-q" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Office, service, notice or document" />
          </Field>
          <MunicipalityFilter
            value={params.get('municipality') || ''}
            onChange={(value) => setParams((current) => {
              const next = new URLSearchParams(current)
              if (value) next.set('municipality', value)
              else next.delete('municipality')
              return next
            })}
            portals={portals?.results}
          />
          <div className="filter-actions">
            <button className="btn btn-primary" type="submit"><Search size={14} aria-hidden="true" /> Search</button>
          </div>
        </form>

        <div className="mt-4">
          {!q ? (
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              <EmptyState icon={Search} title="Enter a search term" description="Try an office name, a service, or a topic such as business permit." />
              <div className="suggestion-row" aria-label="Suggested searches">
                {['business permit', 'health', 'barangay clearance', 'water', 'waste', 'projects'].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="chip-button"
                    onClick={() => {
                      setTerm(suggestion)
                      setParams({ q: suggestion, ...(params.get('municipality') ? { municipality: params.get('municipality') } : {}) })
                    }}
                  >
                    <Search size={12} aria-hidden="true" /> {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : loading ? (
            <SkeletonList count={3} />
          ) : data?.total ? (
            <div className="stack" style={{ gap: 'var(--space-5)' }}>
              <p className="text-sm text-muted">{fmtNumber(data.total)} published result{data.total === 1 ? '' : 's'} for “{data.query}”.</p>
              {data.groups.updates.length ? (
                <section>
                  <h2 style={{ fontSize: 'var(--text-h3)' }}>Municipal updates</h2>
                  <div className="grid grid-2 mt-2">
                    {data.groups.updates.map((item) => (
                      <Link key={item.id} to={`/municipalities/${item.municipality_slug}/content/${item.slug}`} className="card card-interactive card-link">
                        <Badge>{item.content_type}</Badge>
                        <h3 style={{ fontSize: '1rem' }}>{item.title}</h3>
                        <p className="text-sm text-muted">{item.municipality_name}</p>
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
              {data.groups.offices.length ? (
                <section>
                  <h2 style={{ fontSize: 'var(--text-h3)' }}>Offices</h2>
                  <ul className="link-list mt-2">
                    {data.groups.offices.map((office) => (
                      <li key={office.id}><Link to={`/government-directory/${office.slug}`}>{office.name}</Link> <span className="text-xs text-muted">{office.municipality_name}</span></li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {data.groups.services.length ? (
                <section>
                  <h2 style={{ fontSize: 'var(--text-h3)' }}>Services</h2>
                  <ul className="link-list mt-2">
                    {data.groups.services.map((service) => (
                      <li key={service.id}><Link to={`/services/${service.slug}`}>{service.title}</Link> <span className="text-xs text-muted">{service.municipality_name || 'Province-wide'}</span></li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {data.groups.documents.length ? (
                <section>
                  <h2 style={{ fontSize: 'var(--text-h3)' }}>Documents</h2>
                  <ul className="link-list mt-2">
                    {data.groups.documents.map((document) => (
                      <li key={document.id}><Link to={`/transparency/documents/${document.slug}`}>{document.title}</Link></li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : (
            <EmptyState icon={Search} title="No published results" description="Nothing published matches that search. Try a broader term or browse a municipal portal." />
          )}
        </div>
      </div>
    </>
  )
}

/* ---------------------------- Feedback form ------------------------------ */

export function MunicipalFeedbackPage() {
  const [params] = useSearchParams()
  const [track, setTrack] = useState({ reference: '', email: '', result: null, error: '' })
  const [state, setState] = useState({ kind: 'correction', name: '', email: '', message: '' })
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  useDocumentTitle('Report municipal information')
  const { data: portals } = useApi('/municipal-portals')

  async function submit(event) {
    event.preventDefault()
    setSending(true)
    setError('')
    try {
      const response = await api.post('/municipal-feedback', {
        municipality: params.get('municipality') || undefined,
        content_slug: params.get('content') || undefined,
        kind: state.kind,
        name: state.name,
        email: state.email,
        message: state.message,
        page_url: typeof window !== 'undefined' ? window.location.href : undefined,
      })
      setResult(response)
      setState({ kind: 'correction', name: '', email: '', message: '' })
    } catch (err) {
      setError(err.message || 'Your message could not be sent.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Public feedback"
        title="Report incorrect or missing municipal information"
        description="Tell us what looks wrong. Messages are reviewed by an administrator; they never change an official record directly."
        breadcrumbs={[{ label: 'Municipalities', to: '/municipalities' }, { label: 'Report information' }]}
      />
      <div className="container section-tight">
        <div className="grid grid-main-aside">
          <form className="card" onSubmit={submit}>
            {result ? <Alert tone="success" title="Message received">{result.message}</Alert> : null}
            {error ? <Alert tone="danger" title="Message not sent">{error}</Alert> : null}
            <Field label="What is this about?" htmlFor="feedback-kind">
              <Select id="feedback-kind" value={state.kind} onChange={(event) => setState({ ...state, kind: event.target.value })}>
                <option value="correction">Incorrect or outdated information</option>
                <option value="missing">Missing information</option>
                <option value="suggestion">Suggestion</option>
                <option value="concern">Concern</option>
              </Select>
            </Field>
            <div className="grid grid-2 mt-3">
              <Field label="Your name (optional)" htmlFor="feedback-name">
                <Input id="feedback-name" value={state.name} onChange={(event) => setState({ ...state, name: event.target.value })} maxLength={120} />
              </Field>
              <Field label="Email (optional, for a reply)" htmlFor="feedback-email">
                <Input id="feedback-email" type="email" value={state.email} onChange={(event) => setState({ ...state, email: event.target.value })} maxLength={200} />
              </Field>
            </div>
            <Field label="Message" htmlFor="feedback-message" required help="Do not include sensitive personal information. 10–4000 characters.">
              <Textarea
                id="feedback-message"
                value={state.message}
                onChange={(event) => setState({ ...state, message: event.target.value })}
                rows={6}
                minLength={10}
                maxLength={4000}
                required
              />
            </Field>
            <p className="help">
              Sent to the municipal workspace{params.get('municipality') ? ` for ${params.get('municipality')}` : ''}. Under the Data Privacy Act,
              only the details you provide here are stored, and only to review this message.
            </p>
            <button className="btn btn-primary mt-3" type="submit" disabled={sending}>
              {sending ? 'Sending…' : 'Send message'}
            </button>
          </form>

          <aside className="stack">
            {result?.feedback?.reference ? (
              <div className="card reference-card">
                <h2 style={{ fontSize: 'var(--text-h4)' }}>Your reference</h2>
                <p className="reference-code">{result.feedback.reference}</p>
                <p className="help">Keep this reference and the email you provided to check the status later. It is not an official LGU case number.</p>
              </div>
            ) : null}
            <div className="card">
              <h2 style={{ fontSize: 'var(--text-h4)' }}>Check a message status</h2>
              <form
                className="stack-sm mt-2"
                onSubmit={async (event) => {
                  event.preventDefault()
                  setTrack((current) => ({ ...current, error: '', result: null }))
                  try {
                    const response = await api.post('/municipal-feedback/track', { reference: track.reference, email: track.email })
                    setTrack((current) => ({ ...current, result: response.inquiry }))
                  } catch (err) {
                    setTrack((current) => ({ ...current, error: err.message || 'Status not found.' }))
                  }
                }}
              >
                <Field label="Reference" htmlFor="track-reference" required>
                  <Input id="track-reference" value={track.reference} onChange={(event) => setTrack({ ...track, reference: event.target.value })} placeholder="BGM-XXXXX-XXX" maxLength={40} required />
                </Field>
                <Field label="Email used" htmlFor="track-email" required>
                  <Input id="track-email" type="email" value={track.email} onChange={(event) => setTrack({ ...track, email: event.target.value })} maxLength={200} required />
                </Field>
                <button className="btn btn-outline btn-sm" type="submit">Check status</button>
                {track.error ? <Alert tone="danger">{track.error}</Alert> : null}
                {track.result ? (
                  <Alert tone="success" title={`Status: ${track.result.status}`}>
                    {track.result.note} Submitted {fmtDate(track.result.submitted_at)}
                    {track.result.reviewed_at ? ` · reviewed ${fmtDate(track.result.reviewed_at)}` : ''}.
                  </Alert>
                ) : null}
              </form>
            </div>
            <div className="card">
              <h2 style={{ fontSize: 'var(--text-h4)' }}>What happens next</h2>
              <ol className="link-list text-sm">
                <li>An administrator reviews the message.</li>
                <li>If the official record needs a change, they update it through the review workflow with a source.</li>
                <li>Corrections are never applied automatically from a public submission.</li>
              </ol>
            </div>
            <div className="card">
              <h2 style={{ fontSize: 'var(--text-h4)' }}>Municipal portals</h2>
              <ul className="link-list">
                {(portals?.results || []).map((portal) => (
                  <li key={portal.slug}><Link to={`/municipalities/${portal.slug}`}>{portal.name}</Link></li>
                ))}
              </ul>
            </div>
            <Alert tone="warning">For emergencies call 911 or the appropriate emergency service. Do not use this form for urgent help.</Alert>
          </aside>
        </div>
      </div>
    </>
  )
}

/* --------------------------- Portal subscribe ---------------------------- */

export function MunicipalSubscribe({ slug, name }) {
  const [email, setEmail] = useState('')
  const [topics, setTopics] = useState(['announcements'])
  const [state, setState] = useState({ busy: false, error: '', result: null })

  async function submit(event) {
    event.preventDefault()
    setState({ busy: true, error: '', result: null })
    try {
      const response = await api.post('/municipal-subscriptions', { municipality: slug, email, topics })
      setState({ busy: false, error: '', result: response })
      setEmail('')
    } catch (err) {
      setState({ busy: false, error: err.message || 'Subscription failed.', result: null })
    }
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 'var(--text-h4)' }}>Get {name} updates</h2>
      <p className="text-sm text-muted">Subscribe to published announcements, notices, projects and programs for this municipality.</p>
      {state.result ? (
        <Alert tone="success" title="Subscription saved">
          {state.result.message}{' '}
          {state.result.confirmation?.url ? (
            <a href={state.result.confirmation.url} target="_blank" rel="noopener noreferrer">Confirm subscription</a>
          ) : null}
        </Alert>
      ) : null}
      {state.error ? <Alert tone="danger" title="Subscription failed">{state.error}</Alert> : null}
      <form className="stack mt-2" onSubmit={submit}>
        <Field label="Email address" htmlFor="subscribe-email" required>
          <Input
            id="subscribe-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            placeholder="you@example.com"
          />
        </Field>
        <fieldset className="stack-sm">
          <legend className="text-sm">Topics</legend>
          {[
            ['announcements', 'Announcements and advisories'],
            ['news', 'News and public notices'],
            ['projects', 'Projects and progress updates'],
            ['programs', 'Programs and initiatives'],
          ].map(([value, label]) => (
            <label key={value} className="checkbox-inline text-sm">
              <input
                type="checkbox"
                checked={topics.includes(value)}
                onChange={(event) => {
                  setTopics((current) => (event.target.checked ? [...current, value] : current.filter((item) => item !== value)))
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <button className="btn btn-outline btn-sm" type="submit" disabled={state.busy}>
          <Mail size={14} aria-hidden="true" /> {state.busy ? 'Saving…' : 'Subscribe'}
        </button>
        <p className="help">
          Double opt-in. No email provider is configured in this deployment yet, so the confirmation link is shown after subscribing instead of being
          emailed.
        </p>
      </form>
    </div>
  )
}
