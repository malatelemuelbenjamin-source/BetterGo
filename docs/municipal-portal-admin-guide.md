# Municipal Portal — Administrator Guide

For municipal editors, reviewers, municipal administrators and provincial
administrators using the BetterGo Marinduque municipal workspaces.

BetterGo is an independent civic platform. Publishing on it does not create an
official municipal website, partnership or endorsement.

## 1. Getting access

1. An administrator creates your account and assigns a role.
2. Municipal roles are scoped to specific municipalities. You only see records
   for the municipalities on your assignment.
3. Sign in, open **Admin → Municipalities**, then choose your municipality.

Roles: `municipal_content_editor` (write and submit), `municipal_reviewer`
(review and approve), `municipal_admin` (full municipal scope including
publish), plus `provincial_admin` and `super_admin` for province-wide work.

## 2. Publishing workflow

```
draft → submitted_for_review → under_review → approved → published → archived
                    ↘ changes_requested ↗        ↘ rejected → draft
```

- Save as a draft while information is incomplete.
- Submit for review when the text and the source are ready.
- A reviewer starts the review, then approves or requests changes.
- A publisher publishes. Unpublish/archive removes the record from the public
  portal, search and APIs immediately.
- Every save and transition creates a revision snapshot; the workspace shows
  the history.

**Verification is separate from approval.** Publishing does not mark a record
verified. Record the source and set the verification status only after checking
it.

## 3. Writing each content type

| Type | Use for | Key fields |
| --- | --- | --- |
| `about` | Extended profile pages | body, source |
| `news` | Updates and articles | summary, body, featured image + alt text |
| `notice` | Public notices and advisories | priority (important/urgent), validity window, attachment |
| `program` | Programs and initiatives | schedule, venue, eligibility, beneficiaries, application status |
| `project` | Development projects | status, schedule, location, reported progress, attachment |
| `resource` | Forms, guides, public materials | body or attachment, external link |
| `faq` | Citizen questions | question as title, answer in body, source |
| `contact` | Contact blocks | contact details, source |

Rules that keep the portal honest:

- Never invent officials, fees, contact numbers, addresses or project status.
- State application availability only when the office has confirmed it.
- Publish progress percentages only with a recorded source. Leave the field
  blank otherwise — the public page then says progress is unavailable.
- Add alt text for every image and credit images you do not own.
- Use priority `urgent` only for genuine public safety advisories.

## 4. Offices and the map

Open **Workspace → Offices, feedback & analytics → Offices**.

- Create departments, offices, divisions or units and set the parent office.
- Coordinates are optional. Enter latitude and longitude from an official
  source, then tick **Location verified**. Only verified coordinates become map
  markers; unverified addresses are listed without a marker.
- Publishing an office requires the publish permission.

## 5. Feedback and corrections

Citizens submit corrections from the portal. Each message receives a reference
like `BGM-M3K9P-4TQ`; the citizen can check status with that reference **and**
the email they used.

- Review the message, set a status (new → reviewing → resolved/closed) and add an
  internal note.
- Feedback never changes an official record automatically. If a record needs a
  change, edit it through the normal review workflow with the correct source.
- Do not publish a citizen's personal details.

## 6. Analytics

**Workspace → Offices, feedback & analytics → Analytics** shows daily counts of
portal and project views, plus published records by type. Counts are aggregated;
no visitor identifiers exist. Use them to see which published pages are read,
not as a measure of government performance.

## 7. Subscriptions

The portal offers topic subscriptions (announcements, news, projects, programs,
resources). Storage and double opt-in are implemented, but **email delivery is
not configured**. In this deployment the confirmation link is shown in the UI
instead of being emailed. Do not tell citizens they will receive email until a
provider is configured and tested.

## 8. Search

- Global search indexes published municipal content with its municipality.
- Cross-municipality discovery searches updates, offices, services and documents.
- Drafts, archived and unpublished records never appear in any search result or
  public API.

If a record is missing from search, confirm its publication status and that the
municipality is active and published.

## 9. Data export

**Workspace → Data export** produces JSON or CSV of that municipality's content
metadata. Exports contain no user or reviewer personal data; each export is
written to the audit log. Keep exported files inside your records process.

## 10. Backups and recovery

SQLite stores everything in one file (`DATABASE_PATH`, default `data/`).

```
# stop the server, then copy the database with its WAL files
sqlite3 data/bettergo.db ".backup 'backup-$(date +%F).db'"
```

Recommended: a daily backup to a separate disk, kept for at least 30 days, with
a quarterly restore test. Restore by stopping the server and replacing the
database file, keeping the previous copy.

## 11. Known limitations

- No verified municipal content is seeded; empty portals are expected.
- No email provider, so notifications are stored but not delivered.
- No automated retention or erasure job for feedback and subscriptions.
- Analytics are simple page counters, not a full reporting product.
- Uploaded files are stored locally under `uploads/`; there is no CDN or image
  resizing pipeline.
