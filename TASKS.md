# Nekojin Interactive Website — Project Tracker

> Roadmap, known issues, layout reference, and changelog — all in one file.

- [Planned Features](#planned-features--nekojin-interactive-website)
- [Known Issues](#known-issues--nekojin-interactive-website)
- [Layout Patterns](#layout-patterns)
- [Completed Features](#completed-features--nekojin-interactive-website)

## Planned Features — Nekojin Interactive Website

> Roadmap and upcoming features.  
> **Phase 1: COMPLETE** — 2026-07-11  
> **Phase 2: IN PROGRESS** — 2026-07-11

---

### Phase 2: Content Features (Current)

#### 2.1 Character Pages
**Status:** In Progress  
**Priority:** High

Create dedicated HTML pages for remaining characters:
- [x] Moderator Space
- [x] Moderator Chaos
- [x] Moderator Order
- [ ] Moderator Devotion
- [x] Tama (incarnation)
- [x] Saki (incarnation)
- [x] Acros (incarnation)
- [x] Sarah (character)
- [x] Anna (incarnation)

**Template:** Follow `admin-creation.html` style

---

#### 2.2 Worlds Content
**Status:** Not Started  
**Priority:** Medium

Populate `/xanrean/lore/world` with actual content:
- [ ] Server Clusters explanation
- [ ] Xanrea (A0) details
- [ ] Magic systems
- [ ] Worldbuilding docs

---

#### 2.3 Games Page Polish 🎮
**Status:** Core Complete, Polish Remaining  
**Priority:** Medium

Remaining work:
- [x] Screenshot gallery with lightbox
- [x] Gameplay video section
- [x] System requirements panel
- [x] Tabbed interface (Overview/Features/Media/Devlog)
- [x] Development progress bar

---

#### 2.4 Book Status Workflow
**Priority:** Low  
**Estimated:** 0.5 sessions  
**Status:** Complete ✅

Better book publishing control:
- [x] Status: `draft` → `preview` → `published` → `archived`
- [x] Draft books hidden from public API
- [x] Preview mode (accessible via direct link only)
- [x] Scheduled publishing (date-based)

---

#### 2.5 Series Management Improvements
**Priority:** Low  
**Estimated:** 1 session

- [ ] Drag-and-drop book ordering within series
- [ ] Series cover image
- [ ] Series status (complete, ongoing, planned)
- [ ] Word count totals per series
- [ ] Reading order indicators

---

#### 2.6 Manuscript System — DISABLED ❌
**Status:** Disabled (Option 1)  
**Decision:** Focus on external platform links instead

Manuscript reading/upload hidden. Can re-enable by setting `MANUSCRIPTS_ENABLED = true` in server config.

**Reason:** Drive traffic to Royal Road, ScribbleHub, Kindle where readers already have accounts and engagement metrics help algorithm.

---

### Phase 3: Technical Improvements

#### 3.1 Content Validation
**Priority:** Low  
**Estimated:** 0.5 sessions

- [ ] Validate book slugs are URL-safe
- [ ] Check for duplicate slugs on save
- [ ] Required field enforcement (title, id)
- [ ] Image file type validation (not just extension)
- [ ] File size limits on uploads

---

#### 3.2 Legacy File Cleanup
**Priority:** Low  
**Estimated:** 0.1 sessions

Remove legacy files:
- [ ] `data/site-content.json` (after confirming DB migration)
- [ ] `data/site-content.json.backup`

---

#### 3.3 Health Check Endpoint
**Priority:** Low  
**Estimated:** 0.5 sessions

Monitoring:
- [ ] `/api/health` returns DB status, disk space
- [ ] Uptime monitoring ready
- [ ] Alert if disk > 90%

---

### Phase 4: Future Ideas

#### 4.1 Newsletter System
**Status:** Idea

Currently just captures emails to JSON.

- [ ] Email templating
- [ ] SendGrid/Mailgun integration
- [ ] Subscriber segmentation (by book interest)
- [ ] Unsubscribe handling

---

#### 4.2 Analytics Dashboard
**Status:** Idea

- [ ] Book view counts
- [ ] Popular books ranking
- [ ] Referrer tracking
- [ ] Export reports

**Privacy:** GDPR-compliant, no third-party trackers

---

#### 4.3 Multi-User Editing
**Status:** Idea  
**Blocker:** Needs real-time collaboration

- [ ] Lock book while editing
- [ ] Edit history / versioning
- [ ] Revert to previous versions

---

#### 4.4 API for External Access
**Status:** Idea

- [ ] Public read-only API (books, series)
- [ ] API keys for authenticated users
- [ ] Webhook support (notify on new book)

---

See the [Completed Features](#completed-features--nekojin-interactive-website) section below for the full list of finished work.

---

### How to Use This File

**When starting work:**
```bash
# Update status at top of feature
sed -i 's/⬅️ IN PROGRESS/✅ COMPLETE/' TASKS.md
git commit -am "docs: mark feature complete"
```

**When adding ideas:**
- Add to appropriate phase
- Set realistic priority
- Leave status as "Idea" if not committed

**When finishing:**
- Move details to the Completed Features section below
- Update date


## Known Issues — Nekojin Interactive Website

> Last updated: 2026-08-20

---

### ✅ 2026-08-20 Session — Broken pages, dead routes, and stale character wiring

Site-wide audit and fix pass. Ten real bugs found and fixed, plus content gaps identified
and partially filled in.

**Fixed:**
- `/books` series grouping was completely broken — the client expected `series[].books`
  nested from the server, but `/content` only ever returned a flat `books` array. Every
  book, including the four real *Her Majesty, Tamaneko* volumes, was falling into "Books
  Outside Series." Rebuilt the grouping client-side from `series_id`; the complete-series
  bundle product now shows as a card inside its own series instead of listed as unrelated.
- Homepage (`index.html`) had a phantom empty-scroll bug: `body { height: 100%; }` clamped
  the page to exactly the viewport while real content (hero + footer) was ~30px taller,
  producing a scrollbar that led to blank space below the footer. Fixed, then iterated
  through two follow-up regressions from `min-height: 100%` (silently fails without an
  explicit `html` height) and a zero-floor flex layout (squished panel text illegibly on
  short windows) before landing on: `body { display:flex; flex-direction:column;
  min-height:100vh }`, `.split-panel { flex:1; min-height:480px }`. Result: fits one
  screen exactly on normal/tall windows, scrolls normally (not squished, not phantom) only
  on genuinely short ones. Footer moved off the homepage per request — its markup already
  existed on `/xanrean/community` but was silently unstyled (see below).
- `/xanrean/community`'s footer (About/Patreon/newsletter) has existed in the HTML for a
  while but every class it needs (`.footer-brand`, `.footer-actions`, `.footer-patreon`,
  `.footer-newsletter`, `.footer-link`) only ever existed in `index.html`'s own inline
  `<style>`, not in the shared `style.css` — so it rendered completely unstyled. Added a
  page-scoped `<style>` block with the missing rules (not merged into `style.css`, which
  already has a different, incompatible `footer`/`.footer-inner`/`.footer-copy` used by
  every other page).
- `/api/xanrean` (fetched by the public `/xanrean` page for panel background images) sat
  below the server's global auth gate, so anonymous visitors got redirected to `/login`.
  Since `fetch()` follows redirects, the page silently got login-page HTML back instead of
  JSON — any admin-set custom background images never showed for logged-out visitors.
  Moved above the gate alongside `/api/homepage`, which was already correctly public.
- `/xanrean/characters/admin-creation`, `/admin-destruction`, and `/moderator-time` served
  unfinished draft pages with visible dev placeholder text ("Replace
  images/admin-creation.webp with the final portrait") instead of the real character
  content. Deleted the orphaned drafts and routed all three to the shared character
  template — they're aliases of Tama, Saki, and Anna (confirmed via the entity/incarnation
  split in the lore compendium). That surfaced a second bug: the template's actual
  data-fetch (`/api/characters/:slug`) never matched the alias-to-file mapping I first
  tried editing — it hits the DB by slug directly, which 404'd. Added client-side alias
  resolution instead, and deleted a ~90-line `CHARACTERS` config object in
  `character.html` that turned out to be entirely dead code, never referenced anywhere.
- Character detail pages (`character.html`) had a hardcoded, static "← Back to The Admins"
  link — every character, including moderators and other characters, showed this same
  wrong label/link. Now set dynamically from the character's `char_type`.
- `timeline_events` table was completely empty — `/xanrean/lore/timeline` showed nothing.
  Populated all 11 eras from `Xanrea_Lore_Compendium.md` (Reggie & Tulip through The Hero
  is Perfect) using the source text directly, cross-linked to existing character and book
  records where they exist.
- `/xanrean/wiki`'s species/lore links were broken two ways: the `compendium` fallback
  fetched a file that has never existed (`/data/characters/compendium.md` — the real file
  lives at `/data/lore/compendium.md`), and in-content `[[Species]]` links redirected
  visitors away to a separate page (`reader.html`) instead of showing content in the wiki.
  Wired the wiki to load the real shared compendium, added heading-anchor IDs (never
  existed, so `#nekojin`-style links never actually scrolled anywhere) and a `hashchange`
  listener so sidebar links work without a full reload. Added the missing CleanSweeper
  species stub and full Administrative Entities section to the shared compendium file
  (both existed in the source doc but not yet on the site).
- Wired real portrait art (from `My Characters/Created Characters/`) into the DB for Tama,
  Saki, and Anna — `character.html`'s avatar code previously always overwrote the avatar
  element with an emoji even when an image existed, so this needed a small template fix
  too, not just a DB update.
- Published missing/inconsistent Gumroad custom landing pages (Guardian, Lucas the Grand
  Strategist, The Hero is Perfect) to match the existing red/gold template family used by
  the other four products.

**Still open / not addressed this session:**
- **Character portraits** — only Tama, Saki, and Anna have real art wired in. Xanari,
  Acros, Sarah, and the four Moderator entities still fall back to emoji avatars. No
  dedicated portrait files were found for them under `My Characters/`; ask before sourcing/
  generating anything for these.
- **Copyright year duplicated and already inconsistent across pages** — hardcoded
  `© 2025` in `xanrean.html`, `about.html`, `xanrean/community.html` vs `© 2026` in
  `book.html`, `books.html`, `games.html`. Same string copy-pasted per page instead of
  computed once; will silently go stale again next year in whichever copies don't get
  hand-edited. Worth centralizing (e.g. render `new Date().getFullYear()` or pull from a
  single shared partial/include) rather than re-fixing by hand each time it's noticed.
- **`/api/lore/world-topics`** (`dashboard-server.js`) is a real, working endpoint with no
  caller anywhere on the site — dead code, low-priority cleanup.
- **Moderator Devotion** — still placeholder bracketed text in
  `public/data/characters/moderator-devotion.md`, unchanged since the last audit; still
  awaiting real source material (see Character Pages status below).
- **`/xanrean/lore/world`** — still genuinely placeholder, 0 rows in `lore_topics` for the
  `world` section. Unchanged since the last audit; needs real worldbuilding source
  material, not invented content.
- Corrected a factual error further down this file: the "not under git" note in the
  passoff section was wrong — this directory is a git repo (`main`/`dev` branches).
- **Copyright year** was hardcoded per-page and already inconsistent (fixed, see above) —
  now computed via `new Date().getFullYear()` on all 6 pages that had it.
- **`/api/lore/world-topics`** dead endpoint removed from `dashboard-server.js`.
- **Rebuilt character browsing as a single swipeable card deck.** Reading one character's
  bio used to take 3 full-page splash-screen clicks (`/xanrean/lore/characters` → Admins-
  or-Moderators picker → individual bio page), and "entity" characters (Admin Creation,
  Moderator Time) had separate near-duplicate routes from their "incarnation" selves (Tama,
  Anna) despite being the same person. Replaced with `/xanrean/characters` — one page, one
  deck sourced directly from the `characters` table (naturally collapses entity/incarnation
  duplicates since there's only one DB row per character), with All/Admins/Moderators/Other
  filter tabs and click-to-expand inline reading (Prev/Next between characters without
  leaving the page). The old three pages (`/xanrean/lore/characters`,
  `/xanrean/characters/admins`, `/xanrean/characters/moderators`) now redirect there for any
  existing bookmarks/links; `character.html`'s back-link and the wiki sidebar were updated
  to point at the new page instead.
- **Corrected Admin/Moderator categorization** per author direction: only Tama (Admin
  Creation), Saki (Admin Destruction), Anna (Moderator Time), and Xanari (Moderator Space)
  are confirmed to hold those identities. The standalone Moderator Chaos/Order/Space/
  Devotion entity rows in the `characters` table were tagged `char_type = 'Moderator'`,
  which duplicated/asserted that same claim for characters whose moderator status isn't
  settled yet — recategorized to plain `Character`. Acros's and Sarah's titles ("First
  Incarnation of Moderator Order"/"...Chaos") baked in the same unconfirmed claim —
  simplified to their species/role ("Traveler"/"Spirit"). The `/xanrean/characters` cast
  deck's tab filter reads `char_type` live, so the Admins/Moderators tabs now correctly
  show only those four; everyone else falls under Other Souls until the author updates
  their canon.

---

### ✅ 2026-08-06 Follow-up — Silent full-content wipe (data loss, now fixed)

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

### ✅ 2026-08-06 Full Audit — Fixed

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

### 🔴 Open Issues

#### 1. Character Pages Populated
**Status:** Partially Resolved  
**Impact:** Medium

Dynamic Markdown-based character pages now exist for:
- ✅ Moderator Time (entity alias of Anna, `/xanrean/characters/moderator-time`)
- ✅ Moderator Space
- ✅ Moderator Chaos
- ✅ Moderator Order
- ❌ Moderator Devotion (awaiting source material)
- ✅ Tama (incarnation) — real portrait art, was emoji-only
- ✅ Saki (incarnation) — real portrait art, was emoji-only
- ✅ Admin Creation (entity alias of Tama, `/xanrean/characters/admin-creation`)
- ✅ Admin Destruction (entity alias of Saki, `/xanrean/characters/admin-destruction`)
- ✅ Acros (incarnation) — emoji fallback, no portrait art yet
- ✅ Sarah (character) — emoji fallback, no portrait art yet
- ✅ Anna (incarnation) — real portrait art, was emoji-only
- ✅ Xanari — emoji fallback, no portrait art yet

**2026-08-20:** The three "entity" alias routes (`admin-creation`, `admin-destruction`,
`moderator-time`) were previously serving unfinished draft pages with dev placeholder text
visible to real visitors. Fixed — see the 2026-08-20 session entry above for details.

**Action:** Dedicated standalone HTML pages remain a future polish item; current dynamic pages are content-complete except Moderator Devotion. Portrait art still needed for Xanari, Acros, Sarah, and the four Moderator entities (Chaos/Order/Space/Devotion).

---

#### 3. Worlds Page is Placeholder
**Status:** Open  
**Impact:** Low

`/xanrean/lore/world` has basic placeholder content.
Needs actual worldbuilding content: Server Clusters, magic systems, etc.

**Action:** Populate with actual worldbuilding content.

---

### 📋 Recently Fixed

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
| **`/books` series grouping totally broken** | 2026-08-20 | Client-side rebuild from `series_id` |
| **Homepage phantom-scroll + footer relocation** | 2026-08-20 | `min-height:100vh` flex layout |
| **`/xanrean/community` footer unstyled** | 2026-08-20 | Added missing page-scoped CSS |
| **`/api/xanrean` gated behind login** | 2026-08-20 | Moved above auth gate, public like `/api/homepage` |
| **Entity character pages (admin-creation/-destruction, moderator-time) served dev placeholders** | 2026-08-20 | Deleted drafts, aliased to real template |
| **`character.html` back-link hardcoded to "The Admins" for every character** | 2026-08-20 | Set dynamically from `char_type` |
| **Timeline page empty (0 rows)** | 2026-08-20 | Imported 11 eras from lore compendium |
| **Wiki species/lore links broken + redirected away from wiki** | 2026-08-20 | Fixed fetch path, added anchor IDs + hashchange |
| **Tama/Saki/Anna missing portrait art** | 2026-08-20 | Wired in real character art |

---

### 📝 Issue Template

```markdown
#### [Number]. [Title]
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

### 🤖 Passoff for the Next LLM

1. Read this file (TASKS.md) — it now contains the full roadmap, issues, and changelog in one place.
2. Run tests: `npm test`. Expected: **16/16 passing**.
3. Key files: `database.js`, `dashboard-server.js`, `accounts.js`, `admin.html`, `public/*.html`.
4. `/login` is rate-limited to 5 attempts per 15 minutes per IP. Re-use the shared login pattern in `tests/smoke.test.js`.
5. This directory is a git repo (`main`/`dev` branches). Commit/back up as normal.
6. Do not invent fictional worldbuilding text for moderator/world pages; ask the user for source material.


## Layout Patterns

### VBox Layout (Fullscreen Panels)

Use this pattern when you want header → content → footer stacked vertically with zero gaps.

#### CSS Pattern

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  height: 100%;
  overflow: hidden;
}

body {
  display: flex;
  flex-direction: column;
}

/* Header - fixed height */
nav {
  flex-shrink: 0;
  height: 60px;
}

/* Main content - fills remaining space */
main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Panels container */
.panels {
  display: flex;
  flex: 1;
  width: 100%;
}

/* Individual panels */
.panel {
  flex: 1;
  height: 100%;
}

/* Footer - fixed height */
footer {
  flex-shrink: 0;
  height: 52px;
}
```

#### HTML Structure

```html
<body>
  <nav>Header (60px)</nav>
  <main>
    <section class="panels">
      <div class="panel">Panel 1</div>
      <div class="panel">Panel 2</div>
    </section>
  </main>
  <footer>Footer (52px)</footer>
</body>
```

#### Key Points
- No `position: fixed` needed (except maybe nav)
- Use `flex: 1` on main content area to fill space
- Use `flex-shrink: 0` on header/footer to prevent squishing
- All heights add up to 100vh (60px + remaining + 52px)

---

### Split Panels (2-Column)

For immersive 50/50 or 60/40 splits.

```css
.container {
  display: flex;
  height: 100vh;
  width: 100vw;
}

.panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

---

### Grid Panels (2x2)

For 4-panel grid layout.

```css
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  height: 100vh;
  width: 100vw;
}
```

## Completed Features — Nekojin Interactive Website

> A running log of everything we've built, fixed, and improved.
> 
> **Last Updated:** 2026-08-06

---

### 🎉 Today's Major Progress (2026-07-11)

#### Character System Restructure
**What:** Complete reorganization of Admins and Moderators
- Admins moved to `/characters/admins/` folder
- Moderators moved to `/characters/moderators/` folder
- Dedicated pages: Admin Creation, Admin Destruction, Moderator Time, Moderator Space
- Template-based pages for remaining characters
- All server routes updated

**Before:** Flat structure, all in `/characters/`
**After:** Organized by tier (Admins/Moderators)

#### Lore System Architecture
**What:** Complete lore section rebuild
- **Lore Hub:** `/xanrean/lore/` - VBox layout matching main hub
- **Characters:** `/xanrean/lore/characters` - Moved from root
- **Species:** `/xanrean/lore/species` - 4-panel layout (Nekojin, Foxkin, Elves, Travelers)
- **Worlds:** `/xanrean/lore/world` - Placeholder for worldbuilding content

**Layout Pattern:** VBox (Header → Cards → Footer, zero gaps)

#### Xanrean Hub Polish
**What:** Final visual refinements
- Cards now have slight rounding (8px border-radius)
- Small gap between cards (0.5rem)
- Content positioned at 3vh from top
- Perfect VBox layout with floating footer

---

### 🛠️ 2026-08-06 Session — Security, Data Safety, Content, and Publishing

#### Silent Full-Content Wipe — Fixed
- `database.js`: `SaveAllContent()` refuses empty payloads when real content exists (`409 EMPTY_CONTENT_GUARD`).
- `admin.html`: load failure now blocks the editor instead of silently rendering empty panels.
- `tests/smoke.test.js`: regression test ensures empty save is rejected and content survives.

#### Last-Admin Lockout — Fixed
- `accounts.isLastAdmin()` guards `DELETE /api/users/:username` and `POST /api/users/:username/role`.
- Covered by smoke test.

#### Startup Silent-Wipe Warning
- `dashboard-server.js` warns on startup if content tables are empty while `public/covers/` still has files.

#### Automated Pre-Import / Pre-Save Backups
- `backup.js` exports `createRestorePoint(label)`.
- `tools/restore-content.js` backs up before importing.
- `/save-content` backs up before each bulk save.

#### Content Restoration
- `tools/restore-content.js` imports real books/series/game/about from local sources.
- Result: 1 series, 7 books, 1 game, 1 about record; 7 cover images in `public/covers/`.

#### Games Page Polish
- `public/games.html`: Overview | Features | Media | Devlog tabs.
- Screenshot lightbox, 16:9 gameplay video section, system requirements panel, animated progress bar.
- New optional game fields: `progress`, `systemRequirements`, `videoUrl` (wired in `admin.html` and `restore-content.js`).

#### Book Status Workflow
- Valid statuses enforced: `draft`, `preview`, `published`, `archived` (legacy `released` treated as published).
- Public `/content` filters drafts/archived; preview books accessible via `/book-by-slug?slug=...&preview=1`.
- Optional scheduled publishing via `publish_at`.
- Admin book editor has Status dropdown + Publish At datetime input.

**Tests:** `npm test` → 16/16 passing.

---

### 📚 2026-08-06 Session — Character & Lore Content Integration

#### Lore Compendium Live
- Added `public/data/lore/compendium.md` from source material.
- Lore reader (`/xanrean/lore/reader.html`) now loads the full compendium with TOC.
- Species hub expanded from 4 to 6 panels: added **Wolfkin** and **Kitsune**.
- Updated public-facing species descriptions to match canon.

#### Character Pages Populated
- Added Markdown sources under `public/data/characters/` for:
  - **Tama** (incarnation of Admin Creation)
  - **Saki** (incarnation of Admin Destruction)
  - **Anna** (incarnation of Moderator Time)
  - **Sarah** (first incarnation of Moderator Chaos)
  - **Acros** (first incarnation of Moderator Order)
  - **Moderator Chaos** & **Moderator Order** entity profiles
- Added server route for `/xanrean/characters/anna`.
- Updated Admins and Moderators hub footers with incarnation links.
- Updated `sitemap.xml` with new character and lore URLs.
- Updated `.gitignore` to include `public/data/` content in the repo.

**Tests:** `npm test` → 16/16 passing.

---

#### Newsletter Database ✅
**What:** Moved newsletter subscribers from JSON to SQLite
- `subscribers` table with email, source, subscribed_at, active status
- Duplicate email handling (ON CONFLICT)
- Query capabilities (filter by source, active status)

**Before:** `newsletter-subscribers.json` file (corruption risk)  
**After:** ACID-compliant database table

---

#### Content Backup System ✅
**What:** Automatic database backups with retention policy
- `backup.js`: standalone backup utility
- Auto-backup on server start (if not already done today)
- Daily scheduled backups (24h interval)
- Admin API: POST /api/backup, GET /api/backup/status
- Cleanup: keeps last 7 days, auto-deletes older backups

**Storage:** `data/backups/nekojin-YYYY-MM-DD.db` (~90KB per backup)

**Before:** No backups, data loss risk  
**After:** Daily backups, 7-day retention, manual trigger via API

---

#### System Theme Detection ✅
**What:** Respect user's OS dark/light mode preference
- Detection priority: localStorage → system preference → default light
- Applied before first render (no flash of wrong theme)
- Works with existing toggle (toggle overrides system)

**Before:** Light default, no system detection  
**After:** System-aware, user-overridable

---

#### SEO Meta Tags ✅
**What:** Improved Open Graph and meta tags for all pages
- Compelling descriptions matching actual content
- Keywords: indie games, fantasy, progression fiction, litrpg, etc.
- Proper OG images (book covers for books, game for games)
- Dynamic meta updates on book.html when book loads

**Before:** Generic descriptions, game cover used everywhere  
**After:** Tailored per-page, proper keywords, relevant images

---

### 🏗️ Infrastructure

#### Database Migration ✅
**What:** Migrated from JSON files to SQLite
- Single-file database (`data/nekojin.db`)
- Class-based database wrapper (Godot-style)
- Transaction safety on saves
- Query capabilities for search/filter

**Impact:** Data integrity, faster queries, ACID compliance

---

#### Code Cleanup ✅
**What:** Removed deprecated AI chat system
- Deleted 1,200+ lines of unused code
- Extracted auth module (`accounts.js`)
- Removed WebSocket dependencies
- Cleaned service worker references

**Impact:** Smaller codebase, easier maintenance

**Before:** `dashboard-server.js` ~1,735 lines  
**After:** ~562 lines (-68%)

---

#### Session Cleanup ✅
**What:** Automatic cleanup of expired sessions
- Runs every hour via `setInterval`
- Also cleans on load if expired sessions found
- Logs number of removed sessions

**Before:** `sessions.json` grew forever, never cleaned
**After:** File stays lean, only active sessions stored

---

#### Static Asset Whitelist ✅
**What:** Security hardening for static file serving
- Whitelist allowed file extensions
- Whitelist allowed directories (/covers/, /assets/, /images/, /fonts/)
- Block path traversal attacks (../etc/passwd)
- Return 403 Forbidden for invalid paths

**Before:** Any .html/.js/.css served from public/  
**After:** Only whitelisted extensions and safe paths

---

#### Layout Patterns Documented ✅
**What:** Documented layout patterns in this file
- VBox Layout pattern (fullscreen panels)
- Split Panels pattern (2-column)
- Grid Panels pattern (2x2)
- Documented for future use

---

#### Single-Page Layout ✅
**What:** Complete homepage overhaul
- Removed "Featured" sections (pointless with 4 books, 1 game)
- Everything visible without scrolling
- Hero → Newsletter → Footer flow

**Before:** Hero → Featured Books → Featured Games → Newsletter → Footer  
**After:** Hero + Newsletter inline → Footer

---

#### Typography ✅
**What:** Fixed font sizing ratio
- Title: `clamp(2.5rem, 5vw, 4rem)`
- Body: `clamp(1.25rem, 2.5vw, 1.5rem)`
- Ratio: 2.5:1 (readable on all screens)

**Before:** Title was 7.5rem max (way too big), body was tiny  
**After:** Balanced, professional sizing

---

#### Character CTA Buttons ✅
**What:** Animated Saki and Tama icons in buttons
- Saki faces down (new sprite: `saki_idle_down.png`)
- Tama faces down (existing sprite)
- 48px animated sprites
- Both buttons purple gradient

**Before:** Static emoji icons (📖 🎮)  
**After:** Living characters that blink and move

---

#### Theme System ✅
**What:** Light/Dark mode toggle
- Sun/Moon icon in navigation
- Light mode default
- CSS custom properties switch
- Preference saved to localStorage
- Persists across all pages

**Before:** Dark only, hardcoded colors  
**After:** User choice, smooth transitions

---

#### Navigation Restructure ✅
**What:** Better nav layout
- Logo + nav links on left
- Theme toggle + search on right
- Bigger, boxed navigation tabs
- Hover lift effects

---

### 👤 User Management

#### Admin User Panel ✅
**What:** Full user management in admin
- List all users (username, role, created date)
- Create users with role selection
- Reset passwords (with modal, not prompt)
- Delete users (with confirmation)
- Change roles (User ↔ Admin)
- Protected default admin (`xanmal`)

**Before:** No UI, manually edit `users.json`  
**After:** Complete admin interface

---

#### Authentication System ✅
**What:** Secure auth extracted to module
- bcrypt password hashing
- Session management with TTL
- Role-based access (admin/user)
- Cookie-based sessions

---

### 🎮 Games Features

#### Multi-Game Support ✅
**What:** Admin can manage multiple games
- Games list view
- Add/edit/delete games
- Platform links (Steam, Itch, GOG, Epic)
- Demo support (Try Demo buttons)
- Smart labels (Wishlist → Get → Try Demo)

**Before:** Single hardcoded game  
**After:** Scalable game portfolio

---

### 🛡️ Security

#### Rate Limiting ✅
**What:** Protection against abuse

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/login` | 5 | 15 min |
| `/register` | 3 | 1 hour |
| `/newsletter` | 10 | 1 hour |
| `/api/users` | 20 | 15 min |
| default | 100 | 1 min |

**Features:**
- IP-based tracking
- 429 responses with Retry-After
- Auto-cleanup every 10 min
- No external dependencies

**Impact:** Blocks brute force, spam, abuse

---

#### Path Security ✅
**What:** Moved database to local directory
- Was: `~/Documents/nekojin-data/`
- Now: `./data/nekojin.db`
- Gitignored `data/` directory

**Impact:** Portable, Pi-deployment ready, no hardcoded paths

---

### 🖼️ Media Handling

#### Image Optimization ✅
**What:** Automatic image processing with Sharp
- Convert uploads to WebP
- Resize large images (max 1200px)
- Generate 400px thumbnails
- Quality: 85% full, 80% thumbnail

**Before:** Raw uploads, multi-MB files  
**After:** ~90% size reduction, faster loading

---

#### Homepage Background Customization ✅
**Status:** Complete 2026-07-11  
**Priority:** Low  
**Estimated:** 0.5 sessions  
**Actual:** ~8 sessions (included critical bug fixes)

Admin-configurable homepage split-panel backgrounds:
- ✅ Upload custom images for Xanrean Chronicles panel
- ✅ Upload custom images for Standalone Works panel  
- ✅ Upload custom images for About panel (added third panel)
- ✅ Image preview in admin with live updates
- ✅ Fallback to default book covers if not set
- ✅ Store paths in database (homepage_settings table)
- ✅ File overwrite system (no duplicate accumulation)

**Critical Bug Fixed:** GET handler was catching POST requests (missing method check)
- Root cause: `if (url === '/api/homepage')` caught ALL HTTP methods
- Fix: Added `req.method === 'GET' &&` check to GET handler
- Impact: Admin settings now save correctly to database

**Before:** Static homepage with hardcoded content  
**After:** Dynamic, customizable homepage with three universe portals

---

#### Service Worker Removal ✅
**What:** Completely removed problematic service worker
- Was intercepting API calls and returning cached responses
- Caused POST /api/homepage to return cached GET response (old data)
- Admin changes appeared to save but didn't persist

**Before:** Service worker cached API responses incorrectly  
**After:** All requests go directly to server, no caching interference

---

#### Book Cover Display Fix ✅
**What:** Changed book cover display from `cover` to `contain`
- Full cover images visible without cropping
- Better for portrait-oriented book covers on homepage panels

**Before:** `background-size: cover` (cropped edges, didn't show full image)  
**After:** `background-size: contain` (full image visible, no cropping)

---

### 📊 Stats

| Metric | Before | After |
|--------|--------|-------|
| Server lines | 1,735 | ~650 |
| Homepage sections | 5 | 3 |
| Database | JSON files | SQLite |
| User management | Manual JSON | Admin UI |
| Theme | Dark only | Light/Dark toggle |
| Rate limiting | None | 5 endpoints protected |
| Image optimization | None | WebP + thumbnails |
| Character structure | Flat | Hierarchical (Admins/Moderators) |
| Lore section | None | Complete (Characters/Species/Worlds) |

---

### 🎯 What's Left (Known Issues)

See the [Known Issues](#known-issues--nekojin-interactive-website) section above for the canonical issue list and the [Planned Features](#planned-features--nekojin-interactive-website) section for the roadmap.

High-level reminders:
1. **Verify production/Pi data** before treating the local DB as canonical.
2. **Moderator Pages / Worlds Content** — need real source material; do not invent.
3. **Content Validation** — slugs, duplicates, required fields, image validation.
4. **Legacy JSON Files** — `data/site-content.json` and `.backup` can be removed once confirmed unused.

---

### 🚀 Deployment Status

**Environment:** Local working copy (not a git repo here).  
**Local test status:** `npm test` → 16/16 passing.  
**Next step:** Verify production/Pi `data/nekojin.db` and backups, or continue with roadmap items in the [Planned Features](#planned-features--nekojin-interactive-website) section.

---

### 💡 Next Ideas

- **Series Management Improvements** — drag-and-drop ordering, series cover/status, word counts.
- **Content Validation** — URL-safe slugs, duplicates, required fields, image validation.
- **Health Check Endpoint** — disk-space alerts, uptime ready.
- **More Moderator Pages** — Dedicated pages for remaining moderators.
- **Worlds Content** — Populate worldbuilding section.

---

*This file should be updated whenever we complete something significant.*
