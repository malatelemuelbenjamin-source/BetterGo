import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { useLang } from '../../i18n'
import { Alert, Badge, SkeletonList } from '../../components/ui'
import { PageHeader } from '../../components/layout'

export function money(cents, currency = 'PHP') {
  if (cents === null || cents === undefined) return 'Data not yet available'
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100)
}

export default function FinanceHub() {
  useDocumentTitle('Budget and financial transparency')
  const { t } = useLang()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/transparency/finance/overview').then(setData).catch((err) => setError(err.message))
  }, [])

  if (error) return <div className="section-tight"><Alert tone="error" title="The transparency portal could not load">{error}</Alert></div>
  if (!data) return <div className="section-tight"><SkeletonList count={4} height={90} /></div>

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('fin.eyebrow', 'Accountability')}
        title={t('fin.title', 'Budget and financial transparency')}
        description={t('fin.description')}
        breadcrumbs={[{ label: t('nav.transparency', 'Transparency'), to: '/transparency' }, { label: t('fin.financeCrumb', 'Finance') }]}
      />
      <Alert tone="info" title={t('fin.independent', 'Independent civic platform')}>{data.note}</Alert>

      <div className="grid grid-3">
        <div className="card"><div className="side-label">{t('fin.publishedRecords', 'Published records')}</div><strong>{data.totals.published}</strong></div>
        <div className="card"><div className="side-label">{t('fin.entitiesWithData', 'Entities with published data')}</div><strong>{data.totals.entitiesWithPublishedData} / {data.entities.length}</strong></div>
        <div className="card"><div className="side-label">{t('fin.lastUpdated', 'Last updated')}</div><strong>{data.lastUpdated ? data.lastUpdated.slice(0, 10) : t('fin.notAvailable', 'Not yet available')}</strong></div>
      </div>

      <div className="card">
        <div className="row-between">
          <h2 className="side-label">{t('fin.budgetExplorer', 'Budget explorer')}</h2>
          <Link className="btn btn-outline btn-sm" to="/transparency/budgets">{t('fin.openBudgets', 'Open budgets')}</Link>
        </div>
        <p className="text-sm text-muted">Compare approved, proposed and actual amounts only where verified records exist. Missing data is shown as unavailable, never as zero.</p>
      </div>

      <div className="card">
        <h2 className="side-label">{t('fin.modules', 'Transparency modules')}</h2>
        <div className="grid grid-3">
          {Object.entries(data.modules).map(([key, label]) => (
            <Link key={key} to={`/transparency/finance/${key}`} className="stack-tight" style={{ textDecoration: 'none' }}>
              <strong>{label}</strong>
              <span className="text-xs text-muted">
                {data.counts[key] ? `${data.counts[key]} published record(s)` : t('fin.notAvailable', 'Data not yet available')}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="side-label">{t('fin.coverage', 'Coverage by government entity')}</h2>
        {data.entities.map((entity) => (
          <div key={entity.slug} className="row-between text-sm">
            <Link to={`/transparency/budgets/${entity.slug}`}>{entity.name}</Link>
            <span className="text-muted">{entity.publishedRecords ? `${entity.publishedRecords} published record(s)` : t('fin.awaiting', 'Awaiting verification')}</span>
          </div>
        ))}
        <p className="text-xs text-muted">The Provincial Government of Marinduque is listed separately in the budget explorer.</p>
      </div>

      <div className="card">
        <h2 className="side-label">{t('fin.sources', 'Data sources and verification')}</h2>
        <p className="text-sm text-muted">
          Every published record names its source institution, original document and, where available, its URL and publication date.
          Records move through draft, awaiting source, under review, verified, approved and published. Reviewer notes are never public.
          Documents published before this module remain under <a href="/transparency/documents">{t('fin.publicDocuments', 'public documents')}</a>.
        </p>
        <p className="text-xs text-muted">A published record reproduces public information. It is not an official certification by BetterGo or the government.</p>
      </div>

      <div className="card">
        <h2 className="side-label">{t('fin.amountKinds', 'Amount classifications')}</h2>
        {Object.entries(data.amountKinds).map(([key, label]) => (
          <div key={key} className="row-between text-sm"><Badge tone="neutral">{key}</Badge><span className="text-muted">{label}</span></div>
        ))}
        <p className="text-xs text-muted">{t('fin.proposedNote')}</p>
      </div>
    </div>
  )
}
