/**
 * Phase 5 — public financial transparency portal (Prompts 87–110).
 *
 * One verified dataset serves every module: budgets, revenue, expenditures,
 * procurement, projects, AIP, reports, audits, grants, assets, loans, PPPs,
 * payroll, taxes, land, utilities and donations. Nothing is seeded with
 * government figures; only published, source-backed records are public.
 */
import { Router } from 'express'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { all, get, nowIso, run } from '../db.js'
import { requireAuth } from '../auth.js'
import { canUseMunicipality, ctx, requireAdmin, requirePermission } from '../rbac.js'
import { asyncHandler, cleanText, forbidden, notFound, pagination, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { publishTransparencyEvent } from '../lib/transparency-alerts.js'

export const RECORD_TYPES = {
  budget: 'Budget and appropriations',
  revenue: 'Revenue and income',
  expenditure: 'Expenditures and disbursements',
  procurement: 'Procurement and contracts',
  project: 'Government projects and funding',
  aip: 'Annual Investment Program',
  financial_report: 'Financial reports',
  audit_report: 'Audit reports',
  grant: 'Grants, subsidies and assistance',
  asset: 'Assets and public property',
  loan: 'Loans, debt and obligations',
  ppp: 'Public-private partnerships',
  payroll: 'Payroll and personnel expenditure',
  tax: 'Tax assessment and collection',
  land: 'Public land and property transactions',
  utility: 'Public utilities and service contracts',
  donation: 'Donations, sponsorships and external funding',
}
export const AMOUNT_KINDS = {
  proposed: 'Proposed (not an appropriation)',
  approved: 'Approved appropriation',
  adjusted: 'Adjusted or supplemental',
  allotment: 'Allotment',
  obligation: 'Obligation',
  disbursement: 'Disbursement',
  actual: 'Actual expenditure or collection',
  assessed: 'Assessed amount',
  contract: 'Contract amount',
  valuation: 'Reported valuation',
  balance: 'Outstanding balance',
}
export const STATUSES = {
  draft: 'Draft',
  awaiting_source: 'Awaiting source verification',
  under_review: 'Under review',
  verified: 'Verified',
  approved: 'Approved for publication',
  published: 'Published',
  requires_correction: 'Requires correction',
  archived: 'Archived',
}
export const CATEGORY_SEED = [
  ['general_public_services', 'General public services'],
  ['education', 'Education'],
  ['health', 'Health'],
  ['social_welfare', 'Social welfare'],
  ['infrastructure', 'Infrastructure'],
  ['agriculture', 'Agriculture'],
  ['fisheries', 'Fisheries'],
  ['environment', 'Environment'],
  ['disaster_risk_reduction', 'Disaster risk reduction'],
  ['public_safety', 'Public safety'],
  ['tourism', 'Tourism'],
  ['economic_development', 'Economic development'],
  ['transportation', 'Transportation'],
  ['local_administration', 'Local administration'],
  ['other', 'Other documented classification'],
]

const reference = (prefix) => `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`
const parse = (value, fallback = null) => {
  try {
    return JSON.parse(value || 'null') ?? fallback
  } catch {
    return fallback
  }
}

export function ensureFinanceCategories() {
  for (const [index, [key, label]] of CATEGORY_SEED.entries()) {
    if (!get(`SELECT id FROM finance_categories WHERE key = ?`, [key])) {
      run(`INSERT INTO finance_categories (key, label, sort_order) VALUES (?, ?, ?)`, [key, label, index])
    }
  }
}

const amount = (row) => (row.amount_cents === null || row.amount_cents === undefined ? null : Number(row.amount_cents))

export function shapeRecord(row) {
  return {
    id: row.id,
    reference: row.reference,
    recordType: row.record_type,
    recordTypeLabel: RECORD_TYPES[row.record_type] || row.record_type,
    title: row.title,
    description: row.description,
    entity: {
      level: row.government_level,
      municipalityId: row.municipality_id,
      municipalityName: row.municipality_name || null,
      slug: row.municipality_slug || (row.government_level === 'provincial' ? 'provincial' : null),
      name: row.government_level === 'provincial' ? 'Provincial Government of Marinduque' : row.municipality_name,
    },
    fiscalYear: row.fiscal_year,
    periodType: row.period_type,
    periodLabel: row.period_label,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    categoryKey: row.category_key || row.financial_category,
    categoryLabel: row.category_label || null,
    officialClassification: row.official_classification,
    department: row.department_name,
    counterparty: row.counterparty,
    amountCents: amount(row),
    currency: row.currency || 'PHP',
    amountKind: row.amount_kind,
    amountKindLabel: AMOUNT_KINDS[row.amount_kind] || row.amount_kind,
    status: row.publication_status,
    statusLabel: STATUSES[row.publication_status] || row.publication_status,
    verificationStatus: row.verification_status,
    source: {
      institution: row.source_institution,
      title: row.source_title,
      url: row.source_url,
      publishedOn: row.source_published_on,
      reference: row.source_reference,
    },
    verifiedAt: row.verified_at,
    limitations: row.limitations,
    specialist: {
      identifier: row.identifier,
      location: row.location,
      termStart: row.term_start,
      termEnd: row.term_end,
      maturityDate: row.maturity_date,
      interestRate: row.interest_rate === null || row.interest_rate === undefined ? null : Number(row.interest_rate),
      outstandingBalanceCents: row.outstanding_balance_cents === null || row.outstanding_balance_cents === undefined ? null : Number(row.outstanding_balance_cents),
      principalCents: row.principal_cents === null || row.principal_cents === undefined ? null : Number(row.principal_cents),
      quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
      quantityLabel: row.quantity_label,
      stage: row.stage,
      programName: row.program_name,
      rateDescription: row.rate_description,
      assessmentBasis: row.assessment_basis,
      arrangement: row.arrangement,
      titleNumber: row.title_number,
    },
    metadata: parse(row.metadata, {}),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  }
}

const BASE_SELECT = `SELECT f.*, m.name AS municipality_name, m.slug AS municipality_slug, c.label AS category_label
  FROM financial_records f
  LEFT JOIN municipalities m ON m.id = f.municipality_id
  LEFT JOIN finance_categories c ON c.key = COALESCE(f.category_key, f.financial_category)`

function scopeClause(req) {
  const context = ctx(req)
  if (context.hasGlobalScope) return { sql: '', params: [] }
  const ids = context.municipalityIds || []
  if (!ids.length) return { sql: ' AND 0', params: [] }
  return { sql: ` AND f.municipality_id IN (${ids.map(() => '?').join(',')})`, params: ids }
}

function canAccessRecord(req, row) {
  const context = ctx(req)
  if (context.hasGlobalScope) return true
  if (row.government_level === 'provincial') return false
  return Boolean(row.municipality_id && canUseMunicipality(context, row.municipality_id))
}

function publicFilters(query, { publishedOnly = true } = {}) {
  const clauses = []
  const params = []
  if (publishedOnly) {
    clauses.push(`f.publication_status = 'published'`)
  }
  if (query.type && RECORD_TYPES[query.type]) {
    clauses.push('f.record_type = ?')
    params.push(query.type)
  }
  if (query.municipality) {
    clauses.push('m.slug = ?')
    params.push(String(query.municipality))
  }
  if (query.level) {
    clauses.push('f.government_level = ?')
    params.push(String(query.level))
  }
  if (query.year) {
    const year = Number(query.year)
    if (Number.isInteger(year)) {
      clauses.push('f.fiscal_year = ?')
      params.push(year)
    }
  }
  if (query.category) {
    clauses.push('COALESCE(f.category_key, f.financial_category) = ?')
    params.push(String(query.category))
  }
  if (query.kind && AMOUNT_KINDS[query.kind]) {
    clauses.push('f.amount_kind = ?')
    params.push(String(query.kind))
  }
  if (query.department) {
    clauses.push('f.department_name = ?')
    params.push(String(query.department))
  }
  if (query.q) {
    clauses.push('(f.title LIKE ? OR f.description LIKE ? OR f.department_name LIKE ? OR f.counterparty LIKE ? OR f.source_title LIKE ?)')
    const term = `%${String(query.q).slice(0, 100)}%`
    params.push(term, term, term, term, term)
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

/* -------------------------------- Public -------------------------------- */

export const financePublicRouter = Router()

financePublicRouter.get(
  '/transparency/finance/overview',
  asyncHandler(async (_req, res) => {
    ensureFinanceCategories()
    const count = (type) => Number(get(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status='published' AND record_type = ?`, [type]).n)
    const entities = all(`SELECT id, name, slug FROM municipalities WHERE is_active = 1 ORDER BY sort_order, name`)
    const provincialPublished = Number(get(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status='published' AND government_level='provincial'`).n)
    const published = Number(get(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status='published'`).n)
    res.json({
      counts: Object.fromEntries(Object.keys(RECORD_TYPES).map((type) => [type, count(type)])),
      totals: {
        published,
        entitiesWithPublishedData: entities.filter((entity) => get(`SELECT id FROM financial_records WHERE publication_status='published' AND municipality_id = ? LIMIT 1`, [entity.id])).length,
        provincialPublished,
      },
      entities: entities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        slug: entity.slug,
        publishedRecords: Number(get(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status='published' AND municipality_id = ?`, [entity.id]).n),
      })),
      lastUpdated: get(`SELECT MAX(updated_at) AS value FROM financial_records WHERE publication_status='published'`)?.value || null,
      modules: RECORD_TYPES,
      amountKinds: AMOUNT_KINDS,
      note: 'Published records come only from verified, source-referenced submissions. Missing information is shown as not yet available, never as zero. BetterGo is an independent civic platform, not an official government financial system.',
    })
  }),
)

financePublicRouter.get(
  '/transparency/finance/entities',
  asyncHandler(async (_req, res) => {
    const municipalities = all(`SELECT id, name, slug FROM municipalities WHERE is_active = 1 ORDER BY sort_order, name`)
    res.json({
      entities: [
        { slug: 'provincial', level: 'provincial', name: 'Provincial Government of Marinduque', municipalityId: null },
        ...municipalities.map((row) => ({ slug: row.slug, level: 'municipal', name: row.name, municipalityId: row.id })),
      ],
    })
  }),
)

financePublicRouter.get(
  '/transparency/finance/categories',
  asyncHandler(async (_req, res) => {
    ensureFinanceCategories()
    res.json({ categories: all(`SELECT key, label, description FROM finance_categories WHERE active = 1 ORDER BY sort_order`) })
  }),
)

financePublicRouter.get(
  '/transparency/finance/periods',
  asyncHandler(async (req, res) => {
    const where = ['1 = 1']
    const params = []
    if (req.query.municipality) {
      where.push('m.slug = ?')
      params.push(String(req.query.municipality))
    }
    if (req.query.year) {
      where.push('p.fiscal_year = ?')
      params.push(Number(req.query.year))
    }
    res.json({
      periods: all(
        `SELECT p.*, m.name AS municipality_name, m.slug AS municipality_slug FROM transparency_periods p
         LEFT JOIN municipalities m ON m.id = p.municipality_id WHERE ${where.join(' AND ')} ORDER BY p.fiscal_year DESC, p.id DESC LIMIT 200`,
        params,
      ).map((row) => ({
        id: row.id,
        fiscalYear: row.fiscal_year,
        periodType: row.period_type,
        periodLabel: row.period_label,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        publishedOn: row.published_on,
        entity: row.municipality_id ? { slug: row.municipality_slug, name: row.municipality_name } : { slug: 'provincial', name: 'Provincial Government of Marinduque' },
        notes: row.notes,
      })),
    })
  }),
)

financePublicRouter.get(
  '/transparency/finance/records',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query)
    const { where, params } = publicFilters(req.query)
    const rows = all(`${BASE_SELECT} ${where} ORDER BY f.fiscal_year DESC, f.updated_at DESC, f.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset])
    const total = Number(get(`SELECT COUNT(*) AS n FROM financial_records f LEFT JOIN municipalities m ON m.id = f.municipality_id ${where}`, params).n)
    res.json({ results: rows.map(shapeRecord), page, limit, total, modules: RECORD_TYPES, amountKinds: AMOUNT_KINDS })
  }),
)

financePublicRouter.get(
  '/transparency/finance/records/:reference',
  asyncHandler(async (req, res) => {
    const row = get(`${BASE_SELECT} WHERE f.reference = ? AND f.publication_status = 'published'`, [String(req.params.reference)])
    if (!row) throw notFound('Published record not found.')
    res.json({ record: shapeRecord(row), note: 'This record is published because a reviewer verified its source. It remains a reproduction of public information, not an official certification.' })
  }),
)

financePublicRouter.get(
  '/transparency/finance/budgets',
  asyncHandler(async (req, res) => {
    ensureFinanceCategories()
    const year = Number(req.query.year) || null
    const slug = req.query.municipality || null
    const entityRows = all(`SELECT id, name, slug FROM municipalities WHERE is_active = 1 ORDER BY sort_order, name`)
    const entities = [{ id: null, name: 'Provincial Government of Marinduque', slug: 'provincial' }, ...entityRows]
    const selected = slug ? entities.find((entity) => entity.slug === slug) : null
    if (slug && !selected) throw notFound('Government entity not found.')

    const budgetRows = all(
      `${BASE_SELECT} WHERE f.publication_status = 'published' AND f.record_type = 'budget'
       ${slug ? 'AND COALESCE(m.slug, \'provincial\') = ?' : ''} ${year ? 'AND f.fiscal_year = ?' : ''}
       ORDER BY f.fiscal_year DESC, f.id DESC`,
      [slug, year].filter((value) => value !== null && value !== undefined && value !== ''),
    )
    const years = [...new Set(budgetRows.map((row) => row.fiscal_year))].sort((a, b) => b - a)
    const scoped = selected ? budgetRows.filter((row) => (row.municipality_slug || 'provincial') === selected.slug) : budgetRows
    const byCategory = new Map()
    for (const row of scoped) {
      const key = `${row.category_key || row.financial_category}|${row.amount_kind}|${row.fiscal_year}`
      const current = byCategory.get(key) || { categoryKey: row.category_key, categoryLabel: row.category_label, amountKind: row.amount_kind, fiscalYear: row.fiscal_year, totalCents: 0, records: 0, currency: row.currency }
      current.totalCents += Number(row.amount_cents || 0)
      current.records += 1
      byCategory.set(key, current)
    }
    res.json({
      selected: selected ? { slug: selected.slug, name: selected.name, municipalityId: selected.id } : null,
      entities: entities.map((entity) => ({
        slug: entity.slug,
        name: entity.name,
        municipalityId: entity.id,
        publishedBudgets: Number(get(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status='published' AND record_type='budget' AND COALESCE(municipality_id, -1) = ?`, [entity.id ?? -1]).n),
      })),
      years,
      records: scoped.map(shapeRecord),
      allocations: [...byCategory.values()],
      comparisons: buildComparisons(scoped),
      note: 'Only published, source-referenced budget records are shown. Proposed, approved and actual amounts are separate. Missing categories are not zero.',
    })
  }),
)

financePublicRouter.get(
  '/transparency/finance/coverage',
  asyncHandler(async (_req, res) => {
    const entities = [{ id: null, name: 'Provincial Government of Marinduque', slug: 'provincial' }, ...all(`SELECT id, name, slug FROM municipalities WHERE is_active = 1 ORDER BY sort_order`)]
    res.json({
      coverage: entities.map((entity) => ({
        entity: { slug: entity.slug, name: entity.name },
        modules: Object.fromEntries(Object.keys(RECORD_TYPES).map((type) => [type, Number(get(
          `SELECT COUNT(*) AS n FROM financial_records WHERE publication_status='published' AND record_type = ? AND COALESCE(municipality_id, -1) = ?`,
          [type, entity.id ?? -1],
        ).n)])),
      })),
      note: 'A zero count means no verified record has been published yet. It does not mean the government spent or received nothing.',
    })
  }),
)

function buildComparisons(rows) {
  const byScope = new Map()
  for (const row of rows) {
    if (row.record_type !== 'budget') continue
    const scope = `${row.municipality_slug || 'provincial'}|${row.category_key || row.financial_category}|${row.amount_kind}`
    if (!byScope.has(scope)) byScope.set(scope, new Map())
    const years = byScope.get(scope)
    years.set(row.fiscal_year, (years.get(row.fiscal_year) || 0) + Number(row.amount_cents || 0))
  }
  const comparisons = []
  for (const [scope, yearsMap] of byScope) {
    const [entity, category, kind] = scope.split('|')
    const years = [...yearsMap.keys()].sort((a, b) => a - b)
    for (let index = 1; index < years.length; index += 1) {
      const previous = yearsMap.get(years[index - 1])
      const current = yearsMap.get(years[index])
      comparisons.push({
        entity,
        category,
        amountKind: kind,
        previousYear: years[index - 1],
        currentYear: years[index],
        previousCents: previous,
        currentCents: current,
        differenceCents: current - previous,
        percentageChange: previous > 0 ? Number((((current - previous) / previous) * 100).toFixed(2)) : null,
      })
    }
  }
  return comparisons.slice(0, 60)
}

/* -------------------------------- Admin --------------------------------- */

export const financeAdminRouter = Router()
financeAdminRouter.use(requireAuth, requireAdmin)

const recordBody = z.object({
  recordType: z.enum(Object.keys(RECORD_TYPES)),
  title: z.string().trim().min(5).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  governmentLevel: z.enum(['provincial', 'municipal']),
  municipalityId: z.coerce.number().int().positive().nullable().optional(),
  fiscalYear: z.coerce.number().int().min(2000).max(2100),
  periodType: z.enum(['annual', 'quarterly', 'monthly']).default('annual'),
  periodLabel: z.string().trim().min(2).max(80),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  categoryKey: z.string().trim().min(2).max(60),
  officialClassification: z.string().trim().max(200).optional().or(z.literal('')),
  department: z.string().trim().max(200).optional().or(z.literal('')),
  counterparty: z.string().trim().max(200).optional().or(z.literal('')),
  amountCents: z.coerce.number().int(),
  currency: z.string().trim().length(3).default('PHP'),
  amountKind: z.enum(Object.keys(AMOUNT_KINDS)),
  sourceInstitution: z.string().trim().max(200).optional().or(z.literal('')),
  sourceTitle: z.string().trim().max(300).optional().or(z.literal('')),
  sourceUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
  sourcePublishedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  limitations: z.string().trim().max(1000).optional().or(z.literal('')),
  identifier: z.string().trim().max(120).optional().or(z.literal('')),
  location: z.string().trim().max(200).optional().or(z.literal('')),
  termStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  termEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  maturityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  interestRate: z.coerce.number().min(0).max(100).optional(),
  outstandingBalanceCents: z.coerce.number().int().min(0).optional(),
  principalCents: z.coerce.number().int().min(0).optional(),
  quantity: z.coerce.number().int().min(0).optional(),
  quantityLabel: z.string().trim().max(80).optional().or(z.literal('')),
  stage: z.string().trim().max(120).optional().or(z.literal('')),
  programName: z.string().trim().max(200).optional().or(z.literal('')),
  rateDescription: z.string().trim().max(300).optional().or(z.literal('')),
  assessmentBasis: z.string().trim().max(300).optional().or(z.literal('')),
  arrangement: z.string().trim().max(500).optional().or(z.literal('')),
  titleNumber: z.string().trim().max(120).optional().or(z.literal('')),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

function validateRecordPayload(body, ctxCurrent) {
  ensureFinanceCategories()
  if (!get(`SELECT id FROM finance_categories WHERE key = ?`, [body.categoryKey])) {
    throw unprocessable('Choose a supported financial category.')
  }
  if (body.governmentLevel === 'municipal' && !body.municipalityId) throw unprocessable('Select the municipality for a municipal record.')
  if (body.governmentLevel === 'provincial' && body.municipalityId) throw unprocessable('A provincial record cannot belong to a municipality.')
  if (body.governmentLevel === 'municipal' && !canUseMunicipality(ctxCurrent, body.municipalityId)) throw forbidden('You cannot manage records for that municipality.')
  if (body.amountCents < 0 && body.amountKind !== 'adjusted') throw unprocessable('Negative values are only allowed for adjustments. Use the correct amount kind.')
  if (body.periodType !== 'annual' && body.periodType !== 'quarterly' && body.periodType !== 'monthly') throw unprocessable('Choose a supported reporting period.')
  if (body.amountKind === 'proposed' && body.fiscalYear > new Date().getFullYear() + 2) throw unprocessable('Check the fiscal year for a proposed budget.')
  if (body.interestRate !== undefined && body.interestRate > 100) throw unprocessable('Interest rates above 100% need a documented explanation in limitations.')
  if (body.termStart && body.termEnd && body.termEnd < body.termStart) throw unprocessable('The end date cannot be before the start date.')
  if (body.recordType === 'loan' && body.outstandingBalanceCents !== undefined && body.outstandingBalanceCents > Math.abs(body.amountCents) && body.amountCents > 0) {
    throw unprocessable('Outstanding balance cannot exceed the recorded principal. Use principal for the original amount.')
  }
  if (['asset', 'land'].includes(body.recordType) && body.recordType === 'land' && !body.identifier && !body.titleNumber && !body.location) {
    throw unprocessable('Record at least one land identifier, title number or location.')
  }
  return true
}

function canManageRecord(req, row) {
  return canAccessRecord(req, row)
}

function snapshot(row, req, note) {
  run(`INSERT INTO finance_record_versions (record_id, snapshot, change_note, changed_by) VALUES (?, ?, ?, ?)`, [
    row.id,
    JSON.stringify(row),
    cleanText(note, 300),
    req.user.id,
  ])
}

function duplicateExists(body, ignoreId = null) {
  return get(
    `SELECT id FROM financial_records WHERE record_type = ? AND government_level = ? AND COALESCE(municipality_id, -1) = ?
       AND fiscal_year = ? AND period_label = ? AND COALESCE(category_key, financial_category) = ? AND amount_kind = ?
       AND amount_cents = ? AND COALESCE(department_name, '') = ? AND id <> COALESCE(?, -1)`,
    [
      body.recordType,
      body.governmentLevel,
      body.municipalityId ?? -1,
      body.fiscalYear,
      body.periodLabel,
      body.categoryKey,
      body.amountKind,
      body.amountCents,
      body.department || '',
      ignoreId,
    ],
  )
}

financeAdminRouter.get(
  '/transparency/finance',
  requirePermission('transparency.view'),
  asyncHandler(async (req, res) => {
    ensureFinanceCategories()
    const scope = scopeClause(req)
    const rows = all(`${BASE_SELECT} WHERE 1 = 1${scope.sql} ORDER BY f.id DESC LIMIT 100`, scope.params)
    res.json({
      summary: {
        total: rows.length,
        drafts: rows.filter((row) => ['draft', 'requires_correction'].includes(row.publication_status)).length,
        awaitingVerification: rows.filter((row) => ['awaiting_source', 'under_review'].includes(row.publication_status)).length,
        published: rows.filter((row) => row.publication_status === 'published').length,
      },
      records: rows.map(shapeRecord),
      periods: all(`SELECT * FROM transparency_periods ORDER BY fiscal_year DESC, id DESC LIMIT 50`),
      imports: all(`SELECT i.*, m.name AS municipality_name FROM finance_imports i LEFT JOIN municipalities m ON m.id = i.municipality_id ORDER BY i.id DESC LIMIT 20`),
      modules: RECORD_TYPES,
      amountKinds: AMOUNT_KINDS,
      statuses: STATUSES,
      categories: all(`SELECT key, label FROM finance_categories WHERE active = 1 ORDER BY sort_order`),
      entities: all(`SELECT id, name, slug FROM municipalities WHERE is_active = 1 ORDER BY sort_order`),
      canApprove: Boolean(ctx(req).hasGlobalScope || all(`SELECT 1 FROM user_role_assignments WHERE user_id = ?`, [req.user.id]).length),
      note: 'Drafts and reviewer notes are never public. Only verified, approved records can be published; source details are required before verification.',
    })
  }),
)

financeAdminRouter.post(
  '/transparency/finance/records',
  requirePermission('transparency.documents.manage'),
  validate(recordBody),
  asyncHandler(async (req, res) => {
    const body = req.body
    validateRecordPayload(body, ctx(req))
    if (duplicateExists(body)) throw unprocessable('A matching record already exists. Edit that record instead of duplicating it.')
    const id = Number(
      run(
        `INSERT INTO financial_records (reference, record_type, title, description, government_level, municipality_id, fiscal_year,
          period_type, period_label, period_start, period_end, financial_category, category_key, official_classification, department_name,
          counterparty, amount_cents, currency, amount_kind, source_institution, source_title, source_url, source_published_on,
          verification_status, publication_status, limitations, metadata, identifier, location, term_start, term_end, maturity_date,
          interest_rate, outstanding_balance_cents, principal_cents, quantity, quantity_label, stage, program_name, rate_description,
          assessment_basis, arrangement, title_number, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reference('BG-FIN'), body.recordType, cleanText(body.title, 200), cleanText(body.description, 2000), body.governmentLevel,
          body.municipalityId ?? null, body.fiscalYear, body.periodType, cleanText(body.periodLabel, 80),
          body.periodStart || null, body.periodEnd || null, body.categoryKey, body.categoryKey,
          cleanText(body.officialClassification, 200), cleanText(body.department, 200), cleanText(body.counterparty, 200),
          body.amountCents, body.currency || 'PHP', body.amountKind, cleanText(body.sourceInstitution, 200),
          cleanText(body.sourceTitle, 300), cleanText(body.sourceUrl, 500), body.sourcePublishedOn || null,
          cleanText(body.limitations, 1000), JSON.stringify(body.metadata || {}),
          cleanText(body.identifier, 120), cleanText(body.location, 200), body.termStart || null, body.termEnd || null, body.maturityDate || null,
          body.interestRate ?? null, body.outstandingBalanceCents ?? null, body.principalCents ?? null, body.quantity ?? null,
          cleanText(body.quantityLabel, 80), cleanText(body.stage, 120), cleanText(body.programName, 200),
          cleanText(body.rateDescription, 300), cleanText(body.assessmentBasis, 300), cleanText(body.arrangement, 500), cleanText(body.titleNumber, 120),
          req.user.id, nowIso(), nowIso(),
        ],
      ).lastInsertRowid,
    )
    logAudit(req, { action: 'transparency.record_created', module: 'transparency', entityType: 'financial_record', entityId: id })
    res.status(201).json({ message: 'Financial record saved as a draft. It is not public.', record: shapeRecord(get(`${BASE_SELECT} WHERE f.id = ?`, [id])) })
  }),
)

financeAdminRouter.put(
  '/transparency/finance/records/:id',
  requirePermission('transparency.documents.manage'),
  validate(recordBody),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM financial_records WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Record not found.')
    if (!canManageRecord(req, row)) throw notFound('Record not found.')
    if (!['draft', 'requires_correction'].includes(row.publication_status)) throw unprocessable('Only draft or correction records can be edited. Create a correction instead of altering published figures.')
    const body = req.body
    validateRecordPayload(body, ctx(req))
    if (duplicateExists(body, row.id)) throw unprocessable('A matching record already exists.')
    snapshot(row, req, 'Edited draft')
    run(
      `UPDATE financial_records SET record_type = ?, title = ?, description = ?, government_level = ?, municipality_id = ?, fiscal_year = ?,
        period_type = ?, period_label = ?, period_start = ?, period_end = ?, financial_category = ?, category_key = ?,
        official_classification = ?, department_name = ?, counterparty = ?, amount_cents = ?, currency = ?, amount_kind = ?,
        source_institution = ?, source_title = ?, source_url = ?, source_published_on = ?, limitations = ?, metadata = ?,
        identifier = ?, location = ?, term_start = ?, term_end = ?, maturity_date = ?, interest_rate = ?, outstanding_balance_cents = ?,
        principal_cents = ?, quantity = ?, quantity_label = ?, stage = ?, program_name = ?, rate_description = ?, assessment_basis = ?,
        arrangement = ?, title_number = ?, updated_at = ?
       WHERE id = ?`,
      [
        body.recordType, cleanText(body.title, 200), cleanText(body.description, 2000), body.governmentLevel, body.municipalityId ?? null,
        body.fiscalYear, body.periodType, cleanText(body.periodLabel, 80), body.periodStart || null, body.periodEnd || null,
        body.categoryKey, body.categoryKey, cleanText(body.officialClassification, 200), cleanText(body.department, 200),
        cleanText(body.counterparty, 200), body.amountCents, body.currency || 'PHP', body.amountKind,
        cleanText(body.sourceInstitution, 200), cleanText(body.sourceTitle, 300), cleanText(body.sourceUrl, 500),
        body.sourcePublishedOn || null, cleanText(body.limitations, 1000), JSON.stringify(body.metadata || {}),
        cleanText(body.identifier, 120), cleanText(body.location, 200), body.termStart || null, body.termEnd || null, body.maturityDate || null,
        body.interestRate ?? null, body.outstandingBalanceCents ?? null, body.principalCents ?? null, body.quantity ?? null,
        cleanText(body.quantityLabel, 80), cleanText(body.stage, 120), cleanText(body.programName, 200),
        cleanText(body.rateDescription, 300), cleanText(body.assessmentBasis, 300), cleanText(body.arrangement, 500), cleanText(body.titleNumber, 120),
        nowIso(), row.id,
      ],
    )
    logAudit(req, { action: 'transparency.record_updated', module: 'transparency', entityType: 'financial_record', entityId: row.id })
    res.json({ message: 'Draft updated. The previous version is kept in history.', record: shapeRecord(get(`${BASE_SELECT} WHERE f.id = ?`, [row.id])) })
  }),
)

financeAdminRouter.post(
  '/transparency/finance/records/:id/transition',
  validate(z.object({ action: z.enum(['submit', 'review', 'verify', 'approve', 'publish', 'correction', 'archive']), note: z.string().trim().max(1000).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM financial_records WHERE id = ?`, [Number(req.params.id)])
    if (!row) throw notFound('Record not found.')
    if (!canManageRecord(req, row)) throw notFound('Record not found.')
    const note = cleanText(req.body.note, 1000)
    const map = {
      submit: { from: ['draft', 'requires_correction'], to: 'awaiting_source' },
      review: { from: ['awaiting_source'], to: 'under_review' },
      verify: { from: ['under_review'], to: 'verified' },
      approve: { from: ['verified'], to: 'approved' },
      publish: { from: ['approved'], to: 'published' },
      correction: { from: ['awaiting_source', 'under_review', 'verified', 'approved', 'published'], to: 'requires_correction' },
      archive: { from: ['published', 'approved', 'requires_correction'], to: 'archived' },
    }
    const move = map[req.body.action]
    if (!move.from.includes(row.publication_status)) throw unprocessable(`This record cannot be ${req.body.action}ed from its current status.`)
    if (['verify', 'approve'].includes(req.body.action) && !ctx(req).hasGlobalScope && !all(`SELECT 1 FROM user_role_assignments WHERE user_id = ?`, [req.user.id]).length) {
      throw forbidden('You are not allowed to verify records.')
    }
    if (['submit', 'verify', 'approve', 'publish'].includes(req.body.action)) {
      if (!row.source_institution || !row.source_title) throw unprocessable('Record the source institution and original document title first.')
      if (!row.municipality_id && row.government_level === 'municipal') throw unprocessable('Municipal records need a municipality.')
    }
    if (req.body.action === 'correction' && note.length < 5) throw unprocessable('Explain what requires correction so the record stays traceable.')
    snapshot(row, req, `Transition: ${req.body.action}${note ? ` — ${note}` : ''}`)
    const sets = ['publication_status = ?', 'updated_at = ?']
    const values = [move.to, nowIso()]
    if (req.body.action === 'verify') {
      sets.push('verification_status = ?', 'verified_by = ?', 'verified_at = ?')
      values.push('verified', req.user.id, nowIso())
    }
    if (req.body.action === 'correction') {
      sets.push('verification_status = ?')
      values.push('requires_correction')
    }
    if (req.body.action === 'publish') {
      sets.push('verification_status = ?')
      values.push('verified')
      if (row.verified_at === null) throw unprocessable('A record must be verified before it is published.')
    }
    if (req.body.action === 'archive') {
      sets.push('verification_status = ?')
      values.push('archived')
    }
    values.push(row.id)
    run(`UPDATE financial_records SET ${sets.join(', ')} WHERE id = ?`, values)
    logAudit(req, { action: `transparency.${req.body.action}`, module: 'transparency', entityType: 'financial_record', entityId: row.id, detail: note })
    if (req.body.action === 'publish') {
      publishTransparencyEvent({
        eventKey: `finance:${row.reference}:published`,
        eventType: 'record_published',
        title: `Published ${RECORD_TYPES[row.record_type] || 'financial'} record`,
        summary: row.title,
        recordReference: row.reference,
        municipalityId: row.municipality_id,
        category: row.record_type,
        periodLabel: row.period_label,
      })
    }
    res.json({
      message: req.body.action === 'publish'
        ? 'Record published. It is now available in the public transparency portal.'
        : `Record status is now ${STATUSES[move.to]}.`,
      record: shapeRecord(get(`${BASE_SELECT} WHERE f.id = ?`, [row.id])),
    })
  }),
)

financeAdminRouter.get(
  '/transparency/finance/records/:id/versions',
  requirePermission('transparency.view'),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM financial_records WHERE id = ?`, [Number(req.params.id)])
    if (!row || !canManageRecord(req, row)) throw notFound('Record not found.')
    res.json({
      versions: all(`SELECT id, change_note, created_at, snapshot FROM finance_record_versions WHERE record_id = ? ORDER BY id DESC LIMIT 50`, [row.id]).map((entry) => ({
        id: entry.id,
        changeNote: entry.change_note,
        createdAt: entry.created_at,
        snapshot: parse(entry.snapshot, {}),
      })),
    })
  }),
)

financeAdminRouter.post(
  '/transparency/finance/periods',
  requirePermission('transparency.documents.manage'),
  validate(z.object({
    governmentLevel: z.enum(['provincial', 'municipal']),
    municipalityId: z.coerce.number().int().positive().nullable().optional(),
    fiscalYear: z.coerce.number().int().min(2000).max(2100),
    periodType: z.enum(['annual', 'quarterly', 'monthly']),
    periodLabel: z.string().trim().min(2).max(80),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
    publishedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
    notes: z.string().trim().max(500).optional().or(z.literal('')),
  })),
  asyncHandler(async (req, res) => {
    const body = req.body
    if (body.governmentLevel === 'municipal' && !body.municipalityId) throw unprocessable('Choose the municipality.')
    if (body.governmentLevel === 'municipal' && !canUseMunicipality(ctx(req), body.municipalityId)) throw forbidden('You cannot manage that municipality.')
    const existing = get(
      `SELECT id FROM transparency_periods WHERE government_level = ? AND COALESCE(municipality_id, -1) = ? AND fiscal_year = ? AND period_type = ? AND period_label = ?`,
      [body.governmentLevel, body.municipalityId ?? -1, body.fiscalYear, body.periodType, body.periodLabel],
    )
    if (existing) throw unprocessable('That reporting period already exists.')
    const id = Number(run(
      `INSERT INTO transparency_periods (government_level, municipality_id, fiscal_year, period_type, period_label, starts_on, ends_on, published_on, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [body.governmentLevel, body.municipalityId ?? null, body.fiscalYear, body.periodType, cleanText(body.periodLabel, 80), body.startsOn || null, body.endsOn || null, body.publishedOn || null, cleanText(body.notes, 500), req.user.id],
    ).lastInsertRowid)
    logAudit(req, { action: 'transparency.period_created', module: 'transparency', entityType: 'transparency_period', entityId: id })
    res.status(201).json({ message: 'Reporting period recorded.', period: get(`SELECT * FROM transparency_periods WHERE id = ?`, [id]) })
  }),
)

financeAdminRouter.post(
  '/transparency/finance/imports',
  requirePermission('transparency.documents.manage'),
  validate(z.object({
    recordType: z.enum(Object.keys(RECORD_TYPES)),
    governmentLevel: z.enum(['provincial', 'municipal']),
    municipalityId: z.coerce.number().int().positive().nullable().optional(),
    filename: z.string().trim().max(200).optional().or(z.literal('')),
    rows: z.array(recordBody.partial({ governmentLevel: true, municipalityId: true, recordType: true })).min(1).max(200),
  })),
  asyncHandler(async (req, res) => {
    const body = req.body
    if (body.governmentLevel === 'municipal' && !canUseMunicipality(ctx(req), body.municipalityId)) throw forbidden('You cannot import records for that municipality.')
    const errors = []
    let accepted = 0
    for (const [index, row] of body.rows.entries()) {
      try {
        const merged = { ...row, recordType: body.recordType, governmentLevel: body.governmentLevel, municipalityId: body.municipalityId ?? null }
        const parsed = recordBody.parse(merged)
        validateRecordPayload(parsed, ctx(req))
        if (duplicateExists(parsed)) {
          errors.push({ row: index + 1, error: 'Duplicate of an existing record.' })
          continue
        }
        run(
          `INSERT INTO financial_records (reference, record_type, title, description, government_level, municipality_id, fiscal_year,
            period_type, period_label, period_start, period_end, financial_category, category_key, official_classification, department_name,
            counterparty, amount_cents, currency, amount_kind, source_institution, source_title, source_url, source_published_on,
            verification_status, publication_status, limitations, metadata, identifier, location, term_start, term_end, maturity_date,
            interest_rate, outstanding_balance_cents, principal_cents, quantity, quantity_label, stage, program_name, rate_description,
            assessment_basis, arrangement, title_number, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            reference('BG-FIN'), parsed.recordType, cleanText(parsed.title, 200), cleanText(parsed.description, 2000), parsed.governmentLevel,
            parsed.municipalityId ?? null, parsed.fiscalYear, parsed.periodType, cleanText(parsed.periodLabel, 80),
            parsed.periodStart || null, parsed.periodEnd || null, parsed.categoryKey, parsed.categoryKey,
            cleanText(parsed.officialClassification, 200), cleanText(parsed.department, 200), cleanText(parsed.counterparty, 200),
            parsed.amountCents, parsed.currency || 'PHP', parsed.amountKind, cleanText(parsed.sourceInstitution, 200),
            cleanText(parsed.sourceTitle, 300), cleanText(parsed.sourceUrl, 500), parsed.sourcePublishedOn || null,
            cleanText(parsed.limitations, 1000), JSON.stringify(parsed.metadata || {}),
            cleanText(parsed.identifier, 120), cleanText(parsed.location, 200), parsed.termStart || null, parsed.termEnd || null, parsed.maturityDate || null,
            parsed.interestRate ?? null, parsed.outstandingBalanceCents ?? null, parsed.principalCents ?? null, parsed.quantity ?? null,
            cleanText(parsed.quantityLabel, 80), cleanText(parsed.stage, 120), cleanText(parsed.programName, 200),
            cleanText(parsed.rateDescription, 300), cleanText(parsed.assessmentBasis, 300), cleanText(parsed.arrangement, 500), cleanText(parsed.titleNumber, 120),
            req.user.id, nowIso(), nowIso(),
          ],
        )
        accepted += 1
      } catch (error) {
        errors.push({ row: index + 1, error: error.message })
      }
    }
    const id = Number(run(
      `INSERT INTO finance_imports (reference, government_level, municipality_id, record_type, filename, row_count, accepted_count, rejected_count, errors, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reference('BG-IMP'), body.governmentLevel, body.municipalityId ?? null, body.recordType, cleanText(body.filename, 200), body.rows.length, accepted, errors.length, JSON.stringify(errors.slice(0, 50)), req.user.id],
    ).lastInsertRowid)
    logAudit(req, { action: 'transparency.import', module: 'transparency', entityType: 'finance_import', entityId: id })
    res.status(201).json({
      message: `${accepted} row(s) imported as drafts; ${errors.length} rejected. Nothing is public until it is verified and published.`,
      import: { id, accepted, rejected: errors.length, errors },
    })
  }),
)
