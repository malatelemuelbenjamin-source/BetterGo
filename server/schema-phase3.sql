-- Phase 3 — LGU and Municipal Portal foundation.
-- Additive only: every statement is safe to run on an existing database.
-- New columns on existing tables are applied by db.js (ensureColumn).

-- Municipality-specific content that has no dedicated Phase 1/2 table yet:
-- news, public notices, programs, projects, resources, FAQs, contact blocks.
-- Announcements remain in the Phase 1 `announcements` table and offices and
-- services keep their Phase 2 tables; this table never duplicates them.
CREATE TABLE IF NOT EXISTS municipal_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  municipality_id INTEGER NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL DEFAULT 'news',
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT,
  body TEXT,
  featured_image TEXT,
  image_alt TEXT,
  image_credit TEXT,
  external_url TEXT,
  contact_details TEXT,
  source_reference TEXT,
  source_url TEXT,
  publication_status TEXT NOT NULL DEFAULT 'draft',
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verification_notes TEXT,
  is_featured INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  published_at TEXT,
  archived_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rejected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (municipality_id, content_type, slug)
);

CREATE INDEX IF NOT EXISTS idx_municipal_content_public
  ON municipal_content(municipality_id, content_type, publication_status);
CREATE INDEX IF NOT EXISTS idx_municipal_content_slug ON municipal_content(slug);
CREATE INDEX IF NOT EXISTS idx_municipal_content_published ON municipal_content(published_at);

-- Version history for municipal content. One immutable JSON snapshot per save
-- so published records can always be traced back.
CREATE TABLE IF NOT EXISTS municipal_content_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id INTEGER NOT NULL REFERENCES municipal_content(id) ON DELETE CASCADE,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  snapshot TEXT NOT NULL,
  change_summary TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_municipal_content_revisions_content
  ON municipal_content_revisions(content_id, id DESC);
