# Nekojin Interactive — Project Context

> This file lives inside the repo. Read it first when working on this project.

## Quick Facts

| | |
|---|---|
| **Live repo** | `/home/xanmal/nekojin-site/` (canonical) |
| **Remote** | `ssh://xanmal@127.0.0.1:22/PurpleXanmal/nekojin-interactive-website.git` |
| **SSH key** | `~/.ssh/id_ed25519_nekojin` |
| **Server** | `dashboard-server.js` on port `7771` |
| **Domain** | `https://worldofxanrea.com` |
| **Studio** | Nekojin Interactive LLC (founded May 25, 2025, Arizona, ID: 23831348) |
| **Author** | Purple Xanmal |
| **Email** | PurpleTamaneko@gmail.com |

## File Structure

```
/home/xanmal/nekojin-site/
├── dashboard-server.js         # Main server (proxy, auth, CMS API)
├── admin.html                  # Admin panel (books, series, game, about, settings)
├── dashboard.html              # Old dashboard (not actively used)
├── site-content.json           # CMS data (books, game, about, series, platforms)
├── story-metrics.json          # Scraper metrics
├── newsletter-subscribers.json # Public email capture ONLY (no mail infra)
├── BookStatScraper.js          # Scraper logic
├── generate-meta.js            # Regenerates sitemap/rss/robots on demand
├── package.json                # deps: puppeteer, ws, bcryptjs, uuid
├── .gitignore                  # excludes node_modules, chrome-profile, etc.
├── KNOWN_ISSUES.md             # Documented bugs and next steps
└── public/
    ├── index.html              # Homepage (hero + featured books + newsletter capture)
    ├── books.html              # Book listing grid → /book?id=xxx
    ├── book.html               # Detail page (dynamic OG, related books)
    ├── games.html              # Game showcase + devlog
    ├── about.html              # Studio page (sprites, timeline, universe blurb)
    ├── aichat.html             # Multi-provider AI chat
    ├── read.html               # Chapter reader (docx → HTML, 3-chapter preview)
    ├── action_registry.html    # Off main nav, scraper reference
    ├── style.css               # Shared styles
    ├── chat.js                 # pi Chat Widget (injected on all pages)
    ├── chat-client.js          # Multi-provider chat engine
    ├── chat-providers.js       # Provider definitions + pricing labels
    ├── sw.js                   # Service Worker
    ├── manifest.json           # PWA manifest
    ├── sitemap.xml, rss.xml, robots.txt
    ├── covers/                 # Book/game cover images
    ├── images/                 # Sprite strips + icons
    │   ├── tama-idle.png      # 8-frame front idle strip
    │   ├── tama-blink.png     # 2-frame corner blink
    │   ├── saki-idle.png      # 8-frame front idle strip
    │   ├── saki-blink.png     # 2-frame corner blink
    │   └── tama-icon.png, saki-icon.png  # 48×48 static
    └── sprites/                # ORIGINAL SHEETS (DO NOT DELETE)
        ├── tama-sheet.png      # 528×288, 48×48 frames
        └── saki-sheet.png      # 432×720, 48×48 frames
```

## Public Pages

| Page | Purpose |
|------|---------|
| `/index.html` | Hero, featured books, "What is Xanrea?" blurb, newsletter capture |
| `/books.html` | Grid of all books, cards link to `/book?id=xxx` |
| `/book?id=xxx` | Full description, tags, platform CTAs, related books grid, 3-chapter preview |
| `/games.html` | Game showcase, devlog, media |
| `/about.html` | Tama/Saki sprite animations, studio timeline, universe card, Find Us grid |
| `/aichat.html` | Multi-provider AI chat (Claude, GPT, Grok, Ollama, pi Agent) |
| `/read.html?book=slug` | Serif chapter reader, docx→HTML, full book for logged-in users |
| `/action_registry.html` | Scraper status (off main nav) |

## CMS Data (`site-content.json`)

**Books array:** Each book has `id`, `title`, `slug`, `description`, `status`, `genres[]`, `tags[]`, `platforms[]`, `cover`, `links[]`, `seriesId`, `wordCount`, `blurb` (added recently).

**Game object:** Title, description, status, cover, screenshots, devlog entries.

**About object:** Studio name, founded date, description, social links (RoyalRoad, ScribbleHub, KDP, Patreon, Discord, etc.).

**Series array:** Linked books, universe info.

## AI Chat Architecture

**Providers:** pi Agent (WebSocket), Claude, OpenAI/GPT, xAI/Grok, Ollama

**Key files:**
- `chat-providers.js` — model definitions, pricing labels, localStorage key mgmt, markdown formatter
- `chat-client.js` — IndexedDB sessions, model picker with **favorites system** (★ star buttons), streaming, stop button, settings panel
- `aichat.html` — UI shell
- `dashboard-server.js` — `/api/proxy/chat` endpoint, forwards to Anthropic/OpenAI/xAI/Ollama

**Ollama:** Direct browser fetch to `192.168.1.23:11434` (not proxied)

## Sprite Animation Specs

| Asset | Sheet | Size | Frames | Notes |
|-------|-------|------|--------|-------|
| Tama idle | `tama-sheet.png` | 48×48 | 8 | Row 2 (y=96), front-facing |
| Saki idle | `saki-sheet.png` | 48×48 | 8 | Row 0 (y=0), front-facing |
| Tama blink | `tama-blink.png` | 48×48 | 2 | Corner blink |
| Saki blink | `saki-blink.png` | 48×48 | 2 | Corner blink |

CSS: `background-image` + `steps()` + `background-repeat: repeat-x` + `background-position` from `0` to negative `(frames * frame_width)`.

Tama appears in: studio emblem (144×144 breathing), Saki orbits (72×72), universe card corners (48×48 blink), nav logo (30×30), footer logo (28×28).

## Auth & Accounts

- `users.json` — bcrypt hashes, roles: `user` / `admin`
- `user-keys.json` — per-user API key storage
- Default account: `xanmal` / `nekojin2026` (admin)
- `chat-client.js` fetches `/api/keys` on load, POSTs back on settings save
- **NEVER commit** `users.json` or `user-keys.json`

## SEO / PWA

- `generate-meta.js` — run `node generate-meta.js` to regenerate `sitemap.xml`, `rss.xml`, `robots.txt`
- `manifest.json` + `sw.js` — network-first for HTML, cache-first for static assets
- Open Graph + Twitter Card tags on all public pages (dynamic per-book on `/book.html`)
- RSS feed pulls from `site-content.json`

## Style Rules (Project-Specific)

- **NO em dashes** in prose descriptions — periods, commas, or nothing
- **NO newsletter infrastructure** — capture form appends to JSON only
- **NO over-engineering** — content/marketing focus over infra
- Dark purple aesthetic (`#7c28d4`, `#a855f7`, `#8b5cf6`)
- Text opacity bumped from `0.45` to `0.72-0.82` for readability (check before lowering)
- Animations respect `prefers-reduced-motion: reduce`

## Known Issues (Check `KNOWN_ISSUES.md` for full list)

1. **Book card descriptions** — some cards show full prose wall-of-text. The `blurb` field exists but not all books have it populated.
2. **Stop button timing** — during pi agent tool execution, stop may not abort cleanly.
3. **Image uploads** — display-only for external APIs (not forwarded yet).
4. **Ollama model refresh** — doesn't update on provider switch after initial load.
5. **Custom model input** — not wired yet.
6. **No syntax highlighting** — code blocks have copy buttons but no color.

## Recurring Tasks (When Asked)

1. Mobile/responsive polish
2. AI Chat updates — refresh model lists + pricing labels when providers release new models
3. Populate `blurb` field on book CMS entries for cleaner card previews
4. Content/marketing focus (user wants readers, not more infra)
5. Keep provider models current (retired models → replacements)

## History / Recent Sessions

**2026-05-15 — Multi-provider AI Chat v1**
- Built `chat-providers.js`, `chat-client.js`, `/api/proxy/chat` endpoint
- Claude, GPT, Grok, Ollama, pi Agent support
- IndexedDB sessions, stop button, expanded settings
- Per-user bcrypt accounts + server-side API key storage

**2026-05-15 — Chapter Reader**
- mammoth parses .docx → HTML, splits on Heading 1/2/3
- `/read?book=slug` with serif reader, 3-chapter preview, CTA banner
- Manuscript upload inline in book editor

**2026-05-15 — SEO + Discoverability**
- `generate-meta.js`, sitemap, RSS, robots, manifest, service worker
- OG tags on all pages

**2026-05-15 — About Page Rewrite**
- Tama/Saki sprite animations extracted from original sheets
- Studio timeline, universe blurb, Find Us grid, current projects

**2026-05-18 — Model Refresh + Favorites**
- Retired Grok 4/4.1 → replaced with Grok 4.3/4.20 series
- Added Claude Opus 4.7, Sonnet 4.6, Haiku 4.5
- Added OpenAI GPT-5 family, GPT-4.1 series, o3
- Added pricing labels to all models
- Added ★ favorites system to model picker
- Created `AGENTS.md` base + this `PROJECT.md`

## Push Workflow

```bash
# From /home/xanmal/nekojin-site/
GIT_SSH_COMMAND='ssh -i ~/.ssh/id_ed25519_nekojin -o StrictHostKeyChecking=no' git push origin main
```

Or set remote with embedded token for convenience:
```bash
git remote set-url origin https://<TOKEN>@git.worldofxanrea.com/PurpleXanmal/nekojin-interactive-website.git
```

**Gitea CLI (for tokens):**
```bash
cd ~/Documents/Projects/Gitea
./gitea admin user generate-access-token -u PurpleXanmal -t "pi-deploy-$(date +%s)" --raw
```

## Technical Notes

- `dashboard-server.js` was once corrupted during bulk edits — always back up before big refactors.
- Gitea SSH: port 22 on `127.0.0.1`, key `id_ed25519_nekojin`.
- Server auth uses `bcryptjs` (already in `package.json`).
