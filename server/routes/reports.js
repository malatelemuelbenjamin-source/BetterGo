/**
 * Prompt 111 — source-backed transparency report builder.
 *
 * Reports are generated from published financial records only. Derived values
 * are labelled with their formula, source, period, calculation date and
 * limitations; incompatible stages are never added together. Exports carry the
 * independent-platform disclaimer and never include private fields.
 */
import { Router } from 'express'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { requireAdmin, requirePermission } from '../rbac.js'
import { asyncHandler, cleanText, notFound, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { sendExport } from '../lib/exporters.js'
import { AMOUNT_KINDS, RECORD_TYPES, shapeRecord } from './finance.js'

export const REPORT_SECTIONS = [
  ['summary', 'Summary'],
  ['budget', 'Budget'],
  ['revenue', 'Revenue'],
  ['expenditure', 'Expenditure'],
  ['procurement', 'Procurement'],
  ['projects', 'Infrastructure projects'],
  ['grants', 'Grants and donations'],
  ['debt', 'Debt and obligations'],
  ['personnel', 'Personnel services'],
  ['assets', 'Assets and property'],
  ['audit', 'Audit and documentation'],
  ['monitoring', 'Approved monitoring observations'],
  ['trend', 'Historical trend'],
  ['comparison', 'Municipality comparison'],
  ['sources', 'Source references'],
  ['methodology', 'Methodology and limitations'],
]

const filterSchema = z.object({
  entity: z.string().trim().max(40).optional().or(z.literal('')),
  municipality: z.string().trim().max(40).optional().or(z.literal('')),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  period: z.string().trim().max(80).optional().or(z.literal('')),
  category: z.string().trim().max(60).optional().or(z.literal('')),
  department: z.string().trim().max(200).optional().or(z.literal('')),
  types: z.array(z.enum(Object.keys(RECORD_TYPES))).max(17).optional(),
  kind: z.enum(Object.keys(AMOUNT_KINDS)).optional().or(z.literal('')),
  verifiedOnly: z.boolean().optional(),
})

const configBody = z.object({
  title: z.string().trim().min(4).max(160),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  templateSlug: z.string().trim().max(80).optional().or(z.literal('')),
  filters: filterSchema,
  sections: z.array(z.enum(REPORT_SECTIONS.map(([key]) => key))).min(1).max(REPORT_SECTIONS.length),
  shared: z.boolean().optional(),
})

const publicId = () => `BG-RPT-${randomBytes(5).toString('hex').toUpperCase()}`
const money = (cents) => (cents === null || cents === undefined ? null : Number(cents))
const centsToPeso = (cents) => (cents === null || cents === undefined ? null : Number(cents) / 100)

export function ensureReportTemplatesSeeded() {
  // seed-phase5b.js owns the neutral template metadata; this is only a guard
  // used after a database restore that skipped the seed step.
  if (Number(get(`SELECT COUNT(*) AS n FROM report_templates`).n) === 0) {
    run(`INSERT OR IGNORE INTO report_templates (slug, title, description, sections) VALUES ('annual-budget', 'Annual Government Budget Report', 'Published budget records.', '["summary","budget","sources","methodology"]')`)
  }
}

function entityFilter(filters) {
  const slug = filters.entity || filters.municipality || ''
  if (!slug || slug === 'all') return { sql: '', params: [], entity: null }
  if (slug === 'provincial') return { sql: ` AND f.government_level = 'provincial'`, params: [], entity: { slug, level: 'provincial', name: 'Provincial Government of Marinduque' } }
  const row = get(`SELECT id, name, slug FROM municipalities WHERE slug = ? AND is_active = 1`, [slug])
  if (!row) throw notFound('Government entity not found.')
  return { sql: ' AND f.municipality_id = ?', params: [row.id], entity: { slug: row.slug, level: 'municipal', name: row.name, municipalityId: row.id } }
}

function publishedRows(filters = {}) {
  const entity = entityFilter(filters)
  const clauses = [`f.publication_status = 'published'`]
  const params = []
  if (filters.year) { clauses.push('f.fiscal_year = ?'); params.push(Number(filters.year)) }
  if (filters.period) { clauses.push('f.period_label = ?'); params.push(String(filters.period)) }
  if (filters.category) { clauses.push('COALESCE(f.category_key, f.financial_category) = ?'); params.push(String(filters.category)) }
  if (filters.department) { clauses.push('f.department_name = ?'); params.push(String(filters.department)) }
  if (filters.kind) { clauses.push('f.amount_kind = ?'); params.push(String(filters.kind)) }
  if (Array.isArray(filters.types) && filters.types.length) {
    clauses.push(`f.record_type IN (${filters.types.map(() => '?').join(',')})`)
    params.push(...filters.types)
  }
  const rows = all(
    `SELECT f.*, m.name AS municipality_name, m.slug AS municipality_slug, c.label AS category_label
     FROM financial_records f LEFT JOIN municipalities m ON m.id = f.municipality_id
     LEFT JOIN finance_categories c ON c.key = COALESCE(f.category_key, f.financial_category)
     WHERE ${clauses.join(' AND ')}${entity.sql} ORDER BY f.fiscal_year DESC, f.record_type, f.id`,
    [...params, ...entity.params],
  )
  return { rows, entity: entity.entity, params }
}

function sum(rows, predicate = () => true) {
  const selected = rows.filter(predicate)
  if (!selected.length) return null
  return selected.reduce((total, row) => total + Number(row.amount_cents || 0), 0)
}

function calculation(key, label, valueCents, { formula, source, period, limitations, valuePercent = null } = {}) {
  return {
    key,
    label,
    valueCents: money(valueCents),
    valuePeso: centsToPeso(valueCents),
    valuePercent,
    formula: formula || 'Sum of the listed published records.',
    source: source || 'Published financial records in this report.',
    period: period || 'Selected reporting period',
    calculatedAt: nowIso(),
    limitations: limitations || 'Only complete, comparable records are included; missing data is not treated as zero.',
  }
}

export function buildReport(filters = {}, sections = ['summary', 'sources', 'methodology'], user = null) {
  ensureReportTemplatesSeeded()
  const { rows, entity } = publishedRows(filters)
  const include = new Set(sections)
  const years = [...new Set(rows.map((row) => row.fiscal_year).filter(Boolean))].sort((a, b) => b - a)
  const byKind = Object.fromEntries(Object.keys(AMOUNT_KINDS).map((kind) => [kind, sum(rows, (row) => row.amount_kind === kind)]))
  const byType = Object.fromEntries(Object.keys(RECORD_TYPES).map((type) => [type, rows.filter((row) => row.record_type === type).length]))

  const approvedBudget = sum(rows, (row) => row.record_type === 'budget' && row.amount_kind === 'approved')
  const actualRevenue = sum(rows, (row) => row.record_type === 'revenue' && row.amount_kind === 'actual')
  const actualExpenditure = sum(rows, (row) => row.record_type === 'expenditure' && row.amount_kind === 'actual')
  const procurementTotal = sum(rows, (row) => row.record_type === 'procurement' && row.amount_kind === 'contract')
  const projectFunding = sum(rows, (row) => row.record_type === 'project' && row.amount_kind === 'approved')
  const personnelActual = sum(rows, (row) => row.record_type === 'payroll' && row.amount_kind === 'actual')

  const calculations = []
  if (include.has('summary') || include.has('budget')) calculations.push(calculation('approved_budget', 'Total approved budget', approvedBudget, {
    formula: 'Sum of budget records classified as approved appropriations. Proposed and adjusted amounts are excluded.',
    source: 'Published budget records with amount classification "approved".',
    period: filters.year ? `Fiscal year ${filters.year}` : years.length ? `Fiscal years ${years.join(', ')}` : 'No reporting period',
    limitations: 'An approved budget is not proof that money was spent. Proposed amounts are not appropriations.',
  }))
  if (include.has('summary') || include.has('revenue')) calculations.push(calculation('actual_revenue', 'Actual revenue collected', actualRevenue, {
    formula: 'Sum of revenue records classified as actual collections. Assessments and estimates are excluded.',
    source: 'Published revenue records with amount classification "actual".',
    limitations: 'Tax assessments and receivables are separate concepts and are not added here.',
  }))
  if (include.has('summary') || include.has('expenditure')) calculations.push(calculation('actual_expenditure', 'Actual expenditure', actualExpenditure, {
    formula: 'Sum of expenditure records classified as actual. Allotments, obligations and disbursements are not added.',
    source: 'Published expenditure records with amount classification "actual".',
    limitations: 'A disbursement is not automatically the same as actual expenditure in every accounting basis.',
  }))
  if ((include.has('summary') || include.has('budget')) && approvedBudget !== null && actualExpenditure !== null) {
    const percent = approvedBudget > 0 ? Number(((actualExpenditure / approvedBudget) * 100).toFixed(2)) : null
    calculations.push(calculation('budget_utilization', 'Budget utilization', null, {
      valuePercent: percent,
      formula: 'Actual expenditure ÷ approved budget × 100. Not calculated when the approved budget is zero or missing.',
      source: 'Comparable published budget and expenditure records with the same entity and period.',
      limitations: percent === null ? 'Not calculated because no positive approved budget was published for this selection.' : 'Utilization is a ratio of two published aggregates; it does not establish that spending was lawful or effective.',
    }))
  }
  if (include.has('procurement')) calculations.push(calculation('procurement_total', 'Procurement and contract total', procurementTotal, {
    formula: 'Sum of procurement records classified as contract amounts. Awarded contracts are not treated as actual payments.',
  }))
  if (include.has('projects')) calculations.push(calculation('project_funding', 'Aggregate approved project funding', projectFunding, {
    formula: 'Sum of project records classified as approved funding. No amount is counted twice across modules.',
  }))
  if (include.has('personnel') && personnelActual !== null && actualExpenditure !== null && actualExpenditure > 0) {
    calculations.push(calculation('personnel_share', 'Personnel expenditure share', null, {
      valuePercent: Number(((personnelActual / actualExpenditure) * 100).toFixed(2)),
      formula: 'Personnel services actual ÷ total actual expenditure × 100.',
      source: 'Published payroll and expenditure aggregates.',
      limitations: 'Aggregate only; no individual payroll record is included.',
    }))
  }

  // Trends require at least two fiscal years of the same entity/category.
  const trend = []
  if (include.has('trend')) {
    const scope = rows.filter((row) => (!filters.types?.length || filters.types.includes(row.record_type)))
    const byYear = new Map()
    for (const row of scope) {
      if (!row.fiscal_year || !['actual', 'approved'].includes(row.amount_kind)) continue
      const key = `${row.fiscal_year}|${row.amount_kind}`
      byYear.set(key, (byYear.get(key) || 0) + Number(row.amount_cents || 0))
    }
    for (const [key, value] of [...byYear.entries()].sort()) {
      const [year, kind] = key.split('|')
      trend.push({ year: Number(year), amountKind: kind, amountCents: value })
    }
    const actuals = trend.filter((row) => row.amountKind === 'actual').sort((a, b) => a.year - b.year)
    if (actuals.length >= 2) {
      const previous = actuals[actuals.length - 2]
      const current = actuals[actuals.length - 1]
      calculations.push(calculation('revenue_or_expenditure_growth', 'Change between comparable years', current.amountCents - previous.amountCents, {
        valuePercent: previous.amountCents > 0 ? Number((((current.amountCents - previous.amountCents) / previous.amountCents) * 100).toFixed(2)) : null,
        formula: `(${current.year} actual − ${previous.year} actual) ÷ ${previous.year} actual × 100, using the same entity and category.`,
        limitations: 'Only shown when both years have published actual records. A missing year is not treated as zero.',
      }))
    }
  }

  const allocations = new Map()
  for (const row of rows.filter((entry) => entry.amount_kind === 'approved')) {
    const key = row.category_key || row.financial_category || 'uncategorised'
    const current = allocations.get(key) || { categoryKey: key, categoryLabel: row.category_label || key, amountCents: 0, records: 0 }
    current.amountCents += Number(row.amount_cents || 0)
    current.records += 1
    allocations.set(key, current)
  }

  const comparison = []
  if (include.has('comparison')) {
    const entities = all(`SELECT id, name, slug FROM municipalities WHERE is_active = 1 ORDER BY sort_order, name`)
    for (const municipality of entities) {
      const municipalityRows = all(
        `SELECT amount_cents, amount_kind FROM financial_records WHERE publication_status = 'published' AND record_type = 'budget'
           AND municipality_id = ? ${filters.year ? 'AND fiscal_year = ?' : ''} ${filters.category ? 'AND COALESCE(category_key, financial_category) = ?' : ''}`,
        [municipality.id, ...(filters.year ? [Number(filters.year)] : []), ...(filters.category ? [String(filters.category)] : [])],
      )
      const approved = municipalityRows.filter((row) => row.amount_kind === 'approved').reduce((total, row) => total + Number(row.amount_cents || 0), 0)
      comparison.push({ slug: municipality.slug, name: municipality.name, approvedBudgetCents: municipalityRows.length ? approved : null, records: municipalityRows.length })
    }
  }

  const sources = [...new Map(rows.map((row) => [
    `${row.source_institution || ''}|${row.source_title || ''}|${row.source_url || ''}`,
    { institution: row.source_institution, title: row.source_title, url: row.source_url, publishedOn: row.source_published_on, records: 0 },
  ])).values()]
  for (const source of sources) source.records = rows.filter((row) => `${row.source_institution || ''}|${row.source_title || ''}|${row.source_url || ''}` === `${source.institution || ''}|${source.title || ''}|${source.url || ''}`).length

  const monitoring = include.has('monitoring')
    ? all(`SELECT reference, issue_code, description, period_label, severity, detection_date, review_status FROM monitoring_findings WHERE review_status = 'published' ORDER BY id DESC LIMIT 100`)
    : []

  const latestUpdate = rows.reduce((latest, row) => (!latest || String(row.updated_at) > latest ? String(row.updated_at) : latest), null)
  const payloadRows = rows.map((row) => shapeRecord(row))
  const snapshotHash = createHash('sha256').update(JSON.stringify(payloadRows.map((row) => [row.reference, row.amountCents, row.amountKind, row.updatedAt]))).digest('hex').slice(0, 24)

  return {
    title: 'Custom financial transparency report',
    generatedAt: nowIso(),
    generatedBy: user ? { id: user.id } : null,
    entity,
    filters: { ...filters, types: filters.types || [] },
    sections: [...include],
    counts: { records: rows.length, byType, byKind: Object.fromEntries(Object.entries(byKind).map(([key, value]) => [key, value === null ? null : 1])) },
    totals: { byAmountKind: Object.fromEntries(Object.entries(byKind).map(([key, value]) => [key, centsToPeso(value)])), byAmountKindCents: byKind },
    calculations,
    allocations: [...allocations.values()],
    trend,
    comparison,
    monitoring: monitoring.map((row) => ({
      reference: row.reference,
      label: 'Approved data-quality observation',
      description: row.description,
      period: row.period_label,
      severity: row.severity,
      detected: row.detection_date,
      status: row.review_status,
    })),
    sources,
    records: payloadRows.slice(0, 500),
    recordCountTruncated: rows.length > 500,
    coverage: {
      recordsWithoutAmount: rows.filter((row) => row.amount_cents === null).length,
      recordsWithoutSource: rows.filter((row) => !row.source_institution || !row.source_title).length,
      recordsWithoutPeriod: rows.filter((row) => !row.fiscal_year || !row.period_label).length,
      note: 'Missing values are reported as unavailable, never as zero.',
    },
    freshness: {
      latestSourceRecordUpdate: latestUpdate,
      sourceRecordVersions: rows.slice(0, 200).map((row) => ({ reference: row.reference, updatedAt: row.updated_at, verifiedAt: row.verified_at })),
      snapshotHash,
      mayNeedRegeneration: false,
    },
    disclaimers: [
      'BetterGo Marinduque is an independent civic technology platform, not an official government reporting or accounting system.',
      'This report reproduces published, source-referenced records. It is not an official government publication or audit conclusion.',
      'Derived values use only compatible records and state their formula and limitations.',
      'Missing information is shown as unavailable, never as zero.',
    ],
    methodology: 'Records are filtered to published status before selection. Amount classifications remain separate. Derived totals are simple sums over one classification; ratios are calculated only when both values are present and the denominator is positive.',
  }
}

function reportColumns() {
  return [
    { key: 'reference', label: 'Record reference' },
    { key: 'recordType', label: 'Record type' },
    { key: 'title', label: 'Title' },
    { key: 'entity', label: 'Government entity' },
    { key: 'fiscalYear', label: 'Fiscal year' },
    { key: 'periodLabel', label: 'Period' },
    { key: 'categoryKey', label: 'Category' },
    { key: 'amountKind', label: 'Amount classification' },
    { key: 'amountCents', label: 'Amount (centavos)' },
    { key: 'sourceInstitution', label: 'Source institution' },
    { key: 'sourceTitle', label: 'Source document' },
    { key: 'sourceUrl', label: 'Source URL' },
    { key: 'verifiedAt', label: 'Verified at' },
  ]
}

function exportRows(report) {
  return report.records.map((row) => ({
    reference: row.reference,
    recordType: row.recordTypeLabel,
    title: row.title,
    entity: row.entity.name || '',
    fiscalYear: row.fiscalYear,
    periodLabel: row.periodLabel,
    categoryKey: row.categoryLabel || row.categoryKey,
    amountKind: row.amountKindLabel,
    amountCents: row.amountCents,
    sourceInstitution: row.source.institution,
    sourceTitle: row.source.title,
    sourceUrl: row.source.url,
    verifiedAt: row.verifiedAt,
  }))
}

function pdfLines(report) {
  const lines = [
    `Generated: ${report.generatedAt}`,
    `Entity: ${report.entity?.name || 'All published government entities'}`,
    `Period: ${report.filters.year || 'All published years'}${report.filters.period ? ` — ${report.filters.period}` : ''}`,
    '',
    'SUMMARY',
    `Published records included: ${report.counts.records}`,
    ...report.calculations.map((entry) => `${entry.label}: ${entry.valuePercent !== null ? `${entry.valuePercent}%` : entry.valuePeso !== null ? `PHP ${entry.valuePeso.toLocaleString('en-PH')}` : 'Not calculated'} (${entry.formula})`),
    '',
    'METHODOLOGY',
    report.methodology,
    '',
    'DATA COVERAGE',
    `Records without amount: ${report.coverage.recordsWithoutAmount}; without source: ${report.coverage.recordsWithoutSource}; without period: ${report.coverage.recordsWithoutPeriod}.`,
    '',
    'SOURCES',
    ...report.sources.slice(0, 20).map((source) => `${source.institution || 'Institution unavailable'} — ${source.title || 'Document unavailable'}${source.url ? ` (${source.url})` : ''}`),
    '',
    ...report.disclaimers,
  ]
  return lines
}

/* -------------------------------- Public -------------------------------- */

export const reportsPublicRouter = Router()

reportsPublicRouter.get(
  '/transparency/reports/templates',
  asyncHandler(async (_req, res) => {
    ensureReportTemplatesSeeded()
    res.json({
      templates: all(`SELECT slug, title, description, sections, default_filters FROM report_templates WHERE active = 1 ORDER BY id`).map((row) => ({
        slug: row.slug,
        title: row.title,
        description: row.description,
        sections: (() => { try { return JSON.parse(row.sections) } catch { return [] } })(),
        defaultFilters: (() => { try { return JSON.parse(row.default_filters) } catch { return {} } })(),
        officialGovernmentPublication: false,
      })),
      sections: REPORT_SECTIONS.map(([key, label]) => ({ key, label })),
      modules: RECORD_TYPES,
      amountKinds: AMOUNT_KINDS,
      note: 'Templates select published records only. BetterGo-generated reports are not official government publications.',
    })
  }),
)

reportsPublicRouter.get(
  '/transparency/reports/methodology',
  asyncHandler(async (_req, res) => {
    res.json({
      terminology: [
        ['Proposed budget', 'A proposal; it is not an appropriation.'],
        ['Approved budget', 'An appropriation authorised for the period; not proof of spending.'],
        ['Allotment', 'Authority to obligate funds, separate from an appropriation.'],
        ['Obligation', 'A commitment to pay, separate from a disbursement.'],
        ['Disbursement', 'A payment or release of funds; the accounting basis determines whether it equals actual expenditure.'],
        ['Actual expenditure', 'Expenditure recorded as actual in the source document.'],
        ['Assessment', 'An amount assessed, not necessarily collected.'],
        ['Actual collection', 'Revenue recorded as received.'],
        ['Contract amount', 'An awarded contract value, not an actual payment.'],
      ],
      formulas: [
        'Totals sum one amount classification only.',
        'Budget utilization = actual expenditure ÷ approved budget × 100, only with a positive denominator.',
        'Growth compares two years of the same entity and category with published actual records.',
      ],
      limitations: 'Reports depend on the completeness and accuracy of published source documents. Missing data is not converted to zero. Derived values are informational and are not official statistics.',
      disclaimer: 'BetterGo Marinduque is an independent civic technology platform, not an official government reporting or accounting system.',
    })
  }),
)

reportsPublicRouter.post(
  '/transparency/reports/preview',
  rateLimit({ windowMs: 60 * 1000, max: 20 }),
  validate(z.object({ filters: filterSchema, sections: z.array(z.enum(REPORT_SECTIONS.map(([key]) => key))).min(1).max(REPORT_SECTIONS.length) })),
  asyncHandler(async (req, res) => {
    const report = buildReport(req.body.filters, req.body.sections, req.user || null)
    res.setHeader('Cache-Control', 'no-store')
    res.json({ report })
  }),
)

reportsPublicRouter.get(
  '/transparency/reports/shared/:token',
  asyncHandler(async (req, res) => {
    const config = get(`SELECT * FROM report_configs WHERE public_id = ? AND shared = 1`, [String(req.params.token)])
    if (!config) throw notFound('Shared report not found.')
    const report = buildReport(JSON.parse(config.filters || '{}'), JSON.parse(config.sections || '[]'))
    const generation = get(`SELECT generated_at, row_count, source_versions FROM report_generations WHERE config_id = ? ORDER BY id DESC LIMIT 1`, [config.id])
    res.json({
      report: { ...report, title: config.title, description: config.description, publicId: config.public_id, configVersion: config.version, lastGeneratedAt: generation?.generated_at || null, mayNeedRegeneration: Boolean(generation && report.freshness.latestSourceRecordUpdate && generation.generated_at < report.freshness.latestSourceRecordUpdate) },
      note: 'This shared configuration opens published records only. No account information is exposed.',
    })
  }),
)

/* ------------------------------ Saved reports --------------------------- */

export const reportsAccountRouter = Router()
reportsAccountRouter.use('/transparency/reports', requireAuth)

function shapeConfig(row) {
  return {
    id: row.id,
    publicId: row.public_id,
    title: row.title,
    description: row.description,
    templateSlug: row.template_slug,
    filters: JSON.parse(row.filters || '{}'),
    sections: JSON.parse(row.sections || '[]'),
    version: row.version,
    shared: Boolean(row.shared),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastGeneratedAt: row.last_generated_at,
    shareUrl: row.shared ? `/transparency/reports/shared/${row.public_id}` : null,
  }
}

reportsAccountRouter.post(
  '/transparency/reports/save',
  validate(configBody),
  asyncHandler(async (req, res) => {
    const count = Number(get(`SELECT COUNT(*) AS n FROM report_configs WHERE user_id = ?`, [req.user.id]).n)
    if (count >= 50) throw unprocessable('You can keep up to 50 saved report configurations. Remove one before saving another.')
    const id = Number(run(
      `INSERT INTO report_configs (public_id, user_id, title, description, template_slug, filters, sections, shared) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [publicId(), req.user.id, cleanText(req.body.title, 160), cleanText(req.body.description, 1000), cleanText(req.body.templateSlug, 80), JSON.stringify(req.body.filters), JSON.stringify(req.body.sections), req.body.shared ? 1 : 0],
    ).lastInsertRowid)
    logAudit(req, { action: 'transparency.report_saved', module: 'transparency', entityType: 'report_config', entityId: id })
    res.status(201).json({ message: 'Report configuration saved. It can only select published records.', config: shapeConfig(get(`SELECT * FROM report_configs WHERE id = ?`, [id])) })
  }),
)

reportsAccountRouter.get(
  '/transparency/reports/saved',
  asyncHandler(async (req, res) => {
    const configs = all(`SELECT * FROM report_configs WHERE user_id = ? ORDER BY updated_at DESC`, [req.user.id]).map(shapeConfig)
    for (const config of configs) {
      const report = buildReport(config.filters, config.sections)
      config.mayNeedRegeneration = Boolean(config.lastGeneratedAt && report.freshness.latestSourceRecordUpdate && config.lastGeneratedAt < report.freshness.latestSourceRecordUpdate)
    }
    res.json({ results: configs, total: configs.length })
  }),
)

reportsAccountRouter.get(
  '/transparency/reports/saved/:publicId',
  asyncHandler(async (req, res) => {
    const config = get(`SELECT * FROM report_configs WHERE public_id = ? AND user_id = ?`, [String(req.params.publicId), req.user.id])
    if (!config) throw notFound('Saved report not found.')
    res.json({ config: shapeConfig(config) })
  }),
)

reportsAccountRouter.patch(
  '/transparency/reports/saved/:publicId',
  validate(configBody.partial({ title: true, filters: true, sections: true })),
  asyncHandler(async (req, res) => {
    const config = get(`SELECT * FROM report_configs WHERE public_id = ? AND user_id = ?`, [String(req.params.publicId), req.user.id])
    if (!config) throw notFound('Saved report not found.')
    const body = req.body
    run(
      `UPDATE report_configs SET title = ?, description = ?, template_slug = ?, filters = ?, sections = ?, shared = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      [
        cleanText(body.title, 160) || config.title,
        body.description === undefined ? config.description : cleanText(body.description, 1000),
        body.templateSlug === undefined ? config.template_slug : cleanText(body.templateSlug, 80),
        JSON.stringify(body.filters || JSON.parse(config.filters || '{}')),
        JSON.stringify(body.sections || JSON.parse(config.sections || '[]')),
        body.shared === undefined ? config.shared : body.shared ? 1 : 0,
        nowIso(),
        config.id,
      ],
    )
    logAudit(req, { action: 'transparency.report_updated', module: 'transparency', entityType: 'report_config', entityId: config.id })
    res.json({ message: 'Saved report updated. The underlying financial records were not changed.', config: shapeConfig(get(`SELECT * FROM report_configs WHERE id = ?`, [config.id])) })
  }),
)

reportsAccountRouter.delete(
  '/transparency/reports/saved/:publicId',
  asyncHandler(async (req, res) => {
    const config = get(`SELECT * FROM report_configs WHERE public_id = ? AND user_id = ?`, [String(req.params.publicId), req.user.id])
    if (!config) throw notFound('Saved report not found.')
    run(`DELETE FROM report_configs WHERE id = ?`, [config.id])
    logAudit(req, { action: 'transparency.report_deleted', module: 'transparency', entityType: 'report_config', entityId: config.id })
    res.json({ message: 'Saved report configuration removed.' })
  }),
)

reportsAccountRouter.post(
  '/transparency/reports/saved/:publicId/generate',
  asyncHandler(async (req, res) => {
    const config = get(`SELECT * FROM report_configs WHERE public_id = ? AND user_id = ?`, [String(req.params.publicId), req.user.id])
    if (!config) throw notFound('Saved report not found.')
    const report = buildReport(JSON.parse(config.filters || '{}'), JSON.parse(config.sections || '[]'), req.user)
    const generationId = Number(run(
      `INSERT INTO report_generations (config_id, public_id, generated_at, source_versions, row_count, snapshot_hash, payload, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [config.id, config.public_id, report.generatedAt, JSON.stringify(report.freshness.sourceRecordVersions), report.counts.records, report.freshness.snapshotHash, JSON.stringify({ totals: report.totals, calculations: report.calculations }), req.user.id],
    ).lastInsertRowid)
    run(`UPDATE report_configs SET last_generated_at = ? WHERE id = ?`, [report.generatedAt, config.id])
    logAudit(req, { action: 'transparency.report_generated', module: 'transparency', entityType: 'report_generation', entityId: generationId })
    res.status(201).json({ message: `Report regenerated from ${report.counts.records} published record(s).`, generationId, report })
  }),
)

reportsAccountRouter.get(
  '/transparency/reports/saved/:publicId/export',
  rateLimit({ windowMs: 60 * 1000, max: 12 }),
  asyncHandler(async (req, res) => {
    const format = ['csv', 'xlsx', 'json', 'pdf'].includes(String(req.query.format)) ? String(req.query.format) : 'csv'
    const config = get(`SELECT * FROM report_configs WHERE public_id = ? AND user_id = ?`, [String(req.params.publicId), req.user.id])
    if (!config) throw notFound('Saved report not found.')
    const report = buildReport(JSON.parse(config.filters || '{}'), JSON.parse(config.sections || '[]'), req.user)
    const rows = exportRows(report)
    const columns = reportColumns()
    sendExport(res, { format, filename: `bettergo-report-${config.public_id}`, columns, rows, lines: [...pdfLines(report), '', `Report configuration: ${config.public_id} v${config.version}`] })
    run(`INSERT INTO report_export_events (public_id, format, row_count, byte_size, user_id) VALUES (?, ?, ?, ?, ?)`, [config.public_id, format, rows.length, 0, req.user.id])
    logAudit(req, { action: 'transparency.report_exported', module: 'transparency', entityType: 'report_config', entityId: config.id, detail: format })
  }),
)

/* --------------------------------- Admin -------------------------------- */

export const reportsAdminRouter = Router()
reportsAdminRouter.use(requireAuth, requireAdmin)

reportsAdminRouter.get(
  '/transparency/reports',
  requirePermission('transparency.view'),
  asyncHandler(async (_req, res) => {
    ensureReportTemplatesSeeded()
    const configs = all(
      `SELECT c.*, u.name AS owner_name FROM report_configs c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.updated_at DESC LIMIT 100`,
    ).map((row) => ({ ...shapeConfig(row), owner: row.owner_name, ownerEmailExposed: false }))
    res.json({
      templates: all(`SELECT * FROM report_templates ORDER BY id`),
      configs,
      exports: all(`SELECT public_id, format, row_count, created_at FROM report_export_events ORDER BY id DESC LIMIT 50`),
      generations: all(`SELECT public_id, generated_at, row_count, snapshot_hash FROM report_generations ORDER BY id DESC LIMIT 50`),
      sections: REPORT_SECTIONS.map(([key, label]) => ({ key, label })),
      note: 'Administrators review shared configurations and export activity. They cannot alter the underlying published records from this screen. BetterGo reports are not official government publications.',
    })
  }),
)

reportsAdminRouter.patch(
  '/transparency/reports/templates/:slug',
  requirePermission('transparency.documents.manage'),
  validate(z.object({ active: z.boolean().optional(), description: z.string().trim().max(600).optional() })),
  asyncHandler(async (req, res) => {
    const template = get(`SELECT * FROM report_templates WHERE slug = ?`, [String(req.params.slug)])
    if (!template) throw notFound('Template not found.')
    run(`UPDATE report_templates SET active = ?, description = ?, updated_at = ? WHERE id = ?`, [
      req.body.active === undefined ? template.active : req.body.active ? 1 : 0,
      cleanText(req.body.description, 600) || template.description,
      nowIso(),
      template.id,
    ])
    logAudit(req, { action: 'transparency.report_template_updated', module: 'transparency', entityType: 'report_template', entityId: template.id })
    res.json({ message: 'Template updated.', template: get(`SELECT * FROM report_templates WHERE id = ?`, [template.id]) })
  }),
)

reportsAdminRouter.patch(
  '/transparency/reports/configs/:publicId',
  requirePermission('transparency.data.approve'),
  validate(z.object({ shared: z.boolean() })),
  asyncHandler(async (req, res) => {
    const config = get(`SELECT * FROM report_configs WHERE public_id = ?`, [String(req.params.publicId)])
    if (!config) throw notFound('Report configuration not found.')
    run(`UPDATE report_configs SET shared = ?, updated_at = ? WHERE id = ?`, [req.body.shared ? 1 : 0, nowIso(), config.id])
    logAudit(req, { action: 'transparency.report_sharing_reviewed', module: 'transparency', entityType: 'report_config', entityId: config.id })
    res.json({ message: req.body.shared ? 'Report sharing enabled; it still opens published records only.' : 'Public sharing disabled.', config: shapeConfig(get(`SELECT * FROM report_configs WHERE id = ?`, [config.id])) })
  }),
)

