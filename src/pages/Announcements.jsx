import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, CalendarDays, Copy, FileText, Megaphone, Share2, MapPin, Building2 } from 'lucide-react'
import { api, fmtDate, fmtDateTime, query } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { Badge, Button, EmptyState, Pagination, Select, SkeletonList, VerificationBadge, Alert, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'
import SaveButton from '../components/SaveButton'
import { AnnouncementCard, SectionHeading } from '../components/cards'
import { useLang } from '../i18n'

const SOURCE_LABELS = {
  bettergo: 'Original BetterGo content',
  reproduced: 'Reproduced public information',
  official: 'Officially sourced announcement',
  community: 'Community submission (moderated)',
}

export function AnnouncementsList() {
  const { t } = useLang()
  const [params, setParams] = useSearchParams()
  const category = params.get('category') || ''
  const municipality = params.get('municipality') || ''
  const sort = params.get('sort') || 'newest'
  const q = params.get('q') || ''
  const page = Number(params.get('page') || 1)
  const [term, setTerm] = useState(q)
  useDocumentTitle('Announcements')

  const { data: categories } = useApi('/announcements/categories')
  const { data: lookups } = useApi('/lookups')
  const { data, loading, error } = useApi(`/announcements${query({ category, municipality, sort, q, page, limit: 9 })}`)

  const setParam = (key, value) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'page') next.delete('page')
      return next
    })
  }

  const featured = page === 1 && data?.results?.find((item) => item.is_featured)

  return (
    <>
      <PageHeader
        eyebrow={t('ann.eyebrow', 'Public information')}
        title={t('ann.title', 'Announcements and updates')}
        description={t('ann.description')}
        breadcrumbs={[{ label: t('nav.announcements', 'Announcements') }]}
      />

      <div className="container section-tight">
        <div className="card mb-5">
          <form
            className="toolbar"
            style={{ marginBottom: 0 }}
            onSubmit={(event) => {
              event.preventDefault()
              setParam('q', term.trim())
            }}
          >
            <input
              className="input grow"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={t('ann.searchPlaceholder', 'Search announcements')}
              aria-label={t('ann.searchPlaceholder', 'Search announcements')}
              maxLength={120}
            />
            <Select value={category} onChange={(event) => setParam('category', event.target.value)} aria-label="Filter by category">
              <option value="">{t('ann.allCategories', 'All categories')}</option>
              {(categories?.results || []).map((item) => (
                <option key={item.slug} value={item.slug}>{item.name}</option>
              ))}
            </Select>
            <Select value={municipality} onChange={(event) => setParam('municipality', event.target.value)} aria-label="Filter by municipality">
              <option value="">{t('ann.provinceAndMunicipal', 'Province-wide & municipal')}</option>
              {(lookups?.municipalities || []).map((item) => (
                <option key={item.slug} value={item.slug}>{item.name}</option>
              ))}
            </Select>
            <Select value={sort} onChange={(event) => setParam('sort', event.target.value)} aria-label="Sort announcements">
              <option value="newest">{t('ann.sortNewest', 'Newest first')}</option>
              <option value="oldest">{t('ann.sortOldest', 'Oldest first')}</option>
              <option value="title">{t('ann.sortTitle', 'Title A–Z')}</option>
            </Select>
            <Button type="submit">{t('ann.apply', 'Apply')}</Button>
          </form>
        </div>

        {featured ? (
          <div className="mb-5">
            <h2 className="text-sm text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 'var(--space-2)' }}>{t('ann.featured', 'Featured announcement')}</h2>
            <AnnouncementCard announcement={featured} />
          </div>
        ) : null}

        {loading ? (
          <SkeletonList count={6} height={220} />
        ) : error ? (
          <EmptyState
            title={t('ann.unavailableTitle', 'Announcements are temporarily unavailable')}
            description={t('munis.errorDesc', 'Please try again shortly.')}
            action={<Button onClick={() => window.location.reload()}>{t('transparency.retry', 'Retry')}</Button>}
          />
        ) : data?.results?.length ? (
          <>
            <div className="grid grid-3">
              {data.results.map((announcement) => (
                <AnnouncementCard key={announcement.id} announcement={announcement} />
              ))}
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} onChange={(next) => setParam('page', String(next))} />
          </>
        ) : (
          <EmptyState
            icon={Megaphone}
            title={t('ann.emptyTitle', 'No announcements published yet')}
            description={t('ann.emptyDescription')}
            action={<Link className="btn btn-outline" to="/contact">{t('ann.emptyAction', 'Submit information for review')}</Link>}
          />
        )}

        <div className="alert alert-info mt-5">
          <FileText size={18} aria-hidden="true" />
          <div>
            <strong>{t('ann.sourceTitle', 'Source matters.')}</strong> {t('ann.sourceText')}
          </div>
        </div>
      </div>
    </>
  )
}

export function AnnouncementDetail() {
  const { t } = useLang()
  const { slug } = useParams()
  const { data, loading, error } = useApi(`/announcements/${slug}`)
  const toast = useToast()
  useDocumentTitle(data?.announcement?.title || 'Announcement')

  const announcement = data?.announcement

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.push('Link copied.')
    } catch {
      toast.push('Could not copy the link.', 'error')
    }
  }

  const shareNative = async () => {
    try {
      if (navigator.share) await navigator.share({ title: announcement.title, url: window.location.href })
      else await copy()
    } catch {
      /* cancelled */
    }
  }

  if (loading) return <div className="container section"><SkeletonList count={1} height={320} /></div>
  if (error || !announcement) {
    return (
      <div className="container section">
        <EmptyState
          icon={Megaphone}
          title={t('ann.notFoundTitle', 'Announcement not found')}
          description={t('ann.notFoundDescription')}
          action={<Link className="btn btn-primary" to="/announcements">{t('ann.all', 'All announcements')}</Link>}
        />
      </div>
    )
  }

  const facebookShare = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}`

  return (
    <>
      <PageHeader
        eyebrow={announcement.category_name || 'Announcement'}
        title={announcement.title}
        breadcrumbs={[{ label: 'Announcements', to: '/announcements' }, { label: announcement.title }]}
        actions={
          <>
            <Button variant="outline" icon={Share2} onClick={shareNative}>Share</Button>
            <Button variant="outline" icon={Copy} onClick={copy}>Copy link</Button>
            <SaveButton contentType="announcement" slug={announcement.slug} />
            <a className="btn btn-outline" href={facebookShare} target="_blank" rel="noopener noreferrer">Facebook</a>
          </>
        }
      />

      <div className="container section-tight">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2.2fr) minmax(0, 1fr)', alignItems: 'start' }}>
          <article className="card">
            <div className="row" style={{ gap: '0.4rem', marginBottom: 'var(--space-4)' }}>
              <VerificationBadge status={announcement.verification_status} />
              <Badge>{SOURCE_LABELS[announcement.source_type] || 'Public information'}</Badge>
              {announcement.is_featured ? <Badge tone="warning">Featured</Badge> : null}
              {announcement.priority === 'high' || announcement.priority === 'urgent' ? <Badge tone="danger">{announcement.priority}</Badge> : null}
            </div>

            {announcement.featured_image ? (
              <img
                src={announcement.featured_image}
                alt=""
                loading="lazy"
                style={{ width: '100%', borderRadius: 'var(--radius)', marginBottom: 'var(--space-4)' }}
              />
            ) : null}

            {announcement.summary ? (
              <p className="text-lg" style={{ fontSize: 'var(--text-body-lg)', color: 'var(--text)', fontWeight: 500 }}>
                {announcement.summary}
              </p>
            ) : null}

            <div className="prose" style={{ whiteSpace: 'pre-line' }}>{announcement.content || 'No further content was published.'}</div>

            {data.attachments?.length ? (
              <div className="mt-5">
                <h2 style={{ fontSize: 'var(--text-h4)' }}>Attachments</h2>
                <ul className="link-list">
                  {data.attachments.map((attachment) => (
                    <li key={attachment.id}>
                      <a href={`/api/announcements/${announcement.slug}`} onClick={(event) => event.preventDefault()}>
                        <FileText size={13} aria-hidden="true" /> {attachment.title || attachment.file_name}
                      </a>
                      <span className="text-xs text-muted"> · {attachment.file_type || 'file'} · {Math.round((attachment.file_size || 0) / 1024)} KB</span>
                    </li>
                  ))}
                </ul>
                <p className="help">Attachments are published only after review. Contact the publishing office for the authoritative copy.</p>
              </div>
            ) : null}

            <div className="row mt-5" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
              <Link className="btn btn-ghost btn-sm" to="/announcements"><ArrowRight size={14} style={{ transform: 'rotate(180deg)' }} aria-hidden="true" /> All announcements</Link>
              <Link className="btn btn-ghost btn-sm" to={`/contact?kind=concern`} style={{ marginLeft: 'auto' }}>Report an error</Link>
            </div>
          </article>

          <aside className="stack" style={{ gap: 'var(--space-4)' }}>
            <div className="card">
              <h3 style={{ fontSize: 'var(--text-h4)' }}>Publication details</h3>
              <dl className="detail-list" style={{ gridTemplateColumns: '1fr' }}>
                <div className="detail-item">
                  <dt>Published</dt>
                  <dd><CalendarDays size={12} aria-hidden="true" /> {fmtDateTime(announcement.published_at || announcement.created_at)}</dd>
                </div>
                <div className="detail-item">
                  <dt>Last updated</dt>
                  <dd>{fmtDate(announcement.updated_at)}</dd>
                </div>
                <div className="detail-item">
                  <dt>Coverage</dt>
                  <dd>
                    <MapPin size={12} aria-hidden="true" />{' '}
                    {announcement.municipality_name ? (
                      <Link to={`/municipalities/${announcement.municipality_slug}`}>{announcement.municipality_name}</Link>
                    ) : (
                      'Province-wide'
                    )}
                  </dd>
                </div>
                <div className="detail-item">
                  <dt>Source</dt>
                  <dd>
                    {announcement.source_organization || (announcement.source_type === 'bettergo' ? 'BetterGo Marinduque' : 'Not recorded')}
                    {announcement.source_url ? (
                      <div><a href={announcement.source_url} target="_blank" rel="noopener noreferrer">Original source</a></div>
                    ) : null}
                  </dd>
                </div>
                <div className="detail-item">
                  <dt>Verified</dt>
                  <dd>{announcement.verified_at ? fmtDate(announcement.verified_at) : 'Not yet verified'}</dd>
                </div>
              </dl>
              {announcement.verification_status !== 'verified' ? (
                <div className="alert alert-warning mt-3">
                  This record has not been verified against an official source. Confirm details with the publishing office.
                </div>
              ) : null}
            </div>

            {data.related?.length ? (
              <div className="card">
                <h3 style={{ fontSize: 'var(--text-h4)' }}>Related announcements</h3>
                <ul className="link-list">
                  {data.related.map((item) => (
                    <li key={item.id}>
                      <Link to={`/announcements/${item.slug}`}>{item.title}</Link>
                      <div className="text-xs text-muted">{fmtDate(item.published_at)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="meta-panel">
              <Building2 size={16} aria-hidden="true" />
              <p className="text-sm mt-2">
                BetterGo Marinduque is an independent civic initiative. Reproduced information does not imply official publication by
                BetterGo.
              </p>
              <Link className="btn btn-outline btn-sm mt-2" to="/disclaimer">Read the disclaimer</Link>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}
