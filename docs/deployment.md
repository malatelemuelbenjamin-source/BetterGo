# BetterGo Marinduque — production deployment

This package is a **Node.js 24 / Express / SQLite** application. The Express process serves both the built React front end and the API, and stores its database and uploads on disk.

## Host compatibility

| Host | Supported from this package? | Notes |
| --- | --- | --- |
| Docker host, VPS, NAS | **Yes** | Use the included `Dockerfile` or `docker-compose.yml`; mount a persistent volume at `/data`. |
| Render (Docker service) | **Yes** | Use the Dockerfile, expose port 3001, attach a persistent disk at `/data`. |
| Railway (Docker service) | **Yes** | Use the Dockerfile/Compose file and attach a volume at `/data`. |
| Fly.io, Koyeb and similar container hosts | **Yes** | Deploy the Dockerfile and mount a volume at `/data`. |
| Plain Linux server with Node.js 24 | **Yes** | Run `npm ci`, `npm run build`, then `npm start` with the environment below. |
| Vercel | **No, not unchanged** | Vercel runs stateless serverless functions. This app needs a long-lived Node process and a writable SQLite file. The included build works locally, but API writes and the database would not persist on Vercel. |
| Cloudflare Workers / Pages | **No, not unchanged** | Workers do not provide Node's Express server or `node:sqlite` filesystem database. Moving there requires a separate D1/Postgres and Workers-compatible backend rewrite, which is not included. |

Do not upload this zip to Vercel or Cloudflare Workers expecting a working database-backed site. Use a container host with a persistent volume, or commission the separate serverless rewrite first.

## Environment variables

Copy `.env.example` to `.env` and set at least:

```env
NODE_ENV=production
API_PORT=3001
SESSION_SECRET=<random 32+ character secret>
PUBLIC_SITE_URL=https://your-real-domain.example
DATABASE_PATH=/data/bettergo.db
UPLOADS_DIR=/data/uploads
```

Generate a secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Never commit `.env`. The server refuses to start in production without `SESSION_SECRET` (32+ characters) and `PUBLIC_SITE_URL`.

`DATABASE_PATH` and `UPLOADS_DIR` must point to a persistent writable volume, not the container's temporary filesystem. The included Compose file maps the named volume `bettergo-data` to `/data`.

## Option A — Docker Compose

From the unzipped folder:

```bash
cp .env.example .env
# edit .env: NODE_ENV=production, PUBLIC_SITE_URL, SESSION_SECRET
docker compose up -d --build
docker compose logs -f
```

Open `http://localhost:3001` (or your server's address). The first start creates and seeds the database automatically. This seeds reference data only — no government financial records, users or passwords.

Health check:

```bash
curl -fsS http://localhost:3001/api/health
```

Create the first administrator interactively:

```bash
docker compose exec bettergo npm run create-admin -- --email you@example.com --name "Your Name"
```

The command prompts for a compliant password without printing it. There is no default administrator account or default password.

## Option B — Dockerfile on Render, Railway, Fly.io or another container host

1. Build with the repository Dockerfile.
2. Expose container port **3001**.
3. Add the environment variables above; set `PUBLIC_SITE_URL` to the public HTTPS origin.
4. Mount a persistent disk or volume at **`/data`**.
5. Set the health check path to **`/api/health`**.
6. Deploy. Check logs for `[api] BetterGo Marinduque API listening`.
7. Create the administrator using the host's one-off command/console:
   `npm run create-admin -- --email you@example.com --name "Your Name"`.

The container runs as the non-root `node` user and owns `/data`.

## Option C — plain Node server

Requires Node.js 24 (Node 22.13+ may work, but 24 is the packaged target).

```bash
npm ci
npm run build
NODE_ENV=production \
SESSION_SECRET='<32+ character random secret>' \
PUBLIC_SITE_URL='https://your-domain.example' \
DATABASE_PATH='/var/lib/bettergo/bettergo.db' \
UPLOADS_DIR='/var/lib/bettergo/uploads' \
npm start
```

Put a TLS reverse proxy (Caddy, nginx, Traefik or the host's proxy) in front of port 3001. Keep the data directory outside the release directory and back it up.

## Verification after deployment

```bash
curl -fsS https://your-domain.example/api/health
curl -fsS https://your-domain.example/api/transparency/data-quality
```

Then open:

- `/` — public home
- `/transparency` — transparency portal
- `/transparency/financial-monitoring`
- `/transparency/reports`
- `/transparency/open-data`
- `/transparency/alerts`
- `/transparency/community`
- `/admin` — after signing in with the administrator account

The transparency pages should open with honest empty states until verified records are created and published. A missing record is not PHP 0.

## Backups and restore

Back up the **entire `/data` volume**, not only the `.db` file: SQLite runs in WAL mode, so include `-wal` and `-shm` files or stop the app before copying. For a consistent online backup, use SQLite's backup tooling or stop the container briefly.

Restore by putting the backup back on a new `/data` volume and starting the container. Do not initialize a fresh production database over a backup.

## External services

- Email/SMS/push: not configured. Set `SMTP_URL` and `MAIL_FROM` only if you have an approved provider and consent process. Without it, mail is logged, not delivered; external alert delivery remains labelled unavailable.
- No payment provider, map provider, AI key or external database is required for this package.
- No open-data licence, COA endorsement or government partnership is included or implied.

## Rollback

1. Stop the app.
2. Restore the previous `/data` backup.
3. Re-deploy the previous Docker image or previous source commit.
4. Start the app and verify `/api/health` and `/transparency`.

The Phase 5 schema is additive, so an older application can run against a database containing the newer tables. Do not delete financial records or audit history as part of a rollback.

## Known deployment limits

- SQLite is single-file and suitable for this civic portal's expected scale, but it is not a horizontally scaled multi-writer database. Run one application instance per database volume.
- Uploads and the database must share a persistent volume; ephemeral container storage loses data on restart.
- There is no built-in TLS, CDN or WAF in this package; use the hosting platform or a reverse proxy.
- The project has no production email, SMS or push credentials.
- The application is not certified for WCAG, RA 10173 compliance, security, or government endorsement. Complete independent reviews before production publication.
