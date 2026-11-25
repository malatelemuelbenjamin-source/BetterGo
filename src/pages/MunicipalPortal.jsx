import { Link, NavLink, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  FileText,
  FolderKanban,
  Globe,
  Info,
  Mail,
  MapPin,
  Megaphone,
  Phone,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { fmtDate, fmtNumber, query } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { Alert, Badge, EmptyState, Pagination, SkeletonList, VerificationBadge } from '../components/ui'
import { PageHeader } from '../components/layout'
import { SectionHeading } from '../components/cards'
import { Markdown } from './Info'
import { MunicipalSubscribe, MunicipalStatusPill, ProgressRing, PortalPulse, APPLICATION_STATUS_LABELS } from './MunicipalExtras'

/** Portal sections and the content types each one lists. */
const SECTIONS = [
  { key: 'about', label: 'About', types: ['about'] },
  { key: 'services', label: 'Services' },
  { key: 'offices', label: 'Offices' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'news', label: 'News & notices', types: ['news', 'notice'] },
  { key: 'projects', label: 'Projects', types: ['project'] },
  { key: 'programs', label: 'Programs', types: ['program'] },
  { key: 'resources', label: 'Resources', types: ['resource'] },
  { key: 'faqs', label: 'FAQs' },
  { key: 'contact', label: 'Contact', types: ['contact'] },
]

const SECTION_LABELS = Object.fromEntries(SECTIONS.map((section) => [section.key, section.label]))

const CONTENT_TYPE_LABELS = {
  about: 'Municipality profile',
  news: 'News and updates',
  notice: 'Public notice',
  program: 'Program and initiative',
  project: 'Project',
  resource: 'Public resource',
  faq: 'Question',
  contact: 'Contact information',
}

function portalPath(slug, section) {
  return section === 'about' ? `/municipalities/${slug}/about` : `/municipalities/${slug}/${section}`
}

function usePortal(slug) {
  return useApi(slug ? `/municipal-portals/${slug}` : null)
}

/* --------------------------------- Shell --------------------------------- */

function PortalHeader({ portal, slug }) {
  const municipality = portal.municipality
  return (
    <>
      <div className={`portal-cover${municipality.cover_image ? ' has-image' : ''}`}>
        {municipality.cover_image ? (
          <img src={municipality.cover_image} alt={`Cover image for ${municipality.name}`} loading="eager" />
        ) : null}
      </div>
      <PageHeader
        eyebrow="Municipal portal"
        title={municipality.portal_title || municipality.name}
        description={municipality.portal_description || municipality.description}
        icon={municipality.logo ? undefined : MapPin}
        media={
          municipality.logo ? (
            <img src={municipality.logo} alt={`${municipality.name} logo`} className="portal-logo" />
          ) : (
            <span className="portal-monogram" aria-hidden="true">{municipality.name.slice(0, 1)}</span>
          )
        }
        breadcrumbs={[{ label: 'Municipalities', to: '/municipalities' }, { label: municipality.name }]}
        actions={
          <>
            <VerificationBadge status={municipality.verification_status} />
            {municipality.official_website ? (
              <a
                className="btn btn-outline"
                href={municipality.official_website}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Globe size={15} aria-hidden="true" /> Official website
              </a>
            ) : null}
          </>
        }
      />
      <div className="container portal-nav-wrap">
        <nav className="portal-nav" aria-label={`${municipality.name} portal sections`}>
          <NavLink to={`/municipalities/${slug}`} end className="portal-nav-link">
            Home
          </NavLink>
          {SECTIONS.map((section) => (
            <NavLink key={section.key} to={portalPath(slug, section.key)} className="portal-nav-link">
              {section.label}
            </NavLink>
          ))}
        </nav>
      </div>
      {municipality.portal_title || municipality.cover_image || municipality.logo ? (
        <p className="container help portal-provenance">
          Municipal portal information is published by BetterGo Marinduque with a recorded source and verification status. BetterGo is not
          an official government website.
        </p>
      ) : null}
    </>
  )
}

function QualityNotice({ municipality }) {
  if (municipality.verification_status === 'verified') return null
  return (
    <Alert tone="warning" title="Municipal information is not yet verified">
      Details on this portal have not been checked against an official municipal source
      {municipality.source_reference ? ` (recorded source: ${municipality.source_reference})` : ''}. Confirm with the municipality before
      relying on them.
    </Alert>
  )
}

function contentPath(slug, item) {
  if (item.content_type === 'project') return `/municipalities/${slug}/projects/${item.slug}`
  if (item.content_type === 'program') return `/municipalities/${slug}/programs/${item.slug}`
  return `/municipalities/${slug}/content/${item.slug}`
}

function ContentCard({ item, slug, section }) {
  return (
    <Link
      to={contentPath(slug, item)}
      className="card card-interactive card-link"
      id={`content-${item.id}`}
    >
      <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
        <Badge tone="neutral">{CONTENT_TYPE_LABELS[item.content_type] || 'Municipal update'}</Badge>
        {item.is_featured ? <Badge tone="info">Featured</Badge> : null}
        <VerificationBadge status={item.verification_status} />
      </div>
      <h3 style={{ fontSize: '1.02rem' }}>{item.title}</h3>
      {item.summary ? <p>{item.summary}</p> : null}
      <div className="card-meta">
        {item.published_at || item.starts_at ? <span><CalendarDays size={11} aria-hidden="true" /> {fmtDate(item.published_at || item.starts_at)}</span> : null}
        {item.event_start ? <span><CalendarDays size={11} aria-hidden="true" /> {fmtDate(item.event_start)}</span> : null}
        {item.progress_percent !== null && item.progress_percent !== undefined ? <span>{item.progress_percent}% reported</span> : null}
        <span>{section ? SECTION_LABELS[section] : ''}</span>
      </div>
    </Link>
  )
}

function ContentList({ items, slug, section, emptyTitle, emptyDescription }) {
  if (!items?.length) {
    return <EmptyState icon={FileText} title={emptyTitle} description={emptyDescription} />
  }
  return (
    <div className="grid grid-2">
      {items.map((item) => (
        <ContentCard key={item.id} item={item} slug={slug} section={section} />
      ))}
    </div>
  )
}

/* ------------------------------ Portal home ------------------------------ */

export function MunicipalPortal() {
  const { slug } = useParams()
  const { data, loading, error } = usePortal(slug)
  const municipality = data?.municipality
  useDocumentTitle(municipality ? `${municipality.name}, Marinduque` : 'Municipal portal')

  if (loading) return <div className="container section"><SkeletonList count={3} height={200} /></div>
  if (error || !data?.municipality) {
    return (
      <div className="container section">
        <EmptyState
          icon={MapPin}
          title="Municipal portal not found"
          description="Check the address or browse all six municipalities of Marinduque."
          action={<Link className="btn btn-primary" to="/municipalities">All municipalities</Link>}
        />
      </div>
    )
  }

  const { metrics, content, announcements, offices, services, documents, barangays } = data
  const featured = [
    ...(content.news || []).slice(0, 2),
    ...(content.project || []).slice(0, 1),
    ...(content.notice || []).slice(0, 1),
  ]
  const totalPublished =
    Number(metrics.announced || 0) +
    Number(metrics.offices || 0) +
    Number(metrics.services || 0) +
    Number(metrics.content || 0)

  return (
    <>
      <PortalHeader portal={data} slug={slug} />

      <div className="container section-tight">
        <QualityNotice municipality={municipality} />

        {totalPublished === 0 ? (
          <Alert tone="info" title="No verified municipal information published yet">
            This portal is ready, but no municipal announcements, offices, services or updates have been published for{' '}
            {municipality.name}. Rather than showing placeholder content, BetterGo leaves the sections empty until an authorised
            administrator publishes verified information.
          </Alert>
        ) : null}

        <div className="portal-stats mt-4" role="list" aria-label="Published municipal records">
          {[
            ['Services', metrics.services, portalPath(slug, 'services')],
            ['Offices', metrics.offices, portalPath(slug, 'offices')],
            ['Announcements', metrics.announced, portalPath(slug, 'announcements')],
            ['Projects', metrics.byType?.project || 0, portalPath(slug, 'projects')],
            ['Programs', metrics.byType?.program || 0, portalPath(slug, 'programs')],
            ['FAQs', metrics.byType?.faq || 0, portalPath(slug, 'faqs')],
          ].map(([label, value, to]) => (
            <Link key={label} to={to} className="portal-stat" role="listitem">
              <span className="portal-stat-value">{fmtNumber(value || 0)}</span>
              <span className="portal-stat-label">{label}</span>
            </Link>
          ))}
        </div>

        {data.advisories?.length ? (
          <section className="mt-4" aria-labelledby="portal-advisories">
            <h2 id="portal-advisories" style={{ fontSize: 'var(--text-h3)' }}>Public advisories</h2>
            <div className="stack mt-2">
              {data.advisories.map((item) => (
                <Link key={item.id} to={contentPath(slug, item)} className={`advisory-row priority-${item.priority}`}>
                  <Badge tone={item.priority === 'urgent' ? 'danger' : 'warning'}>
                    {item.priority === 'urgent' ? 'Urgent advisory' : 'Important notice'}
                  </Badge>
                  <span>{item.title}</span>
                  <span className="text-xs text-muted">{fmtDate(item.published_at || item.updated_at)}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {data.upcoming?.length ? (
          <section className="mt-4" aria-labelledby="portal-upcoming">
            <h2 id="portal-upcoming" style={{ fontSize: 'var(--text-h3)' }}>Upcoming activities</h2>
            <ul className="link-list mt-2">
              {data.upcoming.map((item) => (
                <li key={item.id}>
                  <CalendarDays size={13} aria-hidden="true" /> <Link to={contentPath(slug, item)}>{item.title}</Link>{' '}
                  <span className="text-xs text-muted">{fmtDate(item.event_start)}{item.venue ? ` · ${item.venue}` : ''}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="grid mt-4" style={{ gridTemplateColumns: 'minmax(0, 2.2fr) minmax(0, 1fr)', alignItems: 'start' }}>
          <div className="stack" style={{ gap: 'var(--space-6)' }}>
            <section className="card" aria-labelledby="municipality-overview">
              <h2 id="municipality-overview" style={{ fontSize: 'var(--text-h3)', marginBottom: 'var(--space-3)' }}>
                About {municipality.name}
              </h2>
              <p className="text-muted" style={{ whiteSpace: 'pre-line' }}>
                {municipality.overview || municipality.description || 'An overview has not been verified for this municipality yet.'}
              </p>
              <dl className="detail-list mt-4">
                <div className="detail-item"><dt>Province</dt><dd>Marinduque, MIMAROPA Region</dd></div>
                <div className="detail-item"><dt>Geographic code</dt><dd>{municipality.municipal_code || 'Not recorded'}</dd></div>
                <div className="detail-item"><dt>Population</dt><dd>{municipality.population ? fmtNumber(municipality.population) : 'Not yet verified'}</dd></div>
                <div className="detail-item"><dt>Last verified</dt><dd>{municipality.last_verified_at ? fmtDate(municipality.last_verified_at) : 'Not recorded'}</dd></div>
              </dl>
              <div className="row mt-4">
                <Link className="btn btn-outline btn-sm" to={portalPath(slug, 'about')}>More about {municipality.name}</Link>
              </div>
            </section>

            <section aria-labelledby="quick-access-heading">
              <SectionHeading eyebrow="Quick access" title={<span id="quick-access-heading">Municipal information</span>} description="Live from published records only." />
              <div className="grid grid-3">
                <Link to={portalPath(slug, 'services')} className="card card-interactive card-link">
                  <FileText size={18} aria-hidden="true" />
                  <h3 style={{ fontSize: '1rem' }}>Services</h3>
                  <p>{metrics.services ? `${metrics.services} published service${metrics.services === 1 ? '' : 's'} available here or province-wide.` : 'No published service records for this municipality yet.'}</p>
                </Link>
                <Link to={portalPath(slug, 'offices')} className="card card-interactive card-link">
                  <Building2 size={18} aria-hidden="true" />
                  <h3 style={{ fontSize: '1rem' }}>Offices</h3>
                  <p>{metrics.offices ? `${metrics.offices} published office${metrics.offices === 1 ? '' : 's'}.` : 'No published municipal offices yet.'}</p>
                </Link>
                <Link to={portalPath(slug, 'announcements')} className="card card-interactive card-link">
                  <Megaphone size={18} aria-hidden="true" />
                  <h3 style={{ fontSize: '1rem' }}>Announcements</h3>
                  <p>{metrics.announced ? `${metrics.announced} published announcement${metrics.announced === 1 ? '' : 's'}.` : 'No municipal announcements published yet.'}</p>
                </Link>
                <Link to={portalPath(slug, 'news')} className="card card-interactive card-link">
                  <Sparkles size={18} aria-hidden="true" />
                  <h3 style={{ fontSize: '1rem' }}>News & notices</h3>
                  <p>{metrics.byType?.news || metrics.byType?.notice ? 'Published municipal news and public notices.' : 'No municipal news or public notices yet.'}</p>
                </Link>
                <Link to={portalPath(slug, 'projects')} className="card card-interactive card-link">
                  <FolderKanban size={18} aria-hidden="true" />
                  <h3 style={{ fontSize: '1rem' }}>Projects & programs</h3>
                  <p>{metrics.byType?.project || metrics.byType?.program ? 'Published local projects and community programs.' : 'No published projects or programs yet.'}</p>
                </Link>
                <Link to={portalPath(slug, 'contact')} className="card card-interactive card-link">
                  <Mail size={18} aria-hidden="true" />
                  <h3 style={{ fontSize: '1rem' }}>Contact</h3>
                  <p>{municipality.phone || municipality.email || municipality.office_address ? 'Verified public contact details.' : 'No verified contact details published yet.'}</p>
                </Link>
              </div>
            </section>

            <section aria-labelledby="featured-heading">
              <SectionHeading
                eyebrow="Featured"
                title={<span id="featured-heading">Latest municipal information</span>}
                description="Featured content is selected by the municipality's authorised editors."
                action={<Link className="btn btn-ghost btn-sm" to={portalPath(slug, 'news')}>All updates <ArrowRight size={14} aria-hidden="true" /></Link>}
              />
              <ContentList
                items={featured}
                slug={slug}
                section="news"
                emptyTitle="No municipal updates published yet"
                emptyDescription="News, public notices and project updates appear here once an authorised municipal administrator publishes them through the review workflow."
              />
            </section>

            {data.projects?.length ? (
              <section aria-labelledby="home-projects">
                <SectionHeading
                  eyebrow="Projects"
                  title={<span id="home-projects">Municipal projects</span>}
                  description="Status and progress are shown only as reported with a recorded source."
                  action={<Link className="btn btn-ghost btn-sm" to={portalPath(slug, 'projects')}>All projects <ArrowRight size={14} aria-hidden="true" /></Link>}
                />
                <div className="stack">
                  {data.projects.map((item) => (
                    <Link key={item.id} to={contentPath(slug, item)} className="card card-interactive card-link">
                      <div className="row-between">
                        <MunicipalStatusPill status={item.project_status} />
                        <ProgressRing percent={item.progress_percent} size={50} />
                      </div>
                      <h3 style={{ fontSize: '1rem' }}>{item.title}</h3>
                      {item.summary ? <p>{item.summary}</p> : null}
                      <div className="card-meta">
                        <VerificationBadge status={item.verification_status} />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            {data.programs?.length ? (
              <section aria-labelledby="home-programs">
                <SectionHeading
                  eyebrow="Programs"
                  title={<span id="home-programs">Community programs</span>}
                  action={<Link className="btn btn-ghost btn-sm" to={portalPath(slug, 'programs')}>All programs <ArrowRight size={14} aria-hidden="true" /></Link>}
                />
                <div className="grid grid-2">
                  {data.programs.map((item) => (
                    <Link key={item.id} to={contentPath(slug, item)} className="card card-interactive card-link">
                      <Badge tone={item.application_status === 'open' ? 'success' : 'neutral'}>
                        {APPLICATION_STATUS_LABELS[item.application_status] || 'Application details not published'}
                      </Badge>
                      <h3 style={{ fontSize: '1rem' }}>{item.title}</h3>
                      {item.summary ? <p>{item.summary}</p> : null}
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            {announcements.length ? (
              <section aria-labelledby="announcements-heading">
                <SectionHeading
                  eyebrow="Announcements"
                  title={<span id="announcements-heading">Public announcements</span>}
                  action={<Link className="btn btn-ghost btn-sm" to={portalPath(slug, 'announcements')}>All announcements <ArrowRight size={14} aria-hidden="true" /></Link>}
                />
                <div className="stack">
                  {announcements.slice(0, 3).map((announcement) => (
                    <Link key={announcement.id} to={`/announcements/${announcement.slug}`} className="card card-interactive card-link">
                      <div className="row-between">
                        <Badge>{announcement.category_name || 'Announcement'}</Badge>
                        <span className="text-xs text-muted">{fmtDate(announcement.published_at)}</span>
                      </div>
                      <h3 style={{ fontSize: '1rem' }}>{announcement.title}</h3>
                      {announcement.summary ? <p>{announcement.summary}</p> : null}
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <aside className="stack" style={{ gap: 'var(--space-4)' }}>
            <div className="card">
              <h3 style={{ fontSize: 'var(--text-h4)' }}>Public contact</h3>
              {municipality.phone || municipality.email || municipality.office_address || municipality.office_hours ? (
                <div className="stack-sm text-sm">
                  {municipality.office_address ? <span className="text-muted">{municipality.office_address}</span> : null}
                  {municipality.office_hours ? <span className="text-muted">{municipality.office_hours}</span> : null}
                  {municipality.phone ? (
                    <a className="tel-link" href={`tel:${municipality.phone.replace(/[^0-9+]/g, '')}`}>
                      <Phone size={13} aria-hidden="true" /> {municipality.phone}
                    </a>
                  ) : null}
                  {municipality.email ? (
                    <a href={`mailto:${municipality.email}`}><Mail size={13} aria-hidden="true" /> {municipality.email}</a>
                  ) : null}
                  {municipality.official_website ? (
                    <a href={municipality.official_website} target="_blank" rel="noopener noreferrer">
                      <Globe size={13} aria-hidden="true" /> Official website
                    </a>
                  ) : null}
                  {municipality.social_links
                    ? Object.entries(municipality.social_links).map(([key, url]) => (
                        <a key={key} href={url} target="_blank" rel="noopener noreferrer">
                          <Globe size={13} aria-hidden="true" /> {key}
                        </a>
                      ))
                    : null}
                </div>
              ) : (
                <p className="text-sm text-muted">No verified public contact details have been published for this municipality yet.</p>
              )}
              <p className="help mt-2">BetterGo does not publish unverified contact details.</p>
            </div>

            <div className="card">
              <h3 style={{ fontSize: 'var(--text-h4)' }}>Barangays</h3>
              {barangays.length ? (
                <ul className="link-list">
                  {barangays.map((barangay) => <li key={barangay.id}>{barangay.name}</li>)}
                </ul>
              ) : (
                <p className="text-sm text-muted">Barangay records are only imported from verified official sources and have not been published yet.</p>
              )}
            </div>

            {documents.length ? (
              <div className="card">
                <h3 style={{ fontSize: 'var(--text-h4)' }}>Local documents</h3>
                <ul className="link-list">
                  {documents.map((document) => (
                    <li key={document.id}><Link to={`/transparency/documents/${document.slug}`}>{document.title}</Link></li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="meta-panel">
              <h3 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>Information sources</h3>
              <div className="stack-sm text-xs text-muted">
                <span><strong>Source:</strong> {municipality.source_reference || 'Not recorded'}</span>
                <span><strong>Verification:</strong> {String(municipality.verification_status || 'pending').replace(/_/g, ' ')}</span>
                <span><strong>Last verified:</strong> {municipality.last_verified_at ? fmtDate(municipality.last_verified_at) : 'Not recorded'}</span>
                {municipality.source_url ? (
                  <a href={municipality.source_url} target="_blank" rel="noopener noreferrer">View source</a>
                ) : null}
              </div>
              <Link className="btn btn-outline btn-sm mt-3" to="/contact?kind=concern">Report incorrect information</Link>
            </div>

            {offices.length || services.length ? (
              <div className="card">
                <h3 style={{ fontSize: 'var(--text-h4)' }}>On this portal</h3>
                <ul className="link-list">
                  {offices.length ? <li><Link to={portalPath(slug, 'offices')}><Building2 size={13} aria-hidden="true" /> {offices.length} office{offices.length === 1 ? '' : 's'}</Link></li> : null}
                  {services.length ? <li><Link to={portalPath(slug, 'services')}><FileText size={13} aria-hidden="true" /> {services.length} service{services.length === 1 ? '' : 's'}</Link></li> : null}
                  <li><Link to={`/emergency/${municipality.slug}`}><ShieldCheck size={13} aria-hidden="true" /> Emergency information</Link></li>
                  <li><Link to={`/transparency?municipality=${municipality.slug}`}><MapPin size={13} aria-hidden="true" /> Transparency records</Link></li>
                </ul>
              </div>
            ) : null}

            <PortalPulse byType={metrics.byType} services={metrics.services} offices={metrics.offices} announced={metrics.announced} />

            <MunicipalSubscribe slug={slug} name={municipality.name} />

            <div className="card">
              <h3 style={{ fontSize: 'var(--text-h4)' }}>Find more</h3>
              <ul className="link-list">
                <li><Link to={`/municipal-offices?municipality=${municipality.slug}`}>Office map</Link></li>
                <li><Link to={`/municipal-faqs?municipality=${municipality.slug}`}>Frequently asked questions</Link></li>
                <li><Link to={`/municipal-search?municipality=${municipality.slug}`}>Search this municipality</Link></li>
                <li><Link to={`/municipal-feedback?municipality=${municipality.slug}`}>Report incorrect information</Link></li>
              </ul>
            </div>

            <Alert tone="info">Municipality selection in a profile does not establish official residency or eligibility for any programme.</Alert>
          </aside>
        </div>

        <div className="row mt-5">
          <Link className="btn btn-ghost" to="/municipalities">
            <ArrowLeft size={14} aria-hidden="true" /> All municipalities
          </Link>
        </div>
      </div>
    </>
  )
}

/* ------------------------------ Portal FAQs ------------------------------ */

function PortalFaqs({ slug }) {
  const { data, loading } = useApi(`/municipal-faqs?municipality=${slug}`)
  if (loading) return <SkeletonList count={3} />
  if (!data?.results?.length) {
    return (
      <EmptyState
        icon={FileText}
        title="No published FAQs yet"
        description="Questions and answers appear here after an authorised editor publishes them with a source."
      />
    )
  }
  return (
    <div className="stack">
      {data.results.map((row) => (
        <details key={row.id} className="faq-item">
          <summary>{row.title}</summary>
          <div className="prose mt-2"><Markdown text={row.body || row.summary || ''} /></div>
          {row.source_reference ? <p className="help">Source: {row.source_reference}</p> : null}
        </details>
      ))}
    </div>
  )
}

/* ----------------------------- Section pages ----------------------------- */

function useSectionContent(slug, types) {
  const [params, setParams] = useSearchParams()
  const page = Number(params.get('page') || 1)
  const type = params.get('type') || ''
  const activeType = type || types?.[0] || null
  const { data, loading } = useApi(
    activeType ? `/municipal-portals/${slug}/content${query({ type: activeType, page, limit: 12 })}` : null,
  )
  return { data, loading, type: activeType, page, setParams, setType: (value) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set('type', value)
      else next.delete('type')
      next.delete('page')
      return next
    })
  } }
}

export function MunicipalSectionPage({ section }) {
  const { slug } = useParams()
  const { data: portal, loading, error } = usePortal(slug)
  const definition = SECTIONS.find((item) => item.key === section)
  useDocumentTitle(portal?.municipality ? `${SECTION_LABELS[section]} · ${portal.municipality.name}` : 'Municipal portal')
  const { data: content, loading: contentLoading, type, page, setParams, setType } = useSectionContent(slug, definition?.types)

  if (loading) return <div className="container section"><SkeletonList count={2} height={200} /></div>
  if (error || !portal?.municipality) {
    return (
      <div className="container section">
        <EmptyState
          icon={MapPin}
          title="Municipal portal not found"
          description="Check the address or browse all six municipalities."
          action={<Link className="btn btn-primary" to="/municipalities">All municipalities</Link>}
        />
      </div>
    )
  }

  const { municipality, offices, services, announcements, barangays, content: grouped } = portal

  return (
    <>
      <PortalHeader portal={portal} slug={slug} />
      <div className="container section-tight">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/municipalities">Municipalities</Link>
          <span aria-hidden="true">/</span>
          <Link to={`/municipalities/${slug}`}>{municipality.name}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{SECTION_LABELS[section]}</span>
        </nav>

        <div className="page-heading-row mt-4">
          <div>
            <h1 style={{ fontSize: 'var(--text-h2)' }}>{SECTION_LABELS[section]}</h1>
            <p className="text-muted">
              {section === 'services' && 'Published services available in this municipality or province-wide.'}
              {section === 'offices' && 'Published municipal government offices and their verified contact details.'}
              {section === 'announcements' && 'Announcements published specifically for this municipality.'}
              {section === 'news' && 'Municipal news, public notices and advisories.'}
              {section === 'projects' && 'Published municipal development projects with their reported status and progress.'}
              {section === 'programs' && 'Published municipal programs, activities and community initiatives.'}
              {section === 'faqs' && 'Answers published by this municipal portal about services and procedures.'}
              {section === 'resources' && 'Forms, guides and public resources for this municipality.'}
              {section === 'contact' && 'Verified public contact information for the municipal government.'}
              {section === 'about' && 'Municipality profile, geography and frequently asked questions.'}
            </p>
          </div>
        </div>

        <QualityNotice municipality={municipality} />

        <div className="mt-4">
          {section === 'about' ? (
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              <section className="card">
                <h2 style={{ fontSize: 'var(--text-h3)' }}>Profile</h2>
                <p className="text-muted mt-2" style={{ whiteSpace: 'pre-line' }}>
                  {municipality.overview || municipality.description || 'A verified municipality profile has not been published yet.'}
                </p>
                {municipality.geographic_info ? (
                  <>
                    <h3 style={{ fontSize: 'var(--text-h4)', marginTop: 'var(--space-4)' }}>Geography</h3>
                    <p className="text-muted mt-2" style={{ whiteSpace: 'pre-line' }}>{municipality.geographic_info}</p>
                  </>
                ) : null}
              </section>
              <section className="card">
                <h2 style={{ fontSize: 'var(--text-h3)' }}>Barangays</h2>
                {barangays.length ? (
                  <ul className="link-list mt-2">
                    {barangays.map((barangay) => <li key={barangay.id}>{barangay.name}</li>)}
                  </ul>
                ) : (
                  <p className="text-sm text-muted mt-2">Verified barangay records have not been published yet.</p>
                )}
              </section>
              <section aria-labelledby="about-content-heading">
                <SectionHeading title={<span id="about-content-heading">Municipal profile pages</span>} />
                <ContentList
                  items={[...(grouped?.about || []), ...(grouped?.faq || [])]}
                  slug={slug}
                  section="about"
                  emptyTitle="No additional profile information yet"
                  emptyDescription="Extended profile pages and frequently asked questions appear here after an authorised editor publishes them."
                />
              </section>
            </div>
          ) : null}

          {section === 'services' ? (
            services.length ? (
              <div className="grid grid-2">
                {services.map((service) => (
                  <Link key={service.id} to={`/services/${service.slug}`} className="card card-interactive card-link">
                    <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                      <Badge>{service.category_name || 'Service'}</Badge>
                      <VerificationBadge status={service.verification_status} />
                    </div>
                    <h3 style={{ fontSize: '1rem' }}>{service.title}</h3>
                    <p>{service.short_description || service.description}</p>
                    <div className="card-meta">
                      <span>{service.service_scope === 'province_wide' || service.coverage_type === 'province_wide' ? 'Province-wide' : municipality.name}</span>
                      <span>{String(service.availability_status || 'needs_confirmation').replace(/_/g, ' ')}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={FileText}
                title="No services published for this municipality yet"
                description="Services are published only after verification. Browse the province-wide directory in the meantime."
                action={<Link className="btn btn-outline" to={`/services?municipality=${municipality.slug}`}>Browse all services</Link>}
              />
            )
          ) : null}

          {section === 'offices' ? (
            offices.length ? (
              <div className="grid grid-2">
                {offices.map((office) => (
                  <Link key={office.id} to={`/government-directory/${office.slug}`} className="card card-interactive card-link">
                    <div className="row-between">
                      <Badge>{office.category || office.office_type || 'Office'}</Badge>
                      <VerificationBadge status={office.verification_status} />
                    </div>
                    <h3 style={{ fontSize: '1rem' }}>{office.name}</h3>
                    <p>{office.description || 'Office description pending verification.'}</p>
                    <div className="card-meta">
                      {office.phone ? <span><Phone size={11} aria-hidden="true" /> {office.phone}</span> : <span>Contact not published</span>}
                      {office.operating_hours ? <span>{office.operating_hours}</span> : null}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Building2}
                title="No municipal offices published yet"
                description="Office records are added by authorised administrators after verification."
                action={<Link className="btn btn-outline" to="/government-directory">Browse the government directory</Link>}
              />
            )
          ) : null}

          {section === 'announcements' ? (
            announcements.length ? (
              <div className="stack">
                {announcements.map((announcement) => (
                  <Link key={announcement.id} to={`/announcements/${announcement.slug}`} className="card card-interactive card-link">
                    <div className="row-between">
                      <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                        <Badge>{announcement.category_name || 'Announcement'}</Badge>
                        <VerificationBadge status={announcement.verification_status} />
                      </div>
                      <span className="text-xs text-muted">{fmtDate(announcement.published_at)}</span>
                    </div>
                    <h3 style={{ fontSize: '1.02rem' }}>{announcement.title}</h3>
                    {announcement.summary ? <p>{announcement.summary}</p> : null}
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Megaphone}
                title="No announcements for this municipality yet"
                description="Municipality-specific announcements appear here once published. Province-wide announcements are published separately."
                action={<Link className="btn btn-outline" to="/announcements">Province-wide announcements</Link>}
              />
            )
          ) : null}

          {section === 'faqs' ? <PortalFaqs slug={slug} /> : null}

          {['news', 'projects', 'programs', 'resources'].includes(section) ? (
            <div className="stack">
              {definition?.types?.length > 1 ? (
                <div className="row" role="tablist" aria-label="Content type">
                  {definition.types.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={type === value}
                      className={`btn btn-sm ${type === value ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setType(value)}
                    >
                      {CONTENT_TYPE_LABELS[value] || value}
                    </button>
                  ))}
                </div>
              ) : null}
              {contentLoading ? (
                <SkeletonList count={3} />
              ) : (
                <>
                  <ContentList
                    items={content?.results || []}
                    slug={slug}
                    section={section}
                    emptyTitle={`No published ${SECTION_LABELS[section].toLowerCase()} yet`}
                    emptyDescription="Only records that passed the municipal review workflow appear here. Drafts and rejected submissions are never public."
                  />
                  {content?.totalPages > 1 ? (
                    <Pagination
                      page={content.page}
                      totalPages={content.totalPages}
                      onChange={(next) => setParams((current) => {
                        const updated = new URLSearchParams(current)
                        updated.set('page', String(next))
                        return updated
                      })}
                    />
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {section === 'contact' ? (
            <div className="grid grid-main-aside">
              <div className="card">
                <h2 style={{ fontSize: 'var(--text-h3)' }}>Municipal contact details</h2>
                {municipality.phone || municipality.email || municipality.office_address ? (
                  <dl className="detail-list mt-3">
                    {municipality.office_address ? <div className="detail-item"><dt>Office address</dt><dd>{municipality.office_address}</dd></div> : null}
                    {municipality.office_hours ? <div className="detail-item"><dt>Office hours</dt><dd>{municipality.office_hours}</dd></div> : null}
                    {municipality.phone ? <div className="detail-item"><dt>Telephone</dt><dd><a href={`tel:${municipality.phone.replace(/[^0-9+]/g, '')}`}>{municipality.phone}</a></dd></div> : null}
                    {municipality.email ? <div className="detail-item"><dt>Email</dt><dd><a href={`mailto:${municipality.email}`}>{municipality.email}</a></dd></div> : null}
                    {municipality.official_website ? <div className="detail-item"><dt>Official website</dt><dd><a href={municipality.official_website} target="_blank" rel="noopener noreferrer">{municipality.official_website}</a></dd></div> : null}
                  </dl>
                ) : (
                  <Alert tone="info" title="No verified contact details yet">
                    BetterGo does not publish unverified telephone numbers, addresses or email addresses for a municipal government. Contact
                    details appear once an authorised administrator records them with a source.
                  </Alert>
                )}
              </div>
              <div className="stack">
                <ContentList
                  items={grouped?.contact || []}
                  slug={slug}
                  section="contact"
                  emptyTitle="No additional contact pages"
                  emptyDescription="Published contact information blocks appear here."
                />
                <Alert tone="warning">For emergencies, call 911 or the appropriate emergency service. Do not rely on this portal for urgent help.</Alert>
              </div>
            </div>
          ) : null}
        </div>

        <div className="row mt-5">
          <Link className="btn btn-ghost" to={`/municipalities/${slug}`}><ArrowLeft size={14} aria-hidden="true" /> Back to portal</Link>
        </div>
      </div>
    </>
  )
}

/* ---------------------------- Content detail ----------------------------- */

export function MunicipalContentDetail() {
  const { slug, contentSlug } = useParams()
  const { data, loading, error } = useApi(slug && contentSlug ? `/municipal-portals/${slug}/content/${contentSlug}` : null)
  useDocumentTitle(data?.record?.title || 'Municipal update')

  if (loading) return <div className="container section"><SkeletonList count={2} height={220} /></div>
  if (error || !data?.record) {
    return (
      <div className="container section">
        <EmptyState
          icon={FileText}
          title="This municipal update is not available"
          description="It may have been unpublished, archived, or not yet approved for public view."
          action={<Link className="btn btn-primary" to={`/municipalities/${slug}`}>Back to the municipal portal</Link>}
        />
      </div>
    )
  }

  const { municipality, record, related } = data
  return (
    <>
      <PageHeader
        eyebrow={`${CONTENT_TYPE_LABELS[record.content_type] || 'Municipal update'} · ${municipality.name}`}
        title={record.title}
        description={record.summary}
        breadcrumbs={[
          { label: 'Municipalities', to: '/municipalities' },
          { label: municipality.name, to: `/municipalities/${municipality.slug}` },
          { label: record.title },
        ]}
        actions={<VerificationBadge status={record.verification_status} />}
      />
      <div className="container section-tight">
        <div className="grid grid-main-aside">
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
            {record.contact_details ? (
              <div className="card mt-4" style={{ background: 'var(--surface-2)' }}>
                <h2 style={{ fontSize: 'var(--text-h4)' }}>Contact information</h2>
                <p className="text-sm text-muted" style={{ whiteSpace: 'pre-line' }}>{record.contact_details}</p>
              </div>
            ) : null}
            {record.external_url ? (
              <p className="mt-4">
                <a className="btn btn-outline" href={record.external_url} target="_blank" rel="noopener noreferrer">
                  Open the external resource <ArrowRight size={14} aria-hidden="true" />
                </a>
              </p>
            ) : null}
            <div className="card-meta mt-4">
              {record.published_at ? <span>Published {fmtDate(record.published_at)}</span> : null}
              {record.updated_at ? <span>Updated {fmtDate(record.updated_at)}</span> : null}
              {record.source_reference ? <span>Source: {record.source_reference}</span> : null}
            </div>
            {record.source_url ? (
              <p className="help mt-2">
                <a href={record.source_url} target="_blank" rel="noopener noreferrer">View the recorded source</a>
              </p>
            ) : null}
          </article>
          <aside className="stack">
            <div className="card">
              <h2 style={{ fontSize: 'var(--text-h4)' }}>Published by</h2>
              <p className="text-sm text-muted">
                {municipality.name} municipal portal on BetterGo Marinduque. BetterGo is an independent civic platform, not an official
                government website.
              </p>
              <Link className="btn btn-outline btn-sm mt-3" to={`/municipalities/${municipality.slug}`}>
                <Users size={13} aria-hidden="true" /> Visit the portal
              </Link>
            </div>
            {related.length ? (
              <div className="card">
                <h2 style={{ fontSize: 'var(--text-h4)' }}>More from {municipality.name}</h2>
                <ul className="link-list mt-2">
                  {related.map((item) => (
                    <li key={item.id}>
                      <Link to={`/municipalities/${municipality.slug}/content/${item.slug}`}>{item.title}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Alert tone="info">
              <Info size={14} aria-hidden="true" /> Information is shown as published by the municipal portal. Confirm critical details with
              the responsible office.
            </Alert>
          </aside>
        </div>
      </div>
    </>
  )
}
