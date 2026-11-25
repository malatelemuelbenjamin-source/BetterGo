-- Phase 5, part two — monitoring, reports, open data, alerts and community.
-- Additive only: no existing table or column is replaced. No financial finding,
-- dataset, report or discussion is seeded; only neutral rule/template metadata
-- is inserted idempotently by server/seed-phase5b.js.

CREATE TABLE IF NOT EXISTS monitoring_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  module TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monitoring_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  rule_key TEXT NOT NULL,
  record_reference TEXT,
  entity_level TEXT NOT NULL DEFAULT 'provincial',
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  module TEXT,
  issue_code TEXT NOT NULL,
  description TEXT NOT NULL,
  period_label TEXT,
  fiscal_year INTEGER,
  methodology TEXT,
  source_references TEXT NOT NULL DEFAULT '[]',
  detection_date TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  review_status TEXT NOT NULL DEFAULT 'new',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  published_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_monitoring_findings_unique
  ON monitoring_findings(rule_key, COALESCE(record_reference, ''), entity_level, COALESCE(municipality_id, -1), issue_code);
CREATE INDEX IF NOT EXISTS idx_monitoring_findings_status ON monitoring_findings(review_status, severity);
CREATE INDEX IF NOT EXISTS idx_monitoring_findings_record ON monitoring_findings(record_reference);

CREATE TABLE IF NOT EXISTS monitoring_finding_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id INTEGER NOT NULL REFERENCES monitoring_findings(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  note TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monitoring_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  record_reference TEXT,
  description TEXT NOT NULL,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  submitter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  finding_id INTEGER REFERENCES monitoring_findings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_monitoring_observations_status ON monitoring_observations(status);

CREATE TABLE IF NOT EXISTS monitoring_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_key TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  records_checked INTEGER NOT NULL DEFAULT 0,
  findings_created INTEGER NOT NULL DEFAULT 0,
  findings_updated INTEGER NOT NULL DEFAULT 0,
  triggered_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS report_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  sections TEXT NOT NULL DEFAULT '[]',
  default_filters TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  official_source INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  template_slug TEXT,
  filters TEXT NOT NULL DEFAULT '{}',
  sections TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  shared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_generated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_report_configs_user ON report_configs(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS report_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id INTEGER REFERENCES report_configs(id) ON DELETE SET NULL,
  public_id TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  source_versions TEXT NOT NULL DEFAULT '[]',
  row_count INTEGER NOT NULL DEFAULT 0,
  snapshot_hash TEXT,
  payload TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_report_generations_public ON report_generations(public_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS report_export_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT,
  format TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  byte_size INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS open_datasets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  entity_level TEXT NOT NULL DEFAULT 'provincial',
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  period_label TEXT,
  fiscal_year INTEGER,
  source_institution TEXT,
  source_reference TEXT,
  source_url TEXT,
  amount_kind TEXT,
  category_key TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  coverage TEXT,
  methodology TEXT,
  limitations TEXT,
  license_note TEXT,
  update_frequency TEXT,
  data_dictionary TEXT NOT NULL DEFAULT '[]',
  record_types TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  published_at TEXT,
  archived_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_open_datasets_status ON open_datasets(status, category, entity_level);

CREATE TABLE IF NOT EXISTS open_dataset_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id INTEGER NOT NULL REFERENCES open_datasets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  change_note TEXT,
  snapshot TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (dataset_id, version)
);

CREATE TABLE IF NOT EXISTS open_dataset_downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id INTEGER NOT NULL REFERENCES open_datasets(id) ON DELETE CASCADE,
  dataset_version INTEGER NOT NULL,
  format TEXT NOT NULL,
  fiscal_year INTEGER,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_open_dataset_downloads_dataset ON open_dataset_downloads(dataset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transparency_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transparency_subscriptions_unique
  ON transparency_subscriptions(user_id, topic, COALESCE(municipality_id, -1));
CREATE INDEX IF NOT EXISTS idx_transparency_subscriptions_user ON transparency_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS transparency_alert_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  in_app INTEGER NOT NULL DEFAULT 1,
  email_opt_in INTEGER NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'immediate',
  quiet_start TEXT,
  quiet_end TEXT,
  paused_until TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Manila',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transparency_alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  record_reference TEXT,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  category TEXT,
  period_label TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transparency_alert_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES transparency_alert_events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'in_app',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, user_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_transparency_alert_deliveries_user ON transparency_alert_deliveries(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transparency_alert_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transparency_alert_digest_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL,
  event_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS community_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS community_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'question',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  topic_slug TEXT NOT NULL,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  record_reference TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_review',
  moderation_note TEXT,
  featured INTEGER NOT NULL DEFAULT 0,
  answered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_community_threads_public ON community_threads(status, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_threads_user ON community_threads(user_id);

CREATE TABLE IF NOT EXISTS community_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES community_posts(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_review',
  moderation_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_community_posts_thread ON community_posts(thread_id, status, created_at);

CREATE TABLE IF NOT EXISTS community_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER REFERENCES community_threads(id) ON DELETE CASCADE,
  post_id INTEGER REFERENCES community_posts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  institution TEXT,
  url TEXT NOT NULL,
  published_on TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS community_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS community_appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  thread_id INTEGER REFERENCES community_threads(id) ON DELETE CASCADE,
  post_id INTEGER REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decision_note TEXT,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS community_contributors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio TEXT,
  expertise TEXT NOT NULL DEFAULT '[]',
  credentials_text TEXT,
  verification_status TEXT NOT NULL DEFAULT 'self_declared',
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS community_moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
