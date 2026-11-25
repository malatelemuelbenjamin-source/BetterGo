import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Bookmark,
  CheckCircle2,
  Download,
  FileText,
  Image as ImageIcon,
  Lock,
  Mail,
  MapPin,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  User,
  ChevronRight,
} from 'lucide-react'
import { api, fmtDate, fmtDateTime, initials } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  PasswordInput,
  Select,
  SkeletonList,
  StatusBadge,
  Textarea,
  useToast,
} from '../components/ui'
import { PageHeader } from '../components/layout'
import { useAuth } from '../auth'
import { useLang } from '../i18n'
import SecurityPanel from '../components/SecurityPanel'
import CollectionsPanel from '../components/CollectionsPanel'

// Checklist labels come from the API in English; map them to interface keys so
// the dashboard reads in the chosen language without translating stored data.
const CHECK_KEYS = ['dash.checks.first', 'dash.checks.last', 'dash.checks.email', 'dash.checks.verified', 'dash.checks.municipality', 'dash.checks.phone']

/* ------------------------------- Overview -------------------------------- */
const DASH_WIDGET_LABELS = {
  stats: 'Account summary',
  checklist: 'Profile checklist',
  activity: 'My activity',
  services: 'Government services for you',
  notifications: 'Recent notifications',
  applications: 'Application tracking',
  announcements: 'From your municipality',
  advisories: 'Public advisories',
  programs: 'Community programmes',
  saved: 'Saved services',
  recentlyViewed: 'Recently viewed',
  recommended: 'Suggested for you',
  roles: 'My roles',
  security: 'Account security',
}

const DASH_WIDE = new Set(['stats', 'saved'])
const DASH_DEFAULT_ORDER = [
  'stats', 'checklist', 'activity', 'services', 'notifications', 'applications',
  'announcements', 'advisories', 'programs', 'saved', 'recentlyViewed', 'recommended', 'roles',
]

export function DashboardHome() {
  const { lang, t } = useLang()
  const en = (count) => (lang === 'en' && count !== 1 ? 's' : '')
  useDocumentTitle(t('dash.title', 'My dashboard'))
  const { data, loading, error, reload } = useApi('/account/dashboard')
  const { data: layout, reload: reloadLayout } = useApi('/account/dashboard/preferences')
  const toast = useToast()
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [customizing, setCustomizing] = useState(false)

  useEffect(() => {
    if (data) setUpdatedAt(new Date())
  }, [data])

  const refresh = async () => {
    setRefreshing(true)
    try {
      await reload()
      setUpdatedAt(new Date())
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) return <div className="section-tight"><SkeletonList count={3} height={110} /></div>
  if (error) {
    return (
      <div className="section-tight">
        <Alert tone="error" title="The dashboard could not be loaded">{error.message}</Alert>
        <Button className="mt-3" variant="outline" onClick={refresh} loading={refreshing}>Try again</Button>
      </div>
    )
  }

  const { profile, completion, counts, activity, roles, unreadNotifications } = data
  const hidden = new Set(layout?.hidden || [])
  const order = layout?.order?.length ? layout.order : DASH_DEFAULT_ORDER
  const visible = order.filter((key) => !hidden.has(key))
  if (!visible.includes('security')) visible.push('security')

  const widgets = {
    stats: (
      <div className="grid grid-4">
        <div className="card">
          <span className="stat-label">{t('dash.profileCompletion', 'Profile completion')}</span>
          <div className="stat-value">{completion.percent}%</div>
          <div className="progress mt-2"><span style={{ width: `${completion.percent}%` }} /></div>
          <p className="help mt-2">{t('dash.profileCompletionHelp')}</p>
        </div>
        <div className="card">
          <span className="stat-label">{t('dash.emailVerification', 'Email verification')}</span>
          <div className="mt-2">
            {profile.email_verified_at ? <Badge tone="success">{t('dash.verified', 'Verified')}</Badge> : <Badge tone="warning">{t('dash.notVerified', 'Not verified')}</Badge>}
          </div>
          <p className="help mt-2">{profile.email_verified_at ? fmtDate(profile.email_verified_at) : t('dash.verifyNow')}</p>
        </div>
        <div className="card">
          <span className="stat-label">{t('dash.municipality', 'Municipality')}</span>
          <div className="stat-value" style={{ fontSize: '1.2rem' }}>{profile.municipality_name || t('dash.notSet', 'Not set')}</div>
          <p className="help mt-2">{t('dash.municipalityHelp')}</p>
        </div>
        <div className="card">
          <span className="stat-label">{t('dash.unread', 'Unread notifications')}</span>
          <div className="stat-value">{unreadNotifications}</div>
          <Link className="text-xs" to="/dashboard/notifications">{t('dash.manageNotifications', 'Manage notifications')}</Link>
        </div>
      </div>
    ),
    checklist: (
      <div className="card">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-3)' }}>{t('dash.checklist', 'Profile checklist')}</h2>
        <ul className="checklist">
          {completion.checks.map((check, index) => (
            <li key={check.label} className={check.done ? 'done' : ''}>
              {check.done ? <CheckCircle2 size={15} style={{ color: 'var(--green-600)' }} aria-hidden="true" /> : <AlertTriangle size={15} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />}
              {CHECK_KEYS[index] ? t(CHECK_KEYS[index], check.label) : check.label}
              {check.optional ? <span className="text-xs text-muted">{t('dash.optional', '(optional)')}</span> : null}
            </li>
          ))}
        </ul>
        <Link className="btn btn-outline btn-sm mt-3" to="/dashboard/profile/edit">{t('dash.completeProfile', 'Complete my profile')}</Link>
      </div>
    ),
    activity: (
      <div className="card">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-3)' }}>{t('dash.activity', 'My activity')}</h2>
        {activity?.length ? (
          <ul className="timeline">
            {activity.map((item, index) => (
              <li key={index}>
                <div className="text-sm">{item.action.replace(/[._]/g, ' ')}</div>
                <div className="text-xs text-muted">{fmtDateTime(item.created_at)} · {item.module}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('dash.noActivity', 'No account activity recorded yet.')}</p>
        )}
        <Link className="btn btn-ghost btn-sm mt-3" to="/dashboard/activity">Full activity history</Link>
      </div>
    ),
    services: (
      <div className="card">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-3)' }}>{t('p4.quickTitle', 'Government services for you')}</h2>
        {data.quickServices?.length ? (
          <ul className="link-list">
            {data.quickServices.map((service) => (
              <li key={service.id}>
                <Link to={`/services/${service.slug}`}>{service.title}</Link>
                <ChevronRight size={14} aria-hidden="true" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('p4.quickEmpty', 'No published service is available yet.')}</p>
        )}
        <div className="row mt-3">
          <Link className="btn btn-outline btn-sm" to="/services">{t('p4.browseServices', 'Browse the directory')}</Link>
          <Link className="btn btn-ghost btn-sm" to="/search">Search everything</Link>
        </div>
      </div>
    ),
    notifications: (
      <div className="card">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-3)' }}>{t('p4.notifications', 'Recent notifications')}</h2>
        {data.notifications?.length ? (
          <ul className="timeline">
            {data.notifications.map((note) => (
              <li key={note.id}>
                <div className="text-sm">{note.title}</div>
                <div className="text-xs text-muted">{fmtDateTime(note.created_at)} · {note.read_at ? 'Read' : 'Unread'}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('p4.noNotifications', 'You have no notifications.')}</p>
        )}
        <div className="row mt-3">
          <Link className="btn btn-outline btn-sm" to="/dashboard/notifications">Open notifications</Link>
          <Link className="btn btn-ghost btn-sm" to="/dashboard/preferences">{t('dash.manageNotifications', 'Manage notifications')}</Link>
        </div>
      </div>
    ),
    applications: (
      <div className="card">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>{t('p4.applications', 'Application tracking')}</h2>
        <p className="help">{t('p4.applicationsNote')}</p>
        {data.applications?.length ? (
          <ul className="link-list">
            {data.applications.map((application) => (
              <li key={application.reference}>
                <Link to={`/dashboard/applications/${application.reference}`}>
                  {application.service_title || application.reference}
                </Link>
                <Badge tone="info">{data.applicationStatuses?.[application.status] || application.status}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('p4.noApplications', 'You have no tracked applications.')}</p>
        )}
        <Link className="btn btn-outline btn-sm mt-3" to="/dashboard/applications">{t('p4.trackApplications', 'Open application tracking')}</Link>
      </div>
    ),
    announcements: (
      <div className="card">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-3)' }}>{t('p4.localNews', 'From your municipality')}</h2>
        {data.municipalAnnouncements?.length ? (
          <ul className="link-list">
            {data.municipalAnnouncements.map((announcement) => (
              <li key={announcement.id}>
                <Link to={`/announcements/${announcement.slug}`}>{announcement.title}</Link>
                <span className="text-xs text-muted">{announcement.published_at ? fmtDate(announcement.published_at) : ''}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('p4.noLocalNews', 'No published announcements for your municipality yet.')}</p>
        )}
        <Link className="btn btn-ghost btn-sm mt-3" to="/announcements">All announcements</Link>
      </div>
    ),
    advisories: (
      <div className="card">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>{DASH_WIDGET_LABELS.advisories}</h2>
        <p className="help">Only published advisories and public notices appear here. This is not an emergency alerting service.</p>
        {data.advisories?.length ? (
          <ul className="link-list mt-2">
            {data.advisories.map((item) => (
              <li key={item.id}>
                <Link to={`/announcements/${item.slug}`}>{item.title}</Link>
                <span className="text-xs text-muted">{item.municipality_name || 'Province-wide'} · {fmtDate(item.published_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No published advisories or public notices at the moment.</p>
        )}
      </div>
    ),
    programs: (
      <div className="card">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>{DASH_WIDGET_LABELS.programs}</h2>
        {data.programs?.length ? (
          <ul className="link-list">
            {data.programs.map((program) => (
              <li key={program.id}><Link to={program.href || '/programs'}>{program.title}</Link></li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            No verified community programme records have been published yet. BetterGo does not invent programmes, deadlines or eligibility
            rules to fill this space.
          </p>
        )}
      </div>
    ),
    saved: (
      <div className="grid grid-3">
        <Link className="card card-interactive card-link" to="/dashboard/saved">
          <div className="card-icon" aria-hidden="true"><Bookmark size={20} /></div>
          <h3 style={{ fontSize: '1rem' }}>{t('dash.savedCard', 'Saved services')}</h3>
          <p>{counts.favorites} {t('dash.savedCount', 'saved service')}{en(counts.favorites)}.</p>
        </Link>
        <Link className="card card-interactive card-link" to="/dashboard/reports">
          <div className="card-icon" aria-hidden="true"><FileText size={20} /></div>
          <h3 style={{ fontSize: '1rem' }}>{t('dash.reportsCard', 'My submissions')}</h3>
          <p>{counts.reports} {t('dash.reportsCount', 'submitted report')}{en(counts.reports)}.</p>
        </Link>
        <Link className="card card-interactive card-link" to="/dashboard/privacy">
          <div className="card-icon" aria-hidden="true"><ShieldCheck size={20} /></div>
          <h3 style={{ fontSize: '1rem' }}>{t('dash.privacyCard', 'Privacy & data')}</h3>
          <p>{counts.privacyRequests} {t('dash.privacyCount', 'privacy request')}{en(counts.privacyRequests)} {t('dash.onFile', 'on file.')}</p>
        </Link>
      </div>
    ),
    recentlyViewed: (
      <div className="card">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-3)' }}>{t('p4.recentlyViewed', 'Recently viewed')}</h2>
        {data.recentlyViewed?.length ? (
          <ul className="link-list">
            {data.recentlyViewed.map((item) => (
              <li key={item.entity_slug}>
                <Link to={`/services/${item.entity_slug}`}>{item.entity_label || item.entity_slug}</Link>
                <ChevronRight size={14} aria-hidden="true" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('p4.nothingViewed', 'Services you open will appear here.')}</p>
        )}
      </div>
    ),
    recommended: (
      <div className="card">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>{DASH_WIDGET_LABELS.recommended}</h2>
        <p className="help">
          {data.personalizationOptIn
            ? 'Published services you have not opened yet. Turn personalization off in your profile if you prefer a general dashboard.'
            : 'Personalization is off, so these are simply recently published services. You can turn personalization on in your profile.'}
        </p>
        {data.recommended?.length ? (
          <ul className="link-list mt-2">
            {data.recommended.map((service) => (
              <li key={service.id}>
                <Link to={`/services/${service.slug}`}>{service.title}</Link>
                {service.category_name ? <span className="text-xs text-muted">{service.category_name}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No further published services to suggest right now.</p>
        )}
        <Link className="btn btn-ghost btn-sm mt-3" to="/dashboard/profile/edit">Change personalization</Link>
      </div>
    ),
    roles: (
      <div className="card">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>{t('dash.roles', 'My roles')}</h2>
        <div className="row">
          {roles.map((role) => (
            <Badge key={`${role.slug}-${role.municipality_name || 'global'}`} tone="info">
              {role.name}{role.municipality_name ? ` · ${role.municipality_name}` : ''}
            </Badge>
          ))}
        </div>
        <p className="help mt-2">{t('dash.rolesHelp')}</p>
      </div>
    ),
    security: (
      <div className="card">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-3)' }}>{t('p4.security', 'Account security')}</h2>
        <dl className="detail-list">
          <div><dt>{t('dash.emailVerification', 'Email verification')}</dt><dd>{data.security?.emailVerifiedAt ? t('dash.verified', 'Verified') : t('dash.notVerified', 'Not verified')}</dd></div>
          <div><dt>{t('dash.accountStatus', 'Account status')}</dt><dd><StatusBadge status={data.security?.accountStatus} /></dd></div>
          <div><dt>{t('p4.lastLogin', 'Last sign-in')}</dt><dd>{data.security?.lastLoginAt ? fmtDateTime(data.security.lastLoginAt) : '—'}</dd></div>
        </dl>
        <div className="row mt-3">
          <Link className="btn btn-outline btn-sm" to="/dashboard/account">{t('p4.manageSecurity', 'Manage account security')}</Link>
          <Link className="btn btn-ghost btn-sm" to="/dashboard/activity">{t('p4.activityTitle', 'Activity history')}</Link>
        </div>
      </div>
    ),
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={`${t('dash.welcome', 'Welcome,')} ${profile.display_name || profile.first_name || t('dash.citizen', 'citizen')}`}
        title={t('dash.title', 'My dashboard')}
        description={t('dash.description')}
        breadcrumbs={[{ label: t('dash.breadcrumb', 'Dashboard') }]}
        actions={
          <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
            <Button variant="outline" size="sm" onClick={refresh} loading={refreshing}>Refresh</Button>
            <Button variant="outline" size="sm" onClick={() => setCustomizing(true)}>Customize</Button>
            <Link className="btn btn-outline" to="/dashboard/profile/edit">{t('dash.editProfile', 'Edit profile')}</Link>
          </div>
        }
      />

      <p className="text-xs text-muted" aria-live="polite">
        {updatedAt ? `Last updated ${fmtDateTime(updatedAt.toISOString())}` : 'Loading data from BetterGo records.'}
      </p>

      <div className="dash-widgets mt-3">
        {visible.map((key) => (
          <section
            key={key}
            className={`dash-widget${DASH_WIDE.has(key) ? ' is-wide' : ''}`}
            aria-label={DASH_WIDGET_LABELS[key] || key}
          >
            {widgets[key] || null}
          </section>
        ))}
      </div>

      <p className="help mt-4">{t('dash.futureHelp')}</p>

      <DashboardCustomizer open={customizing} onClose={() => setCustomizing(false)} layout={layout} onSaved={reloadLayout} />
    </div>
  )
}

/** Show/hide and reorder widgets; account security is always rendered. */
function DashboardCustomizer({ open, onClose, layout, onSaved }) {
  const toast = useToast()
  const [order, setOrder] = useState(DASH_DEFAULT_ORDER)
  const [hidden, setHidden] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setOrder(layout?.order?.length ? layout.order.filter((key) => key !== 'security') : DASH_DEFAULT_ORDER)
    setHidden((layout?.hidden || []).filter((key) => key !== 'security'))
  }, [open, layout])

  const move = (index, delta) => {
    setOrder((current) => {
      const next = [...current]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      const swap = next[index]
      next[index] = next[target]
      next[target] = swap
      return next
    })
  }

  const save = async () => {
    setBusy(true)
    try {
      await api.put('/account/dashboard/preferences', { order, hidden })
      toast.push('Dashboard layout saved.')
      await onSaved()
      onClose()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      await api.post('/account/dashboard/preferences/reset')
      setOrder(DASH_DEFAULT_ORDER)
      setHidden([])
      toast.push('Default layout restored.')
      await onSaved()
      onClose()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customize your dashboard"
      actions={
        <>
          <Button variant="ghost" onClick={reset} disabled={busy}>Restore default layout</Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} loading={busy}>Save layout</Button>
        </>
      }
    >
      <p className="help">
        Hide or reorder the widgets you use. Account security stays visible so you can always reach it.
      </p>
      <ul className="widget-list mt-3">
        {order.map((key, index) => (
          <li key={key}>
            <label className="check-row">
              <input
                type="checkbox"
                checked={!hidden.includes(key)}
                onChange={() => setHidden((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))}
              />
              <span>{DASH_WIDGET_LABELS[key] || key}</span>
            </label>
            <span className="row" style={{ gap: '0.25rem' }}>
              <button type="button" className="icon-btn" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${DASH_WIDGET_LABELS[key]} up`}>↑</button>
              <button type="button" className="icon-btn" onClick={() => move(index, 1)} disabled={index === order.length - 1} aria-label={`Move ${DASH_WIDGET_LABELS[key]} down`}>↓</button>
            </span>
          </li>
        ))}
      </ul>
      <p className="help mt-3">Account security and privacy links cannot be hidden.</p>
    </Modal>
  )
}


export function ProfilePage() {
  const { t } = useLang()
  useDocumentTitle(t('dash.navProfile', 'My profile'))
  const { data, loading } = useApi('/account/profile')
  if (loading) return <SkeletonList count={2} height={160} />
  const profile = data.profile
  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('dash.eyebrowAccount', 'Account')}
        title={t('dash.navProfile', 'My profile')}
        description={t('dash.profileDesc')}
        breadcrumbs={[{ label: t('dash.breadcrumb', 'Dashboard'), to: '/dashboard' }, { label: t('dash.navProfile', 'Profile') }]}
        actions={<Link className="btn btn-primary" to="/dashboard/profile/edit">{t('dash.editProfile', 'Edit profile')}</Link>}
      />
      <div className="card mt-4">
        <div className="profile-header">
          <span className="avatar" style={{ width: 72, height: 72, fontSize: '1.3rem' }}>
            {profile.profile_photo ? <img src={profile.profile_photo} alt="" /> : initials(`${profile.first_name} ${profile.last_name}`)}
          </span>
          <div>
            <h2 style={{ fontSize: 'var(--text-h3)' }}>{profile.display_name || [profile.first_name, profile.middle_name, profile.last_name, profile.suffix].filter(Boolean).join(' ')}</h2>
            {profile.display_name ? <p className="text-sm text-muted">{'Shown as your display name'}</p> : null}
            <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
              <Badge>{profile.municipality_name || 'Municipality not set'}</Badge>
              <StatusBadge status={profile.account_status} />
              {profile.email_verified_at ? <Badge tone="success">Email verified</Badge> : <Badge tone="warning">Email unverified</Badge>}
              {profile.phone ? (profile.phone_verified_at ? <Badge tone="success">Mobile verified</Badge> : <Badge tone="warning">Mobile unverified</Badge>) : null}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="row-between">
            <strong>Profile completion</strong>
            <span className="text-sm text-muted">{data.completion.percent}%</span>
          </div>
          <div className="progress mt-2" role="progressbar" aria-valuenow={data.completion.percent} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${data.completion.percent}%` }} />
          </div>
          <ul className="checklist mt-2">
            {data.completion.checks.map((check) => (
              <li key={check.label} className={check.done ? 'done' : ''}>
                {check.done ? '✓' : '○'} {check.label}{check.optional ? ' (optional)' : ''}
              </li>
            ))}
          </ul>
          <p className="help">Profile completion is not identity verification and does not establish residency or eligibility for any government programme.</p>
        </div>

        <dl className="detail-list mt-5">
          <div className="detail-item"><dt>Display name</dt><dd>{profile.display_name || 'Not set (using your full name)'}</dd></div>
          <div className="detail-item"><dt>Email</dt><dd>{profile.email}</dd></div>
          <div className="detail-item"><dt>Mobile</dt><dd>{profile.phone || 'Not provided'}</dd></div>
          <div className="detail-item"><dt>Barangay</dt><dd>{profile.barangay_name || 'Not provided'}</dd></div>
          <div className="detail-item"><dt>Address</dt><dd>{profile.address || 'Not provided'}</dd></div>
          <div className="detail-item"><dt>Preferred language</dt><dd>{profile.preferred_language === 'fil' ? 'Filipino' : 'English'}</dd></div>
          <div className="detail-item"><dt>Account created</dt><dd>{fmtDate(profile.account_created_at)}</dd></div>
          <div className="detail-item"><dt>Personalization</dt><dd>{profile.personalization_opt_in ? 'On (optional interests only)' : 'Off'}</dd></div>
        </dl>

        <div className="card-actions">
          <Link className="btn btn-outline btn-sm" to="/dashboard/account">Account security</Link>
          <Link className="btn btn-outline btn-sm" to="/dashboard/privacy">Privacy and data</Link>
          <Link className="btn btn-outline btn-sm" to="/dashboard/saved">Saved services</Link>
        </div>

        <p className="help mt-4">
          Your email address is also your sign-in identifier and cannot be changed from this page. Use account settings to request an email
          change, which must be verified at the new address.
        </p>
      </div>

      <ProfileHistory />
    </div>
  )
}

/** Field categories and outcomes only — old personal values are never kept. */
function ProfileHistory() {
  const { data, loading } = useApi('/account/profile/history')
  if (loading) return <SkeletonList count={1} height={120} />
  const rows = data?.results || []
  return (
    <div className="card mt-4">
      <h2 style={{ fontSize: 'var(--text-h4)' }}>Profile change history</h2>
      <p className="help">Records which categories changed and when. Previous values of personal information are not retained here.</p>
      {rows.length ? (
        <ul className="timeline mt-3">
          {rows.map((row) => (
            <li key={row.id}>
              <strong style={{ textTransform: 'capitalize' }}>{String(row.field_category).replace(/_/g, ' ')}</strong>
              <span className="text-sm text-muted"> {row.changed_fields ? `· ${row.changed_fields}` : ''}</span>
              <div className="text-xs text-muted">{fmtDateTime(row.created_at)} · {row.outcome}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No profile changes recorded yet.</p>
      )}
    </div>
  )
}

export function ProfileEditPage() {
  const { t } = useLang()
  useDocumentTitle(t('dash.editProfile', 'Edit profile'))
  const { data, loading, reload } = useApi('/account/profile')
  const { data: lookups } = useApi('/lookups')
  const toast = useToast()
  const photoInput = useRef(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (data?.profile) {
      setForm({
        displayName: data.profile.display_name || '',
        firstName: data.profile.first_name || '',
        middleName: data.profile.middle_name || '',
        lastName: data.profile.last_name || '',
        suffix: data.profile.suffix || '',
        phone: data.profile.phone || '',
        municipalityId: data.profile.municipality_id || '',
        barangayId: data.profile.barangay_id || '',
        address: data.profile.address || '',
        language: data.profile.preferred_language || 'en',
      })
      setDirty(false)
    }
  }, [data])

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (dirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  if (loading || !form) return <SkeletonList count={2} height={200} />

  const change = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.patch('/account/profile', form)
      setDirty(false)
      toast.push('Profile updated.')
      await reload()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const uploadPhoto = async (file) => {
    if (!file) return
    setUploading(true)
    try {
      await api.upload('/account/photo', file)
      toast.push('Profile photo updated.')
      await reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setUploading(false)
      if (photoInput.current) photoInput.current.value = ''
    }
  }

  const removePhoto = async () => {
    try {
      await api.del('/account/photo')
      toast.push('Profile photo removed.')
      await reload()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('dash.eyebrowAccount', 'Account')}
        title={t('dash.editProfile', 'Edit profile')}
        description={t('dash.editProfileDesc')}
        breadcrumbs={[
          { label: t('dash.breadcrumb', 'Dashboard'), to: '/dashboard' },
          { label: t('dash.navProfile', 'Profile'), to: '/dashboard/profile' },
          { label: t('common.edit', 'Edit') },
        ]}
      />

      <div className="card mt-4">
        <h2 style={{ fontSize: 'var(--text-h4)' }}>Profile photo</h2>
        <div className="row mt-2">
          <span className="avatar" style={{ width: 56, height: 56 }}>
            {data.profile.profile_photo ? <img src={data.profile.profile_photo} alt="" /> : <User size={20} />}
          </span>
          <input
            ref={photoInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => uploadPhoto(event.target.files?.[0])}
            id="photo-input"
          />
          <Button variant="outline" size="sm" icon={Upload} loading={uploading} onClick={() => photoInput.current?.click()}>
            Upload photo
          </Button>
          {data.profile.profile_photo ? (
            <Button variant="ghost" size="sm" icon={Trash2} onClick={removePhoto}>Remove</Button>
          ) : null}
        </div>
        <p className="help mt-2">JPG, PNG or WebP, up to 2 MB. File content is validated, not just the extension.</p>
      </div>

      <form className="card mt-4" onSubmit={submit}>
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-3)' }}>Personal information</h2>
        <Field label="Display name (optional)" htmlFor="profile-display-name" help="If set, this is the name shown on your own dashboard. Your legal name is still used on records that require it.">
          <Input id="profile-display-name" value={form.displayName} onChange={(event) => change('displayName', event.target.value)} maxLength={80} />
        </Field>
        {error && !error.details?.length ? <Alert tone="error">{error.message}</Alert> : null}
        {error?.details?.length ? (
          <Alert tone="error" title="Please check the form">
            <ul>{error.details.map((detail) => <li key={detail.field}>{detail.message}</li>)}</ul>
          </Alert>
        ) : null}

        <div className="form-grid">
          <Field label="First name" htmlFor="pf-first" required>
            <Input id="pf-first" value={form.firstName} onChange={(event) => change('firstName', event.target.value)} required maxLength={80} />
          </Field>
          <Field label="Last name" htmlFor="pf-last" required>
            <Input id="pf-last" value={form.lastName} onChange={(event) => change('lastName', event.target.value)} required maxLength={80} />
          </Field>
          <Field label="Middle name" htmlFor="pf-middle">
            <Input id="pf-middle" value={form.middleName} onChange={(event) => change('middleName', event.target.value)} maxLength={80} />
          </Field>
          <Field label="Suffix" htmlFor="pf-suffix" help="For example Jr., Sr., III">
            <Input id="pf-suffix" value={form.suffix} onChange={(event) => change('suffix', event.target.value)} maxLength={20} />
          </Field>
          <Field label="Mobile number" htmlFor="pf-phone" help="Philippine format, e.g. 09171234567">
            <Input id="pf-phone" type="tel" value={form.phone} onChange={(event) => change('phone', event.target.value)} maxLength={30} />
          </Field>
          <Field label="Municipality" htmlFor="pf-municipality">
            <Select id="pf-municipality" value={form.municipalityId} onChange={(event) => change('municipalityId', event.target.value)}>
              <option value="">Not set</option>
              {(lookups?.municipalities || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </Field>
          <Field label="Residential address (optional)" htmlFor="pf-address" className="field-full" help="Never displayed publicly. Used only for relevant platform features.">
            <Textarea id="pf-address" value={form.address} onChange={(event) => change('address', event.target.value)} maxLength={300} style={{ minHeight: 80 }} />
          </Field>
          <Field label="Preferred language" htmlFor="pf-language" className="field-full">
            <Select id="pf-language" value={form.language} onChange={(event) => change('language', event.target.value)}>
              <option value="en">English</option>
              <option value="fil">Filipino</option>
            </Select>
          </Field>
        </div>

        <p className="help">
          Barangay selection becomes available once verified barangay records are published for your municipality.
        </p>

        <div className="row mt-4">
          <Button type="submit" loading={busy} icon={Save}>Save changes</Button>
          <Button type="button" variant="outline" onClick={() => { setForm({ ...form }); setDirty(false) }} disabled={!dirty}>Discard changes</Button>
          {dirty ? <span className="text-xs" style={{ color: 'var(--warning)' }}>Unsaved changes</span> : null}
        </div>
      </form>

      <PersonalizationCard />

      <Alert tone="info" title="Why we ask for location">
        Municipality is used to show relevant local information and, for staff accounts, to scope administrative access. It does not
        establish official residency or eligibility for any programme.
      </Alert>
    </div>
  )
}

const INTEREST_LABELS = {
  announcements: 'Municipal announcements',
  advisories: 'Public advisories',
  programs: 'Community programmes',
  projects: 'Public projects',
  tourism: 'Tourism information',
  education: 'Education updates',
  employment: 'Employment updates',
  agriculture: 'Agriculture updates',
  disaster_preparedness: 'Disaster preparedness',
}

/** Optional interests and the personalization switch (Prompt 61 §9–10). */
function PersonalizationCard() {
  const { data, loading, reload } = useApi('/account/preferences/personalization')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [optIn, setOptIn] = useState(true)
  const [selected, setSelected] = useState([])

  useEffect(() => {
    if (!data) return
    setOptIn(Boolean(data.personalizationOptIn))
    setSelected(data.interests || [])
  }, [data])

  if (loading) return <SkeletonList count={1} height={120} />

  const toggle = (key) => setSelected((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))

  const save = async () => {
    setBusy(true)
    try {
      await api.put('/account/preferences/personalization', { personalizationOptIn: optIn, interests: selected })
      toast.push('Personalization preferences saved.')
      await reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mt-4">
      <h2 style={{ fontSize: 'var(--text-h4)' }}>Personalization and privacy</h2>
      <p className="help">{data?.note}</p>

      <label className="check-row mt-3">
        <input type="checkbox" checked={optIn} onChange={(event) => setOptIn(event.target.checked)} />
        <span>
          <strong>Use my preferences to personalize BetterGo</strong>
          <span className="text-sm text-muted" style={{ display: 'block' }}>
            When off, the dashboard shows general content and ignores the interests below. Your saved services and activity are unaffected.
          </span>
        </span>
      </label>

      <fieldset className="mt-3" disabled={!optIn} style={{ border: 0, padding: 0 }}>
        <legend className="text-sm" style={{ marginBottom: '0.4rem' }}>Topics I am interested in (all optional)</legend>
        <div className="check-grid">
          {(data?.availableInterests || []).map((key) => (
            <label key={key} className="check-row">
              <input type="checkbox" checked={selected.includes(key)} onChange={() => toggle(key)} disabled={!optIn} />
              <span>{INTEREST_LABELS[key] || key}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="row mt-3">
        <Button size="sm" onClick={save} loading={busy}>Save preferences</Button>
      </div>
      <p className="help mt-2">
        Preferences stay private. BetterGo does not create a public citizen profile, and these choices are never shared with an office.
      </p>
    </div>
  )
}

/* -------------------------------- Account -------------------------------- */
export function AccountPage() {
  const { t } = useLang()
  useDocumentTitle(t('dash.navAccount', 'Account settings'))
  const { user, profile, refresh } = useAuth()
  const toast = useToast()
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [emailForm, setEmailForm] = useState({ newEmail: '', password: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const [emailBusy, setEmailBusy] = useState(false)
  const [pwError, setPwError] = useState(null)
  const [emailMessage, setEmailMessage] = useState(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [params, setParams] = useSearchParams()
  const emailToken = params.get('emailToken')

  // Confirmation link from the new address lands here: finish the change once.
  useEffect(() => {
    if (!emailToken) return undefined
    let active = true
    api
      .post('/auth/confirm-email-change', { token: emailToken })
      .then(async (result) => {
        if (!active) return
        setEmailMessage({ text: result.message })
        await refresh()
        const next = new URLSearchParams(params)
        next.delete('emailToken')
        setParams(next, { replace: true })
      })
      .catch((err) => active && setEmailMessage({ text: err.message, error: true }))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailToken])

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('dash.eyebrowAccount', 'Account')}
        title={t('dash.navAccount', 'Account settings')}
        description={t('dash.accountDesc')}
        breadcrumbs={[{ label: t('dash.breadcrumb', 'Dashboard'), to: '/dashboard' }, { label: t('dash.eyebrowAccount', 'Account') }]}
      />

      <div className="grid grid-2 mt-4">
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}><Lock size={15} aria-hidden="true" /> Change password</h2>
          {pwError ? <Alert tone="error">{pwError.message}</Alert> : null}
          <form
            onSubmit={async (event) => {
              event.preventDefault()
              setPwBusy(true)
              setPwError(null)
              try {
                await api.post('/auth/change-password', password)
                setPassword({ currentPassword: '', newPassword: '', confirmPassword: '' })
                toast.push('Password changed. Your session was refreshed.')
              } catch (err) {
                setPwError(err)
              } finally {
                setPwBusy(false)
              }
            }}
          >
            <Field label="Current password" htmlFor="pw-current" required>
              <PasswordInput id="pw-current" value={password.currentPassword} onChange={(event) => setPassword({ ...password, currentPassword: event.target.value })} required autoComplete="current-password" />
            </Field>
            <Field label="New password" htmlFor="pw-new" required help="At least 12 characters with mixed case, a number and a symbol.">
              <PasswordInput id="pw-new" value={password.newPassword} onChange={(event) => setPassword({ ...password, newPassword: event.target.value })} required autoComplete="new-password" />
            </Field>
            <Field label="Confirm new password" htmlFor="pw-confirm" required>
              <PasswordInput id="pw-confirm" value={password.confirmPassword} onChange={(event) => setPassword({ ...password, confirmPassword: event.target.value })} required autoComplete="new-password" />
            </Field>
            <Button type="submit" loading={pwBusy}>Update password</Button>
          </form>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}><Mail size={15} aria-hidden="true" /> Change email address</h2>
          <p className="text-sm text-muted">
            Current email: <strong>{user?.email}</strong>
            {profile?.email_verified_at ? <Badge tone="success" style={{ marginLeft: 6 }}>Verified</Badge> : <Badge tone="warning" style={{ marginLeft: 6 }}>Unverified</Badge>}
          </p>
          {emailMessage ? <Alert tone={emailMessage.error ? 'error' : 'success'}>{emailMessage.text}{emailMessage.link ? <div><a href={emailMessage.link}>Confirm new email (development link)</a></div> : null}</Alert> : null}
          <form
            onSubmit={async (event) => {
              event.preventDefault()
              setEmailBusy(true)
              setEmailMessage(null)
              try {
                const result = await api.post('/auth/request-email-change', emailForm)
                setEmailMessage({ text: result.message, link: result.verificationUrl })
                setEmailForm({ newEmail: '', password: '' })
              } catch (err) {
                setEmailMessage({ text: err.message, error: true })
              } finally {
                setEmailBusy(false)
              }
            }}
          >
            <Field label="New email address" htmlFor="email-new" required>
              <Input id="email-new" type="email" value={emailForm.newEmail} onChange={(event) => setEmailForm({ ...emailForm, newEmail: event.target.value })} required maxLength={200} />
            </Field>
            <Field label="Confirm your password" htmlFor="email-password" required>
              <PasswordInput id="email-password" value={emailForm.password} onChange={(event) => setEmailForm({ ...emailForm, password: event.target.value })} required autoComplete="current-password" />
            </Field>
            <Button type="submit" variant="outline" loading={emailBusy}>Send verification</Button>
          </form>
          <p className="help mt-2">Your current address stays active until the new address is verified.</p>
        </div>
      </div>

      <SecurityPanel />

      <div className="card mt-4">
        <h2 style={{ fontSize: 'var(--text-h4)' }}>Account status</h2>
        <dl className="detail-list mt-2">
          <div className="detail-item"><dt>Status</dt><dd><StatusBadge status={user?.accountStatus} /></dd></div>
          <div className="detail-item"><dt>Email verified</dt><dd>{user?.emailVerified ? 'Yes' : 'No'}</dd></div>
          <div className="detail-item"><dt>Account created</dt><dd>{fmtDate(user?.createdAt)}</dd></div>
          <div className="detail-item"><dt>Session</dt><dd>Secure HTTP-only cookie, expires after 7 days</dd></div>
        </dl>
        <p className="help mt-3">
          If your account is suspended or disabled you cannot sign in. Contact platform support through the contact form.
        </p>
        <div className="row mt-4">
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>Request account deletion</Button>
          <Link className="btn btn-outline" to="/dashboard/privacy">Privacy settings</Link>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Request account deletion"
        message="This records a deletion request for review. Your account is not deleted automatically, and some records may need to be retained where the law requires it. You will be contacted to verify the request."
        confirmLabel="Submit deletion request"
        busy={deleteBusy}
        onConfirm={async () => {
          setDeleteBusy(true)
          try {
            const result = await api.post('/account/privacy/deletion-request', { confirm: true })
            toast.push(`Request ${result.reference} recorded.`)
            setDeleteOpen(false)
          } catch (err) {
            toast.push(err.message, 'error')
          } finally {
            setDeleteBusy(false)
          }
        }}
      />
    </div>
  )
}

/* ------------------------------ Preferences ------------------------------ */
export function PreferencesPage() {
  const { t } = useLang()
  useDocumentTitle(t('dash.navPreferences', 'Preferences'))
  const { refresh } = useAuth()
  const { data, loading } = useApi('/account/profile')
  const profile = data?.profile
  const toast = useToast()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (profile && !form) {
      setForm({
        language: profile.preferred_language || 'en',
        display: profile.display_preference || 'system',
        reducedMotion: Boolean(profile.reduced_motion),
        emailEnabled: Boolean(profile.email_enabled),
        smsEnabled: Boolean(profile.sms_enabled),
        inAppEnabled: Boolean(profile.in_app_enabled),
        announcementsEnabled: Boolean(profile.announcements_enabled),
        advisoriesEnabled: Boolean(profile.advisories_enabled),
        updatesEnabled: Boolean(profile.updates_enabled),
      })
    }
  }, [profile, form])

  if (loading || !form) return <SkeletonList count={2} height={160} />

  const save = async () => {
    setBusy(true)
    try {
      await api.put('/account/preferences', form)
      localStorage.setItem('bg-theme', form.display)
      const dark = form.display === 'dark' || (form.display === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : ''
      if (form.reducedMotion) document.documentElement.dataset.motion = 'reduced'
      else delete document.documentElement.dataset.motion
      await refresh()
      toast.push('Preferences saved.')
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('dash.eyebrowAccount', 'Account')}
        title={t('dash.navPreferences', 'Preferences')}
        description={t('dash.preferencesDesc')}
        breadcrumbs={[{ label: t('dash.breadcrumb', 'Dashboard'), to: '/dashboard' }, { label: t('dash.navPreferences', 'Preferences') }]}
      />

      <div className="grid grid-2 mt-4">
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-3)' }}>Language &amp; display</h2>
          <Field label="Interface language" htmlFor="pref-language" help="Content is published in the language provided by its source.">
            <Select id="pref-language" value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })}>
              <option value="en">English</option>
              <option value="fil">Filipino</option>
            </Select>
          </Field>
          <Field label="Theme" htmlFor="pref-theme">
            <Select id="pref-theme" value={form.display} onChange={(event) => setForm({ ...form, display: event.target.value })}>
              <option value="system">Follow system setting</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
          </Field>
          <Checkbox
            id="pref-motion"
            checked={form.reducedMotion}
            onChange={(event) => setForm({ ...form, reducedMotion: event.target.checked })}
            label="Reduce motion"
            description="Disables non-essential animation and transition effects."
          />
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-3)' }}>Notifications</h2>
          <div className="stack-sm">
            <Checkbox id="pref-inapp" checked={form.inAppEnabled} onChange={(event) => setForm({ ...form, inAppEnabled: event.target.checked })} label="In-app notifications" />
            <Checkbox
              id="pref-email"
              checked={form.emailEnabled}
              onChange={(event) => setForm({ ...form, emailEnabled: event.target.checked })}
              label="Email notifications"
              description="Requires a configured email provider. Your preference is saved either way."
            />
            <Checkbox id="pref-sms" checked={form.smsEnabled} onChange={(event) => setForm({ ...form, smsEnabled: event.target.checked })} label="SMS notifications" description="SMS delivery is not yet configured on this deployment." />
          </div>
          <div className="dropdown-sep" />
          <div className="stack-sm">
            <Checkbox id="pref-ann" checked={form.announcementsEnabled} onChange={(event) => setForm({ ...form, announcementsEnabled: event.target.checked })} label="Government announcements" />
            <Checkbox id="pref-adv" checked={form.advisoriesEnabled} onChange={(event) => setForm({ ...form, advisoriesEnabled: event.target.checked })} label="Public advisories" />
            <Checkbox id="pref-upd" checked={form.updatesEnabled} onChange={(event) => setForm({ ...form, updatesEnabled: event.target.checked })} label="Service request updates" />
          </div>
        </div>
      </div>

      <div className="row mt-4">
        <Button onClick={save} loading={busy} icon={Save}>Save preferences</Button>
      </div>
      <p className="help mt-2">
        Unsupported delivery channels are shown honestly rather than hidden. Preferences are stored on your account and applied when you sign in.
      </p>
    </div>
  )
}

/* -------------------------------- Privacy -------------------------------- */
export function PrivacyPage() {
  const { t } = useLang()
  useDocumentTitle(t('dash.navPrivacy', 'Privacy & data'))
  const { data, loading, reload } = useApi('/account/consents')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const download = async () => {
    setBusy(true)
    try {
      const response = await fetch('/api/account/privacy/export', { credentials: 'include' })
      if (!response.ok) throw new Error('Export failed.')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'bettergo-personal-data.json'
      anchor.click()
      URL.revokeObjectURL(url)
      toast.push('Your data export has been downloaded.')
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('dash.eyebrowPrivacy', 'Privacy')}
        title={t('dash.privacyTitle', 'Privacy and personal data')}
        description={t('dash.privacyDesc')}
        breadcrumbs={[{ label: t('dash.breadcrumb', 'Dashboard'), to: '/dashboard' }, { label: t('dash.eyebrowPrivacy', 'Privacy') }]}
      />

      <div className="grid grid-2 mt-4">
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Your data</h2>
          <p className="text-sm text-muted">
            Download a copy of the account data BetterGo holds about you. Credentials, tokens and internal security records are excluded.
          </p>
          <div className="row mt-3">
            <Button variant="outline" icon={Download} onClick={download} loading={busy}>Download my data</Button>
            <Link className="btn btn-outline" to="/dashboard/privacy/requests">My requests</Link>
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Account deletion</h2>
          <p className="text-sm text-muted">
            Deletion requests are reviewed manually. Some records may need to be retained for legal or security reasons, and audit records are
            not removed.
          </p>
          <Button variant="danger" className="mt-3" onClick={() => setDeleteOpen(true)}>Request deletion</Button>
        </div>
      </div>

      <div className="card mt-4">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>Consent records</h2>
        {loading ? (
          <SkeletonList count={1} height={80} />
        ) : data?.results?.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Consent</th><th>Status</th><th>Policy version</th><th>Recorded</th><th /></tr></thead>
              <tbody>
                {data.results.map((consent) => (
                  <tr key={consent.id}>
                    <td style={{ textTransform: 'capitalize' }}>{consent.consent_category.replace(/_/g, ' ')}</td>
                    <td><Badge tone={consent.status === 'granted' ? 'success' : 'neutral'}>{consent.status}</Badge></td>
                    <td>{consent.policy_version || '—'}</td>
                    <td>{fmtDate(consent.created_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {consent.status === 'granted' && !['terms_of_use', 'privacy_policy'].includes(consent.consent_category) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              await api.post(`/account/consents/${consent.consent_category}/withdraw`)
                              toast.push('Consent withdrawn.')
                              reload()
                            } catch (err) {
                              toast.push(err.message, 'error')
                            }
                          }}
                        >
                          Withdraw
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">No consent records yet.</p>
        )}
        <p className="help mt-2">
          Acceptance of the Terms of Use and Privacy Policy is required while an account is active and cannot be withdrawn separately.
        </p>
      </div>

      <div className="card mt-4">
        <h2 style={{ fontSize: 'var(--text-h4)' }}>Your rights and how to exercise them</h2>
        <ul className="text-sm text-muted" style={{ paddingLeft: '1.1rem' }}>
          <li>Request access to your personal information (use the download above or submit a request).</li>
          <li>Request correction of inaccurate information.</li>
          <li>Request deletion where retention is not required.</li>
          <li>Object to or request restriction of certain processing.</li>
          <li>Withdraw consent where consent is the legal basis.</li>
        </ul>
        <div className="row mt-3">
          <Link className="btn btn-outline" to="/privacy-policy">Privacy Policy</Link>
          <Link className="btn btn-outline" to="/data-requests">Public request centre</Link>
          <Link className="btn btn-outline" to="/cookie-policy">Cookie policy</Link>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Submit a deletion request"
        message="An administrator will verify the request and review whether any records must be retained. Your account is not deleted automatically."
        confirmLabel="Submit request"
        onConfirm={async () => {
          try {
            const result = await api.post('/account/privacy/deletion-request', { confirm: true })
            toast.push(`Request ${result.reference} recorded.`)
            setDeleteOpen(false)
          } catch (err) {
            toast.push(err.message, 'error')
          }
        }}
      />
    </div>
  )
}

export function PrivacyRequestsPage() {
  const { t } = useLang()
  useDocumentTitle(t('dash.requestsTitle', 'My data requests'))
  const { data, loading, reload } = useApi('/account/privacy/requests')
  const [form, setForm] = useState({ category: 'access', description: '' })
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('dash.eyebrowPrivacy', 'Privacy')}
        title={t('dash.requestsTitle', 'My data requests')}
        description={t('dash.requestsDesc')}
        breadcrumbs={[
          { label: t('dash.breadcrumb', 'Dashboard'), to: '/dashboard' },
          { label: t('dash.eyebrowPrivacy', 'Privacy'), to: '/dashboard/privacy' },
          { label: t('dash.requestsBreadcrumb', 'Requests') },
        ]}
      />

      <div className="card mt-4">
        <h2 style={{ fontSize: 'var(--text-h4)' }}>New request</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            try {
              const result = await api.post('/account/privacy/requests', form)
              toast.push(`Request ${result.reference} submitted.`)
              setForm({ category: 'access', description: '' })
              reload()
            } catch (err) {
              toast.push(err.message, 'error')
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="form-grid">
            <Field label="Type of request" htmlFor="myreq-category" required>
              <Select id="myreq-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                <option value="access">Access my information</option>
                <option value="correction">Correct my information</option>
                <option value="deletion">Delete my information</option>
                <option value="restriction">Restrict processing</option>
                <option value="withdraw_consent">Withdraw consent</option>
                <option value="concern">Privacy concern</option>
                <option value="question">Question</option>
              </Select>
            </Field>
            <Field label="Description" htmlFor="myreq-description" required className="field-full">
              <Textarea id="myreq-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required minLength={10} maxLength={3000} />
            </Field>
          </div>
          <Button type="submit" loading={busy}>Submit request</Button>
        </form>
      </div>

      <div className="card mt-4">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>Request history</h2>
        {loading ? (
          <SkeletonList count={1} height={80} />
        ) : data?.results?.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Reference</th><th>Type</th><th>Status</th><th>Submitted</th><th>Resolution</th></tr></thead>
              <tbody>
                {data.results.map((request) => (
                  <tr key={request.reference}>
                    <td className="nowrap">{request.reference}</td>
                    <td style={{ textTransform: 'capitalize' }}>{request.category.replace(/_/g, ' ')}</td>
                    <td><Badge tone={request.status === 'completed' ? 'success' : 'info'}>{request.status.replace(/_/g, ' ')}</Badge></td>
                    <td className="nowrap">{fmtDate(request.created_at)}</td>
                    <td>{request.resolution || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={ShieldCheck} title="No requests yet" description="Requests you submit will appear here with their status." />
        )}
      </div>
    </div>
  )
}

/* -------------------------------- Saved ---------------------------------- */
/**
 * Saved items page (Prompt 63): every saveable record type in one private
 * list, with type filters, sorting and search handled by the API.
 */
export function SavedServicesPage() {
  const { t } = useLang()
  useDocumentTitle(t('dash.navSaved', 'Saved services'))
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const type = params.get('type') || ''
  const sort = params.get('sort') || 'recent'
  const q = params.get('q') || ''
  const [term, setTerm] = useState(q)
  const query = new URLSearchParams({ ...(type ? { type } : {}), sort, ...(q ? { q } : {}) })
  const { data, loading, reload } = useApi(`/account/saved?${query.toString()}`)
  const { data: collections } = useApi('/account/collections')

  useEffect(() => setTerm(q), [q])

  const update = (patch) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)))
    setParams(next, { replace: true })
  }

  const remove = async (item) => {
    try {
      await api.del(`/account/saved/${item.contentType}/${item.contentId}`)
      toast.push('Removed from your saved items.')
      await reload()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const addToCollection = async (collectionId, item) => {
    try {
      await api.post(`/account/collections/${collectionId}/items`, { contentType: item.contentType, contentId: item.contentId })
      toast.push('Added to the collection.')
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const types = data?.types || []
  const counts = data?.counts || {}

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('dash.eyebrowAccount', 'Account')}
        title={t('dash.navSaved', 'Saved services')}
        description="Services, offices, announcements and public documents you saved. This list is private to your account."
        breadcrumbs={[{ label: t('dash.breadcrumb', 'Dashboard'), to: '/dashboard' }, { label: t('dash.navSaved', 'Saved services') }]}
      />

      <div className="row mt-4" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
        <button type="button" className={`pill ${!type ? 'is-active' : ''}`} onClick={() => update({ type: '' })} aria-pressed={!type}>
          All ({data?.counts ? Object.values(counts).reduce((total, value) => total + value, 0) : 0})
        </button>
        {types.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`pill ${type === item.key ? 'is-active' : ''}`}
            onClick={() => update({ type: item.key })}
            aria-pressed={type === item.key}
          >
            {item.label} ({counts[item.key] || 0})
          </button>
        ))}
      </div>

      <form
        className="toolbar mt-3"
        onSubmit={(event) => {
          event.preventDefault()
          update({ q: term })
        }}
      >
        <input
          className="input grow"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search your saved items"
          aria-label="Search your saved items"
          maxLength={120}
        />
        <Select value={sort} onChange={(event) => update({ sort: event.target.value })} aria-label="Sort saved items">
          <option value="recent">Recently saved</option>
          <option value="oldest">Oldest first</option>
          <option value="alpha">Alphabetical</option>
          <option value="municipality">By municipality</option>
        </Select>
        <Button type="submit" size="sm" variant="outline">Search</Button>
      </form>

      <CollectionsPanel />

      {loading ? (
        <SkeletonList count={3} />
      ) : data?.results?.length ? (
        <div className="grid grid-2 mt-4">
          {data.results.map((item) => (
            <div className="card" key={`${item.contentType}-${item.contentId}`}>
              <div className="row-between">
                <Badge>{item.typeLabel}</Badge>
                <span className="text-xs text-muted">{fmtDate(item.savedAt)}</span>
              </div>
              <h3 style={{ fontSize: '1rem', marginTop: '0.3rem' }}>{item.title}</h3>
              {item.summary ? <p className="text-sm text-muted">{item.summary}</p> : null}
              {item.municipalityName ? <p className="text-xs text-muted">{item.municipalityName}</p> : null}
              <div className="card-actions">
                {item.available && item.url ? (
                  <Link className="btn btn-outline btn-sm" to={item.url}>Open</Link>
                ) : (
                  <Badge tone="warning">No longer published</Badge>
                )}
                {collections?.results?.length ? (
                  <Select
                    aria-label={`Add ${item.title} to a collection`}
                    defaultValue=""
                    onChange={(event) => {
                      if (event.target.value) addToCollection(event.target.value, item)
                      event.target.value = ''
                    }}
                  >
                    <option value="">Add to collection…</option>
                    {collections.results.map((collection) => (
                      <option key={collection.id} value={collection.id}>{collection.name}</option>
                    ))}
                  </Select>
                ) : null}
                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => remove(item)}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Bookmark}
          title="Nothing saved yet"
          description="Use the Save button on a published service, office, announcement or public document and it will appear here."
          action={<Link className="btn btn-primary" to="/services">Browse services</Link>}
        />
      )}

      <Alert tone="info" title="Saved items are not applications">
        {data?.note || 'A bookmark is a personal shortcut. It is not an application, reservation, queue position or government record.'}
      </Alert>
    </div>
  )
}

export function MyReportsPage() {
  const { t } = useLang()
  useDocumentTitle(t('dash.navReports', 'My submissions'))
  const { data, loading } = useApi('/account/reports')

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('dash.eyebrowParticipation', 'Participation')}
        title={t('dash.navReports', 'My submissions')}
        description={t('dash.reportsDesc')}
        breadcrumbs={[{ label: t('dash.breadcrumb', 'Dashboard'), to: '/dashboard' }, { label: t('dash.navReports', 'My submissions') }]}
        actions={<Link className="btn btn-primary" to="/contact">{t('dash.newSubmission', 'New submission')}</Link>}
      />
      {loading ? (
        <SkeletonList count={2} height={110} />
      ) : data?.results?.length ? (
        <div className="stack mt-4">
          {data.results.map((report) => (
            <div key={report.id} className="card">
              <div className="row-between">
                <div className="row" style={{ gap: '0.4rem' }}>
                  <Badge>{report.kind}</Badge>
                  <Badge tone={report.status === 'resolved' ? 'success' : 'info'}>{report.status.replace(/_/g, ' ')}</Badge>
                  <span className="text-xs text-muted">{report.reference}</span>
                </div>
                <span className="text-xs text-muted">{fmtDateTime(report.created_at)}</span>
              </div>
              <h3 style={{ fontSize: '1rem', marginTop: '0.35rem' }}>{report.subject}</h3>
              <p className="text-sm text-muted">{report.description}</p>
              {report.resolution ? <Alert tone="success" title="Resolution">{report.resolution}</Alert> : null}
              <div className="card-meta">
                {report.municipality_name ? <span><MapPin size={11} aria-hidden="true" /> {report.municipality_name}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FileText}
          title="No submissions yet"
          description="Submissions you send through the contact form appear here with their review status."
          action={<Link className="btn btn-primary" to="/contact">Send feedback</Link>}
        />
      )}
    </div>
  )
}

/* ------------------------- Application tracking -------------------------- */
export function ApplicationsPage() {
  const { t } = useLang()
  useDocumentTitle(t('p4.applications', 'Application tracking'))
  const [params, setParams] = useSearchParams()
  const status = params.get('status') || ''
  const q = params.get('q') || ''
  const sort = params.get('sort') || 'newest'
  const page = Number(params.get('page') || 1)
  const [term, setTerm] = useState(q)
  const query = `/account/applications?status=${status}&q=${encodeURIComponent(q)}&sort=${sort}&page=${page}`
  const { data, loading } = useApi(query)

  const update = (patch) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, String(value))
      else next.delete(key)
    })
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }

  const counts = data?.counts
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / (data?.limit || 20)))

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('dash.eyebrowAccount', 'Account')}
        title={t('p4.applications', 'Application tracking')}
        description={t('p4.applicationsNote')}
        breadcrumbs={[{ label: t('dash.breadcrumb', 'Dashboard'), to: '/dashboard' }, { label: t('p4.applications', 'Application tracking') }]}
      />

      {counts ? (
        <div className="stat-grid mt-4">
          <div className="stat-card"><div className="stat-label">All records</div><div className="stat-value">{counts.total}</div></div>
          <div className="stat-card"><div className="stat-label">Submitted</div><div className="stat-value">{counts.submitted}</div></div>
          <div className="stat-card"><div className="stat-label">In BetterGo review</div><div className="stat-value">{counts.inReview}</div></div>
          <div className="stat-card"><div className="stat-label">Closed</div><div className="stat-value">{counts.closed}</div></div>
        </div>
      ) : null}

      <div className="card mt-4">
        <form
          className="row"
          style={{ gap: '0.5rem', flexWrap: 'wrap' }}
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: term })
          }}
        >
          <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search by reference or service" aria-label="Search records" style={{ flex: '1 1 220px' }} />
          <Select value={status} onChange={(event) => update({ status: event.target.value })} aria-label="Filter by status" style={{ maxWidth: 220 }}>
            <option value="">Every status</option>
            {Object.entries(data?.statuses || {}).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select value={sort} onChange={(event) => update({ sort: event.target.value })} aria-label="Sort" style={{ maxWidth: 180 }}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="status">By status</option>
          </Select>
          <Button type="submit" variant="outline" size="sm" icon={Search}>Search</Button>
          {status || q || sort !== 'newest' ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => { setTerm(''); setParams(new URLSearchParams(), { replace: true }) }}>Clear</Button>
          ) : null}
        </form>
      </div>

      {loading ? (
        <SkeletonList count={2} height={90} />
      ) : data?.results?.length ? (
        <>
          <div className="table-wrap mt-4">
            <table className="data">
              <thead>
                <tr><th>Reference</th><th>Service</th><th>{t('p4.applicationStatus', 'Tracking status')}</th><th>Submitted</th><th>Updated</th></tr>
              </thead>
              <tbody>
                {data.results.map((application) => (
                  <tr key={application.reference}>
                    <td className="nowrap"><Link to={`/dashboard/applications/${application.reference}`}>{application.reference}</Link></td>
                    <td>{application.service_title || '—'}</td>
                    <td><Badge tone={['closed', 'completed'].includes(application.status) ? 'neutral' : application.status === 'withdrawn' ? 'warning' : 'info'}>{data.statuses?.[application.status] || application.status}</Badge></td>
                    <td className="nowrap">{application.submitted_at ? fmtDate(application.submitted_at) : '—'}</td>
                    <td className="nowrap">{fmtDate(application.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <nav className="pagination mt-3" aria-label="Pages">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>Previous</Button>
              <span className="text-sm text-muted">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => update({ page: page + 1 })}>Next</Button>
            </nav>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={FileText}
          title={q || status ? 'No records match those filters' : t('p4.noApplications', 'You have no tracked applications.')}
          description={t('p4.applicationsNote')}
          action={<Link className="btn btn-primary" to="/services">{t('p4.browseServices', 'Browse the directory')}</Link>}
        />
      )}
      <Alert tone="info" title={t('p4.notGovernment', 'Not a government status')}>{t('p4.applicationsNote')}</Alert>
    </div>
  )
}

export function ApplicationDetailPage() {
  const { t } = useLang()
  const { reference } = useParams()
  const { data, loading, error, reload } = useApi(`/account/applications/${reference}`)
  const [withdrawing, setWithdrawing] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [resubmitting, setResubmitting] = useState(false)
  const [update, setUpdate] = useState('')
  const toast = useToast()
  useDocumentTitle(reference || t('p4.applications', 'Application tracking'))

  if (loading) return <SkeletonList count={2} height={140} />
  if (error || !data?.application) {
    return (
      <div className="section-tight">
        <EmptyState
          icon={FileText}
          title="Application not found"
          description="This reference does not belong to your account, or it may have been removed."
          action={<Link className="btn btn-primary" to="/dashboard/applications">{t('p4.applications', 'Application tracking')}</Link>}
        />
      </div>
    )
  }

  const application = data.application

  const withdraw = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api.post(`/account/applications/${reference}/withdraw`, { reason })
      toast.push('Withdrawn on BetterGo. The record is kept for audit.')
      setWithdrawing(false)
      await reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const resubmit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api.post(`/account/applications/${reference}/resubmit`, { note: update })
      toast.push('Additional information sent to BetterGo.')
      setResubmitting(false)
      setUpdate('')
      await reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('dash.eyebrowAccount', 'Account')}
        title={application.serviceTitle || application.reference}
        description={application.classificationLabel}
        breadcrumbs={[
          { label: t('dash.breadcrumb', 'Dashboard'), to: '/dashboard' },
          { label: t('p4.applications', 'Application tracking'), to: '/dashboard/applications' },
          { label: application.reference },
        ]}
        actions={
          <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
            {data.actions?.canResubmit ? <Button size="sm" onClick={() => setResubmitting(true)}>Provide information</Button> : null}
            {data.actions?.canWithdraw ? <Button size="sm" variant="outline" onClick={() => setWithdrawing(true)}>Withdraw</Button> : null}
          </div>
        }
      />

      <Alert tone="info" title="BetterGo platform record">{application.classificationNote}</Alert>

      <div className="grid grid-2 mt-4" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Record</h2>
          <dl className="detail-list">
            <div><dt>Reference</dt><dd>{application.reference}</dd></div>
            <div><dt>{t('p4.applicationStatus', 'Tracking status')}</dt><dd><Badge tone="info">{application.statusLabel}</Badge></dd></div>
            <div><dt>{t('dash.municipality', 'Municipality')}</dt><dd>{application.municipalityName || t('dash.notSet', 'Not set')}</dd></div>
            <div><dt>Form</dt><dd>{application.formTitle || '—'}{application.formVersion ? ` · v${application.formVersion}` : ''}</dd></div>
            <div><dt>Submitted</dt><dd>{application.submittedAt ? fmtDateTime(application.submittedAt) : 'Not submitted'}</dd></div>
            <div><dt>Privacy notice</dt><dd>{application.privacyNoticeVersion || '—'}{application.consentedAt ? ` · consented ${fmtDate(application.consentedAt)}` : ''}</dd></div>
          </dl>
          {application.citizenStatusNote ? <p className="text-sm mt-3">{application.citizenStatusNote}</p> : null}
          {application.externalReference ? (
            <p className="text-sm mt-3">External reference: {application.externalReference}</p>
          ) : (
            <p className="help mt-3">No external transaction reference exists, because nothing has been transmitted to a government office.</p>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Status timeline</h2>
          <ul className="timeline mt-2">
            {data.history.map((event, index) => (
              <li key={index}>
                <div className="text-sm">{event.label}</div>
                {event.note ? <div className="text-xs text-muted">{event.note}</div> : null}
                <div className="text-xs text-muted">{fmtDateTime(event.created_at)}</div>
              </li>
            ))}
          </ul>
          <p className="help">Only events recorded by BetterGo are shown. No estimated completion date is given.</p>
        </div>
      </div>

      {data.answers ? (
        <div className="card mt-4">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Submitted information</h2>
          <dl className="detail-list">
            {Object.entries(data.answers).map(([key, value]) => (
              <div key={key}>
                <dt>{key.replace(/_/g, ' ')}</dt>
                <dd>{Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value ?? '—')}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {data.documents?.length ? (
        <div className="card mt-4">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Attached documents</h2>
          <ul className="stack-sm">
            {data.documents.map((document) => (
              <li key={document.id} className="row-between">
                <span>{document.original_filename}</span>
                <span className="text-xs text-muted">{fmtDate(document.created_at)}</span>
              </li>
            ))}
          </ul>
          <p className="help">These files stay in your private vault. They have not been sent to any office.</p>
        </div>
      ) : null}

      <Modal open={withdrawing} onClose={() => setWithdrawing(false)} title="Withdraw this BetterGo record" actions={<><Button variant="outline" onClick={() => setWithdrawing(false)}>Keep record</Button><Button variant="danger" onClick={withdraw} loading={busy}>Withdraw</Button></>}>
        <p className="text-sm">
          Withdrawing stops this BetterGo record from being reviewed. The record and its history are kept for audit, and information you already
          submitted is not deleted. If this record was ever referred through an authorised integration, withdrawing here does not automatically
          withdraw any separate government application.
        </p>
        <Field label="Reason (optional)" htmlFor="withdraw-reason">
          <Textarea id="withdraw-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} style={{ minHeight: 70 }} />
        </Field>
      </Modal>

      <Modal open={resubmitting} onClose={() => setResubmitting(false)} title="Provide the requested information" actions={<><Button variant="outline" onClick={() => setResubmitting(false)}>Cancel</Button><Button onClick={resubmit} loading={busy}>Send to BetterGo</Button></>}>
        <Field label="Additional information" htmlFor="resubmit-note" required help="Your earlier answers are kept; this is added to the record.">
          <Textarea id="resubmit-note" value={update} onChange={(event) => setUpdate(event.target.value)} maxLength={1000} style={{ minHeight: 100 }} />
        </Field>
      </Modal>
    </div>
  )
}

/* ---------------------------- Activity history --------------------------- */
export function ActivityPage() {
  const { t } = useLang()
  useDocumentTitle(t('p4.activityTitle', 'Activity history'))
  const { data, loading, reload } = useApi('/account/activity')
  const toast = useToast()

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('dash.eyebrowAccount', 'Account')}
        title={t('p4.activityTitle', 'Activity history')}
        description={t('p4.activityDesc')}
        breadcrumbs={[{ label: t('dash.breadcrumb', 'Dashboard'), to: '/dashboard' }, { label: t('p4.activityTitle', 'Activity history') }]}
        actions={
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await api.del('/account/activity')
                toast.push('Activity history cleared.')
                reload()
              } catch (err) {
                toast.push(err.message, 'error')
              }
            }}
          >
            {t('p4.clearActivity', 'Clear my activity history')}
          </Button>
        }
      />
      {loading ? (
        <SkeletonList count={2} height={110} />
      ) : data?.results?.length ? (
        <div className="table-wrap mt-4">
          <table className="data">
            <thead><tr><th>Activity</th><th>Detail</th><th>When</th></tr></thead>
            <tbody>
              {data.results.map((entry) => (
                <tr key={`${entry.source}-${entry.id}`}>
                  <td>{String(entry.action || '').replace(/[._]/g, ' ')}</td>
                  <td>{entry.label || '—'}</td>
                  <td className="nowrap">{fmtDateTime(entry.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={FileText} title={t('p4.noActivity', 'No activity recorded yet.')} description={t('p4.activityDesc')} />
      )}
    </div>
  )
}

/* ------------------------------- Documents ------------------------------- */
export { VaultPage as DocumentsPage } from './Documents'
