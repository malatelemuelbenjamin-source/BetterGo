# Phase 3 — LGU and Municipal Portals (Prompt 43)

Implementation notes for the municipal portal foundation: six municipality
portals, a municipality-scoped administrative workspace, municipal content
management with the existing review workflow, public read-only APIs, search
integration and audit logging.

This phase **extends** Phase 1 and Phase 2. Existing municipality records,
government services, offices, announcements, authentication, RBAC, the content
workflow and the design system are reused, not replaced.

## 1. Architecture

```
municipalities (Phase 1, extended)
├── municipal_content (Phase 3)          news, notices, programs, projects,
│   └── municipal_content_revisions        resources, FAQs, contact blocks
├── announcements (Phase 1)              municipality_id + coverage
├── government_offices (Phase 1/2)       municipality_id + office_municipalities
├── government_services (Phase 2)        municipality_id + service_coverage
├── public_documents (Phase 1)           municipality_id
└── barangays (Phase 1)
```

No second municipality table, approval engine or dashboard was created. Portal
content uses the shared `contentModule` from `server/lib/crud.js`, which already
provides municipality scoping, the workflow state machine, audit entries and
(when configured) version history.

New modules:

| File | Purpose |
| --- | --- |
| `server/schema-phase3.sql` | `municipal_content`, `municipal_content_revisions` |
| `server/lib/municipal.js` | published-content rules, portal payload, metrics |
| `server/routes/municipal.js` | public portal API and `/api/v1/municipalities/*` |
| `server/routes/admin-municipal.js` | municipal workspace, settings, content CRUD |
| `src/pages/MunicipalPortal.jsx` | shared portal shell, homepage, sections, detail |
| `src/pages/admin/MunicipalWorkspace.jsx` | administrative workspace |
| `tests/municipal.test.mjs` | Phase 3 tests |

## 2. Database changes (additive only)

New tables:

- `municipal_content` — `municipality_id`, `content_type`, title, slug, summary,
  body, featured image + alt text + credit, external URL, contact details,
  source reference/URL, `publication_status`, `verification_status`,
  `is_featured`, validity window (`starts_at`, `ends_at`), `published_at`,
  `archived_at`, author/editor/approver ids, timestamps. Unique
  `(municipality_id, content_type, slug)`.
- `municipal_content_revisions` — immutable JSON snapshot per save, with the
  change summary and author.

New columns (applied through `ensureColumn` in `server/db.js`, safe on existing
databases):

- `municipalities`: `portal_title`, `portal_description`, `office_hours`,
  `social_links`, `portal_settings`.
- `audit_logs`: `municipality_id` (NULL for province-wide actions).
- `users`: `session_version` (from the pre-Phase-3 hardening).

No municipal information is seeded. All six municipality rows keep their
existing description only; officials, contact details, population, logos and
cover images stay empty until an authorised administrator records them with a
source.

## 3. Public routes

| Route | Component |
| --- | --- |
| `/municipalities` | `MunicipalitiesList` — portal directory with real counts |
| `/municipalities/:slug` | `MunicipalPortal` — shared portal homepage |
| `/municipalities/:slug/about` | profile, geography, barangays, FAQs |
| `/municipalities/:slug/services` | services for the municipality + province-wide |
| `/municipalities/:slug/offices` | municipal offices |
| `/municipalities/:slug/announcements` | municipality announcements |
| `/municipalities/:slug/news` | news + public notices |
| `/municipalities/:slug/projects` | projects + programs |
| `/municipalities/:slug/resources` | public resources |
| `/municipalities/:slug/contact` | verified contact details |
| `/municipalities/:slug/content/:contentSlug` | published municipal record |

Every screen shows an honest empty state when no verified information exists;
nothing is invented to fill a section.

## 4. Public API

```
GET /api/municipal-portals                  directory + published counts
GET /api/municipal-portals/:slug            portal payload (homepage)
GET /api/municipal-portals/:slug/content    ?type=&q=&featured=&page=&limit=
GET /api/municipal-portals/:slug/content/:contentSlug
GET /api/municipal-portals/:slug/announcements
GET /api/municipal-portals/:slug/offices
GET /api/municipal-portals/:slug/services

GET /api/v1/municipal-portals               directory (read-only API)
GET /api/v1/municipalities/:slug            municipality + published metrics
GET /api/v1/municipalities/:slug/announcements
GET /api/v1/municipalities/:slug/news
GET /api/v1/municipalities/:slug/notices
GET /api/v1/municipalities/:slug/projects
GET /api/v1/municipalities/:slug/resources
GET /api/v1/municipalities/:slug/offices
GET /api/v1/municipalities/:slug/services
```

Published content only: `publication_status = 'published'`, not archived,
`published_at` reached and `ends_at` not passed. Drafts, submissions awaiting
review, rejected and archived records never appear, and neither does any
administrative data.

## 5. Administrative routes

| Route | Permission |
| --- | --- |
| `GET /api/admin/municipal-portals` | `municipal.portal.view` |
| `GET /api/admin/municipal-portals/:id` | `municipal.portal.view` |
| `PATCH /api/admin/municipal-portals/:id` | `municipal.portal.manage` |
| `GET/POST /api/admin/municipal-content` | `municipal.content.view` / `.create` |
| `GET/PATCH /api/admin/municipal-content/:id` | `.view` / `.update` |
| `POST /api/admin/municipal-content/:id/status` | workflow-dependent |
| `GET /api/admin/municipal-content/:id/revisions` | `municipal.content.view` |
| `DELETE /api/admin/municipal-content/:id` | `municipal.content.archive` (archives, never deletes) |
| `GET/POST /api/admin/media` | `media.manage`, `transparency.documents.manage` or `municipal.media.upload` |

Client workspace: `/admin/municipalities/:id` (linked from `/admin/municipalities`).

Scope rules (`server/lib/municipal.js` + `contentModule`):

- `super_admin` and `provincial_admin` have global scope.
- `municipal_admin`, `municipal_content_editor` and `municipal_reviewer` are
  restricted to the municipalities on their role assignment.
- Out-of-scope reads return 404 (records are hidden, not merely forbidden);
  out-of-scope writes return 403.
- A municipal scope is never inferred from a municipality name in the URL.

## 6. Roles and permissions

New roles: `municipal_content_editor`, `municipal_reviewer` (both added to
`ADMIN_ROLES` so they can open the workspace; permissions still gate actions).

New permissions (`municipal` module):

| Permission | super / provincial | municipal_admin | content_editor | reviewer |
| --- | --- | --- | --- | --- |
| `municipal.portal.view` | ✔ | ✔ | ✔ | ✔ |
| `municipal.portal.manage` | ✔ | ✔ | – | – |
| `municipal.content.view` | ✔ | ✔ | ✔ | ✔ |
| `municipal.content.create` | ✔ | ✔ | ✔ | – |
| `municipal.content.update` | ✔ | ✔ | ✔ | – |
| `municipal.content.submit_for_review` | ✔ | ✔ | ✔ | – |
| `municipal.content.review` | ✔ | ✔ | – | ✔ |
| `municipal.content.publish` | ✔ | ✔ | – | – |
| `municipal.content.archive` | ✔ | ✔ | – | – |
| `municipal.media.upload` | ✔ | ✔ | ✔ | – |
| `municipal.analytics.view` | ✔ | ✔ | – | ✔ |

Editor and reviewer roles were also removed from no permissions they need: the
workflow now allows an author to submit their own draft (`perms.submit`), while
approval still requires the reviewer permission. A reviewer can approve but not
publish; an editor can neither approve nor publish.

## 7. Content workflow

The Phase 2 state machine is reused unchanged:

```
draft → submitted_for_review → under_review → approved → published → archived
                     ↘ changes_requested ↗        ↘ rejected → draft
```

- Submitting requires create/update (author action).
- Review transitions require `municipal.content.review`.
- Publishing requires `municipal.content.publish`; archiving requires
  `municipal.content.archive`.
- Lists and the portal only ever show published records.
- Each save and each transition writes a `municipal_content_revisions`
  snapshot; every action is written to `audit_logs` with the municipality id.

Approval and verification remain separate: publishing does not set
`verification_status`, and a record keeps its own source reference.

## 8. Media

Portal cover images, approved logos and content images reuse the existing media
store (`/api/admin/media`, `uploads/media`). Uploads are type- and size-limited,
stored with random names, never executable, and served with `nosniff`. The
workspace asks for alt text and image credit, keeps upload history in
`media_assets`, and warns that a municipal seal may only be used with
permission.

## 9. Search

Global search (`/api/search`) gained the `municipal` category, indexing
published municipal content with its municipality name and type. While adding
it, a pre-existing defect was fixed: OR-joined search terms were not wrapped in
parentheses, so SQL precedence allowed a later term to bypass the
published-only filters in every search block (services, categories, resources,
FAQs, offices, municipalities, announcements, transparency, information). All
blocks are now wrapped.

## 10. Audit logging

`logAudit` accepts `municipalityId`. Municipal content writes pass the record's
municipality, portal settings writes pass the municipality, and the workspace
shows the last 20 municipal audit entries. Audit rows are append-only and are
never exposed publicly.

## 11. Tests

```
npm test
```

`tests/municipal.test.mjs` (11 tests) covers:

- six municipality records with unique slugs and no seeded municipal content;
- all six portal routes responding, unknown slugs returning 404;
- municipal administrators creating only within their municipality, with
  citizen and anonymous attempts rejected;
- drafts absent from portal lists and global search;
- the full review → publish workflow, invalid state jumps rejected;
- version history recorded per save and transition;
- cross-municipality reads (404) and settings writes (403) denied;
- settings validation (javascript: URLs rejected) and audit entries;
- editor/reviewer roles: scoped, editor cannot publish, reviewer can approve
  but not publish;
- public v1 API read-only, published-only, unknown sub-resources 404;
- archiving removing content from public view.

Full suite: 37 tests passing (Phase 1, Phase 2 and Phase 3).

## 12. Known limitations

- Municipal information is not seeded. The six portals show honest empty states
  until an authorised administrator publishes verified content, cover images and
  contact details with a recorded source.
- No municipal seals or logos are bundled; logos are uploads that require
  permission and are never fetched from government sites.
- Coordinates/maps for municipal offices are not part of Prompt 43 (planned for
  Prompt 47).
- Image optimisation is limited to client-side limits and the existing media
  handler; no resizing pipeline exists.
- Notifications on municipal content changes are not sent yet.
