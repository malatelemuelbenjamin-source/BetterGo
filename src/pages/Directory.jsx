import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  Building2,
  Clock,
  ExternalLink,
  Facebook,
  Globe,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
} from 'lucide-react'
import { api, fmtDate, query } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  Pagination,
  Select,
  SkeletonList,
  Textarea,
  VerificationBadge,
  useToast,
} from '../components/ui'
import { PageHeader } from '../components/layout'
import SaveButton from '../components/SaveButton'
import { OfficeCard, SectionHeading } from '../components/cards'

const LEVELS = [
  { value: 'provincial', label: 'Provincial offices' },
  { value: 'municipal', label: 'Municipal offices' },
  { value: 'national', label: 'National agencies' },
]

function CorrectionForm({ open, onClose, target }) {
  const toast = useToast()
  const [form, setForm] = useState({ field: 'contact', description: '', contactEmail: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/corrections', {
        targetType: target.type,
        targetId: target.id,
        targetLabel: target.label,
        field: form.field,
        description: form.description,
        contactEmail: form.contactEmail,
      })
      toast.push('Thank you. The correction was sent for review.')
      onClose()
      setForm({ field: 'contact', description: '', contactEmail: '' })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Report incorrect information">
      <p className="text-sm text-muted">
        Report an incorrect telephone number, address, operating hours or broken link for <strong>{target?.label}</strong>. Reports are
        reviewed by an administrator and are never published automatically.
      </p>
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      <form onSubmit={submit} className="mt-3">
        <Field label="What is incorrect?" htmlFor="correction-field">
          <Select id="correction-field" value={form.field} onChange={(event) => setForm({ ...form, field: event.target.value })}>
            <option value="contact">Telephone number</option>
            <option value="email">Email address</option>
            <option value="address">Office address</option>
            <option value="hours">Operating hours</option>
            <option value="link">Broken official link</option>
            <option value="description">Office description</option>
            <option value="other">Other inaccuracy</option>
          </Select>
        </Field>
        <Field label="Details" htmlFor="correction-description" required error={error?.details?.find((d) => d.field === 'description')?.message}>
          <Textarea
            id="correction-description"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            required
            minLength={10}
            maxLength={3000}
            placeholder="Describe what is wrong and, if possible, the correct information and its source."
          />
        </Field>
        <Field label="Your email (optional)" htmlFor="correction-email" help="Only used to follow up on this report. Never published.">
          <input
            id="correction-email"
            className="input"
            type="email"
            value={form.contactEmail}
            onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
            maxLength={200}
          />
        </Field>
        <div className="modal-actions">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Send report</Button>
        </div>
      </form>
    </Modal>
  )
}

export function DirectoryList() {
  const [params, setParams] = useSearchParams()
  const level = params.get('level') || ''
  const category = params.get('category') || ''
  const municipality = params.get('municipality') || ''
  const verified = params.get('verified') || ''
  const q = params.get('q') || ''
  const page = Number(params.get('page') || 1)
  const [term, setTerm] = useState(q)
  useDocumentTitle('Government directory')

  const { data: lookups } = useApi('/lookups')
  const { data, loading, error } = useApi(`/directory${query({ level, category, municipality, verified, q, page, limit: 9 })}`)

  const setParam = (key, value) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'page') next.delete('page')
      return next
    })
  }

  return (
    <>
      <PageHeader
        eyebrow="Government directory"
        title="Government offices"
        description="Provincial, municipal and national offices with verified public contact information. Only published records are listed."
        breadcrumbs={[{ label: 'Government directory' }]}
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
              placeholder="Search office, department or agency"
              aria-label="Search offices"
              maxLength={120}
            />
            <Select value={level} onChange={(event) => setParam('level', event.target.value)} aria-label="Government level">
              <option value="">All levels</option>
              {LEVELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </Select>
            <Select value={municipality} onChange={(event) => setParam('municipality', event.target.value)} aria-label="Municipality">
              <option value="">All Marinduque</option>
              {(lookups?.municipalities || []).map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
            </Select>
            <Select value={category} onChange={(event) => setParam('category', event.target.value)} aria-label="Office category">
              <option value="">All categories</option>
              {(data?.categories || []).map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
            <Select value={verified} onChange={(event) => setParam('verified', event.target.value)} aria-label="Verification">
              <option value="">Any status</option>
              <option value="true">Verified only</option>
            </Select>
            <Button type="submit">Apply</Button>
          </form>
        </div>

        <p className="text-sm text-muted">
          {loading ? 'Loading offices…' : `${data?.total || 0} published office${data?.total === 1 ? '' : 's'}`}
        </p>

        {loading ? (
          <SkeletonList count={6} height={200} />
        ) : error ? (
          <EmptyState title="Directory temporarily unavailable" description="Please try again shortly." action={<Button onClick={() => window.location.reload()}>Retry</Button>} />
        ) : data?.results?.length ? (
          <>
            <div className="grid grid-3">
              {data.results.map((office) => <OfficeCard key={office.id} office={office} />)}
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} onChange={(next) => setParam('page', String(next))} />
          </>
        ) : (
          <EmptyState
            icon={Building2}
            title="No offices match these filters"
            description="Office records are published after verification. Try clearing filters, or browse by municipality."
            action={<Button variant="outline" onClick={() => setParams({})}>Clear filters</Button>}
          />
        )}

        <Alert tone="info" title="About this directory">
          BetterGo distinguishes provincial, municipal and national offices. Not every national agency has an office in every
          municipality, and BetterGo does not publish contact details that have not been verified against a public source.
        </Alert>
      </div>
    </>
  )
}

export function OfficeDetail() {
  const { slug } = useParams()
  const { data, loading, error } = useApi(`/directory/${slug}`)
  const [correctionOpen, setCorrectionOpen] = useState(false)
  useDocumentTitle(data?.office?.name || 'Government office')

  if (loading) return <div className="container section"><SkeletonList count={2} height={240} /></div>
  if (error || !data?.office) {
    return (
      <div className="container section">
        <EmptyState
          icon={Building2}
          title="Office not found"
          description="This office record may be unpublished or the address may be incorrect."
          action={<Link className="btn btn-primary" to="/government-directory">Government directory</Link>}
        />
      </div>
    )
  }

  const { office, services, announcements, coverage, relatedOffices } = data
  const levelLabel = office.government_level === 'national' ? 'National agency' : office.government_level === 'municipal' ? 'Municipal office' : 'Provincial office'

  return (
    <>
      <PageHeader
        eyebrow={levelLabel}
        title={office.name}
        description={office.description}
        icon={Building2}
        breadcrumbs={[
          { label: 'Government directory', to: '/government-directory' },
          ...(office.municipality_slug ? [{ label: office.municipality_name, to: `/municipalities/${office.municipality_slug}` }] : []),
          { label: office.name },
        ]}
        actions={
          <>
            <VerificationBadge status={office.verification_status} />
            <SaveButton contentType="office" slug={office.slug} />
          </>
        }
      />

      <div className="container section-tight">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2.2fr) minmax(0, 1fr)', alignItems: 'start' }}>
          <div className="stack" style={{ gap: 'var(--space-5)' }}>
            <section className="card">
              <h2 style={{ fontSize: 'var(--text-h3)', marginBottom: 'var(--space-3)' }}>About this office</h2>
              <p className="text-muted" style={{ whiteSpace: 'pre-line' }}>{office.description || 'No description has been published.'}</p>
              {office.responsibilities ? (
                <div className="mt-4">
                  <h3 style={{ fontSize: 'var(--text-h4)' }}>Responsibilities</h3>
                  <p className="text-muted" style={{ whiteSpace: 'pre-line' }}>{office.responsibilities}</p>
                </div>
              ) : null}
              <dl className="detail-list mt-4">
                <div className="detail-item"><dt>Government level</dt><dd>{levelLabel}</dd></div>
                <div className="detail-item"><dt>Category</dt><dd>{office.category || office.office_type || 'Not classified'}</dd></div>
                <div className="detail-item"><dt>Department</dt><dd>{office.department_name || 'Not recorded'}</dd></div>
                <div className="detail-item">
                  <dt>Municipality</dt>
                  <dd>
                    {office.municipality_slug ? <Link to={`/municipalities/${office.municipality_slug}`}>{office.municipality_name}</Link> : 'Province-wide'}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="card">
              <h2 style={{ fontSize: 'var(--text-h3)', marginBottom: 'var(--space-3)' }}>Contact information</h2>
              <div className="grid grid-2">
                <div className="detail-item">
                  <dt>Telephone</dt>
                  <dd>{office.phone ? <a className="tel-link" href={`tel:${office.phone.replace(/[^0-9+]/g, '')}`}><Phone size={13} aria-hidden="true" /> {office.phone}</a> : 'Not published'}</dd>
                </div>
                <div className="detail-item">
                  <dt>Email</dt>
                  <dd>{office.email ? <a href={`mailto:${office.email}`}><Mail size={13} aria-hidden="true" /> {office.email}</a> : 'Not published'}</dd>
                </div>
                <div className="detail-item">
                  <dt>Address</dt>
                  <dd>{office.address ? <><MapPin size={13} aria-hidden="true" /> {office.address}</> : 'Not published'}</dd>
                </div>
                <div className="detail-item">
                  <dt>Operating hours</dt>
                  <dd>{office.operating_hours ? <><Clock size={13} aria-hidden="true" /> {office.operating_hours}</> : 'Not published'}</dd>
                </div>
                <div className="detail-item">
                  <dt>Website</dt>
                  <dd>{office.website ? <a href={office.website} target="_blank" rel="noopener noreferrer"><Globe size={13} aria-hidden="true" /> Visit official website <ExternalLink size={11} aria-hidden="true" /></a> : 'Not published'}</dd>
                </div>
                <div className="detail-item">
                  <dt>Social media</dt>
                  <dd>{office.facebook ? <a href={office.facebook} target="_blank" rel="noopener noreferrer"><Facebook size={13} aria-hidden="true" /> Official page</a> : 'Not published'}</dd>
                </div>
              </div>
              {office.latitude && office.longitude ? (
                <p className="help mt-3">
                  Location coordinates: {office.latitude}, {office.longitude}. Location information may be approximate; confirm the exact
                  address before travelling.
                </p>
              ) : null}
            </section>

            <section aria-labelledby="office-services-heading">
              <SectionHeading eyebrow="Services" title={<span id="office-services-heading">Services offered</span>} />
              {services.length ? (
                <div className="grid grid-2">
                  {services.map((service) => (
                    <Link key={service.id} to={`/services/${service.slug}`} className="card card-interactive card-link">
                      <h3 style={{ fontSize: '1rem' }}>{service.title}</h3>
                      <p>{service.description}</p>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState icon={ShieldCheck} title="No services linked yet" description="Services are linked to this office once verified records are published." />
              )}
            </section>

            <section className="card">
              <h2 style={{ fontSize: 'var(--text-h3)', marginBottom: 'var(--space-3)' }}>Related information</h2>
              {announcements.length ? (
                <ul className="link-list">
                  {announcements.map((item) => (
                    <li key={item.id}>
                      <Link to={`/announcements/${item.slug}`}>{item.title}</Link>
                      <span className="text-xs text-muted"> · {fmtDate(item.published_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No related announcements have been published for this office yet.</p>
              )}
              {relatedOffices.length ? (
                <div className="mt-4">
                  <h3 style={{ fontSize: 'var(--text-h4)' }}>Related offices</h3>
                  <ul className="link-list">
                    {relatedOffices.map((item) => (
                      <li key={item.id}><Link to={`/government-directory/${item.slug}`}>{item.name}</Link></li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          </div>

          <aside className="stack" style={{ gap: 'var(--space-4)' }}>
            <div className="meta-panel">
              <h3 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>Source &amp; verification</h3>
              <div className="stack-sm text-sm">
                <span><strong>Status:</strong> {office.verification_status?.replace(/_/g, ' ')}</span>
                <span><strong>Source:</strong> {office.source_reference || 'Not recorded'}</span>
                <span><strong>Last verified:</strong> {office.last_verified_at ? fmtDate(office.last_verified_at) : 'Not recorded'}</span>
              </div>
              {office.source_url ? (
                <a className="btn btn-outline btn-sm mt-3" href={office.source_url} target="_blank" rel="noopener noreferrer">View source</a>
              ) : null}
              <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setCorrectionOpen(true)}>
                Report incorrect information
              </Button>
            </div>

            {coverage.length ? (
              <div className="card">
                <h3 style={{ fontSize: 'var(--text-h4)' }}>Serves</h3>
                <ul className="link-list">
                  {coverage.map((item) => (
                    <li key={item.id}><Link to={`/municipalities/${item.slug}`}>{item.name}</Link></li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Alert tone="warning">
              Telephone numbers and hours can change without notice. Confirm with the office before travelling.
            </Alert>
          </aside>
        </div>

        <div className="row mt-5">
          <Link className="btn btn-ghost" to="/government-directory">
            <ArrowRight size={14} style={{ transform: 'rotate(180deg)' }} aria-hidden="true" /> Back to directory
          </Link>
        </div>
      </div>

      <CorrectionForm
        open={correctionOpen}
        onClose={() => setCorrectionOpen(false)}
        target={{ type: 'office', id: office.id, label: office.name }}
      />
    </>
  )
}
