import { Router } from 'express'
import { z } from 'zod'
import {
  SESSION_COOKIE,
  clearSessionCookie,
  consumeEmailToken,
  createEmailToken,
  hashPassword,
  passwordIssues,
  publicUser,
  rateLimit,
  recordLoginAttempt,
  requireAuth,
  sha256,
  startSession,
  tooManyRecentFailures,
  verifyPassword,
  activeAssignments,
} from '../auth.js'
import crypto from 'node:crypto'
import { get, nowIso, run, transaction } from '../db.js'
import { asyncHandler, forbidden, unauthorized, unprocessable, HttpError } from '../lib/http.js'
import { decryptSecret, encryptSecret, generateBackupCodes, generateSecret, hashBackupCode, otpauthUrl, verifyTotp } from '../lib/totp.js'
import { validate } from '../lib/validate.js'
import { emailTemplate, resetLink, sendMail, verificationLink } from '../lib/mailer.js'
import { env } from '../env.js'
import { logAudit } from '../audit.js'
import { authContext, invalidateAuthCache } from '../rbac.js'

export const authRouter = Router()

/** Security-relevant account events, separate from the administrative audit log. */
function recordSecurityEvent(userId, eventType, detail = null) {
  try {
    run(`INSERT INTO account_security_events (user_id, event_type, detail) VALUES (?, ?, ?)`, [userId, eventType, detail])
  } catch {
    /* a failed event log must never block a sign-in */
  }
}

/** Normalise a Philippine mobile number to +63 9XX XXX XXXX form. */
function normalisePhone(raw) {
  const digits = String(raw || '').replace(/[^0-9+]/g, '')
  if (/^\+639\d{9}$/.test(digits)) return digits
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`
  return null
}

const phoneSchema = z.object({ phone: z.string().trim().min(7).max(30) })

const emailField = z.string().trim().toLowerCase().email('Enter a valid email address.').max(200)
const nameField = z
  .string()
  .trim()
  .min(1, 'This field is required.')
  .max(80)
  .regex(/^[\p{L}\p{M}' .-]+$/u, 'Use letters, spaces, hyphens and apostrophes only.')

const registerSchema = z
  .object({
    firstName: nameField,
    middleName: z.string().trim().max(80).optional().or(z.literal('')),
    lastName: nameField,
    email: emailField,
    phone: z
      .string()
      .trim()
      .max(30)
      .regex(/^[+0-9()\s-]{7,30}$/, 'Enter a valid contact number.')
      .optional()
      .or(z.literal('')),
    municipalityId: z.coerce.number().int().positive().optional().or(z.literal('')),
    language: z.enum(['en', 'fil']).optional(),
    password: z.string().min(1, 'Enter a password.'),
    confirmPassword: z.string().min(1, 'Confirm your password.'),
    acceptTerms: z.union([z.boolean(), z.literal('true'), z.literal('on')]).transform((v) => v === true || v === 'true' || v === 'on'),
    acceptPrivacy: z.union([z.boolean(), z.literal('true'), z.literal('on')]).transform((v) => v === true || v === 'true' || v === 'on'),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match.' })
    }
    for (const problem of passwordIssues(data.password, { email: data.email })) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: problem })
    }
    if (!data.acceptTerms) {
      ctx.addIssue({ code: 'custom', path: ['acceptTerms'], message: 'You must accept the Terms of Use.' })
    }
    if (!data.acceptPrivacy) {
      ctx.addIssue({ code: 'custom', path: ['acceptPrivacy'], message: 'You must accept the Privacy Policy.' })
    }
  })

authRouter.post(
  '/register',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: (req) => `register:${req.ip}` }),
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const data = req.body
    const existing = get(`SELECT id FROM users WHERE lower(email) = ?`, [data.email])
    if (existing) {
      throw unprocessable('That email address is already registered.', [
        { field: 'email', message: 'An account with this email already exists.' },
      ])
    }
    if (data.municipalityId) {
      const municipality = get(`SELECT id FROM municipalities WHERE id = ?`, [Number(data.municipalityId)])
      if (!municipality) {
        throw unprocessable('Select a valid municipality.', [
          { field: 'municipalityId', message: 'Unknown municipality.' },
        ])
      }
    }

    const passwordHash = await hashPassword(data.password)
    const fullName = [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' ')

    const userId = transaction(() => {
      const result = run(
        `INSERT INTO users (name, email, phone, password_hash, account_status)
         VALUES (?, ?, ?, ?, 'pending_verification')`,
        [fullName, data.email, data.phone || null, passwordHash],
      )
      const id = Number(result.lastInsertRowid)
      run(
        `INSERT INTO user_profiles (user_id, first_name, middle_name, last_name, municipality_id, preferred_language)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.firstName,
          data.middleName || null,
          data.lastName,
          data.municipalityId ? Number(data.municipalityId) : null,
          data.language || 'en',
        ],
      )
      const citizenRole = get(`SELECT id FROM user_roles WHERE slug = 'citizen'`)
      run(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, status) VALUES (?, ?, 'global', 'active')`, [
        id,
        citizenRole.id,
      ])
      run(`INSERT INTO notification_preferences (user_id) VALUES (?)`, [id])
      const policyVersion = get(`SELECT version FROM legal_documents WHERE doc_type = 'privacy_policy' ORDER BY id DESC LIMIT 1`)
      for (const category of ['terms_of_use', 'privacy_policy']) {
        run(
          `INSERT INTO consent_records (user_id, consent_category, status, policy_version, source)
           VALUES (?, ?, 'granted', ?, 'registration_form')`,
          [id, category, policyVersion?.version || '0.9-draft'],
        )
      }
      return id
    })

    const token = createEmailToken(userId, 'verify_email', 1000 * 60 * 60 * 24)
    const link = verificationLink(token)
    const mail = await sendMail({
      to: data.email,
      subject: 'Verify your BetterGo Marinduque account',
      text: `Confirm your email address: ${link}\nThis link expires in 24 hours.`,
      html: emailTemplate({
        title: 'Confirm your email address',
        body: 'Thanks for creating a BetterGo Marinduque account. Confirm your email address to finish setting up your account.',
        actionLabel: 'Verify email',
        actionUrl: link,
        footnote: 'This link expires in 24 hours. If you did not create this account you can ignore this message.',
      }),
    })

    logAudit(req, {
      action: 'auth.register',
      module: 'authentication',
      entityType: 'user',
      entityId: userId,
      newValues: { email: data.email, role: 'citizen' },
    })

    res.status(201).json({
      message:
        'Account created. Check your email for the verification link, then sign in. Public accounts are always created with the Citizen role.',
      emailDelivery: mail.delivered ? 'sent' : 'not_configured',
      ...(env.devExposeVerificationLinks && !mail.delivered ? { verificationUrl: link } : {}),
    })
  }),
)

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password.'),
  mfaCode: z.string().trim().max(20).optional().or(z.literal('')),
})

authRouter.post(
  '/resend-verification',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5, key: (req) => `resend:${req.ip}` }),
  validate(z.object({ email: emailField })),
  asyncHandler(async (req, res) => {
    const user = get(`SELECT * FROM users WHERE lower(email) = ? AND deleted_at IS NULL`, [req.body.email])
    // Always the same response so the endpoint cannot be used to enumerate accounts.
    let verificationUrl
    let delivered = false
    if (user && !user.email_verified_at) {
      const token = createEmailToken(user.id, 'verify_email', 1000 * 60 * 60 * 24)
      const link = verificationLink(token)
      const mail = await sendMail({
        to: user.email,
        subject: 'Verify your BetterGo Marinduque account',
        text: `Confirm your email address: ${link}\nThis link expires in 24 hours.`,
        html: emailTemplate({
          title: 'Confirm your email address',
          body: 'Use the button below to confirm this address. This link expires in 24 hours.',
          actionLabel: 'Verify email',
          actionUrl: link,
        }),
      })
      delivered = mail.delivered
      if (env.devExposeVerificationLinks && !mail.delivered) verificationUrl = link
    }
    res.json({
      message: 'If that address belongs to an unverified account, a new verification link has been sent.',
      emailDelivery: delivered ? 'sent' : 'not_configured',
      ...(verificationUrl ? { verificationUrl } : {}),
    })
  }),
)

authRouter.post(
  '/login',
  rateLimit({ windowMs: 60 * 1000, max: 20, key: (req) => `login:${req.ip}` }),
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body
    if (tooManyRecentFailures(email, req.ip)) {
      throw new HttpError(429, 'Too many failed attempts. Please wait 15 minutes and try again.')
    }
    const user = get(`SELECT * FROM users WHERE lower(email) = ? AND deleted_at IS NULL`, [email])
    const valid = user ? await verifyPassword(password, user.password_hash) : false

    if (!user || !valid) {
      recordLoginAttempt(email, req.ip, false)
      logAudit(req, {
        action: 'auth.login_failed',
        module: 'authentication',
        entityType: 'user',
        entityId: user?.id ?? null,
        result: 'failure',
      })
      // Deliberately generic to prevent account enumeration.
      throw unauthorized('Email or password is incorrect.')
    }

    if (user.account_status === 'suspended' || user.account_status === 'disabled') {
      recordLoginAttempt(email, req.ip, false)
      throw forbidden('This account is not permitted to sign in. Contact platform support.')
    }

    // Optional second factor. The password was correct, but no session cookie
    // is issued until a valid authenticator or recovery code is presented.
    const mfa = get(`SELECT * FROM user_mfa WHERE user_id = ? AND enabled = 1`, [user.id])
    if (mfa) {
      const code = String(req.body.mfaCode || '').trim()
      if (!code) {
        return res.status(401).json({ error: 'Enter your authenticator code.', mfaRequired: true })
      }
      const secret = decryptSecret(mfa.secret_encrypted)
      const step = secret ? verifyTotp(secret, code) : null
      if (step === null) {
        const backup = get(
          `SELECT id FROM user_mfa_backup_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
          [user.id, hashBackupCode(code)],
        )
        if (!backup) {
          recordLoginAttempt(email, req.ip, false)
          recordSecurityEvent(user.id, 'mfa.failed')
          return res.status(401).json({ error: 'That code is not valid.', mfaRequired: true })
        }
        run(`UPDATE user_mfa_backup_codes SET used_at = ? WHERE id = ?`, [nowIso(), backup.id])
      } else {
        run(`UPDATE user_mfa SET last_used_step = ? WHERE user_id = ?`, [step, user.id])
      }
    }

    recordLoginAttempt(email, req.ip, true)
    run(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), user.id])
    startSession(req, res, user)
    logAudit(req, { action: 'auth.login', module: 'authentication', entityType: 'user', entityId: user.id })

    recordSecurityEvent(user.id, 'login.success')
    const refreshed = get(`SELECT * FROM users WHERE id = ?`, [user.id])
    res.json({
      user: publicUser(refreshed),
      mustVerifyEmail: !refreshed.email_verified_at,
      roles: activeAssignments(user.id).map((a) => ({ role: a.role_slug, municipalityId: a.municipality_id })),
    })
  }),
)

authRouter.post('/logout', (req, res) => {
  if (req.user) logAudit(req, { action: 'auth.logout', module: 'authentication', entityType: 'user', entityId: req.user.id })
  if (req.sessionId) run(`UPDATE auth_sessions SET revoked_at = ? WHERE session_id = ?`, [nowIso(), req.sessionId])
  clearSessionCookie(res)
  res.json({ message: 'Signed out.' })
})

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null })
  const profile = get(
    `SELECT p.*, m.name AS municipality_name, m.slug AS municipality_slug, b.name AS barangay_name
     FROM user_profiles p
     LEFT JOIN municipalities m ON m.id = p.municipality_id
     LEFT JOIN barangays b ON b.id = p.barangay_id
     WHERE p.user_id = ?`,
    [req.user.id],
  )
  const context = authContext(req.user)
  res.json({
    user: publicUser(req.user),
    // Verification flags live on users, not the profile table; surface them so
    // the account screens can show the real state.
    profile: { ...profile, phone: req.user.phone, phone_verified_at: req.user.phone_verified_at, email_verified_at: req.user.email_verified_at },
    roles: context.roles,
    permissions: [...context.permissions],
    municipalityIds: context.municipalityIds,
    hasGlobalScope: context.hasGlobalScope,
    isAdmin: context.isAdmin,
    isSuperAdmin: context.isSuperAdmin,
  })
})

authRouter.post(
  '/verify-email',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, key: (req) => `verify:${req.ip}` }),
  validate(z.object({ token: z.string().min(20, 'Invalid verification link.') })),
  asyncHandler(async (req, res) => {
    const userId = consumeEmailToken(req.body.token, 'verify_email')
    if (!userId) {
      throw unprocessable('This verification link is invalid, expired, or already used.', [
        { field: 'token', message: 'Invalid or expired token.' },
      ])
    }
    const user = get(`SELECT * FROM users WHERE id = ?`, [userId])
    if (!user) throw unprocessable('This verification link is no longer valid.')
    run(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), account_status = CASE WHEN account_status = 'pending_verification' THEN 'active' ELSE account_status END, updated_at = ? WHERE id = ?`,
      [nowIso(), nowIso(), userId],
    )
    invalidateAuthCache(userId)
    logAudit(req, { action: 'auth.email_verified', module: 'authentication', entityType: 'user', entityId: userId })
    res.json({ message: 'Your email address has been verified.' })
  }),
)

authRouter.post(
  '/resend-verification',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5, key: (req) => `resend:${req.ip}` }),
  validate(z.object({ email: emailField })),
  asyncHandler(async (req, res) => {
    const user = get(`SELECT * FROM users WHERE lower(email) = ? AND deleted_at IS NULL`, [req.body.email])
    // Generic response regardless of account existence.
    if (user && !user.email_verified_at) {
      const token = createEmailToken(user.id, 'verify_email', 1000 * 60 * 60 * 24)
      const link = verificationLink(token)
      const mail = await sendMail({
        to: user.email,
        subject: 'Verify your BetterGo Marinduque account',
        text: `Confirm your email address: ${link}`,
        html: emailTemplate({
          title: 'Verify your email address',
          body: 'Use the button below to confirm your email address.',
          actionLabel: 'Verify email',
          actionUrl: link,
        }),
      })
      logAudit(req, { action: 'auth.verification_resent', module: 'authentication', entityType: 'user', entityId: user.id })
      return res.json({
        message: 'If an unverified account exists for that address, a new verification link has been sent.',
        emailDelivery: mail.delivered ? 'sent' : 'not_configured',
        ...(env.devExposeVerificationLinks && !mail.delivered ? { verificationUrl: link } : {}),
      })
    }
    res.json({ message: 'If an unverified account exists for that address, a new verification link has been sent.' })
  }),
)

authRouter.post(
  '/forgot-password',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5, key: (req) => `forgot:${req.ip}` }),
  validate(z.object({ email: emailField })),
  asyncHandler(async (req, res) => {
    const user = get(`SELECT * FROM users WHERE lower(email) = ? AND deleted_at IS NULL`, [req.body.email])
    if (user) {
      const token = createEmailToken(user.id, 'reset_password', 1000 * 60 * 60)
      const link = resetLink(token)
      const mail = await sendMail({
        to: user.email,
        subject: 'Reset your BetterGo Marinduque password',
        text: `Reset your password: ${link}\nThis link expires in 1 hour.`,
        html: emailTemplate({
          title: 'Reset your password',
          body: 'We received a request to reset your password. This link expires in one hour and can be used once.',
          actionLabel: 'Choose a new password',
          actionUrl: link,
        }),
      })
      logAudit(req, { action: 'auth.password_reset_requested', module: 'authentication', entityType: 'user', entityId: user.id })
      return res.json({
        message: 'If an account exists for that address, password reset instructions have been sent.',
        emailDelivery: mail.delivered ? 'sent' : 'not_configured',
        ...(env.devExposeVerificationLinks && !mail.delivered ? { resetUrl: link } : {}),
      })
    }
    res.json({ message: 'If an account exists for that address, password reset instructions have been sent.' })
  }),
)

authRouter.post(
  '/reset-password',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: (req) => `reset:${req.ip}` }),
  validate(
    z
      .object({
        token: z.string().min(20, 'Invalid reset link.'),
        password: z.string().min(1, 'Enter a new password.'),
        confirmPassword: z.string().min(1, 'Confirm the new password.'),
      })
      .superRefine((data, ctx) => {
        if (data.password !== data.confirmPassword) {
          ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match.' })
        }
        for (const problem of passwordIssues(data.password)) {
          ctx.addIssue({ code: 'custom', path: ['password'], message: problem })
        }
      }),
  ),
  asyncHandler(async (req, res) => {
    const userId = consumeEmailToken(req.body.token, 'reset_password')
    if (!userId) {
      throw unprocessable('This reset link is invalid, expired, or already used.', [
        { field: 'token', message: 'Invalid or expired token.' },
      ])
    }
    const passwordHash = await hashPassword(req.body.password)
    // Reset also retires any session that existed before it.
    run(`UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?`, [
      passwordHash,
      nowIso(),
      userId,
    ])
    logAudit(req, { action: 'auth.password_reset', module: 'authentication', entityType: 'user', entityId: userId })
    clearSessionCookie(res)
    res.json({ message: 'Your password has been updated. Sign in with your new password.' })
  }),
)

authRouter.post(
  '/change-password',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  validate(
    z
      .object({
        currentPassword: z.string().min(1, 'Enter your current password.'),
        newPassword: z.string().min(1, 'Enter a new password.'),
        confirmPassword: z.string().min(1, 'Confirm the new password.'),
      })
      .superRefine((data, ctx) => {
        if (data.newPassword !== data.confirmPassword) {
          ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match.' })
        }
        for (const problem of passwordIssues(data.newPassword)) {
          ctx.addIssue({ code: 'custom', path: ['newPassword'], message: problem })
        }
      }),
  ),
  asyncHandler(async (req, res) => {
    const user = get(`SELECT * FROM users WHERE id = ?`, [req.user.id])
    const valid = await verifyPassword(req.body.currentPassword, user.password_hash)
    if (!valid) {
      throw unprocessable('Your current password is incorrect.', [
        { field: 'currentPassword', message: 'Incorrect password.' },
      ])
    }
    const passwordHash = await hashPassword(req.body.newPassword)
    run(`UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?`, [
      passwordHash,
      nowIso(),
      user.id,
    ])
    logAudit(req, { action: 'auth.password_changed', module: 'authentication', entityType: 'user', entityId: user.id })
    // Retire every existing session, then issue a fresh cookie for this device.
    const refreshed = get(`SELECT * FROM users WHERE id = ?`, [user.id])
    startSession(req, res, refreshed)
    res.json({ message: 'Password updated.' })
  }),
)

authRouter.post(
  '/request-email-change',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }),
  validate(z.object({ newEmail: emailField, password: z.string().min(1, 'Confirm your password.') })),
  asyncHandler(async (req, res) => {
    const user = get(`SELECT * FROM users WHERE id = ?`, [req.user.id])
    const valid = await verifyPassword(req.body.password, user.password_hash)
    if (!valid) {
      throw unprocessable('Your password is incorrect.', [{ field: 'password', message: 'Incorrect password.' }])
    }
    if (req.body.newEmail === user.email.toLowerCase()) {
      throw unprocessable('That is already your email address.', [
        { field: 'newEmail', message: 'Enter a different email address.' },
      ])
    }
    const conflict = get(`SELECT id FROM users WHERE lower(email) = ? AND id <> ?`, [req.body.newEmail, user.id])
    if (conflict) {
      throw unprocessable('That email address is already in use.', [
        { field: 'newEmail', message: 'This email is already registered.' },
      ])
    }
    const token = createEmailToken(user.id, 'change_email', 1000 * 60 * 60 * 24)
    // The raw token is only ever sent by email; the row stores its hash.
    run(`UPDATE email_tokens SET new_email = ? WHERE token_hash = ?`, [req.body.newEmail, sha256(token)])
    const link = `${env.publicSiteUrl}/dashboard/account?emailToken=${token}`
    const mail = await sendMail({
      to: req.body.newEmail,
      subject: 'Confirm your new BetterGo Marinduque email address',
      text: `Confirm your new email address: ${link}`,
      html: emailTemplate({
        title: 'Confirm your new email address',
        body: 'Use the button below to confirm this address for your account. Your current email stays active until you confirm.',
        actionLabel: 'Confirm new email',
        actionUrl: link,
      }),
    })
    logAudit(req, { action: 'auth.email_change_requested', module: 'authentication', entityType: 'user', entityId: user.id })
    res.json({
      message: 'Verification sent to the new address. Your current email remains active until it is confirmed.',
      emailDelivery: mail.delivered ? 'sent' : 'not_configured',
      ...(env.devExposeVerificationLinks && !mail.delivered ? { verificationUrl: link } : {}),
    })
  }),
)

authRouter.post(
  '/confirm-email-change',
  requireAuth,
  validate(z.object({ token: z.string().min(20, 'Invalid link.') })),
  asyncHandler(async (req, res) => {
    const row = get(
      `SELECT * FROM email_tokens WHERE token_hash = ? AND type = 'change_email' AND used_at IS NULL`,
      [sha256(String(req.body.token))],
    )
    if (!row || !row.new_email) {
      throw unprocessable('This link is invalid, expired, or already used.')
    }
    // Check ownership before consuming, so a link pasted into the wrong account
    // is not silently burned.
    if (Number(row.user_id) !== Number(req.user.id)) throw forbidden('This link belongs to a different account.')
    const userId = consumeEmailToken(req.body.token, 'change_email')
    if (!userId) throw unprocessable('This link is invalid, expired, or already used.')
    run(`UPDATE users SET email = ?, email_verified_at = ?, updated_at = ? WHERE id = ?`, [
      row.new_email,
      nowIso(),
      nowIso(),
      userId,
    ])
    logAudit(req, { action: 'auth.email_changed', module: 'authentication', entityType: 'user', entityId: userId })
    res.json({ message: 'Your email address has been updated and verified.', email: row.new_email })
  }),
)

/* --------------------------------------------------------------------------
 * Optional mobile verification (Prompt 59)
 *
 * No SMS provider is configured, so codes are never claimed as delivered. In
 * development the code is returned so the flow can be completed and tested.
 * ------------------------------------------------------------------------ */
authRouter.post(
  '/phone/send-code',
  requireAuth,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, key: (req) => `phone-code:${req.user.id}` }),
  validate(phoneSchema),
  asyncHandler(async (req, res) => {
    const phone = normalisePhone(req.body.phone)
    if (!phone) {
      throw unprocessable('Enter a valid Philippine mobile number, e.g. 09171234567.', [
        { field: 'phone', message: 'Use 09XXXXXXXXX or +639XXXXXXXXX.' },
      ])
    }
    const conflict = get(`SELECT id FROM users WHERE phone = ? AND id <> ? AND phone_verified_at IS NOT NULL`, [phone, req.user.id])
    if (conflict) {
      throw unprocessable('That number is already verified on another account.', [
        { field: 'phone', message: 'Use a different number.' },
      ])
    }
    const code = String(crypto.randomInt(100000, 1000000))
    run(`UPDATE phone_verifications SET used_at = ? WHERE user_id = ? AND used_at IS NULL`, [nowIso(), req.user.id])
    run(
      `INSERT INTO phone_verifications (user_id, phone, code_hash, expires_at) VALUES (?, ?, ?, datetime('now','+10 minutes'))`,
      [req.user.id, phone, sha256(code)],
    )
    recordSecurityEvent(req.user.id, 'phone.code_requested')
    res.status(201).json({
      message: 'A six-digit code was generated. SMS delivery is not configured on this deployment.',
      smsDelivery: 'not_configured',
      phone,
      ...(env.devExposeVerificationLinks ? { devCode: code } : {}),
    })
  }),
)

authRouter.post(
  '/phone/verify',
  requireAuth,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: (req) => `phone-verify:${req.user.id}` }),
  validate(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the six-digit code.') })),
  asyncHandler(async (req, res) => {
    const row = get(
      `SELECT * FROM phone_verifications WHERE user_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1`,
      [req.user.id],
    )
    if (!row) throw unprocessable('Request a new code first.', [{ field: 'code', message: 'No active code.' }])
    if (row.attempts >= 5) {
      throw unprocessable('Too many incorrect attempts. Request a new code.', [{ field: 'code', message: 'Code locked.' }])
    }
    const expired = Number(get(`SELECT datetime(?) < datetime('now') AS expired`, [row.expires_at]).expired)
    if (expired) throw unprocessable('That code has expired. Request a new one.', [{ field: 'code', message: 'Expired code.' }])
    if (row.code_hash !== sha256(req.body.code)) {
      run(`UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ?`, [row.id])
      throw unprocessable('That code is not correct.', [{ field: 'code', message: 'Incorrect code.' }])
    }
    run(`UPDATE phone_verifications SET used_at = ? WHERE id = ?`, [nowIso(), row.id])
    run(`UPDATE users SET phone = ?, phone_verified_at = ?, updated_at = ? WHERE id = ?`, [
      row.phone,
      nowIso(),
      nowIso(),
      req.user.id,
    ])
    recordSecurityEvent(req.user.id, 'phone.verified')
    logAudit(req, { action: 'auth.phone_verified', module: 'authentication', entityType: 'user', entityId: req.user.id })
    res.json({ message: 'Mobile number verified.', phone: row.phone })
  }),
)

authRouter.delete(
  '/phone',
  requireAuth,
  validate(z.object({ password: z.string().min(1, 'Confirm your password.') })),
  asyncHandler(async (req, res) => {
    const user = get(`SELECT * FROM users WHERE id = ?`, [req.user.id])
    const valid = await verifyPassword(req.body.password, user.password_hash)
    if (!valid) throw unprocessable('Your password is incorrect.', [{ field: 'password', message: 'Incorrect password.' }])
    run(`UPDATE users SET phone_verified_at = NULL, updated_at = ? WHERE id = ?`, [nowIso(), user.id])
    recordSecurityEvent(user.id, 'phone.removed')
    res.json({ message: 'Mobile verification removed. The number is kept on your profile until you change it.' })
  }),
)

/* --------------------------------------------------------------------------
 * Multi-factor authentication (Prompt 60)
 * ------------------------------------------------------------------------ */
authRouter.get(
  '/mfa/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = get(`SELECT enabled, enabled_at FROM user_mfa WHERE user_id = ?`, [req.user.id])
    res.json({
      enabled: Boolean(row?.enabled),
      enabledAt: row?.enabled_at || null,
      backupCodesRemaining: Number(
        get(`SELECT COUNT(*) AS n FROM user_mfa_backup_codes WHERE user_id = ? AND used_at IS NULL`, [req.user.id]).n,
      ),
    })
  }),
)

authRouter.post(
  '/mfa/setup',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: (req) => `mfa-setup:${req.user.id}` }),
  asyncHandler(async (req, res) => {
    const existing = get(`SELECT enabled FROM user_mfa WHERE user_id = ?`, [req.user.id])
    if (existing?.enabled) {
      throw unprocessable('Two-factor authentication is already enabled. Disable it first to set it up again.')
    }
    const secret = generateSecret()
    run(
      `INSERT INTO user_mfa (user_id, secret_encrypted, enabled) VALUES (?, ?, 0)
       ON CONFLICT(user_id) DO UPDATE SET secret_encrypted = excluded.secret_encrypted, enabled = 0`,
      [req.user.id, encryptSecret(secret)],
    )
    res.status(201).json({
      secret,
      otpauthUrl: otpauthUrl({ secret, email: req.user.email }),
      message: 'Scan the secret in an authenticator app, then confirm with a generated code.',
    })
  }),
)

authRouter.post(
  '/mfa/enable',
  requireAuth,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 15, key: (req) => `mfa-enable:${req.user.id}` }),
  validate(z.object({ code: z.string().trim().min(6).max(8) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM user_mfa WHERE user_id = ?`, [req.user.id])
    if (!row) throw unprocessable('Start setup first.')
    const secret = decryptSecret(row.secret_encrypted)
    const step = secret ? verifyTotp(secret, req.body.code) : null
    if (step === null) throw unprocessable('That code is not valid.', [{ field: 'code', message: 'Check the code and try again.' }])
    const codes = generateBackupCodes()
    run(`UPDATE user_mfa SET enabled = 1, enabled_at = ?, last_used_step = ? WHERE user_id = ?`, [nowIso(), step, req.user.id])
    run(`DELETE FROM user_mfa_backup_codes WHERE user_id = ?`, [req.user.id])
    for (const code of codes) {
      run(`INSERT INTO user_mfa_backup_codes (user_id, code_hash) VALUES (?, ?)`, [req.user.id, hashBackupCode(code)])
    }
    recordSecurityEvent(req.user.id, 'mfa.enabled')
    logAudit(req, { action: 'auth.mfa_enabled', module: 'authentication', entityType: 'user', entityId: req.user.id })
    res.json({ message: 'Two-factor authentication enabled. Store the recovery codes somewhere safe.', backupCodes: codes })
  }),
)

authRouter.post(
  '/mfa/disable',
  requireAuth,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: (req) => `mfa-disable:${req.user.id}` }),
  validate(z.object({ password: z.string().min(1, 'Confirm your password.'), code: z.string().trim().min(6).max(20) })),
  asyncHandler(async (req, res) => {
    const user = get(`SELECT * FROM users WHERE id = ?`, [req.user.id])
    const valid = await verifyPassword(req.body.password, user.password_hash)
    if (!valid) throw unprocessable('Your password is incorrect.', [{ field: 'password', message: 'Incorrect password.' }])
    const row = get(`SELECT * FROM user_mfa WHERE user_id = ? AND enabled = 1`, [req.user.id])
    if (!row) throw unprocessable('Two-factor authentication is not enabled.')
    const secret = decryptSecret(row.secret_encrypted)
    const step = secret ? verifyTotp(secret, req.body.code) : null
    const backup = get(`SELECT id FROM user_mfa_backup_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`, [
      req.user.id,
      hashBackupCode(req.body.code),
    ])
    if (step === null && !backup) throw unprocessable('That code is not valid.', [{ field: 'code', message: 'Invalid code.' }])
    run(`DELETE FROM user_mfa WHERE user_id = ?`, [req.user.id])
    run(`DELETE FROM user_mfa_backup_codes WHERE user_id = ?`, [req.user.id])
    recordSecurityEvent(req.user.id, 'mfa.disabled')
    logAudit(req, { action: 'auth.mfa_disabled', module: 'authentication', entityType: 'user', entityId: req.user.id })
    res.json({ message: 'Two-factor authentication disabled.' })
  }),
)

export { SESSION_COOKIE }
