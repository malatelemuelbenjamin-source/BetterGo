/**
 * Neutral Phase 5 reference metadata: monitoring rule definitions, report
 * templates and community discussion topics. None of these is a finding, a
 * financial record, a dataset or a government statement.
 */
import { get, run } from './db.js'

export const MONITORING_RULES = [
  ['missing_source', 'Missing source document', 'A published record does not name both a source institution and the original document title.', 'source', 'high'],
  ['missing_period', 'Missing reporting period', 'A published record has no fiscal year or period label.', 'period', 'medium'],
  ['duplicate_record', 'Duplicate record suspected', 'Two records share the same entity, period, classification and amount.', 'duplicate', 'low'],
  ['classification_review', 'Classification requires review', 'The amount classification is not usual for this record type.', 'classification', 'medium'],
  ['calculation_review', 'Calculation requires review', 'A recorded value fails an internal consistency check, such as a balance above principal or an end date before a start date.', 'calculation', 'critical'],
  ['budget_over_expenditure', 'Expenditure exceeds approved budget', 'Actual or disbursement records exceed the approved amount for the same entity, category and fiscal year.', 'consistency', 'high'],
  ['allotment_obligation', 'Obligation exceeds allotment', 'For a comparable period, obligations exceed recorded allotments.', 'consistency', 'medium'],
  ['obligation_disbursement', 'Disbursement exceeds obligation', 'For a comparable period, disbursements exceed recorded obligations.', 'consistency', 'medium'],
  ['procurement_documentation', 'Procurement documentation incomplete', 'A published procurement or contract record is missing a contract reference or lifecycle stage.', 'procurement', 'low'],
  ['version_conflict', 'Conflicting publication state', 'A published record lacks a verification timestamp or has inconsistent verification status.', 'version', 'high'],
  ['entity_association', 'Entity association requires review', 'A municipal record has no municipality, or a provincial record is associated with one.', 'entity', 'high'],
  ['revenue_classification', 'Revenue classification requires review', 'A revenue record uses a classification that is not an assessment or actual collection.', 'revenue', 'low'],
]

export function seedPhase5b() {
  for (const [key, name, description, module, severity] of MONITORING_RULES) {
    if (!get(`SELECT id FROM monitoring_rules WHERE key = ?`, [key])) {
      run(`INSERT INTO monitoring_rules (key, name, description, module, severity) VALUES (?, ?, ?, ?, ?)`, [key, name, description, module, severity])
    }
  }

  const templates = [
    ['annual-budget', 'Annual Government Budget Report', 'Published budget and appropriation records for one entity and fiscal year.', ['summary', 'allocations', 'classifications', 'sources', 'methodology']],
    ['municipal-transparency', 'Municipal Financial Transparency Report', 'A municipality-wide view of published budget, revenue, expenditure and procurement records.', ['summary', 'budget', 'revenue', 'expenditure', 'procurement', 'sources', 'methodology']],
    ['provincial-transparency', 'Provincial Financial Transparency Report', 'Provincial records across the transparency modules, with coverage and limitations.', ['summary', 'budget', 'revenue', 'expenditure', 'projects', 'sources', 'methodology']],
    ['revenue-tax', 'Revenue and Tax Collection Report', 'Assessed and actually collected revenue for a selected entity and period.', ['summary', 'revenue', 'trend', 'sources', 'methodology']],
    ['expenditure', 'Government Expenditure Report', 'Appropriation, obligation, disbursement and actual expenditure kept as separate stages.', ['summary', 'expenditure', 'trend', 'sources', 'methodology']],
    ['procurement', 'Procurement and Contract Summary', 'Published procurement and contract records with contract values and stages.', ['summary', 'procurement', 'sources', 'methodology']],
    ['infrastructure', 'Infrastructure Funding Report', 'Project funding records and linked procurement references, where available.', ['summary', 'projects', 'sources', 'methodology']],
    ['grants-donations', 'Government Grants and Donations Report', 'Aggregate grants, subsidies, donations and external funding records.', ['summary', 'grants', 'sources', 'methodology']],
    ['debt', 'Government Debt and Obligations Report', 'Loan principal, outstanding balances and contractual terms as published.', ['summary', 'debt', 'sources', 'methodology']],
    ['personnel', 'Personnel Services Expenditure Report', 'Aggregate payroll and personnel expenditure; no individual payroll records.', ['summary', 'personnel', 'sources', 'methodology']],
    ['assets', 'Public Asset and Property Report', 'Published asset valuations, locations and quantities, where verified.', ['summary', 'assets', 'sources', 'methodology']],
    ['audit-documentation', 'Government Audit and Documentation Summary', 'Published audit report references and approved data-quality observations. Not a COA conclusion.', ['summary', 'audit', 'monitoring', 'sources', 'methodology']],
  ]
  for (const [slug, title, description, sections] of templates) {
    if (!get(`SELECT id FROM report_templates WHERE slug = ?`, [slug])) {
      run(
        `INSERT INTO report_templates (slug, title, description, sections, default_filters) VALUES (?, ?, ?, ?, ?)`,
        [slug, title, description, JSON.stringify(sections), JSON.stringify({})],
      )
    }
  }

  const topics = [
    ['budget-basics', 'Understanding the local government budget', 'How budgets are proposed, approved and published.'],
    ['allocation', 'How public funds are allocated', 'Departments, programs and categories.'],
    ['procurement', 'How government procurement works', 'Bidding, awards and contract documentation.'],
    ['audit', 'Understanding audit reports', 'What audit observations do and do not establish.'],
    ['infrastructure', 'Infrastructure funding', 'Project funding, contracts and public reporting.'],
    ['revenue', 'Local revenue and tax collection', 'Assessments, collections and receivables.'],
    ['accountability', 'Public financial accountability', 'Documentation, verification and corrections.'],
    ['open-data', 'Open government data', 'Using datasets, exports and methodology.'],
    ['participation', 'Transparency and public participation', 'Questions, discussion and constructive review.'],
  ]
  for (const [index, [slug, title, description]] of topics.entries()) {
    if (!get(`SELECT id FROM community_topics WHERE slug = ?`, [slug])) {
      run(`INSERT INTO community_topics (slug, title, description, sort_order) VALUES (?, ?, ?, ?)`, [slug, title, description, index])
    }
  }
}
