/**
 * Prompt 115 — Phase 5 integration and data-quality review API.
 *
 * Read-only. It reports what exists, what is verified and what still needs
 * configuration or source data. It never fills gaps with invented records and
 * never labels a technical check as legal certification.
 */
import { Router } from 'express'
import { all, get } from '../db.js'
import { asyncHandler } from '../lib/http.js'
import { requireAdmin, requirePermission } from '../rbac.js'
import { RECORD_TYPES } from './finance.js'

const MODULES = [
  ['finance_portal', 'Government transparency portal and budget explorer', 'implemented'],
  ['financial_records', 'Financial records across 17 modules with specialist fields', 'implemented'],
  ['monitoring', 'Financial data-quality monitoring and citizen observations', 'implemented'],
  ['report_builder', 'Custom transparency report builder and exports', 'implemented'],
  ['open_data', 'Open data repository, previews and version history', 'implemented'],
  ['alerts', 'Transparency alerts, subscriptions and digests', 'implemented; email/SMS await provider configuration'],
  ['community', 'Moderated questions, discussions, sources and appeals', 'implemented; moderation is human-reviewed'],
  ['notifications', 'Reuse of the existing citizen notification centre', 'implemented'],
  ['documents', 'Existing public document centre and source references', 'implemented; no new binary uploader in Phase 5'],
  ['external_integrations', 'Live COA, procurement or LGU system integrations', 'awaiting external authorisation'],
  ['real_data', 'Verified government financial source records', 'awaiting verified source data'],
  ['accessibility', 'WCAG 2.2 AA conformance audit', 'practical checks implemented; formal audit not performed'],
  ['security', 'Independent penetration test', 'no independent pen test performed'],
]

function count(sql, params = []) {
  return Number(get(sql, params)?.n || 0)
}

function integrityChecks() {
  const checks = []
  const fk = all(`PRAGMA foreign_key_check`)
  checks.push({ key: 'foreign_keys', label: 'Foreign key relationships', ok: fk.length === 0, detail: fk.length ? `${fk.length} orphaned relationship(s) detected.` : 'No foreign key violations detected.' })
  const duplicateReferences = count(`SELECT COUNT(*) AS n FROM (SELECT reference FROM financial_records WHERE reference IS NOT NULL GROUP BY reference HAVING COUNT(*) > 1)`)
  checks.push({ key: 'duplicate_references', label: 'Duplicate financial record references', ok: duplicateReferences === 0, detail: duplicateReferences ? `${duplicateReferences} duplicate reference group(s).` : 'No duplicate public references.' })
  const orphanVersions = count(`SELECT COUNT(*) AS n FROM finance_record_versions v LEFT JOIN financial_records f ON f.id = v.record_id WHERE f.id IS NULL`)
  checks.push({ key: 'orphan_versions', label: 'Version history relationships', ok: orphanVersions === 0, detail: orphanVersions ? `${orphanVersions} orphaned version row(s).` : 'Every finance version belongs to a record.' })
  const publishedUnverified = count(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status = 'published' AND (verified_at IS NULL OR verification_status NOT IN ('verified','archived'))`)
  checks.push({ key: 'published_verification', label: 'Published records have verification', ok: publishedUnverified === 0, detail: publishedUnverified ? `${publishedUnverified} published record(s) need verification review.` : 'All published records carry a verification timestamp and status.' })
  const findingsApproved = count(`SELECT COUNT(*) AS n FROM monitoring_findings WHERE review_status = 'published' AND approved_at IS NULL`)
  checks.push({ key: 'finding_approval', label: 'Public findings have human approval', ok: findingsApproved === 0, detail: findingsApproved ? `${findingsApproved} public finding(s) lack approval metadata.` : 'Every public finding records human approval.' })
  const datasetsPublished = count(`SELECT COUNT(*) AS n FROM open_datasets WHERE status = 'published' AND (verification_status <> 'verified' OR source_institution IS NULL OR source_reference IS NULL)`)
  checks.push({ key: 'dataset_publication', label: 'Published datasets have verified source metadata', ok: datasetsPublished === 0, detail: datasetsPublished ? `${datasetsPublished} published dataset(s) need source review.` : 'Published datasets carry source and verification metadata.' })
  const communityPrivate = count(`SELECT COUNT(*) AS n FROM community_threads WHERE status = 'published' AND moderation_note IS NULL`)
  checks.push({ key: 'community_moderation', label: 'Published community threads were moderated', ok: communityPrivate === 0, detail: communityPrivate ? `${communityPrivate} published thread(s) have no moderation note.` : 'Every published thread records a moderation decision.' })
  const unpublishedNotifications = count(`SELECT COUNT(*) AS n FROM transparency_alert_events e WHERE e.record_reference IS NOT NULL AND e.event_type = 'record_published' AND NOT EXISTS (SELECT 1 FROM financial_records f WHERE f.reference = e.record_reference AND f.publication_status = 'published')`)
  checks.push({ key: 'alert_publication', label: 'Alerts reference published records', ok: unpublishedNotifications === 0, detail: unpublishedNotifications ? `${unpublishedNotifications} alert event(s) reference a record that is no longer published.` : 'Alert events reference published records.' })
  return checks
}

export const finalizationPublicRouter = Router()

finalizationPublicRouter.get(
  '/transparency/data-quality',
  asyncHandler(async (_req, res) => {
    const published = Number(get(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status = 'published'`).n)
    const byType = Object.fromEntries(Object.keys(RECORD_TYPES).map((type) => [type, {
      published: count(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status='published' AND record_type = ?`, [type]),
      verified: count(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status IN ('verified','approved','published') AND record_type = ?`, [type]),
      drafts: count(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status IN ('draft','awaiting_source','under_review') AND record_type = ?`, [type]),
    }]))
    res.json({
      generatedAt: new Date().toISOString(),
      totals: {
        published,
        draftsOrPending: count(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status IN ('draft','awaiting_source','under_review')`),
        missingSource: count(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status='published' AND (source_institution IS NULL OR source_title IS NULL)`),
        missingPeriod: count(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status='published' AND (fiscal_year IS NULL OR period_label IS NULL)`),
        findingsPublished: count(`SELECT COUNT(*) AS n FROM monitoring_findings WHERE review_status='published'`),
        datasetsPublished: count(`SELECT COUNT(*) AS n FROM open_datasets WHERE status='published'`),
      },
      byType,
      statuses: MODULES.map(([key, label, status]) => ({ key, label, status })),
      note: 'Counts describe records held by this platform. A zero count is not evidence that a government received or spent nothing. No verified government financial data has been seeded.',
      disclaimer: 'This is an independent civic data-quality summary, not an official audit, certification or legal conclusion.',
    })
  }),
)

export const finalizationAdminRouter = Router()
finalizationAdminRouter.use(requireAdmin, requirePermission('transparency.view'))

finalizationAdminRouter.get(
  '/transparency/integration',
  asyncHandler(async (_req, res) => {
    const tables = ['financial_records', 'transparency_periods', 'finance_record_versions', 'monitoring_rules', 'monitoring_findings', 'monitoring_observations', 'report_templates', 'report_configs', 'report_generations', 'open_datasets', 'open_dataset_versions', 'open_dataset_downloads', 'transparency_subscriptions', 'transparency_alert_events', 'transparency_alert_deliveries', 'community_topics', 'community_threads', 'community_posts', 'community_sources', 'community_reports', 'community_appeals', 'community_contributors']
      .map((table) => ({ table, rows: count(`SELECT COUNT(*) AS n FROM ${table}`) }))
    res.json({
      phase: 5,
      modules: MODULES.map(([key, label, status]) => ({ key, label, status })),
      tables,
      checks: integrityChecks(),
      routes: {
        public: ['/transparency', '/transparency/finance', '/transparency/budgets', '/transparency/financial-monitoring', '/transparency/reports', '/transparency/open-data', '/transparency/alerts', '/transparency/community'],
        admin: ['/admin/transparency/finance', '/admin/transparency/financial-monitoring', '/admin/transparency/reports', '/admin/transparency/open-data', '/admin/transparency/alerts', '/admin/transparency/community'],
      },
      counts: {
        publishedFinancialRecords: count(`SELECT COUNT(*) AS n FROM financial_records WHERE publication_status='published'`),
        publishedFindings: count(`SELECT COUNT(*) AS n FROM monitoring_findings WHERE review_status='published'`),
        publishedDatasets: count(`SELECT COUNT(*) AS n FROM open_datasets WHERE status='published'`),
        subscriptions: count(`SELECT COUNT(*) AS n FROM transparency_subscriptions`),
        communityThreads: count(`SELECT COUNT(*) AS n FROM community_threads`),
      },
      readiness: 'Feature-complete for this deployment, but not production-launch-ready until verified source documents, an accessibility audit, an independent security test and any external integration authorisations are supplied. No deployment or external notification was performed.',
      note: 'Technical checks are not legal certification or a COA conclusion.',
    })
  }),
)
