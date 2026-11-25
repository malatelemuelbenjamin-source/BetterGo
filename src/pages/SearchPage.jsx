import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Search, SlidersHorizontal, X } from 'lucide-react'
import { fmtDate, query } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { Badge, Button, EmptyState, Pagination, Select, SkeletonList } from '../components/ui'
import { SearchAutocomplete } from '../components/search'
import { PageHeader } from '../components/layout'

const CATEGORY_LABEL = {
  services: 'Government service',
  categories: 'Service category',
  resources: 'Form or resource',
  service_faqs: 'Service question',
  offices: 'Government office',
  municipalities: 'Municipality',
  announcements: 'Announcement',
  projects: 'Project',
  transparency: 'Transparency record',
  information: 'Public information',
}

function Highlight({ text, term }) {
  if (!term || !text) return text
  const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = String(text).split(new RegExp(`(${safeTerm})`, 'ig'))
  return parts.map((part, index) =>
    part.toLowerCase() === term.toLowerCase() ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>,
  )
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const category = params.get('category') || ''
  const municipality = params.get('municipality') || ''
  const sort = params.get('sort') || 'relevance'
  const page = Number(params.get('page') || 1)
  useDocumentTitle(q ? `Search: ${q}` : 'Search')

  const { data, loading, error } = useApi(
    `/search${query({ q, category, municipality, sort, page, limit: 10 })}`,
  )
  const { data: lookups } = useApi('/lookups')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const setParam = (key, value) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'page') next.delete('page')
      return next
    })
  }

  const activeFilters = [category, municipality].filter(Boolean).length

  return (
    <>
      <PageHeader
        eyebrow="Global search"
        title="Search public information"
        description="One search across government services, offices, municipalities, announcements, transparency records and public information."
        breadcrumbs={[{ label: 'Search' }]}
      />

      <div className="container section-tight">
        <SearchAutocomplete
          initialValue={q}
          onSubmit={(term) => setParam('q', term)}
          inputId="search-page-input"
          placeholder="Search services, categories, forms, FAQs, offices…"
        />

        <div className="toolbar mt-4">
          <Button
            variant="outline"
            icon={SlidersHorizontal}
            onClick={() => setFiltersOpen((value) => !value)}
            aria-expanded={filtersOpen}
          >
            Filters{activeFilters ? ` (${activeFilters})` : ''}
          </Button>
          <span className="text-xs text-muted" style={{ marginLeft: 'auto' }}>
            {data ? `${data.total} result${data.total === 1 ? '' : 's'}` : ''}
          </span>
        </div>

        {filtersOpen ? (
          <div className="card mb-4">
            <div className="grid grid-3">
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="label" htmlFor="filter-category">Content category</label>
                <Select id="filter-category" value={category} onChange={(event) => setParam('category', event.target.value)}>
                  <option value="">All categories</option>
                  {(data?.availableCategories || []).map((item) => (
                    <option key={item.key} value={item.key}>{item.label}</option>
                  ))}
                </Select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="label" htmlFor="filter-municipality">Municipality</label>
                <Select id="filter-municipality" value={municipality} onChange={(event) => setParam('municipality', event.target.value)}>
                  <option value="">All Marinduque</option>
                  {(lookups?.municipalities || []).map((item) => (
                    <option key={item.slug} value={item.slug}>{item.name}</option>
                  ))}
                </Select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="label" htmlFor="filter-sort">Sort by</label>
                <Select id="filter-sort" value={sort} onChange={(event) => setParam('sort', event.target.value)}>
                  <option value="relevance">Relevance</option>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </Select>
              </div>
            </div>
            {activeFilters ? (
              <div className="row mt-3">
                {category ? <Badge tone="info">{CATEGORY_LABEL[category] || category} <button className="btn-icon" style={{ width: 18, height: 18 }} onClick={() => setParam('category', '')} aria-label="Remove category filter"><X size={11} /></button></Badge> : null}
                {municipality ? <Badge tone="info">{municipality} <button className="btn-icon" style={{ width: 18, height: 18 }} onClick={() => setParam('municipality', '')} aria-label="Remove municipality filter"><X size={11} /></button></Badge> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {!q ? (
          <EmptyState
            icon={Search}
            title="Search across all public information"
            description="Enter a keyword to search published services, offices, municipalities, announcements and public documents. Filipino and English terms are both supported."
          />
        ) : loading ? (
          <SkeletonList count={4} />
        ) : error ? (
          <EmptyState title="Search is temporarily unavailable" description="Please try again in a moment." action={<Button onClick={() => window.location.reload()}>Retry</Button>} />
        ) : data?.results?.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No results found"
            description="Try a different keyword or adjust your filters. Searching for an office name, municipality or a shorter phrase often helps."
            action={
              <div className="row" style={{ justifyContent: 'center' }}>
                {['Health', 'Permit', 'Scholarship', 'Boac', 'Budget'].map((term) => (
                  <Link key={term} className="pill" to={`/search?q=${encodeURIComponent(term)}`}>{term}</Link>
                ))}
              </div>
            }
          />
        ) : (
          <>
            <p className="text-sm text-muted">
              {data.total} result{data.total === 1 ? '' : 's'} for <strong>“{data.query}”</strong>
              {data.expandedTerms?.length > 1 ? <span> · also matched related terms</span> : null}
            </p>
            <div className="stack mt-3">
              {data.results.map((result, index) => (
                <Link key={`${result.category}-${result.id}-${index}`} to={result.url} className="card card-interactive card-link">
                  <div className="row" style={{ gap: '0.4rem' }}>
                    <Badge tone="neutral">{result.categoryLabel}</Badge>
                    {result.meta ? <Badge>{String(result.meta).replace(/_/g, ' ')}</Badge> : null}
                  </div>
                  <h3 style={{ fontSize: '1.05rem' }}><Highlight text={result.title} term={q} /></h3>
                  {result.description ? (
                    <p><Highlight text={String(result.description).slice(0, 240)} term={q} />{String(result.description).length > 240 ? '…' : ''}</p>
                  ) : null}
                  <div className="card-meta">
                    {result.municipality ? <span>{result.municipality}</span> : null}
                    {result.date ? <span>{fmtDate(result.date)}</span> : null}
                  </div>
                  <div className="card-actions">
                    <span className="badge badge-success">View <ArrowRight size={12} aria-hidden="true" /></span>
                  </div>
                </Link>
              ))}
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} onChange={(next) => setParam('page', String(next))} />
            <p className="help mt-4">
              Search results include published public records only. Draft, archived and restricted administrative records are never
              returned.
            </p>
          </>
        )}
      </div>
    </>
  )
}
