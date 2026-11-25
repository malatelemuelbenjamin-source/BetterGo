import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCircle2, Mail, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { Alert, Button, Checkbox, Field, Input, PasswordInput, Select } from '../components/ui'
import { useAuth } from '../auth'
import { ThemeToggle } from '../components/layout'

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }} className="auth-shell">
      <div className="auth-brand" style={{ background: 'linear-gradient(160deg, #0f3d24, #14532d 55%, #166534)', color: '#fff', padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <Link to="/" className="brand" style={{ color: '#fff' }}>
          <img src="/brand/mark.svg" alt="" width="40" height="40" />
          <span className="brand-text">
            <span className="brand-name" style={{ color: '#fff' }}>BetterGo</span>
            <span className="brand-sub" style={{ color: 'rgba(255,255,255,0.7)' }}>Marinduque</span>
          </span>
        </Link>
        <div>
          <h2 style={{ color: '#fff', fontSize: 'var(--text-h2)', maxWidth: '22ch' }}>Serbisyo. Transparency. Progreso.</h2>
          <p style={{ color: 'rgba(255,255,255,0.82)', maxWidth: '42ch', marginTop: 'var(--space-3)' }}>
            Public service information, verified contacts and civic participation tools for every Marinduqueño.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {['Browse public information without an account', 'Save services and track your submissions', 'Control your own privacy settings'].map((item) => (
              <li key={item} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.875rem', color: 'rgba(255,255,255,0.85)' }}>
                <CheckCircle2 size={15} aria-hidden="true" style={{ color: '#86efac', flex: 'none', marginTop: 3 }} /> {item}
              </li>
            ))}
          </ul>
        </div>
        <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)' }}>
          BetterGo Marinduque is an independent, community-driven civic initiative. It is not an official government website.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="row-between" style={{ padding: 'var(--space-3) var(--space-4)' }}>
          <Link to="/" className="btn btn-ghost btn-sm"><ArrowLeft size={14} aria-hidden="true" /> Back to website</Link>
          <ThemeToggle />
        </div>
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 'var(--space-4) var(--space-4) var(--space-6)' }}>
          <div style={{ width: 'min(440px, 100%)' }}>
            <h1 style={{ fontSize: 'var(--text-h2)', marginBottom: 'var(--space-2)' }}>{title}</h1>
            {subtitle ? <p className="text-muted" style={{ marginBottom: 'var(--space-4)' }}>{subtitle}</p> : null}
            {children}
            {footer ? <div className="mt-4 text-sm text-muted">{footer}</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------- Login --------------------------------- */
export function LoginPage() {
  useDocumentTitle('Sign in')
  const { login, user } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '', mfaCode: '' })
  const [error, setError] = useState(null)
  const [mfaRequired, setMfaRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const next = params.get('next') || '/dashboard'

  useEffect(() => {
    if (user) navigate(next, { replace: true })
  }, [user, next, navigate])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await login(form.email, form.password, form.mfaCode)
      navigate(next, { replace: true })
      if (result.mustVerifyEmail) {
        // Verification is encouraged but does not block public browsing.
      }
    } catch (err) {
      if (err.payload?.mfaRequired) setMfaRequired(true)
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Sign in to save services, track your submissions and manage your privacy preferences."
      footer={
        <>
          New to BetterGo? <Link to={`/register${next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''}`}>Create a citizen account</Link>
        </>
      }
    >
      <form onSubmit={submit}>
        {error ? <Alert tone="error">{error.message}</Alert> : null}
        <Field label="Email address" htmlFor="login-email" required>
          <Input
            id="login-email"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            autoComplete="email"
            required
            maxLength={200}
          />
        </Field>
        <Field label="Password" htmlFor="login-password" required>
          <PasswordInput
            id="login-password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            autoComplete="current-password"
            required
          />
        </Field>
        {mfaRequired ? (
          <Field label="Authenticator or recovery code" htmlFor="login-mfa" required help="Six digits from your authenticator app, or one of your saved recovery codes.">
            <Input
              id="login-mfa"
              value={form.mfaCode}
              onChange={(event) => setForm({ ...form, mfaCode: event.target.value })}
              autoComplete="one-time-code"
              inputMode="numeric"
              required
              maxLength={20}
            />
          </Field>
        ) : null}
        <div className="row-between mb-4">
          <span className="help">Session expires after 7 days.</span>
          <Link className="text-xs" to="/forgot-password">Forgot password?</Link>
        </div>
        <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
      </form>
      <p className="help mt-3">
        Sign-in attempts are rate limited. Errors do not reveal whether an email address is registered.
      </p>
    </AuthShell>
  )
}

/* -------------------------------- Register -------------------------------- */
function passwordStrength(password) {
  let score = 0
  if (password.length >= 12) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/[0-9]/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  return score
}

export function RegisterPage() {
  useDocumentTitle('Create an account')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const { data: lookups } = useApi('/lookups')
  const [form, setForm] = useState({
    firstName: '', middleName: '', lastName: '', email: '', phone: '', municipalityId: '', language: 'en',
    password: '', confirmPassword: '', acceptTerms: false, acceptPrivacy: false,
  })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(null)
  const next = params.get('next') || '/dashboard'

  const strength = useMemo(() => passwordStrength(form.password), [form.password])
  const strengthLabel = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][strength]

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api.post('/auth/register', form)
      setSuccess(result)
      await refresh()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const fieldError = (name) => error?.details?.find((detail) => detail.field === name)?.message

  if (success) {
    return (
      <AuthShell title="Check your email" subtitle="Your account has been created with the Citizen role.">
        <Alert tone="success" title="Account created">
          {success.message}
        </Alert>
        {success.verificationUrl ? (
          <Alert tone="info" title="Development environment">
            Email delivery is not configured, so you can use this verification link:{' '}
            <a href={success.verificationUrl} style={{ wordBreak: 'break-all' }}>verify your email</a>. This link is only exposed in
            development.
          </Alert>
        ) : null}
        <div className="stack mt-4">
          <Link className="btn btn-primary w-full" to="/login">Go to sign in</Link>
          <Link className="btn btn-outline w-full" to="/">Continue browsing</Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create a citizen account"
      subtitle="Public registration always creates a Citizen account. Government and administrator roles are assigned only by authorised administrators."
      footer={<>Already registered? <Link to="/login">Sign in</Link></>}
    >
      <form onSubmit={submit}>
        {error && !error.details?.length ? <Alert tone="error">{error.message}</Alert> : null}
        {error?.details?.length ? (
          <Alert tone="error" title="Please check the form">
            <ul>{error.details.map((detail) => <li key={detail.field + detail.message}>{detail.message}</li>)}</ul>
          </Alert>
        ) : null}

        <div className="form-grid">
          <Field label="First name" htmlFor="reg-first" required>
            <Input id="reg-first" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} required maxLength={80} autoComplete="given-name" />
          </Field>
          <Field label="Last name" htmlFor="reg-last" required>
            <Input id="reg-last" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} required maxLength={80} autoComplete="family-name" />
          </Field>
          <Field label="Middle name (optional)" htmlFor="reg-middle">
            <Input id="reg-middle" value={form.middleName} onChange={(event) => setForm({ ...form, middleName: event.target.value })} maxLength={80} autoComplete="additional-name" />
          </Field>
          <Field label="Mobile number (optional)" htmlFor="reg-phone" error={fieldError('phone')} help="Philippine format, e.g. 09171234567">
            <Input id="reg-phone" type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} maxLength={30} autoComplete="tel" />
          </Field>
          <Field label="Email address" htmlFor="reg-email" required error={fieldError('email')} className="field-full">
            <Input id="reg-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required maxLength={200} autoComplete="email" />
          </Field>
          <Field label="Municipality of residence (optional)" htmlFor="reg-municipality" error={fieldError('municipalityId')} className="field-full" help="Only used for relevant platform features. Selecting a municipality does not establish official residency.">
            <Select id="reg-municipality" value={form.municipalityId} onChange={(event) => setForm({ ...form, municipalityId: event.target.value })}>
              <option value="">Prefer not to say</option>
              {(lookups?.municipalities || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </Field>
          <Field label="Preferred language" htmlFor="reg-language" className="field-full" help="You can change this at any time in your account settings.">
            <Select id="reg-language" value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })}>
              <option value="en">English</option>
              <option value="fil">Filipino</option>
            </Select>
          </Field>
        </div>

        <Field
          label="Password"
          htmlFor="reg-password"
          required
          error={fieldError('password')}
          help="At least 12 characters with uppercase, lowercase, a number and a symbol."
        >
          <PasswordInput id="reg-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required autoComplete="new-password" />
        </Field>
        {form.password ? (
          <div className="mb-4">
            <div className="progress" aria-hidden="true"><span style={{ width: `${(strength / 4) * 100}%` }} /></div>
            <span className="help">Password strength: {strengthLabel}</span>
          </div>
        ) : null}
        <Field label="Confirm password" htmlFor="reg-confirm" required error={fieldError('confirmPassword')}>
          <PasswordInput id="reg-confirm" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} required autoComplete="new-password" />
        </Field>

        <div className="stack-sm mb-4">
          <Checkbox
            id="accept-terms"
            checked={form.acceptTerms}
            onChange={(event) => setForm({ ...form, acceptTerms: event.target.checked })}
            label={<>I accept the <Link to="/terms-of-use" target="_blank">Terms of Use</Link>.</>}
          />
          {fieldError('acceptTerms') ? <span className="error-text">{fieldError('acceptTerms')}</span> : null}
          <Checkbox
            id="accept-privacy"
            checked={form.acceptPrivacy}
            onChange={(event) => setForm({ ...form, acceptPrivacy: event.target.checked })}
            label={<>I have read the <Link to="/privacy-policy" target="_blank">Privacy Policy</Link>.</>}
          />
          {fieldError('acceptPrivacy') ? <span className="error-text">{fieldError('acceptPrivacy')}</span> : null}
        </div>

        <Button type="submit" className="w-full" loading={busy}>Create account</Button>
        <p className="help mt-3">
          Optional fields can be skipped and completed later in your profile. BetterGo never asks you to choose an administrative role.
        </p>
      </form>
    </AuthShell>
  )
}

/* ------------------------------ Verify email ------------------------------ */
export function VerifyEmailPage() {
  useDocumentTitle('Verify email')
  const [params] = useSearchParams()
  const [state, setState] = useState({ status: 'idle', message: '' })
  const [email, setEmail] = useState('')
  const [resend, setResend] = useState(null)
  const token = params.get('token')

  useEffect(() => {
    if (!token) return
    setState({ status: 'loading', message: '' })
    api
      .post('/auth/verify-email', { token })
      .then((data) => setState({ status: 'success', message: data.message }))
      .catch((error) => setState({ status: 'error', message: error.message }))
  }, [token])

  return (
    <AuthShell title="Email verification" subtitle="Verifying your email keeps your account recoverable.">
      {!token ? (
        <Alert tone="warning" title="No verification token">
          Open the link from your verification email, or request a new link below.
        </Alert>
      ) : state.status === 'loading' ? (
        <div className="loading-block"><span className="spin" /> Verifying your email…</div>
      ) : state.status === 'success' ? (
        <Alert tone="success" title="Email verified">{state.message}</Alert>
      ) : (
        <Alert tone="error" title="Verification failed">{state.message}</Alert>
      )}

      <div className="mt-4 card">
        <h2 style={{ fontSize: 'var(--text-h4)' }}>Resend verification</h2>
        <p className="help">Rate limited to a few requests per hour.</p>
        <form
          className="mt-2"
          onSubmit={async (event) => {
            event.preventDefault()
            setResend({ busy: true })
            try {
              const result = await api.post('/auth/resend-verification', { email })
              setResend({ message: result.message, link: result.verificationUrl })
            } catch (error) {
              setResend({ message: error.message, error: true })
            }
          }}
        >
          <Field label="Email address" htmlFor="resend-email" required>
            <Input id="resend-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </Field>
          <Button type="submit" variant="outline" loading={resend?.busy} icon={Mail}>Send new link</Button>
        </form>
        {resend?.message ? (
          <Alert tone={resend.error ? 'error' : 'success'}>
            {resend.message}
            {resend.link ? <div><a href={resend.link}>Verify email (development link)</a></div> : null}
          </Alert>
        ) : null}
      </div>

      <div className="mt-4"><Link className="btn btn-ghost" to="/login">Back to sign in</Link></div>
    </AuthShell>
  )
}

/* ---------------------------- Forgot password ----------------------------- */
export function ForgotPasswordPage() {
  useDocumentTitle('Forgot password')
  const [email, setEmail] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  return (
    <AuthShell title="Forgot your password?" subtitle="Enter your registered email and we will send reset instructions.">
      {result ? (
        <Alert tone="success" title="Check your email">
          {result.message}
          {result.resetUrl ? (
            <div className="mt-2">
              <a href={result.resetUrl}>Reset password (development link)</a>
            </div>
          ) : null}
        </Alert>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            try {
              setResult(await api.post('/auth/forgot-password', { email }))
            } catch (error) {
              setResult({ message: error.message })
            } finally {
              setBusy(false)
            }
          }}
        >
          <Field label="Email address" htmlFor="forgot-email" required>
            <Input id="forgot-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>Send reset instructions</Button>
        </form>
      )}
      <p className="help mt-3">For security, the response is the same whether or not an account exists.</p>
      <div className="mt-4"><Link className="btn btn-ghost" to="/login">Back to sign in</Link></div>
    </AuthShell>
  )
}

/* ----------------------------- Reset password ----------------------------- */
export function ResetPasswordPage() {
  useDocumentTitle('Reset password')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [form, setForm] = useState({ password: '', confirmPassword: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const token = params.get('token')

  return (
    <AuthShell title="Choose a new password" subtitle="Your reset link can only be used once and expires after one hour.">
      {!token ? (
        <Alert tone="warning" title="Missing reset token">Open the link from your reset email, or request a new one.</Alert>
      ) : null}
      {error?.message ? <Alert tone="error" title="Could not reset password">{error.message}</Alert> : null}
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError(null)
          try {
            await api.post('/auth/reset-password', { token, ...form })
            navigate('/login?reset=1', { replace: true })
          } catch (err) {
            setError(err)
          } finally {
            setBusy(false)
          }
        }}
      >
        <Field label="New password" htmlFor="reset-password" required error={error?.details?.find((d) => d.field === 'password')?.message} help="At least 12 characters with uppercase, lowercase, a number and a symbol.">
          <PasswordInput id="reset-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" htmlFor="reset-confirm" required error={error?.details?.find((d) => d.field === 'confirmPassword')?.message}>
          <PasswordInput id="reset-confirm" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} required autoComplete="new-password" />
        </Field>
        <Button type="submit" className="w-full" loading={busy} disabled={!token}>Update password</Button>
      </form>
      <div className="mt-4"><Link className="btn btn-ghost" to="/login">Back to sign in</Link></div>
    </AuthShell>
  )
}
