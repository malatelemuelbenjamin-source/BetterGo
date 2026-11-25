import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  Download,
  ExternalLink,
  FileText,
  Info,
  Landmark,
  ShieldCheck,
} from 'lucide-react'
import { fmtDate, fmtPeso, query } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Pagination, Select, SkeletonList, VerificationBadge } from '../components/ui'
import { PageHeader } from '../components/layout'
import SaveButton from '../components/SaveButton'
import { SectionHeading, StatCard, TransparencyCard } from '../components/cards'
import { useLang } from '../i18n'

const CATEGORY_TABS = [
  { value: '', label: 'All records', key: 'transparency.tabAll' },
  { value: 'budget', label: 'Budget', key: 'transparency.tabBudget' },
  { value: 'expenditure', label: 'Expenditure', key: 'transparency.tabExpenditure' },
  { value: 'procurement', label: 'Procurement', key: 'transparency.tabProcurement' },
  { value: 'accountability', label: 'Accountability', key: 'transparency.tabAccountability' },
]

function BudgetBars({ rows }) {
  if (!rows?.length) return null
  const max = Math.max(...rows.map((row) => Number(row.total_cents) || 0), 1)
  return (
    <div className="bar-list">
      {rows.map((row) => (
        <div className="bar-row" key={`${row.fiscal_year}-${row.financial_category}`}>
          <span className="text-muted">{row.fiscal_year} · {row.financial_category.replace(/_/g, ' ')}</span>
          <div className="bar-track" role="img" aria-label={`${row.financial_category} ${row.fiscal_year}: ${fmtPeso(row.total_cents)}`}>
            <div className="bar-fill" style={{ width: `${Math.max(4, (Number(row.total_cents) / max) * 100)}%` }} />
          </div>
          <span style={{ fontWeight: 700 }}>{fmtPeso(row.total_cents)}</span>
        </div>
      ))}
    </div>
  )
}

export function TransparencyDashboard() {
  const { t } = useLang()
  const [params, setParams] = useSearchParams()
  const category = params.get('category') || ''
  const municipality = params.get('municipality') || ''
  useDocumentTitle('Transparency')
  const { data, loading, error } = useApi('/transparency')
  const { data: lookups } = useApi('/lookups')

  const records = (data?.records || []).filter((record) => {
    const matchesCategory = !category || record.record_category === category
    const matchesMunicipality = !municipality || record.municipality_slug === municipality
    return matchesCategory && matchesMunicipality
  })

  return (
    <>
      <PageHeader
        eyebrow={t('transparency.eyebrow', 'Accountability')}
        title={t('transparency.title', 'Government transparency and public information')}
        description={t('transparency.description')}
        icon={Landmark}
        breadcrumbs={[{ label: t('nav.transparency', 'Transparency') }]}
        actions={<Link className="btn btn-outline" to="/transparency/documents">{t('transparency.documents', 'Public documents')}</Link>}
      />

      <div className="container section-tight">
        <Alert tone="warning" title={t('transparency.readFirst', 'Read this first')}>
          {t('transparency.alert')}
        </Alert>

        <p className="text-xs text-muted mt-3">
          {t('transparency.freshness', 'Data freshness:')}{' '}
          {data?.lastUpdated ? `${t('transparency.lastUpdate', 'last record update')} ${fmtDate(data.lastUpdated)}` : t('transparency.noRecords', 'no records published yet')}.
        </p>

        {loading ? (
          <div className="mt-4"><SkeletonList count={4} height={120} /></div>
        ) : error ? (
          <EmptyState
            title={t('transparency.unavailableTitle', 'Transparency data temporarily unavailable')}
            description={t('munis.errorDesc', 'Please try again shortly.')}
            action={<Button onClick={() => window.location.reload()}>{t('transparency.retry', 'Retry')}</Button>}
          />
        ) : (
          <>
            <div className="grid grid-4 mt-4">
              <StatCard label={t('transparency.statBudget', 'Budget records')} value={data.counts.budget} hint={t('transparency.publishedRecords', 'Published records')} icon={Landmark} />
              <StatCard label={t('transparency.statExpenditure', 'Expenditure reports')} value={data.counts.expenditure} hint={t('transparency.publishedRecords', 'Published records')} icon={FileText} />
              <StatCard label={t('transparency.statProcurement', 'Procurement records')} value={data.counts.procurement} hint={t('transparency.publishedRecords', 'Published records')} icon={FileText} />
              <StatCard label={t('transparency.statDocuments', 'Public documents')} value={data.counts.documents} hint={t('transparency.downloadable', 'Available for download')} icon={Download} />
            </div>

            <section className="mt-6" aria-labelledby="budget-charts-heading">
              <SectionHeading
                eyebrow={t('transparency.financialEyebrow', 'Financial data')}
                title={<span id="budget-charts-heading">{t('transparency.financialTitle', 'Published financial records')}</span>}
                description={t('transparency.financialDesc')}
              />
              {data.budget?.length ? (
                <>
                  <div className="card">
                    <BudgetBars rows={data.budget} />
                  </div>
                  <div className="table-wrap mt-3">
                    <table className="data">
                      <caption className="sr-only">Verified financial totals by fiscal year and category</caption>
                      <thead>
                        <tr>
                          <th>{t('transparency.fiscalYear', 'Fiscal year')}</th>
                          <th>{t('transparency.category', 'Category')}</th>
                          <th style={{ textAlign: 'right' }}>{t('transparency.total', 'Total (PHP)')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.budget.map((row) => (
                          <tr key={`${row.fiscal_year}-${row.financial_category}`}>
                            <td>{row.fiscal_year}</td>
                            <td>{row.financial_category.replace(/_/g, ' ')}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtPeso(row.total_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="help mt-2">
                    Totals are simple sums of verified records for the same fiscal year and category. Proposed and approved budgets are
                    reported separately, and allocations, obligations, disbursements and expenditures are never combined.
                  </p>
                </>
              ) : (
                <EmptyState
                  icon={Landmark}
                  title={t('transparency.noFinancialTitle', 'No verified financial records yet')}
                  description={t('transparency.noFinancialDesc')}
                  action={<a className="btn btn-outline" href="https://www.coa.gov.ph/" target="_blank" rel="noopener noreferrer">Commission on Audit website</a>}
                />
              )}
            </section>

            <section className="mt-6" aria-labelledby="municipality-transparency-heading">
              <SectionHeading
                eyebrow={t('transparency.coverageEyebrow', 'Coverage')}
                title={<span id="municipality-transparency-heading">{t('transparency.coverageTitle', 'Records by municipality')}</span>}
                description={t('transparency.coverageDesc')}
              />
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>{t('transparency.municipality', 'Municipality')}</th><th style={{ textAlign: 'right' }}>{t('transparency.publishedRecords', 'Published records')}</th><th /></tr></thead>
                  <tbody>
                    {(data.byMunicipality || []).map((row) => (
                      <tr key={row.id}>
                        <td><Link to={`/municipalities/${row.slug}`}>{row.name}</Link></td>
                        <td style={{ textAlign: 'right' }}>{row.records}</td>
                        <td style={{ textAlign: 'right' }}>
                          <Link className="btn btn-ghost btn-sm" to={`/transparency?municipality=${row.slug}`}>{t('transparency.filter', 'Filter')}</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-6" aria-labelledby="records-heading">
              <SectionHeading
                eyebrow={t('transparency.records', 'Records')}
                title={<span id="records-heading">{t('transparency.recordsTitle', 'Published transparency records')}</span>}
                action={
                  <Select value={municipality} onChange={(event) => setParams(event.target.value ? { municipality: event.target.value } : {})} aria-label="Filter records by municipality" style={{ minWidth: 180 }}>
                    <option value="">{t('transparency.allMunicipalities', 'All municipalities')}</option>
                    {(lookups?.municipalities || []).map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
                  </Select>
                }
              />
              <div className="row mb-3" style={{ gap: '0.35rem' }}>
                {CATEGORY_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    className={`pill ${category === tab.value ? 'is-active' : ''}`}
                    onClick={() => setParams(tab.value ? { category: tab.value, ...(municipality ? { municipality } : {}) } : municipality ? { municipality } : {})}
                    aria-pressed={category === tab.value}
                  >
                    {t(tab.key, tab.label)}
                  </button>
                ))}
              </div>

              {records.length ? (
                <div className="stack">
                  {records.map((record) => (
                    <article key={record.id} className="card">
                      <div className="row" style={{ gap: '0.4rem' }}>
                        <Badge>{record.record_category}</Badge>
                        <Badge>{record.government_level === 'provincial' ? 'Provincial' : record.municipality_name || 'Municipal'}</Badge>
                        <VerificationBadge status={record.verification_status} />
                        {record.fiscal_year ? <Badge>FY {record.fiscal_year}</Badge> : null}
                      </div>
                      <h3 style={{ marginTop: '0.4rem', fontSize: '1.02rem' }}>{record.title}</h3>
                      <p className="text-sm text-muted">{record.description}</p>
                      <div className="card-meta">
                        {record.issuing_office ? <span>{record.issuing_office}</span> : null}
                        {record.period_label ? <span>{record.period_label}</span> : null}
                        {record.publication_date ? <span>{fmtDate(record.publication_date)}</span> : null}
                        {record.source_url ? (
                          <a href={record.source_url} target="_blank" rel="noopener noreferrer">Original source <ExternalLink size={11} aria-hidden="true" /></a>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={FileText}
                  title="No records for this filter"
                  description="Try another category or municipality. Records appear once they are approved and published."
                />
              )}
            </section>

            <section className="mt-6">
              <SectionHeading
                eyebrow="Documents"
                title="Public document library"
                action={<Link className="btn btn-outline" to="/transparency/documents">Browse all documents <ArrowRight size={14} aria-hidden="true" /></Link>}
              />
              {data.documents?.length ? (
                <div className="grid grid-2">
                  {data.documents.map((document) => (
                    <Link key={document.id} to={`/transparency/documents/${document.slug}`} className="card card-interactive card-link">
                      <div className="row-between">
                        <Badge>{document.document_category}</Badge>
                        <VerificationBadge status={document.verification_status} />
                      </div>
                      <h3 style={{ fontSize: '1rem' }}>{document.title}</h3>
                      <div className="card-meta">
                        {document.fiscal_year ? <span>FY {document.fiscal_year}</span> : null}
                        {document.publication_date ? <span>{fmtDate(document.publication_date)}</span> : null}
                        {document.issuing_organization ? <span>{document.issuing_organization}</span> : null}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState icon={FileText} title="No documents published yet" description="Public documents appear here once uploaded, reviewed and approved for public access." />
              )}
            </section>

            <div className="meta-panel mt-5">
              <h3 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>Method and limitations</h3>
              <ul className="text-sm text-muted" style={{ paddingLeft: '1.1rem' }}>
                <li>Currency values are stored as integer centavos to avoid floating-point rounding.</li>
                <li>Budget allocations, obligations, disbursements and expenditures are kept as distinct categories.</li>
                <li>Summaries are simple sums of verified records for the same fiscal year and category, and are labelled as such.</li>
                <li>Incomplete datasets are shown as incomplete; BetterGo does not estimate missing figures.</li>
                <li>Original source documents remain authoritative.</li>
              </ul>
              <Link className="btn btn-outline btn-sm mt-3" to="/contact?kind=concern">Report incorrect or outdated information</Link>
            </div>
          </>
        )}
      </div>
    </>
  )
}

export function DocumentsList() {
  const [params, setParams] = useSearchParams()
  const category = params.get('category') || ''
  const municipality = params.get('municipality') || ''
  const year = params.get('year') || ''
  const q = params.get('q') || ''
  const page = Number(params.get('page') || 1)
  const [term, setTerm] = useState(q)
  useDocumentTitle('Public documents')
  const { data: lookups } = useApi('/lookups')
  const { data, loading, error } = useApi(`/transparency/documents${query({ category, municipality, year, q, page, limit: 10 })}`)

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
        eyebrow="Transparency"
        title="Public document library"
        description="Published budget, procurement, audit and accountability documents with their source and verification status."
        icon={FileText}
        breadcrumbs={[{ label: 'Transparency', to: '/transparency' }, { label: 'Documents' }]}
      />

      <div className="container section-tight">
        <div className="card mb-4">
          <form className="toolbar" style={{ marginBottom: 0 }} onSubmit={(event) => { event.preventDefault(); setParam('q', term.trim()) }}>
            <input className="input grow" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search documents" aria-label="Search documents" />
            <Select value={category} onChange={(event) => setParam('category', event.target.value)} aria-label="Document category">
              <option value="">All categories</option>
              <option value="budget">Budget</option>
              <option value="expenditure">Expenditure</option>
              <option value="procurement">Procurement</option>
              <option value="audit">Audit</option>
              <option value="accountability">Accountability</option>
            </Select>
            <Select value={municipality} onChange={(event) => setParam('municipality', event.target.value)} aria-label="Municipality">
              <option value="">All Marinduque</option>
              {(lookups?.municipalities || []).map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
            </Select>
            <input className="input" style={{ maxWidth: 120 }} value={year} onChange={(event) => setParam('year', event.target.value)} placeholder="Year" aria-label="Fiscal year" inputMode="numeric" maxLength={4} />
            <Button type="submit">Apply</Button>
          </form>
        </div>

        {loading ? (
          <SkeletonList count={5} height={110} />
        ) : error ? (
          <EmptyState title="Document library temporarily unavailable" description="Please try again shortly." />
        ) : data?.results?.length ? (
          <>
            <div className="stack">
              {data.results.map((document) => (
                <Link key={document.id} to={`/transparency/documents/${document.slug}`} className="card card-interactive card-link">
                  <div className="row-between">
                    <div className="row" style={{ gap: '0.4rem' }}>
                      <Badge>{document.document_category}</Badge>
                      <Badge>{document.government_level}</Badge>
                      <VerificationBadge status={document.verification_status} />
                    </div>
                    {document.file_type ? <span className="text-xs text-muted">{document.file_type.split('/').pop()?.toUpperCase()}</span> : null}
                  </div>
                  <h3 style={{ fontSize: '1.02rem' }}>{document.title}</h3>
                  <p>{document.description}</p>
                  <div className="card-meta">
                    {document.issuing_organization ? <span>{document.issuing_organization}</span> : null}
                    {document.fiscal_year ? <span>FY {document.fiscal_year}</span> : null}
                    {document.publication_date ? <span>{fmtDate(document.publication_date)}</span> : null}
                    {document.municipality_name ? <span>{document.municipality_name}</span> : null}
                  </div>
                </Link>
              ))}
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} onChange={(next) => setParam('page', String(next))} />
          </>
        ) : (
          <EmptyState icon={FileText} title="No documents match these filters" description="Documents are only listed once approved and published for public access." />
        )}

        <div className="alert alert-info mt-4">
          <Info size={18} aria-hidden="true" />
          <div>Uploaded files are validated by type and size. Unpublished or restricted documents are never downloadable from this page.</div>
        </div>
      </div>
    </>
  )
}

export function DocumentDetail() {
  const { slug } = useParams()
  const { data, loading, error } = useApi(`/transparency/documents/${slug}`)
  useDocumentTitle(data?.document?.title || 'Document')

  if (loading) return <div className="container section"><SkeletonList count={1} height={260} /></div>
  if (error || !data?.document) {
    return (
      <div className="container section">
        <EmptyState icon={FileText} title="Document not found" description="This document may be unpublished or restricted." action={<Link className="btn btn-primary" to="/transparency/documents">Document library</Link>} />
      </div>
    )
  }

  const document = data.document

  return (
    <>
      <PageHeader
        eyebrow={document.document_category}
        title={document.title}
        description={document.description}
        icon={FileText}
        breadcrumbs={[
          { label: 'Transparency', to: '/transparency' },
          { label: 'Documents', to: '/transparency/documents' },
          { label: document.title },
        ]}
        actions={
          <>
            {document.source_url ? (
              <a className="btn btn-primary" href={document.source_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={15} aria-hidden="true" /> Open original source
              </a>
            ) : null}
            <SaveButton contentType="document" slug={document.slug} />
            {document.file_path ? (
              <a className="btn btn-outline" href={`${document.file_path}`} target="_blank" rel="noopener noreferrer" download>
                <Download size={15} aria-hidden="true" /> Download
              </a>
            ) : null}
          </>
        }
      />

      <div className="container section-tight">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', alignItems: 'start' }}>
          <div className="card">
            <h2 style={{ fontSize: 'var(--text-h3)', marginBottom: 'var(--space-3)' }}>Document details</h2>
            <dl className="detail-list">
              <div className="detail-item"><dt>Category</dt><dd>{document.document_category}</dd></div>
              <div className="detail-item"><dt>Issuing organisation</dt><dd>{document.issuing_organization || 'Not recorded'}</dd></div>
              <div className="detail-item"><dt>Government level</dt><dd>{document.government_level}</dd></div>
              <div className="detail-item"><dt>Coverage</dt><dd>{document.municipality_name || 'Province-wide'}</dd></div>
              <div className="detail-item"><dt>Fiscal year</dt><dd>{document.fiscal_year || 'Not applicable'}</dd></div>
              <div className="detail-item"><dt>Publication date</dt><dd>{fmtDate(document.publication_date)}</dd></div>
              <div className="detail-item"><dt>File type</dt><dd>{document.file_type || 'External source'}</dd></div>
              <div className="detail-item"><dt>File size</dt><dd>{document.file_size ? `${Math.round(document.file_size / 1024)} KB` : 'Not stored'}</dd></div>
            </dl>
            {!document.file_path && document.source_url ? (
              <p className="help mt-3">
                This record links to the original government source rather than a hosted copy. BetterGo does not modify original
                documents.
              </p>
            ) : null}
          </div>

          <aside className="stack" style={{ gap: 'var(--space-4)' }}>
            <div className="meta-panel">
              <h3 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>Source &amp; verification</h3>
              <div className="stack-sm text-sm">
                <VerificationBadge status={document.verification_status} />
                <span><strong>Verified:</strong> {document.last_verified_at ? fmtDate(document.last_verified_at) : 'Not recorded'}</span>
                <span><strong>Source:</strong> {document.source_url ? <a href={document.source_url} target="_blank" rel="noopener noreferrer">Original document</a> : 'Not recorded'}</span>
              </div>
            </div>

            {data.related?.length ? (
              <div className="card">
                <h3 style={{ fontSize: 'var(--text-h4)' }}>Related documents</h3>
                <ul className="link-list">
                  {data.related.map((item) => (
                    <li key={item.id}><Link to={`/transparency/documents/${item.slug}`}>{item.title}</Link></li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Alert tone="info">
              BetterGo does not certify the contents of government documents. Consult the original source for authoritative information.
            </Alert>
          </aside>
        </div>
      </div>
    </>
  )
}
