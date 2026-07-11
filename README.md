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
├── docs/                  # Documentation
│   ├── COMPLETED.md       # What's been built
│   ├── PLANNED.md         # Roadmap
│   └── ISSUES.md          # Known issues
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
- bcrypt password hashing
- Session-based authentication
- Rate limiting (login, register, newsletter, API)
- Role-based access (admin/user)
- Static asset whitelist

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
| [docs/COMPLETED.md](./docs/COMPLETED.md) | Everything we've built |
| [docs/PLANNED.md](./docs/PLANNED.md) | Roadmap & future ideas |
| [docs/ISSUES.md](./docs/ISSUES.md) | Known bugs & limitations |

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

---

## 🧪 Development

### Database Migrations

```bash
# Migrate from JSON to SQLite (one-time)
node migrate-to-sqlite.js

# Migrate newsletter subscribers
node migrate-newsletter.js
```

### Testing

```bash
# Check server starts
npm start

# Test in browser
open http://localhost:7771
```

---

## 📄 License

ISC — Solo creator project.

---

<p align="center">
  <sub>Built with 🐱 and 🍂 by Nekojin Interactive</sub>
</p>
