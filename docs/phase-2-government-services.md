# Phase 2 — Government Services Directory

BetterGo Marinduque, Phase 2 (Prompts 21–42). This document describes what was
built, how it is structured, and what is deliberately **not** claimed.

> BetterGo Marinduque is an independent civic platform. It is **not** an official
> government website, and Phase 2 does not fabricate government services, fees,
> requirements, offices or officials.

---

## 1. Architecture summary

Phase 1 is unchanged at its core. Phase 2 is an additive module on the same stack:

```
React 18 + Vite (src/)  ──►  Express REST API (server/routes/)
                                   │
                              node:sqlite
                         server/schema.sql  (Phase 1)
                         server/schema-phase2.sql (Phase 2 tables)
                         server/db.js       (idempotent column migrations)
```

* `server/routes/search.js` — the single global search and suggestion
  implementation across every public module, including Phase 2 categories,
  forms/resources and service FAQs.
* `server/lib/service-domain.js` — shared published-record rule, status labels
  and Filipino/Taglish synonyms used by the directory, search and admin API.
* `server/routes/services.js` — public directory, categories, detail pages,
  citizen features, versioned developer API and OpenAPI document.
* `server/routes/admin-services.js` — category management, service CRUD,
  nested requirements/procedures/fees/coverage/documents/FAQs, verification,
  revisions and rollback, feedback moderation, sources, import/export,
  analytics and API keys.
* `server/seed-phase2.js` — the 25-category hierarchy, Phase 2 permissions and
  default role grants. Also merges duplicate categories created by early Phase 2
  development builds into the Phase 1 record and archives the duplicate.
* `src/components/services.jsx` — reusable cards, badges, checklist, fees,
  procedures, coverage, source panel and feedback.
* `src/components/search.jsx` — one autocomplete control used by the header,
  the search page and the service directory.
* `src/lib/serviceMeta.js` — status labels, transitions and form options shared
  by the public badges and the admin dashboard.
* `src/pages/Services.jsx` — directory landing page, category page and the full
  service detail page.
* `src/pages/ServiceExtras.jsx` — coverage, FAQs, resources, developer portal,
  API documentation and category index.
* `src/pages/admin/ServiceAdmin.jsx` — the centralised administrative dashboard.

New routes are mounted **before** the Phase 1 routers:

```js
app.use('/api', searchRouter)
app.use('/api', servicesRouter)
app.use('/api', publicRouter)
app.use('/api/admin', adminServicesRouter)
app.use('/api/admin', adminRouter)
app.use('/api/admin', adminContentRouter)
```

The Phase 1 `/api/services`, `/api/search` and `/api/search/suggest` handlers,
the Phase 1 `/api/admin/services` content module and the unused old
`AdminServices` screen have been **removed**, not left shadowed. The Phase 1
search now lives only in `server/routes/search.js`; anything the Phase 2 routers
do not handle still falls through to `publicRouter`.

---

## 2. Database changes

### New columns (added only when missing, via `PRAGMA table_info`)

`service_categories`: `parent_id`, `category_group`, `is_featured`, `status`,
`seo_title`, `seo_description`, `keywords`.

`government_services`: `short_description`, `full_description`, `service_scope`,
`availability_status`, `application_mode`, `is_online`, `source_id`, `source_url`,
`next_review_at`, `reviewed_by`, `verification_notes`, `version_number`.

`service_requirements`: `quantity`, `accepted_format`.
`service_procedures`: `additional_instructions`, `responsible_office_id`.
`service_favorites`: `note`, `collection_id`.

### New tables (`server/schema-phase2.sql`)

| Table | Purpose |
| --- | --- |
| `service_sources` | Official source registry: name, organisation, URL, document reference, verification status/date, reviewer, next review. |
| `service_fees` | Amounts in integer centavos, fee type, conditions, source and verification date. |
| `service_processing` | Processing time + unit, conditions, source. |
| `service_coverage` | Municipality/barangay coverage, availability, local instructions, responsible office. |
| `service_documents` | Approved forms/checklists: external URL or file reference, publication date, status. |
| `service_faqs` | Service-specific questions and answers. |
| `service_feedback` | Citizen ratings/comments with moderation status and public flag. |
| `service_subscriptions` | Per-user update subscriptions (respects notification preferences). |
| `service_updates` | Published update notes shown on the service page and used for notifications. |
| `service_revisions` | JSON snapshots for version history and rollback. |
| `service_collections`, `service_collection_items` | Private citizen collections (schema ready; no public UI yet). |
| `service_search_log` | Query/filter/result-count analytics without personal data. |
| `api_clients` | Hashed API keys, scopes, status, revocation. |
| `api_request_log` | Per-endpoint request counters for API analytics. |

Indexes were added on the new foreign keys and common filters (category parent,
availability + publication status, coverage municipality, feedback status,
subscriptions, revisions and search log timestamps).

All Phase 1 rows are preserved. Categories and services are **archived**, never
hard-deleted, so audit history and references survive.

---

## 3. Category hierarchy

25 parent categories, 237 subcategories. Slugs are stable and unique.

| # | Parent | Slug |
| --- | --- | --- |
| 1 | Civil registry and documents | `civil-registry` (Phase 1 record reused) |
| 2 | Health and medical services | `health-medical` (reused) |
| 3 | Social welfare and assistance | `social-welfare` (reused) |
| 4 | Senior citizen services | `senior-citizen` (reused) |
| 5 | Persons with disabilities services | `pwd-services` (reused) |
| 6 | Solo parent and family services | `solo-parent-family` |
| 7 | Business permits and registration | `business-permits` (reused) |
| 8 | Taxation and revenue services | `taxation` |
| 9 | Building, construction and property | `building-property` |
| 10 | Education and scholarship services | `education-scholarships` (reused) |
| 11 | Employment and career services | `employment-livelihood` (reused) |
| 12 | Livelihood and entrepreneurship | `livelihood` |
| 13 | Agriculture and farming services | `agriculture-fisheries` (reused) |
| 14 | Fisheries and aquatic resources | `fisheries` |
| 15 | Environment and natural resources | `environment` |
| 16 | Housing and land services | `housing-community` (reused) |
| 17 | Transportation and vehicle services | `transportation` |
| 18 | Public safety and security | `public-safety` |
| 19 | Disaster risk reduction and emergency assistance | `disaster-emergency` (reused) |
| 20 | Youth and sports development | `youth-development` (reused) |
| 21 | Tourism and cultural services | `tourism-culture` |
| 22 | Legal and public document services | `legal-documents` |
| 23 | Barangay services | `barangay` |
| 24 | Government employee and public service information | `government-employment` |
| 25 | Other government services | `other-services` |

The twelve Phase 1 categories were **reused as parents** rather than duplicated:
existing services keep their `category_id`. Six of them are featured
(`civil-registry`, `health-medical`, `social-welfare`, `business-permits`,
`education-scholarships`, `employment-livelihood`).

Category management supports parents, subcategories, icon selection from a fixed
allow-list, display order, featured flag, active/archived status and SEO fields.
Circular parent relationships are rejected server-side.

---

## 4. Service status definitions

### Availability (`government_services.availability_status`)

`available`, `temporarily_unavailable`, `online_application`,
`in_person_required`, `needs_confirmation`, `archived`.

### Verification (`government_services.verification_status`)

`verified`, `pending`, `needs_update`, `unverified`, `archived`.

`verified` requires an identified source (registry entry, reference or source
URL). Approval to publish is a separate step and never sets verification to
`verified` automatically.

### Workflow (`government_services.publication_status`)

`draft → submitted_for_review → under_review → approved → published → archived`,
with `changes_requested` and `rejected` returning to `draft`. Transitions are
validated against an explicit map; editors cannot approve or publish records they
created unless they are a super administrator.

---

## 5. Municipality coverage model

Coverage is explicit, not assumed:

1. `service_coverage` rows for specific municipalities (and optionally
   barangays), each with its own availability and local instructions.
2. `service_scope = province_wide` / `online_province_wide` for services that
   genuinely apply across Marinduque.
3. `municipality_id` for a single primary location.

`GET /api/service-coverage` groups published services per municipality and
returns the honest policy note that a listing is not a guarantee the service is
currently offered.

---

## 6. API endpoints

### Public

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/services` | Search + filters: `q`, `category` (includes descendants), `municipality`, `office`, `availability`, `verification`, `scope`, `type`, `online`, `featured`, `sort`, `page`, `limit`. Returns facets. |
| GET | `/api/services/categories` | Tree, flat list, featured categories and accurate published counts. |
| GET | `/api/services/categories/:slug` | Category, parent, children, services, offices. |
| GET | `/api/services/:slug` | Full record with requirements, procedures, fees, processing, coverage, documents, FAQs, updates, source, related services and feedback summary. |
| GET | `/api/services/:id/requirements` \| `procedures` \| `fees` \| `documents` \| `faqs` \| `processing` \| `coverage` | Subresources of a published record. |
| GET | `/api/service-coverage` | Municipality coverage overview. |
| GET | `/api/service-resources` | Approved forms and external resources. |
| GET | `/api/service-faqs` | Published service FAQs grouped by service. |
| GET | `/api/search?q=` | Global search: services, service categories, forms/resources, service FAQs, offices, municipalities, announcements, transparency records and public FAQs. Supports `category`, `municipality`, `sort`, `page` and `limit`. |
| GET | `/api/search/suggest?q=` | Autocomplete across services, categories, forms, service FAQs, offices, announcements and municipalities. Returns a flat `suggestions` list plus grouped `groups` (and the legacy top-level arrays). |
| POST/DELETE | `/api/services/:slug/favorite` | Authenticated; private saved list. |
| POST/DELETE | `/api/services/:slug/subscribe` | Authenticated; update notifications. |
| GET/POST | `/api/services/:slug/feedback` | Read approved public feedback; submit rating/comment (5/min per IP, one per service per account per day). |
| GET | `/api/openapi.json` | OpenAPI 3 description. |

### Developer API (`/api/v1`)

`/meta`, `/services`, `/services/:slug`, `/categories`, `/offices`,
`/municipalities`, `/coverage`, `/resources`, `/faqs`. Anonymous access is
rate limited (120 requests/minute/IP). Optional API keys use
`Authorization: Bearer <key>` or `X-API-Key`; only a SHA-256 hash is stored and
keys can be revoked. Published records only — drafts and internal notes never
appear.

### Administrative (all under `/api/admin`, all RBAC-guarded)

`GET/POST/PATCH/DELETE /services`, `POST /services/:id/status`,
`POST /services/:id/verify`, `POST /services/:id/rollback`,
`GET /services/:id` (full detail, revisions, workflow events),
nested CRUD for `requirements`, `procedures`, `fees`, `processing`,
`coverage`, `documents`, `faqs`, `GET /services/analytics`,
`GET /services/export?format=csv|json`, `POST /services/import`,
`GET/POST/PATCH/DELETE /service-categories`, `GET/PATCH /service-feedback`,
`GET/POST/PATCH /service-sources`, `GET/POST /api-keys`,
`POST /api-keys/:id/revoke`.

Import supports CSV, JSON arrays and JSON strings, with `dry_run: true` by
default. It validates required fields, duplicate titles, category/office/
municipality references, URLs and fee values, warns when no source is supplied,
and only ever creates **drafts** with pending verification. Maximum 500 rows.

---

## 7. RBAC

New permissions (granted to `super_admin`, and selectively to
`provincial_admin`, `municipal_admin`, `content_editor`):

```
services.categories.view / create / update / archive
services.categories.manage_order / manage_featured
services.requirements.manage
services.procedures.manage
services.fees.manage
services.documents.manage
services.coverage.manage
services.verify
services.feedback.moderate
services.import
services.export
services.analytics.view
services.sources.manage
api.keys.manage
```

Municipality-scoped administrators can only manage services whose primary
municipality or coverage falls inside their assignments. Province-wide records
require global scope. Citizens never receive administrative permissions; all
checks are enforced server-side and audited.

---

## 8. Frontend routes added

| Route | Page |
| --- | --- |
| `/services` | Directory landing: search, featured categories, all 25 categories, results. |
| `/services/categories` | Category index. |
| `/services/category/:slug`, `/services/categories/:slug` | Category / subcategory page. |
| `/services/:slug` | Comprehensive service detail page. |
| `/service-coverage` | Coverage by municipality. |
| `/resources` | Forms and external resources. |
| `/faqs` | Service FAQs. |
| `/developers`, `/developers/api-docs` | Developer portal and API reference. |
| `/offices`, `/offices/:slug` | Redirect to the existing government directory. |
| `/admin/services` | Service management dashboard (tabs: services, categories, sources & verification, feedback, import & export, analytics). |
| `/admin/service-categories`, `/admin/service-feedback`, `/admin/service-sources`, `/admin/service-import` | Deep links into the dashboard tabs. |

The homepage now shows the featured categories with real published counts and
links to category pages, coverage and the open data API.

---

## 9. Tests

`npm test` runs two Node test files against throwaway SQLite databases:

* `tests/api.test.mjs` — Phase 1 regression suite (7 tests).
* `tests/services.test.mjs` — Phase 2 (19 tests): category hierarchy, category
  validation, draft isolation, nested records, money in centavos, unsafe URLs,
  source-required verification, workflow transitions, invalid transitions,
  directory/detail/facets, requirement-text and Filipino-term search,
  municipality scoping, favourites, moderated feedback, import validation and
  draft-only creation, public/versioned API, OpenAPI, suggestions, category RBAC
  and circular-parent rejection, archival without deletion, and global search
  returning service categories, forms and service FAQs with clickable links.

Last run: **26 passing, 0 failing**. `npm run build` passes.

---

## 10. Known limitations

* No government service records are seeded. The directory is honestly empty
  until an authorised administrator publishes reviewed information.
* No file upload for service documents. Records accept an external URL or a file
  reference; secure upload/storage is a later increment.
* XLSX is not parsed natively. Export the sheet to CSV and import it.
* Email delivery is not configured (same as Phase 1): in-app notifications are
  created for subscribers, but no email is sent and none is claimed.
* `service_collections` exists in the database but has no public UI yet.
* API keys are optional and created by administrators; there is no self-service
  developer signup.
* Rate limiting is in-process, so it resets on restart and is per-instance.
* Search is SQLite `LIKE`-based with a Filipino/Taglish synonym map, not a
  natural-language engine.
* Search is still `LIKE`-based and suggestions are fetched live (debounced
  200 ms); there is no offline index or typo-tolerant ranking.

---

## 11. Rollback

Phase 2 is additive, so rolling back the application is enough:

1. Check out the previous commit / restore the pre-Phase-2 `server/` and `src/`
   files and run `npm run build`.
2. The extra columns and tables are harmless to Phase 1. To remove them,
   **back up the database first** (`cp data/bettergo.db data/bettergo-backup.db`),
   then drop only the Phase 2 tables:
   `service_sources`, `service_fees`, `service_processing`, `service_coverage`,
   `service_documents`, `service_faqs`, `service_feedback`, `service_subscriptions`,
   `service_updates`, `service_revisions`, `service_collections`,
   `service_collection_items`, `service_search_log`, `api_clients`,
   `api_request_log`.
   SQLite cannot drop columns in older versions; adding them is safe to leave in
   place, and Phase 1 ignores them.
3. Phase 1 categories that were reused keep their original slugs and ids, so
   existing service records still resolve.
4. Restore from the backup if any category merge needs to be undone. The merge
   only reparents children/services and archives the duplicate; it deletes
   nothing.
