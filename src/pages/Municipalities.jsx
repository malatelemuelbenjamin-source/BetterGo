import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Building2, FileText, MapPin, Megaphone, ShieldCheck } from 'lucide-react'
import { useApi, useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, SkeletonList, VerificationBadge } from '../components/ui'
import { PageHeader } from '../components/layout'
import { useLang } from '../i18n'

/**
 * Municipality directory (Phase 3). Every count comes from published records;
 * a portal with no published information says so instead of inventing activity.
 */
export function MunicipalitiesList() {
  const { t } = useLang()
  useDocumentTitle(t('nav.municipalities', 'Municipalities'))
  const { data, loading, error, reload } = useApi('/municipal-portals')
  const [term, setTerm] = useState('')
  const portals = data?.results || []
  const totals = portals.reduce(
    (acc, item) => {
      const metrics = item.metrics || {}
      acc.published +=
        Number(metrics.announced || 0) +
        Number(metrics.offices || 0) +
        Number(metrics.services || 0) +
        Number(metrics.content || 0)
      acc.projects += Number(metrics.byType?.project || 0)
      acc.programs += Number(metrics.byType?.program || 0)
      if (item.verification_status === 'verified') acc.verified += 1
      return acc
    },
    { published: 0, projects: 0, programs: 0, verified: 0 },
  )
  const filtered = portals.filter((item) => {
    const haystack = `${item.name} ${item.portal_title || ''} ${item.description || ''}`.toLowerCase()
    return haystack.includes(term.toLowerCase())
  })

  return (
    <>
      <PageHeader
        eyebrow={t('munis.eyebrow', 'Marinduque')}
        title={t('munis.title', 'Municipal portals')}
        description={t('munis.description')}
        breadcrumbs={[{ label: t('nav.municipalities', 'Municipalities') }]}
      />

      <div className="container section-tight">
        <div className="portal-stats" role="list" aria-label="Published municipal information">
          <div className="portal-stat" role="listitem">
            <span className="portal-stat-value">{portals.length || 6}</span>
            <span className="portal-stat-label">{t('munis.portals', 'Municipal portals')}</span>
          </div>
          <div className="portal-stat" role="listitem">
            <span className="portal-stat-value">{totals.published}</span>
            <span className="portal-stat-label">{t('munis.publishedRecords', 'Published records')}</span>
          </div>
          <div className="portal-stat" role="listitem">
            <span className="portal-stat-value">{totals.projects}</span>
            <span className="portal-stat-label">{t('munis.projects', 'Public projects')}</span>
          </div>
          <div className="portal-stat" role="listitem">
            <span className="portal-stat-value">{totals.programs}</span>
            <span className="portal-stat-label">{t('munis.programs', 'Programs')}</span>
          </div>
          <div className="portal-stat" role="listitem">
            <span className="portal-stat-value">{totals.verified}</span>
            <span className="portal-stat-label">{t('munis.verified', 'Verified profiles')}</span>
          </div>
        </div>

        <div className="suggestion-row mt-4" aria-label="Municipal directories">
          <Link className="chip-button" to="/municipal-projects"><ArrowRight size={12} aria-hidden="true" /> {t('munis.chipProjects', 'Projects')}</Link>
          <Link className="chip-button" to="/municipal-programs"><ArrowRight size={12} aria-hidden="true" /> {t('munis.chipPrograms', 'Programs')}</Link>
          <Link className="chip-button" to="/municipal-resources"><ArrowRight size={12} aria-hidden="true" /> {t('munis.chipResources', 'Resources')}</Link>
          <Link className="chip-button" to="/municipal-faqs"><ArrowRight size={12} aria-hidden="true" /> {t('munis.chipFaqs', 'FAQs')}</Link>
          <Link className="chip-button" to="/municipal-offices"><ArrowRight size={12} aria-hidden="true" /> {t('munis.chipOffices', 'Office map')}</Link>
          <Link className="chip-button" to="/municipal-search"><ArrowRight size={12} aria-hidden="true" /> {t('munis.chipSearch', 'Search all portals')}</Link>
        </div>

        <div className="toolbar mt-4">
          <input
            className="input grow"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t('munis.searchPlaceholder', 'Search municipalities')}
            aria-label={t('munis.searchLabel', 'Search municipalities')}
            maxLength={60}
          />
          <span className="text-xs text-muted">
            {filtered.length} {t('munis.count', 'of')} {portals.length || 6} {t('munis.municipalities', 'municipalities')}
          </span>
        </div>

        {loading ? (
          <SkeletonList count={6} />
        ) : error ? (
          <EmptyState
            title={t('munis.errorTitle', 'Municipal portals are temporarily unavailable')}
            description={t('munis.errorDesc', 'Please try again in a moment.')}
            action={<Button onClick={reload}>{t('transparency.retry', 'Retry')}</Button>}
          />
        ) : filtered.length ? (
          <div className="grid grid-3">
            {filtered.map((municipality) => {
              const metrics = municipality.metrics || {}
              const activity =
                Number(metrics.announced || 0) +
                Number(metrics.offices || 0) +
                Number(metrics.services || 0) +
                Number(metrics.content || 0)
              return (
                <Link
                  key={municipality.slug}
                  to={`/municipalities/${municipality.slug}`}
                  className="card card-interactive card-link municipality-card"
                >
                  <div className={`municipality-cover${municipality.cover_image ? ' has-image' : ''}`}>
                    {municipality.cover_image ? (
                      <img src={municipality.cover_image} alt="" loading="lazy" />
                    ) : (
                      <span aria-hidden="true"><MapPin size={22} /></span>
                    )}
                  </div>
                  <div className="row-between">
                    <h3 style={{ fontSize: '1.05rem' }}>{municipality.portal_title || municipality.name}</h3>
                    <VerificationBadge status={municipality.verification_status} />
                  </div>
                  <p>{municipality.portal_description || municipality.description || t('munis.noInfo', 'No published information yet')}</p>
                  <div className="card-meta">
                    <span><Megaphone size={11} aria-hidden="true" /> {metrics.announced || 0} {t('munis.announcements', 'announcements')}</span>
                    <span><FileText size={11} aria-hidden="true" /> {metrics.services || 0} {t('munis.services', 'services')}</span>
                    <span><Building2 size={11} aria-hidden="true" /> {metrics.offices || 0} {t('munis.offices', 'offices')}</span>
                    <span>{Number(metrics.byType?.project || 0)} {t('munis.chipProjects', 'projects').toLowerCase()}</span>
                    <span>{Number(metrics.byType?.program || 0)} {t('munis.chipPrograms', 'programs').toLowerCase()}</span>
                  </div>
                  {activity === 0 ? (
                    <Badge tone="warning">{t('munis.noInfo', 'No published information yet')}</Badge>
                  ) : (
                    <Badge tone="success">{activity} {t('munis.publishedCount', 'published records')}</Badge>
                  )}
                  <div className="card-actions">
                    <span className="badge badge-success">{t('munis.open', 'Open portal')} <ArrowRight size={12} aria-hidden="true" /></span>
                  </div>
                </Link>
              )
            })}
          </div>
        ) : (
          <EmptyState icon={MapPin} title={t('munis.emptyTitle', 'No municipality matches that search')} description={t('munis.emptyDescription')} />
        )}

        <div className="alert alert-info mt-5">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            Municipality information is published with a source reference and verification status. BetterGo does not invent municipal
            officials, addresses, telephone numbers or population figures, and does not use municipal seals without permission.
          </div>
        </div>

        <Alert tone="info" title={t('munis.alertTitle', 'Municipal portals are ready for verified information')}>
          {t('munis.alert')}
        </Alert>
      </div>
    </>
  )
}

export default MunicipalitiesList
