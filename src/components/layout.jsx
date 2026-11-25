import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Accessibility,
  AlertTriangle,
  AlertCircle,
  Archive,
  UserCheck,
  CalendarDays,
  Wallet,
  Compass,
  LifeBuoy,
  ArrowRight,
  Bell,
  Building2,
  ChevronDown,
  Download,
  ChevronRight,
  Code2,
  FileText,
  Inbox,
  Gauge,
  Layers,
  MessageSquare,
  Upload,
  HeartHandshake,
  Landmark,
  Languages,
  FileDown,
  UserX,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Menu,
  PenLine,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  User,
  Users,
  X,
  MapPin,
  Globe,
  ClipboardList,
  History,
  FolderLock,
} from 'lucide-react'
import { useAuth } from '../auth'
import { api, initials } from '../api'
import { SearchAutocomplete } from './search'
import { Badge, Button } from './ui'
import { ScrollProgress } from './motion'
import { useLang, useT } from '../i18n'

/* ------------------------------- Theme toggle ----------------------------- */
export function ThemeToggle() {
  const [mode, setMode] = useState(() => localStorage.getItem('bg-theme') || 'system')
  const { profile, user, refresh } = useAuth()

  const apply = (next) => {
    setMode(next)
    localStorage.setItem('bg-theme', next)
    const dark = next === 'dark' || (next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : ''
  }

  useEffect(() => {
    if (profile?.display_preference) {
      setMode((current) => {
        if (current === profile.display_preference) return current
        return current
      })
    }
  }, [profile?.display_preference])

  const next = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light'
  const label = mode === 'light' ? 'Light theme' : mode === 'dark' ? 'Dark theme' : 'System theme'

  const toggle = async () => {
    apply(next)
    if (user) {
      try {
        await api.put('/account/preferences', { display: next })
        refresh()
      } catch {
        /* preference still applies locally */
      }
    }
  }

  return (
    <button type="button" className="btn-icon" onClick={toggle} aria-label={`${label}. Switch to ${next} theme.`} title={`${label} — click to switch`}>
      {mode === 'dark' ? <Moon size={18} /> : mode === 'system' ? <Sun size={18} opacity={0.6} /> : <Sun size={18} />}
    </button>
  )
}

/* ---------------------------- Language toggle ----------------------------- */
export function LanguageToggle() {
  const { lang, toggle, t } = useLang()
  return (
    <button
      type="button"
      className="lang-toggle"
      onClick={toggle}
      aria-label={t('shell.switchLang', 'Switch to Filipino')}
      title={t('shell.switchLang', 'Switch to Filipino')}
    >
      <Globe size={14} aria-hidden="true" />
      <span>{lang === 'fil' ? 'FIL' : 'EN'}</span>
    </button>
  )
}

/* ---------------------------------- Nav data ------------------------------ */
const NAV = [
  { key: 'nav.home', label: 'Home', to: '/' },
  {
    key: 'nav.services',
    label: 'Government Services',
    to: '/services',
    children: [
      { key: 'nav.browseServices', label: 'Browse Services', to: '/services', icon: FileText, description: 'Categories, requirements and procedures' },
      { key: 'nav.serviceCategories', label: 'Service Categories', to: '/services/categories', icon: Layers, description: 'All 25 service groups and their subcategories' },
      { key: 'nav.serviceCoverage', label: 'Municipality Coverage', to: '/service-coverage', icon: MapPin, description: 'Which services are recorded for each town' },
      { key: 'nav.formsResources', label: 'Forms & Resources', to: '/resources', icon: FileText, description: 'Approved forms and application links' },
      { key: 'nav.serviceFaqs', label: 'Service FAQs', to: '/faqs', icon: FileText, description: 'Questions recorded for specific services' },
      { key: 'nav.offices', label: 'Government Offices', to: '/government-directory', icon: Building2, description: 'Provincial, municipal and national offices' },
      { key: 'nav.developerApi', label: 'Developer API', to: '/developers', icon: Code2, description: 'Read-only access to published service data' },
    ],
  },
  {
    key: 'nav.municipalities',
    label: 'Municipalities',
    to: '/municipalities',
    children: [
      { key: 'nav.allMunicipalities', label: 'All municipalities', to: '/municipalities', icon: MapPin },
      { label: 'Boac', to: '/municipalities/boac' },
      { label: 'Mogpog', to: '/municipalities/mogpog' },
      { label: 'Gasan', to: '/municipalities/gasan' },
      { label: 'Buenavista', to: '/municipalities/buenavista' },
      { label: 'Torrijos', to: '/municipalities/torrijos' },
      { label: 'Santa Cruz', to: '/municipalities/santa-cruz' },
    ],
  },
  {
    key: 'nav.transparency',
    label: 'Transparency',
    to: '/transparency',
    children: [
      { key: 'nav.overview', label: 'Overview', to: '/transparency', icon: Gauge, description: 'What has been published so far' },
      { key: 'nav.budget', label: 'Finance and budgets', to: '/transparency/finance', icon: Landmark, description: 'Budget explorer and all 17 financial modules' },
      { key: 'nav.monitoring', label: 'Financial monitoring', to: '/transparency/financial-monitoring', icon: ShieldCheck, description: 'Approved data-quality observations' },
      { key: 'nav.reports', label: 'Reports and open data', to: '/transparency/reports', icon: FileText, description: 'Build reports or download approved datasets' },
      { key: 'nav.alerts', label: 'Transparency alerts', to: '/transparency/alerts', icon: Bell, description: 'Follow published updates' },
      { key: 'nav.community', label: 'Community questions', to: '/transparency/community', icon: MessageSquare, description: 'Moderated public discussion' },
      { key: 'nav.documents', label: 'Public documents', to: '/transparency/documents', icon: FolderLock },
      { key: 'nav.procurement', label: 'Procurement information', to: '/transparency?category=procurement', icon: ClipboardList },
    ],
  },
  { key: 'nav.announcements', label: 'Announcements', to: '/announcements' },
  { key: 'nav.emergency', label: 'Emergency', to: '/emergency', icon: AlertTriangle },
  {
    key: 'nav.about',
    label: 'About',
    to: '/about',
    children: [
      { key: 'nav.aboutBettergo', label: 'About BetterGo', to: '/about', icon: ShieldCheck, description: 'Independent civic initiative' },
      { key: 'nav.contact', label: 'Contact', to: '/contact' },
      { key: 'nav.privacyPolicy', label: 'Privacy Policy', to: '/privacy-policy' },
      { key: 'nav.terms', label: 'Terms of Use', to: '/terms-of-use' },
      { key: 'nav.disclaimer', label: 'Disclaimer', to: '/disclaimer' },
    ],
  },
]

const ADMIN_NAV = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', to: '/admin', icon: LayoutDashboard, permission: 'content.view' },
      { label: 'Analytics', to: '/admin/analytics', icon: Gauge, permission: 'province.analytics.view' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { label: 'Users', to: '/admin/users', icon: Users, permission: 'users.view' },
      { label: 'Roles & permissions', to: '/admin/roles', icon: ShieldCheck, permission: 'roles.view' },
      { label: 'Municipalities', to: '/admin/municipalities', icon: MapPin, permission: 'municipalities.view' },
      { label: 'Directory', to: '/admin/directory', icon: Building2, permission: 'directory.view' },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: 'Announcements', to: '/admin/announcements', icon: Bell, permission: 'announcements.view' },
      { label: 'Service management', to: '/admin/services', icon: FileText, permission: 'services.view' },
      { label: 'Service categories', to: '/admin/service-categories', icon: Layers, permission: 'services.categories.view' },
      { label: 'Service feedback', to: '/admin/service-feedback', icon: MessageSquare, permission: 'services.feedback.moderate' },
      { label: 'Digital forms', to: '/admin/forms', icon: FileText, permission: 'services.view' },
      { label: 'BetterGo submissions', to: '/admin/applications', icon: Inbox, permission: 'services.view' },
      { label: 'Records management', to: '/admin/records', icon: Archive, permission: 'services.view' },
      { label: 'Notifications', to: '/admin/notifications', icon: Bell, permission: 'announcements.view' },
      { label: 'Support desk', to: '/admin/support', icon: LifeBuoy, permission: 'reports.view' },
      { label: 'Feedback and surveys', to: '/admin/feedback', icon: MessageSquare, permission: 'reports.view' },
      { label: 'Privacy administration', to: '/admin/privacy-requests', icon: ShieldCheck, permission: 'privacy.requests.manage' },
      { label: 'Service discovery', to: '/admin/service-discovery', icon: Compass, permission: 'services.view' },
      { label: 'Service requirements', to: '/admin/service-requirements', icon: ClipboardList, permission: 'services.view' },
      { label: 'Appointments', to: '/admin/appointments', icon: CalendarDays, permission: 'services.view' },
      { label: 'Payments and fees', to: '/admin/payments', icon: Wallet, permission: 'services.view' },
      { label: 'Document requests', to: '/admin/document-requests', icon: FileText, permission: 'services.view' },
      { label: 'Complaint cases', to: '/admin/complaints', icon: AlertCircle, permission: 'reports.view' },
      { label: 'Identity review', to: '/admin/identity-verifications', icon: UserCheck, permission: 'municipality_users.manage' },
      { label: 'Consent and signatures', to: '/admin/consent', icon: PenLine, permission: 'municipality_users.manage' },
      { label: 'Accessibility and inclusive services', to: '/admin/personalization', icon: Accessibility, permission: 'services.view' },
      { label: 'Offline service packs', to: '/admin/offline-packs', icon: Download, permission: 'services.view' },
      { label: 'Language access', to: '/admin/translations', icon: Languages, permission: 'services.view' },
      { label: 'Account closure requests', to: '/admin/closure-requests', icon: FileDown, permission: 'municipality_users.manage' },
      { label: 'Security monitoring', to: '/admin/security', icon: ShieldCheck, permission: 'municipality_users.manage' },
      { label: 'Service journey templates', to: '/admin/service-journeys', icon: Compass, permission: 'services.view' },
      { label: 'Data export queue', to: '/admin/data-exports', icon: FileDown, permission: 'privacy.requests.manage' },
      { label: 'Account deletion and retention', to: '/admin/account-deletion', icon: UserX, permission: 'municipality_users.manage' },
      { label: 'Consent requests', to: '/admin/consent-requests', icon: FileCheck2, permission: 'privacy.requests.manage' },
      { label: 'Sources & verification', to: '/admin/service-sources', icon: ShieldCheck, permission: 'services.sources.manage' },
      { label: 'Service import/export', to: '/admin/service-import', icon: Upload, permission: 'services.import' },
      { label: 'Transparency', to: '/admin/transparency', icon: Landmark, permission: 'transparency.view' },
      { label: 'Financial transparency', to: '/admin/transparency/finance', icon: Landmark, permission: 'transparency.view' },
      { label: 'Financial monitoring', to: '/admin/transparency/financial-monitoring', icon: ShieldCheck, permission: 'transparency.view' },
      { label: 'Transparency reports', to: '/admin/transparency/reports', icon: FileText, permission: 'transparency.view' },
      { label: 'Open data repository', to: '/admin/transparency/open-data', icon: FileDown, permission: 'transparency.view' },
      { label: 'Transparency alerts', to: '/admin/transparency/alerts', icon: Bell, permission: 'transparency.view' },
      { label: 'Community moderation', to: '/admin/transparency/community', icon: MessageSquare, permission: 'transparency.view' },
      { label: 'Emergency', to: '/admin/emergency', icon: AlertTriangle, permission: 'emergency.view' },
      { label: 'Pages & FAQs', to: '/admin/cms', icon: FileText, permission: 'cms.manage' },
    ],
  },
  {
    label: 'Participation',
    items: [
      { label: 'Reports & corrections', to: '/admin/reports', icon: HeartHandshake, permission: 'reports.view' },
      { label: 'Privacy requests', to: '/admin/privacy', icon: ShieldCheck, permission: 'privacy.requests.manage' },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Audit logs', to: '/admin/audit-logs', icon: FileText, permission: 'audit_logs.view' },
      { label: 'Settings', to: '/admin/settings', icon: Settings, permission: 'settings.manage' },
      { label: 'My profile', to: '/admin/profile', icon: User },
    ],
  },
]

/* --------------------------------- Header -------------------------------- */
function DesktopDropdown({ item }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname, location.search])

  useEffect(() => {
    if (!open) return undefined
    const onClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)

  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        className={`nav-link ${active ? 'is-active' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
      >
        {t(item.key, item.label)}
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div className="dropdown-panel" role="menu" onMouseLeave={() => setOpen(false)}>
          {item.children.map((child) =>
            child.disabled ? (
              <div key={child.label} className="dropdown-item" aria-disabled="true" style={{ opacity: 0.6 }}>
                {child.label} <span>Coming soon</span>
              </div>
            ) : (
              <Link key={child.label + child.to} className="dropdown-item" to={child.to} role="menuitem">
                {t(child.key, child.label)}
                {child.description ? <span>{child.description}</span> : null}
              </Link>
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}

function UserMenu() {
  const { user, profile, logout, roles } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return undefined
    const onClick = (event) => ref.current && !ref.current.contains(event.target) && setOpen(false)
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const isAdmin = roles.some((role) => ['government_employee', 'municipal_admin', 'provincial_admin', 'content_editor', 'super_admin'].includes(role))

  return (
    <div className="dropdown" ref={ref}>
      <button type="button" className="btn-icon" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen((v) => !v)}>
        <span className="avatar" style={{ width: 32, height: 32, fontSize: '0.7rem' }}>
          {profile?.profile_photo ? <img src={profile.profile_photo} alt="" /> : initials(user?.name)}
        </span>
      </button>
      {open ? (
        <div className="dropdown-panel align-right" role="menu">
          <div style={{ padding: '0.5rem 0.7rem' }}>
            <strong style={{ fontSize: '0.875rem', display: 'block' }}>{user.name}</strong>
            <span className="text-xs text-muted break-word">{user.email}</span>
          </div>
          <div className="dropdown-sep" />
          <Link className="dropdown-item" to="/dashboard" role="menuitem">My dashboard</Link>
          <Link className="dropdown-item" to="/dashboard/profile" role="menuitem">My profile</Link>
          <Link className="dropdown-item" to="/dashboard/saved" role="menuitem">Saved services</Link>
          <Link className="dropdown-item" to="/dashboard/privacy" role="menuitem">Privacy &amp; data</Link>
          {isAdmin ? <Link className="dropdown-item" to="/admin">Administration</Link> : null}
          <div className="dropdown-sep" />
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={async () => {
              await logout()
              navigate('/')
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}

function SearchOverlay({ open, onClose }) {
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Search BetterGo Marinduque"
        style={{ width: 'min(680px, 100%)', overflow: 'visible' }}
      >
        <SearchAutocomplete
          autoFocus
          inputId="header-search-input"
          label="Search BetterGo Marinduque"
          onSubmit={(term) => {
            onClose()
            navigate(`/search?q=${encodeURIComponent(term)}`)
          }}
          onNavigate={onClose}
        />
        <p className="help mt-3">
          Search services, categories, forms, service questions, offices, announcements and public information. Press{' '}
          <kbd>Esc</kbd> to close.
        </p>
      </div>
    </div>
  )
}

function MobileNav({ open, onClose }) {
  const { user, isAdmin, logout } = useAuth()
  const t = useT()
  const [expanded, setExpanded] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="mobile-drawer">
      <button className="mobile-backdrop" aria-label="Close menu" onClick={onClose} />
      <div className="mobile-panel" role="dialog" aria-modal="true" aria-label="Main menu">
        <div className="row-between" style={{ marginBottom: '0.5rem' }}>
          <Link to="/" className="brand" onClick={onClose}>
            <img src="/brand/mark.svg" alt="" width="34" height="34" />
            <span className="brand-text">
              <span className="brand-name">BetterGo</span>
              <span className="brand-sub">Marinduque</span>
            </span>
          </Link>
          <div className="row" style={{ gap: '0.3rem' }}>
            <LanguageToggle />
            <button className="btn-icon" onClick={onClose} aria-label="Close menu"><X size={20} /></button>
          </div>
        </div>

        <nav aria-label="Mobile navigation">
          {NAV.map((item) =>
            item.children ? (
              <div className="mobile-group" key={item.label}>
                <button
                  type="button"
                  aria-expanded={expanded === item.label}
                  onClick={() => setExpanded(expanded === item.label ? '' : item.label)}
                >
                  {t(item.key, item.label)} <ChevronRight size={16} style={{ transform: expanded === item.label ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }} />
                </button>
                {expanded === item.label ? (
                  <div className="mobile-sub">
                    {item.children.filter((child) => !child.disabled).map((child) => (
                      <Link key={child.label + child.to} to={child.to} onClick={onClose}>{t(child.key, child.label)}</Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mobile-group" key={item.label}>
                <Link to={item.to} onClick={onClose} style={{ display: 'block', padding: '0.7rem 0.4rem', fontWeight: 650, color: 'var(--text)' }}>
                  {t(item.key, item.label)}
                </Link>
              </div>
            ),
          )}
        </nav>

        <div className="mobile-cta">
          {user ? (
            <>
              <Button variant="outline" onClick={() => { onClose(); navigate('/dashboard') }} icon={LayoutDashboard}>{t('shell.myDashboard', 'My dashboard')}</Button>
              {isAdmin ? <Button variant="secondary" onClick={() => { onClose(); navigate('/admin') }} icon={ShieldCheck}>{t('shell.administration', 'Administration')}</Button> : null}
              <Button variant="ghost" onClick={async () => { await logout(); onClose(); navigate('/') }} icon={LogOut}>{t('shell.signOut', 'Sign out')}</Button>
            </>
          ) : (
            <>
              <Button onClick={() => { onClose(); navigate('/login') }}>{t('shell.signIn', 'Sign in')}</Button>
              <Button variant="outline" onClick={() => { onClose(); navigate('/register') }}>{t('shell.signUp', 'Sign up')}</Button>
            </>
          )}
          <a className="btn btn-outline" href="tel:911" style={{ justifyContent: 'center' }}>
            <AlertTriangle size={16} aria-hidden="true" /> Emergency: 911
          </a>
        </div>
      </div>
    </div>
  )
}

export function Header({ minimal = false }) {
  const { user } = useAuth()
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const isActive = (to) => (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to))

  return (
    <>
      <ScrollProgress />
      <div className="disclaimer-bar">
        {t('shell.independent', 'Independent, community-driven initiative')} ·{' '}
        <Link to="/disclaimer">{t('shell.notOfficial', 'Not an official government website')}</Link>
      </div>
      <header className={`site-header ${scrolled ? 'is-scrolled' : ''}`.trim()}>
        <div className="container header-inner">
          <Link to="/" className="brand" aria-label="BetterGo Marinduque home">
            <img src="/brand/mark.svg" alt="" width="38" height="38" />
            <span className="brand-text">
              <span className="brand-name">BetterGo</span>
              <span className="brand-sub">Marinduque</span>
            </span>
          </Link>

          {!minimal ? (
            <nav className="main-nav" aria-label="Main navigation">
              {NAV.map((item) =>
                item.children ? (
                  <DesktopDropdown key={item.label} item={item} />
                ) : (
                  <NavLink key={item.label} to={item.to} end={item.to === '/'} className={() => `nav-link ${isActive(item.to) ? 'is-active' : ''}`}>
                    {t(item.key, item.label)}
                  </NavLink>
                ),
              )}
            </nav>
          ) : <span style={{ flex: 1 }} />}

          <div className="header-actions">
            <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)} aria-label={t('shell.searchLabel', 'Search (Control K)')}>
              <Search size={15} aria-hidden="true" />
              <span className="search-label">{t('shell.search', 'Search…')}</span>
            </button>
            <LanguageToggle />
            <ThemeToggle />
            {user ? (
              <>
                <NavLink to="/dashboard" className="btn-icon desktop-only" aria-label="My dashboard"><LayoutDashboard size={18} /></NavLink>
                <UserMenu />
              </>
            ) : (
              <div className="row desktop-only" style={{ gap: '0.4rem' }}>
                <Link to="/login" className="btn btn-ghost btn-sm">{t('shell.signIn', 'Sign in')}</Link>
                <Link to="/register" className="btn btn-primary btn-sm">{t('shell.signUp', 'Sign up')}</Link>
              </div>
            )}
            <button type="button" className="btn-icon mobile-toggle" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}>
              <Menu size={20} />
            </button>
          </div>
        </div>
      </header>
      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}

/* --------------------------------- Footer -------------------------------- */
export function Footer() {
  const { settings } = useSiteSettings()
  const t = useT()
  const year = new Date().getFullYear()
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <div className="row" style={{ marginBottom: '0.75rem' }}>
              <img src="/brand/mark.svg" alt="" width="36" height="36" />
              <div>
                <div style={{ color: '#fff', fontWeight: 800, letterSpacing: '-0.02em' }}>BetterGo Marinduque</div>
                <div style={{ fontSize: '0.65rem', letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.7, fontWeight: 700 }}>Marinduque</div>
              </div>
            </div>
            <p>
              {settings['platform.description'] ||
                'An independent, community-driven digital initiative for public information, services and civic participation in Marinduque.'}
            </p>
            <p style={{ fontSize: '0.8rem', opacity: 0.72 }}>
              {settings['platform.tagline'] || 'Serbisyo. Transparency. Progreso. Para sa bawat Marinduqueño.'}
            </p>
          </div>

          <div>
            <h4>{t('footer.quickLinks', 'Quick links')}</h4>
            <ul>
              <li><Link to="/">{t('nav.home', 'Home')}</Link></li>
              <li><Link to="/services">{t('nav.services', 'Government services')}</Link></li>
              <li><Link to="/service-coverage">{t('nav.serviceCoverage', 'Service coverage')}</Link></li>
              <li><Link to="/resources">{t('nav.formsResources', 'Forms & resources')}</Link></li>
              <li><Link to="/faqs">{t('nav.serviceFaqs', 'Service FAQs')}</Link></li>
              <li><Link to="/developers">{t('nav.developerApi', 'Developer API')}</Link></li>
              <li><Link to="/municipalities">{t('nav.municipalities', 'Municipalities')}</Link></li>
              <li><Link to="/transparency">{t('nav.transparency', 'Transparency')}</Link></li>
              <li><Link to="/transparency/budgets">{t('nav.budgets', 'Budgets')}</Link></li>
              <li><Link to="/transparency/reports">Transparency reports</Link></li>
              <li><Link to="/transparency/open-data">Open data</Link></li>
              <li><Link to="/transparency/community">Community questions</Link></li>
              <li><Link to="/announcements">{t('nav.announcements', 'Announcements')}</Link></li>
            </ul>
          </div>

          <div>
            <h4>{t('footer.usefulInfo', 'Useful information')}</h4>
            <ul>
              <li><Link to="/about">{t('nav.aboutBettergo', 'About BetterGo')}</Link></li>
              <li><Link to="/contact">{t('nav.contact', 'Contact & feedback')}</Link></li>
              <li><Link to="/about#faq">{t('footer.faq', 'Frequently asked questions')}</Link></li>
              <li><Link to="/privacy-policy">{t('nav.privacyPolicy', 'Privacy Policy')}</Link></li>
              <li><Link to="/terms-of-use">{t('nav.terms', 'Terms of Use')}</Link></li>
              <li><Link to="/disclaimer">{t('nav.disclaimer', 'Disclaimer')}</Link></li>
            </ul>
          </div>

          <div>
            <h4>{t('footer.municipalities', 'Marinduque')}</h4>
            <ul>
              <li><Link to="/municipalities/boac">Boac</Link></li>
              <li><Link to="/municipalities/mogpog">Mogpog</Link></li>
              <li><Link to="/municipalities/gasan">Gasan</Link></li>
              <li><Link to="/municipalities/buenavista">Buenavista</Link></li>
              <li><Link to="/municipalities/torrijos">Torrijos</Link></li>
              <li><Link to="/municipalities/santa-cruz">Santa Cruz</Link></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {year} BetterGo Marinduque. {t('footer.rights', 'All rights reserved.')}</span>
          <span className="footer-flag">
            <ShieldCheck size={14} aria-hidden="true" />
            {settings['footer.independence_notice'] ||
              'An independent civic initiative. Not an official provincial or municipal government website.'}
          </span>
        </div>
      </div>
      <div className="footer-wordmark" aria-hidden="true">MARINDUQUE</div>
    </footer>
  )
}

/* --------------------------- Site settings context ------------------------ */
import { createContext, useContext } from 'react'
const SiteSettingsContext = createContext({ settings: {} })

export function SiteSettingsProvider({ children }) {
  const [settings, setSettings] = useState({})
  useEffect(() => {
    api.get('/settings').then((data) => setSettings(data.settings || {})).catch(() => {})
  }, [])
  return <SiteSettingsContext.Provider value={{ settings }}>{children}</SiteSettingsContext.Provider>
}
export function useSiteSettings() {
  return useContext(SiteSettingsContext)
}

/* --------------------------- Page header & crumbs ------------------------- */
export function Breadcrumbs({ items }) {
  const t = useT()
  if (!items?.length) return null
  return (
    <nav aria-label="Breadcrumb">
      <ol className="breadcrumbs">
        <li><Link to="/">{t('nav.home', 'Home')}</Link></li>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            <ChevronRight size={12} aria-hidden="true" />
            {item.to && index < items.length - 1 ? (
              <Link to={item.to}>{item.label}</Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function PageHeader({ eyebrow, title, description, breadcrumbs, actions, icon: Icon, media, children }) {
  return (
    <div className="page-head">
      <div className="container">
        <Breadcrumbs items={breadcrumbs} />
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <div className="row-between" style={{ alignItems: 'flex-end' }}>
          <div className="row" style={{ gap: '0.75rem', alignItems: 'flex-start' }}>
            {media || null}
            {!media && Icon ? (
              <span className="card-icon" style={{ marginBottom: 0 }} aria-hidden="true"><Icon size={22} /></span>
            ) : null}
            <div>
              <h1>{title}</h1>
              {description ? <p className="lead">{description}</p> : null}
            </div>
          </div>
          {actions || children ? <div className="page-head-actions">{actions}{children}</div> : null}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------- Public shell ---------------------------- */
export function PublicLayout() {
  const location = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname])
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Header />
      <main id="main-content">
        <Outlet />
      </main>
      <Footer />
    </>
  )
}

/* ------------------------------ Dashboard shell -------------------------- */
const DASH_NAV = [
  { key: 'dash.navOverview', label: 'Overview', to: '/dashboard', icon: LayoutDashboard },
  { key: 'dash.navProfile', label: 'My profile', to: '/dashboard/profile', icon: User },
  { key: 'dash.navAccount', label: 'Account settings', to: '/dashboard/account', icon: Settings },
  { key: 'dash.navPreferences', label: 'Preferences', to: '/dashboard/preferences', icon: Gauge },
  { key: 'p4.notifications', label: 'Notifications', to: '/dashboard/notifications', icon: Bell },
  { key: 'p4.notificationSettings', label: 'Notification settings', to: '/dashboard/notification-settings', icon: Bell },
  { key: 'p4.support', label: 'Help and support', to: '/dashboard/support', icon: LifeBuoy },
  { key: 'p4.privacyCenter', label: 'Privacy centre', to: '/dashboard/privacy-center', icon: ShieldCheck },
  { key: 'p4.discover', label: 'Discover services', to: '/dashboard/discover', icon: Compass },
  { key: 'p4.assistance', label: 'Application assistance', to: '/dashboard/assistance', icon: ClipboardList },
  { key: 'p4.appointments', label: 'Appointments', to: '/dashboard/appointments', icon: CalendarDays },
  { key: 'p4.payments', label: 'Fees and payments', to: '/dashboard/payments', icon: Wallet },
  { key: 'p4.documentRequests', label: 'Document requests', to: '/dashboard/document-requests', icon: FileText },
  { key: 'p4.complaints', label: 'Complaints and cases', to: '/dashboard/complaints', icon: AlertCircle },
  { key: 'p4.identity', label: 'Identity and trust', to: '/dashboard/identity', icon: UserCheck },
  { key: 'p4.delegations', label: 'Delegated access', to: '/dashboard/delegations', icon: Users },
  { key: 'p4.consent', label: 'Consent and signatures', to: '/dashboard/consent', icon: PenLine },
  { key: 'p4.personalization', label: 'Accessibility and personalization', to: '/dashboard/personalization', icon: Accessibility },
  { key: 'p4.offline', label: 'Offline service packs', to: '/dashboard/offline-packs', icon: Download },
  { key: 'p4.translations', label: 'Language access', to: '/dashboard/translations', icon: Languages },
  { key: 'p4.portability', label: 'Your data and closure', to: '/dashboard/data-portability', icon: FileDown },
  { key: 'p4.account', label: 'Account management', to: '/dashboard/account-management', icon: UserX },
  { key: 'p4.consent-requests', label: 'Consent requests', to: '/dashboard/consent-requests', icon: FileCheck2 },
  { key: 'p4.security', label: 'Account security', to: '/dashboard/security', icon: ShieldCheck },
  { key: 'p4.journeys', label: 'Service journeys', to: '/dashboard/service-journeys', icon: Compass },
  { key: 'p4.applications', label: 'Application tracking', to: '/dashboard/applications', icon: ClipboardList },
  { key: 'p4.recordsTitle', label: 'My records', to: '/dashboard/records', icon: History },
  { key: 'p4.activityTitle', label: 'Activity history', to: '/dashboard/activity', icon: History },
  { key: 'p4.documentsTitle', label: 'My documents', to: '/dashboard/documents', icon: FolderLock },
  { key: 'dash.navReports', label: 'My submissions', to: '/dashboard/reports', icon: FileText },
  { key: 'dash.navSaved', label: 'Saved services', to: '/dashboard/saved', icon: HeartHandshake },
  { key: 'dash.navPrivacy', label: 'Privacy & data', to: '/dashboard/privacy', icon: ShieldCheck },
]

export function DashboardLayout() {
  const { profile, user } = useAuth()
  const t = useT()
  return (
    <>
      <Header minimal />
      <div className="container dash-shell">
        <aside className="dash-side" aria-label="Dashboard navigation">
          <div className="side-label">{t('dash.citizenAccount', 'Citizen account')}</div>
          <div className="row" style={{ padding: '0.4rem 0.7rem 0.6rem' }}>
            <span className="avatar">
              {profile?.profile_photo ? <img src={profile.profile_photo} alt="" /> : initials(user?.name)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name}</div>
              <div className="text-xs text-muted">{t('dash.citizenAccount', 'Citizen account')}</div>
            </div>
          </div>
          {DASH_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/dashboard'} className={({ isActive }) => (isActive ? 'is-active' : '')}>
              <item.icon size={16} aria-hidden="true" /> {t(item.key, item.label)}
            </NavLink>
          ))}
        </aside>
        <div style={{ minWidth: 0 }}>
          <Outlet />
        </div>
      </div>
      <Footer />
    </>
  )
}

/* ------------------------------- Admin shell ----------------------------- */
export function AdminLayout() {
  const { user, can, isSuperAdmin } = useAuth()
  const location = useLocation()
  return (
    <>
      <Header minimal />
      <div className="admin-shell">
        <aside className="admin-side" aria-label="Administration navigation">
          <div className="row" style={{ padding: '0 0.7rem 0.75rem' }}>
            <ShieldCheck size={18} aria-hidden="true" />
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.85rem' }}>Administration</div>
              <div className="text-xs text-muted">{user?.name}</div>
            </div>
          </div>
          {ADMIN_NAV.map((group) => {
            const items = group.items.filter((item) => !item.permission || can(item.permission) || isSuperAdmin)
            if (!items.length) return null
            return (
              <div key={group.label}>
                <div className="side-label">{group.label}</div>
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/admin'}
                    className={() => {
                      const active = item.to === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(item.to)
                      return active ? 'is-active' : ''
                    }}
                  >
                    <item.icon size={16} aria-hidden="true" /> {item.label}
                  </NavLink>
                ))}
              </div>
            )
          })}
          <div className="side-label">Public site</div>
          <Link to="/"><ArrowRight size={16} aria-hidden="true" /> Back to website</Link>
        </aside>
        <main className="admin-main" id="main-content">
          <Outlet />
        </main>
      </div>
    </>
  )
}
