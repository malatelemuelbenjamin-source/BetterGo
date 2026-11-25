PRAGMA foreign_keys = ON;

-- ============================================================
-- PHASE 2 — GOVERNMENT SERVICES DIRECTORY
-- Additive schema. Nothing in Phase 1 is altered or removed.
-- New columns on existing tables are applied by db.js migrations.
-- ============================================================

-- Official sources backing service information -------------------------------
CREATE TABLE IF NOT EXISTS service_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  organization TEXT,
  source_type TEXT NOT NULL DEFAULT 'official_website',
  url TEXT,
  document_reference TEXT,
  description TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verified_at TEXT,
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  next_review_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_sources_status ON service_sources(verification_status);

-- Fees -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  fee_name TEXT NOT NULL,
  amount_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'PHP',
  fee_type TEXT NOT NULL DEFAULT 'fixed',
  conditions TEXT,
  source_reference TEXT,
  source_url TEXT,
  last_verified_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (amount_cents IS NULL OR amount_cents >= 0)
);
CREATE INDEX IF NOT EXISTS idx_service_fees_service ON service_fees(service_id);

-- Processing time ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_processing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  processing_time TEXT NOT NULL,
  processing_unit TEXT NOT NULL DEFAULT 'working days',
  conditions TEXT,
  source_reference TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_processing_service ON service_processing(service_id);

-- Municipality / barangay coverage ------------------------------------------
CREATE TABLE IF NOT EXISTS service_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE CASCADE,
  barangay_id INTEGER REFERENCES barangays(id) ON DELETE CASCADE,
  availability_status TEXT NOT NULL DEFAULT 'available',
  local_instructions TEXT,
  office_id INTEGER REFERENCES government_offices(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (service_id, municipality_id, barangay_id)
);
CREATE INDEX IF NOT EXISTS idx_service_coverage_service ON service_coverage(service_id);
CREATE INDEX IF NOT EXISTS idx_service_coverage_municipality ON service_coverage(municipality_id);

-- Forms, downloadable documents and external application resources ---------
CREATE TABLE IF NOT EXISTS service_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  document_title TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'form',
  file_reference TEXT,
  external_url TEXT,
  publication_date TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_documents_service ON service_documents(service_id);

-- Service-specific frequently asked questions ------------------------------
CREATE TABLE IF NOT EXISTS service_faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_faqs_service ON service_faqs(service_id);

-- Citizen feedback and ratings ----------------------------------------------
CREATE TABLE IF NOT EXISTS service_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rating INTEGER,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  is_public INTEGER NOT NULL DEFAULT 0,
  admin_note TEXT,
  moderated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5))
);
CREATE INDEX IF NOT EXISTS idx_service_feedback_service ON service_feedback(service_id, status);
CREATE INDEX IF NOT EXISTS idx_service_feedback_user ON service_feedback(user_id);

-- Service update subscriptions and published update notes -------------------
CREATE TABLE IF NOT EXISTS service_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  email_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, service_id)
);
CREATE INDEX IF NOT EXISTS idx_service_subscriptions_service ON service_subscriptions(service_id);

CREATE TABLE IF NOT EXISTS service_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  change_type TEXT NOT NULL DEFAULT 'information_update',
  published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_updates_service ON service_updates(service_id, created_at);

-- Version history ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  editor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  change_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_revisions_service ON service_revisions(service_id, revision_number);

-- Private citizen collections ------------------------------------------------
CREATE TABLE IF NOT EXISTS service_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS service_collection_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES service_collections(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (collection_id, service_id)
);

-- Search analytics (no personal data stored) --------------------------------
CREATE TABLE IF NOT EXISTS service_search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT,
  category_slug TEXT,
  municipality_slug TEXT,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_search_log_created ON service_search_log(created_at);

-- Public API clients and usage ----------------------------------------------
CREATE TABLE IF NOT EXISTS api_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT 'services.read',
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS api_request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_client_id INTEGER REFERENCES api_clients(id) ON DELETE SET NULL,
  endpoint TEXT,
  status_code INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_api_request_log_created ON api_request_log(created_at);
