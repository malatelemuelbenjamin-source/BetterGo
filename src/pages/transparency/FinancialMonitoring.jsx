import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, query } from '../../api'
import { useSeo } from '../../hooks'
import { useAuth } from '../../auth'
import { useLang } from '../../i18n'
import { Alert, Badge, Button, Field, Input, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'
import TransparencyNav from './TransparencyNav'

const SEV_TONE = { critical: 'danger', high: 'warning', medium: 'info', low: 'neutral', informational: 'neutral' }

export default function FinancialMonitoring() {
  const { entity } = useParams()
  const { user } = useAuth()
  const { t } = useLang()
  const toast = useToast()
  const [overview, setOverview] = useState(null)
  const [entityData, setEntityData] = useState(null)
  const [findings, setFindings] = useState(null)
  const [methodology, setMethodology] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState({ severity: '', module: '', status: '' })
  const [form, setForm] = useState({ recordReference: '', description: '', sourceUrl: '' })
  const [busy, setBusy] = useState(false)

  useSeo({
    title: 'Financial data-quality monitoring',
    description: 'Review approved, explainable data-quality observations about published Marinduque financial records. Not fraud detection, not a COA finding.',
  })

  useEffect(() => {
    setEntityData(null)
    setError(null)
    api.get('/transparency/financial-monitoring/overview').then(setOverview).catch((err) => setError(err.message))
    api.get('/transparency/financial-monitoring/methodology').then(setMethodology).catch(() => {})
    api.get('/transparency/financial-monitoring/analytics').then(setAnalytics).catch(() => {})
    const base = entity ? `/transparency/financial-monitoring/entities/${entity}` : '/transparency/financial-monitoring/findings'
    api.get(`${base}${query({ ...filters, limit: 25 })}`).then((body) => {
      if (entity) setEntityData(body)
      else setFindings(body)
    }).catch((err) => setError(err.message))
  }, [entity, filters])

  const submitObservation = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await api.post('/transparency/financial-monitoring/observations', form)
      toast.push(result.message)
      setForm({ recordReference: '', description: '', sourceUrl: '' })
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div className="section-tight"><Alert tone="error" title="Monitoring could not load">{error}</Alert></div>

  const title = entity ? `${entityData?.entity?.name || entity} — monitoring` : t('mon.title', 'Financial data-quality monitoring')
  const displayed = entity ? entityData?.findings : findings?.results
  const totals = entity ? entityData?.totals : overview?.totals

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('nav.transparency', 'Transparency')}
        title={title}
        description="Documentation and consistency observations about published records. Every public item has been reviewed by a person."
        breadcrumbs={[
          { label: t('nav.transparency', 'Transparency'), to: '/transparency' },
          { label: 'Financial monitoring', to: '/transparency/financial-monitoring' },
          ...(entity ? [{ label: entityData?.entity?.name || entity }] : []),
        ]}
      />
      <TransparencyNav />
      <Alert tone="info" title="What this is — and is not">
        BetterGo is an independent civic platform. These are informational data-quality observations, not corruption scores, guilt ratings, official COA findings or legal conclusions. A difference can have a documented explanation.
      </Alert>

      {!overview ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="grid grid-4">
            <div className="card"><div className="side-label">Published observations</div><strong>{totals?.published ?? totals?.findings ?? 0}</strong></div>
            <div className="card"><div className="side-label">Open for review</div><strong>{totals?.open ?? 0}</strong></div>
            <div className="card"><div className="side-label">Resolved with notes</div><strong>{totals?.resolved ?? 0}</strong></div>
            <div className="card"><div className="side-label">High or critical data issues</div><strong>{(totals?.bySeverity?.high || 0) + (totals?.bySeverity?.critical || 0)}</strong></div>
          </div>

          {!entity ? (
            <div className="card">
              <h2 className="side-label">Coverage by government entity</h2>
              <div className="grid grid-3">
                {overview.entities.map((row) => (
                  <Link key={row.slug} to={`/transparency/financial-monitoring/${row.slug}`} className="stack-tight" style={{ textDecoration: 'none' }}>
                    <strong>{row.name}</strong>
                    <span className="text-xs text-muted">{row.findings ? `${row.findings} published observation(s)` : 'No published observation'}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <Alert tone="info" title="Published financial records in scope">
              {entityData ? `${entityData.publishedRecords} published financial record(s). ${entityData.note}` : 'Loading.'}
            </Alert>
          )}

          <div className="card">
            <div className="row-between">
              <h2 className="side-label">Public findings directory</h2>
              {!entity ? (
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <select className="input" aria-label="Filter by severity" value={filters.severity} onChange={(e) => setFilters({ ...filters, severity: e.target.value })}>
                    <option value="">All severities</option>
                    {['informational', 'low', 'medium', 'high', 'critical'].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                  <select className="input" aria-label="Filter by status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                    <option value="">All statuses</option><option value="open">Open</option><option value="resolved">Resolved</option>
                  </select>
                </div>
              ) : null}
            </div>
            {!displayed ? <SkeletonList count={2} height={60} /> : !displayed.length ? (
              <p className="text-sm text-muted">No approved data-quality observation has been published for this selection. This does not mean the records are complete or correct.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <caption className="text-xs" style={{ textAlign: 'left', padding: '0.5rem' }}>Approved data-quality observations. Severity describes a documentation or integrity condition, not wrongdoing.</caption>
                  <thead><tr><th scope="col">Issue</th><th scope="col">Affected record</th><th scope="col">Entity and period</th><th scope="col">Severity</th><th scope="col">Detected</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {displayed.map((finding) => (
                      <tr key={finding.reference}>
                        <td><strong>{finding.label}</strong><div className="text-xs text-muted">{finding.description}</div>{finding.resolutionNotes ? <div className="text-xs">Resolution: {finding.resolutionNotes}</div> : null}</td>
                        <td>{finding.recordReference ? <Link to={`/transparency/finance/record/${finding.recordReference}`}>{finding.recordReference}</Link> : 'Record unavailable'}<div className="text-xs text-muted">{finding.moduleLabel}</div></td>
                        <td>{finding.entity.name || 'Entity unavailable'}<div className="text-xs text-muted">{finding.periodLabel || 'Period unavailable'}</div></td>
                        <td><Badge tone={SEV_TONE[finding.severity] || 'neutral'}>{finding.severityLabel}</Badge></td>
                        <td>{String(finding.detectionDate).slice(0, 10)}</td>
                        <td>{finding.resolvedAt ? 'Resolved documentation issue' : finding.reviewStatus === 'published' ? 'Reviewed and published' : finding.reviewStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted">Detection methodology and supporting sources are recorded for each item. Unverified observations and reviewer notes are never public.</p>
          </div>

          <div className="card">
            <h2 className="side-label">Monitoring analytics</h2>
            {!analytics ? <p className="text-sm text-muted">Analytics are not yet available.</p> : (
              <div className="grid grid-2">
                <div>
                  <p className="text-sm">{analytics.note}</p>
                  <div className="text-sm">Average review time: {analytics.averageReviewHours === null ? 'Not calculated' : `${analytics.averageReviewHours} hours`}</div>
                  <p className="text-xs text-muted">{analytics.averageReviewNote}</p>
                  <div className="pill-group" style={{ marginTop: '0.5rem' }}>{['csv', 'xlsx', 'json', 'pdf'].map((format) => <a key={format} className="pill" href={`/api/transparency/financial-monitoring/findings/export?format=${format}`}>{format.toUpperCase()} export</a>)}</div>
                </div>
                <div>
                  {analytics.byCategory.length ? analytics.byCategory.map((row) => <div key={row.key} className="row-between text-sm"><span>{row.label}</span><strong>{row.count}</strong></div>) : <p className="text-sm text-muted">No published observation to chart.</p>}
                  {analytics.byEntity.map((row) => <div key={row.name} className="row-between text-xs text-muted"><span>{row.name}</span><span>{row.count}</span></div>)}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="side-label">Detection methodology</h2>
            <p className="text-sm text-muted">{methodology?.principles?.join(' ') || overview.methodology}</p>
            <details>
              <summary className="text-sm">Checks used by the rule engine</summary>
              <ul className="text-sm">
                {(methodology?.checks || []).map((check) => <li key={check.key}><strong>{check.name}</strong> — {check.description} <span className="text-xs text-muted">({check.severityLabel})</span></li>)}
              </ul>
            </details>
          </div>

          <div className="card">
            <h2 className="side-label">Submit a public observation</h2>
            <p className="text-sm text-muted">Submit an observation about a published record only. It does not establish that an error or violation occurred, and your identity is never published. Do not include personal information.</p>
            {!user ? (
              <Link className="btn btn-primary btn-sm" to={`/login?next=${encodeURIComponent('/transparency/financial-monitoring')}`}>Sign in to submit an observation</Link>
            ) : (
              <form onSubmit={submitObservation} className="stack-tight">
                <Field label="Published record reference" required help="For example BG-FIN-… from the record page.">
                  <Input required value={form.recordReference} onChange={(e) => setForm({ ...form, recordReference: e.target.value })} placeholder="BG-FIN-…" />
                </Field>
                <Field label="What appears inconsistent or undocumented?" required help="At least 20 characters. Cite the public document if you can.">
                  <Textarea required rows={4} minLength={20} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </Field>
                <Field label="Optional public source link">
                  <Input type="url" value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://" />
                </Field>
                <Button type="submit" loading={busy}>Send for review</Button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  )
}
