import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, query } from '../../api'
import { useSeo } from '../../hooks'
import { Alert, Badge, Button, SkeletonList } from '../../components/ui'
import { PageHeader } from '../../components/layout'
import TransparencyNav from './TransparencyNav'
import { money } from './FinanceHub'

const FORMATS = ['csv', 'xlsx', 'json', 'pdf']

export default function OpenData({ mode = 'hub' }) {
  const { slug } = useParams()
  const [search] = useSearchParams()
  const [overview, setOverview] = useState(null)
  const [datasets, setDatasets] = useState(null)
  const [dataset, setDataset] = useState(null)
  const [preview, setPreview] = useState(null)
  const [versions, setVersions] = useState([])
  const [downloads, setDownloads] = useState(null)
  const [methodology, setMethodology] = useState(null)
  const [categories, setCategories] = useState([])
  const [filters, setFilters] = useState({ category: search.get('category') || '', municipality: '', year: search.get('year') || '', q: '' })
  const [page, setPage] = useState(1)
  const [previewParams, setPreviewParams] = useState({ page: 1, q: '', sort: 'fiscal_year', order: 'desc' })
  const [error, setError] = useState(null)

  useSeo({
    title: mode === 'methodology' ? 'Open data methodology' : mode === 'detail' ? dataset?.dataset?.title || 'Open dataset' : 'Open financial data',
    description: 'Download verified, approved Marinduque financial datasets in CSV, XLSX, JSON or PDF with data dictionaries and source references. No licence is implied.',
  })

  useEffect(() => {
    setError(null)
    if (mode === 'hub') api.get('/transparency/open-data/overview').then(setOverview).catch((err) => setError(err.message))
    if (mode === 'categories') api.get('/transparency/open-data/categories').then((body) => setCategories(body.categories)).catch((err) => setError(err.message))
    if (mode === 'downloads') api.get('/transparency/open-data/downloads').then(setDownloads).catch((err) => setError(err.message))
    if (mode === 'methodology') api.get('/transparency/open-data/methodology').then(setMethodology).catch((err) => setError(err.message))
    if (mode === 'detail') {
      api.get(`/transparency/open-data/datasets/${slug}`).then((body) => { setDataset(body.dataset); setPreview(body.preview); setVersions(body.versions) }).catch((err) => setError(err.message))
    }
  }, [mode, slug])

  useEffect(() => {
    if (mode === 'datasets') api.get(`/transparency/open-data/datasets${query({ ...filters, page })}`).then(setDatasets).catch((err) => setError(err.message))
    if (mode === 'detail' && slug) api.get(`/transparency/open-data/datasets/${slug}/records${query({ ...previewParams, limit: 10 })}`).then(setPreview).catch((err) => setError(err.message))
  }, [mode, filters, page, previewParams, slug])

  const header = (
    <>
      <PageHeader
        eyebrow="Transparency"
        title={mode === 'methodology' ? 'Open data methodology' : mode === 'detail' ? dataset?.title || 'Open dataset' : mode === 'categories' ? 'Dataset categories' : mode === 'downloads' ? 'Download activity' : 'Open financial data'}
        description="Approved public datasets generated from published, source-referenced financial records. BetterGo is not an official government open-data repository."
        breadcrumbs={[{ label: 'Transparency', to: '/transparency' }, { label: 'Open data', to: '/transparency/open-data' }, ...(mode !== 'hub' ? [{ label: mode }] : [])]}
      />
      <TransparencyNav />
    </>
  )

  if (error) return <div className="section-tight">{header}<Alert tone="error" title="Open data could not load">{error}</Alert></div>

  if (mode === 'hub') {
    return (
      <div className="section-tight">
        {header}
        <Alert tone="info" title="Reuse terms are not assumed">No licence is claimed unless a dataset records its own reuse terms. Cite the dataset title, version, publisher and download date.</Alert>
        {!overview ? <SkeletonList count={3} height={80} /> : (
          <>
            <div className="grid grid-3">
              <div className="card"><div className="side-label">Published datasets</div><strong>{overview.total}</strong></div>
              <div className="card"><div className="side-label">Download events</div><strong>{overview.downloads}</strong></div>
              <div className="card"><div className="side-label">Formats</div><strong>{overview.formats.map((format) => format.toUpperCase()).join(' · ')}</strong></div>
            </div>
            <div className="card">
              <div className="row-between"><h2 className="side-label">Recently published datasets</h2><Link className="btn btn-outline btn-sm" to="/transparency/open-data/datasets">Browse all datasets</Link></div>
              {!overview.recent.length ? <p className="text-sm text-muted">No dataset has been approved for public release yet. This is an empty repository, not an absence of government activity.</p> : (
                <div className="grid grid-3">
                  {overview.recent.map((row) => (
                    <Link key={row.slug} to={`/transparency/open-data/dataset/${row.slug}`} style={{ textDecoration: 'none' }} className="stack-tight">
                      <strong>{row.title}</strong><span className="text-xs text-muted">{row.categoryLabel} · {row.periodLabel || 'Period unavailable'} · v{row.version}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="pill-group">
              <Link className="pill" to="/transparency/open-data/categories">Categories</Link>
              <Link className="pill" to="/transparency/open-data/downloads">Download activity</Link>
              <Link className="pill" to="/transparency/open-data/methodology">Reuse guidance</Link>
            </div>
          </>
        )}
      </div>
    )
  }

  if (mode === 'categories') {
    return (
      <div className="section-tight">
        {header}
        {!categories.length ? <SkeletonList count={2} height={60} /> : (
          <div className="grid grid-3">
            {categories.map((row) => (
              <Link key={row.key} className="card" to={`/transparency/open-data/datasets?category=${row.key}`} style={{ textDecoration: 'none' }}>
                <strong>{row.label}</strong><div className="text-xs text-muted">{row.datasets} published dataset(s)</div><p className="text-xs text-muted">{row.description}</p>
              </Link>
            ))}
          </div>
        )}
        <p className="text-xs text-muted">Only categories with approved datasets can be downloaded. A category count of zero means no dataset has been published yet.</p>
      </div>
    )
  }

  if (mode === 'downloads') {
    return (
      <div className="section-tight">
        {header}
        {!downloads ? <SkeletonList count={2} height={70} /> : (
          <>
            <div className="grid grid-3">
              <div className="card"><div className="side-label">Download events</div><strong>{downloads.totals.downloads}</strong></div>
              <div className="card"><div className="side-label">Datasets downloaded</div><strong>{downloads.totals.datasets}</strong></div>
              <div className="card"><div className="side-label">Privacy</div><span className="text-sm">No identity, IP address or individual history is stored.</span></div>
            </div>
            <div className="grid grid-2">
              <div className="card"><h2 className="side-label">By format</h2>{downloads.byFormat.length ? downloads.byFormat.map((row) => <div key={row.format} className="row-between text-sm"><span>{row.format.toUpperCase()}</span><strong>{row.count}</strong></div>) : <p className="text-sm text-muted">No downloads yet.</p>}</div>
              <div className="card"><h2 className="side-label">By category</h2>{downloads.byCategory.length ? downloads.byCategory.map((row) => <div key={row.category} className="row-between text-sm"><span>{row.category}</span><strong>{row.count}</strong></div>) : <p className="text-sm text-muted">No downloads yet.</p>}</div>
            </div>
            <div className="card"><h2 className="side-label">Recent download events</h2>{downloads.recent.length ? <ul className="text-sm">{downloads.recent.map((row, index) => <li key={`${row.slug}-${index}`}>{row.title} · {row.format.toUpperCase()} · {String(row.created_at).slice(0, 10)}</li>)}</ul> : <p className="text-sm text-muted">No download has been recorded.</p>}</div>
          </>
        )}
      </div>
    )
  }

  if (mode === 'methodology') {
    return (
      <div className="section-tight">
        {header}
        {!methodology ? <SkeletonList count={2} height={60} /> : (
          <>
            <div className="card"><h2 className="side-label">How to use and cite datasets</h2><ol className="text-sm">{methodology.guidance.map((item) => <li key={item}>{item}</li>)}</ol></div>
            <div className="card"><h2 className="side-label">Limitations and privacy</h2><p className="text-sm">{methodology.limitations}</p><p className="text-sm text-muted">{methodology.privacy}</p></div>
          </>
        )}
      </div>
    )
  }

  if (mode === 'detail') {
    if (!dataset) return <div className="section-tight">{header}<SkeletonList count={3} height={80} /></div>
    return (
      <div className="section-tight">
        {header}
        <Alert tone="info" title="Dataset metadata">
          {dataset.title} · version {dataset.version} · {dataset.entity.name || 'Entity unavailable'} · {dataset.periodLabel || 'Period unavailable'} · {dataset.verificationStatus}
        </Alert>
        <div className="card">
          <p className="text-sm">{dataset.description}</p>
          <div className="grid grid-3 text-sm">
            <div><div className="side-label">Publisher</div>{dataset.sourceInstitution || 'Not recorded'}</div>
            <div><div className="side-label">Source document</div>{dataset.sourceReference || 'Not recorded'}</div>
            <div><div className="side-label">Update frequency</div>{dataset.updateFrequency || 'Not established'}</div>
            <div><div className="side-label">Licence / reuse</div>{dataset.licenseStatus}</div>
            <div><div className="side-label">Coverage</div>{dataset.coverage || 'Not recorded'}</div>
            <div><div className="side-label">Published</div>{dataset.publishedAt ? String(dataset.publishedAt).slice(0, 10) : 'Not yet published'}</div>
          </div>
          <div className="pill-group" style={{ marginTop: '1rem' }}>
            {FORMATS.map((format) => <a key={format} className="btn btn-outline btn-sm" href={`/api/transparency/open-data/datasets/${dataset.slug}/download?format=${format}`}>{format.toUpperCase()}</a>)}
          </div>
        </div>
        <div className="card">
          <h2 className="side-label">Data dictionary</h2>
          <div className="table-wrap"><table className="data"><caption className="text-xs">Fields have the same meaning in the preview and every download.</caption><thead><tr><th scope="col">Field</th><th scope="col">Label</th><th scope="col">Type</th><th scope="col">Definition</th></tr></thead><tbody>{dataset.dataDictionary.map((field) => <tr key={field.key}><th scope="row">{field.key}</th><td>{field.label}</td><td>{field.type}</td><td>{field.description || 'No further definition recorded.'}</td></tr>)}</tbody></table></div>
        </div>
        <div className="card">
          <h2 className="side-label">Preview</h2>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input className="input" aria-label="Search preview rows" placeholder="Search rows" value={previewParams.q} onChange={(e) => setPreviewParams({ ...previewParams, q: e.target.value, page: 1 })} />
            <select className="input" aria-label="Sort preview" value={previewParams.sort} onChange={(e) => setPreviewParams({ ...previewParams, sort: e.target.value, page: 1 })}><option value="fiscal_year">Fiscal year</option><option value="updated_at">Last updated</option><option value="amount">Amount</option><option value="title">Title</option></select>
            <select className="input" aria-label="Sort direction" value={previewParams.order} onChange={(e) => setPreviewParams({ ...previewParams, order: e.target.value, page: 1 })}><option value="desc">Descending</option><option value="asc">Ascending</option></select>
          </div>
          {!preview?.results?.length ? <p className="text-sm text-muted">No published record currently matches this selection. Do not treat this as zero spending.</p> : (
            <div className="table-wrap"><table className="data"><caption className="text-xs">Page {preview.page} of {preview.totalPages} · {preview.total} published record(s)</caption><thead><tr><th scope="col">Reference</th><th scope="col">Title</th><th scope="col">Entity</th><th scope="col">Period</th><th scope="col">Classification</th><th scope="col">Amount</th></tr></thead><tbody>{preview.results.map((row) => <tr key={row.reference}><td><Link to={`/transparency/finance/record/${row.reference}`}>{row.reference}</Link></td><td>{row.title}</td><td>{row.entity.name}</td><td>{row.periodLabel}</td><td>{row.amountKindLabel}</td><td>{row.amountCents === null ? 'Data not yet available' : money(row.amountCents)}</td></tr>)}</tbody></table></div>
          )}
          <p className="text-xs text-muted">{dataset.limitations || 'No limitations were recorded by the publisher.'}</p>
          {preview ? <div className="pagination"><button type="button" disabled={preview.page <= 1} onClick={() => setPreviewParams({ ...previewParams, page: preview.page - 1 })}>Previous</button><span className="text-xs text-muted">Page {preview.page} of {preview.totalPages}</span><button type="button" disabled={preview.page >= preview.totalPages} onClick={() => setPreviewParams({ ...previewParams, page: preview.page + 1 })}>Next</button></div> : null}
        </div>
        <div className="card">
          <h2 className="side-label">Version history</h2>
          <ul className="text-sm">{versions.map((version) => <li key={`${version.version}-${version.created_at}`}>Version {version.version} · {version.change_note || 'No change note'} · {String(version.created_at || '').slice(0, 10)}</li>)}</ul>
        </div>
        <p className="text-xs text-muted">Downloaded data may be incomplete or subject to source corrections. Report an error through financial monitoring or the contact page.</p>
      </div>
    )
  }

  return (
    <div className="section-tight">
      {header}
      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <select className="input" aria-label="Dataset category" value={filters.category} onChange={(e) => { setPage(1); setFilters({ ...filters, category: e.target.value }) }}>
            <option value="">All categories</option>
            {Object.entries({ budget: 'Government budgets', revenue: 'Government revenue', tax: 'Local tax collections', expenditure: 'Government expenditures', procurement: 'Procurement', contracts: 'Contracts', projects: 'Infrastructure projects', audit: 'COA audit documents', grants: 'Grants and donations', assets: 'Government assets', debt: 'Debt and obligations', personnel: 'Personnel expenditure', utilities: 'Utility expenditure', ppp: 'Public-private partnerships', monitoring: 'Monitoring observations' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <input className="input" aria-label="Reporting year" placeholder="Reporting year" value={filters.year} onChange={(e) => { setPage(1); setFilters({ ...filters, year: e.target.value.replace(/\D/g, '').slice(0, 4) }) }} />
          <input className="input" aria-label="Search datasets" placeholder="Search datasets" value={filters.q} onChange={(e) => { setPage(1); setFilters({ ...filters, q: e.target.value }) }} />
          <Button variant="ghost" size="sm" onClick={() => { setPage(1); setFilters({ category: '', municipality: '', year: '', q: '' }) }}>Reset</Button>
        </div>
      </div>
      {!datasets ? <SkeletonList count={3} height={70} /> : !datasets.results.length ? (
        <div className="card"><p className="text-sm text-muted">No approved dataset matches this selection. New datasets appear only after source verification and publication review.</p></div>
      ) : datasets.results.map((row) => (
        <div className="card" key={row.slug}>
          <div className="row-between">
            <div><Link to={`/transparency/open-data/dataset/${row.slug}`}><strong>{row.title}</strong></Link><div className="text-xs text-muted">{row.categoryLabel} · {row.entity.name || 'Entity unavailable'} · {row.periodLabel || 'Period unavailable'} · v{row.version}</div></div>
            <Badge tone={row.verificationStatus === 'verified' ? 'success' : 'warning'}>{row.verificationStatus}</Badge>
          </div>
          <p className="text-sm">{row.description}</p>
          <div className="pill-group">{row.formatLinks.map((link) => <a key={link.format} className="pill" href={`/api${link.href.replace('/api', '')}`}>{link.format.toUpperCase()}</a>)}</div>
        </div>
      ))}
      {datasets ? <p className="text-xs text-muted">Page {datasets.page} of {datasets.totalPages} · {datasets.total} dataset(s). No licence is implied by availability.</p> : null}
    </div>
  )
}
