/**
 * Time-based one-time passwords (RFC 6238) and recovery codes.
 *
 * Implemented with node:crypto so no dependency is added. Secrets are only
 * stored encrypted with a key derived from SESSION_SECRET.
 */
import crypto from 'node:crypto'
import { env } from '../env.js'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateSecret(bytes = 20) {
  const buffer = crypto.randomBytes(bytes)
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31]
  return output
}

function base32Decode(secret) {
  const clean = String(secret).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '')
  let bits = 0
  let value = 0
  const output = []
  for (const character of clean) {
    const index = ALPHABET.indexOf(character)
    if (index === -1) continue
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(output)
}

function hotp(secret, counter) {
  const key = base32Decode(secret)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const digest = crypto.createHmac('sha1', key).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(code).padStart(6, '0')
}

/** Current time step (30 seconds) and the accepted window. */
export function currentStep(now = Date.now()) {
  return Math.floor(now / 30_000)
}

/** Verify a 6-digit code, allowing one step of clock drift either way. */
export function verifyTotp(secret, token, now = Date.now()) {
  const code = String(token || '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(code)) return null
  const step = currentStep(now)
  for (const candidate of [step - 1, step, step + 1]) {
    if (hotp(secret, candidate) === code) return candidate
  }
  return null
}

export function generateTotp(secret, now = Date.now()) {
  return hotp(secret, currentStep(now))
}

export function otpauthUrl({ secret, email, issuer = 'BetterGo Marinduque' }) {
  const label = encodeURIComponent(`${issuer}:${email}`)
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' })
  return `otpauth://totp/${label}?${params.toString()}`
}

function encryptionKey() {
  return crypto.scryptSync(String(env.sessionSecret || 'bettergo-development'), 'bettergo-mfa', 32)
}

export function encryptSecret(secret) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.')
}

export function decryptSecret(payload) {
  try {
    const [iv, tag, data] = String(payload).split('.')
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

export function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})(.{5})/, '$1-$2'))
}

export function hashBackupCode(code) {
  return crypto.createHash('sha256').update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex')
}
