# Nekojin Interactive

> **Stories and games where characters think for themselves.**

[![Website](https://img.shields.io/badge/Website-worldofxanrea.com-8b5cf6?style=flat-square)](https://worldofxanrea.com)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?style=flat-square&logo=sqlite)](https://sqlite.org)

Official website for **Nekojin Interactive** — a solo indie studio building the Xanrea universe. One system, one story at a time.

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm start

# Server runs on http://localhost:7771
```

---

## 📁 Project Structure

```
nekojin-site/
├── dashboard-server.js    # Main HTTP server
├── accounts.js            # Authentication module
├── database.js            # SQLite database wrapper
├── data/                  # Database & runtime data
│   └── nekojin.db         # SQLite database
├── public/                # Static assets & HTML pages
│   ├── index.html         # Homepage
│   ├── books.html         # Book listings
│   ├── book.html          # Individual book pages
│   ├── games.html         # Games showcase
│   ├── about.html         # About page
│   └── style.css          # Shared styles
├── TASKS.md               # Roadmap, issues, changelog (all-in-one)
└── scraper/               # Stats scraper (optional)
```

---

## ✨ Features

### 🎨 **Homepage**
- Animated hero with Saki & Tama characters
- Light/Dark mode toggle
- Single-page layout (no scroll needed)
- Inline newsletter signup

### 📚 **Books**
- Multi-platform links (Royal Road, ScribbleHub, Kindle)
- Book cards with covers, blurbs, platform buttons
- Series organization
- Admin-managed visibility

### 🎮 **Games**
- Multi-game support
- Platform links (Steam, Itch.io, GOG, Epic)
- "Wishlist" / "Get" / "Try Demo" smart buttons
- Admin management panel

### 🔒 **Security**
- bcrypt password hashing, no hardcoded credentials (env-configurable bootstrap admin)
- Session-based authentication with CSRF (double-submit cookie) protection on all state-changing requests
- Rate limiting (login, register, newsletter, API)
- Role-based access (admin/user)
- Static asset whitelist, path-traversal guards on uploads and file serving
- Request body size limits, origin-restricted CORS

### 📊 **Admin Panel**
- Content management (books, games, about)
- User management (create, delete, reset passwords)
- Image uploads with WebP optimization
- Newsletter subscriber management

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js (no framework) |
| **Database** | SQLite3 |
| **Auth** | bcrypt, custom sessions |
| **Images** | Sharp (WebP, thumbnails) |
| **Frontend** | Vanilla HTML/CSS/JS |
| **CSS** | Custom properties, no framework |

---

## 📝 Documentation

| Document | Description |
|----------|-------------|
| [TASKS.md](./TASKS.md) | Roadmap, known issues, layout reference & changelog — all in one file |

---

## 🚀 Deployment (Raspberry Pi)

```bash
# Pull latest
git pull origin main

# Install dependencies
npm install

# Restart server
pm2 restart nekojin-site
```

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `7771` | HTTP port |
| `ADMIN_BOOTSTRAP_USER` | `admin` | Username created on a fresh install (empty `users.json`) |
| `ADMIN_BOOTSTRAP_PASSWORD` | *(random, printed once)* | Password for that first admin account. Set this explicitly for a controlled deploy, or read the generated password from the server's stdout on first boot and change it via the admin panel. |
| `ALLOW_PUBLIC_REGISTRATION` | `false` | Set `true` to re-enable the public `/register` page. Off by default — this is a single-author site, not a multi-tenant app. |
| `TRUST_PROXY` | `false` | Set `true` only if the server sits behind a reverse proxy (nginx, etc.) that sets `X-Forwarded-For`/`X-Real-IP`. Otherwise those headers are client-controlled and must not be trusted for rate limiting. |
| `ALLOWED_ORIGINS` | `https://worldofxanrea.com` | Comma-separated list of origins allowed to make credentialed cross-origin requests. Same-origin browser requests (the normal case) don't need this at all. |
| `NEWSLETTER_PROVIDER` | `none` | External provider to use: `none` (default), `buttondown`, `mailerlite`, `convertkit`, or `generic_webhook`. |
| `BUTTONDOWN_API_KEY` | `null` | API key for Buttondown. |
| `MAILERLITE_API_KEY` | `null` | API key for MailerLite. |
| `CONVERTKIT_API_KEY` | `null` | API key for ConvertKit. |
| `CONVERTKIT_FORM_ID` | `null` | Form ID for ConvertKit subscriptions. |
| `NEWSLETTER_WEBHOOK_URL` | `null` | URL for `generic_webhook` provider (e.g., Zapier/Make/n8n). |

**Important:** there are no hardcoded credentials in the codebase anymore. If your existing `users.json` still has the old default `xanmal` / `nekojin2026` account, log in and change that password immediately — it was previously committed in source.

---

## 🧪 Development

> The one-time `migrate-to-sqlite.js` / `migrate-newsletter.js` scripts have been removed —
> the site has run entirely on SQLite (`data/nekojin.db`) since the July 2026 migration.
> They're still in git history if a fresh JSON→SQLite migration is ever needed again.

### Testing

```bash
# Run the smoke test suite (boots a throwaway copy of the server on a
# separate port and exercises health, auth, CSRF, and content save/load)
npm test

# Manual check in browser
npm start
open http://localhost:7771
```

---

## 📄 License

ISC — Solo creator project.

---

<p align="center">
  <sub>Built with 🐱 and 🍂 by Nekojin Interactive</sub>
</p>
