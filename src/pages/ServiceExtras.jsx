import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  Info,
  MapPin,
  Search,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import { fmtDate, query } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Input, Pagination, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'
import { SectionHeading } from '../components/cards'
import { ServiceCard, ServiceCategoryCard, ServiceDisclaimer } from '../components/services'

/* ---------------------------- Municipality coverage ---------------------- */
export function ServiceCoveragePage() {
  const [params, setParams] = useSearchParams()
  const municipality = params.get('municipality') || ''
  const { data, loading, error } = useApi(`/service-coverage${query({ municipality })}`)
  const { data: lookups } = useApi('/lookups')
  useDocumentTitle('Service coverage by municipality')

  return (
    <>
      <PageHeader
        eyebrow="Coverage"
        title="Which services are recorded for each municipality?"
        description="Coverage shows where a service is recorded as available. It is based on published BetterGo records, not on an assumption that every provincial service operates in every town."
        breadcrumbs={[{ label: 'Government services', to: '/services' }, { label: 'Coverage' }]}
      />

      <div className="container section-tight">
        <div className="card">
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <div className="field grow" style={{ marginBottom: 0 }}>
              <label className="label" htmlFor="coverage-municipality">Municipality</label>
              <Select
                id="coverage-municipality"
                value={municipality}
                onChange={(event) => {
                  const next = new URLSearchParams(params)
                  if (event.target.value) next.set('municipality', event.target.value)
                  else next.delete('municipality')
                  setParams(next)
                }}
              >
                <option value="">All six municipalities</option>
                {(lookups?.municipalities || []).map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
              </Select>
            </div>
            <Link className="btn btn-outline" to="/services">Browse the directory</Link>
          </div>
        </div>

        {loading ? (
          <div style={{ marginTop: 'var(--space-5)' }}><SkeletonList count={6} height={180} /></div>
        ) : error ? (
          <Alert tone="error" title="Coverage information could not be loaded">{error.message}</Alert>
        ) : (
          <>
            <p className="text-sm text-muted">{data?.policy}</p>
            <div className="grid grid-2" style={{ marginTop: 'var(--space-4)' }}>
              {(data?.results || []).map((row) => (
                <section className="card" key={row.municipality.slug}>
                  <div className="row-between">
                    <div className="row">
                      <div className="card-icon" aria-hidden="true"><MapPin size={20} /></div>
                      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{row.municipality.name}</h2>
                    </div>
                    <Badge tone={row.service_count ? 'success' : 'neutral'}>
                      {row.service_count} service{row.service_count === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  {row.categories.length ? (
                    <div className="pill-group" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', margin: '0.6rem 0' }}>
                      {row.categories.slice(0, 8).map((category) => (
                        <Link key={category.slug} className="pill" to={`/services/category/${category.slug}`}>
                          {category.name} · {category.count}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">No published service records are linked to this municipality yet.</p>
                  )}
                  {row.services.length ? (
                    <ul className="link-list">
                      {row.services.slice(0, 6).map((service) => (
                        <li key={service.id}>
                          <Link to={`/services/${service.slug}`}>{service.title}</Link>
                          <ArrowRight size={14} aria-hidden="true" />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="card-actions">
                    <Link className="btn btn-ghost btn-sm" to={`/services?municipality=${row.municipality.slug}`}>
                      Search services in {row.municipality.name}
                    </Link>
                  </div>
                </section>
              ))}
            </div>
          </>
        )}

        <div style={{ marginTop: 'var(--space-6)' }}><ServiceDisclaimer /></div>
      </div>
    </>
  )
}

/* -------------------------------- FAQs ---------------------------------- */
export function ServiceFaqsPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const [term, setTerm] = useState(q)
  const { data, loading, error } = useApi(`/service-faqs${query({ q })}`)
  useDocumentTitle('Government service FAQs')

  return (
    <>
      <PageHeader
        eyebrow="Guidance"
        title="Government service questions"
        description="Questions recorded for specific services, grouped by service. Answers come from the service record and should be confirmed with the responsible office."
        breadcrumbs={[{ label: 'Government services', to: '/services' }, { label: 'FAQs' }]}
      />
      <div className="container section-tight">
        <form
          className="toolbar card"
          onSubmit={(event) => {
            event.preventDefault()
            const next = new URLSearchParams(params)
            if (term.trim()) next.set('q', term.trim())
            else next.delete('q')
            setParams(next)
          }}
        >
          <div className="field grow" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="faq-search">Search questions</label>
            <Input id="faq-search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="e.g. requirements, fee, processing time" />
          </div>
          <Button type="submit" icon={Search}>Search</Button>
        </form>

        {loading ? (
          <SkeletonList count={6} height={150} />
        ) : error ? (
          <Alert tone="error" title="FAQs could not be loaded">{error.message}</Alert>
        ) : data?.results?.length ? (
          <div className="grid" style={{ gap: 'var(--space-4)' }}>
            {data.results.map((group) => (
              <section className="card" key={group.service_slug}>
                <div className="row-between">
                  <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{group.service_title}</h2>
                  <Link className="btn btn-ghost btn-sm" to={`/services/${group.service_slug}`}>Service page</Link>
                </div>
                {group.items.map((item) => (
                  <details key={item.id} style={{ borderBottom: '1px solid var(--border)', padding: '0.6rem 0' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 650 }}>{item.question}</summary>
                    <p className="text-sm" style={{ marginTop: '0.4rem' }}>{item.answer}</p>
                  </details>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={BookOpen}
            title={q ? 'No service questions match that search' : 'No service questions published yet'}
            description={
              q
                ? 'Try a simpler keyword, or open the service page directly from the directory.'
                : 'Questions appear here once published service records include them. Platform-level questions are answered on the About page.'
            }
            action={<Link className="btn btn-primary" to="/services">Browse services</Link>}
          />
        )}
        <div style={{ marginTop: 'var(--space-6)' }}><ServiceDisclaimer /></div>
      </div>
    </>
  )
}

/* ------------------------------- Resources ------------------------------- */
export function ServiceResourcesPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const type = params.get('type') || ''
  const page = Number(params.get('page') || 1)
  const { data, loading, error } = useApi(`/service-resources${query({ q, type, page, limit: 20 })}`)
  const [term, setTerm] = useState(q)
  useDocumentTitle('Government forms and resources')
  const setParam = (key, value) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'page') next.delete('page')
      return next
    })
  }

  return (
    <>
      <PageHeader
        eyebrow="Resources"
        title="Government forms, checklists and applications"
        description="Approved forms, checklists and external application resources linked to published services. BetterGo does not create or alter official government forms."
        breadcrumbs={[{ label: 'Government services', to: '/services' }, { label: 'Resources' }]}
      />
      <div className="container section-tight">
        <form
          className="toolbar card"
          onSubmit={(event) => {
            event.preventDefault()
            setParam('q', term.trim())
          }}
        >
          <div className="field grow" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="resource-search">Search resources</label>
            <Input id="resource-search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="e.g. business permit form" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="resource-type">Type</label>
            <Select id="resource-type" value={type} onChange={(event) => setParam('type', event.target.value)}>
              <option value="">All types</option>
              {(data?.types || []).map((item) => (
                <option key={item.document_type} value={item.document_type}>{String(item.document_type).replace(/_/g, ' ')}</option>
              ))}
            </Select>
          </div>
          <Button type="submit" icon={Search}>Search</Button>
        </form>

        {loading ? (
          <SkeletonList count={6} height={120} />
        ) : error ? (
          <Alert tone="error" title="Resources could not be loaded">{error.message}</Alert>
        ) : data?.results?.length ? (
          <>
            <div className="grid grid-2">
              {data.results.map((resource) => (
                <div className="card" key={resource.id}>
                  <div className="row-between">
                    <Badge>{String(resource.document_type).replace(/_/g, ' ')}</Badge>
                    <span className="text-xs text-muted">{resource.publication_date ? fmtDate(resource.publication_date) : 'Date not recorded'}</span>
                  </div>
                  <h3 style={{ marginBottom: '0.25rem' }}>{resource.document_title}</h3>
                  <p className="text-sm text-muted" style={{ margin: 0 }}>
                    Linked to <Link to={`/services/${resource.service_slug}`}>{resource.service_title}</Link>
                    {resource.category_name ? ` · ${resource.category_name}` : ''}
                  </p>
                  <div className="card-actions">
                    {resource.external_url ? (
                      <a className="btn btn-outline btn-sm" href={resource.external_url} target="_blank" rel="noopener noreferrer">
                        Open resource <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted">No public link recorded</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} onChange={(next) => setParam('page', String(next))} />
          </>
        ) : (
          <EmptyState
            icon={FileText}
            title={q || type ? 'No resources match those filters' : 'No approved resources published yet'}
            description="Forms and links appear here only after they are linked to a published service record."
            action={<Link className="btn btn-primary" to="/services">Browse services</Link>}
          />
        )}
        <div style={{ marginTop: 'var(--space-6)' }}><ServiceDisclaimer /></div>
      </div>
    </>
  )
}

/* ----------------------------- Developer portal --------------------------- */
const SAMPLE = `curl -s "https://your-domain.example/api/v1/services?municipality=boac&limit=5"`

export function DevelopersPage() {
  useDocumentTitle('Developer portal')
  const { data } = useApi('/v1/meta')
  return (
    <>
      <PageHeader
        eyebrow="Developers"
        title="Government services data for builders"
        description="A read-only, rate-limited API over published BetterGo service information. Built for transparency, research and community tools."
        breadcrumbs={[{ label: 'Government services', to: '/services' }, { label: 'Developers' }]}
      >
        <Link className="btn btn-primary" to="/developers/api-docs">Read the API documentation</Link>
      </PageHeader>
      <div className="container section-tight">
        <div className="grid grid-3">
          <div className="card">
            <div className="card-icon" aria-hidden="true"><Code2 size={20} /></div>
            <h2 style={{ fontSize: '1.05rem' }}>Published records only</h2>
            <p className="text-sm text-muted">Drafts, rejected records and internal notes are never returned by the public API.</p>
          </div>
          <div className="card">
            <div className="card-icon" aria-hidden="true"><ShieldCheck size={20} /></div>
            <h2 style={{ fontSize: '1.05rem' }}>Verification is explicit</h2>
            <p className="text-sm text-muted">Every service includes a verification status so your interface can label unconfirmed information.</p>
          </div>
          <div className="card">
            <div className="card-icon" aria-hidden="true"><Terminal size={20} /></div>
            <h2 style={{ fontSize: '1.05rem' }}>Free, no key required</h2>
            <p className="text-sm text-muted">Anonymous access is rate limited. Optional API keys are issued by administrators when higher limits are agreed.</p>
          </div>
        </div>

        <section style={{ marginTop: 'var(--space-6)' }}>
          <SectionHeading eyebrow="Quick start" title="Fetch published services" description="No authentication is needed for anonymous, rate-limited reads." />
          <pre className="card" style={{ overflowX: 'auto', padding: 'var(--space-4)' }}><code>{SAMPLE}</code></pre>
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link className="btn btn-outline btn-sm" to="/developers/api-docs">Endpoint reference</Link>
            <a className="btn btn-ghost btn-sm" href="/api/openapi.json" target="_blank" rel="noopener noreferrer">OpenAPI document</a>
            <a className="btn btn-ghost btn-sm" href="/api/v1/meta" target="_blank" rel="noopener noreferrer">API metadata</a>
          </div>
        </section>

        {data ? (
          <section className="card" style={{ marginTop: 'var(--space-6)' }}>
            <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>API status</h2>
            <dl className="detail-list">
              <div><dt>Version</dt><dd>{data.version} · {data.status}</dd></div>
              <div><dt>Generated</dt><dd>{fmtDate(data.generated_at)}</dd></div>
              <div><dt>Authentication</dt><dd>{data.authentication}</dd></div>
            </dl>
            <Alert tone="info" title="Licence and disclaimer">{data.licence}</Alert>
          </section>
        ) : null}

        <div style={{ marginTop: 'var(--space-6)' }}><ServiceDisclaimer /></div>
      </div>
    </>
  )
}

export function ApiDocsPage() {
  useDocumentTitle('API documentation')
  const toast = useToast()
  const { data } = useApi('/v1/meta')
  const endpoints = [
    ['GET', '/api/v1/services', 'Search published services', 'q, category, municipality, office, availability, verification, page, limit'],
    ['GET', '/api/v1/services/{slug}', 'Full published service record with requirements, procedures, fees, coverage, documents and FAQs', 'slug'],
    ['GET', '/api/v1/categories', 'The 25 category groups and their subcategories with published counts', '—'],
    ['GET', '/api/v1/offices', 'Published government offices', 'page, limit'],
    ['GET', '/api/v1/municipalities', 'The six municipalities of Marinduque', '—'],
    ['GET', '/api/v1/coverage', 'Recorded municipality and barangay coverage', '—'],
    ['GET', '/api/v1/resources', 'Approved forms and external application links', '—'],
    ['GET', '/api/v1/faqs', 'Published service questions and answers', '—'],
    ['GET', '/api/v1/meta', 'API version, licence and endpoint list', '—'],
    ['GET', '/api/municipal-portals', 'Six municipal portals with published record counts', '—'],
    ['GET', '/api/municipal-portals/{slug}', 'Municipal dashboard payload: profile, metrics, advisories, projects and programs', 'slug'],
    ['GET', '/api/municipal-projects', 'Published municipal projects', 'municipality, status, q, office, sort, page, limit'],
    ['GET', '/api/municipal-programs', 'Published municipal programs and initiatives', 'municipality, upcoming, page, limit'],
    ['GET', '/api/municipal-resources', 'Published municipal resources and public documents', 'municipality, category, q'],
    ['GET', '/api/municipal-faqs', 'Published municipal frequently asked questions', 'municipality, q'],
    ['GET', '/api/municipal-offices', 'Published municipal offices with verified map markers only', 'municipality, q, level'],
    ['GET', '/api/municipal-search', 'Cross-municipality discovery across updates, offices, services and documents', 'q (required), municipality'],
    ['GET', '/api/municipal-portal-meta', 'Filter and label dictionaries for the municipal modules', '—'],
    ['GET', '/api/v1/municipal-projects', 'Read-only municipal project feed', 'municipality, status, page, limit'],
    ['GET', '/api/v1/municipal-programs', 'Read-only municipal program feed', 'municipality, page, limit'],
    ['GET', '/api/v1/municipal-offices', 'Read-only municipal office directory', 'municipality, limit'],
    ['GET', '/api/openapi.json', 'OpenAPI 3 description of this API', '—'],
  ]
  return (
    <>
      <PageHeader
        eyebrow="Developers"
        title="Government services API documentation"
        description="Read-only endpoints over published service information. Responses are JSON and include a disclaimer."
        breadcrumbs={[{ label: 'Government services', to: '/services' }, { label: 'Developers', to: '/developers' }, { label: 'API docs' }]}
      />
      <div className="container section-tight">
        <Alert tone="info" title="Before you build">
          BetterGo Marinduque is an independent civic platform, not an official government publisher. Always show the verification
          status and link people to the responsible office. Rate limits apply per IP address.
        </Alert>

        <section className="card" style={{ marginTop: 'var(--space-4)' }}>
          <h2 style={{ marginTop: 0 }}>Endpoints</h2>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Public API endpoints</caption>
              <thead><tr><th scope="col">Method</th><th scope="col">Path</th><th scope="col">Description</th><th scope="col">Parameters</th></tr></thead>
              <tbody>
                {endpoints.map(([method, path, description, params]) => (
                  <tr key={path}>
                    <td><Badge tone="success">{method}</Badge></td>
                    <td><code>{path}</code></td>
                    <td>{description}</td>
                    <td className="text-xs text-muted">{params}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" style={{ marginTop: 'var(--space-4)' }}>
          <h2 style={{ marginTop: 0 }}>Response shape</h2>
          <pre style={{ overflowX: 'auto' }}><code>{`{
  "data": [
    {
      "id": 1,
      "title": "Service name",
      "slug": "service-name",
      "category_name": "Health and Medical Services",
      "verification_status": "verified",
      "availability_status": "available",
      "service_scope": "province_wide"
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 10, "totalPages": 1 },
  "disclaimer": "Published by BetterGo Marinduque..."
}`}</code></pre>
          <div className="row">
            <Button
              variant="outline"
              size="sm"
              icon={Copy}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${window.location.origin}/api/openapi.json`)
                  toast.push('OpenAPI URL copied.')
                } catch {
                  toast.push('Copy the URL from your browser.', 'error')
                }
              }}
            >
              Copy OpenAPI URL
            </Button>
            <a className="btn btn-ghost btn-sm" href="/api/openapi.json" target="_blank" rel="noopener noreferrer">View OpenAPI JSON</a>
          </div>
        </section>

        {data ? (
          <section className="card" style={{ marginTop: 'var(--space-4)' }}>
            <h2 style={{ marginTop: 0 }}>Authentication and limits</h2>
            <p className="text-sm">{data.authentication}</p>
            <ul className="detail-list detail-list-rows">
              <li><span>Anonymous rate limit</span><span>120 requests per minute per IP address</span></li>
              <li><span>Feedback submissions</span><span>5 per minute per IP address, one per service per account per day</span></li>
              <li><span>API keys</span><span>Issued only by platform administrators; keys are stored hashed and can be revoked</span></li>
            </ul>
            <p className="help"><Info size={13} aria-hidden="true" /> Do not scrape restricted government systems or republish unverified records as official information.</p>
          </section>
        ) : null}
        <div style={{ marginTop: 'var(--space-6)' }}><ServiceDisclaimer /></div>
      </div>
    </>
  )
}

/* ------------------------ Category index (redirect helper) --------------- */
export function ServiceCategoriesPage() {
  useDocumentTitle('Service categories')
  const { data, loading } = useApi('/services/categories')
  return (
    <>
      <PageHeader
        eyebrow="Categories"
        title="All government service categories"
        description="Every category group and subcategory in the BetterGo services directory."
        breadcrumbs={[{ label: 'Government services', to: '/services' }, { label: 'Categories' }]}
      />
      <div className="container section-tight">
        {loading ? <SkeletonList count={6} height={160} /> : (
          <div className="grid grid-3">
            {(data?.results || []).map((category) => <ServiceCategoryCard key={category.id} category={category} />)}
          </div>
        )}
        <div style={{ marginTop: 'var(--space-6)' }}><ServiceDisclaimer /></div>
      </div>
    </>
  )
}
