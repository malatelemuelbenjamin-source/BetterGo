import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FileText,
  Info,
  Mail,
  MessageSquare,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { api } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Field, Input, Select, Textarea, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'
import { useAuth } from '../auth'

/* -------------------------------- Markdown -------------------------------- */
// Rendered as React elements rather than an HTML string, so stored document
// text can never inject markup or break out of an attribute.
const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g

function inlineNodes(value, keyBase) {
  const nodes = []
  let last = 0
  let match
  let index = 0
  INLINE_PATTERN.lastIndex = 0
  while ((match = INLINE_PATTERN.exec(value))) {
    if (match.index > last) nodes.push(value.slice(last, match.index))
    const token = match[0]
    const key = `${keyBase}-${index++}`
    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
      nodes.push(
        <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>,
      )
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    last = INLINE_PATTERN.lastIndex
  }
  if (last < value.length) nodes.push(value.slice(last))
  return nodes
}

export function Markdown({ text }) {
  if (!text) return null
  const blocks = []
  let list = null

  const flushList = () => {
    if (!list) return
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {list.map((item, index) => (
          <li key={index}>{inlineNodes(item, `li-${blocks.length}-${index}`)}</li>
        ))}
      </ul>,
    )
    list = null
  }

  String(text)
    .split('\n')
    .forEach((raw) => {
      const line = raw.trim()
      if (!line) {
        flushList()
        return
      }
      if (/^-\s+/.test(line) || /^\*\s+/.test(line)) {
        list = list || []
        list.push(line.replace(/^[-*]\s+/, ''))
        return
      }
      flushList()
      const key = `block-${blocks.length}`
      if (/^###\s+/.test(line)) blocks.push(<h3 key={key}>{inlineNodes(line.replace(/^###\s+/, ''), key)}</h3>)
      else if (/^##\s+/.test(line)) blocks.push(<h2 key={key}>{inlineNodes(line.replace(/^##\s+/, ''), key)}</h2>)
      // A top-level heading duplicates the page title already shown in the header.
      else if (/^#\s+/.test(line)) return
      else if (/^>\s+/.test(line)) blocks.push(<blockquote key={key}>{inlineNodes(line.replace(/^>\s+/, ''), key)}</blockquote>)
      else blocks.push(<p key={key}>{inlineNodes(line, key)}</p>)
    })
  flushList()

  return <div className="prose">{blocks}</div>
}

/* ---------------------------------- About --------------------------------- */
const NOT_OFFICIAL = [
  'BetterGo Marinduque is not an official provincial or municipal government website.',
  'BetterGo does not approve applications or issue government documents.',
  'BetterGo does not independently verify every government record; each record shows its source and verification status.',
  'Government seals and logos are not used without permission.',
]

export function AboutPage() {
  useDocumentTitle('About BetterGo Marinduque')
  const { data } = useApi('/faqs')
  const [open, setOpen] = useState(null)

  return (
    <>
      <PageHeader
        eyebrow="About"
        title="About BetterGo Marinduque"
        description="An independent, community-driven digital initiative for public information, services and civic participation in Marinduque."
        icon={Info}
        breadcrumbs={[{ label: 'About' }]}
      />

      <div className="container section-tight">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', alignItems: 'start' }}>
          <div className="stack" style={{ gap: 'var(--space-5)' }}>
            <section className="card prose">
              <h2>What this platform is</h2>
              <p>
                BetterGo Marinduque brings public information together in one place: government services and their requirements, the
                offices responsible for them, published announcements, emergency contacts, transparency records and public documents.
              </p>
              <p>
                The goal is simple — make it easier for residents of Boac, Mogpog, Gasan, Buenavista, Torrijos and Santa Cruz to find
                information that is already public, understand where it came from, and know which office to approach.
              </p>
              <h2>What this platform is not</h2>
              <ul>
                {NOT_OFFICIAL.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <h2>How information is handled</h2>
              <p>
                Every published record carries a source reference and a verification status. Records marked “pending” or “unverified” have
                not been checked against an official source. Content passes a review workflow before publication, and corrections can be
                reported by anyone.
              </p>
              <p>
                BetterGo does not fabricate officials, contact numbers, budgets, projects or announcements. Where no verified information
                exists, the platform says so instead of filling the gap.
              </p>
              <h2>Participation</h2>
              <p>
                Residents can submit feedback, concerns, suggestions and correction reports. Reports are reviewed by administrators. A
                submission to BetterGo does not create an official government case or guarantee action by any agency.
              </p>
            </section>

            <section className="card" id="faq" aria-labelledby="faq-heading">
              <h2 id="faq-heading" style={{ fontSize: 'var(--text-h3)', marginBottom: 'var(--space-3)' }}>Frequently asked questions</h2>
              {data?.results?.length ? (
                <div className="stack-sm">
                  {data.results.map((faq) => (
                    <div key={faq.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <button
                        type="button"
                        onClick={() => setOpen(open === faq.id ? null : faq.id)}
                        aria-expanded={open === faq.id}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
                          padding: '0.75rem 0', background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left',
                          fontWeight: 650, fontSize: '0.92rem', color: 'var(--text)',
                        }}
                      >
                        {faq.question}
                        <ChevronDown size={16} aria-hidden="true" style={{ flex: 'none', transform: open === faq.id ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
                      </button>
                      {open === faq.id ? <p className="text-sm text-muted" style={{ paddingBottom: '0.75rem' }}>{faq.answer}</p> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">FAQs are being prepared.</p>
              )}
            </section>

            <section className="card">
              <h2 style={{ fontSize: 'var(--text-h3)', marginBottom: 'var(--space-3)' }}>Report inaccurate information</h2>
              <p className="text-sm text-muted">
                If something on this platform is out of date or wrong, tell us. Correction reports are reviewed before any change is
                published.
              </p>
              <div className="row mt-3">
                <Link className="btn btn-primary" to="/contact?kind=concern">Report a concern</Link>
                <Link className="btn btn-outline" to="/data-requests">Privacy &amp; data requests</Link>
              </div>
            </section>
          </div>

          <aside className="stack" style={{ gap: 'var(--space-4)' }}>
            <div className="card">
              <h3 style={{ fontSize: 'var(--text-h4)' }}>Platform principles</h3>
              <ul className="link-list text-sm">
                <li><CheckCircle2 size={13} aria-hidden="true" /> Source attribution on every record</li>
                <li><CheckCircle2 size={13} aria-hidden="true" /> Honest empty states, never invented data</li>
                <li><CheckCircle2 size={13} aria-hidden="true" /> Public information without an account</li>
                <li><CheckCircle2 size={13} aria-hidden="true" /> Data minimisation and privacy by default</li>
                <li><CheckCircle2 size={13} aria-hidden="true" /> Accessible, mobile-first design</li>
              </ul>
            </div>
            <div className="card">
              <h3 style={{ fontSize: 'var(--text-h4)' }}>Legal</h3>
              <ul className="link-list">
                <li><Link to="/privacy-policy">Privacy Policy</Link></li>
                <li><Link to="/terms-of-use">Terms of Use</Link></li>
                <li><Link to="/disclaimer">Disclaimer</Link></li>
                <li><Link to="/security">Platform security</Link></li>
                <li><Link to="/report-security-issue">Report a security issue</Link></li>
              </ul>
            </div>
            <Alert tone="warning" title="Draft legal documents">
              Legal documents on this platform are drafts awaiting review by a qualified Philippine privacy or legal professional. Do not
              treat them as certified compliance.
            </Alert>
          </aside>
        </div>
      </div>
    </>
  )
}

/* --------------------------------- Contact -------------------------------- */
const REPORT_KINDS = [
  { value: 'feedback', label: 'Feedback about the platform' },
  { value: 'concern', label: 'Report a public concern or incorrect information' },
  { value: 'suggestion', label: 'Suggest information to publish' },
  { value: 'consultation', label: 'Public consultation enquiry' },
]

export function ContactPage() {
  const [params] = useSearchParams()
  const toast = useToast()
  const { user } = useAuth()
  const { data: lookups } = useApi('/lookups')
  const [form, setForm] = useState({
    kind: REPORT_KINDS.find((item) => item.value === params.get('kind'))?.value || 'feedback',
    subject: '',
    description: '',
    municipalityId: '',
    contactEmail: user?.email || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [reference, setReference] = useState(null)
  useDocumentTitle('Contact and feedback')

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api.post('/reports', form)
      setReference(result.reference)
      toast.push('Submission received for review.')
      setForm({ ...form, subject: '', description: '' })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const fieldError = (name) => error?.details?.find((detail) => detail.field === name)?.message

  return (
    <>
      <PageHeader
        eyebrow="Contact"
        title="Contact BetterGo Marinduque"
        description="Send feedback, report a concern, or suggest public information that should be published."
        icon={MessageSquare}
        breadcrumbs={[{ label: 'Contact' }]}
      />

      <div className="container section-tight">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', alignItems: 'start' }}>
          <div className="card">
            {reference ? (
              <div className="stack">
                <Alert tone="success" title="Thank you — your submission has been received">
                  Your reference number is <strong>{reference}</strong>. Keep it if you need to follow up. Submissions are reviewed by an
                  administrator.
                </Alert>
                <p className="text-sm text-muted">
                  BetterGo is an independent initiative. This submission does not create an official government case and does not
                  guarantee action by any government office. For urgent emergency matters, contact emergency services directly.
                </p>
                <div className="row">
                  <Button variant="outline" onClick={() => setReference(null)}>Send another message</Button>
                  <Link className="btn btn-primary" to="/announcements">Read announcements</Link>
                </div>
              </div>
            ) : (
              <form onSubmit={submit}>
                {error && !error.details?.length ? <Alert tone="error">{error.message}</Alert> : null}
                <Field label="What is this about?" htmlFor="contact-kind" required>
                  <Select id="contact-kind" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
                    {REPORT_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </Select>
                </Field>
                <Field label="Short title" htmlFor="contact-subject" required error={fieldError('subject')}>
                  <Input
                    id="contact-subject"
                    value={form.subject}
                    onChange={(event) => setForm({ ...form, subject: event.target.value })}
                    required
                    minLength={5}
                    maxLength={160}
                    placeholder="For example: Boac office telephone number is outdated"
                    invalid={Boolean(fieldError('subject'))}
                  />
                </Field>
                <Field label="Details" htmlFor="contact-description" required error={fieldError('description')} help="Include the page, office or record you are referring to. Do not include passwords or sensitive personal information.">
                  <Textarea
                    id="contact-description"
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                    required
                    minLength={20}
                    maxLength={5000}
                    style={{ minHeight: 160 }}
                    invalid={Boolean(fieldError('description'))}
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Municipality (optional)" htmlFor="contact-municipality">
                    <Select id="contact-municipality" value={form.municipalityId} onChange={(event) => setForm({ ...form, municipalityId: event.target.value })}>
                      <option value="">Not specific / province-wide</option>
                      {(lookups?.municipalities || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Your email (optional)" htmlFor="contact-email" error={fieldError('contactEmail')} help="Used only to follow up. Not published.">
                    <Input
                      id="contact-email"
                      type="email"
                      value={form.contactEmail}
                      onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
                      maxLength={200}
                      invalid={Boolean(fieldError('contactEmail'))}
                    />
                  </Field>
                </div>
                <Button type="submit" loading={busy} icon={Send}>Send submission</Button>
              </form>
            )}
          </div>

          <aside className="stack" style={{ gap: 'var(--space-4)' }}>
            <div className="card">
              <h3 style={{ fontSize: 'var(--text-h4)' }}>What happens next</h3>
              <ol className="step-list mt-2">
                <li><span className="step-num" aria-hidden="true">1</span><div className="text-sm">Your submission is recorded with a reference number.</div></li>
                <li><span className="step-num" aria-hidden="true">2</span><div className="text-sm">An administrator reviews it and checks the source.</div></li>
                <li><span className="step-num" aria-hidden="true">3</span><div className="text-sm">If information changes, the update still goes through the publication workflow.</div></li>
              </ol>
            </div>
            <Alert tone="warning" title="Not an emergency channel">
              Do not use this form for emergencies. Call <a href="tel:911">911</a> or contact the appropriate emergency service.
            </Alert>
            <div className="card">
              <h3 style={{ fontSize: 'var(--text-h4)' }}>Privacy</h3>
              <p className="text-sm text-muted">
                Contact details you provide are used only to respond to your submission. See the <Link to="/privacy-policy">Privacy Policy</Link>{' '}
                and the <Link to="/data-requests">data request centre</Link>.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}

/* ------------------------------ Data requests ----------------------------- */
export function DataRequestsPage() {
  useDocumentTitle('Data requests')
  const [form, setForm] = useState({ category: 'access', requesterName: '', requesterEmail: '', description: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [reference, setReference] = useState(null)
  const toast = useToast()

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api.post('/data-requests', form)
      setReference({ ...result, category: form.category })
      toast.push('Data request submitted.')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Privacy"
        title="Data subject request centre"
        description="Request access, correction or deletion of personal information, or ask how your information is processed."
        icon={ShieldCheck}
        breadcrumbs={[{ label: 'Data requests' }]}
      />

      <div className="container section-tight">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', alignItems: 'start' }}>
          <div className="card">
            {reference ? (
              <div className="stack">
                <Alert tone="success" title="Request received">
                  Reference <strong>{reference.reference}</strong> ({reference.category.replace(/_/g, ' ')}). We may contact you to verify
                  your identity before releasing or changing personal information.
                </Alert>
                <p className="text-sm text-muted">
                  Not every deletion request results in immediate removal. Some records, such as audit or financial records, may need to be
                  retained where the law requires it. You will receive a response through your registered contact.
                </p>
                <div className="row">
                  <Button variant="outline" onClick={() => setReference(null)}>Submit another request</Button>
                  <Link className="btn btn-primary" to="/dashboard/privacy">Go to privacy dashboard</Link>
                </div>
              </div>
            ) : (
              <form onSubmit={submit}>
                {error ? <Alert tone="error">{error.message}</Alert> : null}
                <Field label="Type of request" htmlFor="dr-category" required>
                  <Select id="dr-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                    <option value="access">Access my personal information</option>
                    <option value="correction">Correct inaccurate information</option>
                    <option value="deletion">Delete my information (where applicable)</option>
                    <option value="restriction">Restrict or object to processing</option>
                    <option value="withdraw_consent">Withdraw consent</option>
                    <option value="concern">Raise a privacy concern</option>
                    <option value="question">Ask a question about processing</option>
                  </Select>
                </Field>
                <div className="form-grid">
                  <Field label="Full name" htmlFor="dr-name" required error={error?.details?.find((d) => d.field === 'requesterName')?.message}>
                    <Input id="dr-name" value={form.requesterName} onChange={(event) => setForm({ ...form, requesterName: event.target.value })} required maxLength={120} />
                  </Field>
                  <Field label="Email address" htmlFor="dr-email" required error={error?.details?.find((d) => d.field === 'requesterEmail')?.message}>
                    <Input id="dr-email" type="email" value={form.requesterEmail} onChange={(event) => setForm({ ...form, requesterEmail: event.target.value })} required maxLength={200} />
                  </Field>
                </div>
                <Field label="Describe your request" htmlFor="dr-description" required error={error?.details?.find((d) => d.field === 'description')?.message}>
                  <Textarea id="dr-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required minLength={10} maxLength={3000} style={{ minHeight: 140 }} />
                </Field>
                <Button type="submit" loading={busy} icon={Send}>Submit request</Button>
                <p className="help mt-2">
                  If you have an account, submitting through your dashboard lets us verify ownership faster.
                </p>
              </form>
            )}
          </div>

          <aside className="stack" style={{ gap: 'var(--space-4)' }}>
            <div className="card">
              <h3 style={{ fontSize: 'var(--text-h4)' }}>Your rights</h3>
              <ul className="link-list text-sm">
                <li>Access the personal information we hold about you</li>
                <li>Correct inaccurate or incomplete information</li>
                <li>Request deletion where retention is not required</li>
                <li>Object to or restrict certain processing</li>
                <li>Withdraw consent where consent is the basis</li>
                <li>Ask how your information is used</li>
              </ul>
            </div>
            <div className="card">
              <h3 style={{ fontSize: 'var(--text-h4)' }}>Verification</h3>
              <p className="text-sm text-muted">
                We verify identity proportionately before releasing or modifying personal information, to protect accounts from
                unauthorised access.
              </p>
            </div>
            <Alert tone="warning" title="Awaiting legal review">
              Privacy processes and retention rules on this platform are technical foundations awaiting review by a qualified Philippine
              privacy or legal professional.
            </Alert>
          </aside>
        </div>
      </div>
    </>
  )
}

/* ----------------------------- Security report ---------------------------- */
export function ReportSecurityPage() {
  useDocumentTitle('Report a security issue')
  const [form, setForm] = useState({ title: '', description: '', affectedArea: '', reproductionSteps: '', impact: '', contactEmail: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [reference, setReference] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api.post('/security-reports', form)
      setReference(result.reference)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Security"
        title="Responsible disclosure"
        description="Report a suspected security vulnerability privately. Do not access, modify or download other people's data while testing."
        icon={AlertTriangle}
        breadcrumbs={[{ label: 'Report a security issue' }]}
      />

      <div className="container section-tight">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', alignItems: 'start' }}>
          <div className="card">
            {reference ? (
              <div className="stack">
                <Alert tone="success" title="Report received privately">
                  Reference <strong>{reference}</strong>. Your report is visible only to authorised platform security personnel and is never
                  published automatically.
                </Alert>
                <Link className="btn btn-outline" to="/security" style={{ alignSelf: 'flex-start' }}>Read about platform security</Link>
              </div>
            ) : (
              <form onSubmit={submit}>
                {error ? <Alert tone="error">{error.message}</Alert> : null}
                <Field label="Title" htmlFor="sec-title" required>
                  <Input id="sec-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required minLength={5} maxLength={160} placeholder="Short summary of the issue" />
                </Field>
                <Field label="Affected page or feature" htmlFor="sec-area">
                  <Input id="sec-area" value={form.affectedArea} onChange={(event) => setForm({ ...form, affectedArea: event.target.value })} maxLength={200} placeholder="e.g. login page, announcement attachments" />
                </Field>
                <Field label="Description" htmlFor="sec-description" required>
                  <Textarea id="sec-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required minLength={20} maxLength={5000} />
                </Field>
                <Field label="Steps to reproduce" htmlFor="sec-steps" help="Do not include personal data, credentials or data belonging to other people.">
                  <Textarea id="sec-steps" value={form.reproductionSteps} onChange={(event) => setForm({ ...form, reproductionSteps: event.target.value })} maxLength={4000} />
                </Field>
                <Field label="Potential impact" htmlFor="sec-impact">
                  <Input id="sec-impact" value={form.impact} onChange={(event) => setForm({ ...form, impact: event.target.value })} maxLength={2000} />
                </Field>
                <Field label="Contact email (optional)" htmlFor="sec-email">
                  <Input id="sec-email" type="email" value={form.contactEmail} onChange={(event) => setForm({ ...form, contactEmail: event.target.value })} maxLength={200} />
                </Field>
                <Button type="submit" loading={busy} icon={Send}>Send private report</Button>
              </form>
            )}
          </div>

          <aside className="stack" style={{ gap: 'var(--space-4)' }}>
            <div className="card">
              <h3 style={{ fontSize: 'var(--text-h4)' }}>Responsible disclosure rules</h3>
              <ul className="text-sm text-muted" style={{ paddingLeft: '1.1rem' }}>
                <li>Do not access, modify, download or share other people's private data.</li>
                <li>Do not disrupt the service or attempt denial-of-service testing.</li>
                <li>Do not use social engineering against staff or users.</li>
                <li>Give us reasonable time to investigate before public disclosure.</li>
                <li>Only test accounts and data that you own.</li>
              </ul>
            </div>
            <Alert tone="warning" title="Reporting channel status">
              A dedicated, verified security contact has not yet been configured for this deployment. Reports submitted here are stored
              securely for authorised reviewers only.
            </Alert>
            <div className="card">
              <h3 style={{ fontSize: 'var(--text-h4)' }}>Privacy</h3>
              <p className="text-sm text-muted">
                Security reports are treated as confidential. They are never published automatically and are excluded from public search.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}
