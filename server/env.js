import fs from 'node:fs'
import path from 'node:path'

// Minimal .env loader (no dependency). Values already in process.env win.
function loadEnvFile(file = '.env') {
  const full = path.resolve(process.cwd(), file)
  if (!fs.existsSync(full)) return
  for (const rawLine of fs.readFileSync(full, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile()

const isProduction = process.env.NODE_ENV === 'production'
const sessionSecret =
  process.env.SESSION_SECRET || (isProduction ? '' : 'dev-only-insecure-session-secret-change-me')

export const env = {
  isProduction,
  apiPort: Number(process.env.API_PORT || 3001),
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:3000',
  publicSiteUrl: (process.env.PUBLIC_SITE_URL || process.env.APP_ORIGIN || 'http://localhost:3000').replace(/\/$/, ''),
  sessionSecret,
  databasePath: process.env.DATABASE_PATH || './data/bettergo.db',
  uploadsDir: process.env.UPLOADS_DIR || './uploads',
  mailFrom: process.env.MAIL_FROM || 'BetterGo Marinduque <no-reply@example.com>',
  smtpUrl: process.env.SMTP_URL || '',
  devExposeVerificationLinks:
    !isProduction && String(process.env.DEV_EXPOSE_VERIFICATION_LINKS || '').toLowerCase() === 'true',
  // Maximum upload size for public documents (bytes).
  maxUploadBytes: 10 * 1024 * 1024,
}

export function validateEnv() {
  const problems = []
  if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
    problems.push('SESSION_SECRET must be set to a random value of at least 32 characters in production.')
  }
  if (isProduction && !process.env.PUBLIC_SITE_URL) {
    problems.push('PUBLIC_SITE_URL should be set in production for canonical URLs.')
  }
  return problems
}
