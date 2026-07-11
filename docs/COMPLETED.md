# Completed Features — Nekojin Interactive Website

> A running log of everything we've built, fixed, and improved.
> 
> **Last Updated:** 2026-07-11 (Phase 1 Complete + Polish)

---

### Newsletter Database ✅
**What:** Moved newsletter subscribers from JSON to SQLite
- `subscribers` table with email, source, subscribed_at, active status
- Duplicate email handling (ON CONFLICT)
- Query capabilities (filter by source, active status)

**Before:** `newsletter-subscribers.json` file (corruption risk)  
**After:** ACID-compliant database table

---

### Content Backup System ✅
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

### System Theme Detection ✅
**What:** Respect user's OS dark/light mode preference
- Detection priority: localStorage → system preference → default light
- Applied before first render (no flash of wrong theme)
- Works with existing toggle (toggle overrides system)

**Before:** Light default, no system detection  
**After:** System-aware, user-overridable

---

### SEO Meta Tags ✅
**What:** Improved Open Graph and meta tags for all pages
- Compelling descriptions matching actual content
- Keywords: indie games, fantasy, progression fiction, litrpg, etc.
- Proper OG images (book covers for books, game for games)
- Dynamic meta updates on book.html when book loads

**Before:** Generic descriptions, game cover used everywhere  
**After:** Tailored per-page, proper keywords, relevant images

---

## 🏗️ Infrastructure

### Database Migration ✅
**What:** Migrated from JSON files to SQLite
- Single-file database (`data/nekojin.db`)
- Class-based database wrapper (Godot-style)
- Transaction safety on saves
- Query capabilities for search/filter

**Impact:** Data integrity, faster queries, ACID compliance

---

### Code Cleanup ✅
**What:** Removed deprecated AI chat system
- Deleted 1,200+ lines of unused code
- Extracted auth module (`accounts.js`)
- Removed WebSocket dependencies
- Cleaned service worker references

**Impact:** Smaller codebase, easier maintenance

**Before:** `dashboard-server.js` ~1,735 lines  
**After:** ~562 lines (-68%)

---

### Session Cleanup ✅
**What:** Automatic cleanup of expired sessions
- Runs every hour via `setInterval`
- Also cleans on load if expired sessions found
- Logs number of removed sessions

**Before:** `sessions.json` grew forever, never cleaned
**After:** File stays lean, only active sessions stored

---

### Static Asset Whitelist ✅
**What:** Security hardening for static file serving
- Whitelist allowed file extensions
- Whitelist allowed directories (/covers/, /assets/, /images/, /fonts/)
- Block path traversal attacks (../etc/passwd)
- Return 403 Forbidden for invalid paths

**Before:** Any .html/.js/.css served from public/  
**After:** Only whitelisted extensions and safe paths

---

### Single-Page Layout ✅
**What:** Complete homepage overhaul
- Removed "Featured" sections (pointless with 4 books, 1 game)
- Everything visible without scrolling
- Hero → Newsletter → Footer flow

**Before:** Hero → Featured Books → Featured Games → Newsletter → Footer  
**After:** Hero + Newsletter inline → Footer

---

### Typography ✅
**What:** Fixed font sizing ratio
- Title: `clamp(2.5rem, 5vw, 4rem)`
- Body: `clamp(1.25rem, 2.5vw, 1.5rem)`
- Ratio: 2.5:1 (readable on all screens)

**Before:** Title was 7.5rem max (way too big), body was tiny  
**After:** Balanced, professional sizing

---

### Character CTA Buttons ✅
**What:** Animated Saki and Tama icons in buttons
- Saki faces down (new sprite: `saki_idle_down.png`)
- Tama faces down (existing sprite)
- 48px animated sprites
- Both buttons purple gradient

**Before:** Static emoji icons (📖 🎮)  
**After:** Living characters that blink and move

---

### Theme System ✅
**What:** Light/Dark mode toggle
- Sun/Moon icon in navigation
- Light mode default
- CSS custom properties switch
- Preference saved to localStorage
- Persists across all pages

**Before:** Dark only, hardcoded colors  
**After:** User choice, smooth transitions

---

### Navigation Restructure ✅
**What:** Better nav layout
- Logo + nav links on left
- Theme toggle + search on right
- Bigger, boxed navigation tabs
- Hover lift effects

---

## 👤 User Management

### Admin User Panel ✅
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

### Authentication System ✅
**What:** Secure auth extracted to module
- bcrypt password hashing
- Session management with TTL
- Role-based access (admin/user)
- Cookie-based sessions

---

## 🎮 Games Features

### Multi-Game Support ✅
**What:** Admin can manage multiple games
- Games list view
- Add/edit/delete games
- Platform links (Steam, Itch, GOG, Epic)
- Demo support (Try Demo buttons)
- Smart labels (Wishlist → Get → Try Demo)

**Before:** Single hardcoded game  
**After:** Scalable game portfolio

---

## 🛡️ Security

### Rate Limiting ✅
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

### Path Security ✅
**What:** Moved database to local directory
- Was: `~/Documents/nekojin-data/`
- Now: `./data/nekojin.db`
- Gitignored `data/` directory

**Impact:** Portable, Pi-deployment ready, no hardcoded paths

---

## 🖼️ Media Handling

### Image Optimization ✅
**What:** Automatic image processing with Sharp
- Convert uploads to WebP
- Resize large images (max 1200px)
- Generate 400px thumbnails
- Quality: 85% full, 80% thumbnail

**Before:** Raw uploads, multi-MB files  
**After:** ~90% size reduction, faster loading

---

## 📊 Stats

| Metric | Before | After |
|--------|--------|-------|
| Server lines | 1,735 | ~650 |
| Homepage sections | 5 | 3 |
| Database | JSON files | SQLite |
| User management | Manual JSON | Admin UI |
| Theme | Dark only | Light/Dark toggle |
| Rate limiting | None | 5 endpoints protected |
| Image optimization | None | WebP + thumbnails |

---

## 🎯 What's Left (Known Issues)

1. **Manuscript Upload Validation** — No file type/size checks
2. **Static Asset Serving** — Serves any file from public/
3. **Content Backups** — No automatic DB backups
4. **Session Cleanup** — Expired sessions pile up in file
5. **Image Optimization** — Legacy images not converted

---

## 🚀 Deployment Status

**Current Branch:** `dev`  
**Commits:** Squashed to logical groups  
**Ready for:** Pi deployment testing  
**Merge to main:** When you're satisfied

---

## 💡 Next Ideas

- **EJS Templates** — Server-side rendering for logged-in states
- **Screenshot Gallery** — Lightbox for game images
- **Reading Progress** — Track user's last read chapter
- **Gumroad Integration** — Sell books/games directly
- **Analytics Dashboard** — View counts, popular books

---

*This file should be updated whenever we complete something significant.*
