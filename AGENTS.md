# AGENTS.md

## What this is

Nekojin Interactive's website: a root **Node.js HTTP server** (`dashboard-server.js`, no framework) serving the public site from `public/`, the admin panel at `/admin`, and a nested React publishing dashboard built into `public/publishing/`. SQLite-backed (`data/nekojin.db`). See `TASKS.md` for roadmap/changelog and `NEXT_AGENT_NOTE.md` for the current handoff state.

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

`npm test` (`node --test`) boots a **throwaway copy** of the server: `tests/smoke.test.js` copies the server files, `public/`, `lib/`, and `node_modules` into a temp dir and runs on port `7781` (not the default `7771`). Tests use a temp working dir and a test admin password. The production code uses a single `operationQueue` in `database.js`; do not restore the old dual-queue design. Native dependencies must be installed for the test suite to start.

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
