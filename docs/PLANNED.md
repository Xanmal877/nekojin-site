# Planned Features — Nekojin Interactive Website

> Roadmap and upcoming features.  
> **Phase 1: COMPLETE** — 2026-07-11  
> **Phase 2: IN PROGRESS** — 2026-07-11

---

## Phase 2: Content Features (Current)

### 2.1 Character Pages
**Status:** In Progress  
**Priority:** High

Create dedicated HTML pages for remaining characters:
- [ ] Moderator Chaos
- [ ] Moderator Order
- [ ] Moderator Space
- [ ] Moderator Devotion
- [ ] Tama (incarnation)
- [ ] Saki (incarnation)
- [ ] Acros (incarnation)
- [ ] Sarah (character)

**Template:** Follow `admin-creation.html` style

---

### 2.2 Worlds Content
**Status:** Not Started  
**Priority:** Medium

Populate `/xanrean/lore/world` with actual content:
- [ ] Server Clusters explanation
- [ ] Xanrea (A0) details
- [ ] Magic systems
- [ ] Worldbuilding docs

---

### 2.3 Games Page Polish 🎮
**Status:** Core Complete, Polish Remaining  
**Priority:** Medium

Remaining work:
- [ ] Screenshot gallery with lightbox
- [ ] Gameplay video section
- [ ] System requirements panel
- [ ] Tabbed interface (Overview/Features/Media/Devlog)
- [ ] Development progress bar

---

### 2.4 Book Status Workflow
**Priority:** Low  
**Estimated:** 0.5 sessions

Better book publishing control:
- [ ] Status: `draft` → `preview` → `published` → `archived`
- [ ] Draft books hidden from public API
- [ ] Preview mode (accessible via direct link only)
- [ ] Scheduled publishing (date-based)

---

### 2.5 Series Management Improvements
**Priority:** Low  
**Estimated:** 1 session

- [ ] Drag-and-drop book ordering within series
- [ ] Series cover image
- [ ] Series status (complete, ongoing, planned)
- [ ] Word count totals per series
- [ ] Reading order indicators

---

### 2.6 Manuscript System — DISABLED ❌
**Status:** Disabled (Option 1)  
**Decision:** Focus on external platform links instead

Manuscript reading/upload hidden. Can re-enable by setting `MANUSCRIPTS_ENABLED = true` in server config.

**Reason:** Drive traffic to Royal Road, ScribbleHub, Kindle where readers already have accounts and engagement metrics help algorithm.

---

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

### 3.2 Legacy File Cleanup
**Priority:** Low  
**Estimated:** 0.1 sessions

Remove legacy files:
- [ ] `data/site-content.json` (after confirming DB migration)
- [ ] `data/site-content.json.backup`

---

### 3.3 Health Check Endpoint
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

## Completed Features (Moved to COMPLETED.md)

See `COMPLETED.md` for full list of finished work.

---

## How to Use This File

**When starting work:**
```bash
# Update status at top of feature
sed -i 's/⬅️ IN PROGRESS/✅ COMPLETE/' PLANNED.md
git commit -am "docs: mark feature complete"
```

**When adding ideas:**
- Add to appropriate phase
- Set realistic priority
- Leave status as "Idea" if not committed

**When finishing:**
- Move details to `COMPLETED.md`
- Update date
