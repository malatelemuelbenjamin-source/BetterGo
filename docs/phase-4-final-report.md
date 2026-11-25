# Phase 4 — Citizen Accounts and Digital Services: final report

Date: 23 November 2026
Scope audited: Prompts 58–86 of Phase 4.
Status: Phase 4 features are implemented and integrated as described below. Items that need external
authorisation, legal review or provider configuration are listed as such and are **not** claimed as done.

BetterGo is a platform. Nothing in this phase claims official government approval, legal certification,
eligibility determination, or that a typed name is a legally recognised electronic signature.

## 1. Completed features

| Area | Where it lives | Notes |
| --- | --- | --- |
| Registration, sign-in, verification, recovery | `server/routes/auth.js`, `/login`, `/register` | Sessions carry a `sid` claim tied to `auth_sessions`; only a token hash is stored. |
| Citizen profile and account page | `/dashboard/profile`, `/dashboard/account` | Profile completion and contact details come from platform records. |
| Personal dashboard | `/dashboard` | Widgets use live records only; layout is customisable and stored per citizen. |
| Saved services | `/dashboard/saved` | Ownership checked server-side. |
| Dynamic application forms, drafts, submission, tracking | `/dashboard/applications` | BetterGo intake records are labelled as platform records, not office decisions. |
| Personal document vault | `/dashboard/documents` | Uploads are owner-scoped; files never served from a public path. |
| Records centre | `/dashboard/records` | Aggregates the citizen's own platform records. |
| Notification centre | `/dashboard/notifications` | In-app preferences respected when notifications are created. |
| Help centre and support tickets | `/dashboard/support` | Reused from the earlier phase. |
| Feedback and surveys | `/dashboard/feedback` | Reused. |
| Privacy centre | `/dashboard/privacy-center` | Includes sharing records and the privacy request workflow. |
| Service discovery and requirements checker | `/dashboard/discover` | Recommendations are rules-based and explain their reasons. |
| Appointments | `/dashboard/appointments` | Reused. |
| Digital payments foundation | `/dashboard/payments` | Records intent only; no real payment collection. |
| Document requests | `/dashboard/document-requests` | Reused. |
| Complaints and reports | `/dashboard/complaints`, `/dashboard/reports` | Reused. |
| Identity verification | `/dashboard/identity` | Platform verification states only. |
| Authorised representatives | `/dashboard/delegations` | Read-only scopes, including `journeys`; revocation is immediate. |
| Consent management | `/dashboard/consent` | Categories, typed-name acknowledgements, sharing authorisations. |
| Consent requests (builder → review → publish → decision) | `/dashboard/consent-requests`, `/admin/consent-requests` | Required and optional permissions are separate; optional ones are never preselected; receipts are downloadable text labelled as platform records; withdrawal history is append-only. |
| Accessibility and personalisation | `/dashboard/preferences`, `/dashboard/personalization` | Language, theme, text size, contrast, reduced motion, simplified view, screen-reader hints, declared needs, default municipality, search preferences and a full reset. |
| Account security centre | `/dashboard/security` | Session registry with per-session revocation, security events, suspicious-activity reports, restriction controls. |
| Service journey planner | `/dashboard/service-journeys`, `/admin/service-journeys` | Templates, preparation tasks, requirement change detection; delegated `journeys` scope. |
| Personal data export | `/dashboard/data-portability`, `/admin/data-exports` | Category selection, JSON download, per-category CSV, README, 7-day expiry, duplicate suppression, cancellation, admin metadata view and retention purge. |
| Deactivation, deletion and retention | `/dashboard/account-management`, `/admin/account-deletion` | Deactivation ends sessions and delegated access and is reversible with email + password; deletion is a draft → typed-email confirmation → review → scheduled/anonymised workflow; retention rules stay pending until real legal review. |
| Account closure requests (earlier flow) | `/dashboard/data-portability` | Kept for compatibility; it is a platform review request, not deletion. |

## 2. Existing features reused

- The existing Express + SQLite data layer (`server/db.js`), additive schema files and `ensureColumn` pattern.
- The existing JWT session and RBAC helpers (`server/auth.js`, `server/rbac.js`) rather than a second auth system.
- The existing design system (`src/components/ui.jsx`, `layout.jsx`, `styles/tokens.css`) and API client (`src/api.js`).
- Existing notification, audit (`logAudit`), rate-limit, validation (`validate`) and error helpers.
- Existing privacy, delegation, document, appointment, application and support modules.
- Existing dashboard layout storage (`dashboard_preferences`) and personalisation profile columns.

## 3. New components in this phase (prompts 80–86 finish)

- `server/routes/consent-requests.js` — request builder, review/publication transitions, decisions, receipts, withdrawal, append-only events, admin reporting.
- `server/routes/lifecycle.js` — deactivation, password reactivation, deletion requests, review decisions, anonymisation, retention rules, scoped admin queue.
- Consent request tables (`consent_requests`, `consent_request_decisions`, `consent_request_events`), lifecycle tables (`lifecycle_deactivations`, `account_deletion_requests`, `account_retention_rules`, `deletion_processing_events`).
- Pages: `ConsentRequests`, `AccountManagement`, admin `ConsentRequests`, `AccountDeletion`, `DataExports`.
- `/account/*` aliases for the suggested navigation paths, each redirecting to the existing dashboard route.

## 4. Database changes

All changes are additive (`CREATE TABLE IF NOT EXISTS`, new indexes, `ensureColumn`); no earlier table is
redefined or dropped.

- `data_exports` extended with `reference`, `status`, `sections`, `record_counts`, `payload`, `error_reason`, `downloaded_at` and a unique index on `reference`.
- Prompt 82: `auth_sessions`, `account_security_reports`, `security_incidents`, `security_incident_events`.
- Prompt 83: journey tables (journeys, tasks, templates, change notices).
- Prompt 84: export extensions above.
- Prompt 85: `lifecycle_deactivations`, `account_deletion_requests`, `account_retention_rules`, `deletion_processing_events`. Pre-existing `retention_rules` and `account_deactivations` from earlier prompts were deliberately **not** reused to avoid column collisions.
- Prompt 80: `consent_requests`, `consent_request_decisions`, `consent_request_events`.
- Foreign keys are declared with `ON DELETE CASCADE`/`SET NULL`; a fresh seeded database reports `PRAGMA foreign_key_check` = 0 rows and zero orphans across applications, notifications, dashboard preferences, consent decisions, deletion requests, lifecycle deactivations and journeys.

## 5. API changes

- `/api/account/consent-requests` — list, detail, decide, withdraw, receipt.
- `/api/admin/consent-requests` — list/analytics, create, update, transition.
- `/api/account/account-management` — account status, sessions, representatives, privacy requests, retention and latest lifecycle records.
- `/api/account/deactivate`, `/api/auth/reactivate` (public, rate-limited, password required).
- `/api/account/deletion-requests` (+ `:id/submit`, `:id/withdraw`).
- `/api/admin/account-deletion` (+ `:id/decision`, `retention/:category`).
- `/api/account/exports` (categories + formats), `/api/account/exports/:id` (JSON/CSV/README/cancel), `/api/admin/data-exports` (+ purge).
- `/api/account/preferences` (GET/PUT) and `/api/account/preferences/reset`.
- Earlier prompt endpoints for security, journeys, consent, accessibility and offline/translation features remain unchanged.

## 6. Security and privacy improvements

- Every citizen endpoint requires authentication; ownership is checked in the query (`user_id = req.user.id`) rather than trusted from the client.
- Administrative data export and deletion views are municipality-scoped; cross-scope requests return 404.
- Deletion requires a recent sign-in, a draft step and a typed account email; a decision cannot be silently edited (only withdrawn and re-decided).
- Deactivation bumps `session_version`, revokes sessions and delegated access; reactivation needs the account password and does not restore delegation.
- Export packages are owner-only, expire, are suppressed against immediate duplicates, and can be cancelled; admins see metadata only and can purge retained contents.
- Data minimisation: exports explicitly exclude passwords, tokens, other people's data and official office records; receipts exclude sensitive internals.
- All state-changing routes use the shared CSRF/origin check, Zod validation, rate limits where abuse is credible, and audit logging.
- No secrets, tokens or personal data are written to logs or this report.

## 7. Test results

- Full suite: **296 tests, 296 passed, 0 failed** (`npm test`, 37 files, 32 of them Phase 4 suites).
- New suites in this pass, all passing individually:
  - `tests/phase4-consent-requests.test.mjs` (5) — build/review/publish, required-permission enforcement, receipts, withdrawal history, reporting, expiry.
  - `tests/phase4-lifecycle.test.mjs` (5) — draft/confirm/withdraw deletion, deactivation + reactivation, scoped review and anonymisation, retention statuses.
  - `tests/phase4-data-export.test.mjs` (6) — categories, CSV/README, expiry, cancellation, admin metadata/purge.
  - `tests/phase4-preferences.test.mjs` (3) — defaults, save/validate, reset.
- `npm run build` succeeds (Vite; only the pre-existing chunk-size warning).
- Dev server verified: HTML 200 on `127.0.0.1:3000`, `/api/health` 200 through the Vite proxy, and 200 with the preview Host header after adding that host to the allowed list. The Cloud preview panel is open. No manual click-through, screen-reader pass or visual review was performed, and no formal WCAG audit has been carried out.

## 8. Security audit performed

Reviewed: authentication and session handling; RBAC helpers; municipality scoping; ownership filters for
exports, deletion, consent, journeys, documents and notifications; upload/download routes; rate limiting;
input validation; error responses. No IDOR, privilege-escalation or token-leak defect was found in the
routes changed here. Existing regression tests for privacy, delegation, security and applications still pass.
This is an internal review, not a penetration test or independent security assessment.

## 9. Known limitations and items requiring external action

- **Consent and signatures:** typed-name acknowledgements and receipts are platform records only. Any transaction that legally requires a recognised electronic signature needs an authorised, reviewed provider and legal sign-off — not implemented.
- **Retention periods:** all retention rules are seeded as *pending legal and privacy review*. No statutory periods are invented.
- **Deletion:** approval anonymises identifiers in the account and profile and revokes access. Records held by offices, security/audit logs, and records under an approved retention rule may remain; the UI and API say so explicitly. A background purge job is not implemented.
- **Exports:** generated synchronously. Very large accounts would need a worker queue; PDF export is not implemented and is marked as such.
- **Translations:** Filipino/English support and language status labels exist, but official legal or service text must be verified by qualified personnel per language; unverified translations are labelled rather than presented as official.
- **Accessibility:** WCAG 2.2 AA is the target and several settings exist, but no independent assessment or certification has been completed.
- **Government integrations, payments, SMS/email delivery:** not configured or authorised. Payment records are intent only; notifications are in-app unless a provider is configured.
- **Backups and monitoring:** documented expectations only; no production backup, alerting or error-reporting provider is wired in this workspace.

## 10. Dependencies

- Node.js (ESM), Express, better-sqlite3-style `node:sqlite` usage, Zod, bcryptjs, Vite + React, lucide-react.
- No new external services were added for this phase.

## 11. Recommended next steps

1. Obtain legal and privacy review for retention schedules, consent wording and deletion outcomes, then mark rules approved through the admin retention editor.
2. Commission an independent WCAG 2.2 AA and security assessment before public launch.
3. Configure a transactional email/SMS provider and confirm notification consent wording.
4. Add a background worker for large exports, scheduled deletion processing, and retention expiry.
5. Decide with offices which records they own and how official outcomes are communicated, so platform vs office records stay unambiguous.

Phase 4 is reported complete for the features above, with the limitations listed honestly. Phase 5 has not been started.
