import { Link, useNavigate } from 'react-router-dom'
import { lazy, Suspense, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  FileText,
  Gauge,
  GraduationCap,
  HandHeart,
  HeartPulse,
  Landmark,
  MapPin,
  MousePointer2,
  Search,
  ShieldCheck,
  Sparkles,
  Sprout,
  Users,
  Briefcase,
  Home as HomeIcon,
  Accessibility,
  Megaphone,
} from 'lucide-react'
import { api, fmtDate, query } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { Button, EmptyState, SkeletonList } from '../components/ui'
import {
  AnnouncementCard,
  MunicipalityCard,
  ProjectCardPlaceholder,
  SectionHeading,
  StatCard,
  TransparencyCard,
} from '../components/cards'
import { CategoryIcon } from '../components/services'
import { Reveal, CountUp } from '../components/motion'
import { useAuth } from '../auth'
import { useLang, useT } from '../i18n'

const Island3D = lazy(() => import('../components/Island3D'))

function SceneFallback() {
  const t = useT()
  return (
    <div className="scene-shell" aria-hidden="true">
      <div className="scene-fallback">
        <p>{t('scene.loading', 'Loading the island illustration…')}</p>
      </div>
      <span className="scene-legend">
        <span>Marinduque</span>
        <span>{t('scene.scale', 'Stylised · not to scale')}</span>
      </span>
    </div>
  )
}

const CATEGORY_ICONS = {
  'health-medical': HeartPulse,
  'social-welfare': HandHeart,
  'business-permits': Briefcase,
  'civil-registry': FileText,
  'education-scholarships': GraduationCap,
  'agriculture-fisheries': Sprout,
  'employment-livelihood': Users,
  'housing-community': HomeIcon,
  'senior-citizen': Accessibility,
  'pwd-services': Accessibility,
  'youth-development': Sparkles,
  'disaster-emergency': ShieldCheck,
}

const QUICK_ACCESS = [
  { title: 'Government services', titleFil: 'Mga serbisyo ng gobyerno', description: 'Categories, requirements and procedures.', to: '/services', icon: FileText },
  { title: 'Municipalities', titleFil: 'Mga munisipalidad', description: 'Boac, Mogpog, Gasan, Buenavista, Torrijos, Santa Cruz.', to: '/municipalities', icon: MapPin },
  { title: 'Government offices', titleFil: 'Mga opisina ng gobyerno', description: 'Find the right office and public contact details.', to: '/government-directory', icon: Building2 },
  { title: 'Public announcements', titleFil: 'Mga anunsyo', description: 'Published updates and advisories.', to: '/announcements', icon: Megaphone },
  { title: 'Transparency', titleFil: 'Transparensiya', description: 'Budget, procurement and public documents.', to: '/transparency', icon: Landmark },
  { title: 'Projects & programs', titleFil: 'Mga proyekto at programa', description: 'Development records with their sources.', to: '/municipal-projects', icon: Gauge },
  { title: 'Emergency information', titleFil: 'Impormasyon sa emergency', description: 'Verified contacts and preparedness guidance.', to: '/emergency', icon: AlertTriangle },
  { title: 'Citizen participation', titleFil: 'Pakikilahok ng mamamayan', description: 'Share feedback, concerns and suggestions.', to: '/contact', icon: Users },
  { title: 'Search everything', titleFil: 'Hanapin lahat', description: 'One search across all public information.', to: '/search', icon: Search },
]

const SUGGESTED = {
  en: ['Birth certificate', 'Business permit', 'Health services', 'Scholarships', 'Emergency hotlines'],
  fil: ['Sertipiko ng kapanganakan', 'Permit sa negosyo', 'Serbisyong pangkalusugan', 'Iskolarsyip', 'Emergency hotline'],
}

const TICKERS = {
  en: [
    { icon: MapPin, label: 'Six municipalities, one province' },
    { icon: ShieldCheck, label: 'Every record shows its source' },
    { icon: Landmark, label: 'Transparency records with attribution' },
    { icon: Users, label: 'Built for citizen participation' },
    { icon: Sparkles, label: 'No invented government data' },
    { icon: Megaphone, label: 'Privacy-aware by design (RA 10173)' },
  ],
  fil: [
    { icon: MapPin, label: 'Anim na bayan, isang lalawigan' },
    { icon: ShieldCheck, label: 'Bawat rekord may pinagmulan' },
    { icon: Landmark, label: 'Transparensiyang may atribusyon' },
    { icon: Users, label: 'Para sa pakikilahok ng mamamayan' },
    { icon: Sparkles, label: 'Walang gawa-gawang datos' },
    { icon: Megaphone, label: 'Privacy-aware ayon sa RA 10173' },
  ],
}

const TOWNS = ['Boac', 'Mogpog', 'Gasan', 'Buenavista', 'Torrijos', 'Santa Cruz']

/* Renders a CMS headline as stacked lines, with the closing line in display italic. */
function HeroHeadline({ text }) {
  const lines = String(text)
    .split(/(?<=\.)\s+/)
    .filter(Boolean)
  return (
    <h1>
      {lines.map((line, index) =>
        index === lines.length - 1 && lines.length > 1 ? (
          <em key={`${line}-${index}`}>{line}</em>
        ) : (
          <span key={`${line}-${index}`} style={{ display: 'block' }}>
            {line}
          </span>
        ),
      )}
    </h1>
  )
}

export default function Home() {
  useDocumentTitle('Public Information, Services and Transparency')
  const [term, setTerm] = useState('')
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t, lang } = useLang()

  const { data: homepage } = useApi('/homepage')
  const { data: categories, loading: categoriesLoading } = useApi('/services/categories')
  const { data: municipalities, loading: municipalitiesLoading } = useApi('/municipalities')
  const { data: announcements, loading: announcementsLoading } = useApi('/announcements?limit=3')
  const { data: transparency } = useApi('/transparency')
  const { data: emergency } = useApi('/emergency')
  const { data: directory } = useApi('/directory?limit=3')

  const sections = Object.fromEntries((homepage?.sections || []).map((section) => [section.section_key, section]))
  const isEnabled = (key) => sections[key]?.is_enabled !== false
  const emergencyContacts = (emergency?.national || []).slice(0, 3)
  const verifiedEmergency = emergencyContacts.filter((contact) => contact.phone && contact.verification_status === 'verified')
  const categoryCount = categories?.total_parents || 25

  return (
    <>
      {/* ----------------------------- Hero ----------------------------- */}
      <section className="hero hero-atlas">
        <div className="container hero-atlas-inner">
          <div className="hero-atlas-grid">
            <Reveal className="hero-copy">
              <div className="eyebrow">{t('home.eyebrow')}</div>
              <HeroHeadline text={lang === 'fil' ? t('home.heroTitle') : sections.hero?.title || t('home.heroTitle')} />
              <p className="lead">
                {lang === 'fil' ? t('home.heroLead') : sections.hero?.subtitle || t('home.heroLead')}
              </p>
              <div className="hero-cta">
                <Link className="btn btn-white btn-lg" to="/services">
                  {t('home.ctaServices')} <ArrowRight size={17} aria-hidden="true" />
                </Link>
                <Link className="btn btn-outline btn-lg" to="/municipalities">
                  {t('home.ctaTowns')}
                </Link>
                <Link className="btn btn-ghost btn-lg" to="/transparency">
                  {t('home.ctaMoney')} <ArrowUpRight size={16} aria-hidden="true" />
                </Link>
              </div>
              <div className="hero-stats">
                <span className="hero-stat"><MapPin size={13} aria-hidden="true" /> {t('home.statTowns')}</span>
                <span className="hero-stat"><ShieldCheck size={13} aria-hidden="true" /> {t('home.statSources')}</span>
                <span className="hero-stat"><Users size={13} aria-hidden="true" /> {t('home.statData')}</span>
              </div>
              <p className="hero-note">{t('home.heroNote')}</p>
            </Reveal>

            <Reveal delay={140} style={{ position: 'relative' }}>
              <Suspense fallback={<SceneFallback />}>
                <Island3D />
              </Suspense>
              <div className="scene-fact">
                <strong>6 / 6</strong>
                <span>{t('home.sceneFact')}</span>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------- Platform ticker ---------------------- */}
      <div className="ticker">
        <div className="ticker-track">
          {[0, 1].map((copy) => (
            <div className="ticker-group" key={copy} aria-hidden={copy === 1 ? 'true' : undefined}>
              {(TICKERS[lang] || TICKERS.en).map((item) => (
                <span className="ticker-item" key={`${copy}-${item.label}`}>
                  <item.icon size={13} aria-hidden="true" /> {item.label}
                  <span className="ticker-dot" aria-hidden="true" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ----------------------------- Search ---------------------------- */}
      <section className="search-band" aria-labelledby="home-search-heading">
        <div className="container">
          <Reveal style={{ maxWidth: 780, margin: '0 auto' }}>
            <h2 id="home-search-heading" className="text-center" style={{ marginBottom: 'var(--space-3)' }}>
              {t('home.searchTitle')}
            </h2>
            <form
              role="search"
              onSubmit={(event) => {
                event.preventDefault()
                if (term.trim().length < 2) return
                navigate(`/search${query({ q: term.trim() })}`)
              }}
            >
              <div className="search-field">
                <Search size={18} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                <label className="sr-only" htmlFor="home-search">Search government services, offices, announcements and projects</label>
                <input
                  id="home-search"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder={t('home.searchPlaceholder')}
                  maxLength={120}
                />
                <Button type="submit">{t('home.searchButton')}</Button>
              </div>
            </form>
            <div className="row" style={{ marginTop: 'var(--space-3)', gap: '0.4rem' }}>
              <span className="text-xs text-muted">{t('home.suggested')}</span>
              {(SUGGESTED[lang] || SUGGESTED.en).map((suggestion) => (
                <Link key={suggestion} className="pill" to={`/search?q=${encodeURIComponent(suggestion)}`}>
                  {suggestion}
                </Link>
              ))}
            </div>
            <p className="help text-center mt-2">{t('home.searchHelp')}</p>
          </Reveal>
        </div>
      </section>

      {/* --------------------------- Quick access ------------------------ */}
      {isEnabled('quick_access') ? (
        <section className="section" aria-labelledby="quick-access-heading">
          <div className="container">
            <SectionHeading
              eyebrow={t('home.quickEyebrow')}
              title={lang === 'fil' ? t('home.quickTitle') : sections.quick_access?.title || t('home.quickTitle')}
              description={lang === 'fil' ? t('home.quickDescription') : sections.quick_access?.subtitle || t('home.quickDescription')}
            />
            <div className="bento">
              <Reveal style={{ gridColumn: 'span 2', gridRow: 'span 2', display: 'flex' }}>
                <Link to={QUICK_ACCESS[0].to} className="bento-feature w-full">
                  <div className="card-icon" aria-hidden="true"><FileText size={22} /></div>
                  <div>
                    <h3>{t('home.quickFeatureTitle')}</h3>
                    <p>{t('home.quickFeatureText')}</p>
                  </div>
                  <span className="bento-go">{t('home.quickOpen')} <ArrowRight size={14} aria-hidden="true" /></span>
                </Link>
              </Reveal>
              {QUICK_ACCESS.slice(1).map((item, index) => (
                <Reveal key={item.title} delay={60 + index * 40}>
                  <Link to={item.to} className="card card-interactive card-link" style={{ height: '100%' }}>
                    <div className="card-icon" aria-hidden="true"><item.icon size={20} /></div>
                    <h3 style={{ fontSize: '1rem' }}>{lang === 'fil' ? item.titleFil : item.title}</h3>
                    <p>{item.description}</p>
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---------------------------- The province ----------------------- */}
      <section className="section section-alt" aria-labelledby="province-heading">
        <div className="container">
          <div className="split">
            <Reveal className="split-copy">
              <div className="eyebrow">{t('home.provinceEyebrow')}</div>
              <h2 id="province-heading">{t('home.provinceTitle')}</h2>
              <p>{t('home.provinceBody')}</p>
              <ul className="town-list">
                {TOWNS.map((town, index) => (
                  <li key={town}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <Link to={`/municipalities/${town.toLowerCase().replace(' ', '-')}`}>{town}</Link>
                  </li>
                ))}
              </ul>
              <div className="row mt-4">
                <Link className="btn btn-primary" to="/municipalities">
                  {t('home.provinceCta')} <ArrowRight size={15} aria-hidden="true" />
                </Link>
                <Link className="btn btn-ghost" to="/municipal-search">
                  {t('home.provinceSearch')}
                </Link>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="stat-strip" style={{ marginBottom: '1rem' }}>
                <div>
                  <strong><CountUp value={6} /></strong>
                  <span>{t('home.statMunicipalities')}</span>
                </div>
                <div>
                  <strong><CountUp value={categoryCount} /></strong>
                  <span>{t('home.statGroups')}</span>
                </div>
                <div>
                  <strong>0</strong>
                  <span>{t('home.statInvented')}</span>
                </div>
                <div>
                  <strong><CountUp value={100} suffix="%" /></strong>
                  <span>{t('home.statSourced')}</span>
                </div>
              </div>
              <div className="island-figure">
                <svg viewBox="0 0 400 320" role="img" aria-label="Decorative contour-line illustration of a heart-shaped island with six marker points." style={{ width: '100%', height: '100%', display: 'block' }}>
                  <defs>
                    <radialGradient id="islandGlow" cx="50%" cy="40%" r="60%">
                      <stop offset="0%" stopColor="#2f7d74" stopOpacity="0.55" />
                      <stop offset="100%" stopColor="#08201f" stopOpacity="0" />
                    </radialGradient>
                  </defs>
                  <rect width="400" height="320" fill="#08201f" />
                  <circle cx="200" cy="150" r="150" fill="url(#islandGlow)" />
                  {[0.62, 0.74, 0.86, 0.98, 1.1, 1.22].map((scale, index) => (
                    <path
                      key={scale}
                      d="M200 236 C150 196 96 168 96 124 C96 92 122 74 150 74 C172 74 188 86 200 104 C212 86 228 74 250 74 C278 74 304 92 304 124 C304 168 250 196 200 236 Z"
                      fill="none"
                      stroke="#8fd9c6"
                      strokeOpacity={0.5 - index * 0.06}
                      strokeWidth={index === 1 ? 1.4 : 0.8}
                      transform={`translate(200 155) scale(${scale}) translate(-200 -155)`}
                    />
                  ))}
                  <path
                    d="M200 236 C150 196 96 168 96 124 C96 92 122 74 150 74 C172 74 188 86 200 104 C212 86 228 74 250 74 C278 74 304 92 304 124 C304 168 250 196 200 236 Z"
                    fill="#1f5a45"
                    fillOpacity="0.55"
                    stroke="#e3c187"
                    strokeWidth="1.2"
                  />
                  {[
                    [168, 108], [232, 108], [142, 140], [258, 140], [178, 178], [224, 186],
                  ].map(([cx, cy], index) => (
                    <g key={`${cx}-${cy}`}>
                      <circle cx={cx} cy={cy} r="12" fill="none" stroke="#ffd8a0" strokeOpacity="0.28" />
                      <circle cx={cx} cy={cy} r="3.4" fill="#ffd8a0">
                        <animate attributeName="opacity" values="0.45;1;0.45" dur={`${3 + index * 0.4}s`} repeatCount="indefinite" />
                      </circle>
                    </g>
                  ))}
                </svg>
                <figcaption>{lang === 'fil' ? 'Ilustrasyon lamang · hindi sukat na mapa' : 'Illustrative only · not a map to scale'}</figcaption>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------- Service categories -------------------- */}
      {isEnabled('services') ? (
        <section className="section" aria-labelledby="service-categories-heading">
          <div className="container">
            <SectionHeading
              eyebrow={t('home.servicesEyebrow')}
              title={lang === 'fil' ? t('home.servicesTitle') : sections.services?.title || t('home.servicesTitle')}
              description="Service groups built from published records. Categories with no published service information are labelled honestly, never filled with invented services."
              action={<Link className="btn btn-outline" to="/services">Browse all services <ArrowRight size={15} aria-hidden="true" /></Link>}
            />
            {categoriesLoading ? (
              <SkeletonList count={4} height={130} />
            ) : (
              <>
                <div className="grid grid-4">
                  {(categories?.featured?.length ? categories.featured : categories?.results || []).slice(0, 8).map((category, index) => (
                    <Reveal key={category.slug} delay={index * 45}>
                      <Link
                        to={`/services/category/${category.slug}`}
                        className="card card-interactive card-link"
                        style={{ height: '100%' }}
                      >
                        <div className="card-icon" aria-hidden="true"><CategoryIcon name={category.icon} /></div>
                        <h3 style={{ fontSize: '1rem' }}>{category.name}</h3>
                        <p>{category.description}</p>
                        <div className="card-actions">
                          <span className="badge badge-neutral">
                            {Number(category.total_service_count ?? category.service_count) === 0
                              ? 'No published services yet'
                              : `${category.total_service_count ?? category.service_count} published service${Number(category.total_service_count ?? category.service_count) === 1 ? '' : 's'}`}
                          </span>
                          {category.children?.length ? (
                            <span className="text-xs text-muted">{category.children.length} subcategories</span>
                          ) : null}
                        </div>
                      </Link>
                    </Reveal>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 'var(--space-4)', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <Link className="btn btn-ghost btn-sm" to="/services/categories">All {categoryCount} categories</Link>
                  <Link className="btn btn-ghost btn-sm" to="/service-coverage">Coverage by municipality</Link>
                  <Link className="btn btn-ghost btn-sm" to="/developers">Open data API</Link>
                </div>
              </>
            )}
          </div>
        </section>
      ) : null}

      {/* --------------------------- Municipalities ---------------------- */}
      {isEnabled('municipalities') ? (
        <section className="section section-alt" aria-labelledby="municipalities-heading">
          <div className="container">
            <SectionHeading
              eyebrow={t('home.municipalitiesEyebrow')}
              title={lang === 'fil' ? t('home.municipalitiesTitle') : sections.municipalities?.title || t('home.municipalitiesTitle')}
              description="Boac, Mogpog, Gasan, Buenavista, Torrijos and Santa Cruz. Facts are shown only when verified."
              action={<Link className="btn btn-outline" to="/municipalities">All municipalities <ArrowRight size={15} aria-hidden="true" /></Link>}
            />
            {municipalitiesLoading ? (
              <SkeletonList count={3} />
            ) : (
              <div className="grid grid-3">
                {(municipalities?.results || []).map((municipality, index) => (
                  <Reveal key={municipality.slug} delay={index * 50}>
                    <MunicipalityCard municipality={municipality} />
                  </Reveal>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* ---------------------------- Announcements ---------------------- */}
      {isEnabled('announcements') ? (
        <section className="section" aria-labelledby="announcements-heading">
          <div className="container">
            <SectionHeading
              eyebrow={t('home.announcementsEyebrow')}
              title={lang === 'fil' ? t('home.announcementsTitle') : sections.announcements?.title || t('home.announcementsTitle')}
              description={sections.announcements?.subtitle || 'Published public information and community updates.'}
              action={<Link className="btn btn-outline" to="/announcements">View all announcements <ArrowRight size={15} aria-hidden="true" /></Link>}
            />
            {announcementsLoading ? (
              <SkeletonList count={3} height={220} />
            ) : announcements?.results?.length ? (
              <div className="grid grid-3">
                {announcements.results.map((announcement, index) => (
                  <Reveal key={announcement.id} delay={index * 60}>
                    <AnnouncementCard announcement={announcement} />
                  </Reveal>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Megaphone}
                title="No announcements published yet"
                description="Verified public announcements will appear here once they pass the publication and verification workflow. BetterGo does not invent announcements to fill this space."
                action={<Link className="btn btn-outline" to="/contact">Submit information for review</Link>}
              />
            )}
          </div>
        </section>
      ) : null}

      {/* ---------------------------- Transparency ----------------------- */}
      {isEnabled('transparency') ? (
        <section className="section section-alt" aria-labelledby="transparency-heading">
          <div className="container">
            <SectionHeading
              eyebrow={t('home.transparencyEyebrow')}
              title={lang === 'fil' ? t('home.transparencyTitle') : sections.transparency?.title || t('home.transparencyTitle')}
              description={
                sections.transparency?.subtitle ||
                'Access public information and follow the progress of development initiatives across Marinduque.'
              }
              action={<Link className="btn btn-outline" to="/transparency">Explore transparency <ArrowRight size={15} aria-hidden="true" /></Link>}
            />
            <div className="grid grid-4">
              {[
                ['Budget information', 'Published budget records with their original source.', transparency?.counts?.budget, '/transparency?category=budget'],
                ['Expenditure reports', 'Expenditure records, stored to the centavo.', transparency?.counts?.expenditure, '/transparency?category=expenditure'],
                ['Procurement', 'Bids, awards and procurement notices.', transparency?.counts?.procurement, '/transparency?category=procurement'],
                ['Public documents', 'Downloadable documents and accountability reports.', transparency?.counts?.documents, '/transparency/documents'],
              ].map(([title, description, count, to], index) => (
                <Reveal key={title} delay={index * 50}>
                  <TransparencyCard title={title} description={description} count={count} to={to} />
                </Reveal>
              ))}
            </div>
            {transparency && Number(transparency.counts?.budget) + Number(transparency.counts?.expenditure) === 0 ? (
              <p className="help mt-3">
                No verified financial records have been published yet. Charts and totals are only displayed when supported by real
                records — BetterGo never publishes sample financial figures.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ------------------------------ Projects ------------------------- */}
      {isEnabled('projects') ? (
        <section className="section" aria-labelledby="projects-heading">
          <div className="container">
            <SectionHeading
              eyebrow={t('home.projectsEyebrow')}
              title={lang === 'fil' ? t('home.projectsTitle') : sections.projects?.title || t('home.projectsTitle')}
              description="Infrastructure and development information will be published with verified source references."
            />
            <div className="grid grid-3">
              <Reveal><ProjectCardPlaceholder /></Reveal>
              <Reveal delay={70}>
                <div className="card" style={{ height: '100%' }}>
                  <div className="card-icon" aria-hidden="true"><Building2 size={22} /></div>
                  <h3>Government directory</h3>
                  <p>Find provincial, municipal and national offices with verified public contact details.</p>
                  <div className="card-actions">
                    <Link className="btn btn-outline btn-sm" to="/government-directory">Open directory</Link>
                  </div>
                </div>
              </Reveal>
              <Reveal delay={140}>
                <div className="card" style={{ height: '100%' }}>
                  <div className="card-icon" aria-hidden="true"><Gauge size={22} /></div>
                  <h3>Public documents</h3>
                  <p>Download published budget, procurement and accountability documents.</p>
                  <div className="card-actions">
                    <Link className="btn btn-outline btn-sm" to="/transparency/documents">Browse documents</Link>
                  </div>
                </div>
              </Reveal>
            </div>
            {directory?.results?.length ? (
              <div className="mt-5">
                <SectionHeading eyebrow="Directory" title="Recently added offices" />
                <div className="grid grid-3">
                  {directory.results.slice(0, 3).map((office) => (
                    <Link key={office.id} to={`/government-directory/${office.slug}`} className="card card-interactive card-link">
                      <h3 style={{ fontSize: '1rem' }}>{office.name}</h3>
                      <p>{office.description || 'Office information is being verified.'}</p>
                      <div className="card-meta">{office.municipality_name || 'Province-wide'}</div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* --------------------------- Participation ----------------------- */}
      {isEnabled('participation') ? (
        <section className="section section-alt" aria-labelledby="participation-heading">
          <div className="container">
            <SectionHeading
              eyebrow={t('home.participationEyebrow')}
              title={lang === 'fil' ? t('home.participationTitle') : sections.participation?.title || t('home.participationTitle')}
              description={
                sections.participation?.subtitle ||
                'Help improve public information and community participation by sharing feedback, suggestions, and concerns.'
              }
            />
            <div className="grid grid-4">
              {[
                { title: 'Submit feedback', text: 'Tell us what is useful or confusing.', to: '/contact?kind=feedback', icon: Megaphone },
                { title: 'Report a public concern', text: 'Flag incorrect or outdated information.', to: '/contact?kind=concern', icon: AlertTriangle },
                { title: 'Share a suggestion', text: 'Suggest information that should be published.', to: '/contact?kind=suggestion', icon: Sparkles },
                { title: 'Public consultations', text: 'Participation opportunities will be published here.', to: '/announcements?category=public-consultations', icon: Users },
              ].map((item, index) => (
                <Reveal key={item.title} delay={index * 50}>
                  <Link to={item.to} className="card card-interactive card-link" style={{ height: '100%' }}>
                    <div className="card-icon" aria-hidden="true"><item.icon size={22} /></div>
                    <h3 style={{ fontSize: '1rem' }}>{item.title}</h3>
                    <p>{item.text}</p>
                    <div className="card-actions"><span className="text-xs" style={{ color: 'var(--clay)', fontWeight: 800 }}>Continue <ArrowRight size={12} aria-hidden="true" /></span></div>
                  </Link>
                </Reveal>
              ))}
            </div>
            <p className="help mt-4">
              Submitting a report through BetterGo does not create an official government case or guarantee government action.
              BetterGo is an independent digital initiative.
            </p>
          </div>
        </section>
      ) : null}

      {/* ----------------------------- Emergency ------------------------- */}
      {isEnabled('emergency') ? (
        <section className="section" aria-labelledby="emergency-heading">
          <div className="container">
            <SectionHeading
              eyebrow={t('home.emergencyEyebrow')}
              title={lang === 'fil' ? t('home.emergencyTitle') : sections.emergency?.title || t('home.emergencyTitle')}
              description="Verified emergency contacts. Always contact official emergency services directly in an emergency."
              action={<Link className="btn btn-danger" to="/emergency">All emergency information</Link>}
            />
            <div className={`grid ${verifiedEmergency.length >= 3 ? 'grid-3' : 'grid-2'}`}>
              {verifiedEmergency.length ? (
                verifiedEmergency.map((contact) => (
                  <div key={contact.id} className="card" style={{ borderLeft: '3px solid var(--danger)' }}>
                    <div className="badge badge-danger"><AlertTriangle size={11} aria-hidden="true" /> Verified contact</div>
                    <h3 style={{ marginTop: '0.35rem' }}>{contact.organization_name}</h3>
                    <div className="emergency-number">
                      <a className="tel-link" href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`}>{contact.phone}</a>
                    </div>
                    <p className="text-xs text-muted">{contact.description}</p>
                  </div>
                ))
              ) : (
                <EmptyState
                  icon={AlertTriangle}
                  title="No municipal emergency contacts verified yet"
                  description="Only verified contact numbers are shown here. Until local numbers are verified, contact national emergency services directly."
                  action={<a className="btn btn-danger" href="tel:911">Call 911 (national emergency hotline)</a>}
                />
              )}
              <div className="callout-emergency">
                <strong style={{ display: 'block', marginBottom: '0.35rem' }}>In a life-threatening emergency</strong>
                <p className="text-sm" style={{ color: 'inherit' }}>
                  Call the national emergency hotline <a href="tel:911" style={{ color: 'inherit', fontWeight: 800 }}>911</a>. BetterGo does
                  not replace official emergency services or emergency communication channels.
                </p>
                <div className="row mt-3">
                  <Link className="btn btn-outline btn-sm" to="/emergency">Emergency directory</Link>
                  <Link className="btn btn-outline btn-sm" to="/emergency/hospitals">Hospitals</Link>
                  <Link className="btn btn-outline btn-sm" to="/emergency/police">Police</Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ------------------------------- About --------------------------- */}
      {isEnabled('about') ? (
        <section className="section section-alt" aria-labelledby="about-heading">
          <div className="container">
            <div className="grid grid-2" style={{ alignItems: 'center', gap: 'var(--space-6)' }}>
              <Reveal>
                <div className="eyebrow">{t('home.aboutEyebrow')}</div>
                <h2 id="about-heading" style={{ margin: '0.4rem 0 var(--space-3)' }}>
                  {lang === 'fil' ? t('home.aboutTitle') : sections.about?.title || t('home.aboutTitle')}
                </h2>
                <p className="text-muted">
                  {sections.about?.subtitle ||
                    'BetterGo Marinduque is an independent, community-driven digital initiative designed to make public information more accessible, encourage transparency, and support meaningful civic participation throughout the province.'}
                </p>
                <div className="row mt-4">
                  <Link className="btn btn-primary" to="/about">About BetterGo <ArrowRight size={15} aria-hidden="true" /></Link>
                  <Link className="btn btn-outline" to="/disclaimer">Read the disclaimer</Link>
                </div>
              </Reveal>
              <div className="grid grid-2">
                {[
                  { icon: FileText, title: 'Accessible information', text: 'Public service information in one place.' },
                  { icon: ShieldCheck, title: 'Verification status', text: 'Every record shows its source.' },
                  { icon: Landmark, title: 'Transparency', text: 'Published documents and records.' },
                  { icon: Users, title: 'Participation', text: 'Feedback and correction channels.' },
                ].map((item, index) => (
                  <Reveal key={item.title} delay={index * 60}>
                    <div className="card" style={{ height: '100%' }}>
                      <div className="card-icon" aria-hidden="true"><item.icon size={20} /></div>
                      <h3 style={{ fontSize: '0.98rem' }}>{item.title}</h3>
                      <p>{item.text}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* -------------------------------- CTA --------------------------- */}
      <section className="section-tight">
        <div className="cta-band">
          <div className="container text-center">
            <Reveal>
              <div className="eyebrow" style={{ color: 'var(--sand)', justifyContent: 'center' }}>{t('home.ctaEyebrow')}</div>
              <h2 style={{ margin: '0.5rem 0 var(--space-2)' }}>{t('home.ctaTitle')}</h2>
              <p className="text-muted" style={{ maxWidth: 640, margin: '0 auto var(--space-4)' }}>
                {t('home.ctaText')}
              </p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <Link className="btn btn-primary btn-lg" to="/services">{t('home.ctaExplore')}</Link>
                {user ? (
                  <Link className="btn btn-outline btn-lg" to="/dashboard">{t('home.ctaDashboard')}</Link>
                ) : (
                  <Link className="btn btn-outline btn-lg" to="/register">{t('home.ctaRegister')}</Link>
                )}
              </div>
              <p className="help mt-3">{t('home.ctaHelp')}</p>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  )
}
