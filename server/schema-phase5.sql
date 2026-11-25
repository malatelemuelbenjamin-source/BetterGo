-- Phase 5 — financial transparency foundation. Extends the existing
-- financial_records table (Prompt 87) instead of duplicating it, and adds
-- reporting periods, classification mapping, imports and version history.
-- Nothing here seeds budgets, expenditures or any government figure.

CREATE TABLE IF NOT EXISTS transparency_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  government_level TEXT NOT NULL DEFAULT 'provincial',
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  fiscal_year INTEGER NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'annual',
  period_label TEXT NOT NULL,
  starts_on TEXT,
  ends_on TEXT,
  published_on TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (government_level, municipality_id, fiscal_year, period_type, period_label)
);
CREATE INDEX IF NOT EXISTS idx_transparency_periods_scope ON transparency_periods(municipality_id, fiscal_year);

CREATE TABLE IF NOT EXISTS finance_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS finance_record_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES financial_records(id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL,
  change_note TEXT,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_finance_versions_record ON finance_record_versions(record_id, id DESC);

CREATE TABLE IF NOT EXISTS finance_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  government_level TEXT NOT NULL DEFAULT 'provincial',
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  record_type TEXT NOT NULL,
  filename TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  errors TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
