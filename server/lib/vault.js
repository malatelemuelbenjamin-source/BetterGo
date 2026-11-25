import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Private document vault storage (Prompt 66).
 *
 * Files never live under the public uploads directory and are never given a
 * public URL: downloads always pass an ownership check and are streamed.
 */
export const VAULT_DIR = path.resolve(process.cwd(), process.env.VAULT_DIR || 'storage/vault')

export const DOCUMENT_CATEGORIES = {
  identification: 'Identification',
  civil_registry: 'Birth and civil registry',
  education: 'Education',
  employment: 'Employment',
  business: 'Business',
  medical: 'Medical support',
  property: 'Property',
  certificates: 'Certificates and clearances',
  application_support: 'Application support',
  other: 'Other personal document',
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024

/** Extension is only a hint; the real check is the magic-byte signature. */
const TYPES = [
  { mime: 'application/pdf', ext: 'pdf', signature: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'image/jpeg', ext: 'jpg', signature: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: 'png', signature: [0x89, 0x50, 0x4e, 0x47] },
]

export function detectFileType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null
  return TYPES.find((type) => type.signature.every((byte, index) => buffer[index] === byte)) || null
}

export function sanitiseFilename(name) {
  return String(name || 'document')
    .replace(/[\\/]+/g, '_')
    .replace(/[^\w.\- ()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'document'
}

/**
 * Store a validated buffer under a random name. Returns the storage reference
 * (a relative filename) and the SHA-256 digest used for duplicate awareness.
 */
export function storeFile(buffer, type) {
  fs.mkdirSync(VAULT_DIR, { recursive: true })
  const reference = `${crypto.randomUUID()}.${type.ext}`
  fs.writeFileSync(path.join(VAULT_DIR, reference), buffer, { mode: 0o600 })
  return { reference, sha256: crypto.createHash('sha256').update(buffer).digest('hex') }
}

export function readFile(reference) {
  const safe = path.basename(String(reference || ''))
  if (!safe) return null
  const full = path.join(VAULT_DIR, safe)
  if (!full.startsWith(VAULT_DIR)) return null
  return fs.existsSync(full) ? fs.readFileSync(full) : null
}

export function removeFile(reference) {
  const safe = path.basename(String(reference || ''))
  const full = path.join(VAULT_DIR, safe)
  if (!full.startsWith(VAULT_DIR)) return
  try {
    fs.unlinkSync(full)
  } catch { /* already gone */ }
}
