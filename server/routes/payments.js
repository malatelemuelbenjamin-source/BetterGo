/**
 * Fee information and payment foundation (Prompt 75).
 *
 * No live payment provider is enabled by configuration. Transactions start as
 * instructions/pending payment and only a correctly signed provider callback can
 * mark them paid. BetterGo records are never official government receipts.
 */
import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { ctx, requireAdmin, requirePermission, canUseMunicipality } from '../rbac.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'

const FEE_TYPES = { free: 'Confirmed free of charge', fixed: 'Confirmed fee', variable: 'Variable or conditional fee', unknown: 'Fee not yet verified' }
const TX_STATUSES = ['draft', 'instructions_available', 'pending_payment', 'processing', 'paid', 'failed', 'cancelled', 'expired', 'refund_requested', 'refund_processing', 'refunded', 'under_reconciliation']
const METHOD_TYPES = { instructions: 'Payment instructions', external_portal: 'Official external payment portal', e_wallet: 'E-wallet (authorized)', bank: 'Bank transfer (authorized)', gateway: 'Government payment gateway' }
const PUBLISHED = `s.publication_status = 'published' AND s.archived_at IS NULL`

function notify(userId, title, message, transactionId) {
  const prefs = get(`SELECT in_app_enabled FROM notification_preferences WHERE user_id = ?`, [userId])
  if (prefs && Number(prefs.in_app_enabled) === 0) return
  run(
    `INSERT INTO notifications (user_id, title, message, notification_type, category, related_entity_type, related_entity_id)
     VALUES (?, ?, ?, 'payment', 'account', 'payment_transaction', ?)`,
    [userId, title, message, transactionId],
  )
}

function event(id, action, from, to, actorType, actorId, note = null) {
  run(`INSERT INTO payment_events (transaction_id, action, from_status, to_status, actor_type, actor_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    id,
    action,
    from || null,
    to || null,
    actorType,
    actorId,
    note ? cleanText(note, 500) : null,
  ])
}

const formatFee = (row) => ({
  id: row.id,
  serviceId: row.service_id,
  serviceTitle: row.service_title,
  serviceSlug: row.service_slug,
  feeType: row.fee_type,
  feeLabel: FEE_TYPES[row.fee_type] || FEE_TYPES.unknown,
  amount: row.amount_cents === null || row.amount_cents === undefined ? null : row.amount_cents / 100,
  amountLabel:
    row.fee_type === 'free'
      ? 'Free'
      : row.fee_type === 'unknown' || row.amount_cents === null
        ? 'Not verified'
        : `${row.currency} ${(row.amount_cents / 100).toFixed(2)}`,
  currency: row.currency,
  description: row.fee_description || row.fee_name,
  methods: row.payment_methods,
  reviewStatus: row.review_status,
  sourceTitle: row.source_title,
  sourceUrl: row.review_status === 'approved' ? row.source_url : null,
  verifiedAt: row.verified_at,
  updatedAt: row.updated_at,
})

const shapeTransaction = (row) => ({
  id: row.id,
  reference: row.reference,
  serviceTitle: row.service_title || get(`SELECT title FROM government_services WHERE id = ?`, [row.service_id])?.title,
  amount: row.amount_cents / 100,
  amountLabel: `${row.currency} ${(row.amount_cents / 100).toFixed(2)}`,
  currency: row.currency,
  status: row.status,
  provider: row.provider,
  providerReference: row.provider_reference,
  payee: row.payee,
  purpose: row.purpose,
  verifiedAt: row.verified_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  events: all(`SELECT action, from_status, to_status, actor_type, note, created_at FROM payment_events WHERE transaction_id = ? ORDER BY id`, [row.id]),
})

function reference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let code = 'BG-PAY-'
    for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)]
    if (!get(`SELECT id FROM payment_transactions WHERE reference = ?`, [code])) return code
  }
  throw unprocessable('Could not generate a transaction reference. Please retry.')
}

function approvedFee(serviceId) {
  return get(`SELECT * FROM service_fees WHERE service_id = ? AND review_status = 'approved' AND archived_at IS NULL ORDER BY id DESC LIMIT 1`, [serviceId])
}

function activeMethod(slug) {
  return get(`SELECT * FROM payment_methods WHERE slug = ? AND status <> 'unavailable'`, [String(slug)])
}

function methodConfigured(method) {
  if (method.status !== 'provider_configured') return true
  return Boolean(process.env[`PAYMENT_PROVIDER_${String(method.provider || '').toUpperCase().replaceAll('-', '_')}_SECRET`])
}

/* ------------------------------- Citizen -------------------------------- */

export const paymentsRouter = Router()
paymentsRouter.use(requireAuth)

paymentsRouter.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const fees = all(
      `SELECT f.*, s.title AS service_title, s.slug AS service_slug FROM service_fees f JOIN government_services s ON s.id = f.service_id
       WHERE f.review_status = 'approved' AND f.archived_at IS NULL AND ${PUBLISHED} ORDER BY s.title LIMIT 80`,
    ).map(formatFee)
    const methods = all(`SELECT * FROM payment_methods ORDER BY name`).map((method) => ({
      slug: method.slug,
      name: method.name,
      methodType: method.method_type,
      typeLabel: METHOD_TYPES[method.method_type] || method.method_type,
      status: method.status,
      operational: method.status !== 'unavailable' && methodConfigured(method),
      instructions: method.instructions,
      officialUrl: method.status === 'external_portal' ? method.official_url : null,
    }))
    const transactions = all(`SELECT * FROM payment_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50`, [req.user.id]).map(shapeTransaction)
    res.json({
      fees,
      methods,
      transactions,
      feeTypes: FEE_TYPES,
      notices: {
        fees: 'An unverified or missing fee is shown as not verified. It is never shown as zero.',
        payments: 'No live online payment provider is enabled unless an authorized provider is configured. BetterGo never marks a transaction paid without a verified provider callback.',
        receipts: 'BetterGo transaction records are not official government receipts.',
      },
    })
  }),
)

paymentsRouter.get(
  '/payments/services/:slug',
  asyncHandler(async (req, res) => {
    const service = get(`SELECT s.id, s.title, s.slug, m.name AS municipality_name FROM government_services s LEFT JOIN municipalities m ON m.id = s.municipality_id WHERE s.slug = ? AND ${PUBLISHED}`, [String(req.params.slug)])
    if (!service) throw notFound('Service not found.')
    const fee = approvedFee(service.id)
    const methods = all(`SELECT * FROM payment_methods WHERE status <> 'unavailable' ORDER BY name`).map((method) => ({
      slug: method.slug,
      name: method.name,
      typeLabel: METHOD_TYPES[method.method_type] || method.method_type,
      status: method.status,
      operational: methodConfigured(method),
      instructions: method.instructions,
      officialUrl: method.status === 'external_portal' ? method.official_url : null,
    }))
    res.json({
      service: { id: service.id, title: service.title, slug: service.slug, municipalityName: service.municipality_name },
      fee: fee ? formatFee({ ...fee, service_title: service.title, service_slug: service.slug }) : null,
      feeType: fee?.fee_type || 'unknown',
      feeLabel: fee ? FEE_TYPES[fee.fee_type] : 'Fee information unavailable',
      methods,
      note: fee
        ? 'Fee information is shown only when it has been recorded and approved. Confirm the amount with the responsible office.'
        : 'No approved fee information is recorded. Confirm the fee with the responsible office.',
    })
  }),
)

paymentsRouter.get(
  '/payments/history',
  asyncHandler(async (req, res) => {
    const filters = ['t.user_id = ?']
    const params = [req.user.id]
    if (req.query.status) {
      filters.push('t.status = ?')
      params.push(String(req.query.status))
    }
    if (req.query.q) {
      filters.push('t.reference LIKE ?')
      params.push(`%${String(req.query.q).slice(0, 40)}%`)
    }
    if (req.query.from) {
      filters.push('date(t.created_at) >= date(?)')
      params.push(String(req.query.from))
    }
    if (req.query.to) {
      filters.push('date(t.created_at) <= date(?)')
      params.push(String(req.query.to))
    }
    const results = all(
      `SELECT t.*, s.title AS service_title FROM payment_transactions t JOIN government_services s ON s.id = t.service_id
       WHERE ${filters.join(' AND ')} ORDER BY t.id DESC LIMIT 100`,
      params,
    ).map(shapeTransaction)
    res.json({ results, statuses: TX_STATUSES, note: 'Only your own transactions are shown.' })
  }),
)

paymentsRouter.get(
  '/payments/:id',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM payment_transactions WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Transaction not found.')
    res.json({ transaction: shapeTransaction(row), label: 'BetterGo transaction record — not an official government receipt or certificate.' })
  }),
)

paymentsRouter.get(
  '/payments/:id/summary',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM payment_transactions WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Transaction not found.')
    const shaped = shapeTransaction(row)
    res.type('text/plain').send([
      'BetterGo transaction record — not an official government receipt or certificate.',
      `Reference: ${shaped.reference}`,
      `Service: ${shaped.serviceTitle}`,
      `Payee: ${shaped.payee || 'Not recorded'}`,
      `Amount: ${shaped.amountLabel}`,
      `Status: ${shaped.status.replaceAll('_', ' ')}`,
      `Provider: ${shaped.provider || 'No online provider'}`,
      shaped.verifiedAt ? `Provider verified: ${shaped.verifiedAt}` : 'Not verified by a provider.',
    ].join('\n'))
  }),
)

paymentsRouter.post(
  '/payments/requests',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  validate(z.object({ serviceSlug: z.string().trim().min(1).max(160), methodSlug: z.string().trim().min(1).max(80), purpose: z.string().trim().max(300).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const service = get(`SELECT id, title, municipality_id FROM government_services WHERE slug = ? AND publication_status = 'published' AND archived_at IS NULL`, [req.body.serviceSlug])
    if (!service) throw notFound('Service not found.')
    const fee = approvedFee(service.id)
    if (!fee) throw unprocessable('No approved fee information is recorded for this service, so a payment request cannot be created.')
    if (!['free', 'fixed'].includes(fee.fee_type)) {
      throw unprocessable('This fee is variable or conditional. The responsible office must confirm the amount before any payment.')
    }
    if (fee.fee_type === 'free') throw unprocessable('This service is recorded as free. No payment is required.')
    if (!fee.amount_cents) throw unprocessable('The approved fee has no amount recorded.')
    const method = activeMethod(req.body.methodSlug)
    if (!method) throw unprocessable('That payment method is not available.')
    if (!methodConfigured(method)) throw unprocessable('That provider is not configured, so no payment can be started.')

    const ref = reference()
    const operational = method.status !== 'unavailable'
    const id = Number(
      run(
        `INSERT INTO payment_transactions (reference, user_id, service_id, fee_id, amount_cents, currency, status, provider, payee, purpose)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ref,
          req.user.id,
          service.id,
          fee.id,
          fee.amount_cents,
          fee.currency,
          operational ? 'pending_payment' : 'instructions_available',
          method.provider || method.slug,
          'Government office (confirm with the office)',
          cleanText(req.body.purpose, 300) || service.title,
        ],
      ).lastInsertRowid,
    )
    event(id, 'created', null, 'pending_payment', 'citizen', req.user.id, method.name)
    notify(req.user.id, 'Payment instructions available', `Transaction ${ref} was created for ${service.title}. Pay only through an authorized channel and keep your reference.`, id)
    res.status(201).json({
      message:
        method.status === 'external_portal'
          ? 'Use the official external portal to pay. BetterGo has not received or verified any payment.'
          : 'Payment request created. BetterGo has not received or verified any payment.',
      transaction: shapeTransaction(get(`SELECT * FROM payment_transactions WHERE id = ?`, [id])),
      redirectUrl: method.status === 'external_portal' ? method.official_url : null,
      instructions: method.instructions,
    })
  }),
)

paymentsRouter.post(
  '/payments/:id/cancel',
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM payment_transactions WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id])
    if (!row) throw notFound('Transaction not found.')
    if (!['draft', 'instructions_available', 'pending_payment', 'failed', 'expired'].includes(row.status)) {
      throw unprocessable('This transaction cannot be cancelled in its current state.')
    }
    run(`UPDATE payment_transactions SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowIso(), row.id])
    event(row.id, 'cancelled', row.status, 'cancelled', 'citizen', req.user.id)
    res.json({ message: 'Transaction cancelled. No refund is implied because BetterGo never received a payment.', transaction: shapeTransaction(get(`SELECT * FROM payment_transactions WHERE id = ?`, [row.id])) })
  }),
)

/* ---------------------- Provider callback (unauthenticated) -------------- */

export const paymentCallbackRouter = Router()

paymentCallbackRouter.post(
  '/payments/callback/:provider',
  rateLimit({ windowMs: 60_000, max: 60 }),
  validate(
    z.object({
      reference: z.string().trim().min(4).max(80),
      providerReference: z.string().trim().min(4).max(120),
      status: z.enum(['paid', 'failed', 'expired', 'refunded']),
      amount: z.coerce.number().positive().optional(),
      currency: z.string().trim().length(3).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider).toLowerCase().replace(/[^a-z0-9_-]/g, '')
    const secret = process.env[`PAYMENT_PROVIDER_${provider.toUpperCase().replaceAll('-', '_')}_SECRET`]
    if (!secret) {
      return res.status(503).json({ error: 'This payment provider is not configured.' })
    }
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${req.body.reference}:${req.body.status}:${req.body.providerReference}`)
      .digest('hex')
    const supplied = String(req.get('x-payment-signature') || '')
    const valid = supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    if (!valid) return res.status(401).json({ error: 'Invalid provider signature.' })

    const row = get(`SELECT * FROM payment_transactions WHERE reference = ? AND provider = ?`, [req.body.reference, provider])
    if (!row) return res.status(404).json({ error: 'Unknown transaction.' })
    if (row.status === 'paid' && req.body.status === 'paid') {
      return res.json({ message: 'Callback already processed.', alreadyProcessed: true })
    }
    if (req.body.status === 'paid') {
      if (req.body.amount !== undefined && Math.round(req.body.amount * 100) !== row.amount_cents) {
        run(`UPDATE payment_transactions SET status = 'under_reconciliation', updated_at = ? WHERE id = ?`, [nowIso(), row.id])
        event(row.id, 'amount_mismatch', row.status, 'under_reconciliation', 'provider', null, 'Provider amount did not match the recorded amount.')
        return res.status(409).json({ error: 'Amount mismatch; transaction flagged for reconciliation.' })
      }
      if (req.body.currency && req.body.currency.toUpperCase() !== row.currency) {
        return res.status(409).json({ error: 'Currency mismatch; transaction not marked paid.' })
      }
    }
    const next = req.body.status === 'paid' ? 'paid' : req.body.status
    run(
      `UPDATE payment_transactions SET status = ?, provider_reference = ?, verified_at = ?, updated_at = ? WHERE id = ?`,
      [next, req.body.providerReference, nowIso(), nowIso(), row.id],
    )
    event(row.id, 'provider_callback', row.status, next, 'provider', null, `Verified ${provider} callback`)
    if (next === 'paid') {
      notify(row.user_id, 'Payment verified by provider', `Your payment for transaction ${row.reference} was confirmed by ${provider}. This is not an official government receipt.`, row.id)
    } else if (next === 'failed') {
      notify(row.user_id, 'Payment failed', `The provider reported that payment for ${row.reference} did not complete.`, row.id)
    }
    res.json({ message: 'Callback verified and recorded.', status: next })
  }),
)

/* -------------------------------- Admin --------------------------------- */

export const adminPaymentsRouter = Router()
adminPaymentsRouter.use(requireAuth, requireAdmin)

function scopedService(req, serviceId) {
  const service = get(`SELECT * FROM government_services WHERE id = ?`, [Number(serviceId)])
  if (!service) throw notFound('Service not found.')
  if (!ctx(req).hasGlobalScope && !(service.municipality_id && canUseMunicipality(ctx(req), service.municipality_id))) throw notFound('Service not found.')
  return service
}

adminPaymentsRouter.get(
  '/payments',
  requirePermission('services.view'),
  asyncHandler(async (req, res) => {
    const context = ctx(req)
    const filters = []
    const params = []
    if (req.query.status) {
      filters.push('t.status = ?')
      params.push(String(req.query.status))
    }
    if (req.query.q) {
      filters.push('t.reference LIKE ?')
      params.push(`%${String(req.query.q).slice(0, 40)}%`)
    }
    if (!context.hasGlobalScope) {
      if (!context.municipalityIds.length) return res.json({ results: [], totals: {}, note: 'No municipality scope assigned.' })
      filters.push(`s.municipality_id IN (${context.municipalityIds.map(() => '?').join(',')})`)
      params.push(...context.municipalityIds)
    }
    const rows = all(
      `SELECT t.*, s.title AS service_title FROM payment_transactions t JOIN government_services s ON s.id = t.service_id
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY t.id DESC LIMIT 100`,
      params,
    )
    res.json({
      results: rows.map(shapeTransaction),
      totals: {
        pending: rows.filter((row) => row.status === 'pending_payment').length,
        paid: rows.filter((row) => row.status === 'paid').length,
        failed: rows.filter((row) => row.status === 'failed').length,
        reconciliation: rows.filter((row) => row.status === 'under_reconciliation').length,
      },
      providerStatus: all(`SELECT slug, name, method_type, provider, status FROM payment_methods ORDER BY name`).map((method) => ({
        ...method,
        configured: method.status !== 'provider_configured' ? method.status !== 'unavailable' : methodConfigured(method),
      })),
      statuses: TX_STATUSES,
      note: 'Provider credentials and secrets are never displayed. BetterGo totals are not government collections.',
    })
  }),
)

adminPaymentsRouter.get(
  '/payments/analytics',
  requirePermission('province.analytics.view'),
  asyncHandler(async (_req, res) => {
    const totals = get(
      `SELECT COUNT(*) AS count, SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid,
              SUM(CASE WHEN status = 'pending_payment' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN status IN ('refunded','refund_processing','refund_requested') THEN 1 ELSE 0 END) AS refunded,
              SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END) AS paid_cents
       FROM payment_transactions`,
    )
    res.json({
      totals: {
        transactions: Number(totals.count || 0),
        paid: Number(totals.paid || 0),
        pending: Number(totals.pending || 0),
        failed: Number(totals.failed || 0),
        refunded: Number(totals.refunded || 0),
        providerConfirmedAmount: Number(totals.paid_cents || 0) / 100,
      },
      byService: all(
        `SELECT s.title, COUNT(t.id) AS count, SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) AS paid
         FROM payment_transactions t JOIN government_services s ON s.id = t.service_id GROUP BY s.id ORDER BY count DESC LIMIT 15`,
      ),
      note: 'Only provider-verified amounts are counted as paid. These are platform records, not official government financial reports.',
    })
  }),
)

adminPaymentsRouter.get(
  '/service-fees',
  requirePermission('services.view'),
  asyncHandler(async (req, res) => {
    const service = scopedService(req, req.query.serviceId)
    res.json({
      service: { id: service.id, title: service.title },
      results: all(`SELECT * FROM service_fees WHERE service_id = ? ORDER BY id DESC`, [service.id]),
      feeTypes: FEE_TYPES,
      note: 'Only approved fee records are published. Unknown fees are never displayed as zero.',
    })
  }),
)

adminPaymentsRouter.post(
  '/service-fees',
  requirePermission('services.update'),
  validate(
    z.object({
      serviceId: z.coerce.number().int().positive(),
      feeType: z.enum(['free', 'fixed', 'variable', 'unknown']),
      amount: z.coerce.number().min(0).max(1000000).optional(),
      feeDescription: z.string().trim().max(1000).optional().or(z.literal('')),
      paymentMethods: z.string().trim().max(300).optional().or(z.literal('')),
      sourceTitle: z.string().trim().max(300).optional().or(z.literal('')),
      sourceUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const service = scopedService(req, req.body.serviceId)
    if (req.body.feeType === 'fixed' && (req.body.amount === undefined || req.body.amount === null)) {
      throw unprocessable('A fixed fee requires an amount.')
    }
    if (req.body.feeType !== 'fixed' && req.body.feeType !== 'free' && req.body.amount) {
      throw unprocessable('Only a fixed fee can carry a confirmed amount.')
    }
    const id = Number(
      run(
        `INSERT INTO service_fees (service_id, fee_name, fee_type, amount_cents, fee_description, payment_methods, source_title, source_url, review_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
        [
          service.id,
          cleanText(req.body.feeDescription, 1000) || 'Service fee',
          req.body.feeType,
          req.body.feeType === 'fixed' ? Math.round(Number(req.body.amount) * 100) : null,
          cleanText(req.body.feeDescription, 1000),
          cleanText(req.body.paymentMethods, 300),
          cleanText(req.body.sourceTitle, 300),
          cleanText(req.body.sourceUrl, 500),
        ],
      ).lastInsertRowid,
    )
    logAudit(req, { action: 'payments.fee_created', module: 'payments', entityType: 'service_fee', entityId: id })
    res.status(201).json({ message: 'Fee saved as a draft. It is not published until approved.', id })
  }),
)

adminPaymentsRouter.patch(
  '/service-fees/:id',
  requirePermission('services.update'),
  validate(
    z.object({
      feeType: z.enum(['free', 'fixed', 'variable', 'unknown']).optional(),
      amount: z.coerce.number().min(0).max(1000000).optional(),
      feeDescription: z.string().trim().max(1000).optional().or(z.literal('')),
      paymentMethods: z.string().trim().max(300).optional().or(z.literal('')),
      sourceTitle: z.string().trim().max(300).optional().or(z.literal('')),
      sourceUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    const fee = get(`SELECT * FROM service_fees WHERE id = ?`, [Number(req.params.id)])
    if (!fee) throw notFound('Fee record not found.')
    scopedService(req, fee.service_id)
    if (fee.review_status === 'approved') throw unprocessable('An approved fee cannot be edited in place. Archive it and submit a new version.')
    const type = req.body.feeType || fee.fee_type
    if (type === 'fixed' && req.body.amount === undefined && fee.amount_cents === null) throw unprocessable('A fixed fee requires an amount.')
    run(
      `UPDATE service_fees SET fee_name = ?, fee_type = ?, amount_cents = ?, fee_description = ?, payment_methods = ?, source_title = ?, source_url = ?, updated_at = ? WHERE id = ?`,
      [
        cleanText(req.body.feeDescription, 1000) || fee.fee_name || 'Service fee',
        type,
        type === 'fixed' ? Math.round(Number(req.body.amount ?? (fee.amount_cents || 0) / 100) * 100) : null,
        req.body.feeDescription === undefined ? fee.fee_description : cleanText(req.body.feeDescription, 1000),
        req.body.paymentMethods === undefined ? fee.payment_methods : cleanText(req.body.paymentMethods, 300),
        req.body.sourceTitle === undefined ? fee.source_title : cleanText(req.body.sourceTitle, 300),
        req.body.sourceUrl === undefined ? fee.source_url : cleanText(req.body.sourceUrl, 500),
        nowIso(),
        fee.id,
      ],
    )
    res.json({ message: 'Fee draft updated.' })
  }),
)

adminPaymentsRouter.post(
  '/service-fees/:id/submit-review',
  requirePermission('services.update'),
  asyncHandler(async (req, res) => {
    const fee = get(`SELECT * FROM service_fees WHERE id = ?`, [Number(req.params.id)])
    if (!fee) throw notFound('Fee record not found.')
    scopedService(req, fee.service_id)
    run(`UPDATE service_fees SET review_status = 'pending_review', updated_at = ? WHERE id = ?`, [nowIso(), fee.id])
    res.json({ message: 'Fee submitted for review.' })
  }),
)

adminPaymentsRouter.post(
  '/service-fees/:id/approve',
  requirePermission('services.approve'),
  asyncHandler(async (req, res) => {
    const fee = get(`SELECT * FROM service_fees WHERE id = ?`, [Number(req.params.id)])
    if (!fee) throw notFound('Fee record not found.')
    scopedService(req, fee.service_id)
    if (fee.review_status !== 'pending_review') throw unprocessable('Only a fee pending review can be approved.')
    if (!fee.source_title && !fee.source_reference) throw unprocessable('Record the official source before approving a fee.')
    run(`UPDATE service_fees SET review_status = 'approved', verified_by = ?, verified_at = ?, updated_at = ? WHERE id = ?`, [req.user.id, nowIso(), nowIso(), fee.id])
    logAudit(req, { action: 'payments.fee_approved', module: 'payments', entityType: 'service_fee', entityId: fee.id })
    res.json({ message: 'Fee approved with its recorded source.' })
  }),
)

adminPaymentsRouter.post(
  '/service-fees/:id/archive',
  requirePermission('services.approve'),
  asyncHandler(async (req, res) => {
    const fee = get(`SELECT * FROM service_fees WHERE id = ?`, [Number(req.params.id)])
    if (!fee) throw notFound('Fee record not found.')
    scopedService(req, fee.service_id)
    run(`UPDATE service_fees SET review_status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), fee.id])
    res.json({ message: 'Fee archived. Existing transaction records are unchanged.' })
  }),
)

adminPaymentsRouter.post(
  '/payment-methods',
  requirePermission('services.update'),
  validate(
    z.object({
      slug: z.string().trim().regex(/^[a-z0-9-]{2,40}$/),
      name: z.string().trim().min(2).max(120),
      methodType: z.enum(Object.keys(METHOD_TYPES)),
      provider: z.string().trim().max(80).optional().or(z.literal('')),
      status: z.enum(['unavailable', 'instructions_only', 'external_portal', 'provider_configured']),
      instructions: z.string().trim().max(1000).optional().or(z.literal('')),
      officialUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (req.body.status === 'provider_configured' && !req.body.provider) throw unprocessable('A provider name is required for provider integration.')
    run(
      `INSERT INTO payment_methods (slug, name, method_type, provider, status, instructions, official_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET name = excluded.name, method_type = excluded.method_type, provider = excluded.provider,
         status = excluded.status, instructions = excluded.instructions, official_url = excluded.official_url, updated_at = datetime('now')`,
      [req.body.slug, req.body.name, req.body.methodType, cleanText(req.body.provider, 80), req.body.status, cleanText(req.body.instructions, 1000), cleanText(req.body.officialUrl, 500)],
    )
    logAudit(req, { action: 'payments.method_updated', module: 'payments', entityType: 'payment_method' })
    res.json({ message: 'Payment method saved. No credentials were stored.' })
  }),
)

adminPaymentsRouter.post(
  '/payments/:id/reconcile',
  requirePermission('services.update'),
  validate(z.object({ note: z.string().trim().max(500).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT t.*, s.municipality_id FROM payment_transactions t JOIN government_services s ON s.id = t.service_id WHERE t.id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Transaction not found.')
    if (!ctx(req).hasGlobalScope && !(row.municipality_id && canUseMunicipality(ctx(req), row.municipality_id))) throw notFound('Transaction not found.')
    run(`UPDATE payment_transactions SET status = 'under_reconciliation', updated_at = ? WHERE id = ?`, [nowIso(), row.id])
    event(row.id, 'reconciliation_started', row.status, 'under_reconciliation', 'admin', req.user.id, req.body.note)
    logAudit(req, { action: 'payments.reconciliation_started', module: 'payments', entityType: 'payment_transaction', entityId: row.id })
    res.json({ message: 'Transaction flagged for reconciliation. No amount or paid status was changed.' })
  }),
)

adminPaymentsRouter.post(
  '/payments/:id/resolve',
  requirePermission('services.approve'),
  validate(z.object({ status: z.enum(['failed', 'cancelled']), note: z.string().trim().min(3).max(500) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT t.*, s.municipality_id FROM payment_transactions t JOIN government_services s ON s.id = t.service_id WHERE t.id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Transaction not found.')
    if (!ctx(req).hasGlobalScope && !(row.municipality_id && canUseMunicipality(ctx(req), row.municipality_id))) throw notFound('Transaction not found.')
    if (row.status !== 'under_reconciliation') throw unprocessable('Only a transaction under reconciliation can be resolved this way.')
    run(`UPDATE payment_transactions SET status = ?, updated_at = ? WHERE id = ?`, [req.body.status, nowIso(), row.id])
    event(row.id, 'reconciliation_resolved', row.status, req.body.status, 'admin', req.user.id, req.body.note)
    logAudit(req, { action: 'payments.reconciliation_resolved', module: 'payments', entityType: 'payment_transaction', entityId: row.id })
    res.json({ message: 'Reconciliation resolved. Administrators cannot mark a transaction paid.' })
  }),
)

adminPaymentsRouter.get(
  '/payments/reconciliation',
  requirePermission('province.analytics.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      unmatchedProviderReferences: all(
        `SELECT id, reference, provider, provider_reference, amount_cents, currency, status FROM payment_transactions
         WHERE provider_reference IS NOT NULL AND status NOT IN ('paid','refunded') ORDER BY id DESC LIMIT 50`,
      ),
      missingProviderReference: all(
        `SELECT id, reference, provider, amount_cents, currency, status FROM payment_transactions
         WHERE status = 'paid' AND provider_reference IS NULL ORDER BY id DESC LIMIT 50`,
      ),
      duplicates: all(
        `SELECT provider_reference, COUNT(*) AS count FROM payment_transactions WHERE provider_reference IS NOT NULL GROUP BY provider_reference HAVING COUNT(*) > 1`,
      ),
      note: 'Reconciliation is read-only. Amounts are never altered by BetterGo.',
    })
  }),
)
