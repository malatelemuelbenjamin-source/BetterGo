/**
 * Prompt 112 — public financial open-data repository.
 *
 * Datasets are metadata wrappers over the single published financial dataset;
 * no copy of government records is stored. Downloads and previews include only
 * published records, always preserve missing values, and never expose private
 * or unpublished fields. No licence is invented.
 */
import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIso, run } from '../db.js'
import { rateLimit } from '../auth.js'
import { canUseMunicipality, ctx, requireAdmin, requirePermission } from '../rbac.js'
import { asyncHandler, cleanText, forbidden, notFound, pagination, slugify, unprocessable } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { logAudit } from '../audit.js'
import { publishTransparencyEvent } from '../lib/transparency-alerts.js'
import { sendExport } from '../lib/exporters.js'
import { AMOUNT_KINDS, RECORD_TYPES, shapeRecord } from './finance.js'

export const OPEN_DATA_CATEGORIES = {
  budget: 'Government budgets',
  allocations: 'Department and program allocations',
  revenue: 'Government revenue',
  tax: 'Local tax collections',
  expenditure: 'Government expenditures',
  procurement: 'Procurement and bidding',
  contracts: 'Contracts and agreements',
  projects: 'Infrastructure projects',
  aip: 'Annual Investment Programs',
  financial_reports: 'Financial reports',
  audit: 'COA audit documents',
  grants: 'Government grants and donations',
  assets: 'Government assets',
  debt: 'Government debt and obligations',
  personnel: 'Personnel expenditure aggregates',
  utilities: 'Utility expenditure',
  ppp: 'Public-private partnerships',
  monitoring: 'Approved financial monitoring observations',
}

const dictionaryField = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  type: z.enum(['text', 'integer', 'decimal', 'date', 'boolean', 'currency']),
  description: z.string().trim().max(400).optional().or(z.literal('')),
})

const datasetBody = z.object({
  title: z.string().trim().min(5).max(160),
  description: z.string().trim().min(20).max(2000),
  category: z.enum(Object.keys(OPEN_DATA_CATEGORIES)),
  entityLevel: z.enum(['provincial', 'municipal']).default('provincial'),
  municipalityId: z.coerce.number().int().positive().nullable().optional(),
  periodLabel: z.string().trim().max(80).optional().or(z.literal('')),
  fiscalYear: z.coerce.number().int().min(2000).max(2100).nullable().optional(),
  sourceInstitution: z.string().trim().max(200).optional().or(z.literal('')),
  sourceReference: z.string().trim().max(300).optional().or(z.literal('')),
  sourceUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
  verificationStatus: z.enum(['pending', 'verified']).default('pending'),
  coverage: z.string().trim().max(500).optional().or(z.literal('')),
  methodology: z.string().trim().max(1500).optional().or(z.literal('')),
  limitations: z.string().trim().max(1500).optional().or(z.literal('')),
  licenseNote: z.string().trim().max(500).optional().or(z.literal('')),
  updateFrequency: z.string().trim().max(120).optional().or(z.literal('')),
  dataDictionary: z.array(dictionaryField).min(1).max(60),
  recordTypes: z.array(z.enum(Object.keys(RECORD_TYPES))).min(1).max(17),
  amountKind: z.enum(Object.keys(AMOUNT_KINDS)).optional().or(z.literal('')),
  categoryKey: z.string().trim().max(60).optional().or(z.literal('')),
})

const parse = (value, fallback) => {
  try { return JSON.parse(value || 'null') ?? fallback } catch { return fallback }
}
const datasetUrl = '/api/transparency/open-data/datasets'

function shapeDataset(row, { includePrivate = false } = {}) {
  const dataset = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    category: row.category,
    categoryLabel: OPEN_DATA_CATEGORIES[row.category] || row.category,
    entity: {
      level: row.entity_level,
      municipalityId: row.municipality_id,
      municipalityName: row.municipality_name || null,
      slug: row.municipality_slug || (row.entity_level === 'provincial' ? 'provincial' : null),
      name: row.entity_level === 'provincial' ? 'Provincial Government of Marinduque' : row.municipality_name,
    },
    periodLabel: row.period_label,
    fiscalYear: row.fiscal_year,
    sourceInstitution: row.source_institution,
    sourceReference: row.source_reference,
    sourceUrl: row.source_url,
    verificationStatus: row.verification_status,
    coverage: row.coverage,
    methodology: row.methodology,
    limitations: row.limitations,
    licenseNote: row.license_note || null,
    licenseStatus: row.license_note ? 'recorded by the publisher' : 'No licence recorded. Reuse terms have not been confirmed.',
    updateFrequency: row.update_frequency || null,
    dataDictionary: parse(row.data_dictionary, []),
    recordTypes: parse(row.record_types, []),
    recordTypeLabels: parse(row.record_types, []).map((type) => RECORD_TYPES[type] || type),
    amountKind: row.amount_kind,
    categoryKey: row.category_key,
    formatLinks: ['csv', 'xlsx', 'json', 'pdf'].map((format) => ({ format, href: `${datasetUrl}/${row.slug}/download?format=${format}` })),
    status: row.status,
    version: row.version,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  }
  if (includePrivate) dataset.createdBy = row.created_by
  return dataset
}

const BASE = `SELECT d.*, m.name AS municipality_name, m.slug AS municipality_slug FROM open_datasets d LEFT JOIN municipalities m ON m.id = d.municipality_id`

function datasetRecords(dataset, { page = 1, limit = 25, sort = 'fiscal_year', order = 'desc', q = '' } = {}) {
  const clauses = [`f.publication_status = 'published'`]
  const params = []
  const types = parse(dataset.record_types, [])
  if (types.length) { clauses.push(`f.record_type IN (${types.map(() => '?').join(',')})`); params.push(...types) }
  if (dataset.entity_level === 'municipal') { clauses.push('f.municipality_id = ?'); params.push(dataset.municipality_id) }
  else clauses.push(`f.government_level = 'provincial'`)
  if (dataset.fiscal_year) { clauses.push('f.fiscal_year = ?'); params.push(dataset.fiscal_year) }
  if (dataset.period_label) { clauses.push('f.period_label = ?'); params.push(dataset.period_label) }
  if (dataset.amount_kind) { clauses.push('f.amount_kind = ?'); params.push(dataset.amount_kind) }
  if (dataset.category_key) { clauses.push('COALESCE(f.category_key, f.financial_category) = ?'); params.push(dataset.category_key) }
  if (q) { clauses.push('(f.title LIKE ? OR f.reference LIKE ? OR f.department_name LIKE ?)'); params.push(`%${q.slice(0, 100)}%`, `%${q.slice(0, 100)}%`, `%${q.slice(0, 100)}%`) }
  const sortable = { fiscal_year: 'f.fiscal_year', updated_at: 'f.updated_at', amount: 'f.amount_cents', title: 'f.title' }
  const orderBy = sortable[sort] || sortable.fiscal_year
  const direction = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const where = `WHERE ${clauses.join(' AND ')}`
  const total = Number(get(`SELECT COUNT(*) AS n FROM financial_records f ${where}`, params).n)
  const rows = all(
    `SELECT f.*, m.name AS municipality_name, m.slug AS municipality_slug, c.label AS category_label
     FROM financial_records f LEFT JOIN municipalities m ON m.id = f.municipality_id
     LEFT JOIN finance_categories c ON c.key = COALESCE(f.category_key, f.financial_category)
     ${where} ORDER BY ${orderBy} ${direction}, f.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  )
  return { rows, total }
}

function validatePublication(dataset) {
  const errors = []
  if (!dataset.title) errors.push('A dataset title is required.')
  if (!dataset.description || dataset.description.length < 20) errors.push('A meaningful description is required.')
  if (!dataset.source_institution) errors.push('The source institution is required before publication.')
  if (!dataset.source_reference) errors.push('The original source document reference is required before publication.')
  if (dataset.verification_status !== 'verified') errors.push('The dataset must be marked verified before publication.')
  const dictionary = parse(dataset.data_dictionary, [])
  if (!dictionary.length) errors.push('A data dictionary is required.')
  if (dictionary.some((field) => !field.key || !field.label || !field.type)) errors.push('Every data dictionary field needs a key, label and type.')
  if (dictionary.some((field) => /email|phone|mobile|employee[_ ]?id|taxpayer|account[_ ]?number|password|token|address/i.test(`${field.key} ${field.label}`))) {
    errors.push('The data dictionary includes a personal or sensitive field. Personal taxpayer, employee, beneficiary and contact data may not be published.')
  }
  const duplicateKeys = dictionary.map((field) => field.key).filter((key, index, list) => list.indexOf(key) !== index)
  if (duplicateKeys.length) errors.push(`Duplicate data dictionary keys: ${[...new Set(duplicateKeys)].join(', ')}.`)
  if (dataset.entity_level === 'municipal' && !dataset.municipality_id) errors.push('A municipal dataset needs a municipality.')
  return errors
}

export const openDataPublicRouter = Router()

openDataPublicRouter.get(
  '/transparency/open-data/overview',
  asyncHandler(async (_req, res) => {
    const published = all(`${BASE} WHERE d.status = 'published' ORDER BY d.published_at DESC, d.id DESC`)
    const downloads = Number(get(`SELECT COUNT(*) AS n FROM open_dataset_downloads`).n)
    res.json({
      total: published.length,
      categories: Object.entries(OPEN_DATA_CATEGORIES).map(([key, label]) => ({ key, label, datasets: published.filter((row) => row.category === key).length })),
      formats: ['csv', 'xlsx', 'json', 'pdf'],
      downloads,
      recent: published.slice(0, 6).map((row) => shapeDataset(row)),
      note: 'Only verified, approved datasets appear here. No licence is implied unless the dataset records reuse terms. BetterGo is an independent civic platform, not an official government open-data repository.',
    })
  }),
)

openDataPublicRouter.get(
  '/transparency/open-data/categories',
  asyncHandler(async (_req, res) => {
    const published = all(`${BASE} WHERE d.status = 'published'`)
    res.json({
      categories: Object.entries(OPEN_DATA_CATEGORIES).map(([key, label]) => ({
        key, label,
        datasets: published.filter((row) => row.category === key).length,
        description: `${label} datasets generated from published, source-referenced financial records.`,
      })),
    })
  }),
)

openDataPublicRouter.get(
  '/transparency/open-data/datasets',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query)
    const clauses = [`d.status = 'published'`]
    const params = []
    if (req.query.category && OPEN_DATA_CATEGORIES[req.query.category]) { clauses.push('d.category = ?'); params.push(String(req.query.category)) }
    if (req.query.municipality) { clauses.push('m.slug = ?'); params.push(String(req.query.municipality)) }
    if (req.query.entity === 'provincial') clauses.push(`d.entity_level = 'provincial'`)
    if (req.query.year) { clauses.push('d.fiscal_year = ?'); params.push(Number(req.query.year)) }
    if (req.query.status && ['verified', 'pending'].includes(String(req.query.status))) { clauses.push('d.verification_status = ?'); params.push(String(req.query.status)) }
    if (req.query.q) { clauses.push('(d.title LIKE ? OR d.description LIKE ? OR d.source_institution LIKE ?)'); const term = `%${String(req.query.q).slice(0, 100)}%`; params.push(term, term, term) }
    const where = `WHERE ${clauses.join(' AND ')}`
    const rows = all(`${BASE} ${where} ORDER BY d.published_at DESC, d.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset])
    const total = Number(get(`SELECT COUNT(*) AS n FROM open_datasets d LEFT JOIN municipalities m ON m.id = d.municipality_id ${where}`, params).n)
    res.json({
      results: rows.map((row) => shapeDataset(row)), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)),
      categories: Object.entries(OPEN_DATA_CATEGORIES).map(([key, label]) => ({ key, label })),
      formats: ['csv', 'xlsx', 'json', 'pdf'],
    })
  }),
)

openDataPublicRouter.get(
  '/transparency/open-data/datasets/:slug',
  asyncHandler(async (req, res) => {
    const row = get(`${BASE} WHERE d.slug = ? AND d.status = 'published'`, [String(req.params.slug)])
    if (!row) throw notFound('Published dataset not found.')
    const { rows, total } = datasetRecords(row, { page: 1, limit: 5 })
    const versions = all(`SELECT version, change_note, created_at FROM open_dataset_versions WHERE dataset_id = ? ORDER BY version DESC LIMIT 20`, [row.id])
    res.json({
      dataset: shapeDataset(row),
      preview: { results: rows.map(shapeRecord), total, page: 1, limit: 5, totalPages: Math.max(1, Math.ceil(total / 5)) },
      versions: versions.length ? versions : [{ version: row.version, change_note: 'Initial publication', created_at: row.published_at || row.created_at }],
      note: 'The preview is generated from the same published records as the download. Missing values remain empty.',
    })
  }),
)

openDataPublicRouter.get(
  '/transparency/open-data/datasets/:slug/records',
  asyncHandler(async (req, res) => {
    const dataset = get(`${BASE} WHERE d.slug = ? AND d.status = 'published'`, [String(req.params.slug)])
    if (!dataset) throw notFound('Published dataset not found.')
    const { page, limit } = pagination({ ...req.query, limit: Math.min(50, Number(req.query.limit) || 25) })
    const { rows, total } = datasetRecords(dataset, { page, limit, sort: String(req.query.sort || 'fiscal_year'), order: String(req.query.order || 'desc'), q: cleanText(req.query.q, 100) || '' })
    res.json({ results: rows.map(shapeRecord), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)), dataset: { slug: dataset.slug, title: dataset.title, version: dataset.version } })
  }),
)

openDataPublicRouter.get(
  '/transparency/open-data/datasets/:slug/download',
  rateLimit({ windowMs: 60 * 1000, max: 30 }),
  asyncHandler(async (req, res) => {
    const format = ['csv', 'xlsx', 'json', 'pdf'].includes(String(req.query.format)) ? String(req.query.format) : 'csv'
    const dataset = get(`${BASE} WHERE d.slug = ? AND d.status = 'published'`, [String(req.params.slug)])
    if (!dataset) throw notFound('Published dataset not found.')
    const { total } = datasetRecords(dataset, { page: 1, limit: 1 })
    const { rows } = datasetRecords(dataset, { page: 1, limit: Math.max(1, total) })
    const shaped = rows.map(shapeRecord)
    const columns = [
      { key: 'reference', label: 'Record reference' },
      { key: 'recordType', label: 'Record type' },
      { key: 'title', label: 'Title' },
      { key: 'entityName', label: 'Government entity' },
      { key: 'fiscalYear', label: 'Fiscal year' },
      { key: 'periodLabel', label: 'Reporting period' },
      { key: 'categoryKey', label: 'Category' },
      { key: 'amountKind', label: 'Amount classification' },
      { key: 'amountCents', label: 'Amount (centavos)' },
      { key: 'sourceInstitution', label: 'Source institution' },
      { key: 'sourceTitle', label: 'Source document' },
      { key: 'sourceUrl', label: 'Source URL' },
      { key: 'verificationStatus', label: 'Verification status' },
      { key: 'verifiedAt', label: 'Verified at' },
    ]
    const exportRows = shaped.map((row) => ({
      reference: row.reference,
      recordType: row.recordTypeLabel,
      title: row.title,
      entityName: row.entity.name || '',
      fiscalYear: row.fiscalYear,
      periodLabel: row.periodLabel,
      categoryKey: row.categoryLabel || row.categoryKey,
      amountKind: row.amountKindLabel,
      amountCents: row.amountCents,
      sourceInstitution: row.source.institution,
      sourceTitle: row.source.title,
      sourceUrl: row.source.url,
      verificationStatus: row.verificationStatus,
      verifiedAt: row.verifiedAt,
    }))
    const dictionary = parse(dataset.data_dictionary, [])
    const lines = [
      dataset.title,
      `Dataset version: ${dataset.version}`,
      `Publisher: ${dataset.source_institution || 'Source institution not recorded'}`,
      `Reporting period: ${dataset.period_label || 'Not recorded'}`,
      `Generated: ${nowIso()}`,
      '',
      'Data dictionary:',
      ...dictionary.map((field) => `${field.key} (${field.type}) — ${field.label}: ${field.description || 'No further definition recorded.'}`),
      '',
      'Limitations:',
      dataset.limitations || 'No limitations were recorded by the publisher.',
      '',
      `Records in this version: ${total}`,
      'BetterGo Marinduque is an independent civic technology platform. This dataset is not an official government open-data publication. Missing values are empty, never zero. No licence is implied unless reuse terms are recorded.',
    ]
    sendExport(res, { format, filename: `bettergo-${dataset.slug}-v${dataset.version}`, columns, rows: exportRows, lines })
    run(
      `INSERT INTO open_dataset_downloads (dataset_id, dataset_version, format, fiscal_year, municipality_id) VALUES (?, ?, ?, ?, ?)`,
      [dataset.id, dataset.version, format, dataset.fiscal_year ?? null, dataset.municipality_id ?? null],
    )
  }),
)

openDataPublicRouter.get(
  '/transparency/open-data/downloads',
  asyncHandler(async (_req, res) => {
    res.json({
      totals: {
        downloads: Number(get(`SELECT COUNT(*) AS n FROM open_dataset_downloads`).n),
        datasets: Number(get(`SELECT COUNT(DISTINCT dataset_id) AS n FROM open_dataset_downloads`).n),
      },
      byFormat: all(`SELECT format, COUNT(*) AS count FROM open_dataset_downloads GROUP BY format ORDER BY count DESC`),
      byCategory: all(`SELECT d.category, COUNT(*) AS count FROM open_dataset_downloads x JOIN open_datasets d ON d.id = x.dataset_id GROUP BY d.category ORDER BY count DESC`),
      recent: all(`SELECT d.title, d.slug, x.format, x.created_at FROM open_dataset_downloads x JOIN open_datasets d ON d.id = x.dataset_id ORDER BY x.id DESC LIMIT 20`),
      note: 'These are aggregate platform events. No user identity, IP address or individual download history is stored or published.',
    })
  }),
)

openDataPublicRouter.get(
  '/transparency/open-data/methodology',
  asyncHandler(async (_req, res) => {
    res.json({
      guidance: [
        'Choose a category, municipality or year, then open a dataset to read its data dictionary before downloading.',
        'CSV, XLSX, JSON and PDF files contain the same published records and source references.',
        'Cite the dataset title, version, publisher and download date. Do not describe a BetterGo dataset as an official government publication.',
        'Amounts are in centavos in machine-readable files; interface pages show pesos. Missing values are empty.',
        'Official source values and BetterGo-derived summaries are distinguished in the report builder, not altered in datasets.',
        'Report an error through the financial monitoring observation form or the contact page.',
      ],
      limitations: 'Datasets may be incomplete or subject to source corrections. A published version is retained in version history when metadata changes.',
      privacy: 'No personal taxpayer, employee, beneficiary or contact information is published. Publication is blocked when such fields are detected.',
    })
  }),
)

/* --------------------------------- Admin -------------------------------- */

export const openDataAdminRouter = Router()
openDataAdminRouter.use(requireAdmin)

function snapshotVersion(dataset, req, note) {
  run(
    `INSERT OR IGNORE INTO open_dataset_versions (dataset_id, version, change_note, snapshot, created_by) VALUES (?, ?, ?, ?, ?)`,
    [dataset.id, dataset.version, note, JSON.stringify({ title: dataset.title, description: dataset.description, version: dataset.version, status: dataset.status, updated_at: dataset.updated_at }), req.user.id],
  )
}

openDataAdminRouter.get(
  '/transparency/open-data',
  requirePermission('transparency.view'),
  asyncHandler(async (req, res) => {
    const scoped = ctx(req).hasGlobalScope
      ? { sql: '', params: [] }
      : { sql: `WHERE d.municipality_id IN (${ctx(req).municipalityIds.length ? ctx(req).municipalityIds.map(() => '?').join(',') : 'NULL'})`, params: ctx(req).municipalityIds }
    const rows = all(`${BASE} ${scoped.sql} ORDER BY d.id DESC LIMIT 200`, scoped.params)
    res.json({
      datasets: rows.map((row) => shapeDataset(row, { includePrivate: true })),
      categories: Object.entries(OPEN_DATA_CATEGORIES).map(([key, label]) => ({ key, label })),
      modules: RECORD_TYPES,
      amountKinds: AMOUNT_KINDS,
      validation: { requiredBeforePublish: ['source institution', 'source document reference', 'verified status', 'data dictionary without personal fields'] },
      note: 'Datasets are generated from published records. Updating a published dataset creates a new version and requires publication review again.',
    })
  }),
)

openDataAdminRouter.post(
  '/transparency/open-data',
  requirePermission('transparency.documents.manage'),
  validate(datasetBody),
  asyncHandler(async (req, res) => {
    const body = req.body
    if (body.entityLevel === 'municipal' && (!body.municipalityId || !canUseMunicipality(ctx(req), body.municipalityId))) throw forbidden('Choose a municipality within your scope.')
    if (body.entityLevel === 'provincial' && body.municipalityId) throw unprocessable('A provincial dataset cannot belong to a municipality.')
    const base = slugify(body.title) || 'dataset'
    let slug = base
    let n = 2
    while (get(`SELECT id FROM open_datasets WHERE slug = ?`, [slug])) { slug = `${base}-${n}`; n += 1 }
    const dictionary = body.dataDictionary.map((field) => ({ ...field, description: cleanText(field.description, 400) || '' }))
    const errors = validatePublication({
      ...body,
      title: body.title,
      source_institution: body.sourceInstitution,
      source_reference: body.sourceReference,
      verification_status: body.verificationStatus,
      data_dictionary: JSON.stringify(dictionary),
      municipality_id: body.municipalityId,
      entity_level: body.entityLevel,
    }).filter((error) => /personal|sensitive|dictionary/i.test(error))
    if (errors.length) throw unprocessable(errors.join(' '))
    const id = Number(run(
      `INSERT INTO open_datasets (slug, title, description, category, entity_level, municipality_id, period_label, fiscal_year,
        source_institution, source_reference, source_url, verification_status, coverage, methodology, limitations, license_note,
        update_frequency, data_dictionary, record_types, amount_kind, category_key, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [
        slug, cleanText(body.title, 160), cleanText(body.description, 2000), body.category, body.entityLevel, body.municipalityId ?? null,
        cleanText(body.periodLabel, 80), body.fiscalYear ?? null, cleanText(body.sourceInstitution, 200), cleanText(body.sourceReference, 300),
        cleanText(body.sourceUrl, 500), body.verificationStatus, cleanText(body.coverage, 500), cleanText(body.methodology, 1500),
        cleanText(body.limitations, 1500), cleanText(body.licenseNote, 500), cleanText(body.updateFrequency, 120),
        JSON.stringify(dictionary), JSON.stringify(body.recordTypes), body.amountKind || null, body.categoryKey || null, req.user.id, nowIso(), nowIso(),
      ],
    ).lastInsertRowid)
    snapshotVersion(get(`SELECT * FROM open_datasets WHERE id = ?`, [id]), req, 'Dataset registered as a draft')
    logAudit(req, { action: 'transparency.dataset_created', module: 'transparency', entityType: 'open_dataset', entityId: id })
    res.status(201).json({ message: 'Dataset registered as a draft. It is not public until reviewed and published.', dataset: shapeDataset(get(`${BASE} WHERE d.id = ?`, [id]), { includePrivate: true }) })
  }),
)

openDataAdminRouter.post(
  '/transparency/open-data/generate',
  requirePermission('transparency.documents.manage'),
  validate(z.object({
    recordTypes: z.array(z.enum(Object.keys(RECORD_TYPES))).min(1).max(17),
    title: z.string().trim().min(5).max(160),
    periodLabel: z.string().trim().max(80).optional().or(z.literal('')),
    fiscalYear: z.coerce.number().int().min(2000).max(2100).nullable().optional(),
    municipalityId: z.coerce.number().int().positive().nullable().optional(),
    category: z.enum(Object.keys(OPEN_DATA_CATEGORIES)),
  })),
  asyncHandler(async (req, res) => {
    const body = req.body
    if (body.municipalityId && !canUseMunicipality(ctx(req), body.municipalityId)) throw forbidden('You cannot generate a dataset for that municipality.')
    const params = [...body.recordTypes]
    const clauses = [`publication_status = 'published'`, `record_type IN (${body.recordTypes.map(() => '?').join(',')})`]
    if (body.fiscalYear) { clauses.push('fiscal_year = ?'); params.push(body.fiscalYear) }
    if (body.municipalityId) { clauses.push('municipality_id = ?'); params.push(body.municipalityId) }
    else clauses.push(`government_level = 'provincial'`)
    const matching = all(`SELECT * FROM financial_records WHERE ${clauses.join(' AND ')} ORDER BY id`, params)
    if (!matching.length) throw unprocessable('No published records match this selection. A dataset cannot be generated from missing data.')
    const institutions = [...new Set(matching.map((row) => row.source_institution).filter(Boolean))]
    const documents = [...new Set(matching.map((row) => row.source_title).filter(Boolean))]
    const base = slugify(body.title) || 'dataset'
    let slug = base
    let n = 2
    while (get(`SELECT id FROM open_datasets WHERE slug = ?`, [slug])) { slug = `${base}-${n}`; n += 1 }
    const dictionary = [
      { key: 'reference', label: 'Record reference', type: 'text', description: 'BetterGo reference for the published financial record.' },
      { key: 'recordType', label: 'Record type', type: 'text', description: 'Budget, revenue, expenditure, procurement or another transparency module.' },
      { key: 'title', label: 'Title', type: 'text', description: 'Title exactly as recorded from the source document.' },
      { key: 'entity', label: 'Government entity', type: 'text', description: 'Province or municipality the record belongs to.' },
      { key: 'fiscalYear', label: 'Fiscal year', type: 'integer', description: 'Reporting year stated by the source.' },
      { key: 'periodLabel', label: 'Reporting period', type: 'text', description: 'Period label used by the source document.' },
      { key: 'category', label: 'Financial category', type: 'text', description: 'Category recorded for the record.' },
      { key: 'amountKind', label: 'Amount classification', type: 'text', description: 'Proposed, approved, allotment, obligation, disbursement, actual or another documented stage.' },
      { key: 'amountCents', label: 'Amount (centavos)', type: 'currency', description: 'Recorded amount in centavos; empty when the source does not state one.' },
      { key: 'source', label: 'Source institution and document', type: 'text', description: 'Public source institution, document title and URL where available.' },
    ]
    const id = Number(run(
      `INSERT INTO open_datasets (slug, title, description, category, entity_level, municipality_id, period_label, fiscal_year,
        source_institution, source_reference, verification_status, coverage, methodology, limitations, data_dictionary, record_types,
        status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [
        slug, cleanText(body.title, 160),
        `Generated from ${matching.length} published ${body.recordTypes.map((type) => RECORD_TYPES[type]).join(', ')} record(s). Source documents must still be confirmed before publication.`,
        body.category, body.municipalityId ? 'municipal' : 'provincial', body.municipalityId ?? null,
        cleanText(body.periodLabel, 80), body.fiscalYear ?? null,
        institutions.length === 1 ? institutions[0] : null,
        documents.length === 1 ? documents[0] : null,
        `${matching.length} published record(s) for the selected types, period and entity.`,
        'Rows are read live from the shared published financial dataset. No separate copy of source records is created.',
        'Draft only. Missing values remain empty; the dataset cannot be published until a reviewer confirms its source, verification status and data dictionary.',
        JSON.stringify(dictionary), JSON.stringify(body.recordTypes), req.user.id, nowIso(), nowIso(),
      ],
    ).lastInsertRowid)
    snapshotVersion(get(`SELECT * FROM open_datasets WHERE id = ?`, [id]), req, 'Draft generated from published records')
    logAudit(req, { action: 'transparency.dataset_generated', module: 'transparency', entityType: 'open_dataset', entityId: id })
    res.status(201).json({
      message: `Draft dataset created from ${matching.length} published record(s). Confirm the source document and verification status before publishing.`,
      dataset: shapeDataset(get(`${BASE} WHERE d.id = ?`, [id]), { includePrivate: true }),
      matchingRecords: matching.length,
    })
  }),
)

openDataAdminRouter.patch(
  '/transparency/open-data/:slug',
  requirePermission('transparency.documents.manage'),
  validate(datasetBody.partial()),
  asyncHandler(async (req, res) => {
    const dataset = get(`SELECT * FROM open_datasets WHERE slug = ?`, [String(req.params.slug)])
    if (!dataset) throw notFound('Dataset not found.')
    if (!ctx(req).hasGlobalScope && !(dataset.municipality_id && canUseMunicipality(ctx(req), dataset.municipality_id))) throw notFound('Dataset not found.')
    const wasPublished = dataset.status === 'published'
    if (wasPublished) snapshotVersion(dataset, req, 'Published metadata replaced')
    const merged = { ...dataset, ...req.body }
    const dictionary = req.body.dataDictionary ? req.body.dataDictionary : parse(dataset.data_dictionary, [])
    const body = {
      title: cleanText(req.body.title, 160) || dataset.title,
      description: req.body.description === undefined ? dataset.description : cleanText(req.body.description, 2000),
      category: req.body.category || dataset.category,
      entity_level: req.body.entityLevel || dataset.entity_level,
      municipality_id: req.body.municipalityId ?? dataset.municipality_id,
      period_label: req.body.periodLabel === undefined ? dataset.period_label : cleanText(req.body.periodLabel, 80),
      fiscal_year: req.body.fiscalYear === undefined ? dataset.fiscal_year : req.body.fiscalYear,
      source_institution: req.body.sourceInstitution === undefined ? dataset.source_institution : cleanText(req.body.sourceInstitution, 200),
      source_reference: req.body.sourceReference === undefined ? dataset.source_reference : cleanText(req.body.sourceReference, 300),
      source_url: req.body.sourceUrl === undefined ? dataset.source_url : cleanText(req.body.sourceUrl, 500),
      verification_status: req.body.verificationStatus || dataset.verification_status,
      coverage: req.body.coverage === undefined ? dataset.coverage : cleanText(req.body.coverage, 500),
      methodology: req.body.methodology === undefined ? dataset.methodology : cleanText(req.body.methodology, 1500),
      limitations: req.body.limitations === undefined ? dataset.limitations : cleanText(req.body.limitations, 1500),
      license_note: req.body.licenseNote === undefined ? dataset.license_note : cleanText(req.body.licenseNote, 500),
      update_frequency: req.body.updateFrequency === undefined ? dataset.update_frequency : cleanText(req.body.updateFrequency, 120),
      data_dictionary: JSON.stringify(dictionary),
      record_types: JSON.stringify(req.body.recordTypes || parse(dataset.record_types, [])),
      amount_kind: req.body.amountKind === undefined ? dataset.amount_kind : (req.body.amountKind || null),
      category_key: req.body.categoryKey === undefined ? dataset.category_key : (req.body.categoryKey || null),
    }
    run(
      `UPDATE open_datasets SET title = ?, description = ?, category = ?, entity_level = ?, municipality_id = ?, period_label = ?, fiscal_year = ?,
        source_institution = ?, source_reference = ?, source_url = ?, verification_status = ?, coverage = ?, methodology = ?, limitations = ?,
        license_note = ?, update_frequency = ?, data_dictionary = ?, record_types = ?, amount_kind = ?, category_key = ?,
        status = ?, version = ?, updated_at = ? WHERE id = ?`,
      [
        body.title, body.description, body.category, body.entity_level, body.municipality_id ?? null, body.period_label, body.fiscal_year,
        body.source_institution, body.source_reference, body.source_url, body.verification_status, body.coverage, body.methodology, body.limitations,
        body.license_note, body.update_frequency, body.data_dictionary, body.record_types, body.amount_kind, body.category_key,
        wasPublished ? 'draft' : dataset.status, wasPublished ? dataset.version + 1 : dataset.version, nowIso(), dataset.id,
      ],
    )
    logAudit(req, { action: 'transparency.dataset_updated', module: 'transparency', entityType: 'open_dataset', entityId: dataset.id })
    res.json({ message: wasPublished ? 'A new dataset version was created as a draft. The previous version remains in history and the public dataset is offline until republished.' : 'Dataset updated.', dataset: shapeDataset(get(`${BASE} WHERE d.id = ?`, [dataset.id]), { includePrivate: true }) })
  }),
)

openDataAdminRouter.post(
  '/transparency/open-data/:slug/publish',
  requirePermission('transparency.data.approve'),
  asyncHandler(async (req, res) => {
    const dataset = get(`SELECT * FROM open_datasets WHERE slug = ?`, [String(req.params.slug)])
    if (!dataset) throw notFound('Dataset not found.')
    if (!ctx(req).hasGlobalScope && !(dataset.municipality_id && canUseMunicipality(ctx(req), dataset.municipality_id))) throw notFound('Dataset not found.')
    const errors = validatePublication(dataset)
    if (errors.length) throw unprocessable(errors.join(' '))
    snapshotVersion(dataset, req, 'Published')
    run(`UPDATE open_datasets SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), dataset.id])
    logAudit(req, { action: 'transparency.dataset_published', module: 'transparency', entityType: 'open_dataset', entityId: dataset.id })
    publishTransparencyEvent({
      eventKey: `open-data:${dataset.slug}:v${dataset.version}:published`,
      eventType: 'dataset_published',
      title: 'New open dataset published',
      summary: dataset.title,
      recordReference: dataset.slug,
      municipalityId: dataset.municipality_id,
      category: 'open_data',
      periodLabel: dataset.period_label,
    })
    res.json({ message: 'Dataset published. Rows are read from published financial records and missing values stay empty.', dataset: shapeDataset(get(`${BASE} WHERE d.id = ?`, [dataset.id])) })
  }),
)

openDataAdminRouter.post(
  '/transparency/open-data/:slug/unpublish',
  requirePermission('transparency.data.approve'),
  asyncHandler(async (req, res) => {
    const dataset = get(`SELECT * FROM open_datasets WHERE slug = ?`, [String(req.params.slug)])
    if (!dataset) throw notFound('Dataset not found.')
    run(`UPDATE open_datasets SET status = 'draft', updated_at = ? WHERE id = ?`, [nowIso(), dataset.id])
    logAudit(req, { action: 'transparency.dataset_unpublished', module: 'transparency', entityType: 'open_dataset', entityId: dataset.id })
    res.json({ message: 'Dataset unpublished. Version history is retained.' })
  }),
)

openDataAdminRouter.post(
  '/transparency/open-data/:slug/archive',
  requirePermission('transparency.data.approve'),
  asyncHandler(async (req, res) => {
    const dataset = get(`SELECT * FROM open_datasets WHERE slug = ?`, [String(req.params.slug)])
    if (!dataset) throw notFound('Dataset not found.')
    run(`UPDATE open_datasets SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), dataset.id])
    logAudit(req, { action: 'transparency.dataset_archived', module: 'transparency', entityType: 'open_dataset', entityId: dataset.id })
    res.json({ message: 'Dataset archived. Metadata and version history remain for traceability.' })
  }),
)

openDataAdminRouter.get(
  '/transparency/open-data/downloads/analytics',
  requirePermission('transparency.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      totals: { downloads: Number(get(`SELECT COUNT(*) AS n FROM open_dataset_downloads`).n) },
      byDataset: all(`SELECT d.title, d.slug, COUNT(*) AS downloads FROM open_dataset_downloads x JOIN open_datasets d ON d.id = x.dataset_id GROUP BY d.id ORDER BY downloads DESC LIMIT 20`),
      byFormat: all(`SELECT format, COUNT(*) AS downloads FROM open_dataset_downloads GROUP BY format`),
      byCategory: all(`SELECT d.category, COUNT(*) AS downloads FROM open_dataset_downloads x JOIN open_datasets d ON d.id = x.dataset_id GROUP BY d.category`),
      byPeriod: all(`SELECT fiscal_year, COUNT(*) AS downloads FROM open_dataset_downloads WHERE fiscal_year IS NOT NULL GROUP BY fiscal_year ORDER BY fiscal_year DESC`),
      note: 'Counts are aggregate events only. No identifiable download history is collected.',
    })
  }),
)
