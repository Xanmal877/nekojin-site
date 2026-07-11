# Known Issues — Nekojin Interactive Website

> Last updated: 2026-07-11

---

## ✅ Recently Fixed (Last Session)

| Issue | Date | Commit |
|-------|------|--------|
| Image optimization (WebP, thumbnails) | 2026-07-11 | `feat: image optimization with sharp` |
| Database path hardcoded | 2026-07-11 | `fix: move database from ~/Documents to local data/` |
| Saki icon orientation | 2026-07-11 | `fix: use saki_idle_down.png` |
| API rate limiting | 2026-07-11 | `feat: add rate limiting to protect endpoints` |
| Admin user management | 2026-07-11 | `feat: admin user management panel` |
| Homepage redesign | 2026-07-11 | Multiple commits |

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
