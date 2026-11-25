import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, query } from '../../api'
import { useSeo } from '../../hooks'
import { useAuth } from '../../auth'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'
import TransparencyNav from './TransparencyNav'
import { FinanceBarChart } from '../../components/FinanceBarChart'

const MONEY = (cents) => (cents === null || cents === undefined ? 'Not calculated' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(cents / 100))

function PieSummary({ title, values }) {
  const rows = values.filter((row) => Number(row.value) > 0)
  if (!rows.length) return <p className="text-sm text-muted">No positive values are available for this chart.</p>
  const total = rows.reduce((sum, row) => sum + Number(row.value), 0)
  let cursor = 0
  const colours = ['#21583f', '#4f7d63', '#8aab97', '#c2a35a', '#a06b3f', '#6b7280', '#9b5b5b']
  const stops = rows.map((row, index) => {
    const start = cursor
    cursor += (Number(row.value) / total) * 100
    return `${colours[index % colours.length]} ${start}% ${cursor}%`
  })
  return (
    <figure className="stack-tight" style={{ margin: 0 }}>
      <figcaption className="side-label">{title}</figcaption>
      <div className="row" style={{ alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div role="img" aria-label={`${title}. ${rows.map((row) => `${row.label}: ${MONEY(row.value)}`).join('; ')}`} style={{ width: 150, height: 150, borderRadius: '50%', background: `conic-gradient(${stops.join(', ')})` }} />
        <ul className="text-sm" style={{ margin: 0 }}>
          {rows.map((row, index) => <li key={row.label}><span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, background: colours[index % colours.length], marginRight: 6 }} />{row.label}: {MONEY(row.value)}</li>)}
        </ul>
      </div>
      <details><summary className="text-xs">Table of values</summary>
        <table className="data"><caption className="text-xs">{title}</caption><thead><tr><th scope="col">Classification</th><th scope="col">Amount</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{MONEY(row.value)}</td></tr>)}</tbody></table>
      </details>
    </figure>
  )
}

function ReportView({ report, exports }) {
  if (!report) return null
  const allocations = report.allocations.map((row) => ({ label: row.categoryLabel, value: row.amountCents }))
  const kindRows = Object.entries(report.totals.byAmountKindCents || {}).filter(([, value]) => value !== null).map(([key, value]) => ({ label: key, value }))
  return (
    <div className="stack-tight">
      <Alert tone="info" title={report.title}>
        {report.entity?.name || 'All published government entities'} · {report.filters.year || 'All years'} · {report.counts.records} published record(s). Generated {String(report.generatedAt).slice(0, 10)}.
      </Alert>
      <div className="card">
        <h2 className="side-label">Financial summary</h2>
        <div className="table-wrap">
          <table className="data">
            <caption className="text-xs">Every derived value states its formula, source, period and limitations. Values are not combined across incompatible stages.</caption>
            <thead><tr><th scope="col">Measure</th><th scope="col">Value</th><th scope="col">Formula and source</th><th scope="col">Limitations</th></tr></thead>
            <tbody>
              {report.calculations.map((entry) => (
                <tr key={entry.key}>
                  <th scope="row">{entry.label}</th>
                  <td>{entry.valuePercent !== null ? `${entry.valuePercent}%` : entry.valuePeso !== null ? MONEY(entry.valueCents) : 'Not calculated'}</td>
                  <td className="text-xs">{entry.formula}<div className="text-muted">{entry.source}</div></td>
                  <td className="text-xs">{entry.limitations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">Coverage: {report.coverage.recordsWithoutAmount} record(s) without an amount, {report.coverage.recordsWithoutSource} without a source and {report.coverage.recordsWithoutPeriod} without a complete period. Missing information is never shown as zero.</p>
      </div>

      <div className="grid grid-2">
        <div className="card"><FinanceBarChart title="Approved amounts by category" rows={allocations} /></div>
        <div className="card"><PieSummary title="Published amount classifications" values={kindRows} /></div>
      </div>

      {report.trend.length ? (
        <div className="card">
          <h2 className="side-label">Historical trend</h2>
          <div className="table-wrap"><table className="data"><caption className="text-xs">Only published approved and actual records; a missing year is not zero.</caption><thead><tr><th scope="col">Year</th><th scope="col">Classification</th><th scope="col">Amount</th></tr></thead><tbody>{report.trend.map((row) => <tr key={`${row.year}-${row.amountKind}`}><th scope="row">{row.year}</th><td>{row.amountKind}</td><td>{MONEY(row.amountCents)}</td></tr>)}</tbody></table></div>
        </div>
      ) : null}

      {report.comparison.length ? (
        <div className="card">
          <h2 className="side-label">Municipality comparison</h2>
          <div className="table-wrap"><table className="data"><caption className="text-xs">Comparable approved budget amounts only. A municipality without a published record is marked unavailable.</caption><thead><tr><th scope="col">Municipality</th><th scope="col">Approved budget</th><th scope="col">Records</th></tr></thead><tbody>{report.comparison.map((row) => <tr key={row.slug}><th scope="row">{row.name}</th><td>{row.approvedBudgetCents === null ? 'Data not yet available' : MONEY(row.approvedBudgetCents)}</td><td>{row.records}</td></tr>)}</tbody></table></div>
        </div>
      ) : null}

      {report.monitoring.length ? (
        <div className="card">
          <h2 className="side-label">Approved data-quality observations</h2>
          {report.monitoring.map((row) => <div key={row.reference} className="stack-tight"><strong>{row.label}</strong><span className="text-sm">{row.description}</span><span className="text-xs text-muted">{row.period} · {row.severity} · detected {String(row.detected).slice(0, 10)}</span></div>)}
        </div>
      ) : null}

      <div className="card">
        <h2 className="side-label">Sources and method</h2>
        <p className="text-sm text-muted">{report.methodology}</p>
        <ul className="text-sm">
          {report.sources.slice(0, 30).map((source, index) => <li key={`${source.title}-${index}`}>{source.institution || 'Institution not recorded'} — {source.title || 'Document not recorded'}{source.url ? <> · <a href={source.url} rel="noreferrer noopener" target="_blank">source</a></> : null} ({source.records} record(s))</li>)}
        </ul>
        <p className="text-xs text-muted">{report.disclaimers.join(' ')}</p>
      </div>

      {report.records.length ? (
        <div className="card">
          <h2 className="side-label">Included records</h2>
          <div className="table-wrap">
            <table className="data"><caption className="text-xs">Showing up to 500 records. Exports contain the same published records.</caption><thead><tr><th scope="col">Reference</th><th scope="col">Title</th><th scope="col">Entity</th><th scope="col">Period</th><th scope="col">Classification</th><th scope="col">Amount</th><th scope="col">Source</th></tr></thead>
              <tbody>{report.records.map((row) => <tr key={row.reference}><td><Link to={`/transparency/finance/record/${row.reference}`}>{row.reference}</Link></td><td>{row.title}</td><td>{row.entity.name}</td><td>{row.periodLabel}</td><td>{row.amountKindLabel}</td><td>{row.amountCents === null ? 'Data not yet available' : MONEY(row.amountCents)}</td><td>{row.source.title || 'Source unavailable'}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      ) : null}

      {exports ? (
        <div className="card">
          <h2 className="side-label">Exports</h2>
          <p className="text-sm text-muted">Each export carries the generation date, entity, period, sources, methodology and independent-platform disclaimer. Only published fields are included.</p>
          <div className="pill-group">
            {['csv', 'xlsx', 'json', 'pdf'].map((format) => <a key={format} className="btn btn-outline btn-sm" href={`/api/transparency/reports/saved/${exports}/export?format=${format}`}>{format.toUpperCase()}</a>)}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function SharedReport() {
  const { token } = useParams()
  const [body, setBody] = useState(null)
  const [error, setError] = useState(null)
  useSeo({ title: 'Shared transparency report', description: 'A shared BetterGo transparency report configuration. It opens published records only.', noindex: true })
  useEffect(() => {
    api.get(`/transparency/reports/shared/${token}`).then(setBody).catch((err) => setError(err.message))
  }, [token])
  return (
    <div className="section-tight">
      <PageHeader eyebrow="Transparency" title={body?.report?.title || 'Shared transparency report'} description="A public, read-only report configuration. No account information is exposed." breadcrumbs={[{ label: 'Transparency', to: '/transparency' }, { label: 'Reports', to: '/transparency/reports' }, { label: 'Shared report' }]} />
      <TransparencyNav />
      {error ? <Alert tone="error" title="Shared report not found">{error}</Alert> : !body ? <SkeletonList count={3} height={80} /> : (
        <>
          {body.report.mayNeedRegeneration ? <Alert tone="warning" title="This report may need regeneration">A source record was updated after the last generation. It is shown with current published data and is not presented as an unchanged historical snapshot.</Alert> : null}
          <ReportView report={body.report} />
        </>
      )}
    </div>
  )
}

export default function ReportsPage({ mode = 'hub', entity = '' }) {
  const { user } = useAuth()
  const toast = useToast()
  const [search] = useSearchParams()
  const [templates, setTemplates] = useState(null)
  const [meta, setMeta] = useState(null)
  const [methodology, setMethodology] = useState(null)
  const [entities, setEntities] = useState([])
  const [categories, setCategories] = useState([])
  const [saved, setSaved] = useState(null)
  const [report, setReport] = useState(null)
  const [config, setConfig] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ title: 'Custom financial transparency report', description: '', entity, year: '', types: '', category: '', kind: '', sections: ['summary', 'budget', 'sources', 'methodology'] })

  useSeo({
    title: mode === 'methodology' ? 'Report methodology' : mode === 'saved' ? 'Saved transparency reports' : 'Financial transparency reports',
    description: 'Build source-backed reports from published Marinduque financial records. Every derived value states its formula, source and limitations.',
    noindex: mode === 'saved',
  })

  useEffect(() => {
    api.get('/transparency/reports/templates').then((body) => {
      setTemplates(body.templates)
      setMeta(body)
    }).catch((err) => setError(err.message))
    api.get('/transparency/finance/entities').then((body) => setEntities(body.entities)).catch(() => {})
    api.get('/transparency/finance/categories').then((body) => setCategories(body.categories)).catch(() => {})
    if (mode === 'methodology') api.get('/transparency/reports/methodology').then(setMethodology).catch((err) => setError(err.message))
    if (mode === 'saved') {
      if (!user) return
      api.get('/transparency/reports/saved').then((body) => setSaved(body.results)).catch((err) => setError(err.message))
    }
  }, [mode, user])

  useEffect(() => {
    const slug = search.get('template')
    if (!slug || !templates) return
    const template = templates.find((row) => row.slug === slug)
    if (template) setForm((current) => ({ ...current, title: template.title, description: template.description, sections: template.sections, entity: entity || current.entity }))
  }, [templates, search, entity])

  const sectionLabels = useMemo(() => Object.fromEntries((meta?.sections || []).map((row) => [row.key, row.label])), [meta])

  const buildFilters = () => ({
    entity: form.entity || undefined,
    year: form.year || undefined,
    types: form.types ? [form.types] : undefined,
    category: form.category || undefined,
    kind: form.kind || undefined,
  })

  const preview = async () => {
    setBusy(true)
    try {
      const body = await api.post('/transparency/reports/preview', { filters: buildFilters(), sections: form.sections })
      setReport(body.report)
      setConfig(null)
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      const body = await api.post('/transparency/reports/save', { title: form.title, description: form.description, templateSlug: search.get('template') || '', filters: buildFilters(), sections: form.sections, shared: false })
      setConfig(body.config)
      toast.push(body.message)
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async (publicId) => {
    try {
      const body = await api.post(`/transparency/reports/saved/${publicId}/generate`)
      toast.push(body.message)
      setReport(body.report)
      setConfig({ publicId })
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const toggleShared = async (item) => {
    try {
      const body = await api.patch(`/transparency/reports/saved/${item.publicId}`, { shared: !item.shared })
      setSaved((rows) => rows.map((row) => (row.publicId === item.publicId ? body.config : row)))
      toast.push(body.config.shared ? 'Public link enabled. It opens published records only.' : 'Public link disabled.')
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const remove = async (item) => {
    if (!window.confirm(`Delete the saved configuration “${item.title}”? The source records are not affected.`)) return
    try {
      await api.del(`/transparency/reports/saved/${item.publicId}`)
      setSaved((rows) => rows.filter((row) => row.publicId !== item.publicId))
      toast.push('Saved report configuration removed.')
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const header = (
    <>
      <PageHeader
        eyebrow="Transparency"
        title={mode === 'methodology' ? 'Report methodology' : mode === 'saved' ? 'Saved transparency reports' : mode === 'builder' ? 'Custom report builder' : 'Financial transparency reports'}
        description="Source-backed reports built only from published financial records. BetterGo reports are not official government publications."
        breadcrumbs={[{ label: 'Transparency', to: '/transparency' }, { label: 'Reports', to: '/transparency/reports' }, ...(mode !== 'hub' ? [{ label: mode }] : [])]}
      />
      <TransparencyNav />
    </>
  )

  if (error) return <div className="section-tight">{header}<Alert tone="error" title="Reports could not load">{error}</Alert></div>
  if (!templates) return <div className="section-tight">{header}<SkeletonList count={3} height={80} /></div>

  if (mode === 'methodology') {
    return (
      <div className="section-tight">
        {header}
        {!methodology ? <SkeletonList count={2} height={70} /> : (
          <>
            <Alert tone="info" title="Independent platform">{methodology.disclaimer}</Alert>
            <div className="card">
              <h2 className="side-label">Financial terminology</h2>
              <div className="table-wrap"><table className="data"><caption className="text-xs">Stages that must not be added together.</caption><thead><tr><th scope="col">Term</th><th scope="col">Meaning</th></tr></thead><tbody>{methodology.terminology.map(([term, meaning]) => <tr key={term}><th scope="row">{term}</th><td>{meaning}</td></tr>)}</tbody></table></div>
            </div>
            <div className="card">
              <h2 className="side-label">Calculation rules</h2>
              <ul className="text-sm">{methodology.formulas.map((formula) => <li key={formula}>{formula}</li>)}</ul>
              <p className="text-sm text-muted">{methodology.limitations}</p>
            </div>
          </>
        )}
      </div>
    )
  }

  if (mode === 'saved') {
    return (
      <div className="section-tight">
        {header}
        {!user ? <Alert tone="warning" title="Sign in to keep reports">Saved configurations belong to your account. Public shared reports can be opened without signing in.</Alert> : !saved ? <SkeletonList count={2} height={70} /> : !saved.length ? (
          <div className="card"><p className="text-sm text-muted">No saved report configurations yet.</p><Link className="btn btn-primary btn-sm" to="/transparency/reports/builder">Build a report</Link></div>
        ) : saved.map((item) => (
          <div className="card" key={item.publicId}>
            <div className="row-between"><div><strong>{item.title}</strong><div className="text-xs text-muted">Version {item.version} · saved {String(item.updatedAt).slice(0, 10)}{item.lastGeneratedAt ? ` · generated ${String(item.lastGeneratedAt).slice(0, 10)}` : ' · not generated yet'}</div></div><Badge tone={item.shared ? 'success' : 'neutral'}>{item.shared ? 'Public link' : 'Private'}</Badge></div>
            {item.mayNeedRegeneration ? <Alert tone="warning" title="Data may be newer">A source record was updated after this configuration was last generated. Regenerate before citing it as current.</Alert> : null}
            <div className="pill-group">
              <Button size="sm" onClick={() => regenerate(item.publicId)}>Regenerate</Button>
              <Button variant="outline" size="sm" onClick={() => toggleShared(item)}>{item.shared ? 'Stop sharing' : 'Create public link'}</Button>
              {item.shared ? <a className="btn btn-outline btn-sm" href={`/transparency/reports/shared/${item.publicId}`}>Open public report</a> : null}
              <Button variant="danger" size="sm" onClick={() => remove(item)}>Delete</Button>
            </div>
            {config?.publicId === item.publicId && report ? <ReportView report={report} exports={item.publicId} /> : null}
          </div>
        ))}
      </div>
    )
  }

  if (mode === 'hub') {
    return (
      <div className="section-tight">
        {header}
        <Alert tone="info" title="Published records only">Templates never fill missing information with examples. A report generated from an empty selection explains what is unavailable instead of drawing a chart.</Alert>
        <div className="card">
          <div className="row-between"><h2 className="side-label">Report templates</h2><Link className="btn btn-primary btn-sm" to="/transparency/reports/builder">Open the builder</Link></div>
          <div className="grid grid-3">
            {templates.map((template) => (
              <Link key={template.slug} to={`/transparency/reports/builder?template=${template.slug}`} className="stack-tight" style={{ textDecoration: 'none' }}>
                <strong>{template.title}</strong><span className="text-xs text-muted">{template.description}</span>
              </Link>
            ))}
          </div>
        </div>
        <div className="pill-group">
          <Link className="pill" to="/transparency/reports/methodology">Methodology and terminology</Link>
          <Link className="pill" to="/transparency/reports/saved">Saved reports</Link>
          <Link className="pill" to="/transparency/reports/provincial">Provincial report</Link>
          <Link className="pill" to="/transparency/reports/municipal">Municipal report</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="section-tight">
      {header}
      <Alert tone="info" title="Only published data">The builder cannot select drafts, unpublished records or private reviewer notes. Derived values state their formula and limitations.</Alert>
      <div className="card">
        <h2 className="side-label">Report settings</h2>
        <div className="grid grid-2">
          <Field label="Report title" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={160} /></Field>
          <Field label="Government entity">
            <Select value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })}>
              <option value="">All published entities</option>
              {entities.map((row) => <option key={row.slug} value={row.slug}>{row.name}</option>)}
            </Select>
          </Field>
          <Field label="Reporting year"><Input inputMode="numeric" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="All years" /></Field>
          <Field label="Module">
            <Select value={form.types} onChange={(e) => setForm({ ...form, types: e.target.value })}>
              <option value="">All modules</option>
              {Object.entries(meta.modules).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">All categories</option>
              {categories.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
            </Select>
          </Field>
          <Field label="Amount classification">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="">All classifications</option>
              {Object.entries(meta.amountKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Description"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={1000} /></Field>
        <fieldset className="stack-tight">
          <legend className="label">Sections</legend>
          <div className="grid grid-3">
            {meta.sections.map((section) => (
              <label key={section.key} className="checkbox-row">
                <input type="checkbox" checked={form.sections.includes(section.key)} onChange={(e) => setForm({ ...form, sections: e.target.checked ? [...form.sections, section.key] : form.sections.filter((key) => key !== section.key) })} />
                <span>{section.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="pill-group">
          <Button onClick={preview} loading={busy} disabled={!form.sections.length}>Preview report</Button>
          <Button variant="outline" onClick={save} loading={busy} disabled={!user || !form.sections.length} title={!user ? 'Sign in to save' : undefined}>{user ? 'Save configuration' : 'Sign in to save'}</Button>
          {config ? <Badge tone="success">Saved {config.publicId}</Badge> : null}
        </div>
      </div>
      {report ? <ReportView report={report} exports={config?.publicId} /> : null}
    </div>
  )
}
