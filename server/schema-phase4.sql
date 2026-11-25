-- ===========================================================================
-- Phase 4 — Citizen Accounts and Digital Services
--
-- Additive only. These tables prepare the citizen account foundation
-- (Prompt 58). They do not represent government application processing:
-- no LGU has authorised BetterGo to submit, approve or issue anything.
-- ===========================================================================

-- Privacy-conscious activity history. Only the actions listed in
-- server/lib/citizen.js are recorded, and only for the account owner.
CREATE TABLE IF NOT EXISTS citizen_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  entity_label TEXT,
  entity_slug TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_citizen_activities_user ON citizen_activities(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_citizen_activities_user_type ON citizen_activities(user_id, activity_type, created_at);

-- Application tracking foundation. Records here are BetterGo-side tracking
-- containers only; submission and any government status must be wired up by a
-- later prompt and an authorised integration.
CREATE TABLE IF NOT EXISTS citizen_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  service_id INTEGER REFERENCES government_services(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  citizen_status_note TEXT,
  internal_notes TEXT,
  assigned_office_id INTEGER REFERENCES government_offices(id) ON DELETE SET NULL,
  source_reference TEXT,
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_citizen_applications_user ON citizen_applications(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_citizen_applications_status ON citizen_applications(status);

CREATE TABLE IF NOT EXISTS citizen_application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES citizen_applications(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  citizen_visible INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_citizen_application_events ON citizen_application_events(application_id, id);

-- Private document vault metadata. Storage references are never public and no
-- citizen document is served from the public uploads path.
CREATE TABLE IF NOT EXISTS citizen_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other',
  original_filename TEXT NOT NULL,
  storage_reference TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  retention_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_citizen_documents_user ON citizen_documents(user_id, id DESC);

-- Security-relevant account events, kept separate from the administrative audit
-- log so a citizen can review their own account activity without seeing
-- internal moderation details.
CREATE TABLE IF NOT EXISTS account_security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_account_security_events_user ON account_security_events(user_id, id DESC);

-- Prompt 59 — optional mobile verification. Codes are stored hashed, expire
-- after 10 minutes and are limited to five attempts.
CREATE TABLE IF NOT EXISTS phone_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_phone_verifications_user ON phone_verifications(user_id, id DESC);

-- Prompt 60 — optional TOTP multi-factor authentication. The shared secret is
-- encrypted with a key derived from SESSION_SECRET, never stored in clear.
CREATE TABLE IF NOT EXISTS user_mfa (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  enabled_at TEXT,
  last_used_step INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_mfa_backup_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mfa_backup_user ON user_mfa_backup_codes(user_id);

-- Prompt 63 reuses the private service_collections tables already created in
-- Phase 2. Only the optional per-item note needs adding; do.js handles that
-- additively so no second collection system exists.

-- Prompt 61 — profile completion, preferences and privacy ---------------------
-- Only field categories and outcomes are kept: never old values of sensitive
-- personal data.
CREATE TABLE IF NOT EXISTS profile_change_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_category TEXT NOT NULL,
  changed_fields TEXT,
  outcome TEXT NOT NULL DEFAULT 'success',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profile_change_events_user ON profile_change_events(user_id, created_at DESC);

-- Optional personalization interests (Prompt 61 §9). All rows are opt-in.
CREATE TABLE IF NOT EXISTS citizen_interests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest_key TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, interest_key)
);

-- Prompt 62 — citizen dashboard widget layout. One row per widget per citizen.
CREATE TABLE IF NOT EXISTS dashboard_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  widget_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, widget_key)
);

-- Prompt 63 — one bookmark table for every saveable public record type.
CREATE TABLE IF NOT EXISTS saved_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, content_type, content_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_items_user ON saved_items(user_id, created_at DESC);

-- Prompt 64 — service-linked digital forms, drafts and submissions.
CREATE TABLE IF NOT EXISTS service_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  privacy_notice TEXT,
  privacy_notice_version TEXT NOT NULL DEFAULT 'v1',
  audience TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  submission_classification TEXT NOT NULL DEFAULT 'bettergo_intake',
  source_reference TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  published_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_forms_service ON service_forms(service_id, status);

CREATE TABLE IF NOT EXISTS service_form_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL REFERENCES service_forms(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL,
  section TEXT,
  description TEXT,
  placeholder TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  options TEXT,
  validation TEXT,
  conditional TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (form_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_service_form_fields_form ON service_form_fields(form_id, sort_order);

CREATE TABLE IF NOT EXISTS service_form_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  form_id INTEGER NOT NULL REFERENCES service_forms(id) ON DELETE CASCADE,
  form_version INTEGER NOT NULL DEFAULT 1,
  answers TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, form_id)
);

-- Prompt 65 — review assignment and closure fields on BetterGo records.
-- Prompt 66 — personal document vault. Files live outside the public uploads
-- directory and are only served after an ownership check.
CREATE TABLE IF NOT EXISTS document_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS document_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES citizen_documents(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_label TEXT NOT NULL,
  purpose TEXT NOT NULL,
  consented_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS document_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES citizen_documents(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_document_events_doc ON document_events(document_id, id DESC);

-- Prompt 67 — digital records centre. Retention policies are opt-in: an empty
-- table means nothing is deleted or archived automatically. Privacy request
-- statuses are BetterGo workflows, never government adjudication.
CREATE TABLE IF NOT EXISTS retention_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL UNIQUE,
  retention_days INTEGER,
  description TEXT,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS record_archive_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  reason TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_record_archive_events_record ON record_archive_events(record_type, record_id, id DESC);

CREATE TABLE IF NOT EXISTS privacy_request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES data_requests(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_privacy_request_events_request ON privacy_request_events(request_id, id);

-- Prompt 68 — notification centre: categories, archive state, delivery records,
-- reusable templates, municipality follows and approved campaigns. A delivery
-- row is only created for a channel that is configured; in-app is the only
-- channel active by default.
CREATE TABLE IF NOT EXISTS notification_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  municipality_id INTEGER NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, municipality_id)
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  variables TEXT,
  channel TEXT NOT NULL DEFAULT 'in_app',
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  detail TEXT,
  provider_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user ON notification_deliveries(user_id, id DESC);

CREATE TABLE IF NOT EXISTS notification_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'announcement',
  template_id INTEGER REFERENCES notification_templates(id) ON DELETE SET NULL,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompt 69 — help centre and BetterGo support tickets. These are platform
-- support records, never LGU complaints or official assistance requests.
CREATE TABLE IF NOT EXISTS support_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS support_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  category_id INTEGER REFERENCES support_categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'draft',
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_support_articles_status ON support_articles(status, category_id);

CREATE TABLE IF NOT EXISTS support_article_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES support_articles(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helpful INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (article_id, user_id)
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES support_categories(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  issue_type TEXT,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  application_reference TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  priority TEXT NOT NULL DEFAULT 'normal',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  satisfaction_rating INTEGER,
  feedback TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, priority);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_role TEXT NOT NULL DEFAULT 'citizen',
  body TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages ON support_ticket_messages(ticket_id, id);

CREATE TABLE IF NOT EXISTS support_ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS support_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES support_ticket_messages(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  storage_reference TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO support_categories (key, name, description, sort_order) VALUES
  ('account_registration', 'Account registration', 'Creating and confirming a BetterGo account.', 1),
  ('login_recovery', 'Login and account recovery', 'Sign-in, password reset and account recovery.', 2),
  ('profile', 'Profile management', 'Updating your name, contact details and preferences.', 3),
  ('service_directory', 'Government service directory', 'Finding published service information.', 4),
  ('digital_forms', 'Digital service forms', 'Filling in BetterGo forms and saving drafts.', 5),
  ('applications', 'Application submission and tracking', 'BetterGo intake records and status tracking.', 6),
  ('document_vault', 'Personal document vault', 'Uploading and managing your own documents.', 7),
  ('notifications', 'Notifications', 'In-app notifications and preferences.', 8),
  ('privacy_security', 'Privacy and account security', 'Consent, data requests and account protection.', 9),
  ('technical', 'Technical problems', 'Errors, broken pages and unexpected behaviour.', 10),
  ('accessibility', 'Accessibility assistance', 'Using BetterGo with assistive technology.', 11),
  ('general', 'General platform inquiries', 'Other questions about the BetterGo platform.', 12);

-- Prompt 70 — platform feedback, feature suggestions and independent community
-- surveys. None of these is an official LGU consultation or complaint.
CREATE TABLE IF NOT EXISTS feedback_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS citizen_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  anonymous INTEGER NOT NULL DEFAULT 0,
  category_id INTEGER REFERENCES feedback_categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  related_feature TEXT,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  rating INTEGER,
  status TEXT NOT NULL DEFAULT 'new',
  admin_response TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_citizen_feedback_user ON citizen_feedback(user_id, id DESC);

CREATE TABLE IF NOT EXISTS feature_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES feedback_categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  problem TEXT,
  proposal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  admin_note TEXT,
  public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feature_suggestions_status ON feature_suggestions(status, public);

CREATE TABLE IF NOT EXISTS suggestion_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_id INTEGER NOT NULL REFERENCES feature_suggestions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (suggestion_id, user_id)
);

CREATE TABLE IF NOT EXISTS surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  audience TEXT NOT NULL DEFAULT 'all_citizens',
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  intro TEXT,
  privacy_notice TEXT,
  completion_message TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  allow_anonymous INTEGER NOT NULL DEFAULT 0,
  one_per_account INTEGER NOT NULL DEFAULT 1,
  opens_at TEXT,
  closes_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS survey_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  label TEXT NOT NULL,
  question_type TEXT NOT NULL,
  options TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (survey_id, question_key)
);

CREATE TABLE IF NOT EXISTS survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  anonymous INTEGER NOT NULL DEFAULT 0,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id, id DESC);

CREATE TABLE IF NOT EXISTS survey_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id INTEGER NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_survey_answers_response ON survey_answers(response_id);

INSERT OR IGNORE INTO feedback_categories (key, name, description, sort_order) VALUES
  ('website_usability', 'Website usability', NULL, 1),
  ('mobile_experience', 'Mobile experience', NULL, 2),
  ('directory_accuracy', 'Government services directory accuracy', NULL, 3),
  ('municipal_information', 'Municipal portal information', NULL, 4),
  ('digital_forms', 'Digital application forms', NULL, 5),
  ('application_tracking', 'Application tracking experience', NULL, 6),
  ('document_vault', 'Personal document vault', NULL, 7),
  ('notifications', 'Notification experience', NULL, 8),
  ('help_support', 'Help centre and support', NULL, 9),
  ('accessibility', 'Accessibility', NULL, 10),
  ('feature_request', 'Feature requests', NULL, 11),
  ('general_suggestion', 'General suggestions', NULL, 12);

-- Prompt 71 — privacy centre. Notices are versioned so historical consent
-- records keep pointing at the notice version that was actually accepted.
CREATE TABLE IF NOT EXISTS privacy_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  version TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'draft',
  effective_at TEXT,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (doc_type, version, language)
);
CREATE INDEX IF NOT EXISTS idx_privacy_notices_status ON privacy_notices(doc_type, status);

CREATE TABLE IF NOT EXISTS account_deactivations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'deactivated',
  reason TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  reinstated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_deactivations_user ON account_deactivations(user_id, id DESC);

-- Prompt 72 — service discovery configuration. Recommendations are rules-based
-- and every suggestion must carry a reason drawn from stored data.
CREATE TABLE IF NOT EXISTS discovery_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  personalization_enabled INTEGER NOT NULL DEFAULT 1,
  history_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  related_service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'related',
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (service_id, related_service_id, relationship)
);

CREATE TABLE IF NOT EXISTS finder_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'single_choice',
  options TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- Prompt 73 — preparation plans and checklists. A checklist is a private
-- preparation aid; it is never an eligibility decision or official status.
CREATE TABLE IF NOT EXISTS preparation_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, service_id)
);

CREATE TABLE IF NOT EXISTS preparation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES preparation_plans(id) ON DELETE CASCADE,
  requirement_id INTEGER REFERENCES service_requirements(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  mandatory INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'not_started',
  note TEXT,
  document_id INTEGER REFERENCES citizen_documents(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_preparation_items_plan ON preparation_items(plan_id, id);

CREATE TABLE IF NOT EXISTS preparation_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES preparation_plans(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remind_at TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

-- Prompt 74 — appointments. Slots are configured by offices; BetterGo never
-- invents availability. A BetterGo reference is not an official reference.
CREATE TABLE IF NOT EXISTS appointment_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL UNIQUE REFERENCES government_services(id) ON DELETE CASCADE,
  appointment_mode TEXT NOT NULL DEFAULT 'none',
  external_url TEXT,
  instructions TEXT,
  booking_window_days INTEGER NOT NULL DEFAULT 14,
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  capacity_per_slot INTEGER NOT NULL DEFAULT 1,
  cancellation_notice_hours INTEGER NOT NULL DEFAULT 24,
  reschedule_notice_hours INTEGER NOT NULL DEFAULT 24,
  office_name TEXT,
  location TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointment_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  office_name TEXT,
  slot_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  booked INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (service_id, slot_date, start_time)
);
CREATE INDEX IF NOT EXISTS idx_appointment_slots_service_date ON appointment_slots(service_id, slot_date);

CREATE TABLE IF NOT EXISTS appointment_blackouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER REFERENCES government_services(id) ON DELETE CASCADE,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  blackout_date TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE RESTRICT,
  slot_id INTEGER REFERENCES appointment_slots(id) ON DELETE SET NULL,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  office_name TEXT,
  location TEXT,
  appointment_date TEXT,
  appointment_time TEXT,
  status TEXT NOT NULL DEFAULT 'pending_confirmation',
  citizen_note TEXT,
  internal_note TEXT,
  decision_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_service_date ON appointments(service_id, appointment_date);

CREATE TABLE IF NOT EXISTS appointment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL DEFAULT 'citizen',
  actor_id INTEGER,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appointment_events_appointment ON appointment_events(appointment_id, id);

-- Prompt 75 — fee information and payment foundation. No live integration is
-- enabled by default; only verified provider callbacks can mark a transaction paid.
-- Fee columns are added to the existing Phase 2 service_fees table in db.js.

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  method_type TEXT NOT NULL,
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'unavailable',
  instructions TEXT,
  official_url TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE RESTRICT,
  fee_id INTEGER REFERENCES service_fees(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PHP',
  status TEXT NOT NULL DEFAULT 'instructions_available',
  provider TEXT,
  provider_reference TEXT,
  payee TEXT,
  purpose TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user ON payment_transactions(user_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_provider_ref ON payment_transactions(provider, provider_reference) WHERE provider_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES payment_transactions(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompt 76 — document request tracking. BetterGo records a request and its
-- status; it never issues, certifies or releases an official document.
CREATE TABLE IF NOT EXISTS document_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE RESTRICT,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  office_name TEXT,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  office_note TEXT,
  internal_note TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_document_requests_user ON document_requests(user_id, id DESC);

CREATE TABLE IF NOT EXISTS document_request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES document_requests(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_type TEXT NOT NULL DEFAULT 'citizen',
  actor_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompt 77 — citizen complaints and case tracking. Cases are platform records;
-- a status here is not an official government decision.
CREATE TABLE IF NOT EXISTS complaint_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  location_text TEXT,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  office_id INTEGER REFERENCES government_offices(id) ON DELETE SET NULL,
  service_id INTEGER REFERENCES government_services(id) ON DELETE SET NULL,
  severity TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'new',
  confidential INTEGER NOT NULL DEFAULT 0,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolution_summary TEXT,
  internal_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_complaint_cases_user ON complaint_cases(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_complaint_cases_status ON complaint_cases(status, municipality_id);

CREATE TABLE IF NOT EXISTS complaint_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES complaint_cases(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES citizen_documents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (case_id, document_id)
);

CREATE TABLE IF NOT EXISTS complaint_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES complaint_cases(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_type TEXT NOT NULL DEFAULT 'citizen',
  actor_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompt 78 — identity/trust requests. BetterGo cannot verify government IDs
-- itself; only an authorized office review can record a verified status.
CREATE TABLE IF NOT EXISTS identity_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verification_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  method TEXT,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  office_id INTEGER REFERENCES government_offices(id) ON DELETE SET NULL,
  citizen_note TEXT,
  office_note TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_identity_verifications_user ON identity_verifications(user_id, id DESC);

-- Prompt 79 — delegated access. Delegates get read-only summaries for explicit
-- scopes; they never receive passwords, documents or account-control powers.
CREATE TABLE IF NOT EXISTS access_delegations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegate_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relationship TEXT,
  scopes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT,
  revoked_at TEXT,
  UNIQUE (owner_user_id, delegate_user_id)
);
CREATE INDEX IF NOT EXISTS idx_access_delegations_delegate ON access_delegations(delegate_user_id, status);

CREATE TABLE IF NOT EXISTS delegation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id INTEGER NOT NULL REFERENCES access_delegations(id) ON DELETE CASCADE,
  actor_user_id INTEGER,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompt 80 — consent choices, data-sharing authorizations and typed-name
-- signature records. These are BetterGo platform records only: no LGU issues,
-- confirms or endorses a signature created here.
CREATE TABLE IF NOT EXISTS electronic_signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  statement_key TEXT NOT NULL,
  statement_text TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  subject_reference TEXT,
  status TEXT NOT NULL DEFAULT 'recorded',
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TEXT,
  acknowledgement_note TEXT,
  signed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_electronic_signatures_user ON electronic_signatures(user_id, id DESC);

CREATE TABLE IF NOT EXISTS consent_authorizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_name TEXT NOT NULL,
  recipient_organization TEXT NOT NULL,
  purpose TEXT NOT NULL,
  categories TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  signature_id INTEGER REFERENCES electronic_signatures(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_consent_authorizations_user ON consent_authorizations(user_id, id DESC);

-- Prompt 82 — offline service information packs. A pack freezes published
-- service information for printing or reading without a connection. It is a
-- snapshot, not a live government record, and is never treated as current.
CREATE TABLE IF NOT EXISTS service_info_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  service_ids TEXT NOT NULL DEFAULT '[]',
  snapshot TEXT NOT NULL DEFAULT '[]',
  item_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_service_info_packs_user ON service_info_packs(user_id, id DESC);

-- Prompt 83 — language access. A translation is a BetterGo-prepared reading
-- aid unless it is explicitly recorded as confirmed by the responsible office.
-- Immigrant/community languages beyond English and Filipino are requested, not
-- invented.
CREATE TABLE IF NOT EXISTS service_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  language TEXT NOT NULL DEFAULT 'fil',
  title TEXT NOT NULL,
  summary TEXT,
  eligibility TEXT,
  requirements TEXT,
  fees TEXT,
  procedure TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  source TEXT,
  translated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (service_id, language)
);
CREATE INDEX IF NOT EXISTS idx_service_translations_service ON service_translations(service_id, language);

CREATE TABLE IF NOT EXISTS translation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  service_id INTEGER REFERENCES government_services(id) ON DELETE SET NULL,
  language TEXT NOT NULL DEFAULT 'fil',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  response_note TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_translation_requests_user ON translation_requests(user_id, id DESC);

-- Prompt 84 — data portability and account closure requests. An export is a
-- copy of the citizen's own BetterGo records; it never includes government
-- records BetterGo does not hold, passwords or session secrets. A closure
-- request is reviewed; nothing is deleted by the request itself.
-- data_exports already exists from Phase 1; Prompt 84 extends it in server/db.js
-- with reference, status, sections, record_counts, payload and downloaded_at.
CREATE INDEX IF NOT EXISTS idx_data_exports_user ON data_exports(user_id, id DESC);

CREATE TABLE IF NOT EXISTS account_closure_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  review_note TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_closure_user ON account_closure_requests(user_id, id DESC);

-- Prompt 82 — account security centre. Sessions are registry rows so a citizen
-- can end one device without changing the password for every device. Only a
-- hash of the signed token is stored; raw tokens never appear in the database.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, id DESC);

-- Account security reports are separate from Phase 1's public vulnerability
-- reports, which have no citizen owner.
CREATE TABLE IF NOT EXISTS account_security_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence_note TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  review_note TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_security_reports_user ON account_security_reports(user_id, id DESC);

CREATE TABLE IF NOT EXISTS security_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  detection_source TEXT,
  affected_scope TEXT,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  summary TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS security_incident_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES security_incidents(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompt 83 — service journey planner. Journey progress is citizen preparation
-- only; it never represents official application completion or eligibility.
CREATE TABLE IF NOT EXISTS service_journeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT NOT NULL DEFAULT 'normal',
  notes TEXT,
  service_snapshot_at TEXT,
  template_version INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_service_journeys_user ON service_journeys(user_id, id DESC);

CREATE TABLE IF NOT EXISTS service_journey_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journey_id INTEGER NOT NULL REFERENCES service_journeys(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  step_type TEXT NOT NULL DEFAULT 'preparation',
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pending',
  source_requirement TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_service_journey_tasks_journey ON service_journey_tasks(journey_id, id);

CREATE TABLE IF NOT EXISTS journey_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES government_services(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  UNIQUE (service_id, version)
);
CREATE INDEX IF NOT EXISTS idx_journey_templates_service ON journey_templates(service_id, status);

CREATE TABLE IF NOT EXISTS journey_template_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES journey_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  step_type TEXT NOT NULL DEFAULT 'preparation',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_journey_template_steps_template ON journey_template_steps(template_id, sort_order);

CREATE TABLE IF NOT EXISTS journey_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journey_id INTEGER NOT NULL REFERENCES service_journeys(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompt 85 — account deactivation, deletion requests and retention. Nothing is
-- deleted by a request alone; retention rules stay under legal review until an
-- approved schedule exists. Anonymisation replaces identifiers, it does not
-- silently erase records that must be retained.
CREATE TABLE IF NOT EXISTS lifecycle_deactivations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  effective_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reactivated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_deactivations_user ON lifecycle_deactivations(user_id, id DESC);

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  confirmation_method TEXT,
  scheduled_for TEXT,
  review_note TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  failure_reason TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  reviewed_at TEXT,
  processing_started_at TEXT,
  completed_at TEXT,
  withdrawn_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_deletion_user ON account_deletion_requests(user_id, id DESC);

CREATE TABLE IF NOT EXISTS account_retention_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL UNIQUE,
  purpose TEXT,
  responsible_system TEXT,
  retention_rule TEXT,
  retention_trigger TEXT,
  deletion_method TEXT,
  legal_review_status TEXT NOT NULL DEFAULT 'pending_legal_review',
  exceptions TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deletion_processing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES account_deletion_requests(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompt 80 (full) — administrative consent requests and citizen decisions.
-- A request is published only after review, and a citizen decision is immutable
-- except for withdrawal; receipts are platform records, not official documents.
CREATE TABLE IF NOT EXISTS consent_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  purpose TEXT NOT NULL,
  requesting_entity TEXT NOT NULL,
  information_involved TEXT,
  intended_use TEXT,
  data_recipients TEXT,
  processing_duration TEXT,
  expires_at TEXT,
  required_permissions TEXT NOT NULL DEFAULT '[]',
  optional_permissions TEXT NOT NULL DEFAULT '[]',
  withdrawal_instructions TEXT,
  privacy_notice_version TEXT,
  references_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  review_note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consent_requests_status ON consent_requests(status, id DESC);

CREATE TABLE IF NOT EXISTS consent_request_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_reference TEXT NOT NULL UNIQUE,
  request_id INTEGER NOT NULL REFERENCES consent_requests(id) ON DELETE CASCADE,
  request_version INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  granted_permissions TEXT NOT NULL DEFAULT '[]',
  typed_name TEXT,
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at TEXT,
  UNIQUE (request_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_consent_request_decisions_user ON consent_request_decisions(user_id, id DESC);

-- Withdrawal history is append-only; a re-decision does not erase the fact that
-- consent was withdrawn earlier.
CREATE TABLE IF NOT EXISTS consent_request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES consent_requests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consent_request_events_user ON consent_request_events(user_id, id DESC);
