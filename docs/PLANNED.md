# Planned Features — Nekojin Interactive Website

> Roadmap and upcoming features.  
> **Phase 1: COMPLETE** — 2026-07-11

---

## Phase 1: Foundation ✅ COMPLETE

All foundation work completed:
- ✅ SQLite Migration
- ✅ Admin User Management
- ✅ Image Optimization (Sharp)
- ✅ Rate Limiting
- ✅ Session Cleanup
- ✅ Static Asset Whitelist
- ✅ Newsletter Database Migration

---

## Phase 2: Content Features

### 2.1 Games Page Polish 🎮
**Status:** Core Complete, Polish Remaining  
**Priority:** Medium

Remaining work:
- [ ] Screenshot gallery with lightbox
- [ ] Gameplay video section
- [ ] System requirements panel
- [ ] Tabbed interface (Overview/Features/Media/Devlog)
- [ ] Development progress bar

---

### 2.2 Book Status Workflow
**Priority:** Low  
**Estimated:** 0.5 sessions

Better book publishing control:
- [ ] Status: `draft` → `preview` → `published` → `archived`
- [ ] Draft books hidden from public API
- [ ] Preview mode (accessible via direct link only)
- [ ] Scheduled publishing (date-based)

---

### 2.3 Series Management Improvements
**Priority:** Low  
**Estimated:** 1 session

- [ ] Drag-and-drop book ordering within series
- [ ] Series cover image
- [ ] Series status (complete, ongoing, planned)
- [ ] Word count totals per series
- [ ] Reading order indicators

---

### 2.4 Manuscript System — DISABLED ❌
**Status:** Disabled (Option 1)  
**Decision:** Focus on external platform links instead

Manuscript reading/upload hidden. Can re-enable by setting `MANUSCRIPTS_ENABLED = true` in server config.

**Reason:** Drive traffic to Royal Road, ScribbleHub, Kindle where readers already have accounts and engagement metrics help algorithm.

---

### 2.5 Homepage Background Customization ✅ COMPLETE
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

**Bonus:** Three-panel vertical layout redesign

**Use case:** When new flagship books release, update homepage to feature them.

---

### 2.6 Games Page Polish 🎮

## Phase 3: Technical Improvements

### 3.1 Content Validation
**Priority:** Low  
**Estimated:** 0.5 sessions

- [ ] Validate book slugs are URL-safe
- [ ] Check for duplicate slugs on save
- [ ] Required field enforcement (title, id)
- [ ] Image file type validation (not just extension)
- [ ] File size limits on uploads

---

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
