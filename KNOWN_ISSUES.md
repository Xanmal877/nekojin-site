# Known Issues — Nekojin Interactive Website

> Last updated: 2026-07-11

## Critical

*None currently.*

---



## High Priority

### 1. ✅ Data Storage Migration COMPLETE
**Status:** In Progress  
**Impact:** Website still uses JSON files instead of SQLite

- `site-content.json` is read/written directly by server
- No transaction safety on content saves
- No query capabilities (can't search books, filter by status, etc.)
- `database.js` exists but is not integrated into `dashboard-server.js`

**Plan:** 
1. Create migration script to move JSON → SQLite
2. Update `/content` endpoint to query database
3. Update `/save-content` endpoint to use transactions
4. Test with existing data

---

## Medium Priority

### 2. ✅ Navigation Search Bar UX Issues — FIXED
**Status:** Fixed 2026-07-11  
**Commit:** `8007570`

- Search bar width: 160px → 220px (280px on focus)
- Placeholder: "Search books…" → "Search…"
- Better padding for click target
- Empty state: "No results" instead of "No books found"

---

### 3. No Account Management in Admin Panel
**Status:** Open  
**Impact:** Admin must use `/register` page directly to create accounts

- Admin panel has no user list view
- No way to reset passwords from admin
- No way to view/delete user accounts
- No role management UI

**Workaround:** Use `/register` public page, or manually edit `users.json`

---

### 4. Manuscript Upload Has No Validation
**Status:** Open  
**Impact:** Could upload non-docx files, corrupt data

- `/upload-manuscript` checks extension but not file content
- No file size limits
- No virus/malware scanning
- Uploaded files persist forever (no cleanup)

---

### 5. Static Asset Serving Is Broad
**Status:** Open  
**Impact:** Security consideration

- Server serves any `.html`, `.js`, `.css` from `public/` without whitelist
- Could accidentally expose files

---

## Low Priority / Nice to Have

### 6. No Content Backup System
**Status:** Open  
**Impact:** Data loss risk

- No automatic backups of `site-content.json` or database
- No export functionality in admin
- No versioning of content changes

---

### 7. Session Files Grow Unbounded
**Status:** Open  
**Impact:** Minor disk usage

- `sessions.json` stores all sessions forever
- Expired sessions are not cleaned up from file
- In-memory map is cleaned, but file grows

---

### 8. Image Uploads Have No Optimization
**Status:** Open  
**Impact:** Performance

- Cover images saved as-is (could be multi-MB)
- No thumbnail generation
- No WebP conversion
- Browsers download full-size images

---

### 9. No API Rate Limiting
**Status:** Open  
**Impact:** Security/performance

- `/content` could be hammered
- `/newsletter` could be spammed
- No protection against brute force on `/login`

---

## Recently Fixed

| Issue | Date Fixed | Commit |
|-------|------------|--------|
| Navigation search bar too small, wrong placeholder | 2026-07-11 | `fix: improve search bar UX` |
| AI chat code bloated server | 2026-07-11 | `refactor: extract accounts module, remove AI chat` |
| Unused WebSocket dependency | 2026-07-11 | (same) |
| Chat references in service worker | 2026-07-11 | (same) |
| `aichat.html` in robots.txt | 2026-07-11 | (same) |

---

## How to Add New Issues

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


The search bar in the top right in too small and it says search books instead.
