import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { useLang } from '../../i18n'
import { Alert, Badge, SkeletonList } from '../../components/ui'
import { PageHeader } from '../../components/layout'
import { FinanceBarChart } from '../../components/FinanceBarChart'

export function money(cents, currency = 'PHP') {
  if (cents === null || cents === undefined) return '—'
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100)
}

export default function BudgetExplorer() {
  useDocumentTitle('Public budget explorer')
  const { t } = useLang()
  const { entity } = useParams()
  const [params, setParams] = useSearchParams()
  const year = params.get('year') || ''
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const slug = entity || params.get('municipality') || ''

  useEffect(() => {
    const query = new URLSearchParams()
    if (slug) query.set('municipality', slug)
    if (year) query.set('year', year)
    setData(null)
    api.get(`/transparency/finance/budgets?${query}`).then(setData).catch((err) => setError(err.message))
  }, [slug, year])

  if (error) return <div className="section-tight"><Alert tone="error" title="Budgets could not load">{error}</Alert></div>
  if (!data) return <div className="section-tight"><SkeletonList count={4} height={80} /></div>

  const allocationYear = data.allocations.length ? Math.max(...data.allocations.map((row) => row.fiscalYear)) : null
  const approvedRows = data.allocations.filter((row) => row.fiscalYear === allocationYear && row.amountKind === 'approved')
  const chartRows = (approvedRows.length ? approvedRows : data.allocations.filter((row) => row.fiscalYear === allocationYear)).map((row) => ({
    label: row.categoryLabel || row.categoryKey || 'Unmapped',
    value: row.totalCents,
    note: row.amountKind,
  }))

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('fin.eyebrow', 'Accountability')}
        title={data.selected ? `${data.selected.name} — ${t('fin.budgetTitle', 'Public budget explorer')}` : t('fin.budgetTitle', 'Public budget explorer')}
        description={t('fin.description')}
        breadcrumbs={[{ label: t('nav.transparency', 'Transparency'), to: '/transparency' }, { label: t('fin.financeCrumb', 'Finance'), to: '/transparency/finance' }, { label: t('nav.budgets', 'Budgets') }]}
      />
      <Alert tone="info" title={t('fin.howToRead', 'How to read this')}>{data.note}</Alert>

      <div className="card">
        <h2 className="side-label">{t('fin.chooseEntity', 'Choose a government entity')}</h2>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Link className={`btn btn-sm ${!data.selected ? 'btn-primary' : 'btn-outline'}`} to="/transparency/budgets">{t('fin.allEntities', 'All entities')}</Link>
          {data.entities.map((row) => (
            <Link key={row.slug} className={`btn btn-sm ${data.selected?.slug === row.slug ? 'btn-primary' : 'btn-outline'}`} to={`/transparency/budgets/${row.slug}`}>
              {row.name} {row.publishedBudgets ? '' : `(${t('fin.notAvailable', 'Data not yet available')})`}
            </Link>
          ))}
        </div>
        {data.years.length ? (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className={`btn btn-sm ${!year ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { params.delete('year'); setParams(params) }}>{t('fin.allYears', 'All years')}</button>
            {data.years.map((value) => (
              <button
                key={value}
                type="button"
                className={`btn btn-sm ${String(value) === year ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => { params.set('year', String(value)); setParams(params) }}
              >
                {value}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!data.records.length ? (
        <div className="card">
          <h2 className="side-label">{t('fin.notAvailable', 'Data not yet available')}</h2>
          <p className="text-sm text-muted">{t('fin.noMatch', 'No verified record matches this selection.')}</p>
        </div>
      ) : (
        <>
          <div className="card">
            <h2 className="side-label">{t('fin.allocations', 'Allocations by category and classification')}</h2>
            <FinanceBarChart
              title={`${allocationYear} ${t('fin.allocations', 'Allocations')}`}
              rows={chartRows}
              emptyLabel={t('fin.notAvailable', 'Data not yet available')}
            />
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th scope="col">{t('fin.fiscalYear', 'Fiscal year')}</th><th scope="col">{t('fin.category', 'Category')}</th><th scope="col">{t('fin.classification', 'Classification')}</th><th scope="col">{t('fin.total', 'Total')}</th><th scope="col">{t('fin.records', 'Records')}</th></tr></thead>
                <tbody>
                  {data.allocations.map((row) => (
                    <tr key={`${row.fiscalYear}-${row.categoryKey}-${row.amountKind}`}>
                      <td>{row.fiscalYear}</td>
                      <td>{row.categoryLabel || row.categoryKey || 'Unmapped'}</td>
                      <td><Badge tone={row.amountKind === 'approved' ? 'success' : 'neutral'}>{row.amountKind}</Badge></td>
                      <td>{money(row.totalCents, row.currency)}</td>
                      <td>{row.records}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">{t('fin.nominalNote')}</p>
          </div>

          <div className="card">
            <h2 className="side-label">{t('fin.comparisons', 'Year comparisons')}</h2>
            {data.comparisons.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead><tr><th scope="col">{t('fin.category', 'Category')}</th><th scope="col">{t('fin.classification', 'Classification')}</th><th scope="col">{t('fin.previous', 'Previous')}</th><th scope="col">{t('fin.current', 'Current')}</th><th scope="col">{t('fin.difference', 'Difference')}</th><th scope="col">{t('fin.change', 'Change')}</th></tr></thead>
                  <tbody>
                    {data.comparisons.map((row, index) => (
                      <tr key={index}>
                        <td>{row.category}</td>
                        <td>{row.amountKind}</td>
                        <td>{row.previousYear}: {money(row.previousCents)}</td>
                        <td>{row.currentYear}: {money(row.currentCents)}</td>
                        <td>{money(row.differenceCents)}</td>
                        <td>{row.percentageChange === null ? t('fin.notCalculated', 'Not calculated') : `${row.percentageChange}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-muted">{t('fin.noMatch', 'Comparisons need verified records for more than one year with the same scope and classification.')}</p>}
          </div>

          <div className="card">
            <h2 className="side-label">{t('fin.publishedBudgetRecords', 'Published budget records')}</h2>
            {data.records.map((row) => (
              <div key={row.id} className="stack-tight">
                <div className="row-between">
                  <strong>{row.title}</strong>
                  <Badge tone="success">{row.amountKindLabel}</Badge>
                </div>
                <span className="text-sm">{money(row.amountCents, row.currency)} · {row.categoryLabel || row.categoryKey} · {row.fiscalYear} {row.periodLabel ? `(${row.periodLabel})` : ''}</span>
                <span className="text-xs text-muted">
                  {row.department ? `${row.department} · ` : ''}{t('fin.source', 'Source')}: {row.source.title || t('fin.notAvailable', 'not recorded')} — {row.source.institution || t('fin.notAvailable', 'institution not recorded')}
                  {row.source.url ? <> · <a href={row.source.url} target="_blank" rel="noreferrer">{t('fin.originalDocument', 'original document')}</a></> : null}
                </span>
                {row.limitations ? <span className="text-xs text-muted">{t('fin.limitations', 'Limitations')}: {row.limitations}</span> : null}
                <Link className="text-xs" to={`/transparency/finance/record/${row.reference}`}>{t('fin.viewRecord', 'View record')} {row.reference}</Link>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
