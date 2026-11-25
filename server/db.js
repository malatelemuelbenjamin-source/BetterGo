import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { env } from './env.js'

const dbFile = env.databasePath === ':memory:' ? ':memory:' : path.resolve(process.cwd(), env.databasePath)
if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true })

export const db = new DatabaseSync(dbFile)

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')

const schemaPath = path.join(import.meta.dirname, 'schema.sql')
db.exec(fs.readFileSync(schemaPath, 'utf8'))

// Phase 2 is additive: create new tables, then add new columns to existing
// tables only when they are missing. Applying this repeatedly is safe.
const phase2Path = path.join(import.meta.dirname, 'schema-phase2.sql')
if (fs.existsSync(phase2Path)) db.exec(fs.readFileSync(phase2Path, 'utf8'))

// Phase 3 is additive too: municipal portal content and its revisions.
const phase3Path = path.join(import.meta.dirname, 'schema-phase3.sql')
if (fs.existsSync(phase3Path)) db.exec(fs.readFileSync(phase3Path, 'utf8'))

// Phase 3 portal modules: project/program updates, feedback, subscriptions and
// privacy-preserving usage counters.
const phase3PortalPath = path.join(import.meta.dirname, 'schema-phase3-portal.sql')
if (fs.existsSync(phase3PortalPath)) db.exec(fs.readFileSync(phase3PortalPath, 'utf8'))

// Phase 4 — citizen account foundation: activity history, application tracking
// containers, private document metadata and account security events.
const phase4Path = path.join(import.meta.dirname, 'schema-phase4.sql')
if (fs.existsSync(phase4Path)) db.exec(fs.readFileSync(phase4Path, 'utf8'))

// Phase 5 — financial transparency. The existing financial_records table is
// extended in place; no Phase 1 column is redefined.
const phase5Path = path.join(import.meta.dirname, 'schema-phase5.sql')
if (fs.existsSync(phase5Path)) db.exec(fs.readFileSync(phase5Path, 'utf8'))

// Phase 5 part two — monitoring, reports, open data, alerts and community.
const phase5bPath = path.join(import.meta.dirname, 'schema-phase5b.sql')
if (fs.existsSync(phase5bPath)) db.exec(fs.readFileSync(phase5bPath, 'utf8'))
// Additive safety for databases created before the open-data metadata fields
// were finalised. Existing datasets keep their data.
for (const [column, definition] of [
  ['fiscal_year', 'INTEGER'],
  ['source_url', 'TEXT'],
  ['amount_kind', 'TEXT'],
  ['category_key', 'TEXT'],
]) ensureColumn('open_datasets', column, definition)

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

// Phase 2 columns on Phase 1 tables (SQLite supports ADD COLUMN only).
// Session invalidation marker: every password change or reset increments it,
// which retires all previously issued session tokens.
ensureColumn('users', 'session_version', 'INTEGER NOT NULL DEFAULT 0')

// Phase 3 — municipality portal fields on the existing municipalities table.
// They stay NULL until an authorised administrator publishes verified content;
// nothing here is seeded with invented municipal information.
ensureColumn('municipalities', 'portal_title', 'TEXT')
ensureColumn('municipalities', 'portal_description', 'TEXT')
ensureColumn('municipalities', 'office_hours', 'TEXT')
ensureColumn('municipalities', 'social_links', 'TEXT')
ensureColumn('municipalities', 'portal_settings', 'TEXT')
// Municipal audit trail. NULL for province-wide and non-municipal actions.
ensureColumn('audit_logs', 'municipality_id', 'INTEGER REFERENCES municipalities(id) ON DELETE SET NULL')

// Phase 3 feedback citations: a public reference so a citizen can follow up
// without exposing their message or email. Unique when present.
ensureColumn('municipal_feedback', 'reference', 'TEXT')
if (db.prepare("PRAGMA table_info(municipal_feedback)").all().some((row) => row.name === 'reference')) {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_municipal_feedback_reference ON municipal_feedback(reference)')
}

// Phase 3 — publishing, program, project and resource fields on municipal
// content. Every one stays empty until an authorised editor records it.
ensureColumn('municipal_content', 'priority', "TEXT NOT NULL DEFAULT 'normal'")
ensureColumn('municipal_content', 'pinned', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('municipal_content', 'venue', 'TEXT')
ensureColumn('municipal_content', 'event_start', 'TEXT')
ensureColumn('municipal_content', 'event_end', 'TEXT')
ensureColumn('municipal_content', 'eligibility', 'TEXT')
ensureColumn('municipal_content', 'application_status', "TEXT NOT NULL DEFAULT 'not_stated'")
ensureColumn('municipal_content', 'beneficiaries', 'TEXT')
ensureColumn('municipal_content', 'office_id', 'INTEGER REFERENCES government_offices(id) ON DELETE SET NULL')
ensureColumn('municipal_content', 'progress_percent', 'INTEGER')
ensureColumn('municipal_content', 'project_status', "TEXT NOT NULL DEFAULT 'proposed'")
ensureColumn('municipal_content', 'progress_note', 'TEXT')
ensureColumn('municipal_content', 'progress_updated_at', 'TEXT')
ensureColumn('municipal_content', 'attachment_url', 'TEXT')
ensureColumn('municipal_content', 'attachment_label', 'TEXT')
ensureColumn('municipal_content', 'address', 'TEXT')
ensureColumn('municipal_content', 'barangay', 'TEXT')
ensureColumn('municipal_content', 'latitude', 'REAL')
ensureColumn('municipal_content', 'longitude', 'REAL')

// Phase 3 — office hierarchy and verified map location (Prompt 46–47).
// Coordinates are only rendered when location_verified = 1.
ensureColumn('government_offices', 'parent_office_id', 'INTEGER REFERENCES government_offices(id) ON DELETE SET NULL')
ensureColumn('government_offices', 'office_level', "TEXT NOT NULL DEFAULT 'office'")
ensureColumn('government_offices', 'location_verified', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('government_offices', 'service_note', 'TEXT')

// Phase 3 — document center fields on the existing public documents table.
ensureColumn('public_documents', 'resource_type', 'TEXT')
ensureColumn('public_documents', 'version', 'TEXT')
ensureColumn('public_documents', 'review_date', 'TEXT')
ensureColumn('public_documents', 'access_notes', 'TEXT')
ensureColumn('public_documents', 'external_url', 'TEXT')
ensureColumn('public_documents', 'related_service_id', 'INTEGER REFERENCES government_services(id) ON DELETE SET NULL')

ensureColumn('service_categories', 'parent_id', 'INTEGER REFERENCES service_categories(id) ON DELETE SET NULL')
ensureColumn('service_categories', 'category_group', 'TEXT')
ensureColumn('service_categories', 'is_featured', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('service_categories', 'status', "TEXT NOT NULL DEFAULT 'active'")
ensureColumn('service_categories', 'seo_title', 'TEXT')
ensureColumn('service_categories', 'seo_description', 'TEXT')
ensureColumn('service_categories', 'keywords', 'TEXT')

db.exec('CREATE INDEX IF NOT EXISTS idx_service_categories_parent ON service_categories(parent_id)')

// Phase 4 — the capability a service actually offers. NULL means "derive from
// the recorded fields"; it is never set to an authorised integration without a
// documented agreement.
ensureColumn('government_services', 'digital_capability', 'TEXT')

// Prompt 63 — reuse the Phase 2 private collections; add an optional note.
ensureColumn('service_collection_items', 'note', 'TEXT')

// Prompt 61 — optional profile fields. Personalization is opt-in.
ensureColumn('user_profiles', 'display_name', 'TEXT')
ensureColumn('user_profiles', 'personalization_opt_in', 'INTEGER NOT NULL DEFAULT 1')

// Prompt 84 — extend the Phase 1 data_exports table for portable exports.
for (const [column, definition] of [
  ['reference', 'TEXT'],
  ['status', "TEXT NOT NULL DEFAULT 'ready'"],
  ['sections', "TEXT NOT NULL DEFAULT '[]'"],
  ['record_counts', "TEXT NOT NULL DEFAULT '{}'"],
  ['payload', 'TEXT'],
  ['error_reason', 'TEXT'],
  ['downloaded_at', 'TEXT'],
]) ensureColumn('data_exports', column, definition)
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_data_exports_reference ON data_exports(reference)')

// Prompt 81 — accessibility preferences and optional self-declared needs.
for (const [column, definition] of [
  ['text_scale', "TEXT NOT NULL DEFAULT 'default'"],
  ['high_contrast', 'INTEGER NOT NULL DEFAULT 0'],
  ['simplified_view', 'INTEGER NOT NULL DEFAULT 0'],
  ['screen_reader_hints', 'INTEGER NOT NULL DEFAULT 1'],
  ['assistance_needs', "TEXT NOT NULL DEFAULT '[]'"],
]) ensureColumn('user_profiles', column, definition)
for (const [column, definition] of [
  ['accessibility_features', "TEXT NOT NULL DEFAULT '[]'"],
  ['accessibility_notes', 'TEXT'],
]) ensureColumn('government_services', column, definition)

// Prompt 64 — link BetterGo intake records to the form and version used.
ensureColumn('citizen_applications', 'form_id', 'INTEGER REFERENCES service_forms(id) ON DELETE SET NULL')
ensureColumn('citizen_applications', 'form_version', 'INTEGER')
ensureColumn('citizen_applications', 'form_answers', 'TEXT')
ensureColumn('citizen_applications', 'submission_classification', "TEXT NOT NULL DEFAULT 'bettergo_intake'")
ensureColumn('citizen_applications', 'privacy_notice_version', 'TEXT')
ensureColumn('citizen_applications', 'consented_at', 'TEXT')
ensureColumn('citizen_applications', 'document_ids', 'TEXT')
ensureColumn('citizen_applications', 'reviewer_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL')
ensureColumn('citizen_applications', 'assigned_at', 'TEXT')
ensureColumn('citizen_applications', 'withdrawn_at', 'TEXT')
ensureColumn('citizen_applications', 'withdrawal_reason', 'TEXT')
ensureColumn('citizen_applications', 'closed_at', 'TEXT')
ensureColumn('citizen_applications', 'external_reference', 'TEXT')
// Prompt 67 — an archived record is retained but hidden from default lists.
ensureColumn('citizen_applications', 'archived_at', 'TEXT')
ensureColumn('data_requests', 'citizen_note', 'TEXT')
// Prompt 71 — richer privacy request records. Nothing here is a legal finding.
for (const [column, definition] of [
  ['requested_categories', 'TEXT'],
  ['correction_details', 'TEXT'],
  ['verification_status', "TEXT NOT NULL DEFAULT 'not_required'"],
  ['completed_at', 'TEXT'],
  ['response_summary', 'TEXT'],
]) ensureColumn('data_requests', column, definition)
ensureColumn('privacy_incidents', 'updated_at', 'TEXT')
ensureColumn('privacy_incidents', 'affected_systems', 'TEXT')
ensureColumn('privacy_incidents', 'investigation_notes', 'TEXT')
// Prompt 73 — requirement verification metadata. Drafts are never labelled
// official; approval stamps who reviewed the source and when.
for (const [column, definition] of [
  ['source_title', 'TEXT'],
  ['source_url', 'TEXT'],
  ['verified_at', 'TEXT'],
  ['verified_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL'],
  ['review_status', "TEXT NOT NULL DEFAULT 'unverified'"],
  ['guidance', 'TEXT'],
  ['issuing_office', 'TEXT'],
  ['validity', 'TEXT'],
  ['archived_at', 'TEXT'],
]) ensureColumn('service_requirements', column, definition)
// Prompt 75 — extend the existing Phase 2 fee table instead of duplicating it.
for (const [column, definition] of [
  ['fee_description', 'TEXT'],
  ['source_title', 'TEXT'],
  ['payment_methods', 'TEXT'],
  ['review_status', "TEXT NOT NULL DEFAULT 'draft'"],
  ['verified_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL'],
  ['verified_at', 'TEXT'],
  ['archived_at', 'TEXT'],
]) ensureColumn('service_fees', column, definition)
// Prompt 76 — request guidance on the existing services table.
for (const [column, definition] of [
  ['request_method', 'TEXT'],
  ['external_request_url', 'TEXT'],
  ['request_instructions', 'TEXT'],
]) ensureColumn('government_services', column, definition)
// Prompt 68 — notification categories, archive and importance state.
for (const [column, definition] of [
  ['category', "TEXT NOT NULL DEFAULT 'account'"],
  ['archived_at', 'TEXT'],
  ['important_at', 'TEXT'],
  ['deleted_at', 'TEXT'],
]) ensureColumn('notifications', column, definition)
for (const [column, definition] of [
  ['applications_enabled', 'INTEGER NOT NULL DEFAULT 1'],
  ['security_enabled', 'INTEGER NOT NULL DEFAULT 1'],
  ['documents_enabled', 'INTEGER NOT NULL DEFAULT 1'],
  ['emergency_enabled', 'INTEGER NOT NULL DEFAULT 1'],
  ['privacy_enabled', 'INTEGER NOT NULL DEFAULT 1'],
  ['platform_enabled', 'INTEGER NOT NULL DEFAULT 1'],
  ['municipality_updates_enabled', 'INTEGER NOT NULL DEFAULT 1'],
  ['quiet_hours_start', 'TEXT'],
  ['quiet_hours_end', 'TEXT'],
  ['transparency_enabled', 'INTEGER NOT NULL DEFAULT 1'],
]) ensureColumn('notification_preferences', column, definition)
for (const [column, definition] of [
  ['title', 'TEXT'],
  ['description', 'TEXT'],
  ['issuer', 'TEXT'],
  ['issued_at', 'TEXT'],
  ['folder_id', 'INTEGER REFERENCES document_folders(id) ON DELETE SET NULL'],
  ['sha256', 'TEXT'],
  ['version', 'INTEGER NOT NULL DEFAULT 1'],
  ['replaced_by', 'INTEGER'],
  ['deleted_at', 'TEXT'],
  ['last_accessed_at', 'TEXT'],
]) ensureColumn('citizen_documents', column, definition)

// Prompt 63 — collections now hold any saveable record type, in a chosen order.
ensureColumn('service_collection_items', 'content_type', "TEXT NOT NULL DEFAULT 'service'")
ensureColumn('service_collection_items', 'content_id', 'INTEGER')
ensureColumn('service_collection_items', 'sort_order', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('service_collections', 'icon', 'TEXT')

// SQLite cannot drop the original NOT NULL on service_collection_items.service_id,
// so rebuild the table once to let a collection hold any record type.
{
  const columns = db.prepare(`PRAGMA table_info(service_collection_items)`).all()
  const serviceId = columns.find((column) => column.name === 'service_id')
  if (serviceId && Number(serviceId.notnull) === 1) {
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec(`CREATE TABLE service_collection_items_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL REFERENCES service_collections(id) ON DELETE CASCADE,
      service_id INTEGER REFERENCES government_services(id) ON DELETE CASCADE,
      content_type TEXT NOT NULL DEFAULT 'service',
      content_id INTEGER,
      note TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (collection_id, service_id)
    )`)
    db.exec(`INSERT INTO service_collection_items_new
             (id, collection_id, service_id, content_type, content_id, note, sort_order, created_at)
             SELECT id, collection_id, service_id,
                    COALESCE(content_type, 'service'),
                    COALESCE(content_id, service_id),
                    note, COALESCE(sort_order, 0), created_at
             FROM service_collection_items`)
    db.exec('DROP TABLE service_collection_items')
    db.exec('ALTER TABLE service_collection_items_new RENAME TO service_collection_items')
    db.exec('CREATE INDEX IF NOT EXISTS idx_service_collection_items ON service_collection_items(collection_id)')
    db.exec('PRAGMA foreign_keys = ON')
  }
}

// Carry existing service bookmarks into the unified table. The UNIQUE
// constraint makes this safe to repeat on every start.
try {
  run(`INSERT OR IGNORE INTO saved_items (user_id, content_type, content_id, created_at)
       SELECT user_id, 'service', service_id, created_at FROM service_favorites`)
} catch { /* service_favorites is created later in schema.sql */ }

ensureColumn('government_services', 'short_description', 'TEXT')
ensureColumn('government_services', 'full_description', 'TEXT')
ensureColumn('government_services', 'service_scope', "TEXT NOT NULL DEFAULT 'province_wide'")
ensureColumn('government_services', 'availability_status', "TEXT NOT NULL DEFAULT 'needs_confirmation'")
ensureColumn('government_services', 'application_mode', 'TEXT')
ensureColumn('government_services', 'is_online', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('government_services', 'source_id', 'INTEGER REFERENCES service_sources(id) ON DELETE SET NULL')
ensureColumn('government_services', 'source_url', 'TEXT')
ensureColumn('government_services', 'next_review_at', 'TEXT')
ensureColumn('government_services', 'reviewed_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL')
ensureColumn('government_services', 'verification_notes', 'TEXT')
ensureColumn('government_services', 'version_number', 'INTEGER NOT NULL DEFAULT 1')
db.exec('CREATE INDEX IF NOT EXISTS idx_services_availability ON government_services(availability_status, publication_status)')
db.exec('CREATE INDEX IF NOT EXISTS idx_services_source ON government_services(source_id)')

db.exec('CREATE INDEX IF NOT EXISTS idx_service_favorites_user ON service_favorites(user_id)')
ensureColumn('service_requirements', 'quantity', 'TEXT')
ensureColumn('service_requirements', 'accepted_format', 'TEXT')
ensureColumn('service_procedures', 'additional_instructions', 'TEXT')
ensureColumn('service_procedures', 'responsible_office_id', 'INTEGER REFERENCES government_offices(id) ON DELETE SET NULL')
ensureColumn('service_favorites', 'note', 'TEXT')
ensureColumn('service_favorites', 'collection_id', 'INTEGER REFERENCES service_collections(id) ON DELETE SET NULL')


/** Run a query returning all rows. */
export const all = (sql, params = []) => db.prepare(sql).all(...params)

/** Run a query returning the first row. */
export const get = (sql, params = []) => db.prepare(sql).get(...params)

/** Execute a write statement. */
export const run = (sql, params = []) => db.prepare(sql).run(...params)

/** Execute multiple statements in a transaction. */
export function transaction(fn) {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Convert a value into a SQLite-friendly boolean. */
export const toBit = (value) => (value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0)

export function nowIso() {
  return new Date().toISOString()
}

// Phase 5 financial record semantics. Every column is nullable or defaulted so
// existing rows keep their meaning; nothing is backfilled with invented data.
ensureColumn('financial_records', 'reference', 'TEXT')
ensureColumn('financial_records', 'record_type', "TEXT NOT NULL DEFAULT 'budget'")
ensureColumn('financial_records', 'title', 'TEXT')
ensureColumn('financial_records', 'description', 'TEXT')
ensureColumn('financial_records', 'category_key', 'TEXT')
ensureColumn('financial_records', 'official_classification', 'TEXT')
ensureColumn('financial_records', 'amount_kind', "TEXT NOT NULL DEFAULT 'approved'")
ensureColumn('financial_records', 'period_type', "TEXT NOT NULL DEFAULT 'annual'")
ensureColumn('financial_records', 'period_start', 'TEXT')
ensureColumn('financial_records', 'period_end', 'TEXT')
ensureColumn('financial_records', 'source_title', 'TEXT')
ensureColumn('financial_records', 'source_institution', 'TEXT')
ensureColumn('financial_records', 'source_published_on', 'TEXT')
ensureColumn('financial_records', 'verified_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL')
ensureColumn('financial_records', 'verified_at', 'TEXT')
ensureColumn('financial_records', 'publication_status', "TEXT NOT NULL DEFAULT 'draft'")
ensureColumn('financial_records', 'limitations', 'TEXT')
ensureColumn('financial_records', 'counterparty', 'TEXT')
ensureColumn('financial_records', 'metadata', 'TEXT')
ensureColumn('financial_records', 'created_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL')
ensureColumn('financial_records', 'updated_at', 'TEXT')
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_reference ON financial_records(reference) WHERE reference IS NOT NULL')

// Phase 5 specialist fields for loans, assets, procurement/contracts, PPPs,
// payroll, taxes and land. They stay optional so older records keep working.
for (const [column, definition] of [
  ['identifier', 'TEXT'],
  ['location', 'TEXT'],
  ['term_start', 'TEXT'],
  ['term_end', 'TEXT'],
  ['maturity_date', 'TEXT'],
  ['interest_rate', 'REAL'],
  ['outstanding_balance_cents', 'INTEGER'],
  ['principal_cents', 'INTEGER'],
  ['quantity', 'INTEGER'],
  ['quantity_label', 'TEXT'],
  ['stage', 'TEXT'],
  ['program_name', 'TEXT'],
  ['rate_description', 'TEXT'],
  ['assessment_basis', 'TEXT'],
  ['arrangement', 'TEXT'],
  ['title_number', 'TEXT'],
]) {
  ensureColumn('financial_records', column, definition)
}
