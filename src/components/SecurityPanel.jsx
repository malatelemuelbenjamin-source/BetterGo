import { useEffect, useState } from 'react'
import { Mail, Smartphone, ShieldCheck, KeyRound } from 'lucide-react'
import { api } from '../api'
import { Alert, Badge, Button, Field, Input, PasswordInput, useToast } from './ui'
import { useAuth } from '../auth'

/**
 * Email, mobile and two-factor controls for the signed-in account.
 *
 * Nothing here claims that a message was delivered or that a second factor is
 * active unless the API confirms it. SMS is not configured on this deployment,
 * so the development code is surfaced with a clear label instead.
 */
export default function SecurityPanel() {
  const { user, profile, refresh } = useAuth()
  const toast = useToast()
  const [resending, setResending] = useState(false)
  const [resendResult, setResendResult] = useState(null)

  const [phone, setPhone] = useState('')
  const [phoneCode, setPhoneCode] = useState('')
  const [phoneStage, setPhoneStage] = useState('idle')
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [devCode, setDevCode] = useState(null)

  const [mfa, setMfa] = useState({ enabled: false, backupCodesRemaining: 0 })
  const [setup, setSetup] = useState(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaPassword, setMfaPassword] = useState('')
  const [mfaBusy, setMfaBusy] = useState(false)

  useEffect(() => {
    api.get('/auth/mfa/status').then(setMfa).catch(() => {})
  }, [])

  const resend = async () => {
    setResending(true)
    setResendResult(null)
    try {
      const result = await api.post('/auth/resend-verification', { email: user?.email })
      setResendResult(result)
      toast.push(result.message)
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setResending(false)
    }
  }

  const sendPhoneCode = async () => {
    setPhoneBusy(true)
    try {
      const result = await api.post('/auth/phone/send-code', { phone })
      setPhoneStage('code')
      setDevCode(result.devCode || null)
      toast.push(result.message)
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setPhoneBusy(false)
    }
  }

  const verifyPhone = async () => {
    setPhoneBusy(true)
    try {
      await api.post('/auth/phone/verify', { code: phoneCode })
      toast.push('Mobile number verified.')
      setPhoneStage('idle')
      setPhoneCode('')
      setDevCode(null)
      await refresh()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setPhoneBusy(false)
    }
  }

  const startSetup = async () => {
    setMfaBusy(true)
    try {
      const result = await api.post('/auth/mfa/setup')
      setSetup(result)
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setMfaBusy(false)
    }
  }

  const enableMfa = async () => {
    setMfaBusy(true)
    try {
      const result = await api.post('/auth/mfa/enable', { code: mfaCode })
      setMfa({ enabled: true, backupCodesRemaining: result.backupCodes.length, backupCodes: result.backupCodes })
      setSetup(null)
      setMfaCode('')
      toast.push('Two-factor authentication enabled.')
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setMfaBusy(false)
    }
  }

  const disableMfa = async () => {
    setMfaBusy(true)
    try {
      await api.post('/auth/mfa/disable', { password: mfaPassword, code: mfaCode })
      setMfa({ enabled: false, backupCodesRemaining: 0 })
      setMfaPassword('')
      setMfaCode('')
      toast.push('Two-factor authentication disabled.')
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setMfaBusy(false)
    }
  }

  return (
    <div className="card mt-4">
      <h2 style={{ fontSize: 'var(--text-h4)' }}>Verification and sign-in security</h2>

      <div className="grid grid-2 mt-3">
        <div>
          <h3 style={{ fontSize: '1rem' }}><Mail size={15} aria-hidden="true" /> Email address</h3>
          <p className="text-sm text-muted">
            {user?.email}{' '}
            {profile?.email_verified_at ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Not verified</Badge>}
          </p>
          {profile?.email_verified_at ? null : (
            <Button variant="outline" size="sm" onClick={resend} loading={resending}>Resend verification link</Button>
          )}
          {resendResult?.verificationUrl ? (
            <p className="help mt-2">
              Development link (no email provider is configured):{' '}
              <a href={resendResult.verificationUrl}>open verification link</a>
            </p>
          ) : null}
        </div>

        <div>
          <h3 style={{ fontSize: '1rem' }}><Smartphone size={15} aria-hidden="true" /> Mobile number</h3>
          {profile?.phone_verified_at ? (
            <p className="text-sm text-muted">{profile.phone || user?.phone} <Badge tone="success">Verified</Badge></p>
          ) : (
            <>
              <p className="text-sm text-muted">
                Optional. SMS delivery is not configured on this deployment, so a development code is shown instead of being sent.
              </p>
              {phoneStage === 'idle' ? (
                <div className="row" style={{ gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <Field label="Mobile number" htmlFor="phone-input">
                    <Input id="phone-input" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="09171234567" maxLength={30} />
                  </Field>
                  <Button variant="outline" size="sm" onClick={sendPhoneCode} loading={phoneBusy}>Send code</Button>
                </div>
              ) : (
                <div className="row" style={{ gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <Field label="Six-digit code" htmlFor="phone-code">
                    <Input id="phone-code" value={phoneCode} onChange={(event) => setPhoneCode(event.target.value)} inputMode="numeric" maxLength={6} />
                  </Field>
                  <Button variant="outline" size="sm" onClick={verifyPhone} loading={phoneBusy}>Verify</Button>
                </div>
              )}
              {devCode ? <p className="help mt-2">Development code: <strong>{devCode}</strong></p> : null}
            </>
          )}
        </div>
      </div>

      <div className="dropdown-sep" />

      <div>
        <h3 style={{ fontSize: '1rem' }}><ShieldCheck size={15} aria-hidden="true" /> Two-factor authentication</h3>
        {mfa.enabled ? (
          <>
            <p className="text-sm text-muted">
              <Badge tone="success">Enabled</Badge> {mfa.backupCodesRemaining} recovery code{mfa.backupCodesRemaining === 1 ? '' : 's'} remaining.
            </p>
            <div className="grid grid-2 mt-2">
              <Field label="Password" htmlFor="mfa-password">
                <PasswordInput id="mfa-password" value={mfaPassword} onChange={(event) => setMfaPassword(event.target.value)} autoComplete="current-password" />
              </Field>
              <Field label="Authenticator or recovery code" htmlFor="mfa-disable-code">
                <Input id="mfa-disable-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} maxLength={20} />
              </Field>
            </div>
            <Button variant="danger" size="sm" onClick={disableMfa} loading={mfaBusy}>Disable two-factor</Button>
          </>
        ) : setup ? (
          <>
            <p className="text-sm text-muted">
              Add this secret to an authenticator app, then enter the six-digit code it shows. The secret is stored encrypted and is never
              shown again.
            </p>
            <p className="text-sm"><code className="break-word">{setup.secret}</code></p>
            <Field label="Six-digit code" htmlFor="mfa-enable-code">
              <Input id="mfa-enable-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" maxLength={6} />
            </Field>
            <Button size="sm" onClick={enableMfa} loading={mfaBusy}>Enable two-factor</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Optional. Requires an authenticator app that supports time-based codes. Recovery codes are issued once.
            </p>
            <Button variant="outline" size="sm" icon={KeyRound} onClick={startSetup} loading={mfaBusy}>Set up two-factor</Button>
          </>
        )}
        {mfa.backupCodes?.length ? (
          <Alert tone="warning" title="Store these recovery codes now">
            <p className="text-sm">Each code works once if you lose access to your authenticator app.</p>
            <ul className="text-sm">{mfa.backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
          </Alert>
        ) : null}
      </div>

      <p className="help mt-3">
        BetterGo never asks for a government ID number to create or secure an account. Completing your profile does not verify your identity.
      </p>
    </div>
  )
}
