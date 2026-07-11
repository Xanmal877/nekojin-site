#!/usr/bin/env node
/**
 * Nekojin Interactive - Server
 * - Public site at / (served from ./public/)
 * - Admin panel at /admin (login required)
 * - /content        GET   → site-content.json (public, for dynamic pages)
 * - /save-content   POST  → write site-content.json (auth required)
 * - /upload-cover   POST  → save image to public/covers/ (auth required)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const mammoth = require('mammoth');

// Import modules
const accounts = require('./accounts.js');
const contentDB = require('./database.js');

// ── CONFIG ────────────────────────────────────────────────
const PORT = 7771;
const METRICS_FILE = path.join(__dirname, 'story-metrics.json');
const SCRAPER_FILE = path.join(__dirname, 'scraper', 'BookStatScraper.js');
const ADMIN_FILE = path.join(__dirname, 'admin.html');
const PUBLIC_DIR = path.join(__dirname, 'public');
const COVERS_DIR = path.join(PUBLIC_DIR, 'covers');
const NEWSLETTER_FILE = path.join(__dirname, 'newsletter-subscribers.json');
const CONTENT_FILE = path.join(os.homedir(), 'Documents', 'nekojin-data', 'site-content.json');
const MANUSCRIPTS_DIR = path.join(__dirname, 'manuscripts');

// Ensure directories exist
if (!fs.existsSync(MANUSCRIPTS_DIR)) fs.mkdirSync(MANUSCRIPTS_DIR, { recursive: true });
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });

// Open database connection
contentDB.Open();
console.log('Database connection opened');

let scrapeRunning = false;

// ── MANUSCRIPT PARSING (.docx → chapters) ──────────────────
const MANUSCRIPT_CACHE = new Map();

async function parseManuscript(slug) {
    const filePath = path.join(MANUSCRIPTS_DIR, slug + '.docx');
    if (!fs.existsSync(filePath)) return null;
    const mtime = fs.statSync(filePath).mtimeMs;
    const cached = MANUSCRIPT_CACHE.get(slug);
    if (cached && cached.mtime === mtime) return cached.chapters;

    const result = await mammoth.convertToHtml({ path: filePath }, {
        styleMap: [
            "p[style-name='Heading 1'] => h1",
            "p[style-name='Heading 2'] => h2",
            "p[style-name='Heading 3'] => h3",
            "p[style-name='Title'] => h1.title",
        ]
    });
    const chapters = splitHtmlIntoChapters(result.value);
    MANUSCRIPT_CACHE.set(slug, { mtime, chapters });
    return chapters;
}

function splitHtmlIntoChapters(html) {
    const chapterRegex = /<(h1|h2|h3)[^>]*>(.*?)<\/\1>/gi;
    const chapters = [];
    let lastIndex = 0;
    let match;
    let chapterNum = 0;

    while ((match = chapterRegex.exec(html)) !== null) {
        const headingText = match[2].replace(/<[^>]+>/g, '').trim();
        const textBefore = html.slice(lastIndex, match.index).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        const isFirst = chapters.length === 0;
        const isChapterHeading = /chapter|prologue|epilogue|preface|introduction|part\s+\d+/i.test(headingText);

        if (!isChapterHeading && isFirst && textBefore.length < 200) {
            lastIndex = match.index + match[0].length;
            continue;
        }

        if (chapters.length > 0) {
            chapters[chapters.length - 1].content = html.slice(lastIndex, match.index);
        }
        chapterNum++;
        chapters.push({ num: chapterNum, title: headingText, content: '' });
        lastIndex = match.index + match[0].length;
    }

    if (chapters.length > 0) {
        chapters[chapters.length - 1].content = html.slice(lastIndex);
    }

    if (chapters.length === 0) {
        chapters.push({ num: 1, title: 'Chapter 1', content: html });
    }
    return chapters;
}

function listManuscripts() {
    try {
        return fs.readdirSync(MANUSCRIPTS_DIR)
            .filter(f => f.endsWith('.docx') || f.endsWith('.epub'))
            .map(f => f.replace(/\.(docx|epub)$/i, ''));
    } catch { return []; }
}


// ── BODY PARSING ─────────────────────────────────────────
function readRawBody(req) {
    return new Promise(resolve => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

function parseFormBody(body) {
    const p = {};
    String(body).split('&').forEach(part => {
        const [k, v] = part.split('=');
        if (k) p[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
    });
    return p;
}

// ── MULTIPART (cover uploads) ────────────────────────────
function parseMultipart(buffer, boundary) {
    const results = {};
    const sep = Buffer.from('--' + boundary);
    let start = 0;
    while (start < buffer.length) {
        const idx = buffer.indexOf(sep, start);
        if (idx === -1) break;
        const end = buffer.indexOf(sep, idx + sep.length);
        if (end === -1) break;
        const part = buffer.slice(idx + sep.length + 2, end - 2);
        const hEnd = part.indexOf('\r\n\r\n');
        if (hEnd === -1) continue;
        const headers = part.slice(0, hEnd).toString();
        const body = part.slice(hEnd + 4);
        const nm = headers.match(/name="([^"]+)"/);
        const fm = headers.match(/filename="([^"]+)"/);
        if (!nm) continue;
        results[nm[1]] = fm ? { filename: fm[1], data: body } : body.toString().trim();
        start = end;
    }
    return results;
}

// ── MIME TYPES ───────────────────────────────────────────
const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.webp': 'image/webp',
};

function serveFile(res, filePath) {
    try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
}

// ── LOGIN/REGISTER PAGES ─────────────────────────────────
function loginPage(nextUrl = '/admin', error = '') {
    const safeNext = (nextUrl && nextUrl.startsWith('/')) ? nextUrl : '/admin';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Login - Nekojin Interactive</title>
  <link href="https://fonts.googleapis.com/css2?family=Darumadrop+One&family=Zen+Kaku+Gothic+New:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;background:#0d0820;display:flex;align-items:center;justify-content:center;font-family:'Zen Kaku Gothic New',sans-serif;padding:2rem;position:relative;overflow:hidden}
    body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 80% 60% at 20% 0%,rgba(91,26,154,0.2),transparent 60%),radial-gradient(ellipse 60% 80% at 80% 100%,rgba(22,44,110,0.15),transparent 60%);pointer-events:none}
    .card{background:#140f2e;border:1px solid rgba(124,40,212,0.25);border-radius:24px;padding:2.5rem;width:100%;max-width:400px;box-shadow:0 8px 40px rgba(0,0,0,0.5);position:relative;z-index:1}
    .logo{font-family:'Darumadrop One',cursive;font-size:1.4rem;color:#8B44E8;text-align:center;margin-bottom:0.25rem}
    .sub{text-align:center;font-size:0.78rem;color:#5A4A80;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:2rem}
    label{display:block;font-size:0.78rem;font-weight:700;color:#7C28D4;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.35rem}
    input{width:100%;padding:0.7rem 1rem;border:1.5px solid rgba(124,40,212,0.2);border-radius:10px;font-family:inherit;font-size:0.9rem;color:#d8cef0;background:#1c1640;outline:none;transition:border-color 0.2s;margin-bottom:1.25rem}
    input:focus{border-color:#8B44E8}
    .error{background:rgba(224,80,80,0.1);border:1px solid rgba(224,80,80,0.3);color:#e08080;font-size:0.82rem;padding:0.6rem 0.9rem;border-radius:8px;margin-bottom:1.25rem}
    button{width:100%;padding:0.85rem;background:linear-gradient(135deg,#5B1A9A,#162C6E);color:white;border:none;border-radius:999px;font-family:inherit;font-size:1rem;font-weight:600;cursor:pointer;transition:all 0.2s}
    button:hover{transform:translateY(-2px);box-shadow:0 6px 24px rgba(91,26,154,0.5)}
    .back{display:block;text-align:center;margin-top:1.5rem;font-size:0.82rem;color:#5A4A80;text-decoration:none}
    .back:hover{color:#8B44E8}
    .link-row{display:flex;justify-content:center;gap:1rem;margin-top:1.25rem;font-size:0.82rem}
    .link-row a{color:#d4c8f0;text-decoration:none}
    .link-row a:hover{color:#8B44E8}
    .success{background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.3);color:#86efac;font-size:0.82rem;padding:0.6rem 0.9rem;border-radius:8px;margin-bottom:1.25rem}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Nekojin Interactive</div>
    <div class="sub">✦ Sign In ✦</div>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="POST" action="/login">
      <input type="hidden" name="next" value="${safeNext.replace(/"/g, '&quot;')}">
      <label>Username</label>
      <input type="text" name="username" autocomplete="username" required>
      <label>Password</label>
      <input type="password" name="password" autocomplete="current-password" required>
      <button type="submit">Sign In</button>
    </form>
    <div class="link-row"><a href="/register">Create account</a><a href="/">Back to site</a></div>
  </div>
</body>
</html>`;
}

function registerPage(error = '', success = '') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Create Account - Nekojin Interactive</title>
  <link href="https://fonts.googleapis.com/css2?family=Darumadrop+One&family=Zen+Kaku+Gothic+New:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;background:#0d0820;display:flex;align-items:center;justify-content:center;font-family:'Zen Kaku Gothic New',sans-serif;padding:2rem;position:relative;overflow:hidden}
    body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 80% 60% at 20% 0%,rgba(91,26,154,0.2),transparent 60%),radial-gradient(ellipse 60% 80% at 80% 100%,rgba(22,44,110,0.15),transparent 60%);pointer-events:none}
    .card{background:#140f2e;border:1px solid rgba(124,40,212,0.25);border-radius:24px;padding:2.5rem;width:100%;max-width:400px;box-shadow:0 8px 40px rgba(0,0,0,0.5);position:relative;z-index:1}
    .logo{font-family:'Darumadrop One',cursive;font-size:1.4rem;color:#8B44E8;text-align:center;margin-bottom:0.25rem}
    .sub{text-align:center;font-size:0.78rem;color:#5A4A80;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:2rem}
    label{display:block;font-size:0.78rem;font-weight:700;color:#7C28D4;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.35rem}
    input{width:100%;padding:0.7rem 1rem;border:1.5px solid rgba(124,40,212,0.2);border-radius:10px;font-family:inherit;font-size:0.9rem;color:#d8cef0;background:#1c1640;outline:none;transition:border-color 0.2s;margin-bottom:1.25rem}
    input:focus{border-color:#8B44E8}
    .error{background:rgba(224,80,80,0.1);border:1px solid rgba(224,80,80,0.3);color:#e08080;font-size:0.82rem;padding:0.6rem 0.9rem;border-radius:8px;margin-bottom:1.25rem}
    .success{background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.3);color:#86efac;font-size:0.82rem;padding:0.6rem 0.9rem;border-radius:8px;margin-bottom:1.25rem}
    button{width:100%;padding:0.85rem;background:linear-gradient(135deg,#5B1A9A,#162C6E);color:white;border:none;border-radius:999px;font-family:inherit;font-size:1rem;font-weight:600;cursor:pointer;transition:all 0.2s}
    button:hover{transform:translateY(-2px);box-shadow:0 6px 24px rgba(91,26,154,0.5)}
    .back{display:block;text-align:center;margin-top:1.5rem;font-size:0.82rem;color:#5A4A80;text-decoration:none}
    .back:hover{color:#8B44E8}
    .hint{font-size:0.75rem;color:#5A4A80;margin-bottom:1.25rem}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Nekojin Interactive</div>
    <div class="sub">✦ Create Account ✦</div>
    ${error ? `<div class="error">${error}</div>` : ''}
    ${success ? `<div class="success">${success}</div>` : ''}
    <form method="POST" action="/register" ${success ? 'style="display:none;"' : ''}>
      <label>Username</label>
      <p class="hint">3-32 characters, letters, numbers, underscores only.</p>
      <input type="text" name="username" autocomplete="username" required pattern="[a-z0-9_]{3,32}" title="3-32 lowercase letters, numbers, underscores">
      <label>Password</label>
      <input type="password" name="password" autocomplete="new-password" required minlength="6">
      <label>Confirm Password</label>
      <input type="password" name="confirm" autocomplete="new-password" required minlength="6">
      <button type="submit">Create Account</button>
    </form>
    <a href="/login" class="back">← Back to sign in</a>
  </div>
</body>
</html>`;
}

// ── SSE ───────────────────────────────────────────────────
const sseClients = new Set();
let notifyTimer = null;

function notifyClients() {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
        for (const r of sseClients) r.write('data: update\n\n');
    }, 300);
}

try { fs.watch(METRICS_FILE, notifyClients); } catch {}
let lastMtime = 0;
try { lastMtime = fs.statSync(METRICS_FILE).mtimeMs; } catch {}
setInterval(() => {
    try {
        const mt = fs.statSync(METRICS_FILE).mtimeMs;
        if (mt !== lastMtime) { lastMtime = mt; notifyClients(); }
    } catch {}
}, 10_000);

// ── PUBLIC ROUTES ─────────────────────────────────────────
const PUBLIC_ROUTES = {
    '/': path.join(PUBLIC_DIR, 'index.html'),
    '/books': path.join(PUBLIC_DIR, 'books.html'),
    '/book': path.join(PUBLIC_DIR, 'book.html'),
    '/read': path.join(PUBLIC_DIR, 'read.html'),
    '/games': path.join(PUBLIC_DIR, 'games.html'),
    '/about': path.join(PUBLIC_DIR, 'about.html'),
};

// ── SERVER ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;

    // CORS / preflight
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    // Public HTML pages
    if (req.method === 'GET' && PUBLIC_ROUTES[url])
        return serveFile(res, PUBLIC_ROUTES[url]);

    // Static assets
    if (req.method === 'GET' && (
        url.endsWith('.html') || url.endsWith('.css') || url.endsWith('.js') ||
        url.endsWith('.xml') || url.endsWith('.txt') || url.endsWith('.json') ||
        url.startsWith('/covers/') || url.startsWith('/assets/') ||
        url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg') ||
        url.endsWith('.ico') || url.endsWith('.svg') || url.endsWith('.webp')
    )) return serveFile(res, path.join(PUBLIC_DIR, url));

    // Public content API - now from database
    if (req.method === 'GET' && url === '/content') {
        try {
            const data = await contentDB.GetAllContent();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(data));
        } catch (err) {
            console.error('Database error:', err);
            res.writeHead(500);
            return res.end('{"error":"Failed to load content"}');
        }
    }

    // ── MANUSCRIPT API (public read) ──────────────────────
    const mList = /^\/api\/manuscripts$/;
    const mChapters = /^\/api\/manuscripts\/([^\/]+)\/chapters$/;
    const mChapter = /^\/api\/manuscripts\/([^\/]+)\/chapters\/([0-9]+)$/;

    if (req.method === 'GET' && mList.test(url)) {
        const slugs = listManuscripts();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ manuscripts: slugs }));
    }

    const chaptersMatch = url.match(mChapters);
    if (req.method === 'GET' && chaptersMatch) {
        const slug = chaptersMatch[1];
        const chapters = await parseManuscript(slug);
        if (!chapters) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            slug,
            total: chapters.length,
            preview: chapters.length > 3 ? 3 : chapters.length,
            chapters: chapters.map((c, i) => ({ num: c.num, title: c.title, index: i }))
        }));
    }

    const chapterMatch = url.match(mChapter);
    if (req.method === 'GET' && chapterMatch) {
        const slug = chapterMatch[1];
        const num = parseInt(chapterMatch[2], 10);
        const chapters = await parseManuscript(slug);
        if (!chapters) { res.writeHead(404); return res.end('Not found'); }
        const ch = chapters.find(c => c.num === num);
        if (!ch) { res.writeHead(404); return res.end('Chapter not found'); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            num: ch.num,
            title: ch.title,
            content: ch.content,
            total: chapters.length
        }));
    }

    // ── LOGIN / LOGOUT / REGISTER ─────────────────────────
    if (req.method === 'GET' && url === '/login') {
        if (accounts.isAuthenticated(req)) {
            res.writeHead(302, { Location: '/admin' });
            return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(loginPage(query.get('next') || '/admin'));
    }

    if (req.method === 'POST' && url === '/login') {
        const body = await readRawBody(req);
        const params = parseFormBody(body);
        if (accounts.verifyUser(params.username, params.password)) {
            const sid = accounts.createSession(params.username);
            const next = (params.next && params.next.startsWith('/')) ? params.next : '/admin';
            res.writeHead(302, {
                Location: next,
                'Set-Cookie': `nki_session=${sid}; HttpOnly; SameSite=Strict; Max-Age=${accounts.SESSION_TTL / 1000}; Path=/`,
            });
            return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(loginPage(params.next || '/admin', 'Incorrect username or password.'));
    }

    if (req.method === 'GET' && url === '/register') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(registerPage());
    }

    if (req.method === 'POST' && url === '/register') {
        const body = await readRawBody(req);
        const params = parseFormBody(body);
        const username = (params.username || '').trim().toLowerCase();
        const password = params.password || '';
        const confirm = params.confirm || '';
        if (!/^[a-z0-9_]{3,32}$/.test(username)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(registerPage('Username must be 3-32 characters: letters, numbers, underscores.'));
        }
        if (password.length < 6) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(registerPage('Password must be at least 6 characters.'));
        }
        if (password !== confirm) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(registerPage('Passwords do not match.'));
        }
        if (!accounts.createUser(username, password)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(registerPage('Username already taken.'));
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(registerPage('', 'Account created. You can now log in.'));
    }

    if (req.method === 'GET' && url === '/logout') {
        const sid = accounts.getSessionId(req);
        if (sid) accounts.deleteSession(sid);
        res.writeHead(302, { Location: '/login', 'Set-Cookie': 'nki_session=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/' });
        return res.end();
    }

    // ── PUBLIC NEWSLETTER ─────────────────────────────────
    if (req.method === 'POST' && url === '/newsletter') {
        try {
            const body = await readRawBody(req);
            const { email } = JSON.parse(body.toString());
            if (!email || !email.includes('@')) { res.writeHead(400); return res.end('Invalid email'); }
            let subs = [];
            try { subs = JSON.parse(fs.readFileSync(NEWSLETTER_FILE, 'utf8')); } catch { }
            if (!subs.find(s => s.email === email)) {
                subs.push({ email, subscribedAt: Date.now() });
                fs.writeFileSync(NEWSLETTER_FILE, JSON.stringify(subs, null, 2));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end('{"ok":true}');
        } catch (e) { res.writeHead(500); return res.end(e.message); }
    }

    // ── AUTH GATE ─────────────────────────────────────────
    if (!accounts.isAuthenticated(req)) {
        if (req.method === 'GET') {
            res.writeHead(302, { Location: '/login?next=' + encodeURIComponent(req.url) });
            return res.end();
        }
        res.writeHead(401);
        return res.end('Unauthorized');
    }

    // ── AUTHENTICATED ROUTES ──────────────────────────────
    const username = accounts.getUsername(req);

    // API Keys (read / write) - kept for potential future use
    if (url === '/api/keys') {
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(accounts.getUserKeys(username)));
        }
        if (req.method === 'POST') {
            try {
                const body = await readRawBody(req);
                const data = JSON.parse(body.toString('utf8'));
                for (const [provider, key] of Object.entries(data)) {
                    accounts.setUserKey(username, provider, key || '');
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end('{"ok":true}');
            } catch (e) { res.writeHead(400); return res.end(e.message); }
        }
    }

    // Admin page (admin only)
    if (req.method === 'GET' && (url === '/admin' || url === '/dashboard')) {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        return serveFile(res, ADMIN_FILE);
    }

    // Save site content (admin only) - now to database
    if (req.method === 'POST' && url === '/save-content') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req);
            const data = JSON.parse(body.toString());
            await contentDB.SaveAllContent(data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end('{"ok":true}');
        } catch (e) {
            console.error('Save content error:', e);
            res.writeHead(500);
            return res.end(JSON.stringify({ error: e.message }));
        }
    }

    // Cover image upload (admin only)
    if (req.method === 'POST' && url === '/upload-cover') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req);
            const ct = req.headers['content-type'] || '';
            const bm = ct.match(/boundary=([^\s;]+)/);
            if (!bm) { res.writeHead(400); return res.end('No boundary'); }
            const parts = parseMultipart(body, bm[1]);
            const file = parts['cover'];
            if (!file || !file.data) { res.writeHead(400); return res.end('No file'); }
            const bookId = parts['bookId'] || 'cover';
            const ext = path.extname(file.filename).toLowerCase() || '.jpg';
            const fname = `${bookId}-${Date.now()}${ext}`;
            fs.writeFileSync(path.join(COVERS_DIR, fname), file.data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ path: `/covers/${fname}` }));
        } catch (e) { res.writeHead(500); return res.end(e.message); }
    }

    // Upload manuscript .docx (admin only)
    if (req.method === 'POST' && url === '/upload-manuscript') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req);
            const ct = req.headers['content-type'] || '';
            const bm = ct.match(/boundary=([^\s;]+)/);
            if (!bm) { res.writeHead(400); return res.end('No boundary'); }
            const parts = parseMultipart(body, bm[1]);
            const file = parts['file'];
            if (!file || !file.data) { res.writeHead(400); return res.end('No file'); }
            if (!/\.docx$/i.test(file.filename || '')) { res.writeHead(400); return res.end('Only .docx files supported'); }
            const formSlug = (parts['slug'] || '').trim();
            const slug = formSlug
                ? formSlug.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
                : (file.filename || 'manuscript').replace(/\.docx$/i, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
            const outPath = path.join(MANUSCRIPTS_DIR, slug + '.docx');
            fs.writeFileSync(outPath, file.data);
            MANUSCRIPT_CACHE.delete(slug);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ slug, name: slug + '.docx', size: file.data.length }));
        } catch (e) { res.writeHead(500); return res.end(e.message); }
    }

    // SSE (admin only)
    if (url === '/events') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        res.write(':ok\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
    }

    // Metrics data (admin only)
    if (url === '/data') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(fs.readFileSync(METRICS_FILE, 'utf8'));
        } catch {
            res.writeHead(500);
            return res.end('{}');
        }
    }

    // Scrape now (admin only)
    if (req.method === 'POST' && url === '/scrape') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        if (scrapeRunning) { res.writeHead(409); return res.end('Scrape already running'); }
        scrapeRunning = true;
        let stderr = '';
        const child = spawn(process.execPath, [SCRAPER_FILE], { cwd: __dirname, env: process.env, stdio: ['ignore', 'inherit', 'pipe'] });
        child.stderr.on('data', d => { stderr += d; process.stderr.write(d); });
        child.on('close', code => {
            scrapeRunning = false;
            if (!res.headersSent) {
                res.writeHead(code === 0 ? 200 : 500, { 'Content-Type': 'text/plain' });
                res.end(code === 0 ? 'ok' : `exit ${code}\n${stderr.slice(0, 2000)}`);
            }
        });
        child.on('error', err => {
            scrapeRunning = false;
            if (!res.headersSent) {
                res.writeHead(500);
                res.end('spawn failed: ' + err.message);
            }
        });
        return;
    }

    // Delete metrics date (admin only)
    if (req.method === 'POST' && url === '/delete-metrics-date') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req);
            const { date } = JSON.parse(body.toString());
            if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.writeHead(400); return res.end('Invalid date'); }
            const data = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
            for (const story of Object.values(data.stories)) story.history = (story.history || []).filter(e => e.date !== date);
            data.lastUpdated = new Date().toISOString();
            fs.writeFileSync(METRICS_FILE, JSON.stringify(data, null, 2));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end('{"ok":true}');
        } catch (e) { res.writeHead(500); return res.end(e.message); }
    }

    // ── USER MANAGEMENT API ───────────────────────────────
    // List all users (admin only)
    if (req.method === 'GET' && url === '/api/users') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const users = accounts.listAllUsers();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(users));
        } catch (e) { res.writeHead(500); return res.end(e.message); }
    }

    // Create new user (admin only)
    if (req.method === 'POST' && url === '/api/users') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req);
            const { username, password, role } = JSON.parse(body.toString());
            if (!username || !password) { res.writeHead(400); return res.end('Missing username or password'); }
            const success = accounts.createUser(username, password, role || 'user');
            if (!success) { res.writeHead(409); return res.end('Username already exists'); }
            res.writeHead(201, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true, username }));
        } catch (e) { res.writeHead(500); return res.end(e.message); }
    }

    // Delete user (admin only)
    if (req.method === 'DELETE' && url.startsWith('/api/users/')) {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const username = decodeURIComponent(url.slice(11)); // Remove '/api/users/'
            if (!username) { res.writeHead(400); return res.end('Missing username'); }
            const success = accounts.deleteUser(username);
            if (!success) { res.writeHead(404); return res.end('User not found'); }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true }));
        } catch (e) { res.writeHead(500); return res.end(e.message); }
    }

    // Reset user password (admin only)
    if (req.method === 'POST' && url.match(/^\/api\/users\/[^\/]+\/reset-password$/)) {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const username = decodeURIComponent(url.match(/^\/api\/users\/([^\/]+)/)[1]);
            const body = await readRawBody(req);
            const { password } = JSON.parse(body.toString());
            if (!password) { res.writeHead(400); return res.end('Missing new password'); }
            const success = accounts.resetPassword(username, password);
            if (!success) { res.writeHead(404); return res.end('User not found'); }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true }));
        } catch (e) { res.writeHead(500); return res.end(e.message); }
    }

    // Change user role (admin only)
    if (req.method === 'POST' && url.match(/^\/api\/users\/[^\/]+\/role$/)) {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const username = decodeURIComponent(url.match(/^\/api\/users\/([^\/]+)/)[1]);
            const body = await readRawBody(req);
            const { role } = JSON.parse(body.toString());
            if (!role || !['admin', 'user'].includes(role)) { res.writeHead(400); return res.end('Invalid role'); }
            const success = accounts.setUserRole(username, role);
            if (!success) { res.writeHead(404); return res.end('User not found'); }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true }));
        } catch (e) { res.writeHead(500); return res.end(e.message); }
    }

    // ── 404 ────────────────────────────────────────────────
    res.writeHead(404);
    res.end('Not found');
});

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} in use.`);
        process.exit(1);
    } else throw err;
});

// Graceful shutdown - close database
process.on('SIGTERM', async () => {
    console.log('\nSIGTERM received, closing database...');
    await contentDB.Close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\nSIGINT received, closing database...');
    await contentDB.Close();
    process.exit(0);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🐾 Nekojin Interactive`);
    console.log(`   Public site:  http://0.0.0.0:${PORT}/`);
    console.log(`   Login:        http://0.0.0.0:${PORT}/login`);
    console.log(`   Admin:        http://0.0.0.0:${PORT}/admin\n`);
});
