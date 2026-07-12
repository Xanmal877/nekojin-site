# Known Issues — Nekojin Interactive Website

> Last updated: 2026-07-11

---

## ✅ Recently Fixed (Last Session)

| Issue | Date | Commit |
|-------|------|--------|
| **Service Worker Caching Issues** | 2026-07-11 | `fix: completely remove service worker` |
| **Homepage Settings Save Not Working** | 2026-07-11 | `CRITICAL FIX: GET handler method check` |
| Homepage Background Customization | 2026-07-11 | `feat: complete homepage redesign` |
| Image optimization (WebP, thumbnails) | 2026-07-11 | `feat: image optimization with sharp` |
| Database path hardcoded | 2026-07-11 | `fix: move database from ~/Documents to local data/` |
| Saki icon orientation | 2026-07-11 | `fix: use saki_idle_down.png` |
| API rate limiting | 2026-07-11 | `feat: add rate limiting to protect endpoints` |
| Admin user management | 2026-07-11 | `feat: admin user management panel` |
| Homepage redesign | 2026-07-11 | Multiple commits |

---

## 📋 Fixed Issue Details

### Critical Bug: Homepage Settings Not Saving
**Status:** ✅ Fixed 2026-07-11  
**Root Cause:** The GET handler for `/api/homepage` didn't check HTTP method, so it was catching POST requests and returning cached data instead of updating the database.

**Fix:** Added `req.method === 'GET' &&` check to the GET handler at line 578 of dashboard-server.js.

```javascript
// Before (broken):
if (url === '/api/homepage') {

// After (fixed):
if (req.method === 'GET' && url === '/api/homepage') {
```

**Impact:** Admin could upload homepage background images but clicking "Save" would not persist changes to database.

---

## 🔴 Open Issues (1 Remaining)

### Low Priority

#### 1. Manuscript System — DISABLED (Option 1)
**Status:** Disabled 2026-07-11  
**Impact:** None (system hidden)

- Manuscript reading/upload disabled
- Can re-enable by setting `MANUSCRIPTS_ENABLED = true`
- Focusing on external platform links instead

---

## ✅ Fixed Issues (Recently)

| Issue | Date | Status |
|-------|------|--------|
| Service Worker Caching | 2026-07-11 | ✅ Removed - was intercepting API calls |
| Homepage Settings Save | 2026-07-11 | ✅ Fixed - GET handler was catching POST |
| Content Backup System | 2026-07-11 | ✅ Complete - auto backups daily, keeps 7 days |
| Data Storage Migration | 2026-07-11 | ✅ Complete |
| Static Asset Serving | 2026-07-11 | ✅ Fixed |
| Session Cleanup | 2026-07-11 | ✅ Fixed |
| Newsletter Database | 2026-07-11 | ✅ Migrated to SQLite |

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
