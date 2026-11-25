import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { requireAuth, rateLimit } from '../auth.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { DOCUMENT_CATEGORIES, MAX_FILE_BYTES, detectFileType, readFile, removeFile, sanitiseFilename, storeFile } from '../lib/vault.js'

/**
 * Personal document vault (Prompt 66). Every route is owner-scoped; documents
 * are never public and are streamed only after an ownership check.
 */
export const vaultRouter = Router()
vaultRouter.use('/account/documents', requireAuth)

const categoryKeys = Object.keys(DOCUMENT_CATEGORIES)

const catLabel = (key) => DOCUMENT_CATEGORIES[key] || DOCUMENT_CATEGORIES.other

function ownedDocument(userId, id) {
  const document = get(`SELECT * FROM citizen_documents WHERE id = ? AND user_id = ? AND status <> 'deleted'`, [Number(id), userId])
  if (!document) throw notFound('Document not found.')
  return document
}

function serialise(row) {
  return {
    id: row.id,
    title: row.title || row.original_filename,
    originalFilename: row.original_filename,
    category: row.category,
    categoryLabel: catLabel(row.category),
    description: row.description || null,
    issuer: row.issuer || null,
    issuedAt: row.issued_at || null,
    expiresAt: row.expires_at || null,
    folderId: row.folder_id || null,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    version: row.version || 1,
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at || null,
    /** Metadata supplied by the citizen is never presented as verified. */
    metadataSource: 'citizen_provided',
  }
}

function logEvent(documentId, userId, eventType, detail) {
  run(`INSERT INTO document_events (document_id, user_id, event_type, detail) VALUES (?, ?, ?, ?)`, [
    documentId,
    userId,
    eventType,
    detail ? String(detail).slice(0, 300) : null,
  ])
}

vaultRouter.get(
  '/account/documents',
  asyncHandler(async (req, res) => {
    const category = categoryKeys.includes(String(req.query.category)) ? String(req.query.category) : null
    const term = cleanText(req.query.q, 100)
    const folderId = Number(req.query.folderId) || null
    const sort = ['newest', 'oldest', 'expiring', 'title'].includes(String(req.query.sort)) ? String(req.query.sort) : 'newest'
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))

    const where = [`user_id = ?`, `status <> 'deleted'`]
    const params = [req.user.id]
    if (category) {
      where.push('category = ?')
      params.push(category)
    }
    if (folderId) {
      where.push('folder_id = ?')
      params.push(folderId)
    }
    if (term) {
      where.push('(COALESCE(title, original_filename) LIKE ? OR original_filename LIKE ?)')
      params.push(`%${term}%`, `%${term}%`)
    }
    const order =
      sort === 'oldest' ? 'id ASC' : sort === 'title' ? 'COALESCE(title, original_filename) ASC' : sort === 'expiring' ? 'expires_at IS NULL, expires_at ASC' : 'id DESC'

    const rows = all(`SELECT * FROM citizen_documents WHERE ${where.join(' AND ')} ORDER BY ${order}`, params)
    const usedBytes = Number(get(`SELECT COALESCE(SUM(file_size), 0) AS n FROM citizen_documents WHERE user_id = ? AND status <> 'deleted'`, [req.user.id]).n)

    res.json({
      results: rows.slice((page - 1) * limit, page * limit).map(serialise),
      total: rows.length,
      page,
      limit,
      categories: DOCUMENT_CATEGORIES,
      counts: Object.fromEntries(
        categoryKeys.map((key) => [
          key,
          Number(get(`SELECT COUNT(*) AS n FROM citizen_documents WHERE user_id = ? AND status <> 'deleted' AND category = ?`, [req.user.id, key]).n),
        ]),
      ),
      folders: all(`SELECT id, name, created_at FROM document_folders WHERE user_id = ? ORDER BY name`, [req.user.id]),
      storage: { usedBytes, limitBytes: 100 * 1024 * 1024, limitNote: 'A 100 MB per-account vault limit is applied by BetterGo, not by any government office.' },
      note: 'Documents stay in your private BetterGo vault. BetterGo does not verify, certify or authenticate them, and they are never sent to an office automatically.',
    })
  }),
)

vaultRouter.get(
  '/account/documents/security',
  asyncHandler(async (req, res) => {
    res.json({
      total: Number(get(`SELECT COUNT(*) AS n FROM citizen_documents WHERE user_id = ? AND status <> 'deleted'`, [req.user.id]).n),
      expiringSoon: all(
        `SELECT id, COALESCE(title, original_filename) AS title, expires_at FROM citizen_documents
         WHERE user_id = ? AND status <> 'deleted' AND expires_at IS NOT NULL
           AND date(expires_at) <= date('now', '+60 days') ORDER BY expires_at ASC LIMIT 10`,
        [req.user.id],
      ),
      recentActivity: all(
        `SELECT e.event_type, e.detail, e.created_at, d.id AS document_id, COALESCE(d.title, d.original_filename) AS document_title
         FROM document_events e JOIN citizen_documents d ON d.id = e.document_id
         WHERE e.user_id = ? ORDER BY e.id DESC LIMIT 15`,
        [req.user.id],
      ),
      shares: all(
        `SELECT s.id, s.recipient_label, s.purpose, s.consented_at, d.id AS document_id, COALESCE(d.title, d.original_filename) AS document_title
         FROM document_shares s JOIN citizen_documents d ON d.id = s.document_id
         WHERE s.user_id = ? AND s.revoked_at IS NULL ORDER BY s.id DESC`,
        [req.user.id],
      ),
      note: 'BetterGo never shares a vault document outside the platform unless you authorise a specific share.',
    })
  }),
)

vaultRouter.post(
  '/account/documents',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }),
  asyncHandler(async (req, res) => {
    const buffer = req.body
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw unprocessable('No file data received.')
    if (buffer.length > MAX_FILE_BYTES) throw unprocessable('Documents must be 10 MB or smaller.')
    const type = detectFileType(buffer)
    if (!type) throw unprocessable('Upload a PDF, JPG or PNG file. Other formats are not accepted.')

    const category = categoryKeys.includes(String(req.query.category)) ? String(req.query.category) : 'other'
    const title = cleanText(req.query.title, 160) || sanitiseFilename((req.get('x-file-name') || req.get('x-filename')) || 'Document')
    const folderId = Number(req.query.folderId) || null
    if (folderId) {
      const folder = get(`SELECT id FROM document_folders WHERE id = ? AND user_id = ?`, [folderId, req.user.id])
      if (!folder) throw unprocessable('That folder does not exist.')
    }
    const { reference, sha256 } = storeFile(buffer, type)
    const id = Number(
      run(
        `INSERT INTO citizen_documents
          (user_id, category, original_filename, storage_reference, mime_type, file_size, title, description, issuer, issued_at, expires_at, folder_id, sha256, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        [
          req.user.id,
          category,
          sanitiseFilename((req.get('x-file-name') || req.get('x-filename')) || `document.${type.ext}`),
          reference,
          type.mime,
          buffer.length,
          title,
          cleanText(req.query.description, 500) || null,
          cleanText(req.query.issuer, 160) || null,
          /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.issuedAt || '')) ? String(req.query.issuedAt) : null,
          /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.expiresAt || '')) ? String(req.query.expiresAt) : null,
          folderId,
          sha256,
        ],
      ).lastInsertRowid,
    )
    logEvent(id, req.user.id, 'uploaded', `${type.mime}, ${buffer.length} bytes`)
    logAudit(req, { action: 'citizen.document_uploaded', module: 'citizen', entityType: 'citizen_document', entityId: id })
    res.status(201).json({ document: serialise(get(`SELECT * FROM citizen_documents WHERE id = ?`, [id])) })
  }),
)

/* --------------------------------- Folders -------------------------------- */

vaultRouter.get(
  '/account/documents/folders',
  asyncHandler(async (req, res) => {
    res.json({
      results: all(
        `SELECT f.id, f.name, f.created_at,
                (SELECT COUNT(*) FROM citizen_documents d WHERE d.folder_id = f.id AND d.status <> 'deleted') AS document_count
         FROM document_folders f WHERE f.user_id = ? ORDER BY f.name`,
        [req.user.id],
      ),
    })
  }),
)

vaultRouter.post(
  '/account/documents/folders',
  validate(z.object({ name: z.string().trim().min(1).max(60) })),
  asyncHandler(async (req, res) => {
    const name = cleanText(req.body.name, 60)
    const exists = get(`SELECT id FROM document_folders WHERE user_id = ? AND name = ?`, [req.user.id, name])
    if (exists) throw unprocessable('A folder with that name already exists.')
    const id = Number(run(`INSERT INTO document_folders (user_id, name) VALUES (?, ?)`, [req.user.id, name]).lastInsertRowid)
    res.status(201).json({ id, name })
  }),
)

vaultRouter.patch(
  '/account/documents/folders/:folderId',
  validate(z.object({ name: z.string().trim().min(1).max(60) })),
  asyncHandler(async (req, res) => {
    const folder = get(`SELECT * FROM document_folders WHERE id = ? AND user_id = ?`, [Number(req.params.folderId), req.user.id])
    if (!folder) throw notFound('Folder not found.')
    run(`UPDATE document_folders SET name = ? WHERE id = ?`, [cleanText(req.body.name, 60), folder.id])
    res.json({ message: 'Folder renamed.' })
  }),
)

vaultRouter.delete(
  '/account/documents/folders/:folderId',
  asyncHandler(async (req, res) => {
    const folder = get(`SELECT * FROM document_folders WHERE id = ? AND user_id = ?`, [Number(req.params.folderId), req.user.id])
    if (!folder) throw notFound('Folder not found.')
    // Documents are never deleted with a folder; they are simply unfiled.
    run(`UPDATE citizen_documents SET folder_id = NULL WHERE folder_id = ? AND user_id = ?`, [folder.id, req.user.id])
    run(`DELETE FROM document_folders WHERE id = ?`, [folder.id])
    res.json({ message: 'Folder removed. Its documents were kept and moved to unfiled.' })
  }),
)

vaultRouter.get(
  '/account/documents/:id',
  asyncHandler(async (req, res) => {
    const document = ownedDocument(req.user.id, req.params.id)
    res.json({
      document: serialise(document),
      applications: all(
        `SELECT reference, status, submitted_at FROM citizen_applications
         WHERE user_id = ? AND document_ids LIKE ? ORDER BY id DESC`,
        [req.user.id, `%${document.id}%`],
      ),
      shares: all(`SELECT id, recipient_label, purpose, consented_at FROM document_shares WHERE document_id = ? AND user_id = ? AND revoked_at IS NULL`, [
        document.id,
        req.user.id,
      ]),
      note: 'Anything you typed about this document is your own description, not a verification by BetterGo.',
    })
  }),
)

vaultRouter.patch(
  '/account/documents/:id',
  validate(
    z.object({
      title: z.string().trim().max(160).optional(),
      category: z.enum(categoryKeys).optional(),
      description: z.string().trim().max(500).optional().or(z.literal('')),
      issuer: z.string().trim().max(160).optional().or(z.literal('')),
      issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
      expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
      folderId: z.union([z.number().int().positive(), z.null()]).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const document = ownedDocument(req.user.id, req.params.id)
    const body = req.body
    if (body.folderId) {
      const folder = get(`SELECT id FROM document_folders WHERE id = ? AND user_id = ?`, [body.folderId, req.user.id])
      if (!folder) throw unprocessable('That folder does not exist.')
    }
    const fields = []
    const params = []
    const add = (column, value) => {
      fields.push(`${column} = ?`)
      params.push(value)
    }
    if (body.title) add('title', cleanText(body.title, 160))
    if (body.category) add('category', body.category)
    if (body.description !== undefined) add('description', cleanText(body.description, 500) || null)
    if (body.issuer !== undefined) add('issuer', cleanText(body.issuer, 160) || null)
    if (body.issuedAt !== undefined) add('issued_at', body.issuedAt || null)
    if (body.expiresAt !== undefined) add('expires_at', body.expiresAt || null)
    if (body.folderId !== undefined) add('folder_id', body.folderId || null)
    if (!fields.length) return res.json({ document: serialise(document) })
    run(`UPDATE citizen_documents SET ${fields.join(', ')} WHERE id = ?`, [...params, document.id])
    logEvent(document.id, req.user.id, 'metadata_updated', fields.length + ' field(s)')
    res.json({ document: serialise(get(`SELECT * FROM citizen_documents WHERE id = ?`, [document.id])) })
  }),
)

vaultRouter.get(
  '/account/documents/:id/file',
  asyncHandler(async (req, res) => {
    const document = ownedDocument(req.user.id, req.params.id)
    const buffer = readFile(document.storage_reference)
    if (!buffer) throw notFound('The stored file is no longer available.')
    run(`UPDATE citizen_documents SET last_accessed_at = ? WHERE id = ?`, [nowIso(), document.id])
    logEvent(document.id, req.user.id, 'accessed', req.query.download ? 'downloaded' : 'previewed')
    res.setHeader('Content-Type', document.mime_type || 'application/octet-stream')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader(
      'Content-Disposition',
      `${req.query.download ? 'attachment' : 'inline'}; filename="${sanitiseFilename(document.original_filename)}"`,
    )
    res.send(buffer)
  }),
)

vaultRouter.post(
  '/account/documents/:id/replace',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }),
  asyncHandler(async (req, res) => {
    const document = ownedDocument(req.user.id, req.params.id)
    const buffer = req.body
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw unprocessable('No file data received.')
    if (buffer.length > MAX_FILE_BYTES) throw unprocessable('Documents must be 10 MB or smaller.')
    const type = detectFileType(buffer)
    if (!type) throw unprocessable('Upload a PDF, JPG or PNG file.')

    const { reference, sha256 } = storeFile(buffer, type)
    const newId = Number(
      run(
        `INSERT INTO citizen_documents
          (user_id, category, original_filename, storage_reference, mime_type, file_size, title, description, issuer, issued_at, expires_at, folder_id, sha256, status, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        [
          document.user_id,
          document.category,
          sanitiseFilename((req.get('x-file-name') || req.get('x-filename')) || document.original_filename),
          reference,
          type.mime,
          buffer.length,
          document.title,
          document.description,
          document.issuer,
          document.issued_at,
          document.expires_at,
          document.folder_id,
          sha256,
          (document.version || 1) + 1,
        ],
      ).lastInsertRowid,
    )
    run(`UPDATE citizen_documents SET replaced_by = ? WHERE id = ?`, [newId, document.id])
    logEvent(document.id, req.user.id, 'replaced', `Replaced by document ${newId}`)
    logEvent(newId, req.user.id, 'uploaded', 'Replacement version')
    res.status(201).json({ document: serialise(get(`SELECT * FROM citizen_documents WHERE id = ?`, [newId])) })
  }),
)

vaultRouter.delete(
  '/account/documents/:id',
  asyncHandler(async (req, res) => {
    const document = ownedDocument(req.user.id, req.params.id)
    const inUse = all(
      `SELECT reference FROM citizen_applications WHERE user_id = ? AND document_ids LIKE ? AND status NOT IN ('closed','completed','cancelled','withdrawn')`,
      [req.user.id, `%${document.id}%`],
    )
    if (inUse.length) {
      throw unprocessable(
        `This document is attached to an active BetterGo record (${inUse.map((row) => row.reference).join(', ')}). Detach it there before deleting, or keep it for your records.`,
      )
    }
    run(`UPDATE citizen_documents SET status = 'deleted', deleted_at = ? WHERE id = ?`, [nowIso(), document.id])
    removeFile(document.storage_reference)
    logEvent(document.id, req.user.id, 'deleted', 'Removed from the vault by the owner')
    logAudit(req, { action: 'citizen.document_deleted', module: 'citizen', entityType: 'citizen_document', entityId: document.id })
    res.json({ message: 'Document deleted from your vault.', note: 'Records attached to closed BetterGo submissions keep their reference for audit.' })
  }),
)

/* -------------------------------- Sharing -------------------------------- */

vaultRouter.post(
  '/account/documents/:id/shares',
  validate(
    z.object({
      recipientLabel: z.string().trim().min(3).max(160),
      purpose: z.string().trim().min(5).max(300),
      consent: z.literal(true),
    }),
  ),
  asyncHandler(async (req, res) => {
    const document = ownedDocument(req.user.id, req.params.id)
    const id = Number(
      run(`INSERT INTO document_shares (document_id, user_id, recipient_label, purpose) VALUES (?, ?, ?, ?)`, [
        document.id,
        req.user.id,
        cleanText(req.body.recipientLabel, 160),
        cleanText(req.body.purpose, 300),
      ]).lastInsertRowid,
    )
    logEvent(document.id, req.user.id, 'shared', `${cleanText(req.body.recipientLabel, 160)} — ${cleanText(req.body.purpose, 300)}`)
    logAudit(req, { action: 'citizen.document_shared', module: 'citizen', entityType: 'citizen_document', entityId: document.id })
    res.status(201).json({
      id,
      message: 'Sharing permission recorded inside BetterGo.',
      note: 'This does not transmit the file anywhere. BetterGo has no external document-transmission integration enabled.',
    })
  }),
)

vaultRouter.delete(
  '/account/documents/:id/shares/:shareId',
  asyncHandler(async (req, res) => {
    const document = ownedDocument(req.user.id, req.params.id)
    const share = get(`SELECT * FROM document_shares WHERE id = ? AND document_id = ? AND user_id = ?`, [
      Number(req.params.shareId),
      document.id,
      req.user.id,
    ])
    if (!share) throw notFound('Sharing permission not found.')
    run(`UPDATE document_shares SET revoked_at = ? WHERE id = ?`, [nowIso(), share.id])
    logEvent(document.id, req.user.id, 'share_revoked', share.recipient_label)
    res.json({ message: 'Sharing permission revoked.' })
  }),
)
