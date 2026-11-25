# Phase 3 — Municipal Portal Modules (Prompts 44–57)

Implementation notes for the municipal portal content modules built on the
Prompt 43 foundation. Everything here extends the existing schema, RBAC,
workflow engine and design system; nothing is duplicated or seeded with
invented municipal information.

## 1. What was added

| Prompt | Module | Status |
| --- | --- | --- |
| 44 | Public information dashboard on the six portal homepages | Implemented |
| 45 | Announcements, news, notices and advisories management | Implemented (extended content model + advisory strip) |
| 46 | Municipal office and department directory management | Implemented |
| 47 | Office locations and interactive map (Free/OSM alternative) | Implemented, no verified coordinates seeded |
| 48 | Municipal programs and community initiatives | Implemented |
| 49 | Public project showcase and tracking preview | Implemented (per Prompt 49 scope) |
| 50 | Public resources and document center | Implemented |
| 51 | Municipal FAQs and citizen guidance | Implemented |
| 52 | Contact and feedback channels | Implemented (feedback intake + review) |
| 53 | Portal analytics and reports | Implemented (aggregated page counts only) |
| 54 | Notifications and subscriptions | Implemented storage + double opt-in; no email delivery provider |
| 55 | Cross-municipality search and discovery | Implemented |
| 56 | Municipal API and data management | Implemented (read-only v1 + authorised export) |
| 57 | Final integration, security audit, testing | Partially — integration and tests done; no independent third-party audit |

## 2. Data model (all additive)

New tables (`server/schema-phase3-portal.sql`):

- `municipal_content_updates` — published project/program progress updates with
  reported date, optional percentage, description and source.
- `municipal_feedback` — citizen corrections/questions with review status,
  internal response note and handler.
- `municipal_subscriptions` — double opt-in email subscriptions per
  municipality and topic, with a single-use confirmation token.
- `municipal_analytics` — daily aggregated counters per municipality and metric
  (no IP addresses, cookies or user identifiers).

New columns (applied by `ensureColumn` in `server/db.js`):

- `municipal_content`: `priority`, `pinned`, `venue`, `event_start`,
  `event_end`, `eligibility`, `application_status`, `project_status`,
  `beneficiaries`, `office_id`, `progress_percent`, `progress_note`,
  `progress_updated_at`, `attachment_url`, `attachment_label`, `address`,
  `barangay`, `latitude`, `longitude`.
- `government_offices`: `parent_office_id`, `office_level`,
  `location_verified`, `service_note`.
- `public_documents`: `resource_type`, `version`, `review_date`,
  `access_notes`, `external_url`, `related_service_id`.

Projects and programs reuse `municipal_content`, so there is one review
workflow, one revision history and no duplicate project/program tables.

## 3. Public routes

| Route | Purpose |
| --- | --- |
| `/municipalities/:slug` | Portal homepage dashboard |
| `/municipalities/:slug/{about,services,offices,announcements,news,projects,programs,resources,faqs,contact}` | Portal sections |
| `/municipalities/:slug/projects/:projectSlug` | Project detail (status, schedule, progress, updates) |
| `/municipalities/:slug/programs/:programSlug` | Program detail (eligibility, beneficiaries, application status) |
| `/municipalities/:slug/content/:contentSlug` | Other published municipal records |
| `/municipal-projects` | Cross-municipality project directory with filters |
| `/municipal-programs` | Cross-municipality programs directory |
| `/municipal-resources` | Resource and document center |
| `/municipal-faqs` | FAQs grouped by municipality |
| `/municipal-offices` | Office directory with verified-location map |
| `/municipal-search` | Cross-municipality discovery |
| `/municipal-feedback` | Report incorrect or missing information |
| `/admin/municipalities/:id` | Content workspace (all municipal content types) |
| `/admin/municipalities/:id/modules` | Offices, feedback, analytics and export |

## 4. Public API

All public endpoints return published records only and never expose drafts,
reviewer notes, feedback messages, subscriber data or administrative fields.

```
GET  /api/municipal-portals                      directory + counts
GET  /api/municipal-portals/:slug                dashboard payload
GET  /api/municipal-portals/:slug/content        ?type=&q=&featured=&page=&limit=
GET  /api/municipal-portals/:slug/content/:slug
GET  /api/municipal-portals/:slug/projects/:slug project/program detail + updates
GET  /api/municipal-projects                     ?municipality=&status=&q=&office=&sort=
GET  /api/municipal-programs                     ?municipality=&upcoming=
GET  /api/municipal-resources                    ?municipality=&category=&q=
GET  /api/municipal-faqs                         ?municipality=&q=
GET  /api/municipal-offices                      ?municipality=&q=&level=  (verified markers only)
GET  /api/municipal-search                       ?q=&municipality=
GET  /api/municipal-portal-meta                  filter and label dictionaries
POST /api/municipal-feedback                     validated, rate-limited intake
POST /api/municipal-subscriptions                double opt-in (token returned; no email provider)
GET  /api/municipal-subscriptions/confirm/:token
POST /api/municipal-subscriptions/unsubscribe/:token

GET  /api/v1/municipal-projects
GET  /api/v1/municipal-programs
GET  /api/v1/municipal-offices
GET  /api/v1/municipal-portals
GET  /api/v1/municipalities/:slug[/:resource]
```

Administrative endpoints (`/api/admin/...`) require `requireAdmin`, an explicit
permission and a municipality scope check:

- `GET|POST /municipal-offices`, `PATCH /municipal-offices/:id` —
  `municipal.portal.view` / `municipal.portal.manage`; publishing a draft office
  additionally requires `municipal.content.publish`.
- `GET /municipal-content/:id/updates`, `POST /municipal-content/:id/updates` —
  content view/update; publishing a progress update requires
  `municipal.content.publish` and a source reference.
- `GET /municipal-feedback`, `PATCH /municipal-feedback/:id` — portal view and
  content review.
- `GET /municipal-analytics/:id` — portal view (scoped).
- `GET /municipal-export` — portal view (scoped, JSON or CSV, audited).

## 5. Honest-data rules

- No municipal data, office, coordinate, project, program, FAQ or document is
  seeded. Every public section shows an empty state instead.
- Progress percentages are optional and published only with a source
  reference; the UI labels them as reported, not independently verified.
- Map markers require coordinates recorded **and** explicitly marked verified
  by an administrator. Unverified addresses are listed without a marker.
- Application availability for programs is `not_stated` unless published.
- Project dates are not derived from the current date and status never changes
  automatically with time.
- Feedback never edits an official record; it is reviewed by an administrator.
- Analytics contain aggregated counts only — no visitor identifiers.

## 6. Map (free alternative to Google Maps)

Prompt 47 asks for a free alternative to Google Maps. This build uses
OpenStreetMap:

- Embedded map via `openstreetmap.org/export/embed.html` (no API key, no paid
  service, no tracking script).
- Per-office links open the verified coordinates on OpenStreetMap.
- Tiles are attributed to OpenStreetMap contributors (ODbL) in the UI.
- Without verified coordinates the page shows an honest notice and the office
  list, with no fabricated location.

If the deployment needs fully self-hosted tiles, that is a hosting decision and
was not added here (no paid services introduced).

## 7. Search

Global search (`/api/search`) indexes published municipal content of every
type. Cross-municipality discovery (`/api/municipal-search`) searches municipal
updates, offices, services and public documents, published-only, with an
optional municipality filter.

## 8. Security

- Server-side Zod validation on every write; text cleaned and HTML sanitised by
  the shared content module.
- Municipality scope checks on every administrative read and write; out-of-scope
  records return 404 for reads and 403 for writes.
- Feedback and subscription endpoints are rate-limited per IP.
- Uploads continue to use the shared media store with type and size limits.
- Exports and publishing actions write audit entries (with municipality id).
- Subscription tokens are random and single-use; no subscriber data is exposed
  publicly.

## 9. Tests

```
npm test
```

New suite `tests/municipal-modules.test.mjs` (12 tests): published-only project
listing and detail, status filter validation, program application status, FAQ /
resource / office output, verified-marker rule, dashboard payload, discovery
privacy, feedback validation and municipality isolation, subscription opt-in
and removal, office creation scope and coordinate rules, analytics scoping and
export scoping, v1 privacy.

Full suite: **49 tests passing** (Phase 1, Phase 2, Prompt 43 and Prompts 44–56).

## 10. Known limitations

- No email provider is configured. Newsletter subscriptions store a double
  opt-in record and show the confirmation link in the UI instead of emailing it.
  Delivering notifications (Prompt 54) needs an email service and credentials.
- Portal analytics are simple daily counters of portal and project views. They
  are not a full analytics product and contain no traffic-source or user data.
- The map depends on OpenStreetMap tile availability from the browser; there is
  no offline tile fallback.
- Prompt 56's "API integration" is a read-only public API plus audited export.
  No write API, API-key management or third-party ingestion is implemented.
- Prompt 57's final security review is covered by tests and the existing
  hardening work, but no independent penetration test or formal audit has been
  performed.
- No municipal content, offices, projects, programs, coordinates or documents
  are seeded; the public modules stay empty until authorised municipal users
  publish verified records.
