import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Bell,
  BellOff,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Info,
  Landmark,
  Layers,
  Mail,
  MapPin,
  Phone,
  Printer,
  Share2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { api, fmtDate, fmtPeso, query } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Pagination, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'
import { SectionHeading } from '../components/cards'
import {
  CategoryIcon,
  RequirementsChecklist,
  ServiceCapabilityBadge,
  ServiceCard,
  ServiceCategoryCard,
  ServiceCoverageList,
  ServiceDisclaimer,
  ServiceFees,
  ServiceFeedback,
  ServiceFilters,
  ServiceProcedures,
  ServiceSourcePanel,
  ServiceStatusBadge,
  ServiceVerificationBadge,
} from '../components/services'
import { SearchAutocomplete } from '../components/search'
import { useAuth } from '../auth'
import { useLang } from '../i18n'

/* ==========================================================================
 * Directory landing page
 * ======================================================================== */
export function ServicesList() {
  const { t } = useLang()
  const [params, setParams] = useSearchParams()
  const filters = {
    q: params.get('q') || '',
    category: params.get('category') || '',
    municipality: params.get('municipality') || '',
    availability: params.get('availability') || '',
    verification: params.get('verification') || '',
    sort: params.get('sort') || '',
    page: Number(params.get('page') || 1),
  }
  const active = Boolean(filters.q || filters.category || filters.municipality || filters.availability || filters.verification)
  useDocumentTitle(active ? 'Service search results' : 'Government Services Directory')
  const { data, loading, error } = useApi(`/services${query({ ...filters, limit: 9 })}`)
  const { data: categories, loading: categoriesLoading } = useApi('/services/categories')
  const { data: lookups } = useApi('/lookups')

  const setFilter = (key, value) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'page') next.delete('page')
      return next
    })
  }

  const clearAll = () => setParams({})
  const parents = categories?.results || []
  const featured = categories?.featured || []

  return (
    <>
      <PageHeader
        eyebrow={t('services.eyebrow', 'Government services directory')}
        title={t('services.title', 'Find the government service you need')}
        description={t('services.description')}
        breadcrumbs={[{ label: t('services.breadcrumb', 'Government services') }]}
      >
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <Badge tone="neutral">{categories?.total_parents || 0} {t('services.categoryGroups', 'category groups')}</Badge>
          <Badge tone="neutral">{data?.facets?.categories?.reduce((sum, item) => sum + Number(item.service_count || 0), 0) || 0} {t('services.publishedRecords', 'published service records')}</Badge>
          <Link className="btn btn-outline btn-sm" to="/service-coverage">{t('services.coverageLink', 'Municipality coverage')}</Link>
        </div>
      </PageHeader>

      <div className="container section-tight">
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div className="row" style={{ gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <SearchAutocomplete
              initialValue={filters.q}
              onSubmit={(term) => setFilter('q', term)}
              inputId="service-search-input"
              label={t('services.searchLabel', 'Search government services')}
              placeholder={t('services.searchPlaceholder', 'Search a service, requirement, form or question')}
            />
          </div>
          <div style={{ marginTop: '0.9rem' }}>
            <ServiceFilters filters={filters} setFilter={setFilter} facets={data?.facets || categories} lookups={lookups} />
          </div>
          {active ? (
            <div className="row" style={{ marginTop: '0.75rem' }}>
              <span className="text-sm text-muted">
                {loading ? t('services.searching', 'Searching…') : `${data?.total || 0} result${data?.total === 1 ? '' : 's'}${filters.q ? ` for “${filters.q}”` : ''}`}
              </span>
              <Button variant="ghost" size="sm" onClick={clearAll} style={{ marginLeft: 'auto' }}>{t('services.clearFilters', 'Clear filters')}</Button>
            </div>
          ) : null}
        </div>

        {!active ? (
          <>
            {featured.length ? (
              <section style={{ marginTop: 'var(--space-7)' }}>
                <SectionHeading
                  eyebrow={t('services.featuredEyebrow', 'Start here')}
                  title={t('services.featuredTitle', 'Featured service categories')}
                  description={t('services.featuredDescription')}
                  action={<Link className="btn btn-ghost btn-sm" to="/services/categories">{t('services.browseAll', 'Browse all')} <ArrowRight size={14} aria-hidden="true" /></Link>}
                />
                <div className="grid grid-3">
                  {featured.map((category) => <ServiceCategoryCard key={category.id} category={category} featured />)}
                </div>
              </section>
            ) : null}

            <section style={{ marginTop: 'var(--space-7)' }}>
              <SectionHeading
                eyebrow={t('services.allEyebrow', 'All categories')}
                title={t('services.allTitle', 'Browse by service area')}
                description={t('services.allDescription')}
              />
              {categoriesLoading ? (
                <SkeletonList count={6} height={170} />
              ) : parents.length ? (
                <div className="grid grid-3">
                  {parents.map((category) => <ServiceCategoryCard key={category.id} category={category} />)}
                </div>
              ) : (
                <EmptyState
                  icon={Layers}
                  title="Service categories are unavailable"
                  description="The category structure could not be loaded. Please try again in a moment."
                />
              )}
            </section>

            <section className="cta-band" style={{ marginTop: 'var(--space-7)' }}>
              <div>
                <h2 style={{ marginTop: 0 }}>{t('services.ctaTitle', 'Not sure which office handles it?')}</h2>
                <p style={{ marginBottom: 0 }}>{t('services.ctaText')}</p>
              </div>
              <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link className="btn btn-white" to="/service-coverage">{t('services.ctaCoverage', 'Check coverage')}</Link>
                <Link className="btn btn-outline" to="/search">{t('services.ctaSearch', 'Search everything')}</Link>
              </div>
            </section>
          </>
        ) : null}

        <section style={{ marginTop: 'var(--space-7)' }} aria-live="polite">
          <SectionHeading
            eyebrow={active ? t('services.resultsEyebrow', 'Results') : t('services.publishedEyebrow', 'Published records')}
            title={active ? t('services.resultsTitle', 'Matching services') : t('services.publishedTitle', 'Recently published services')}
            description={active ? t('services.resultsDescription') : t('services.publishedDescription')}
          />
          {loading ? (
            <SkeletonList count={6} height={200} />
          ) : error ? (
            <Alert tone="error" title={t('services.errorTitle', 'The service directory could not be loaded')}>{error.message}</Alert>
          ) : data?.results?.length ? (
            <>
              <div className="grid grid-3">
                {data.results.map((service) => <ServiceCard key={service.id} service={service} />)}
              </div>
              <Pagination page={data.page} totalPages={data.totalPages} onChange={(page) => setFilter('page', String(page))} />
            </>
          ) : (
            <EmptyState
              icon={FileText}
              title={active ? t('services.emptyTitle', 'No published service matches those filters') : t('services.noRecordsTitle', 'No service records have been published yet')}
              description={active ? t('services.emptyDescription') : t('services.noRecordsDescription')}
              action={
                active ? (
                  <Button variant="outline" onClick={clearAll}>{t('services.clearFilters', 'Clear filters')}</Button>
                ) : (
                  <Link className="btn btn-primary" to="/service-coverage">{t('services.coverageLink', 'Municipality coverage')}</Link>
                )
              }
            />
          )}
        </section>

        <div style={{ marginTop: 'var(--space-6)' }}><ServiceDisclaimer /></div>
      </div>
    </>
  )
}

/* ==========================================================================
 * Category detail page
 * ======================================================================== */
export function ServiceCategoryPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [municipality, setMunicipality] = useState('')
  const { data, loading, error } = useApi(`/services/categories/${slug}`)
  const { data: lookups } = useApi('/lookups')
  const category = data?.category
  useDocumentTitle(category ? `${category.name} — service category` : 'Service category')

  if (loading) {
    return (
      <div className="container section">
        <div className="loading-block" role="status"><span className="spin" aria-hidden="true" /> Loading category…</div>
        <SkeletonList count={6} height={190} />
      </div>
    )
  }

  if (error || !category) {
    return (
      <div className="container section">
        <EmptyState
          icon={Layers}
          title="Category not found"
          description="This category may have been archived or renamed."
          action={<Link className="btn btn-primary" to="/services">Back to the directory</Link>}
        />
      </div>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow={data.parent ? `Part of ${data.parent.name}` : 'Service category'}
        title={category.name}
        description={category.description || 'Services recorded under this category.'}
        breadcrumbs={[
          { label: 'Government services', to: '/services' },
          ...(data.parent ? [{ label: data.parent.name, to: `/services/category/${data.parent.slug}` }] : []),
          { label: category.name },
        ]}
      >
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <Badge tone="neutral">{data.service_count} published service{data.service_count === 1 ? '' : 's'}</Badge>
          <Badge tone="neutral">{data.children.length} subcategories</Badge>
        </div>
      </PageHeader>

      <div className="container section-tight">
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: 'var(--space-5)' }}>
          <Link className="btn btn-ghost btn-sm" to="/services"><ArrowLeft size={14} aria-hidden="true" /> All categories</Link>
          <Select
            value={municipality}
            onChange={(event) => {
              const value = event.target.value
              setMunicipality(value)
              if (value) navigate(`/services?category=${encodeURIComponent(category.slug)}&municipality=${encodeURIComponent(value)}`)
            }}
            aria-label="Filter this category by municipality"
            style={{ maxWidth: 240 }}
          >
            <option value="">Search this category in a municipality…</option>
            {(lookups?.municipalities || []).map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
          </Select>
        </div>

        {data.children.length ? (
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '1.15rem' }}>Subcategories</h2>
            <div className="pill-group" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {data.children.map((child) => (
                <Link key={child.id} className="pill" to={`/services/category/${child.slug}`}>
                  <CategoryIcon name={child.icon} size={14} /> {child.name}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <h2 style={{ fontSize: '1.15rem' }}>Published services in {category.name}</h2>
          {data.services.length ? (
            <div className="grid grid-3">
              {data.services.map((service) => <ServiceCard key={service.id} service={service} />)}
            </div>
          ) : (
            <EmptyState
              icon={FileText}
              title="No published services in this category yet"
              description="Categories exist before records do. BetterGo does not fill them with invented services; records appear once information is published and reviewed."
              action={<Link className="btn btn-outline" to="/services">Browse another category</Link>}
            />
          )}
        </section>

        {data.offices?.length ? (
          <section style={{ marginTop: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '1.15rem' }}>Relevant government offices</h2>
            <div className="grid grid-3">
              {data.offices.map((office) => (
                <Link key={office.id} className="card card-interactive card-link" to={`/government-directory/${office.slug}`}>
                  <div className="card-icon" aria-hidden="true"><Building2 size={20} /></div>
                  <h3 style={{ marginBottom: 0 }}>{office.name}</h3>
                  <div className="card-meta">
                    {office.category ? <span>{office.category}</span> : null}
                    <ServiceVerificationBadge status={office.verification_status} />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <div style={{ marginTop: 'var(--space-6)' }}><ServiceDisclaimer /></div>
      </div>
    </>
  )
}

/* ==========================================================================
 * Service detail page
 * ======================================================================== */
export function ServiceDetail() {
  const { slug } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const { data, loading, error, reload } = useApi(`/services/${slug}`)
  const [saved, setSaved] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const service = data?.service
  useDocumentTitle(service ? service.title : 'Service information')

  useEffect(() => {
    setSaved(Boolean(data?.isFavorited))
    setSubscribed(Boolean(data?.isSubscribed))
  }, [data?.isFavorited, data?.isSubscribed])

  // Print styles for the service sheet only apply while this page is mounted,
  // so printing other pages keeps their normal chrome and headings.
  useEffect(() => {
    document.body.classList.add('print-service')
    return () => document.body.classList.remove('print-service')
  }, [])

  // Record a privacy-conscious view for the signed-in owner only. Guests are
  // never tracked and the API deduplicates repeated views.
  useEffect(() => {
    if (!user || !service?.slug) return
    api
      .post('/account/activity', {
        type: 'service_viewed',
        entityType: 'service',
        entityId: service.id,
        label: service.title,
        slug: service.slug,
      })
      .catch(() => {})
  }, [user, service?.id, service?.slug, service?.title])

  useEffect(() => {
    let cancelled = false
    if (!slug) return undefined
    api
      .get(`/services/${slug}/feedback`)
      .then((payload) => {
        if (!cancelled) setFeedback(payload)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [slug])

  const toggleSave = async () => {
    if (!user) {
      toast.push('Sign in to save services to your private list.', 'error')
      return
    }
    setSaving(true)
    try {
      if (saved) await api.del(`/services/${slug}/favorite`)
      else await api.post(`/services/${slug}/favorite`)
      setSaved(!saved)
      toast.push(saved ? 'Removed from your saved services.' : 'Saved to your private list.')
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleSubscribe = async () => {
    if (!user) {
      toast.push('Sign in to receive service update notifications.', 'error')
      return
    }
    setSaving(true)
    try {
      if (subscribed) await api.del(`/services/${slug}/subscribe`)
      else await api.post(`/services/${slug}/subscribe`)
      setSubscribed(!subscribed)
      toast.push(subscribed ? 'Update notifications turned off.' : 'You will be notified about changes to this service.')
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const share = async () => {
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ title: service?.title, url })
      else {
        await navigator.clipboard.writeText(url)
        toast.push('Link copied to your clipboard.')
      }
    } catch {
      try {
        await navigator.clipboard.writeText(url)
        toast.push('Link copied to your clipboard.')
      } catch {
        toast.push('Copy the address from your browser to share this page.', 'error')
      }
    }
  }

  const quickLinks = useMemo(() => {
    if (!data) return []
    return [
      data.requirements?.length && ['requirements', 'Requirements'],
      data.procedures?.length && ['procedure', 'How to apply'],
      (data.fees?.length || data.processing?.length) && ['fees', 'Fees & time'],
      data.documents?.length && ['documents', 'Forms'],
      data.faqs?.length && ['faqs', 'Questions'],
      ['source', 'Source'],
    ].filter(Boolean)
  }, [data])

  if (loading) {
    return (
      <div className="container section">
        <div className="loading-block" role="status"><span className="spin" aria-hidden="true" /> Loading service information…</div>
        <SkeletonList count={6} height={160} />
      </div>
    )
  }

  if (error || !service) {
    return (
      <div className="container section">
        <EmptyState
          icon={FileText}
          title="Service information not found"
          description="This record may be unpublished, archived or renamed. Only published service information is publicly visible."
          action={<Link className="btn btn-primary" to="/services">Back to the directory</Link>}
        />
      </div>
    )
  }

  const unverified = service.verification_status !== 'verified'

  return (
    <>
      <PageHeader
        eyebrow={service.category_name || 'Government service'}
        title={service.title}
        description={service.short_description || service.description || undefined}
        breadcrumbs={[
          { label: 'Government services', to: '/services' },
          ...(service.parent_category_name
            ? [{ label: service.parent_category_name, to: `/services/category/${service.parent_category_slug}` }]
            : []),
          ...(service.category_slug ? [{ label: service.category_name, to: `/services/category/${service.category_slug}` }] : []),
          { label: service.title },
        ]}
      >
        <div className="row" style={{ gap: '0.45rem', flexWrap: 'wrap' }}>
          <ServiceVerificationBadge status={service.verification_status} />
          <ServiceStatusBadge status={service.availability_status} />
          <ServiceCapabilityBadge capability={data?.capability?.key} service={service} />
        </div>
      </PageHeader>

      <div className="container section-tight">
        <div className="print-only print-doc-head">
          <div className="print-doc-brand">
            <strong>BetterGo Marinduque</strong>
            <span>Independent civic information · Not an official government website</span>
          </div>
          <h1>{service.title}</h1>
          <p className="print-doc-sub">
            {service.category_name || 'Government service'}
            {service.municipality_name ? ` · ${service.municipality_name}` : ''}
            {' · '}
            {service.verification_status === 'verified' ? 'Verified against a recorded source' : 'Verification pending'}
          </p>
          <p className="print-doc-meta">
            Printed {new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}
            {typeof window !== 'undefined' ? ` · ${window.location.href}` : ''}
          </p>
          {service.official_link ? <p className="print-doc-meta">Official page: {service.official_link}</p> : null}
          <p className="print-doc-note">
            Confirm requirements, fees and availability with the responsible office before travelling or paying. This is a copy of the
            public record at the time it was printed.
          </p>
        </div>

        <div className="row no-print" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          <Button variant={saved ? 'primary' : 'outline'} size="sm" onClick={toggleSave} loading={saving} icon={saved ? BookmarkCheck : Bookmark}>
            {saved ? 'Saved' : 'Save service'}
          </Button>
          {data?.betterGoForm ? (
            <Link className="btn btn-primary btn-sm" to={`/apply/${service.slug}`}>Start BetterGo form</Link>
          ) : null}
          <Button variant="outline" size="sm" onClick={share} icon={Share2}>Share</Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            icon={Printer}
            title="Print this service, or choose Save as PDF in the print dialog"
          >
            Print / Save as PDF
          </Button>
          <Button variant={subscribed ? 'secondary' : 'outline'} size="sm" onClick={toggleSubscribe} disabled={saving} icon={subscribed ? BellOff : Bell}>
            {subscribed ? 'Notifications on' : 'Get updates'}
          </Button>
          {service.official_link ? (
            <a className="btn btn-outline btn-sm" href={service.official_link} target="_blank" rel="noopener noreferrer">
              Visit official page <ExternalLink size={14} aria-hidden="true" />
            </a>
          ) : null}
        </div>

        {unverified ? (
          <Alert tone="warning" title="This record is not fully verified">
            BetterGo has not confirmed every detail against an official source
            {service.last_reviewed_at ? ` (last reviewed ${fmtDate(service.last_reviewed_at)})` : ''}. Confirm requirements, fees and
            availability with the responsible office before acting on this information.
          </Alert>
        ) : null}

        {quickLinks.length ? (
          <nav aria-label="On this page" className="pill-group no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', margin: 'var(--space-4) 0' }}>
            {quickLinks.map(([id, label]) => (
              <a key={id} className="pill" href={`#${id}`}>{label}</a>
            ))}
          </nav>
        ) : null}

        <div className="detail-layout">
          <div style={{ display: 'grid', gap: 'var(--space-4)', minWidth: 0 }}>
            <section className="card" id="about">
              <h2 style={{ marginTop: 0 }}>About this service</h2>
              <div className="prose">
                {service.full_description || service.description ? (
                  String(service.full_description || service.description)
                    .split(/\n{2,}/)
                    .map((paragraph, index) => <p key={index}>{paragraph}</p>)
                ) : (
                  <p className="text-muted">A full description has not been recorded for this service yet.</p>
                )}
              </div>
              {service.eligibility ? (
                <>
                  <h3>Who can apply</h3>
                  <p>{service.eligibility}</p>
                </>
              ) : null}
              <dl className="detail-list" style={{ marginTop: '0.75rem' }}>
                <div><dt>Service type</dt><dd>{service.service_type ? String(service.service_type).replace(/_/g, ' ') : 'Not recorded'}</dd></div>
                <div><dt>Coverage</dt><dd>{String(service.service_scope || service.coverage_type || 'province_wide').replace(/_/g, ' ')}</dd></div>
                <div><dt>Application</dt><dd>{service.application_mode ? String(service.application_mode).replace(/_/g, ' ') : service.is_online ? 'Online' : 'Not recorded'}</dd></div>
                <div><dt>Last updated</dt><dd>{fmtDate(service.updated_at)}</dd></div>
              </dl>
            </section>

            <section className="card" id="requirements">
              <h2 style={{ marginTop: 0 }}>Requirements and document checklist</h2>
              <RequirementsChecklist serviceSlug={service.slug} requirements={data.requirements} />
            </section>

            <section className="card" id="procedure">
              <h2 style={{ marginTop: 0 }}>Step-by-step application procedure</h2>
              <ServiceProcedures procedures={data.procedures} />
            </section>

            <section className="card" id="fees">
              <h2 style={{ marginTop: 0 }}>Fees</h2>
              <ServiceFees fees={data.fees} />
              <h3 style={{ marginTop: '1rem' }}>Processing time</h3>
              {data.processing?.length ? (
                <ul className="detail-list detail-list-rows">
                  {data.processing.map((item) => (
                    <li key={item.id}>
                      <span>{item.processing_time} <span className="text-muted">({item.processing_unit})</span></span>
                      {item.conditions ? <span className="text-sm text-muted">{item.conditions}</span> : null}
                      {item.source_reference ? <span className="text-xs text-muted">{item.source_reference}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">Processing time has not been recorded.</p>
              )}
              {service.payment_instructions ? (
                <>
                  <h3>Payment instructions</h3>
                  <p>{service.payment_instructions}</p>
                </>
              ) : null}
              <p className="help">BetterGo never collects payments. Pay only through the responsible office or its official channel.</p>
            </section>

            <section className="card" id="documents">
              <h2 style={{ marginTop: 0 }}>Forms and downloadable documents</h2>
              {data.documents?.length ? (
                <ul className="link-list">
                  {data.documents.map((document) => (
                    <li key={document.id}>
                      <div>
                        <strong>{document.document_title}</strong>
                        <span className="text-xs text-muted" style={{ display: 'block' }}>
                          {String(document.document_type || 'document').replace(/_/g, ' ')}
                          {document.publication_date ? ` · ${fmtDate(document.publication_date)}` : ''}
                        </span>
                      </div>
                      {document.external_url ? (
                        <a className="btn btn-outline btn-sm" href={document.external_url} target="_blank" rel="noopener noreferrer">
                          Open <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      ) : document.file_reference ? (
                        <span className="badge badge-neutral"><FileText size={12} aria-hidden="true" /> {document.file_reference}</span>
                      ) : (
                        <span className="text-xs text-muted">No file link recorded</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">No approved form or downloadable document has been recorded for this service.</p>
              )}
              <p className="help">Only forms published by the responsible office should be treated as official. BetterGo does not create government forms.</p>
            </section>

            <section className="card" id="coverage">
              <h2 style={{ marginTop: 0 }}>Where this service is available</h2>
              <ServiceCoverageList coverage={data.coverage} service={service} />
              {service.municipality_name ? (
                <p className="text-sm text-muted">
                  Primary location: <Link to={`/municipalities/${service.municipality_slug}`}>{service.municipality_name}</Link>
                </p>
              ) : null}
            </section>

            <section className="card" id="faqs">
              <h2 style={{ marginTop: 0 }}>Frequently asked questions</h2>
              {data.faqs?.length ? (
                <div>
                  {data.faqs.map((faq) => (
                    <details key={faq.id} style={{ borderBottom: '1px solid var(--border)', padding: '0.6rem 0' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 650 }}>{faq.question}</summary>
                      <p className="text-sm" style={{ marginTop: '0.4rem' }}>{faq.answer}</p>
                    </details>
                  ))}
                </div>
              ) : (
                <p className="text-muted">No service-specific questions have been published yet. See the <Link to="/faqs">general service FAQs</Link>.</p>
              )}
            </section>

            {data.updates?.length ? (
              <section className="card">
                <h2 style={{ marginTop: 0 }}>Recorded updates</h2>
                <ul className="timeline">
                  {data.updates.map((update) => (
                    <li key={update.id}>
                      <span className="text-sm">{update.summary}</span>
                      <span className="text-xs text-muted"> {fmtDate(update.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {feedback ? (
              <ServiceFeedback slug={service.slug} summary={feedback.summary} initial={feedback.results} user={user} />
            ) : null}

            <section className="card" id="source">
              <h2 style={{ marginTop: 0 }}>Source and verification</h2>
              <ServiceSourcePanel service={service} />
              <p className="help">
                Approval to publish is not the same as source verification. A record can be published while its verification is still
                pending, which is why the status is always displayed.
              </p>
            </section>
          </div>

          <aside className="detail-aside">
            {service.office_name ? (
              <section className="card">
                <div className="card-icon" aria-hidden="true"><Building2 size={20} /></div>
                <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Responsible office</h2>
                <p style={{ marginBottom: '0.4rem' }}>{service.office_name}</p>
                <dl className="detail-list">
                  {service.office_address ? <div><dt>Address</dt><dd>{service.office_address}</dd></div> : null}
                  {service.office_hours ? <div><dt>Hours</dt><dd>{service.office_hours}</dd></div> : null}
                  {service.office_phone ? (
                    <div><dt>Phone</dt><dd><a href={`tel:${String(service.office_phone).replace(/[^0-9+]/g, '')}`}>{service.office_phone}</a></dd></div>
                  ) : null}
                  {service.office_email ? (
                    <div><dt>Email</dt><dd><a href={`mailto:${service.office_email}`}>{service.office_email}</a></dd></div>
                  ) : null}
                </dl>
                <div className="card-actions">
                  <Link className="btn btn-outline btn-sm" to={`/government-directory/${service.office_slug}`}>Office page</Link>
                  {service.office_website ? (
                    <a className="btn btn-ghost btn-sm" href={service.office_website} target="_blank" rel="noopener noreferrer">Website</a>
                  ) : null}
                </div>
                <p className="help">Contact details are shown as recorded. Confirm them before travelling.</p>
              </section>
            ) : (
              <section className="card">
                <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Responsible office</h2>
                <p className="text-muted">No responsible office has been recorded for this service yet.</p>
              </section>
            )}

            <section className="card no-print">
              <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Quick facts</h2>
              <dl className="detail-list">
                <div><dt>Category</dt><dd>{service.category_name || 'Not recorded'}</dd></div>
                <div><dt>Verification</dt><dd><ServiceVerificationBadge status={service.verification_status} /></dd></div>
                <div><dt>Availability</dt><dd><ServiceStatusBadge status={service.availability_status} /></dd></div>
                <div className="no-print"><dt>Saved by</dt><dd>{data.favorites || 0} resident{data.favorites === 1 ? '' : 's'}</dd></div>
                <div className="no-print"><dt>Feedback</dt><dd>{data.feedbackSummary?.total ? `${data.feedbackSummary.average} / 5` : 'No published feedback'}</dd></div>
                <div><dt>Published</dt><dd>{service.published_at ? fmtDate(service.published_at) : 'Not recorded'}</dd></div>
              </dl>
            </section>

            {data.related?.length ? (
              <section className="card no-print">
                <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Related services</h2>
                <ul className="link-list">
                  {data.related.map((item) => (
                    <li key={item.id}>
                      <Link to={`/services/${item.slug}`}>{item.title}</Link>
                      <ChevronRight size={14} aria-hidden="true" />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <ServiceDisclaimer compact />
          </aside>
        </div>

        <div className="no-print" style={{ marginTop: 'var(--space-6)' }}>
          <Link className="btn btn-ghost btn-sm" to="/services"><ArrowLeft size={14} aria-hidden="true" /> Back to the directory</Link>
        </div>
      </div>
    </>
  )
}
