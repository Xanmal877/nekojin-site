# Completed Features — Nekojin Interactive Website

> A running log of everything we've built, fixed, and improved.
> 
> **Last Updated:** 2026-07-11 (Late Night Session)

---

## 🎉 Today's Major Progress (2026-07-11)

### Character System Restructure
**What:** Complete reorganization of Admins and Moderators
- Admins moved to `/characters/admins/` folder
- Moderators moved to `/characters/moderators/` folder
- Dedicated pages: Admin Creation, Admin Destruction, Moderator Time
- Template-based pages for remaining characters
- All server routes updated

**Before:** Flat structure, all in `/characters/`
**After:** Organized by tier (Admins/Moderators)

### Lore System Architecture
**What:** Complete lore section rebuild
- **Lore Hub:** `/xanrean/lore/` - VBox layout matching main hub
- **Characters:** `/xanrean/lore/characters` - Moved from root
- **Species:** `/xanrean/lore/species` - 4-panel layout (Nekojin, Foxkin, Elves, Travelers)
- **Worlds:** `/xanrean/lore/world` - Placeholder for worldbuilding content

**Layout Pattern:** VBox (Header → Cards → Footer, zero gaps)

### Xanrean Hub Polish
**What:** Final visual refinements
- Cards now have slight rounding (8px border-radius)
- Small gap between cards (0.5rem)
- Content positioned at 3vh from top
- Perfect VBox layout with floating footer

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

### Layout Patterns Documented ✅
**What:** Created `docs/layout-patterns.md`
- VBox Layout pattern (fullscreen panels)
- Split Panels pattern (2-column)
- Grid Panels pattern (2x2)
- Documented for future use

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

### Homepage Background Customization ✅
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

### Service Worker Removal ✅
**What:** Completely removed problematic service worker
- Was intercepting API calls and returning cached responses
- Caused POST /api/homepage to return cached GET response (old data)
- Admin changes appeared to save but didn't persist

**Before:** Service worker cached API responses incorrectly  
**After:** All requests go directly to server, no caching interference

---

### Book Cover Display Fix ✅
**What:** Changed book cover display from `cover` to `contain`
- Full cover images visible without cropping
- Better for portrait-oriented book covers on homepage panels

**Before:** `background-size: cover` (cropped edges, didn't show full image)  
**After:** `background-size: contain` (full image visible, no cropping)

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
| Character structure | Flat | Hierarchical (Admins/Moderators) |
| Lore section | None | Complete (Characters/Species/Worlds) |

---

## 🎯 What's Left (Known Issues)

1. **Manuscript Upload Validation** — No file type/size checks
2. **Legacy JSON Files** — `site-content.json` and `.backup` in data/ can be removed
3. **Moderator Pages** — Most still use template, need dedicated pages

---

## 🚀 Deployment Status

**Current Branch:** `dev`  
**Commits:** 20+ commits ahead of origin  
**Ready for:** Pi deployment testing  
**Merge to main:** When you're satisfied

---

## 💡 Next Ideas

- **EJS Templates** — Server-side rendering for logged-in states
- **Screenshot Gallery** — Lightbox for game images
- **Reading Progress** — Track user's last read chapter
- **Gumroad Integration** — Sell books/games directly
- **Analytics Dashboard** — View counts, popular books
- **More Moderator Pages** — Dedicated pages for remaining moderators
- **Worlds Content** — Populate worldbuilding section

---

*This file should be updated whenever we complete something significant.*
