# Planned Features — Nekojin Interactive Website

> Roadmap and upcoming features.  
> Last updated: 2026-07-11 (Games page revamp in progress - multi-game support added ✅)

---

## Phase 1: Foundation (Current)

### 1.1 SQLite Migration ✅ COMPLETE
**Date:** 2026-07-11  
**Priority:** Critical  
**Estimated:** 1-2 sessions

Move from JSON file storage to SQLite database:

- [x] Migration script (`migrate-json-to-sqlite.js`)
  - Read existing `site-content.json`
  - Populate SQLite tables
  - Verify data integrity
- [x] Update `/content` endpoint to query database
- [x] Update `/save-content` endpoint to use transactions
- [ ] Add database backup on save (`.db.backup`)
- [x] Test with existing data
- [ ] Update `generate-meta.js` to use DB (optional)

**Technical:** See `database.js` — already has schema and methods.

---

### 1.2 Admin User Management ✅ COMPLETE
**Date:** 2026-07-11  
**Priority:** High

Add account management to admin panel:

- [x] User list view (username, role, created date)
- [x] Create user button (calls existing `accounts.js`)
- [x] Reset password functionality
- [x] Delete user (with confirmation)
- [x] Role assignment (admin/user)
- [x] Protected default admin from deletion

---

### 1.3 Content Validation
**Priority:** Medium  
**Estimated:** 0.5 sessions

Improve data integrity:

- [ ] Validate book slugs are URL-safe
- [ ] Check for duplicate slugs on save
- [ ] Required field enforcement (title, id)
- [ ] Image file type validation (not just extension)
- [ ] File size limits on uploads

---

## Phase 2: Content Features

### 2.4 Games Page Revamp 🎮
**Status:** In Progress — Core Complete  
**Priority:** High  
**Estimated:** 2-3 sessions

Major redesign of games showcase. Core features complete, polish remaining.

#### Completed ✅
- **Hero moved to homepage** with particles/parallax  
- **Multi-game support** — Admin can add/manage multiple games  
- **Multi-platform wishlist** — Steam, Itch, GOG, Epic with smart labels  
- **Demo support** — Try Demo buttons for all platforms  
- **Atmospheric cards** — Glass-morphism, hover effects, animations  
- **Homepage simplification** — Removed featured sections (flow: Hero → Newsletter → Footer)

#### Still To Do
- Screenshot gallery with lightbox
- Gameplay video section
- System requirements panel
- Tabbed interface (Overview/Features/Media/Devlog)
- Development progress bar

---

### 2.5 Homepage Redesign ✅ COMPLETE
**Date:** 2026-07-11

Complete homepage overhaul:
- **Single-page layout** — hero, CTAs, newsletter, footer all visible without scrolling
- **Better typography** — 2.5:1 ratio (title 4rem, body 1.5rem), readable on all screens
- **Bigger CTA buttons** — 1.25rem padding, 1.1rem font, prominent styling
- **Animated character icons** — Saki and Tama idle animations in buttons
- **Inline newsletter** — compact card below CTAs instead of separate section
- **Light/Dark mode** — sun/moon toggle, light default, saves across pages
- **Simplified text** — "Stories and games where characters think for themselves"
- **No "Featured" sections** — removed redundant featured books/games blocks

**New ratios:**
- Title: `clamp(2.5rem, 5vw, 4rem)`
- Body: `clamp(1.25rem, 2.5vw, 1.5rem)`
- Buttons: `1.1rem` with `1.25rem 2.5rem` padding

---

### 2.1 Book Status Workflow
**Priority:** Medium  
**Estimated:** 0.5 sessions

Better book publishing control:

- [ ] Status: `draft` → `preview` → `published` → `archived`
- [ ] Draft books hidden from public API
- [ ] Preview mode (accessible via direct link only)
- [ ] Scheduled publishing (date-based)

---

### 2.2 Series Management Improvements
**Priority:** Medium  
**Estimated:** 1 session

Better series organization:

- [ ] Drag-and-drop book ordering within series
- [ ] Series cover image
- [ ] Series status (complete, ongoing, planned)
- [ ] Word count totals per series
- [ ] Reading order indicators

---

### 2.3 Manuscript Improvements
**Priority:** Medium  
**Estimated:** 1-2 sessions

Better chapter/reader experience:

- [ ] EPUB support (in addition to DOCX)
- [ ] Chapter word counts
- [ ] "Last read" bookmarking
- [ ] Reading progress indicator
- [ ] Export chapter as markdown

---

---

## Phase 3: Technical Improvements

### 3.1 Dark/Light Mode Toggle ✅ COMPLETE
**Date:** 2026-07-11

- Sun/Moon toggle button in navigation
- Light mode as default
- CSS custom properties for theme switching
- Preference persisted in localStorage
- Applies site-wide

---

### 3.2 Image Optimization Pipeline
**Priority:** Medium  
**Estimated:** 1 session

Automatic image processing:

- [ ] Convert uploaded covers to WebP
- [ ] Generate thumbnails (200px, 400px)
- [ ] Lazy loading in book grids
- [ ] Blur-up placeholder effect

**Tools:** `sharp` (npm package) or ImageMagick

---

### 3.2 API Rate Limiting
**Priority:** Medium  
**Estimated:** 1 session

Security hardening:

- [ ] Rate limit on `/login` (5 attempts per IP per 15 min)
- [ ] Rate limit on `/newsletter` (prevent spam)
- [ ] Rate limit on `/content` (generous, prevent abuse)
- [ ] IP-based logging for suspicious activity

---

### 3.3 Automated Backups
**Priority:** Low  
**Estimated:** 0.5 sessions

Data safety:

- [ ] Daily database backup script
- [ ] Keep 7 days of backups
- [ ] Optional: Sync to cloud storage (S3, etc.)
- [ ] Manual backup button in admin

---

### 3.4 Health Check Endpoint
**Priority:** Low  
**Estimated:** 0.5 sessions

Monitoring:

- [ ] `/api/health` returns DB status, disk space
- [ ] Uptime monitoring ready
- [ ] Alert if disk > 90%

---

## Phase 4: Future Ideas

### 4.1 Newsletter System
**Status:** Idea  
Currently just captures emails to JSON.

- [ ] Email templating
- [ ] SendGrid/Mailgun integration
- [ ] Subscriber segmentation (by book interest)
- [ ] Unsubscribe handling

---

### 4.2 Analytics Dashboard
**Status:** Idea

- [ ] Book view counts
- [ ] Popular books ranking
- [ ] Referrer tracking
- [ ] Export reports

**Privacy:** GDPR-compliant, no third-party trackers

---

### 4.3 Multi-User Editing
**Status:** Idea  
**Blocker:** Needs real-time collaboration

- [ ] Lock book while editing
- [ ] Edit history / versioning
- [ ] Revert to previous versions

---

### 4.4 API for External Access
**Status:** Idea

- [ ] Public read-only API (books, series)
- [ ] API keys for authenticated users
- [ ] Webhook support (notify on new book)

---

## Completed Features

| Feature | Date | Notes |
|---------|------|-------|
| Basic CMS (books, game, about) | 2025-05 | Original build |
| User auth system | 2025-05 | bcrypt, sessions |
| Manuscript reader | 2025-05 | DOCX → HTML |
| Admin panel | 2025-05 | Content editing |
| Cover uploads | 2025-05 | Image storage |
| Scraper integration | 2025-05 | Stats tracking |
| Code cleanup / auth extraction | 2026-07-11 | Removed 1,200+ lines |

---

## How to Use This File

**When starting work:**
```bash
# Update status at top of feature
sed -i 's/⬅️ IN PROGRESS/✅ COMPLETE/' PLANNED_FEATURES.md
git commit -am "docs: mark SQLite migration complete"
```

**When adding ideas:**
- Add to appropriate phase
- Set realistic priority
- Leave status as "Idea" if not committed

**When finishing:**
- Move to "Completed Features" table
- Include date and commit hash
