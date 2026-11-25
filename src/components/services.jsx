import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AVAILABILITY_META, CAPABILITY_META, VERIFICATION_META, capabilityFor } from '../lib/serviceMeta'
import {
  Accessibility,
  ArrowRight,
  Briefcase,
  BriefcaseBusiness,
  Building2,
  Car,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  ContactRound,
  ExternalLink,
  FileText,
  Fish,
  FolderOpen,
  GraduationCap,
  HandHeart,
  HeartPulse,
  House,
  Info,
  Landmark,
  LifeBuoy,
  MapPin,
  MapPinned,
  Receipt,
  Scale,
  ShieldCheck,
  Sprout,
  Star,
  Store,
  Trees,
  Trophy,
  Users,
  UsersRound,
  X,
} from 'lucide-react'
import { api, fmtDate, fmtPeso } from '../api'
import { Alert, Badge, Button, EmptyState, Select, Textarea, useToast } from './ui'

/* ------------------------------ Category icons ---------------------------- */
const ICONS = {
  FileText,
  HeartPulse,
  HandHeart,
  Users,
  Accessibility,
  UsersRound,
  BriefcaseBusiness,
  Receipt,
  Building2,
  GraduationCap,
  Briefcase,
  Store,
  Sprout,
  Fish,
  Trees,
  House,
  Car,
  ShieldCheck,
  LifeBuoy,
  Trophy,
  MapPinned,
  Scale,
  Landmark,
  ContactRound,
  FolderOpen,
}

export function CategoryIcon({ name, size = 22 }) {
  const Icon = ICONS[name] || FolderOpen
  return <Icon size={size} aria-hidden="true" />
}

/* -------------------------------- Badges --------------------------------- */
export function ServiceStatusBadge({ status }) {
  const meta = AVAILABILITY_META[status] || { label: status || 'Status not recorded', tone: 'neutral' }
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}

export function ServiceVerificationBadge({ status }) {
  const meta = VERIFICATION_META[status] || { label: status || 'Not verified', tone: 'neutral' }
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}

/** What the record actually supports: information, a link, a form or nothing yet. */
export function ServiceCapabilityBadge({ capability, service, compact = false }) {
  const key = capability || capabilityFor(service || {})
  const meta = CAPABILITY_META[key] || CAPABILITY_META.information_only
  return <Badge tone={meta.tone}>{compact ? meta.short : meta.label}</Badge>
}

/* ----------------------------- Category cards ----------------------------- */
export function ServiceCategoryCard({ category, featured }) {
  return (
    <Link
      to={`/services/category/${category.slug}`}
      className={`card card-interactive card-link ${featured ? 'card-accent' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
    >
      <div className="row-between">
        <div className="card-icon" aria-hidden="true">
          <CategoryIcon name={category.icon} />
        </div>
        {category.is_featured ? <Badge tone="info">Featured</Badge> : null}
      </div>
      <h3 style={{ marginBottom: 0 }}>{category.name}</h3>
      {category.description ? <p style={{ margin: 0 }}>{category.description}</p> : null}
      <div className="card-meta">
        <span>
          {Number(category.total_service_count ?? category.service_count ?? 0) === 0
            ? 'No published services yet'
            : `${category.total_service_count ?? category.service_count} published service${Number(category.total_service_count ?? category.service_count) === 1 ? '' : 's'}`}
        </span>
        {category.children?.length ? <span>{category.children.length} subcategories</span> : null}
      </div>
      <div className="card-actions">
        <span className="badge badge-success" style={{ marginLeft: 'auto' }}>
          Explore category <ArrowRight size={12} aria-hidden="true" />
        </span>
      </div>
    </Link>
  )
}

/* ----------------------------- Service card ------------------------------ */
export function ServiceCard({ service }) {
  const feeText =
    service.fee_min_cents === null || service.fee_min_cents === undefined
      ? null
      : service.fee_min_cents === service.fee_max_cents
        ? fmtPeso(service.fee_min_cents)
        : `${fmtPeso(service.fee_min_cents)} – ${fmtPeso(service.fee_max_cents)}`
  return (
    <Link to={`/services/${service.slug}`} className="card card-interactive card-link">
      <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
        {service.category_name ? <Badge>{service.category_name}</Badge> : null}
        <ServiceVerificationBadge status={service.verification_status} />
        <ServiceCapabilityBadge service={service} compact />
      </div>
      <h3>{service.title}</h3>
      {service.short_description || service.description ? (
        <p>{(service.short_description || service.description).slice(0, 190)}{(service.short_description || service.description).length > 190 ? '…' : ''}</p>
      ) : (
        <p className="text-muted">A description has not been recorded for this service yet.</p>
      )}
      <div className="card-meta">
        {service.office_name ? <span>{service.office_name}</span> : null}
        <span><MapPin size={12} aria-hidden="true" /> {service.municipality_name || 'Province-wide'}</span>
        {service.processing_time_detail ? <span>{service.processing_time_detail}</span> : null}
        {feeText ? <span>{feeText}</span> : null}
      </div>
      <div className="card-actions">
        <span className="text-xs text-muted">
          {Number(service.requirement_count) > 0 ? `${service.requirement_count} requirement${Number(service.requirement_count) === 1 ? '' : 's'}` : 'Requirements not yet recorded'}
        </span>
        <span className="badge badge-success" style={{ marginLeft: 'auto' }}>
          View details <ArrowRight size={12} aria-hidden="true" />
        </span>
      </div>
    </Link>
  )
}

/* --------------------------- Requirement checklist ----------------------- */
export function RequirementsChecklist({ serviceSlug, requirements }) {
  const storageKey = `bettergo:checklist:${serviceSlug}`
  const [checked, setChecked] = useState({})

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || '{}')
      setChecked(saved && typeof saved === 'object' ? saved : {})
    } catch {
      setChecked({})
    }
  }, [storageKey])

  const toggle = (id) => {
    setChecked((current) => {
      const next = { ...current, [id]: !current[id] }
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        /* private browsing: the checklist still works for this visit */
      }
      return next
    })
  }

  if (!requirements?.length) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Requirements have not been recorded yet"
        description="BetterGo only shows requirements confirmed by a named source. Check with the responsible office before preparing documents."
      />
    )
  }

  const done = requirements.filter((item) => checked[item.id]).length
  return (
    <div>
      <div className="row-between no-print" style={{ marginBottom: '0.6rem' }}>
        <span className="text-sm text-muted">Personal checklist — saved only in this browser</span>
        <span className="badge badge-neutral">{done} of {requirements.length} ready</span>
      </div>
      <ul className="checklist" style={{ listStyle: 'none', padding: 0 }}>
        {requirements.map((item) => (
          <li key={item.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
            <input
              id={`requirement-${item.id}`}
              type="checkbox"
              checked={Boolean(checked[item.id])}
              onChange={() => toggle(item.id)}
              style={{ marginTop: 4 }}
            />
            <label htmlFor={`requirement-${item.id}`} style={{ flex: 1, cursor: 'pointer' }}>
              <strong style={{ display: 'block' }}>{item.requirement_name}</strong>
              {item.description ? <span className="text-sm text-muted">{item.description}</span> : null}
              <span className="text-xs text-muted" style={{ display: 'block' }}>
                {item.is_required ? 'Required' : 'Optional'}
                {item.quantity ? ` · ${item.quantity}` : ''}
                {item.accepted_format ? ` · ${item.accepted_format}` : ''}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="help">This checklist is a personal note. It is not an official application and does not submit anything to a government office.</p>
    </div>
  )
}

/* ---------------------------------- Fees --------------------------------- */
export function ServiceFees({ fees }) {
  if (!fees?.length) {
    return <p className="text-muted">No fee has been recorded. Confirm the current fee with the responsible office before paying anything.</p>
  }
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">Service fees</caption>
        <thead>
          <tr><th scope="col">Fee</th><th scope="col">Amount</th><th scope="col">Type</th><th scope="col">Conditions</th></tr>
        </thead>
        <tbody>
          {fees.map((fee) => (
            <tr key={fee.id}>
              <td>{fee.fee_name}</td>
              <td>{fee.amount_cents === null ? 'Not recorded' : fmtPeso(fee.amount_cents)}</td>
              <td>{String(fee.fee_type || '').replace(/_/g, ' ')}</td>
              <td>
                {fee.conditions || '—'}
                {fee.source_reference ? <span className="text-xs text-muted" style={{ display: 'block' }}>Source: {fee.source_reference}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ProcessingTime({ items }) {
  if (!items?.length) return <p className="text-muted">Processing time has not been recorded.</p>
  return (
    <ul className="detail-list">
      {items.map((item) => (
        <li key={item.id}>
          <span>{item.processing_time} <span className="text-muted">({item.processing_unit})</span></span>
          {item.conditions ? <span>{item.conditions}</span> : null}
          {item.source_reference ? <span className="text-xs text-muted">{item.source_reference}</span> : null}
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------- Procedures ------------------------------ */
export function ServiceProcedures({ procedures }) {
  if (!procedures?.length) {
    return <p className="text-muted">Application steps have not been recorded yet. Ask the responsible office for the current procedure.</p>
  }
  return (
    <ol className="step-list">
      {procedures.map((step) => (
        <li key={step.id}>
          <span className="step-num" aria-hidden="true">{step.step_number}</span>
          <div>
            <strong style={{ display: 'block' }}>{step.title}</strong>
            {step.description ? <p className="text-sm text-muted" style={{ margin: '0.2rem 0' }}>{step.description}</p> : null}
            <div className="card-meta">
              {step.office ? <span>{step.office}</span> : null}
              {step.location ? <span><MapPin size={12} aria-hidden="true" /> {step.location}</span> : null}
              {step.additional_instructions ? <span>{step.additional_instructions}</span> : null}
            </div>
            {step.link ? (
              <a className="btn btn-outline btn-sm" href={step.link} target="_blank" rel="noopener noreferrer">
                Open step link <ExternalLink size={12} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

/* -------------------------------- Coverage ------------------------------- */
export function ServiceCoverageList({ coverage, service }) {
  if (!coverage?.length) {
    const scope = service?.service_scope
    return (
      <p className="text-muted">
        {scope === 'online_province_wide'
          ? 'This is an online service and no municipal office coverage has been recorded.'
          : 'Municipality coverage has not been recorded. Confirm availability with the responsible office.'}
      </p>
    )
  }
  return (
    <ul className="detail-list">
      {coverage.map((row) => (
        <li key={row.id}>
          <span>
            {row.barangay_name ? `${row.barangay_name}, ` : ''}
            {row.municipality_name || 'Province-wide'}
          </span>
          <ServiceStatusBadge status={row.availability_status} />
          {row.local_instructions ? <span className="text-sm text-muted">{row.local_instructions}</span> : null}
          {row.office_name ? <span className="text-xs text-muted">{row.office_name}</span> : null}
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------ Source panel ----------------------------- */
export function ServiceSourcePanel({ service }) {
  const hasSource = Boolean(
    service.source_name || service.source_reference || service.source_url || service.source_registry_url,
  )
  return (
    <div>
      <dl className="detail-list">
        <div>
          <dt>Verification</dt>
          <dd><ServiceVerificationBadge status={service.verification_status} /></dd>
        </div>
        <div>
          <dt>Last reviewed</dt>
          <dd>{service.last_reviewed_at ? fmtDate(service.last_reviewed_at) : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Next review</dt>
          <dd>{service.next_review_at ? fmtDate(service.next_review_at) : 'Not scheduled'}</dd>
        </div>
        {service.source_name ? (
          <div><dt>Source</dt><dd>{service.source_name}{service.source_organization ? ` — ${service.source_organization}` : ''}</dd></div>
        ) : null}
        {service.source_reference ? (
          <div><dt>Reference</dt><dd>{service.source_reference}</dd></div>
        ) : null}
      </dl>
      {service.source_url || service.source_registry_url ? (
        <a className="btn btn-outline btn-sm" href={service.source_url || service.source_registry_url} target="_blank" rel="noopener noreferrer">
          Open source <ExternalLink size={12} aria-hidden="true" />
        </a>
      ) : null}
      {!hasSource ? (
        <Alert tone="warning" title="No source recorded">
          This record does not yet cite an official source. Treat the details as unconfirmed and check with the responsible office.
        </Alert>
      ) : null}
    </div>
  )
}

/* ------------------------------ Feedback panel ---------------------------- */
export function RatingInput({ value, onChange }) {
  return (
    <div className="row" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star === 1 ? '' : 's'}`}
          className="btn-icon"
          onClick={() => onChange(star)}
          style={{ color: star <= value ? 'var(--warning)' : 'var(--text-muted)' }}
        >
          <Star size={22} fill={star <= value ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

export function ServiceFeedback({ slug, summary, initial, user }) {
  const toast = useToast()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(initial || [])
  const [stats, setStats] = useState(summary || { total: 0, average: null })
  const [error, setError] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post(`/services/${slug}/feedback`, { rating: rating || undefined, comment: comment.trim() || undefined })
      toast.push('Thank you. Your feedback was received for review.')
      setComment('')
      setRating(0)
      const refreshed = await api.get(`/services/${slug}/feedback`)
      setResults(refreshed.results || [])
      setStats(refreshed.summary || stats)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" id="feedback">
      <h2 style={{ marginTop: 0 }}>Citizen feedback</h2>
      <p className="text-sm text-muted">
        Feedback is reviewed before it appears. It is citizen input for BetterGo, not an official complaint or a government service rating.
      </p>
      {stats.total ? (
        <p className="text-sm">
          <strong>{stats.average || '—'} / 5</strong> from {stats.total} published review{stats.total === 1 ? '' : 's'}.
        </p>
      ) : (
        <p className="text-sm text-muted">No published feedback yet.</p>
      )}

      {user ? (
        <form onSubmit={submit} style={{ marginTop: '0.75rem' }}>
          <div className="field">
            <span className="label" id="rating-label">Your rating</span>
            <RatingInput value={rating} onChange={setRating} />
          </div>
          <div className="field">
            <label className="label" htmlFor="feedback-comment">Comment (optional)</label>
            <Textarea
              id="feedback-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What worked, what was unclear, or what should be updated?"
            />
            <span className="help">Do not include personal information such as ID numbers or addresses.</span>
          </div>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" loading={busy}>Send feedback</Button>
        </form>
      ) : (
        <Alert tone="info">
          <Link to="/login">Sign in</Link> to rate this service or leave feedback. Your account details are never shown publicly.
        </Alert>
      )}

      {results.length ? (
        <ul className="timeline" style={{ marginTop: '1rem' }}>
          {results.map((item) => (
            <li key={item.id}>
              <div className="row-between">
                <span className="badge badge-neutral" aria-label={`${item.rating} out of 5`}>
                  {item.rating ? `${item.rating} / 5` : 'Comment'}
                </span>
                <span className="text-xs text-muted">{fmtDate(item.created_at)}</span>
              </div>
              {item.comment ? <p className="text-sm" style={{ margin: '0.3rem 0 0' }}>{item.comment}</p> : null}
              <span className="text-xs text-muted">Registered resident</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/* ------------------------------ Filter controls --------------------------- */
export function ServiceFilters({ filters, setFilter, facets, lookups, compact }) {
  return (
    <div className={compact ? 'form-grid' : 'toolbar'} style={{ alignItems: 'flex-end' }}>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label" htmlFor="filter-category">Category</label>
        <Select id="filter-category" value={filters.category} onChange={(event) => setFilter('category', event.target.value)}>
          <option value="">All categories</option>
          {(facets?.categories || [])
            .filter((category) => !category.parent_id)
            .map((category) => (
              <option key={category.slug} value={category.slug}>{category.name}</option>
            ))}
        </Select>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label" htmlFor="filter-municipality">Municipality</label>
        <Select id="filter-municipality" value={filters.municipality} onChange={(event) => setFilter('municipality', event.target.value)}>
          <option value="">All Marinduque</option>
          {(lookups?.municipalities || []).map((municipality) => (
            <option key={municipality.slug} value={municipality.slug}>{municipality.name}</option>
          ))}
        </Select>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label" htmlFor="filter-availability">Availability</label>
        <Select id="filter-availability" value={filters.availability} onChange={(event) => setFilter('availability', event.target.value)}>
          <option value="">Any availability</option>
          {Object.entries(AVAILABILITY_META).filter(([key]) => key !== 'archived').map(([key, meta]) => (
            <option key={key} value={key}>{meta.label}</option>
          ))}
        </Select>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label" htmlFor="filter-verification">Verification</label>
        <Select id="filter-verification" value={filters.verification} onChange={(event) => setFilter('verification', event.target.value)}>
          <option value="">Any verification</option>
          {Object.entries(VERIFICATION_META).filter(([key]) => key !== 'archived').map(([key, meta]) => (
            <option key={key} value={key}>{meta.label}</option>
          ))}
        </Select>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label" htmlFor="filter-sort">Sort</label>
        <Select id="filter-sort" value={filters.sort} onChange={(event) => setFilter('sort', event.target.value)}>
          <option value="">Relevance</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name (A–Z)</option>
        </Select>
      </div>
    </div>
  )
}

/* ------------------------------- Disclaimer ------------------------------ */
export function ServiceDisclaimer({ compact }) {
  return (
    <p className={compact ? 'help' : 'callout-emergency'} style={compact ? undefined : { fontSize: '0.82rem' }}>
      <Info size={14} aria-hidden="true" /> BetterGo Marinduque is an independent civic platform, not an official government
      website. Service information is published with its verification status. Always confirm requirements, fees and availability
      with the responsible office before travelling or paying.
    </p>
  )
}

