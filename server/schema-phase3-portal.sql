-- Phase 3 — municipal portal modules (Prompts 44–56).
-- Additive only. New columns on existing tables are applied by db.js.

-- Shared update stream for projects and programs (progress notes, milestones,
-- public status reports). One row per published public update.
CREATE TABLE IF NOT EXISTS municipal_content_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id INTEGER NOT NULL REFERENCES municipal_content(id) ON DELETE CASCADE,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  update_type TEXT NOT NULL DEFAULT 'update',
  title TEXT,
  description TEXT,
  reported_on TEXT,
  progress_percent INTEGER,
  source_reference TEXT,
  source_url TEXT,
  publication_status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_municipal_updates_content
  ON municipal_content_updates(content_id, reported_on DESC);

-- Citizen corrections, feedback and public inquiries. Reviewed by an
-- administrator; never changes official records directly.
CREATE TABLE IF NOT EXISTS municipal_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  content_id INTEGER REFERENCES municipal_content(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'correction',
  name TEXT,
  email TEXT,
  message TEXT NOT NULL,
  page_url TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  response TEXT,
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_municipal_feedback_status
  ON municipal_feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_municipal_feedback_municipality
  ON municipal_feedback(municipality_id, created_at DESC);

-- Email subscriptions to municipal updates. Double opt-in: a subscription is
-- only active after the confirmation token is used.
CREATE TABLE IF NOT EXISTS municipal_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  municipality_id INTEGER NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  topics TEXT,
  token TEXT NOT NULL,
  confirmed_at TEXT,
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (municipality_id, email)
);

CREATE INDEX IF NOT EXISTS idx_municipal_subscriptions_token ON municipal_subscriptions(token);

-- Aggregated, privacy-preserving portal usage counters. No visitor identifiers,
-- no IP addresses: only a daily count per municipality and metric.
CREATE TABLE IF NOT EXISTS municipal_analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  municipality_id INTEGER NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  day TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  UNIQUE (municipality_id, metric, day)
);

-- Prompt 57 audit: indexes for the public listing and filter paths.
CREATE INDEX IF NOT EXISTS idx_municipal_content_public_type
  ON municipal_content(municipality_id, content_type, publication_status, published_at);
CREATE INDEX IF NOT EXISTS idx_municipal_content_public_status
  ON municipal_content(content_type, publication_status, published_at);
CREATE INDEX IF NOT EXISTS idx_government_offices_public
  ON government_offices(municipality_id, publication_status);
CREATE INDEX IF NOT EXISTS idx_public_documents_public
  ON public_documents(municipality_id, publication_status, publication_date);
CREATE INDEX IF NOT EXISTS idx_municipal_analytics_day
  ON municipal_analytics(municipality_id, day);
