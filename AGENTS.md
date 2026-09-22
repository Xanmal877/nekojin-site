# AGENTS.md

## What this is

Nekojin Interactive's website: a root **Node.js HTTP server** (`dashboard-server.js`, no framework) serving the public site from `public/`, the admin panel at `/admin`, and a nested React publishing dashboard built into `public/publishing/`. SQLite-backed (`data/nekojin.db`). See `TASKS.md` for roadmap/changelog and `NEXT_AGENT_NOTE.md` for the current handoff state.

## Layout

`dashboard-server.js` is the **router only**: it owns the gates (CORS/security
headers, rate limits, auth, CSRF, admin role) and the order routes are tried in.
Everything a route calls lives in one named module under `lib/`:

| Module | Owns |
|--------|------|
| `lib/http-helpers.js` | response writers (`sendJson`/`sendHtml`/`sendText`/`redirect`/`forbidden`/`notFound`), `enforceRateLimit`, body readers, slug/path guards |
| `lib/rate-limit.js` | per-IP limits and `RATE_LIMIT_CONFIG` |
| `lib/body-parsing.js` | one buffered read with a size cap, form decoding, multipart |
| `lib/static-files.js` | MIME types and the serve whitelist (`ALLOWED_EXTENSIONS`, `ALLOWED_DIRECTORIES`, `ROOT_ASSETS`) |
| `lib/public-routes.js` | the URL→template table and the public read surface (characters/timeline/lore) |
| `lib/auth-pages.js` | login and register pages |
| `lib/cover-versioning.js` | the content hash appended to cover URLs |
| `lib/integrations.js` | public YouTube / Discord / sales APIs |
| `lib/admin-content.js` | admin CRUD for characters, timeline, lore topics |
| `lib/calendar.js` | publishing calendar (public read + admin write) |
| `lib/manuscripts.js` | optional .docx reading, off unless enabled |
| `lib/publishing-api.js` | the admin publishing dashboard API |
| `lib/{gumroad,youtube,url,newsletter-provider}.js` | provider clients and the URL rule |

**Path resolution:** `__dirname` inside `lib/` is `lib/`, so a module must never
recompute a repo-root path. The server resolves `PUBLIC_DIR`, `MANUSCRIPTS_DIR`
and the DB handles, and hands them over at boot with `configure()`. Adding a
module means adding it to the `require` block and the configure calls near the
bottom of `dashboard-server.js`.

**Require cycles:** `lib/http-helpers.js` is required by most modules, so it
must not require them back. `lib/static-files.js` needs two of its writers, so
they are injected rather than required.

The public site's own pages are split the same way: page-specific CSS and JS
live in `public/css/` and `public/js/` (or `public/assets/admin/` for the admin
panel) instead of inline `<style>`/`<script>` blocks.

## Node requirements

- Root server: **Node.js 20.19+**.
- Publishing dashboard build (`tools/publishing-dashboard`, Vite toolchain): **Node.js 20.19+**.

## Commands

```bash
npm install
npm start                 # run server (default http://localhost:7771)
npm run dev               # node --watch dashboard-server.js
npm test                  # node --test (boots a throwaway server copy)
npm run meta              # regenerate sitemap.xml, rss.xml, robots.txt from the content DB
npm run build:dashboard   # build the nested React dashboard into public/publishing/
npm audit                 # root dependency audit (also run in tools/publishing-dashboard)
```

## Generated assets

- `npm run build:dashboard` runs `tsc -b && vite build` in `tools/publishing-dashboard`; Vite's `outDir` is `../../public/publishing` with `base: '/publishing/'` and `emptyOutDir: true`. The root server serves the built dashboard from `public/publishing/`.
- `npm run meta` (or `generateAll()` imported by the server after a save) writes `public/sitemap.xml`, `public/rss.xml`, and `public/robots.txt` from the live content DB.
- `public/publishing/` is a build output directory (currently contains `index.html` + `assets/`).

## Temporary test behavior

`npm test` (`node --test`) boots **throwaway copies** of the server. `tests/harness.js` is the one place that does it: `startTestServer()` copies the server files, `public/`, and `lib/` into a temp dir, links `node_modules`, spawns the server on the requested port (smoke uses `7781`, not the default `7771`), waits for `/api/health`, and `loginAs()` returns session+CSRF headers. A new suite should call the harness rather than re-implement the preamble. The production code uses a single `operationQueue` in `database.js`; do not restore the old dual-queue design. Native dependencies must be installed for the test suite to start.

## Publishing DB env

The admin publishing dashboard reads a read-only SQLite source, defaulting to `./data/Xanmal_Publishing_Database.sqlite`, overridable with `PUBLISHING_DB_PATH`. The admin-managed public calendar uses `PUBLISHING_CALENDAR_DB_PATH` (default `./data/publishing-calendar.db`).

The manuscript reader/upload subsystem is disabled by default; set
`MANUSCRIPTS_ENABLED=true` only after reviewing the deployment and upload
requirements.

## Ports

- `PORT` env (default `7771`) — main HTTP server, binds `0.0.0.0`.
- Tests use `7781`.

## Runtime files

`data/nekojin.db` (SQLite), `users.json`, `sessions.json`, and other runtime/generated data are gitignored. There are no hardcoded credentials; the bootstrap admin is env-configurable (`ADMIN_BOOTSTRAP_USER` / `ADMIN_BOOTSTRAP_PASSWORD`). `TRUST_PROXY` must be `true` only behind a reverse proxy that sets `X-Forwarded-For`/`X-Real-IP`.

## Persistence changes

- `database.js` serializes saves, backups, game reordering, and book-sequence updates through one `operationQueue`; do not reintroduce separate save and backup queues.
- Character appearance replacement must use the same queue as other database mutations before opening its transaction.
- Persistence changes must preserve restrictive permissions: database directories `0700`, database/backup files `0600`, and backup integrity/schema validation.
- Before committing persistence or security changes, run `npm test`, `npm audit`, `npm --prefix tools/publishing-dashboard audit`, and `npm run build:dashboard`; inspect generated assets and both lockfiles afterward.
