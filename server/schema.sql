PRAGMA foreign_keys = ON;

-- ============================================================
-- BETTERGO MARINDUQUE - CORE DATABASE SCHEMA
-- SQLite. Incremental, additive migrations only.
-- ============================================================

-- 1. GEOGRAPHY -------------------------------------------------
CREATE TABLE IF NOT EXISTS provinces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  region TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS municipalities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  province_id INTEGER NOT NULL REFERENCES provinces(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  municipal_code TEXT,
  description TEXT,
  overview TEXT,
  logo TEXT,
  cover_image TEXT,
  official_website TEXT,
  email TEXT,
  phone TEXT,
  office_address TEXT,
  mayor_name TEXT,
  population INTEGER,
  geographic_info TEXT,
  publication_status TEXT NOT NULL DEFAULT 'published',
  verification_status TEXT NOT NULL DEFAULT 'pending',
  source_reference TEXT,
  source_url TEXT,
  last_verified_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_municipalities_slug ON municipalities(slug);

CREATE TABLE IF NOT EXISTS barangays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  municipality_id INTEGER NOT NULL REFERENCES municipalities(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  geographic_code TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (municipality_id, name)
);
CREATE INDEX IF NOT EXISTS idx_barangays_municipality ON barangays(municipality_id);

-- 2. IDENTITY & ACCESS -----------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  email_verified_at TEXT,
  phone_verified_at TEXT,
  account_status TEXT NOT NULL DEFAULT 'pending_verification',
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(account_status);

CREATE TABLE IF NOT EXISTS user_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  suffix TEXT,
  profile_photo TEXT,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  barangay_id INTEGER REFERENCES barangays(id) ON DELETE SET NULL,
  address TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  display_preference TEXT NOT NULL DEFAULT 'system',
  reduced_motion INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system_role INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  module TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions(module);

CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES user_roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_role_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES user_roles(id) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL DEFAULT 'global',
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  revoked_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_ura_user ON user_role_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_ura_municipality ON user_role_assignments(municipality_id);

CREATE TABLE IF NOT EXISTS email_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  new_email TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT,
  ip_address TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(identifier, created_at);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email_enabled INTEGER NOT NULL DEFAULT 1,
  sms_enabled INTEGER NOT NULL DEFAULT 0,
  in_app_enabled INTEGER NOT NULL DEFAULT 1,
  announcements_enabled INTEGER NOT NULL DEFAULT 1,
  advisories_enabled INTEGER NOT NULL DEFAULT 1,
  updates_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT,
  notification_type TEXT NOT NULL DEFAULT 'system',
  related_entity_type TEXT,
  related_entity_id INTEGER,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id);

-- 3. GOVERNMENT ORGANIZATION -----------------------------------
CREATE TABLE IF NOT EXISTS government_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  department_type TEXT,
  government_level TEXT NOT NULL DEFAULT 'provincial',
  email TEXT,
  phone TEXT,
  address TEXT,
  logo TEXT,
  website TEXT,
  publication_status TEXT NOT NULL DEFAULT 'published',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_departments_municipality ON government_departments(municipality_id);

CREATE TABLE IF NOT EXISTS government_offices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER REFERENCES government_departments(id) ON DELETE SET NULL,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  responsibilities TEXT,
  office_type TEXT,
  category TEXT,
  government_level TEXT NOT NULL DEFAULT 'provincial',
  email TEXT,
  phone TEXT,
  address TEXT,
  operating_hours TEXT,
  website TEXT,
  facebook TEXT,
  latitude REAL,
  longitude REAL,
  image TEXT,
  publication_status TEXT NOT NULL DEFAULT 'draft',
  verification_status TEXT NOT NULL DEFAULT 'pending',
  source_reference TEXT,
  source_url TEXT,
  last_verified_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_offices_municipality ON government_offices(municipality_id);
CREATE INDEX IF NOT EXISTS idx_offices_level ON government_offices(government_level, publication_status);

CREATE TABLE IF NOT EXISTS office_municipalities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  office_id INTEGER NOT NULL REFERENCES government_offices(id) ON DELETE CASCADE,
  municipality_id INTEGER NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  UNIQUE (office_id, municipality_id)
);

CREATE TABLE IF NOT EXISTS government_officials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES government_departments(id) ON DELETE SET NULL,
  office_id INTEGER REFERENCES government_offices(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  position TEXT,
  biography TEXT,
  profile_photo TEXT,
  official_email TEXT,
  public_contact_number TEXT,
  term_start TEXT,
  term_end TEXT,
  publication_status TEXT NOT NULL DEFAULT 'draft',
  verification_status TEXT NOT NULL DEFAULT 'pending',
  source_reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. SERVICES ---------------------------------------------------
CREATE TABLE IF NOT EXISTS service_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS government_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES service_categories(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES government_departments(id) ON DELETE SET NULL,
  office_id INTEGER REFERENCES government_offices(id) ON DELETE SET NULL,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  eligibility TEXT,
  processing_time TEXT,
  fees TEXT,
  payment_instructions TEXT,
  application_procedure TEXT,
  requirements TEXT,
  official_link TEXT,
  service_type TEXT,
  coverage_type TEXT NOT NULL DEFAULT 'province_wide',
  publication_status TEXT NOT NULL DEFAULT 'draft',
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verified_at TEXT,
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source_reference TEXT,
  last_reviewed_at TEXT,
  published_at TEXT,
  archived_at TEXT,
  is_featured INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_services_category ON government_services(category_id);
CREATE INDEX IF NOT EXISTS idx_services_municipality ON government_services(municipality_id);
CREATE INDEX IF NOT EXISTS idx_services_status ON government_services(publication_status, verification_status);

CREATE TABLE IF NOT EXISTS service_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  requirement_name TEXT NOT NULL,
  description TEXT,
  is_required INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_requirements_service ON service_requirements(service_id);

CREATE TABLE IF NOT EXISTS service_procedures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  description TEXT,
  office TEXT,
  location TEXT,
  link TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, service_id)
);

-- 5. ANNOUNCEMENTS ----------------------------------------------
CREATE TABLE IF NOT EXISTS announcement_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES announcement_categories(id) ON DELETE SET NULL,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  summary TEXT,
  content TEXT,
  featured_image TEXT,
  announcement_type TEXT NOT NULL DEFAULT 'update',
  priority TEXT NOT NULL DEFAULT 'normal',
  coverage TEXT NOT NULL DEFAULT 'province',
  source_type TEXT NOT NULL DEFAULT 'bettergo',
  source_organization TEXT,
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  verified_at TEXT,
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  publication_status TEXT NOT NULL DEFAULT 'draft',
  is_featured INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  effective_at TEXT,
  expires_at TEXT,
  archived_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(publication_status, published_at);
CREATE INDEX IF NOT EXISTS idx_announcements_municipality ON announcements(municipality_id);
CREATE INDEX IF NOT EXISTS idx_announcements_category ON announcements(category_id);

CREATE TABLE IF NOT EXISTS announcement_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  title TEXT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. TRANSPARENCY ------------------------------------------------
CREATE TABLE IF NOT EXISTS transparency_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  record_category TEXT NOT NULL,
  government_level TEXT NOT NULL DEFAULT 'provincial',
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  issuing_office TEXT,
  fiscal_year INTEGER,
  period_label TEXT,
  publication_status TEXT NOT NULL DEFAULT 'draft',
  verification_status TEXT NOT NULL DEFAULT 'pending',
  source_url TEXT,
  source_organization TEXT,
  publication_date TEXT,
  last_verified_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transparency_status ON transparency_records(publication_status, record_category);
CREATE INDEX IF NOT EXISTS idx_transparency_municipality ON transparency_records(municipality_id);

CREATE TABLE IF NOT EXISTS financial_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year INTEGER NOT NULL,
  financial_category TEXT NOT NULL,
  government_level TEXT NOT NULL DEFAULT 'provincial',
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  department_name TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PHP',
  period_label TEXT,
  source_reference TEXT,
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_financial_year ON financial_records(fiscal_year, financial_category);

CREATE TABLE IF NOT EXISTS public_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  document_category TEXT NOT NULL,
  issuing_organization TEXT,
  government_level TEXT NOT NULL DEFAULT 'provincial',
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  fiscal_year INTEGER,
  publication_date TEXT,
  file_name TEXT,
  file_path TEXT,
  file_type TEXT,
  file_size INTEGER,
  source_url TEXT,
  publication_status TEXT NOT NULL DEFAULT 'draft',
  verification_status TEXT NOT NULL DEFAULT 'pending',
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_status ON public_documents(publication_status, document_category);

-- 7. EMERGENCY ---------------------------------------------------
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_name TEXT NOT NULL,
  category TEXT NOT NULL,
  facility_type TEXT,
  government_level TEXT NOT NULL DEFAULT 'national',
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  description TEXT,
  phone TEXT,
  alt_phone TEXT,
  address TEXT,
  email TEXT,
  website TEXT,
  operating_hours TEXT,
  services TEXT,
  latitude REAL,
  longitude REAL,
  publication_status TEXT NOT NULL DEFAULT 'draft',
  verification_status TEXT NOT NULL DEFAULT 'pending',
  source_reference TEXT,
  source_url TEXT,
  last_verified_at TEXT,
  next_review_at TEXT,
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_emergency_category ON emergency_contacts(category, publication_status);
CREATE INDEX IF NOT EXISTS idx_emergency_municipality ON emergency_contacts(municipality_id);

-- 8. CITIZEN PARTICIPATION --------------------------------------
CREATE TABLE IF NOT EXISTS citizen_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'feedback',
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  internal_notes TEXT,
  resolution TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON citizen_reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_municipality ON citizen_reports(municipality_id);

CREATE TABLE IF NOT EXISTS correction_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  target_label TEXT,
  field TEXT,
  description TEXT NOT NULL,
  contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

-- 9. ADMINISTRATION / SYSTEM ------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT,
  setting_type TEXT NOT NULL DEFAULT 'string',
  setting_group TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  is_public INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_settings_group ON system_settings(setting_group);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  module TEXT,
  entity_type TEXT,
  entity_id INTEGER,
  old_values TEXT,
  new_values TEXT,
  ip_address TEXT,
  user_agent TEXT,
  result TEXT NOT NULL DEFAULT 'success',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module);

-- 10. CMS --------------------------------------------------------
CREATE TABLE IF NOT EXISTS cms_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  section TEXT NOT NULL DEFAULT 'general',
  excerpt TEXT,
  content TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'draft',
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  seo_title TEXT,
  seo_description TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cms_status ON cms_pages(status, section);

CREATE TABLE IF NOT EXISTS cms_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  revision_number INTEGER NOT NULL,
  snapshot TEXT,
  editor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  change_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decision TEXT NOT NULL,
  comments TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  original_name TEXT,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS homepage_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_key TEXT NOT NULL UNIQUE,
  title TEXT,
  subtitle TEXT,
  body TEXT,
  settings TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 11. PRIVACY & LEGAL -------------------------------------------
CREATE TABLE IF NOT EXISTS consent_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  consent_category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'granted',
  policy_version TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_consent_user ON consent_records(user_id);

CREATE TABLE IF NOT EXISTS data_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requester_name TEXT,
  requester_email TEXT,
  category TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  review_notes TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_data_requests_user ON data_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_data_requests_status ON data_requests(status);

CREATE TABLE IF NOT EXISTS privacy_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'reported',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS legal_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '0.9-draft',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  effective_date TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (doc_type, version)
);

CREATE TABLE IF NOT EXISTS retention_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_category TEXT NOT NULL,
  purpose TEXT,
  retention_period TEXT,
  legal_basis TEXT,
  disposal_method TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS security_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  affected_area TEXT,
  reproduction_steps TEXT,
  impact TEXT,
  contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS data_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

-- 12. CONTENT WORKFLOW COMMENTS --------------------------------
CREATE TABLE IF NOT EXISTS workflow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
