import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, MapPin, Phone, ShieldCheck, Building2, AlertTriangle, FileText } from 'lucide-react'
import { fmtDate, fmtNumber, relative } from '../api'
import { Badge, VerificationBadge } from './ui'

export function SectionHeading({ eyebrow, title, description, action }) {
  return (
    <div className="row-between" style={{ alignItems: 'flex-end', marginBottom: 'var(--space-5)', gap: 'var(--space-4)' }}>
      <div className="section-heading" style={{ marginBottom: 0 }}>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function ServiceCard({ service }) {
  return (
    <Link to={`/services/${service.slug}`} className="card card-interactive card-link">
      <div className="row-between" style={{ gap: '0.5rem' }}>
        <span className="badge badge-neutral">{service.category_name || 'Service'}</span>
        <VerificationBadge status={service.verification_status} />
      </div>
      <h3>{service.title}</h3>
      {service.description ? <p>{service.description.slice(0, 180)}{service.description.length > 180 ? '…' : ''}</p> : null}
      <div className="card-meta">
        {service.office_name ? <span>{service.office_name}</span> : null}
        {service.municipality_name ? <span><MapPin size={12} aria-hidden="true" /> {service.municipality_name}</span> : <span>Province-wide</span>}
        {service.processing_time ? <span>{service.processing_time}</span> : null}
      </div>
      <div className="card-actions">
        <span className="text-xs text-muted">
          {Number(service.requirement_count) > 0 ? `${service.requirement_count} requirements listed` : 'Requirements not yet recorded'}
        </span>
        <span className="badge badge-success" style={{ marginLeft: 'auto' }}>View details <ArrowRight size={12} aria-hidden="true" /></span>
      </div>
    </Link>
  )
}

export function MunicipalityCard({ municipality }) {
  return (
    <Link to={`/municipalities/${municipality.slug}`} className="card card-interactive card-link">
      <div className="card-icon" aria-hidden="true"><MapPin size={22} /></div>
      <h3>{municipality.name}</h3>
      <p>{municipality.description || 'Municipality information is being verified.'}</p>
      <div className="card-meta">
        <span>{fmtNumber(municipality.announcement_count || 0)} announcements</span>
        <span>{fmtNumber(municipality.service_count || 0)} services</span>
        <span>{fmtNumber(municipality.office_count || 0)} offices</span>
      </div>
      <div className="card-actions">
        <span className="badge badge-success">Open municipality <ArrowRight size={12} aria-hidden="true" /></span>
      </div>
    </Link>
  )
}

export function AnnouncementCard({ announcement, featured }) {
  const source = announcement.source_organization || (announcement.source_type === 'bettergo' ? 'BetterGo Marinduque' : null)
  return (
    <Link to={`/announcements/${announcement.slug}`} className="card card-flush card-link card-interactive" style={featured ? { gridColumn: 'span 2' } : undefined}>
      <div className="card-media" aria-hidden={!announcement.featured_image}>
        {announcement.featured_image ? <img src={announcement.featured_image} alt="" loading="lazy" /> : <FileText size={32} />}
      </div>
      <div className="card-body">
        <div className="row" style={{ gap: '0.4rem' }}>
          {announcement.category_name ? <Badge>{announcement.category_name}</Badge> : null}
          {announcement.is_featured ? <Badge tone="warning">Featured</Badge> : null}
          <VerificationBadge status={announcement.verification_status} />
        </div>
        <h3>{announcement.title}</h3>
        {announcement.summary ? <p>{announcement.summary}</p> : null}
        <div className="card-meta">
          <span><CalendarDays size={12} aria-hidden="true" /> {fmtDate(announcement.published_at || announcement.created_at)}</span>
          {announcement.municipality_name ? <span>{announcement.municipality_name}</span> : <span>Province-wide</span>}
          {source ? <span>{source}</span> : null}
        </div>
        <div className="card-actions">
          <span className="badge badge-success">Read more <ArrowRight size={12} aria-hidden="true" /></span>
        </div>
      </div>
    </Link>
  )
}

export function OfficeCard({ office }) {
  return (
    <Link to={`/government-directory/${office.slug}`} className="card card-interactive card-link">
      <div className="row-between">
        <span className="badge badge-neutral">{office.government_level === 'national' ? 'National agency' : office.government_level === 'municipal' ? 'Municipal office' : 'Provincial office'}</span>
        <VerificationBadge status={office.verification_status} />
      </div>
      <h3>{office.name}</h3>
      <p>{office.description || 'Office description has not been verified yet.'}</p>
      <div className="card-meta">
        {office.category ? <span>{office.category}</span> : null}
        {office.municipality_name ? <span><MapPin size={12} aria-hidden="true" /> {office.municipality_name}</span> : <span>Province-wide</span>}
        {office.phone ? <span><Phone size={12} aria-hidden="true" /> {office.phone}</span> : null}
      </div>
      <div className="card-actions">
        <span className="badge badge-success">View office <ArrowRight size={12} aria-hidden="true" /></span>
      </div>
    </Link>
  )
}

export function EmergencyCard({ contact }) {
  const verifiedNumber = contact.phone && contact.verification_status === 'verified'
  return (
    <div className="card" style={{ borderLeft: '4px solid var(--danger)' }}>
      <div className="row" style={{ gap: '0.4rem' }}>
        <Badge tone="danger"><AlertTriangle size={11} aria-hidden="true" /> {contact.category?.replace(/_/g, ' ')}</Badge>
        {contact.municipality_name ? <Badge>{contact.municipality_name}</Badge> : <Badge>National</Badge>}
      </div>
      <h3 style={{ marginTop: '0.35rem' }}>{contact.organization_name}</h3>
      {contact.description ? <p className="text-small text-muted">{contact.description}</p> : null}
      {contact.phone ? (
        <div className="emergency-number">
          {verifiedNumber ? (
            <a className="tel-link" href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`} aria-label={`Call ${contact.organization_name} on ${contact.phone}`}>
              <Phone size={20} aria-hidden="true" /> {contact.phone}
            </a>
          ) : (
            <span style={{ color: 'var(--text-secondary)' }}>{contact.phone}</span>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">No verified telephone number published.</p>
      )}
      <div className="card-meta">
        {contact.address ? <span>{contact.address}</span> : null}
        {contact.operating_hours ? <span>{contact.operating_hours}</span> : null}
        <span>Last verified: {contact.last_verified_at ? fmtDate(contact.last_verified_at) : 'not recorded'}</span>
      </div>
      <div className="card-actions">
        <VerificationBadge status={contact.verification_status} />
        {contact.website ? (
          <a className="btn btn-outline btn-sm" href={contact.website} target="_blank" rel="noopener noreferrer">
            Official website
          </a>
        ) : null}
      </div>
      {!verifiedNumber && contact.phone ? (
        <p className="help">This number has not been verified against an official source. Confirm before relying on it in an emergency.</p>
      ) : null}
    </div>
  )
}

export function StatCard({ label, value, hint, icon: Icon }) {
  return (
    <div className="card stat-card">
      <div className="row-between">
        <span className="stat-label">{label}</span>
        {Icon ? <Icon size={16} aria-hidden="true" style={{ color: 'var(--text-muted)' }} /> : null}
      </div>
      <span className="stat-value">{value}</span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  )
}

export function TransparencyCard({ title, count, description, to, comingSoon }) {
  const content = (
    <>
      <div className="card-icon" aria-hidden="true"><ShieldCheck size={22} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      <div className="card-actions">
        {comingSoon ? (
          <Badge tone="warning">Coming soon</Badge>
        ) : (
          <span className="badge badge-neutral">{fmtNumber(count || 0)} published record{Number(count) === 1 ? '' : 's'}</span>
        )}
      </div>
    </>
  )
  if (comingSoon) return <div className="card">{content}</div>
  return <Link to={to} className="card card-interactive card-link">{content}</Link>
}

export function ProjectCardPlaceholder() {
  return (
    <div className="card" style={{ opacity: 0.95 }}>
      <div className="row-between">
        <Badge tone="warning">Coming soon</Badge>
        <Building2 size={16} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
      </div>
      <h3>Infrastructure project monitoring</h3>
      <p>
        Public project records will appear here once verified information from responsible offices is published. BetterGo does not
        create project records or progress figures.
      </p>
      <div className="card-meta"><span>Module planned for a later phase</span></div>
    </div>
  )
}

export function UpdatedStamp({ value }) {
  return <span className="text-xs text-muted">Last updated {relative(value)}</span>
}
