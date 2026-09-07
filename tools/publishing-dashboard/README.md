# Nekojin Publishing Dashboard

A polished editorial dashboard for the Xanmal Chronicles publishing slate. It
reads the Xanmal publishing SQLite database **read-only** and presents an
overview of releases, cadence, series/platform performance, the release
schedule, and data health.

This is the production build of the dashboard. It is served by the root
CommonJS server (`dashboard-server.js`) at `/publishing/`, with the API under
`/api/publishing/*`. There is **no standalone Express runtime** — the root
server owns both the page and the API.

- **Frontend:** React + TypeScript + Vite, single-page app with client-side tabs.
- **API:** served by the root server via `publishing-db.js` (read-only `sqlite3`).
- **Aesthetic:** deep ink/navy background, warm paper panels, coral/amber
  accents, serif display headings with a clean sans-serif UI, responsive layout.

## Requirements

- Node.js 20.19+ (required by the root server dependencies and Vite toolchain).
- The publishing database at the configured `PUBLISHING_DB_PATH` (defaults to
  `data/Xanmal_Publishing_Database.sqlite`). The database is opened
  read-only and is never copied into the project.

## Setup

```bash
npm install
```

## Build

```bash
npm run build
```

This type-checks and builds the frontend into `../../public/publishing` (the
`public/publishing` directory at the repository root), using the base path
`/publishing/`. The root server serves those built assets and the API.

To rebuild reproducibly without turning the root CommonJS app into ESM, run the
build from this directory (or `npm run build:dashboard` from the repository
root — see the root `package.json`).

## Development

Run the root server, then start Vite in dev mode:

```bash
npm run dev
```

The dev server proxies nothing by default; it expects the root server to be
running on the same origin. If you want to point the dev server at a different
host, add a `server.proxy` entry in `vite.config.ts`.

## API endpoints

All endpoints are admin-only and live under `/api/publishing/*`:

| Endpoint                    | Description                                              |
| --------------------------- | -------------------------------------------------------- |
| `GET /api/publishing/health` | Database connectivity and path.                          |
| `GET /api/publishing/overview` | KPIs, cadence, series/platform comparison, upcoming.    |
| `GET /api/publishing/catalog` | Paginated, filterable release catalog (`series`, `platform`, `status`, `q`, `page`, `pageSize`). |
| `GET /api/publishing/filters` | Distinct series, platforms, and statuses for filters.  |
| `GET /api/publishing/series` | Per-series analytics.                                   |
| `GET /api/publishing/health-checks` | Data completeness and integrity checks.          |
| `GET /api/publishing/freshness` | Data freshness metadata.                              |
| `GET /api/publishing/releases` | Releases within a date window (`startUtc`, `endUtc`, `status`, `limit`) for the calendar. |

## Project structure

```
tools/publishing-dashboard/
  package.json          Nested Vite project (kept separate from the root CJS app)
  vite.config.ts        base=/publishing/, outDir=../../public/publishing
  tsconfig*.json
  index.html
  src/
    main.tsx            React entry
    App.tsx             Shell + client-side tab navigation
    api.ts              API client + shared types/formatting
    styles.css          Editorial stylesheet
    views/
      Overview.tsx      KPI cards, cadence, comparisons, upcoming, freshness
      Catalog.tsx       Searchable/filterable catalog table with pagination
      Releases.tsx      Calendar + list views (release-local/Phoenix grouping)
      SeriesAnalytics.tsx
      DataHealth.tsx
```

## Notes

- The dashboard is read-only; nothing in this project writes to the database.
- The calendar groups releases by their local (America/Phoenix) date, matching
  how the schedule is published, rather than by UTC.
- `node_modules` and the built `public/publishing` output are git-ignored.
