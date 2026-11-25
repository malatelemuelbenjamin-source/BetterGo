import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, FileText, Save, Send } from 'lucide-react'
import { api } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { useAuth } from '../auth'
import { PageHeader } from '../components/layout'
import { Alert, Badge, Button, Checkbox, Field, Input, Select, SkeletonList, Textarea, useToast } from '../components/ui'

function fieldVisible(field, answers) {
  if (!field.conditional) return true
  const value = answers[field.conditional.fieldKey]
  if (field.conditional.in) {
    const values = Array.isArray(value) ? value.map(String) : [value ?? '']
    return values.some((entry) => field.conditional.in.includes(String(entry)))
  }
  return String(value ?? '') === field.conditional.equals
}

/**
 * Citizen-facing BetterGo intake form (Prompt 64).
 * A submission here is recorded by BetterGo only; it is never described as an
 * official government filing.
 */
export default function ApplyPage() {
  const { slug } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const { data, loading, error } = useApi(`/forms/${slug}`)
  const { data: vault } = useApi('/account/documents?limit=50')
  const [answers, setAnswers] = useState({})
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState({})
  const [step, setStep] = useState('form')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [draftLoaded, setDraftLoaded] = useState(false)
  useDocumentTitle(data?.form?.title || 'BetterGo form')

  const form = data?.form

  useEffect(() => {
    if (!user || !form) return
    api.get(`/account/forms/${form.id}/draft`)
      .then((draft) => {
        if (draft?.draft?.answers) setAnswers(draft.draft.answers)
      })
      .catch(() => {})
      .finally(() => setDraftLoaded(true))
  }, [user, form])

  const visibleFields = useMemo(
    () => (form?.fields || []).filter((field) => fieldVisible(field, answers)),
    [form, answers],
  )

  const setAnswer = (key, value) => {
    setAnswers((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  if (loading) return <div className="container section"><SkeletonList count={2} height={180} /></div>
  if (error || !form) {
    return (
      <div className="container section">
        <Alert tone="info" title="No published form here">
          This service does not currently offer a BetterGo intake form. Use the service page for its published requirements and official
          contact details.
        </Alert>
        <Link className="btn btn-outline mt-3" to="/services">Back to the service directory</Link>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="container section">
        <PageHeader eyebrow="BetterGo intake" title={form.title} description={form.description} />
        <Alert tone="info" title="Sign in to continue">
          You need a BetterGo citizen account to complete this form and keep a private draft. <Link to={`/login?next=${encodeURIComponent(`/apply/${slug}`)}`}>Sign in</Link> or{' '}
          <Link to={`/register?next=${encodeURIComponent(`/apply/${slug}`)}`}>create an account</Link>.
        </Alert>
      </div>
    )
  }

  if (result) {
    return (
      <div className="container section">
        <div className="card">
          <div className="row" style={{ gap: '0.5rem' }}><CheckCircle2 size={22} aria-hidden="true" /><h1 style={{ fontSize: 'var(--text-h3)', margin: 0 }}>Submitted to BetterGo</h1></div>
          <p className="mt-2">Your BetterGo reference is <strong>{result.reference}</strong>.</p>
          <Alert tone="warning" title="Not an official government filing">
            {result.disclaimer}
          </Alert>
          <div className="row mt-3">
            <Link className="btn btn-primary" to={`/dashboard/applications/${result.reference}`}>Track this reference</Link>
            <Link className="btn btn-outline" to="/services">Back to services</Link>
          </div>
        </div>
      </div>
    )
  }

  const saveDraft = async () => {
    setBusy(true)
    try {
      await api.put(`/account/forms/${form.id}/draft`, { answers })
      toast.push('Draft saved. Only you can see it.')
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    setBusy(true)
    setErrors({})
    try {
      const response = await api.post(`/account/forms/${form.id}/submit`, { answers, consent })
      setResult(response)
    } catch (err) {
      const nextErrors = {}
      ;(err.details || []).forEach((detail) => {
        nextErrors[detail.field] = detail.message
      })
      setErrors(nextErrors)
      setStep('form')
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const renderField = (field) => {
    const id = `field-${field.fieldKey}`
    const error = errors[field.fieldKey]
    if (field.fieldType === 'heading') return <h2 key={field.fieldKey} className="mt-4" style={{ fontSize: 'var(--text-h4)' }}>{field.label}</h2>
    if (field.fieldType === 'info') return <p key={field.fieldKey} className="help mt-2">{field.description || field.label}</p>

    switch (field.fieldType) {
      case 'long_text':
      case 'address':
        return (
          <Field key={field.fieldKey} label={field.label} htmlFor={id} required={field.required} error={error} help={field.description}>
            <Textarea id={id} value={answers[field.fieldKey] || ''} onChange={(event) => setAnswer(field.fieldKey, event.target.value)} placeholder={field.placeholder || ''} maxLength={field.validation?.maxLength || 5000} style={{ minHeight: 100 }} />
          </Field>
        )
      case 'select':
        return (
          <Field key={field.fieldKey} label={field.label} htmlFor={id} required={field.required} error={error} help={field.description}>
            <Select id={id} value={answers[field.fieldKey] || ''} onChange={(event) => setAnswer(field.fieldKey, event.target.value)}>
              <option value="">Choose…</option>
              {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
        )
      case 'radio':
        return (
          <Field key={field.fieldKey} label={field.label} required={field.required} error={error} help={field.description}>
            <div className="check-grid">
              {field.options.map((option) => (
                <label key={option.value} className="check-row">
                  <input type="radio" name={id} value={option.value} checked={answers[field.fieldKey] === option.value} onChange={() => setAnswer(field.fieldKey, option.value)} />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </Field>
        )
      case 'multiselect':
      case 'checkbox':
        return (
          <Field key={field.fieldKey} label={field.label} required={field.required} error={error} help={field.description}>
            <div className="check-grid">
              {field.options.map((option) => {
                const current = Array.isArray(answers[field.fieldKey]) ? answers[field.fieldKey] : []
                return (
                  <label key={option.value} className="check-row">
                    <input
                      type="checkbox"
                      checked={current.includes(option.value)}
                      onChange={() => setAnswer(field.fieldKey, current.includes(option.value) ? current.filter((value) => value !== option.value) : [...current, option.value])}
                    />
                    <span>{option.label}</span>
                  </label>
                )
              })}
            </div>
          </Field>
        )
      case 'consent':
        return (
          <div key={field.fieldKey} className="mt-3">
            <label className="check-row">
              <input type="checkbox" checked={answers[field.fieldKey] === true} onChange={(event) => setAnswer(field.fieldKey, event.target.checked)} />
              <span>{field.label}{field.required ? ' *' : ''}</span>
            </label>
            {field.description ? <p className="help">{field.description}</p> : null}
            {error ? <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p> : null}
          </div>
        )
      case 'file':
        return (
          <Field key={field.fieldKey} label={field.label} required={field.required} error={error} help={`${field.description || ''} Choose a document from your private document vault.`.trim()}>
            <Select
              id={id}
              value={answers[field.fieldKey]?.[0] || ''}
              onChange={(event) => setAnswer(field.fieldKey, event.target.value ? [Number(event.target.value)] : [])}
            >
              <option value="">Choose a document from your vault…</option>
              {(vault?.results || []).map((document) => (
                <option key={document.id} value={document.id}>{document.title} ({document.categoryLabel})</option>
              ))}
            </Select>
            {vault && !vault.results.length ? (
              <p className="help">Your vault is empty. <Link to="/dashboard/documents">Add a document</Link> first, then return here.</p>
            ) : null}
          </Field>
        )
      case 'number':
        return (
          <Field key={field.fieldKey} label={field.label} htmlFor={id} required={field.required} error={error} help={field.description}>
            <Input id={id} type="number" value={answers[field.fieldKey] ?? ''} onChange={(event) => setAnswer(field.fieldKey, event.target.value)} min={field.validation?.min} max={field.validation?.max} />
          </Field>
        )
      case 'date':
        return (
          <Field key={field.fieldKey} label={field.label} htmlFor={id} required={field.required} error={error} help={field.description}>
            <Input id={id} type="date" value={answers[field.fieldKey] || ''} onChange={(event) => setAnswer(field.fieldKey, event.target.value)} />
          </Field>
        )
      case 'email':
      case 'phone':
        return (
          <Field key={field.fieldKey} label={field.label} htmlFor={id} required={field.required} error={error} help={field.description}>
            <Input id={id} type={field.fieldType === 'email' ? 'email' : 'tel'} value={answers[field.fieldKey] || ''} onChange={(event) => setAnswer(field.fieldKey, event.target.value)} placeholder={field.placeholder || (field.fieldType === 'phone' ? '09171234567' : '')} />
          </Field>
        )
      default:
        return (
          <Field key={field.fieldKey} label={field.label} htmlFor={id} required={field.required} error={error} help={field.description}>
            <Input id={id} value={answers[field.fieldKey] || ''} onChange={(event) => setAnswer(field.fieldKey, event.target.value)} placeholder={field.placeholder || ''} maxLength={field.validation?.maxLength || 500} />
          </Field>
        )
    }
  }

  return (
    <div className="container section">
      <PageHeader
        eyebrow="BetterGo intake"
        title={form.title}
        description={form.description}
        breadcrumbs={[{ label: 'Services', to: '/services' }, { label: form.serviceTitle || 'Service', to: `/services/${form.serviceSlug}` }, { label: 'BetterGo form' }]}
      />

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', alignItems: 'start', gap: 'var(--space-4)' }}>
        <div className="card">
          {form.instructions ? <Alert tone="info" title="Before you start">{form.instructions}</Alert> : null}

          {step === 'review' ? (
            <div>
              <h2 style={{ fontSize: 'var(--text-h4)' }}>Review your answers</h2>
              <dl className="detail-list mt-3">
                {visibleFields.filter((field) => !['heading', 'info'].includes(field.fieldType)).map((field) => (
                  <div key={field.fieldKey}>
                    <dt>{field.label}</dt>
                    <dd>
                      {Array.isArray(answers[field.fieldKey])
                        ? answers[field.fieldKey].join(', ') || '—'
                        : answers[field.fieldKey] === true
                          ? 'Accepted'
                          : String(answers[field.fieldKey] ?? '—')}
                    </dd>
                  </div>
                ))}
              </dl>
              <label className="check-row mt-4">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                <span>
                  I have read the privacy notice and agree that BetterGo may record these answers.
                  {form.privacyNotice ? <span className="text-sm text-muted" style={{ display: 'block' }}>{form.privacyNotice}</span> : null}
                </span>
              </label>
              {errors.consent ? <p className="text-xs" style={{ color: 'var(--danger)' }}>{errors.consent}</p> : null}
              <Alert tone="warning" title="This is not an official government filing">
                {data.disclaimer}
              </Alert>
              <div className="row mt-3">
                <Button onClick={submit} loading={busy} icon={Send} disabled={!consent}>Submit to BetterGo</Button>
                <Button variant="outline" onClick={() => setStep('form')}>Back to the form</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); setStep('review') }}>
              {visibleFields.map(renderField)}
              <div className="row mt-4">
                <Button type="submit" icon={Send}>Review answers</Button>
                <Button type="button" variant="outline" icon={Save} onClick={saveDraft} loading={busy}>Save draft</Button>
              </div>
            </form>
          )}
        </div>

        <aside className="stack">
          <div className="card">
            <Badge tone="info">BetterGo intake</Badge>
            <h2 style={{ fontSize: '1.05rem', marginTop: '0.4rem' }}>What happens next</h2>
            <p className="text-sm text-muted">
              BetterGo records your answers and gives you a BetterGo reference. No government office receives, processes or approves this
              submission unless a separate authorised integration is announced.
            </p>
            {draftLoaded ? <p className="help">Drafts are saved to your account only.</p> : null}
          </div>
          <div className="card">
            <h2 style={{ fontSize: '1.05rem' }}>Privacy</h2>
            <p className="text-sm text-muted">{form.privacyNotice || 'This form collects only the information shown. Your answers are private to your account and authorised BetterGo reviewers.'}</p>
            <p className="help">Notice version {form.privacyNoticeVersion}</p>
          </div>
          <div className="card">
            <h2 style={{ fontSize: '1.05rem' }}>Service</h2>
            <p className="text-sm"><Link to={`/services/${form.serviceSlug}`}>{form.serviceTitle}</Link></p>
            {form.municipalityName ? <p className="text-xs text-muted">{form.municipalityName}</p> : <p className="text-xs text-muted">Province-wide</p>}
          </div>
        </aside>
      </div>

      <p className="help mt-4"><AlertTriangle size={13} aria-hidden="true" /> BetterGo never asks for a government ID number in this form unless a published service explicitly requires it and an authorised process exists.</p>
    </div>
  )
}
