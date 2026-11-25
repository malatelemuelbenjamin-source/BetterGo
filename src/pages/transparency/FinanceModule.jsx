import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, SkeletonList } from '../../components/ui'
import { PageHeader } from '../../components/layout'
import { money } from './FinanceHub'

const TITLES = {
  revenue: 'Revenue and income',
  expenditure: 'Expenditures and disbursements',
  procurement: 'Procurement and contracts',
  project: 'Government projects and funding',
  aip: 'Annual Investment Program',
  financial_report: 'Financial reports',
  audit_report: 'Audit reports',
  grant: 'Grants, subsidies and assistance',
  asset: 'Assets and public property',
  loan: 'Loans, debt and obligations',
  ppp: 'Public-private partnerships',
  payroll: 'Payroll and personnel expenditure',
  tax: 'Tax assessment and collection',
  land: 'Public land and property transactions',
  utility: 'Public utilities and service contracts',
  donation: 'Donations, sponsorships and external funding',
  budget: 'Budget records',
}

export default function FinanceModule() {
  const module = useParams().module || 'revenue'
  const { t } = useLang()
  const title = TITLES[module] || 'Financial records'
  useDocumentTitle(title)
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [categories, setCategories] = useState([])
  const [error, setError] = useState(null)
  const query = params.toString()

  useEffect(() => {
    setData(null)
    api.get(`/transparency/finance/records?type=${encodeURIComponent(module)}&${query}`).then(setData).catch((err) => setError(err.message))
  }, [module, query])

  useEffect(() => {
    api.get('/transparency/finance/categories').then((body) => setCategories(body.categories)).catch(() => {})
  }, [])

  const update = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    setParams(next)
  }

  if (error) return <div className="section-tight"><Alert tone="error" title="Records could not load">{error}</Alert></div>

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('nav.transparency', 'Transparency')}
        title={title}
        description={t('fin.moduleDescription')}
        breadcrumbs={[{ label: 'Transparency', to: '/transparency' }, { label: 'Finance', to: '/transparency/finance' }, { label: title }]}
      />
      <Alert tone="info" title={t('fin.howToRead', 'How to read this')}>{t('fin.moduleNote')}</Alert>

      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <select className="input" value={params.get('municipality') || ''} onChange={(e) => update('municipality', e.target.value)} aria-label={t('fin.entity', 'Government entity')}>
            <option value="">{t('fin.allEntities', 'All entities')}</option>
            <option value="provincial">Provincial Government</option>
            {['boac', 'mogpog', 'gasan', 'buenavista', 'torrijos', 'santa-cruz'].map((slug) => <option key={slug} value={slug}>{slug}</option>)}
          </select>
          <input className="input" placeholder={t('fin.fiscalYear', 'Reporting year')} value={params.get('year') || ''} onChange={(e) => update('year', e.target.value.replace(/\D/g, '').slice(0, 4))} aria-label={t('fin.fiscalYear', 'Reporting year')} />
          <select className="input" value={params.get('category') || ''} onChange={(e) => update('category', e.target.value)} aria-label={t('fin.category', 'Financial category')}>
            <option value="">{t('fin.allCategories', 'All categories')}</option>
            {categories.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
          </select>
          <select className="input" value={params.get('kind') || ''} onChange={(e) => update('kind', e.target.value)} aria-label={t('fin.classification', 'Amount classification')}>
            <option value="">{t('fin.allClassifications', 'All classifications')}</option>
            {['proposed', 'approved', 'adjusted', 'allotment', 'obligation', 'disbursement', 'actual', 'assessed', 'contract', 'valuation', 'balance'].map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
          <input className="input" placeholder={t('fin.search', 'Search')} value={params.get('q') || ''} onChange={(e) => update('q', e.target.value)} aria-label={t('fin.search', 'Search records')} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams(new URLSearchParams())}>{t('fin.resetFilters', 'Reset filters')}</button>
        </div>
      </div>

      {!data ? <SkeletonList count={3} height={70} /> : !data.results.length ? (
        <div className="card"><h2 className="side-label">{t('fin.notAvailable', 'Data not yet available')}</h2><p className="text-sm text-muted">{t('fin.noMatch', 'No verified record matches this selection.')}</p></div>
      ) : (
        <div className="card">
          <h2 className="side-label">{data.total} {t('fin.recordsCount', 'published record(s)')}</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>{t('fin.viewRecord', 'Record')}</th><th>{t('fin.entity', 'Entity')}</th><th>{t('fin.yearPeriod', 'Year / period')}</th><th>{t('fin.category', 'Category')}</th><th>{t('fin.classification', 'Classification')}</th><th>{t('fin.amount', 'Amount')}</th><th>{t('fin.source', 'Source')}</th></tr></thead>
              <tbody>
                {data.results.map((row) => (
                  <tr key={row.id}>
                    <td><Link to={`/transparency/finance/record/${row.reference}`}>{row.title}</Link>{row.counterparty ? <div className="text-xs text-muted">{row.counterparty}</div> : null}</td>
                    <td>{row.entity.name}<div className="text-xs text-muted">{row.department || ''}</div></td>
                    <td>{row.fiscalYear}<div className="text-xs text-muted">{row.periodLabel} ({row.periodType})</div></td>
                    <td>{row.categoryLabel || row.categoryKey || 'Unmapped'}</td>
                    <td><Badge tone={row.amountKind === 'approved' ? 'success' : 'neutral'}>{row.amountKindLabel}</Badge></td>
                    <td>{money(row.amountCents, row.currency)}</td>
                    <td className="text-xs">{row.source.title || 'Not recorded'}{row.source.url ? <a href={row.source.url} target="_blank" rel="noreferrer"> (document)</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > data.limit ? (
            <div className="row">
              <button type="button" className="btn btn-outline btn-sm" disabled={data.page <= 1} onClick={() => { params.set('page', String(data.page - 1)); setParams(params) }}>{t('fin.previous', 'Previous')}</button>
              <span className="text-xs text-muted">Page {data.page} of {Math.ceil(data.total / data.limit)}</span>
              <button type="button" className="btn btn-outline btn-sm" disabled={data.page * data.limit >= data.total} onClick={() => { params.set('page', String(data.page + 1)); setParams(params) }}>{t('fin.current', 'Next')}</button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function FinanceRecordDetail() {
  const { reference } = useParams()
  const { t } = useLang()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useDocumentTitle('Financial record')
  useEffect(() => {
    api.get(`/transparency/finance/records/${reference}`).then(setData).catch((err) => setError(err.message))
  }, [reference])

  if (error) return <div className="section-tight"><Alert tone="error" title="Record not available">{error}</Alert></div>
  if (!data) return <div className="section-tight"><SkeletonList count={2} height={80} /></div>
  const { record } = data
  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('fin.platformRecord', 'Published financial record')}
        title={record.title}
        description={`${record.recordTypeLabel} · ${record.entity.name}`}
        breadcrumbs={[{ label: 'Transparency', to: '/transparency' }, { label: 'Finance', to: '/transparency/finance' }, { label: record.reference }]}
      />
      <Alert tone="info" title={t('fin.platformRecord', 'Platform reproduction')}>{data.note}</Alert>
      <div className="card">
        <div className="grid grid-3">
          <div><div className="side-label">{t('fin.amount', 'Amount')}</div><strong>{money(record.amountCents, record.currency)}</strong></div>
          <div><div className="side-label">{t('fin.classification', 'Classification')}</div><strong>{record.amountKindLabel}</strong></div>
          <div><div className="side-label">{t('fin.period', 'Period')}</div><strong>{record.fiscalYear} · {record.periodLabel}</strong></div>
        </div>
        <p className="text-sm">{record.description}</p>
        <div className="stack-tight">
          <span className="text-xs text-muted">Category: {record.categoryLabel || record.categoryKey} {record.officialClassification ? `(source classification: ${record.officialClassification})` : ''}</span>
          {record.department ? <span className="text-xs text-muted">Department or program: {record.department}</span> : null}
          {record.counterparty ? <span className="text-xs text-muted">Counterparty: {record.counterparty}</span> : null}
          <span className="text-xs text-muted">Source: {record.source.institution || 'not recorded'} — {record.source.title || 'title not recorded'} {record.source.publishedOn ? `· published ${record.source.publishedOn}` : ''}</span>
          {record.source.url ? <a className="text-xs" href={record.source.url} target="_blank" rel="noreferrer">{t('fin.originalDocument', 'Open the original document')}</a> : null}
          {record.specialist && Object.values(record.specialist).some((value) => value !== null && value !== '' && value !== undefined) ? (
            <div className="stack-tight">
              <h3 className="side-label">{t('fin.specialist', 'Record details')}</h3>
              {record.specialist.identifier ? <span className="text-xs text-muted">{t('fin.identifier', 'Identifier')}: {record.specialist.identifier}</span> : null}
              {record.specialist.titleNumber ? <span className="text-xs text-muted">{t('fin.titleNumber', 'Title number')}: {record.specialist.titleNumber}</span> : null}
              {record.specialist.location ? <span className="text-xs text-muted">{t('fin.location', 'Location')}: {record.specialist.location}</span> : null}
              {record.specialist.programName ? <span className="text-xs text-muted">{t('fin.programName', 'Program')}: {record.specialist.programName}</span> : null}
              {record.specialist.principalCents !== null && record.specialist.principalCents !== undefined ? <span className="text-xs text-muted">{t('fin.principal', 'Principal')}: {money(record.specialist.principalCents, record.currency)}</span> : null}
              {record.specialist.outstandingBalanceCents !== null && record.specialist.outstandingBalanceCents !== undefined ? <span className="text-xs text-muted">{t('fin.outstandingBalance', 'Outstanding balance')}: {money(record.specialist.outstandingBalanceCents, record.currency)}</span> : null}
              {record.specialist.interestRate !== null && record.specialist.interestRate !== undefined ? <span className="text-xs text-muted">{t('fin.interestRate', 'Interest rate')}: {record.specialist.interestRate}%</span> : null}
              {record.specialist.maturityDate ? <span className="text-xs text-muted">{t('fin.maturityDate', 'Maturity date')}: {record.specialist.maturityDate}</span> : null}
              {record.specialist.termStart || record.specialist.termEnd ? <span className="text-xs text-muted">{t('fin.term', 'Term')}: {record.specialist.termStart || '—'} → {record.specialist.termEnd || '—'}</span> : null}
              {record.specialist.quantity !== null && record.specialist.quantity !== undefined ? <span className="text-xs text-muted">{t('fin.quantity', 'Quantity')}: {record.specialist.quantity} {record.specialist.quantityLabel || ''}</span> : null}
              {record.specialist.stage ? <span className="text-xs text-muted">{t('fin.stage', 'Stage or status')}: {record.specialist.stage}</span> : null}
              {record.specialist.rateDescription ? <span className="text-xs text-muted">{t('fin.rateDescription', 'Rate description')}: {record.specialist.rateDescription}</span> : null}
              {record.specialist.assessmentBasis ? <span className="text-xs text-muted">{t('fin.assessmentBasis', 'Assessment basis')}: {record.specialist.assessmentBasis}</span> : null}
              {record.specialist.arrangement ? <span className="text-xs text-muted">{t('fin.arrangement', 'Arrangement')}: {record.specialist.arrangement}</span> : null}
            </div>
          ) : null}
          <span className="text-xs text-muted">Verified on {record.verifiedAt ? record.verifiedAt.slice(0, 10) : 'recorded date unavailable'}. Review status: {record.statusLabel}.</span>
          {record.limitations ? <span className="text-xs text-muted">Limitations: {record.limitations}</span> : null}
        </div>
      </div>
    </div>
  )
}
