# BetterGo Marinduque

An independent, community-driven civic information platform for the Province of Marinduque.
It publishes government service information, offices, announcements, transparency records and
emergency contacts **with their source and verification status** — and never invents government data.

> BetterGo Marinduque is **not** an official provincial or municipal government website.

**Phase 2 — Government Services Directory** is implemented: a 25-category hierarchy with 237
subcategories, the full service record model (requirements, procedures, fees in centavos, processing
time, municipality coverage, forms, FAQs, sources and verification), advanced search, citizen
favourites/feedback/notifications, a review and publication workflow with version history, bulk
import/export, and a read-only developer API. See
[docs/phase-2-government-services.md](docs/phase-2-government-services.md) for the architecture,
endpoint list, RBAC matrix, import rules and rollback instructions.

**Phase 3 — LGU and Municipal Portals (Prompt 43)** is implemented: a shared portal for each of the
six municipalities (Boac, Mogpog, Gasan, Buenavista, Torrijos, Santa Cruz) with about, services,
offices, announcements, news/notices, projects/programs, resources and contact sections; municipal
content management on the existing review workflow; municipality-scoped administrative workspaces
and RBAC; public read-only municipality APIs; and municipal search integration. See
[docs/phase-3-municipal-portals.md](docs/phase-3-municipal-portals.md).

**Phase 3 — municipal portal modules (Prompts 44–56)** are implemented: the
portal homepages now include a public information dashboard with advisories,
upcoming activities, projects, programs and statistics; municipal content
covers announcements, news, notices, programs, projects, resources and FAQs;
there is a cross-municipality project, program, resource and FAQ directory, an
office directory with an OpenStreetMap view of verified locations, citizen
feedback with references and status tracking, double opt-in subscriptions,
aggregated portal analytics and an audited data export. See
[docs/phase-3-portal-modules.md](docs/phase-3-portal-modules.md).

**Phase 3 is complete** and passed its final integration, security and
performance review: see [docs/phase-3-final-report.md](docs/phase-3-final-report.md).
Municipal staff should start with the
[administrator guide](docs/municipal-portal-admin-guide.md).

## Stack (all free / open source)

| Layer | Choice | Why |
| --- | --- | --- |
| Server | Node.js 22+ with Express | Small, no build step |
| Database | `node:sqlite` (built into Node) | Zero-install, file-based, no external service |
| Auth | `bcryptjs` + JWT session in an HTTP-only cookie | No paid auth provider |
| Validation | Zod | One schema for every write |
| Front end | React 18 + Vite + React Router | Fast dev server, no framework lock-in |
| Styling | Hand-written CSS with design tokens | No Tailwind/CDN dependency |
| Icons | `lucide-react` | Open source |

No paid services are required to run the whole platform.

## Run it

```bash
npm ci          # install exact versions from the lockfile
npm run dev     # API on :3001 + web on :3000
```

Open <http://localhost:3000>.

Other commands:

```bash
npm run build     # production front-end build into dist/
npm start         # serve the built app + API (NODE_ENV=production)
npm test          # backend test suite (56 tests: Phase 1 + Phase 2 + Phase 3)
npm run bench:portal  # Phase 3 query-layer performance check
npm run db:reset  # DEV ONLY: drop and re-seed the database
```

First boot creates and seeds `data/bettergo.db` automatically (idempotent).

## Production package and deployment

A production Dockerfile and Compose setup are included. See
[docs/deployment.md](docs/deployment.md) for the supported hosts, environment variables,
persistent-volume requirements, administrator bootstrap, backups and rollback.

The package runs on Docker/Node hosts with a persistent disk. It is **not** directly deployable to
Vercel or Cloudflare Workers without a separate rewrite: this application needs a long-lived Node
process and a writable SQLite database, neither of which those serverless platforms provide for
this codebase.

## Create the first super administrator

There is no default password anywhere in the code.

```bash
ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" ADMIN_PASSWORD='A-strong-passphrase-9!' \
  npm run create-admin
```

Password rules: at least 12 characters, upper and lower case, a number, a symbol, and it must not
contain your email address. Sign in, then open **/admin**.

A citizen demo account may exist in a development database only (`maria@example.com`); delete it
before any real deployment.

## Environment

`.env` (development defaults are already present):

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default 3001) |
| `SESSION_SECRET` | Signs session cookies — **change in production** |
| `PUBLIC_SITE_URL` | Base URL used in verification and reset links |
| `DEV_EXPOSE_VERIFICATION_LINKS` | `true` shows email links in the UI when no mail provider exists (development only) |
| `SMTP_*` | Optional SMTP settings; without them mail is logged, not delivered |

Never commit real secrets. Set production values in the host's environment/secret manager.

## What is real and what is honest empty state

Seeded: the province, its six municipalities (with PSGC codes), roles, the full permission matrix,
the 25 service category groups and 237 subcategories, announcement categories, platform settings,
homepage sections, FAQs, and three legal documents clearly labelled as **drafts for review**.

Not seeded: **government service records**, officials, office phone numbers, budgets, projects,
statistics, barangays or announcements. The service directory therefore opens with an honest empty
state: categories and published counts are real, but no service, fee, requirement or form is invented.
Records appear only after an authorised administrator creates, reviews, verifies and publishes them.

## Access control

* Roles: citizen, government employee, content editor, municipal admin, provincial admin, super admin.
* Every permission is enforced **on the server**; hiding a button is never the control.
* Municipality-scoped roles can only read and write records for their own municipality.
* The last super administrator cannot be removed.
* All administrative actions are written to an append-only audit log.

## Content workflow

`draft → submitted_for_review → under_review → approved → published → archived`
(with `changes_requested` and `rejected` branches). Each transition requires its own permission.
Public endpoints only ever return `published` records, and expired announcements drop out
automatically.

## Privacy (RA 10173)

Consent records, a personal-data export, deletion requests, a privacy request centre, incident
logging and retention rules are implemented. Credentials, tokens and audit internals are never
included in a user's export.

## Known limitations (honest list)

* **No email provider configured** — verification and reset links are logged and (in development)
  shown in the UI. Add SMTP settings to deliver real mail.
* **No map provider** — no interactive maps; coordinates are stored as plain numbers.
* **Legal documents are drafts** and need review by a qualified person before publication.
* **Announcement attachments**: media upload exists, but there is no public attachment download route yet.
* Large single JS bundle (~246 kB gzipped); route-level code splitting is a future optimisation.
* **No service records are seeded** (by design). Use **Admin → Service management → Import & export**
  to load real information, or create records manually, then verify and publish them.
* **Service document uploads are not implemented** — forms accept an external URL or a file reference.
  XLSX is supported by exporting the sheet to CSV first.
* **Service update emails are not sent** — subscribers receive in-app notifications only; no provider
  confirms delivery, and none is claimed.
* Private service collections exist in the database schema but have no public UI yet.

## Step-by-step if something errors

1. **`vite: not found` / `Cannot find module`** → dependencies are missing:
   `npm ci` then `npm run dev`.
2. **`EADDRINUSE :3000` or `:3001`** → an old server is still running. Find it with
   `ss -lptn 'sport = :3000'` and stop that PID, then restart `npm run dev`.
3. **Preview shows 403** → the dev server is not allowing the preview hostname. Start it with
   `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=<your-preview-host> npm run dev`.
4. **`Email or password is incorrect` for the admin** → create the account again with
   `ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run create-admin`. The password must not contain the email address.
5. **“You do not have permission …”** → the signed-in role lacks that permission, or the record belongs
   to another municipality. Check **Admin → Roles** and the account's role scope.
6. **Empty announcements/services/transparency pages** → expected until content is created and published
   through the workflow.
7. **Database looks broken** → back up `data/bettergo.db`, then (development only) `npm run db:reset`.

## Project layout

```
server/          Express API (env, db, schema, seed, auth, rbac, routes, lib)
src/             React app (pages, components, styles, api client)
scripts/         dev runner, create-admin
tests/           node:test backend suite (Phase 1 + Phase 2 services + Phase 3 portals and modules)
docs/            Phase 2 and Phase 3 architecture and API documentation
data/            SQLite database (not committed)
uploads/         user-uploaded avatars and media (not committed)
```
