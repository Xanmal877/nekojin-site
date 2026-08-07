# Known Issues — Nekojin Interactive Website

> Last updated: 2026-08-06

---

## ✅ 2026-08-06 Follow-up — Silent full-content wipe (data loss, now fixed)

Independent re-verification of the audit below found the audit's claims consistent with the
code, but missed a live data-loss bug: **the production `data/nekojin.db` had zero rows in
`books`, `series`, `game`, and `about`**, despite `public/covers/` containing months of real
book/panel cover uploads.

**Root cause:**
- `admin.html`'s `loadContent()` swallowed a failed `GET /content` and left `siteContent`
  as-is.
- `ensureGamesArray()` fabricated `siteContent = {}`, defeating the only guard in
  `saveContent()`.
- `/save-content` → `SaveAllContent()` did an unconditional full-table `DELETE` + reinsert
  on every save, so a save from an empty state silently erased everything else.

Reproduced end-to-end against a scratch copy.

**Fixed, defense-in-depth:**
- `database.js`: `SaveAllContent()` now refuses (`409`, `EMPTY_CONTENT_GUARD`) any save where
  the incoming payload has no series/books/game/about data *and* the database currently has
  real content.
- `admin.html`: `init()` now blocks the editor behind a full-screen error overlay if
  `/content` fails to load. `ensureGamesArray()` no longer fabricates `siteContent`.
  `saveContent()` surfaces the server's real error message.
- Added regression test in `tests/smoke.test.js`: empty payload is rejected and seeded
  content survives.

**Also fixed:** the user-management API had no protection against deleting or demoting the
last remaining admin. `accounts.isLastAdmin()` now blocks both
`DELETE /api/users/:username` and `POST /api/users/:username/role` when it would leave zero
admins, covered by a new smoke test.

---

## ✅ 2026-08-06 Full Audit — Fixed

A full code review turned up 20 issues spanning security, data-integrity, and dead-code
problems. All were fixed in one pass:

- **Hardcoded admin credentials removed.** `xanmal` / `nekojin2026` was baked into
  `accounts.js`. The bootstrap admin is now created only on a genuinely empty `users.json`,
  using `ADMIN_BOOTSTRAP_USER`/`ADMIN_BOOTSTRAP_PASSWORD` env vars or a random password
  printed once to the server log. **If your live `users.json` still has the old `xanmal`
  account, change its password now** — it was exposed in source history.
- **Series editor was silently broken end-to-end.** Admin panel wrote `series.universe`/
  `universeDesc`, but the DB only knew `name`/`description` — every save wiped series names.
  Fixed with proper field mapping in `database.js`.
- **About page editor was mostly broken too.** `tagline`, `portrait`, `description2/3`,
  `universeBlurb`, and platform `links` were all editable in admin.html but had no matching
  DB columns — none of it persisted. Added the missing columns and wired the public
  `about.html` page to actually render them (including a `footer-tagline` null-reference bug
  that was silently aborting the rest of the page's CMS rendering).
- **"Primary CTA Platform" selector did nothing** — added the missing `cta_platform` column.
- **Stored XSS in `about.html`** — `description2` went through `.innerHTML` unescaped while
  its siblings used `.textContent`. Now consistent.
- **CORS reflected any `Origin` with credentials enabled** — now restricted to
  `ALLOWED_ORIGINS` (env-configurable).
- **CSRF protection added** — double-submit cookie token required on all authenticated
  POST/DELETE requests, defense-in-depth alongside the existing `SameSite=Strict` cookie.
- **Unbounded request bodies** (memory-exhaustion DoS) — all `readRawBody()` calls now have
  per-route size caps.
- **Path traversal in `/upload-cover`** — the `bookId` form field was used directly in a
  filename with no sanitization. Now stripped to safe characters.
- **`SaveAllContent` wasn't transactional** — a failure partway through wiped tables without
  restoring them. Now wrapped in `BEGIN`/`COMMIT`/`ROLLBACK`.
- **A single bad request could crash the whole server** — the request handler had no
  top-level error boundary; any thrown/rejected error was an unhandled rejection. Now caught
  and turned into a proper 500/413 response.
- **Public `/register` is now off by default** (`ALLOW_PUBLIC_REGISTRATION` env var) — this
  is a single-author site, not a multi-tenant app.
- **`generate-meta.js` (sitemap/RSS) was completely broken** — it read a `site-content.json`
  file that hasn't existed since the SQLite migration. `public/sitemap.xml` was stale since
  May and had zero `/xanrean/*` pages. Rewritten to pull from the live DB, include all
  `/xanrean/*` routes, and auto-regenerate after every `/save-content` save.
- **Added `/api/health`**, an `IP` spoofing fix for rate limiting (`TRUST_PROXY` env var,
  off by default), keyboard accessibility on a couple of admin-panel click targets, minimum
  password length bumped 6→8, removed the two stale one-time migration scripts
  (`migrate-to-sqlite.js`, `migrate-newsletter.js` — still in git history if needed), stripped
  debug `console.log` noise from hot paths, and added a smoke-test suite (`npm test`).

See the README's new "Environment Variables" section for the deploy-relevant settings this
introduced.

---

## 🔴 Open Issues

### 1. Duplicate Route in Server
**Status:** ✅ Fixed 2026-07-11 (removed duplicate)  
**Impact:** Low

`moderator-chaos` appeared twice in PUBLIC_ROUTES (lines 364 and 368).
JavaScript objects allow duplicate keys, but last one wins.

**Fix:** Removed duplicate entry.

---

### 2. Character Pages Populated
**Status:** Partially Resolved  
**Impact:** Medium

Dynamic Markdown-based character pages now exist for:
- ✅ Moderator Time
- ✅ Moderator Space
- ✅ Moderator Chaos
- ✅ Moderator Order
- ❌ Moderator Devotion (awaiting source material)
- ✅ Tama (incarnation)
- ✅ Saki (incarnation)
- ✅ Acros (incarnation)
- ✅ Sarah (character)
- ✅ Anna (incarnation)

**Action:** Dedicated standalone HTML pages remain a future polish item; current dynamic pages are content-complete.

---

### 3. Worlds Page is Placeholder
**Status:** Open  
**Impact:** Low

`/xanrean/lore/world` has basic placeholder content.
Needs actual worldbuilding content: Server Clusters, magic systems, etc.

**Action:** Populate with actual worldbuilding content.

---

## 📋 Recently Fixed

| Issue | Date | Commit |
|-------|------|--------|
| **Duplicate moderator-chaos route** | 2026-07-11 | `fix: remove duplicate route` |
| **Character pages populated** | 2026-08-06 | Source material integrated into dynamic pages |
| **Lore compendium integrated** | 2026-08-06 | Added Wolfkin/Kitsune to species hub |
| **Character folder restructure** | 2026-07-11 | Multiple commits |
| **Lore system architecture** | 2026-07-11 | Complete rebuild |
| **VBox layout** | 2026-07-11 | Header/Cards/Footer |
| **Service Worker Caching Issues** | 2026-07-11 | `fix: completely remove service worker` |
| **Homepage Settings Save Not Working** | 2026-07-11 | `CRITICAL FIX: GET handler method check` |

---

## 📋 Recently Fixed

| Issue | Date | Commit |
|-------|------|--------|
| **Duplicate moderator-chaos route** | 2026-07-11 | `fix: remove duplicate route` |
| **Character pages populated** | 2026-08-06 | Source material integrated into dynamic pages |
| **Lore compendium integrated** | 2026-08-06 | Added Wolfkin/Kitsune to species hub |
| **Character folder restructure** | 2026-07-11 | Multiple commits |
| **Lore system architecture** | 2026-07-11 | Complete rebuild |
| **VBox layout** | 2026-07-11 | Header/Cards/Footer |
| **Service Worker Caching Issues** | 2026-07-11 | `fix: completely remove service worker` |
| **Homepage Settings Save Not Working** | 2026-07-11 | `CRITICAL FIX: GET handler method check` |
| **Silent full-content wipe** | 2026-08-06 | Defense-in-depth guard + admin overlay |
| **Last-admin lockout** | 2026-08-06 | `accounts.isLastAdmin()` guards |
| **Startup silent-wipe warning** | 2026-08-06 | Empty-content check on server start |
| **Pre-import/pre-save backups** | 2026-08-06 | `createRestorePoint()` in `backup.js` |
| **Games page polish** | 2026-08-06 | Tabs, lightbox, video, sysreq, progress bar |
| **Book status workflow** | 2026-08-06 | `draft/preview/published/archived` + preview endpoint |

---

## 📝 Issue Template

```markdown
### [Number]. [Title]
**Status:** Open | In Progress | Blocked | Fixed  
**Impact:** Critical | High | Medium | Low

Description here...

**Reproduction:** (if applicable)
1. Step 1
2. Step 2

**Expected:** What should happen  
**Actual:** What happens instead
```

---

## 🤖 Passoff for the Next LLM

1. Read this file first, then `docs/PLANNED.md` and `docs/COMPLETED.md`.
2. Run tests: `npm test`. Expected: **16/16 passing**.
3. Key files: `database.js`, `dashboard-server.js`, `accounts.js`, `admin.html`, `public/*.html`.
4. `/login` is rate-limited to 5 attempts per 15 minutes per IP. Re-use the shared login pattern in `tests/smoke.test.js`.
5. This directory is not under git. Back up manually if rollback safety is needed.
6. Do not invent fictional worldbuilding text for moderator/world pages; ask the user for source material.
