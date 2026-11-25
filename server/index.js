import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'
import { env, validateEnv } from './env.js'
import { attachUser } from './auth.js'
import { seed } from './seed.js'
import { authRouter } from './routes/auth.js'
import { publicRouter } from './routes/public.js'
import { searchRouter } from './routes/search.js'
import { municipalRouter } from './routes/municipal.js'
import { adminMunicipalRouter } from './routes/admin-municipal.js'
import { servicesRouter } from './routes/services.js'
import { adminServicesRouter } from './routes/admin-services.js'
import { accountRouter } from './routes/account.js'
import { formsRouter } from './routes/forms.js'
import { adminFormsRouter } from './routes/admin-forms.js'
import { applicationsRouter } from './routes/applications.js'
import { vaultRouter } from './routes/vault.js'
import { adminApplicationsRouter } from './routes/admin-applications.js'
import { recordsRouter, adminRecordsRouter } from './routes/records.js'
import { notificationsRouter } from './routes/notifications.js'
import { adminNotificationsRouter } from './routes/admin-notifications.js'
import { helpRouter, supportRouter, adminSupportRouter } from './routes/support.js'
import { feedbackRouter, adminFeedbackRouter } from './routes/feedback.js'
import { privacyRouter, adminPrivacyRouter } from './routes/privacy.js'
import { discoveryRouter, adminDiscoveryRouter } from './routes/discovery.js'
import { assistanceRouter, adminAssistanceRouter } from './routes/assistance.js'
import { appointmentsRouter, adminAppointmentsRouter } from './routes/appointments.js'
import { paymentsRouter, adminPaymentsRouter, paymentCallbackRouter } from './routes/payments.js'
import { documentRequestsRouter, adminDocumentRequestsRouter } from './routes/document-requests.js'
import { complaintsRouter, adminComplaintsRouter } from './routes/complaints.js'
import { identityRouter, adminIdentityRouter } from './routes/identity.js'
import { delegationsRouter } from './routes/delegations.js'
import { consentRouter, adminConsentRouter } from './routes/consent.js'
import { personalizationRouter, adminPersonalizationRouter } from './routes/personalization.js'
import { offlineRouter, adminOfflineRouter } from './routes/offline.js'
import { translationsRouter, adminTranslationsRouter } from './routes/translations.js'
import { portabilityRouter, adminPortabilityRouter } from './routes/portability.js'
import { securityRouter, adminSecurityRouter } from './routes/security.js'
import { journeysRouter, adminJourneysRouter } from './routes/journeys.js'
import { lifecycleRouter, adminLifecycleRouter, reactivateRouter } from './routes/lifecycle.js'
import { consentRequestsRouter, adminConsentRequestsRouter } from './routes/consent-requests.js'
import { financePublicRouter, financeAdminRouter } from './routes/finance.js'
import { monitoringPublicRouter, monitoringAdminRouter } from './routes/monitoring.js'
import { reportsPublicRouter, reportsAccountRouter, reportsAdminRouter } from './routes/reports.js'
import { openDataPublicRouter, openDataAdminRouter } from './routes/opendata.js'
import { alertsPublicRouter, alertsAccountRouter, alertsAdminRouter } from './routes/alerts.js'
import { communityPublicRouter, communityAdminRouter } from './routes/community.js'
import { finalizationPublicRouter, finalizationAdminRouter } from './routes/finalization.js'
import { all } from './db.js'
import { adminRouter } from './routes/admin.js'
import { adminContentRouter } from './routes/admin-content.js'
import { HttpError } from './lib/http.js'

const problems = validateEnv()
if (problems.length) {
  console.error('[config] refusing to start:\n - ' + problems.join('\n - '))
  process.exit(1)
}

seed({ quiet: false })

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)

// --- Security headers -------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  if (env.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-src 'self' https://www.openstreetmap.org",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    )
  }
  next()
})

// --- CSRF: reject cross-site state-changing requests ------------------------
const allowedOrigins = new Set(
  [env.appOrigin, env.publicSiteUrl]
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin
      } catch {
        return null
      }
    })
    .filter(Boolean),
)

app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const origin = req.get('origin')
  if (!origin) return next() // Same-origin fetches may omit Origin; cookies still apply.
  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    return res.status(403).json({ error: 'Invalid request origin.' })
  }
  if (originHost === req.get('host') || allowedOrigins.has(origin)) return next()
  return res.status(403).json({ error: 'Cross-site request blocked.' })
})

// --- Body parsing -----------------------------------------------------------
// Raw binary endpoints must be registered before the JSON parser.
app.use('/api/account/photo', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }))
app.use('/api/admin/media', express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], limit: '12mb' }))
app.use('/api/account/documents', express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '11mb' }))
app.use('/api/account/support/tickets/:reference/attachments', express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '11mb' }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '100kb' }))
app.use(cookieParser())

// --- Session -----------------------------------------------------------------
app.use(attachUser)

// Small request logger (no bodies, no secrets).
app.use((req, res, next) => {
  const started = Date.now()
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`)
    }
  })
  next()
})

// --- API routes --------------------------------------------------------------
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))

// Public discovery. Private administrative pages and APIs are excluded.
app.get('/robots.txt', (req, res) => {
  const base = env.publicSiteUrl || `${req.protocol}://${req.get('host')}`
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /dashboard\nDisallow: /api/\nDisallow: /uploads\nSitemap: ${base.replace(/\/$/, '')}/sitemap.xml\n`)
})
app.get('/sitemap.xml', (req, res) => {
  const base = (env.publicSiteUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
  const paths = ['/', '/services', '/municipalities', '/transparency', '/transparency/finance', '/transparency/budgets', '/transparency/financial-monitoring', '/transparency/reports', '/transparency/reports/builder', '/transparency/reports/methodology', '/transparency/open-data', '/transparency/open-data/datasets', '/transparency/open-data/categories', '/transparency/open-data/downloads', '/transparency/open-data/methodology', '/transparency/alerts', '/transparency/community', '/transparency/community/questions', '/transparency/community/discussions', '/transparency/community/topics', '/transparency/community/experts', '/transparency/community/guidelines', '/transparency/documents', '/about', '/contact', '/privacy-policy', '/terms-of-use', '/disclaimer']
  for (const municipality of all(`SELECT slug FROM municipalities WHERE is_active = 1 ORDER BY id`)) {
    paths.push(`/municipalities/${municipality.slug}`)
    paths.push(`/transparency/financial-monitoring/${municipality.slug}`)
  }
  for (const row of all(`SELECT reference FROM financial_records WHERE publication_status = 'published' ORDER BY id LIMIT 5000`)) paths.push(`/transparency/finance/record/${row.reference}`)
  const body = paths.map((path) => `<url><loc>${base}${path}</loc><changefreq>${path === '/' ? 'daily' : 'weekly'}</changefreq></url>`).join('')
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`)
})
app.use('/api/auth', reactivateRouter)
app.use('/api/auth', authRouter)
// Global search (all public modules) and the Phase 2 service directory are
// registered before Phase 1's public router. They own those paths outright;
// every other public route still falls through to the original router.
// Municipal portals (Phase 3) own /api/municipal-portals and the
// municipality-scoped /api/v1 paths, so they are registered first.
app.use('/api', financePublicRouter)
app.use('/api', monitoringPublicRouter)
app.use('/api', reportsPublicRouter)
app.use('/api', reportsAccountRouter)
app.use('/api', openDataPublicRouter)
app.use('/api', alertsPublicRouter)
app.use('/api', alertsAccountRouter)
app.use('/api', communityPublicRouter)
app.use('/api', finalizationPublicRouter)
app.use('/api', municipalRouter)
app.use('/api', searchRouter)
app.use('/api', formsRouter)
app.use('/api', servicesRouter)
app.use('/api', publicRouter)
app.use('/api/help', helpRouter)
app.use('/api', feedbackRouter)
app.use('/api/account', supportRouter)
app.use('/api/account', privacyRouter)
app.use('/api/account', discoveryRouter)
app.use('/api/account', assistanceRouter)
app.use('/api/account', appointmentsRouter)
app.use('/api/account', paymentsRouter)
app.use('/api/account', documentRequestsRouter)
app.use('/api/account', complaintsRouter)
app.use('/api/account', identityRouter)
app.use('/api/account', delegationsRouter)
app.use('/api/account', consentRequestsRouter)
app.use('/api/account', consentRouter)
app.use('/api/account', personalizationRouter)
app.use('/api/account', offlineRouter)
app.use('/api/account', translationsRouter)
app.use('/api/account', portabilityRouter)
app.use('/api/account', securityRouter)
app.use('/api/account', journeysRouter)
app.use('/api/account', lifecycleRouter)
app.use('/api/admin', adminLifecycleRouter)
app.use('/api/admin', adminConsentRequestsRouter)
app.use('/api/admin', financeAdminRouter)
app.use('/api/admin', monitoringAdminRouter)
app.use('/api/admin', reportsAdminRouter)
app.use('/api/admin', openDataAdminRouter)
app.use('/api/admin', alertsAdminRouter)
app.use('/api/admin', communityAdminRouter)
app.use('/api/admin', finalizationAdminRouter)
app.use('/api/account', notificationsRouter)
app.use('/api/account', accountRouter)
app.use('/api/admin', adminMunicipalRouter)
app.use('/api/admin', adminServicesRouter)
app.use('/api/admin', adminFormsRouter)
app.use('/api/admin', adminApplicationsRouter)
app.use('/api/admin', adminRecordsRouter)
app.use('/api/admin', adminNotificationsRouter)
app.use('/api/admin/support', adminSupportRouter)
app.use('/api/account', recordsRouter)
app.use('/api', applicationsRouter)
app.use('/api', vaultRouter)
app.use('/api/admin', adminFeedbackRouter)
app.use('/api/admin', adminPrivacyRouter)
app.use('/api/admin', adminDiscoveryRouter)
app.use('/api/admin', adminAssistanceRouter)
app.use('/api/admin', adminAppointmentsRouter)
app.use('/api/admin', adminPaymentsRouter)
app.use('/api/admin', adminDocumentRequestsRouter)
app.use('/api/admin', adminComplaintsRouter)
app.use('/api/admin', adminIdentityRouter)
app.use('/api/admin', adminConsentRouter)
app.use('/api/admin', adminPersonalizationRouter)
app.use('/api/admin', adminOfflineRouter)
app.use('/api/admin', adminTranslationsRouter)
app.use('/api/admin', adminPortabilityRouter)
app.use('/api/admin', adminSecurityRouter)
app.use('/api/admin', adminJourneysRouter)
app.use('/api/admin', adminRouter)
app.use('/api/admin', adminContentRouter)

app.use('/api', paymentCallbackRouter)
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }))

// --- Uploaded files ----------------------------------------------------------
const uploadsRoot = path.resolve(process.cwd(), env.uploadsDir)
fs.mkdirSync(uploadsRoot, { recursive: true })
app.use(
  '/uploads',
  express.static(uploadsRoot, {
    index: false,
    dotfiles: 'deny',
    maxAge: '1h',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Disposition', 'inline')
    },
  }),
)

// --- Static frontend (production build) --------------------------------------
const distDir = path.resolve(process.cwd(), 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

// --- Error handling -----------------------------------------------------------
app.use((error, req, res, _next) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, details: error.details })
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'The submitted data is too large.' })
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed request body.' })
  }
  console.error('[error]', error?.stack || error)
  res.status(500).json({ error: 'Something went wrong on our side. Please try again later.' })
})

const server = app.listen(env.apiPort, '0.0.0.0', () => {
  console.log(`[api] BetterGo Marinduque API listening on http://0.0.0.0:${env.apiPort}`)
  if (!env.smtpUrl) {
    console.log('[mail] No email provider configured. Verification and reset links are logged, not delivered.')
  }
})

function shutdown(signal) {
  console.log(`[api] ${signal} received, shutting down`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

export { app }
