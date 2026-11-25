/**
 * Prompt 110 — financial data-quality and accountability monitoring.
 *
 * Findings describe documentation and data-consistency conditions only. They
 * are never corruption scores, fraud determinations or COA conclusions. Only
 * human-approved findings are public, and citizen observations never expose
 * the submitter.
 */
import { Router } from 'express'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit, requireAuth } from '../auth.js'
import { canUseMunicipality, ctx, requireAdmin, requirePermission } from '../rbac.js'
import { asyncHandler, cleanText, forbidden, notFound, pagination, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { publishTransparencyEvent } from '../lib/transparency-alerts.js'
import { sendExport } from '../lib/exporters.js'
import { RECORD_TYPES } from './finance.js'


export const SEVERITIES = ['informational', 'low', 'medium', 'high', 'critical']
export const REVIEW_STATUSES = ['new', 'assigned', 'under_review', 'approved', 'published', 'resolved', 'dismissed']
export const ISSUE_LABELS = {
  missing_source: 'Supporting document unavailable',
  missing_period: 'Record requires verification',
  duplicate_record: 'Duplicate record suspected',
  classification_review: 'Classification requires review',
  calculation_review: 'Calculation requires review',
  budget_over_expenditure: 'Data discrepancy identified',
  allotment_obligation: 'Data discrepancy identified',
  obligation_disbursement: 'Data discrepancy identified',
  procurement_documentation: 'Record requires verification',
  version_conflict: 'Record requires verification',
  entity_association: 'Data discrepancy identified',
  revenue_classification: 'Classification requires review',
}
const reference = (prefix) => `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`
const severityLabel = (value) => ({ informational: 'Informational', low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical data integrity issue' }[value] || value)
const entityName = (row) => (row.government_level === 'provincial' ? 'Provincial Government of Marinduque' : row.municipality_name || 'Municipality')

function shape(row) {
  return {
    id: row.id,
    reference: row.reference,
    ruleKey: row.rule_key,
    issueCode: row.issue_code,
    label: ISSUE_LABELS[row.issue_code] || 'Record requires verification',
    description: row.description,
    module: row.module,
    moduleLabel: RECORD_TYPES[row.module] || row.module,
    recordReference: row.record_reference,
    entity: { level: row.entity_level, municipalityId: row.municipality_id, name: row.municipality_name || (row.entity_level === 'provincial' ? 'Provincial Government of Marinduque' : null), slug: row.municipality_slug || (row.entity_level === 'provincial' ? 'provincial' : null) },
    periodLabel: row.period_label,
    fiscalYear: row.fiscal_year,
    severity: row.severity,
    severityLabel: severityLabel(row.severity),
    detectionDate: row.detection_date,
    methodology: row.methodology,
    sourceReferences: (() => { try { return JSON.parse(row.source_references || '[]') } catch { return [] } })(),
    reviewStatus: row.review_status,
    assignedTo: row.assigned_to,
    resolutionNotes: row.resolution_notes,
    approvedAt: row.approved_at,
    publishedAt: row.published_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const BASE = `SELECT f.*, m.name AS municipality_name, m.slug AS municipality_slug
  FROM monitoring_findings f LEFT JOIN municipalities m ON m.id = f.municipality_id`

function scope(req, alias = 'f') {
  const context = ctx(req)
  if (context.hasGlobalScope) return { sql: '', params: [] }
  const ids = context.municipalityIds || []
  if (!ids.length) return { sql: ' AND 0', params: [] }
  return { sql: ` AND ${alias}.municipality_id IN (${ids.map(() => '?').join(',')})`, params: ids }
}

function canManage(req, row) {
  const context = ctx(req)
  if (context.hasGlobalScope) return true
  return Boolean(row.municipality_id && canUseMunicipality(context, row.municipality_id))
}

function money(cents) {
  if (cents === null || cents === undefined) return 'unavailable'
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(cents) / 100)
}

/* ------------------------------- Rule engine ----------------------------- */

function recordRows() {
  return all(
    `SELECT f.*, m.name AS municipality_name, m.slug AS municipality_slug
     FROM financial_records f LEFT JOIN municipalities m ON m.id = f.municipality_id
     WHERE f.publication_status = 'published' ORDER BY f.id`,
  )
}

function ensureFinding({ rule, record, issueCode, description, methodology }) {
  const existing = get(
    `SELECT id FROM monitoring_findings WHERE rule_key = ? AND COALESCE(record_reference, '') = ? AND entity_level = ?
       AND COALESCE(municipality_id, -1) = ? AND issue_code = ?`,
    [rule.key, record.reference || '', record.government_level, record.municipality_id ?? -1, issueCode],
  )
  if (existing) return { created: false, id: existing.id }
  const id = Number(
    run(
      `INSERT INTO monitoring_findings (reference, rule_key, record_reference, entity_level, municipality_id, module, issue_code,
        description, period_label, fiscal_year, methodology, source_references, detection_date, severity, review_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
      [
        reference('BG-MON'),
        rule.key,
        record.reference,
        record.government_level,
        record.municipality_id ?? null,
        record.record_type,
        issueCode,
        description,
        record.period_label,
        record.fiscal_year,
        methodology,
        JSON.stringify([record.source_title, record.source_url].filter(Boolean)),
        nowIso(),
        rule.severity,
      ],
    ).lastInsertRowid,
  )
  return { created: true, id }
}

const COMPATIBLE = {
  budget: ['proposed', 'approved', 'adjusted', 'allotment', 'obligation', 'disbursement', 'actual'],
  revenue: ['assessed', 'actual', 'proposed'],
  expenditure: ['approved', 'adjusted', 'allotment', 'obligation', 'disbursement', 'actual'],
  procurement: ['contract', 'approved', 'actual', 'obligation', 'disbursement'],
  project: ['approved', 'adjusted', 'contract', 'disbursement', 'actual'],
  aip: ['proposed', 'approved', 'adjusted'],
  financial_report: ['actual', 'approved', 'balance'],
  audit_report: ['actual', 'valuation'],
  grant: ['approved', 'actual', 'disbursement', 'obligation'],
  asset: ['valuation', 'balance'],
  loan: ['balance', 'approved', 'actual'],
  ppp: ['contract', 'approved', 'actual'],
  payroll: ['approved', 'actual', 'disbursement'],
  tax: ['assessed', 'actual'],
  land: ['valuation', 'contract', 'actual'],
  utility: ['contract', 'approved', 'actual', 'disbursement'],
  donation: ['actual', 'approved', 'valuation'],
}

export function runMonitoring(req, { ruleKey } = {}) {
  const startedAt = nowIso()
  const rules = all(`SELECT * FROM monitoring_rules WHERE active = 1 ${ruleKey ? 'AND key = ?' : ''} ORDER BY id`, ruleKey ? [ruleKey] : [])
  const records = recordRows()
  let created = 0
  let updated = 0
  const results = []

  for (const rule of rules) {
    let hits = 0
    const add = (record, issueCode, description, methodology = rule.description) => {
      const result = ensureFinding({ rule, record, issueCode, description, methodology })
      if (result.created) created += 1
      else updated += 1
      hits += 1
    }
    if (rule.key === 'missing_source') {
      for (const record of records) if (!record.source_institution || !record.source_title) {
        add(record, 'missing_source', `The published ${RECORD_TYPES[record.record_type] || record.record_type} record "${record.title}" does not name both a source institution and an original document title.`, 'Published records are checked for the presence of source institution and source title fields. No judgement is made about the record value.')
      }
    } else if (rule.key === 'missing_period') {
      for (const record of records) if (!record.fiscal_year || !record.period_label) {
        add(record, 'missing_period', `The published record "${record.title}" has no complete reporting period.`)
      }
    } else if (rule.key === 'duplicate_record') {
      const groups = new Map()
      for (const record of records) {
        const key = [record.record_type, record.government_level, record.municipality_id ?? -1, record.fiscal_year, record.period_label, record.category_key || record.financial_category, record.amount_kind, record.amount_cents, record.department_name || ''].join('|')
        groups.set(key, [...(groups.get(key) || []), record])
      }
      for (const group of groups.values()) if (group.length > 1) for (const record of group) {
        add(record, 'duplicate_record', `More than one published record shares the same type, entity, period, category, amount classification, amount and department. This may be a legitimate separate entry; a reviewer decides.`)
      }
    } else if (rule.key === 'classification_review') {
      for (const record of records) {
        const allowed = COMPATIBLE[record.record_type] || []
        if (allowed.length && !allowed.includes(record.amount_kind)) {
          add(record, 'classification_review', `The amount classification "${record.amount_kind}" is not usual for a ${RECORD_TYPES[record.record_type] || record.record_type} record. Confirm that the official source uses this classification.`)
        }
      }
    } else if (rule.key === 'calculation_review') {
      for (const record of records) {
        const problems = []
        if (record.amount_cents !== null && record.amount_cents < 0 && record.amount_kind !== 'adjusted') problems.push('a negative amount outside an adjustment')
        if (record.interest_rate !== null && record.interest_rate > 100) problems.push('an interest rate above 100%')
        if (record.outstanding_balance_cents !== null && record.principal_cents !== null && record.outstanding_balance_cents > record.principal_cents) problems.push('an outstanding balance above the recorded principal')
        if (record.term_start && record.term_end && record.term_end < record.term_start) problems.push('an end date before the start date')
        if (record.period_start && record.period_end && record.period_end < record.period_start) problems.push('a reporting period that ends before it starts')
        if (problems.length) add(record, 'calculation_review', `The published record "${record.title}" has ${problems.join('; ')}. The original document should be checked before relying on the value.`, 'Internal arithmetic and date-order checks only; the source document is not modified.')
      }
    } else if (rule.key === 'version_conflict') {
      for (const record of records) if (!record.verified_at || !['verified', 'archived'].includes(record.verification_status || '')) {
        add(record, 'version_conflict', `The record "${record.title}" is published but its verification timestamp or verification status is incomplete.`)
      }
    } else if (rule.key === 'entity_association') {
      for (const record of records) {
        if (record.government_level === 'municipal' && !record.municipality_id) add(record, 'entity_association', `The municipal record "${record.title}" is not associated with a municipality.`)
        if (record.government_level === 'provincial' && record.municipality_id) add(record, 'entity_association', `The provincial record "${record.title}" is associated with a municipality.`)
      }
    } else if (rule.key === 'procurement_documentation') {
      for (const record of records.filter((row) => row.record_type === 'procurement')) {
        if (!record.identifier || !record.stage) add(record, 'procurement_documentation', `The procurement record "${record.title}" does not include both a contract or award reference and a lifecycle stage.`)
      }
    } else if (rule.key === 'revenue_classification') {
      for (const record of records.filter((row) => row.record_type === 'revenue')) {
        if (!['assessed', 'actual'].includes(record.amount_kind)) add(record, 'revenue_classification', `The revenue record "${record.title}" uses "${record.amount_kind}" instead of an assessment or actual collection. Keep estimates, assessments and collections separate.`)
      }
    } else if (['budget_over_expenditure', 'allotment_obligation', 'obligation_disbursement'].includes(rule.key)) {
      const groups = new Map()
      for (const record of records) {
        if (!record.fiscal_year) continue
        const key = [record.government_level, record.municipality_id ?? -1, record.fiscal_year, record.category_key || record.financial_category || 'uncategorised'].join('|')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(record)
      }
      for (const group of groups.values()) {
        const sum = (kind) => group.filter((row) => row.amount_kind === kind).reduce((total, row) => total + Number(row.amount_cents || 0), 0)
        const check = (baseKind, compareKind, issue, message) => {
          const base = sum(baseKind)
          const compare = sum(compareKind)
          if (base > 0 && compare > base) {
            const sample = group.find((row) => row.amount_kind === compareKind)
            add(sample, issue, `${message} Recorded ${compareKind} ${money(compare)} exceeds recorded ${baseKind} ${money(base)} for the same entity, fiscal year and category. Differences can have documented explanations; this is a review prompt, not a finding of wrongdoing.`, 'Only published records with the same entity, fiscal year and category are compared. Different accounting stages are not added together.')
          }
        }
        if (rule.key === 'budget_over_expenditure') check('approved', 'actual', 'budget_over_expenditure', 'Actual expenditure exceeds the approved budget for a comparable scope.')
        if (rule.key === 'allotment_obligation') check('allotment', 'obligation', 'allotment_obligation', 'Obligations exceed allotments for a comparable scope.')
        if (rule.key === 'obligation_disbursement') check('obligation', 'disbursement', 'obligation_disbursement', 'Disbursements exceed obligations for a comparable scope.')
      }
    }
    results.push({ rule: rule.key, hits })
  }

  const runId = Number(
    run(
      `INSERT INTO monitoring_runs (rule_key, started_at, finished_at, records_checked, findings_created, findings_updated, triggered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ruleKey || null, startedAt, nowIso(), records.length, created, updated, req?.user?.id ?? null],
    ).lastInsertRowid,
  )
  return { runId, recordsChecked: records.length, created, updated, results, note: 'Rule results are data-quality prompts for human review. They are not public until a reviewer approves them.' }
}

/* -------------------------------- Public -------------------------------- */

export const monitoringPublicRouter = Router()

monitoringPublicRouter.get(
  '/transparency/financial-monitoring/overview',
  asyncHandler(async (_req, res) => {
    const published = all(`${BASE} WHERE f.review_status = 'published' ORDER BY f.severity, f.detection_date DESC`)
    const entities = all(`SELECT id, name, slug FROM municipalities WHERE is_active = 1 ORDER BY sort_order, name`)
    const count = (severity) => published.filter((row) => row.severity === severity).length
    res.json({
      totals: {
        published: published.length,
        open: published.filter((row) => !row.resolved_at).length,
        resolved: published.filter((row) => row.resolved_at).length,
        bySeverity: Object.fromEntries(SEVERITIES.map((severity) => [severity, count(severity)])),
      },
      entities: [{ id: null, name: 'Provincial Government of Marinduque', slug: 'provincial' }, ...entities].map((entity) => ({
        ...entity,
        findings: published.filter((row) => (entity.id === null ? row.entity_level === 'provincial' : row.municipality_id === entity.id)).length,
      })),
      recent: published.slice(0, 12).map(shape),
      methodology: 'Automated checks compare published records for missing documentation, duplicate entries, classification, arithmetic consistency and comparable-period differences. Every result is reviewed by a person before publication. A condition is not proof of an error, fraud or legal violation.',
      note: 'BetterGo Marinduque is an independent civic technology platform. These are informational data-quality observations, not official COA findings, corruption scores or legal conclusions.',
    })
  }),
)

monitoringPublicRouter.get(
  '/transparency/financial-monitoring/findings',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query)
    const clauses = [`f.review_status = 'published'`]
    const params = []
    if (req.query.municipality) { clauses.push('m.slug = ?'); params.push(String(req.query.municipality)) }
    if (req.query.entity === 'provincial') clauses.push(`f.entity_level = 'provincial'`)
    if (req.query.severity && SEVERITIES.includes(String(req.query.severity))) { clauses.push('f.severity = ?'); params.push(String(req.query.severity)) }
    if (req.query.module && RECORD_TYPES[req.query.module]) { clauses.push('f.module = ?'); params.push(String(req.query.module)) }
    if (req.query.status === 'open') clauses.push('f.resolved_at IS NULL')
    if (req.query.status === 'resolved') clauses.push('f.resolved_at IS NOT NULL')
    if (req.query.q) { clauses.push('(f.description LIKE ? OR f.record_reference LIKE ?)'); params.push(`%${String(req.query.q).slice(0, 100)}%`, `%${String(req.query.q).slice(0, 100)}%`) }
    const where = `WHERE ${clauses.join(' AND ')}`
    const rows = all(`${BASE} ${where} ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, f.detection_date DESC LIMIT ? OFFSET ?`, [...params, limit, offset])
    const total = Number(get(`SELECT COUNT(*) AS n FROM monitoring_findings f LEFT JOIN municipalities m ON m.id = f.municipality_id ${where}`, params).n)
    res.json({
      results: rows.map(shape), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)),
      severities: SEVERITIES,
      note: 'Only approved, explainable data-quality observations appear here. Unverified submissions and reviewer notes remain private.',
    })
  }),
)

monitoringPublicRouter.get(
  '/transparency/financial-monitoring/analytics',
  asyncHandler(async (_req, res) => {
    const rows = all(`${BASE} WHERE f.review_status = 'published' ORDER BY f.detection_date DESC`)
    const approved = rows.filter((row) => row.approved_at)
    const reviewHours = approved.filter((row) => row.detection_date).map((row) => (new Date(row.approved_at) - new Date(row.detection_date)) / 3600000)
    const averageReviewHours = reviewHours.length ? Number((reviewHours.reduce((total, value) => total + value, 0) / reviewHours.length).toFixed(1)) : null
    const byCategory = new Map()
    const byEntity = new Map()
    const byMonth = new Map()
    for (const row of rows) {
      byCategory.set(row.issue_code, (byCategory.get(row.issue_code) || 0) + 1)
      const entity = row.municipality_name || (row.entity_level === 'provincial' ? 'Provincial Government of Marinduque' : 'Unavailable entity')
      byEntity.set(entity, (byEntity.get(entity) || 0) + 1)
      const month = String(row.detection_date).slice(0, 7)
      byMonth.set(month, (byMonth.get(month) || 0) + 1)
    }
    res.json({
      totals: { published: rows.length, open: rows.filter((row) => !row.resolved_at).length, resolved: rows.filter((row) => row.resolved_at).length },
      byCategory: [...byCategory].map(([key, count]) => ({ key, label: ISSUE_LABELS[key] || 'Record requires verification', count })),
      byEntity: [...byEntity].map(([name, count]) => ({ name, count })),
      byMonth: [...byMonth].sort().map(([month, count]) => ({ month, count })),
      averageReviewHours,
      averageReviewNote: averageReviewHours === null ? 'Not calculated: no published finding has both valid detection and approval timestamps.' : 'Only findings with both detection and approval timestamps are included.',
      note: 'Counts measure platform-detected data-quality conditions, not corruption, legal compliance or institutional performance.',
    })
  }),
)

monitoringPublicRouter.get(
  '/transparency/financial-monitoring/findings/export',
  rateLimit({ windowMs: 60 * 1000, max: 20 }),
  asyncHandler(async (req, res) => {
    const format = ['csv', 'xlsx', 'json', 'pdf'].includes(String(req.query.format)) ? String(req.query.format) : 'csv'
    const rows = all(`${BASE} WHERE f.review_status = 'published' ORDER BY f.detection_date DESC`).map(shape)
    const exportRows = rows.map((row) => ({
      reference: row.reference, label: row.label, description: row.description, recordReference: row.recordReference,
      entity: row.entity.name || '', period: row.periodLabel, severity: row.severity, detected: row.detectionDate,
      status: row.resolvedAt ? 'Resolved documentation issue' : 'Reviewed and published', methodology: row.methodology,
    }))
    const columns = [
      { key: 'reference', label: 'Finding reference' }, { key: 'label', label: 'Neutral label' }, { key: 'description', label: 'Description' },
      { key: 'recordReference', label: 'Record reference' }, { key: 'entity', label: 'Government entity' }, { key: 'period', label: 'Period' },
      { key: 'severity', label: 'Severity' }, { key: 'detected', label: 'Detection date' }, { key: 'status', label: 'Review status' }, { key: 'methodology', label: 'Methodology' },
    ]
    sendExport(res, {
      format,
      filename: 'bettergo-data-quality-findings',
      columns,
      rows: exportRows,
      lines: ['BetterGo Marinduque — approved data-quality observations', `Generated: ${nowIso()}`, 'These are informational observations, not COA findings, corruption scores or legal conclusions.', '', ...exportRows.map((row) => `${row.reference} | ${row.label} | ${row.severity} | ${row.status}`)],
    })
  }),
)

monitoringPublicRouter.get(
  '/transparency/financial-monitoring/methodology',
  asyncHandler(async (_req, res) => {
    res.json({
      principles: [
        'Only published, source-referenced financial records are checked.',
        'A difference is a review prompt; it does not by itself indicate an error, fraud or legal violation.',
        'Severity describes the documentation or data-integrity condition, never the presumed seriousness of wrongdoing.',
        'No corruption score, guilt rating or person-level allegation is produced.',
        'A human reviewer must approve a finding before it becomes public.',
        'BetterGo observations are not official COA findings.',
      ],
      checks: all(`SELECT key, name, description, module, severity FROM monitoring_rules WHERE active = 1 ORDER BY id`).map((row) => ({ ...row, severityLabel: severityLabel(row.severity) })),
      reviewSteps: ['Detected by a rule', 'Assigned to a reviewer', 'Compared with the source document', 'Explanation or correction recorded', 'Approved for publication', 'Resolved when documented'],
      dataProtection: 'Citizen observation submitters are not identified publicly. Only the record, description and public source link are considered for review.',
    })
  }),
)

monitoringPublicRouter.get(
  '/transparency/financial-monitoring/entities/:slug',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug)
    const entity = slug === 'provincial'
      ? { id: null, name: 'Provincial Government of Marinduque', slug: 'provincial' }
      : get(`SELECT id, name, slug FROM municipalities WHERE slug = ? AND is_active = 1`, [slug])
    if (!entity) throw notFound('Government entity not found.')
    const clause = entity.id === null ? `f.entity_level = 'provincial'` : 'f.municipality_id = ?'
    const params = entity.id === null ? [] : [entity.id]
    const findings = all(`${BASE} WHERE f.review_status = 'published' AND ${clause} ORDER BY f.detection_date DESC`, params)
    const recordCount = Number(get(
      `SELECT COUNT(*) AS n FROM financial_records WHERE publication_status = 'published' AND ${entity.id === null ? `government_level = 'provincial'` : 'municipality_id = ?'}`,
      entity.id === null ? [] : [entity.id],
    ).n)
    res.json({
      entity,
      publishedRecords: recordCount,
      totals: { findings: findings.length, open: findings.filter((row) => !row.resolved_at).length, resolved: findings.filter((row) => row.resolved_at).length },
      findings: findings.map(shape),
      note: recordCount === 0 ? 'No verified financial record has been published for this entity yet. This is not a statement that no funds were received or spent.' : 'Counts describe platform-detected conditions in published records only.',
    })
  }),
)

monitoringPublicRouter.post(
  '/transparency/financial-monitoring/observations',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }),
  validate(z.object({
    recordReference: z.string().trim().min(3).max(60),
    description: z.string().trim().min(20).max(2000),
    sourceUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
  })),
  asyncHandler(async (req, res) => {
    const record = get(`SELECT reference FROM financial_records WHERE reference = ? AND publication_status = 'published'`, [req.body.recordReference])
    if (!record) throw unprocessable('Choose a published financial record. Unpublished records cannot be discussed here.')
    if (/(?:\+63|0)9\d{9}\b|\b\d{3}-\d{3}-\d{4}\b|\b[\w.+-]+@[\w-]+\.[\w.]+\b/.test(req.body.description)) {
      throw unprocessable('Remove personal contact details from the observation. Public records only, please.')
    }
    const id = Number(run(
      `INSERT INTO monitoring_observations (reference, record_reference, description, source_url, submitter_id) VALUES (?, ?, ?, ?, ?)`,
      [reference('BG-OBS'), record.reference, cleanText(req.body.description, 2000), cleanText(req.body.sourceUrl, 500), req.user.id],
    ).lastInsertRowid)
    logAudit(req, { action: 'transparency.observation_submitted', module: 'transparency', entityType: 'monitoring_observation', entityId: id })
    res.status(201).json({
      message: 'Observation received for review. It does not establish that an error or violation occurred, and your identity is not published.',
      observation: { reference: get(`SELECT reference FROM monitoring_observations WHERE id = ?`, [id]).reference, status: 'pending' },
    })
  }),
)

monitoringPublicRouter.get(
  '/transparency/financial-monitoring/observations/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      results: all(`SELECT reference, record_reference, status, created_at, updated_at FROM monitoring_observations WHERE submitter_id = ? ORDER BY id DESC LIMIT 50`, [req.user.id]),
      note: 'Only your own submissions are listed. Reviewer notes remain private.',
    })
  }),
)

/* --------------------------------- Admin -------------------------------- */

export const monitoringAdminRouter = Router()
monitoringAdminRouter.use(requireAuth, requireAdmin)

monitoringAdminRouter.get(
  '/transparency/financial-monitoring',
  requirePermission('transparency.view'),
  asyncHandler(async (req, res) => {
    const scoped = scope(req)
    const findings = all(`${BASE} WHERE 1 = 1${scoped.sql} ORDER BY f.id DESC LIMIT 300`, scoped.params)
    const observations = all(
      `SELECT o.* FROM monitoring_observations o LEFT JOIN financial_records r ON r.reference = o.record_reference
       WHERE 1 = 1${ctx(req).hasGlobalScope ? '' : ' AND r.municipality_id IN (' + (ctx(req).municipalityIds.length ? ctx(req).municipalityIds.map(() => '?').join(',') : 'NULL') + ')'}
       ORDER BY o.id DESC LIMIT 100`,
      ctx(req).hasGlobalScope ? [] : ctx(req).municipalityIds,
    ).map((row) => ({ id: row.id, reference: row.reference, recordReference: row.record_reference, description: row.description, sourceUrl: row.source_url, status: row.status, reviewNote: row.review_note, submitted: row.created_at, submitter: row.submitter_id ? 'Authenticated submitter (identity restricted)' : 'Unknown' }))
    res.json({
      summary: {
        total: findings.length,
        new: findings.filter((row) => row.review_status === 'new').length,
        review: findings.filter((row) => ['assigned', 'under_review'].includes(row.review_status)).length,
        published: findings.filter((row) => row.review_status === 'published').length,
        resolved: findings.filter((row) => row.review_status === 'resolved').length,
      },
      findings: findings.map(shape),
      rules: all(`SELECT * FROM monitoring_rules ORDER BY id`),
      observations,
      runs: all(`SELECT * FROM monitoring_runs ORDER BY id DESC LIMIT 20`),
      reviewers: all(`SELECT DISTINCT u.id, u.name, u.email FROM users u JOIN user_role_assignments a ON a.user_id = u.id JOIN user_roles r ON r.id = a.role_id WHERE r.slug IN ('municipal_admin','provincial_admin','super_admin','municipal_reviewer') AND a.status = 'active' ORDER BY u.name`).map((row) => ({ id: row.id, name: row.name })),
      severities: SEVERITIES,
      statuses: REVIEW_STATUSES,
      note: 'Reviewer notes, citizen identities and unapproved findings are private. Publication requires explicit human approval.',
    })
  }),
)

monitoringAdminRouter.post(
  '/transparency/financial-monitoring/run',
  requirePermission('transparency.data.approve'),
  validate(z.object({ ruleKey: z.string().trim().max(80).optional().or(z.literal('')) })),
  asyncHandler(async (req, res) => {
    const result = runMonitoring(req, { ruleKey: req.body.ruleKey || undefined })
    logAudit(req, { action: 'transparency.monitoring_run', module: 'transparency', entityType: 'monitoring_run', entityId: result.runId })
    res.json({ message: `Checks finished: ${result.created} new review item(s), ${result.updated} already present.`, ...result })
  }),
)

monitoringAdminRouter.patch(
  '/transparency/financial-monitoring/rules/:id',
  requirePermission('transparency.data.approve'),
  validate(z.object({ active: z.boolean().optional(), severity: z.enum(SEVERITIES).optional(), description: z.string().trim().min(10).max(500).optional() })),
  asyncHandler(async (req, res) => {
    const rule = get(`SELECT * FROM monitoring_rules WHERE id = ?`, [Number(req.params.id)])
    if (!rule) throw notFound('Rule not found.')
    run(
      `UPDATE monitoring_rules SET active = ?, severity = ?, description = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      [req.body.active === undefined ? rule.active : (req.body.active ? 1 : 0), req.body.severity || rule.severity, cleanText(req.body.description, 500) || rule.description, nowIso(), rule.id],
    )
    logAudit(req, { action: 'transparency.rule_updated', module: 'transparency', entityType: 'monitoring_rule', entityId: rule.id })
    res.json({ message: 'Rule updated.', rule: get(`SELECT * FROM monitoring_rules WHERE id = ?`, [rule.id]) })
  }),
)

monitoringAdminRouter.patch(
  '/transparency/financial-monitoring/findings/:id',
  requirePermission('transparency.data.approve'),
  validate(z.object({
    action: z.enum(['assign', 'review', 'approve', 'publish', 'resolve', 'dismiss', 'reopen']),
    assignedTo: z.coerce.number().int().positive().nullable().optional(),
    note: z.string().trim().max(1500).optional().or(z.literal('')),
  })),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM monitoring_findings WHERE id = ?`, [Number(req.params.id)])
    if (!row || !canManage(req, row)) throw notFound('Finding not found.')
    const note = cleanText(req.body.note, 1500)
    const now = nowIso()
    const action = req.body.action
    const assignments = ['updated_at = ?']
    const params = [now]
    if (action === 'assign') {
      if (!req.body.assignedTo) throw unprocessable('Choose a reviewer to assign.')
      assignments.push('assigned_to = ?', `review_status = 'assigned'`)
      params.push(req.body.assignedTo)
    } else if (action === 'review') {
      assignments.push(`review_status = 'under_review'`)
    } else if (action === 'approve') {
      if (!note || note.length < 10) throw unprocessable('Record the verification explanation before approving.')
      assignments.push(`review_status = 'approved'`, 'approved_by = ?', 'approved_at = ?')
      params.push(req.user.id, now)
    } else if (action === 'publish') {
      if (!['approved', 'published'].includes(row.review_status)) throw unprocessable('Approve the finding before publishing it.')
      if (!row.description || !row.methodology) throw unprocessable('A public finding needs a description and methodology.')
      assignments.push(`review_status = 'published'`, 'published_at = ?')
      params.push(now)
    } else if (action === 'resolve') {
      if (!note || note.length < 5) throw unprocessable('Explain how the issue was resolved.')
      assignments.push(`review_status = 'resolved'`, 'resolved_at = ?', 'resolution_notes = ?')
      params.push(now, note)
    } else if (action === 'dismiss') {
      if (!note || note.length < 5) throw unprocessable('Record why this review item is not being published.')
      assignments.push(`review_status = 'dismissed'`, 'resolution_notes = ?')
      params.push(note)
    } else if (action === 'reopen') {
      assignments.push(`review_status = 'under_review'`, 'resolved_at = NULL')
    }
    run(`UPDATE monitoring_findings SET ${assignments.join(', ')} WHERE id = ?`, [...params, row.id])
    run(`INSERT INTO monitoring_finding_events (finding_id, action, note, actor_id) VALUES (?, ?, ?, ?)`, [row.id, action, note, req.user.id])
    logAudit(req, { action: `transparency.finding_${action}`, module: 'transparency', entityType: 'monitoring_finding', entityId: row.id, detail: note || undefined })
    if (action === 'publish') {
      publishTransparencyEvent({
        eventKey: `monitoring:${row.reference}:published`,
        eventType: 'monitoring_published',
        title: 'Approved data-quality observation published',
        summary: row.description,
        recordReference: row.record_reference,
        municipalityId: row.municipality_id,
        category: 'monitoring',
        periodLabel: row.period_label,
      })
    }
    res.json({ message: 'Review status updated.', finding: shape(get(`${BASE} WHERE f.id = ?`, [row.id])) })
  }),
)

monitoringAdminRouter.get(
  '/transparency/financial-monitoring/findings/:id/history',
  requirePermission('transparency.view'),
  asyncHandler(async (req, res) => {
    const row = get(`SELECT * FROM monitoring_findings WHERE id = ?`, [Number(req.params.id)])
    if (!row || !canManage(req, row)) throw notFound('Finding not found.')
    res.json({ history: all(`SELECT e.action, e.note, e.created_at, u.name AS actor FROM monitoring_finding_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.finding_id = ? ORDER BY e.id`, [row.id]) })
  }),
)

monitoringAdminRouter.patch(
  '/transparency/financial-monitoring/observations/:id',
  requirePermission('transparency.data.approve'),
  validate(z.object({ action: z.enum(['dismiss', 'link']), note: z.string().trim().min(5).max(1000) })),
  asyncHandler(async (req, res) => {
    const observation = get(`SELECT * FROM monitoring_observations WHERE id = ?`, [Number(req.params.id)])
    if (!observation) throw notFound('Observation not found.')
    if (req.body.action === 'link') {
      const record = get(`SELECT * FROM financial_records WHERE reference = ?`, [observation.record_reference])
      if (!record) throw unprocessable('The referenced record is no longer available.')
      if (!ctx(req).hasGlobalScope && !canUseMunicipality(ctx(req), record.municipality_id)) throw forbidden('That observation is outside your municipality scope.')
      const rule = get(`SELECT * FROM monitoring_rules WHERE key = 'missing_source'`) // a neutral existing rule; the finding text carries the observation
      const finding = ensureFinding({
        rule: { ...rule, severity: 'medium' },
        record,
        issueCode: 'entity_association',
        description: `A citizen observation about this record was accepted for review: ${cleanText(req.body.note, 900)}`,
        methodology: 'Submitted through the public observation form and reviewed by an administrator. It is not an automated conclusion.',
      })
      run(`UPDATE monitoring_observations SET status = 'linked', finding_id = ?, reviewed_by = ?, review_note = ?, updated_at = ? WHERE id = ?`, [finding.id, req.user.id, cleanText(req.body.note, 1000), nowIso(), observation.id])
      logAudit(req, { action: 'transparency.observation_linked', module: 'transparency', entityType: 'monitoring_observation', entityId: observation.id })
      return res.json({ message: 'Observation linked to a review item. It remains non-public until separately approved.', findingId: finding.id })
    }
    run(`UPDATE monitoring_observations SET status = 'dismissed', reviewed_by = ?, review_note = ?, updated_at = ? WHERE id = ?`, [req.user.id, cleanText(req.body.note, 1000), nowIso(), observation.id])
    logAudit(req, { action: 'transparency.observation_dismissed', module: 'transparency', entityType: 'monitoring_observation', entityId: observation.id })
    res.json({ message: 'Observation dismissed. The submitter identity remains private.' })
  }),
)

