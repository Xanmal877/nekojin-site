# Known Issues — Nekojin Interactive Website

> Last updated: 2026-07-11

---

## 🔴 Open Issues (4 Found)

### 1. Duplicate Route in Server
**Status:** ✅ Fixed 2026-07-11 (removed duplicate)  
**Impact:** Low

`moderator-chaos` appeared twice in PUBLIC_ROUTES (lines 364 and 368).
JavaScript objects allow duplicate keys, but last one wins.

**Fix:** Removed duplicate entry.

---

### 2. Legacy JSON Files in data/
**Status:** Open  
**Impact:** Low

Two legacy files remain from pre-SQLite migration:
- `data/site-content.json` (16KB)
- `data/site-content.json.backup` (16KB)

These are the old content storage files before database migration. Safe to delete since database is working.

**Action:** Can be removed after confirming database has all data.

---

### 3. Most Moderator Pages Use Template
**Status:** Open  
**Impact:** Medium

Currently have dedicated pages for:
- ✅ Moderator Time
- ✅ Moderator Space

Still using dynamic template (`character.html`) for:
- ❌ Moderator Chaos
- ❌ Moderator Order
- ❌ Moderator Devotion
- ❌ Tama (incarnation)
- ❌ Saki (incarnation)
- ❌ Acros (incarnation)
- ❌ Sarah (character)

**Action:** Create dedicated HTML pages for each as content is finalized.

---

### 4. Worlds Page is Placeholder
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
| **Character folder restructure** | 2026-07-11 | Multiple commits |
| **Lore system architecture** | 2026-07-11 | Complete rebuild |
| **VBox layout** | 2026-07-11 | Header/Cards/Footer |
| **Service Worker Caching Issues** | 2026-07-11 | `fix: completely remove service worker` |
| **Homepage Settings Save Not Working** | 2026-07-11 | `CRITICAL FIX: GET handler method check` |

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
