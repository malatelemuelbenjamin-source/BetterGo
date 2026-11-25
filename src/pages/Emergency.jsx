import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Flame,
  Hospital,
  MapPin,
  Phone,
  Shield,
  Siren,
  Waves,
  Wind,
} from 'lucide-react'
import { fmtDate, query } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Select, SkeletonList, VerificationBadge } from '../components/ui'
import { PageHeader } from '../components/layout'
import { EmergencyCard, SectionHeading } from '../components/cards'
import { useLang } from '../i18n'

// Guidance sentences live in the interface dictionary as pipe-separated lists so
// every preparedness card keeps the same structure in both languages.
const PREPAREDNESS = [
  { title: 'Typhoons', titleKey: 'emergency.prepTyphoon', pointsKey: 'emergency.prepTyphoonPoints', icon: Wind },
  { title: 'Flooding', titleKey: 'emergency.prepFlood', pointsKey: 'emergency.prepFloodPoints', icon: Waves },
  { title: 'Earthquakes', titleKey: 'emergency.prepQuake', pointsKey: 'emergency.prepQuakePoints', icon: AlertTriangle },
  { title: 'Fire', titleKey: 'emergency.prepFire', pointsKey: 'emergency.prepFirePoints', icon: Flame },
]

const CATEGORY_TILES = [
  { label: 'Police assistance', labelKey: 'emergency.tilePolice', to: '/emergency/police', icon: Shield },
  { label: 'Fire and rescue', labelKey: 'emergency.tileFire', to: '/emergency/fire-rescue', icon: Flame },
  { label: 'Hospitals & health', labelKey: 'emergency.tileHospitals', to: '/emergency/hospitals', icon: Hospital },
  { label: 'Disaster response', labelKey: 'emergency.tileDisaster', to: '/emergency?category=disaster', icon: Siren },
]

export function EmergencyHome() {
  const { t } = useLang()
  useDocumentTitle(t('emergency.eyebrow', 'Emergency information'))
  const { data, loading, error, reload } = useApi('/emergency')
  const { data: lookups } = useApi('/lookups')
  const [term, setTerm] = useState('')
  const [category, setCategory] = useState('')

  const all = data?.results || []
  const filtered = all.filter((contact) => {
    const matchesTerm = !term || contact.organization_name.toLowerCase().includes(term.toLowerCase()) || (contact.address || '').toLowerCase().includes(term.toLowerCase())
    const matchesCategory = !category || contact.category === category
    return matchesTerm && matchesCategory
  })

  return (
    <>
      <PageHeader
        eyebrow={t('emergency.eyebrow', 'Emergency information')}
        title={t('emergency.title', 'Emergency contacts and guidance')}
        description={t('emergency.description')}
        icon={AlertTriangle}
        breadcrumbs={[{ label: t('nav.emergency', 'Emergency') }]}
      />

      <div className="container section-tight">
        <div className="callout-emergency mb-5">
          <div className="row-between">
            <div>
              <strong style={{ display: 'block', fontSize: 'var(--text-h4)' }}>{t('emergency.callTitle', 'In a life-threatening emergency, call 911')}</strong>
              <p className="text-sm" style={{ color: 'inherit', margin: '0.25rem 0 0' }}>{t('emergency.callText')}</p>
            </div>
            <a className="btn btn-danger" href="tel:911"><Phone size={16} aria-hidden="true" /> {t('emergency.callButton', 'Call 911')}</a>
          </div>
        </div>

        <div className="grid grid-4 mb-5">
          {CATEGORY_TILES.map((tile) => (
            <Link key={tile.label} to={tile.to} className="card card-interactive card-link">
              <div className="card-icon" aria-hidden="true"><tile.icon size={22} /></div>
              <h3 style={{ fontSize: '0.98rem' }}>{t(tile.labelKey, tile.label)}</h3>
              <div className="card-actions"><span className="badge badge-danger">{t('emergency.openDirectory', 'Open directory')}</span></div>
            </Link>
          ))}
        </div>

        <div className="card mb-5">
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <input
              className="input grow"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={t('emergency.searchPlaceholder', 'Search emergency organisations or addresses')}
              aria-label={t('emergency.searchLabel', 'Search emergency contacts')}
            />
            <Select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Emergency category">
              <option value="">{t('emergency.allCategories', 'All categories')}</option>
              <option value="national">{t('emergency.catNational', 'National resources')}</option>
              <option value="police">{t('emergency.catPolice', 'Police')}</option>
              <option value="fire">{t('emergency.catFire', 'Fire and rescue')}</option>
              <option value="hospital">{t('emergency.catHospitals', 'Hospitals')}</option>
              <option value="health">{t('emergency.catHealth', 'Health facilities')}</option>
              <option value="disaster">{t('emergency.catDisaster', 'Disaster response')}</option>
              <option value="ambulance">{t('emergency.catAmbulance', 'Ambulance')}</option>
            </Select>
          </div>
        </div>

        {loading ? (
          <SkeletonList count={4} height={180} />
        ) : error ? (
          <EmptyState title="Emergency directory temporarily unavailable" description="If this is an emergency, call 911 immediately." action={<Button onClick={reload}>Retry</Button>} />
        ) : (
          <>
            <section aria-labelledby="national-heading">
              <SectionHeading
                eyebrow={t('emergency.nationalEyebrow', 'National')}
                title={<span id="national-heading">{t('emergency.nationalTitle', 'National emergency resources')}</span>}
                description={t('emergency.nationalDesc')}
              />
              <div className="grid grid-2">
                {(data?.national || []).filter((item) => filtered.includes(item)).map((contact) => (
                  <EmergencyCard key={contact.id} contact={contact} />
                ))}
              </div>
            </section>

            <section className="mt-5" aria-labelledby="local-heading">
              <SectionHeading
                eyebrow={t('emergency.localEyebrow', 'Local')}
                title={<span id="local-heading">{t('emergency.localTitle', 'Provincial and municipal contacts')}</span>}
                description={t('emergency.localDesc')}
              />
              {filtered.filter((item) => item.government_level !== 'national').length ? (
                <div className="grid grid-2">
                  {filtered.filter((item) => item.government_level !== 'national').map((contact) => (
                    <EmergencyCard key={contact.id} contact={contact} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Siren}
                  title={t('emergency.noLocalTitle', 'No verified local emergency contacts published yet')}
                  description={t('emergency.noLocalDesc')}
                  action={<a className="btn btn-danger" href="tel:911">{t('emergency.callButton', 'Call 911')}</a>}
                />
              )}
            </section>
          </>
        )}

        <section className="mt-6" aria-labelledby="municipality-emergency-heading">
          <SectionHeading
            eyebrow={t('emergency.muniEyebrow', 'By municipality')}
            title={<span id="municipality-emergency-heading">{t('emergency.muniTitle', 'Emergency information per municipality')}</span>}
            description={t('emergency.muniDesc')}
          />
          <div className="grid grid-3">
            {(lookups?.municipalities || []).map((municipality) => (
              <Link key={municipality.slug} to={`/emergency/${municipality.slug}`} className="card card-interactive card-link">
                <div className="card-icon" aria-hidden="true"><MapPin size={20} /></div>
                <h3 style={{ fontSize: '1rem' }}>{municipality.name}</h3>
                <p>{t('emergency.muniCard', 'Emergency contacts for')} {municipality.name}.</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-6" aria-labelledby="preparedness-heading">
          <SectionHeading
            eyebrow={t('emergency.prepEyebrow', 'Preparedness')}
            title={<span id="preparedness-heading">{t('emergency.prepTitle', 'Emergency preparedness')}</span>}
            description={t('emergency.prepDesc')}
          />
          <div className="grid grid-2">
            {PREPAREDNESS.map((item) => (
              <div key={item.title} className="card">
                <div className="card-icon" aria-hidden="true"><item.icon size={20} /></div>
                <h3 style={{ fontSize: '1rem' }}>{t(item.titleKey, item.title)}</h3>
                <ul className="text-sm text-muted" style={{ paddingLeft: '1.1rem' }}>
                  {t(item.pointsKey).split('|').map((point) => <li key={point}>{point}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <div className="alert alert-info mt-4">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              For live weather advisories use PAGASA; for earthquake and tsunami information use PHIVOLCS. This page provides general
              educational information, not live hazard warnings.
            </div>
          </div>
        </section>

        {data?.emergencyAnnouncements?.length ? (
          <section className="mt-6">
            <SectionHeading eyebrow={t('emergency.advisoriesEyebrow', 'Advisories')} title={t('emergency.advisoriesTitle', 'Emergency-related announcements')} />
            <div className="stack">
              {data.emergencyAnnouncements.map((announcement) => (
                <Link key={announcement.id} to={`/announcements/${announcement.slug}`} className="card card-interactive card-link">
                  <div className="row-between">
                    <Badge tone="danger">{announcement.category_name || 'Emergency'}</Badge>
                    <VerificationBadge status={announcement.verification_status} />
                  </div>
                  <h3 style={{ fontSize: '1rem' }}>{announcement.title}</h3>
                  <p>{announcement.summary}</p>
                  <div className="card-meta"><span>{fmtDate(announcement.published_at)}</span></div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <Alert tone="warning" title={t('emergency.verifyTitle', 'Verify before relying on a number')}>
          {t('emergency.verifyText')}
        </Alert>
      </div>
    </>
  )
}

export function EmergencyMunicipality() {
  const { slug } = useParams()
  const { data, loading, error } = useApi(`/emergency/${slug}`)
  useDocumentTitle(data?.municipality?.name ? `Emergency information: ${data.municipality.name}` : 'Emergency information')

  if (loading) return <div className="container section"><SkeletonList count={2} height={220} /></div>
  if (error || !data?.municipality) {
    return (
      <div className="container section">
        <EmptyState icon={MapPin} title="Municipality not found" description="Browse emergency information for all municipalities." action={<Link className="btn btn-primary" to="/emergency">Emergency directory</Link>} />
      </div>
    )
  }

  const local = data.contacts.filter((contact) => Number(contact.municipality_id) === Number(data.municipality.id))
  const national = data.contacts.filter((contact) => contact.government_level === 'national')

  return (
    <>
      <PageHeader
        eyebrow="Emergency information"
        title={`Emergency contacts in ${data.municipality.name}`}
        description={`Verified emergency resources for ${data.municipality.name}. Not every municipality has the same facilities.`}
        icon={Siren}
        breadcrumbs={[{ label: 'Emergency', to: '/emergency' }, { label: data.municipality.name }]}
        actions={<a className="btn btn-danger" href="tel:911">Call 911</a>}
      />

      <div className="container section-tight">
        <div className="row mb-4" style={{ gap: '0.4rem' }}>
          {(data.contacts || []).length ? null : null}
          <span className="text-xs text-muted">Switch municipality:</span>
          {['boac', 'mogpog', 'gasan', 'buenavista', 'torrijos', 'santa-cruz'].map((name) => (
            <Link key={name} className={`pill ${name === slug ? 'is-active' : ''}`} to={`/emergency/${name}`}>
              {name.replace('-', ' ')}
            </Link>
          ))}
        </div>

        <section aria-labelledby="local-muni-heading">
          <SectionHeading eyebrow="Local" title={<span id="local-muni-heading">Local emergency contacts</span>} />
          {local.length ? (
            <div className="grid grid-2">
              {local.map((contact) => <EmergencyCard key={contact.id} contact={contact} />)}
            </div>
          ) : (
            <EmptyState
              icon={Building2}
              title={`No verified contacts for ${data.municipality.name} yet`}
              description="Municipal emergency contacts are published only after verification with the responsible office. National resources remain available below."
              action={<Link className="btn btn-outline" to="/emergency">All emergency information</Link>}
            />
          )}
        </section>

        <section className="mt-5" aria-labelledby="national-muni-heading">
          <SectionHeading eyebrow="National" title={<span id="national-muni-heading">National resources</span>} />
          <div className="grid grid-2">
            {national.map((contact) => <EmergencyCard key={contact.id} contact={contact} />)}
          </div>
        </section>

        {data.announcements?.length ? (
          <section className="mt-5">
            <SectionHeading eyebrow="Updates" title={`Announcements for ${data.municipality.name}`} />
            <div className="stack">
              {data.announcements.map((announcement) => (
                <Link key={announcement.id} to={`/announcements/${announcement.slug}`} className="card card-interactive card-link">
                  <h3 style={{ fontSize: '1rem' }}>{announcement.title}</h3>
                  <p>{announcement.summary}</p>
                  <div className="card-meta"><span>{fmtDate(announcement.published_at)}</span></div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <div className="alert alert-warning mt-5">
          If a contact number is unavailable or incorrect, call 911 and report the correction through the contact form so administrators
          can re-verify it.
        </div>
      </div>
    </>
  )
}

export function EmergencyCategory({ category, title }) {
  const [params, setParams] = useSearchParams()
  const municipality = params.get('municipality') || ''
  const { data: lookups } = useApi('/lookups')
  const { data, loading, error } = useApi(`/emergency${query({ category, municipality })}`)
  useDocumentTitle(title)

  const results = data?.results || []

  return (
    <>
      <PageHeader
        eyebrow="Emergency directory"
        title={title}
        description="Only facilities with verified public contact information are published here. Missing records are shown honestly rather than filled with invented data."
        icon={Siren}
        breadcrumbs={[{ label: 'Emergency', to: '/emergency' }, { label: title }]}
        actions={<a className="btn btn-danger" href="tel:911">Call 911</a>}
      />

      <div className="container section-tight">
        <div className="toolbar">
          <Select value={municipality} onChange={(event) => setParams(event.target.value ? { municipality: event.target.value } : {})} aria-label="Filter by municipality">
            <option value="">All Marinduque</option>
            {(lookups?.municipalities || []).map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
          </Select>
          <Link className="btn btn-ghost btn-sm" to="/emergency" style={{ marginLeft: 'auto' }}>Back to emergency information</Link>
        </div>

        {loading ? (
          <SkeletonList count={4} height={180} />
        ) : error ? (
          <EmptyState title="Directory temporarily unavailable" description="If this is an emergency, call 911." />
        ) : results.length ? (
          <div className="grid grid-2">
            {results.map((contact) => <EmergencyCard key={contact.id} contact={contact} />)}
          </div>
        ) : (
          <EmptyState
            icon={Hospital}
            title="No verified records in this category"
            description="Facility records are added by authorised administrators after verification with the responsible office. Call 911 in an emergency."
            action={<Link className="btn btn-outline" to="/emergency">All emergency information</Link>}
          />
        )}

        <div className="card mt-5">
          <h2 style={{ fontSize: 'var(--text-h3)', marginBottom: 'var(--space-2)' }}>Map view</h2>
          <p className="text-sm text-muted">
            A map provider is not configured for this deployment, so the list above is the primary way to access this information.
            Facility coordinates are only stored when verified, and no location is invented. When a map provider is configured, verified
            facilities will appear as markers with a directions link.
          </p>
          <div className="meta-panel mt-3">
            <strong className="text-sm">List-based fallback active</strong>
            <p className="text-xs text-muted" style={{ margin: '0.25rem 0 0' }}>
              Emergency contact information never depends on the map provider or any external service.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
