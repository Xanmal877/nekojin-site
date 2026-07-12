#!/usr/bin/env node
/**
 * Nekojin Interactive - Server
 * - Public site at / (served from ./public/)
 * - Admin panel at /admin (login required)
 * - /content        GET   → database (public)
 * - /save-content   POST  → database (auth required)
 * - /upload-cover   POST  → image optimization (auth required)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Import modules
const accounts = require('./accounts.js');
const contentDB = require('./database.js');
const backup = require('./backup.js');

// ── RATE LIMITING ─────────────────────────────────────────
const rateLimits = new Map();

const RATE_LIMIT_CONFIG = {
    '/login': { windowMs: 15 * 60 * 1000, max: 5, message: 'Too many login attempts. Try again in 15 minutes.' },
    '/register': { windowMs: 60 * 60 * 1000, max: 3, message: 'Too many registration attempts. Try again in 1 hour.' },
    '/newsletter': { windowMs: 60 * 60 * 1000, max: 10, message: 'Too many newsletter signups from this IP.' },
    '/api/users': { windowMs: 15 * 60 * 1000, max: 20, message: 'Too many user management requests.' },
    'default': { windowMs: 60 * 1000, max: 100, message: 'Too many requests. Please slow down.' }
};

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           'unknown';
}

function checkRateLimit(req, endpoint) {
    const ip = getClientIP(req);
    const config = RATE_LIMIT_CONFIG[endpoint] || RATE_LIMIT_CONFIG['default'];
    const key = `${ip}:${endpoint}`;
    const now = Date.now();
    
    if (!rateLimits.has(key)) {
        rateLimits.set(key, { count: 1, resetTime: now + config.windowMs });
        return { allowed: true };
    }
    
    const record = rateLimits.get(key);
    
    // Reset if window expired
    if (now > record.resetTime) {
        record.count = 1;
        record.resetTime = now + config.windowMs;
        return { allowed: true };
    }
    
    // Check limit
    if (record.count >= config.max) {
        const retryAfter = Math.ceil((record.resetTime - now) / 1000);
        return { 
            allowed: false, 
            status: 429, 
            message: config.message,
            retryAfter 
        };
    }
    
    record.count++;
    return { allowed: true };
}

// Cleanup old entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimits) {
        if (now > record.resetTime) rateLimits.delete(key);
    }
}, 10 * 60 * 1000);

// ── CONFIG ────────────────────────────────────────────────
const PORT = 7771;

// OPTION 1: Manuscript system disabled (can re-enable later)
// Set to true to re-enable .docx reading and /read page
const MANUSCRIPTS_ENABLED = false;

// Conditionally import mammoth only if manuscripts enabled
const mammoth = MANUSCRIPTS_ENABLED ? require('mammoth') : null;

const ADMIN_FILE = path.join(__dirname, 'admin.html');
const PUBLIC_DIR = path.join(__dirname, 'public');
const COVERS_DIR = path.join(PUBLIC_DIR, 'covers');
const MANUSCRIPTS_DIR = path.join(__dirname, 'manuscripts');

// Ensure directories exist
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });
if (MANUSCRIPTS_ENABLED && !fs.existsSync(MANUSCRIPTS_DIR)) fs.mkdirSync(MANUSCRIPTS_DIR, { recursive: true });

// Open database connection
contentDB.Open();
console.log('Database connection opened');

// Start automatic backups (runs immediately, then daily)
backup.createBackup();
backup.cleanupOldBackups();
setInterval(() => {
    console.log(`[${new Date().toISOString()}] Running scheduled backup...`);
    backup.createBackup();
    backup.cleanupOldBackups();
}, 24 * 60 * 60 * 1000); // 24 hours

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

// ── PUBLIC ROUTES ─────────────────────────────────────────
const PUBLIC_ROUTES = {
    '/': path.join(PUBLIC_DIR, 'index.html'),
    '/books': path.join(PUBLIC_DIR, 'books.html'),
    '/book': path.join(PUBLIC_DIR, 'book.html'),
    '/read': path.join(PUBLIC_DIR, 'read.html'),
    '/games': path.join(PUBLIC_DIR, 'games.html'),
    '/about': path.join(PUBLIC_DIR, 'about.html'),
    '/xanrean': path.join(PUBLIC_DIR, 'xanrean.html'),
    '/xanrean/books': path.join(PUBLIC_DIR, 'xanrean', 'books.html'),
    '/xanrean/characters': path.join(PUBLIC_DIR, 'xanrean', 'characters.html'),
    '/xanrean/characters/admins': path.join(PUBLIC_DIR, 'xanrean', 'characters', 'admins.html'),
    '/xanrean/characters/saki': path.join(PUBLIC_DIR, 'xanrean', 'characters', 'character.html'),
    '/xanrean/characters/admin-destruction': path.join(PUBLIC_DIR, 'xanrean', 'characters', 'character.html'),
    '/xanrean/characters/tama': path.join(PUBLIC_DIR, 'xanrean', 'characters', 'character.html'),
    '/xanrean/characters/admin-creation': path.join(PUBLIC_DIR, 'xanrean', 'characters', 'character.html'),
    '/xanrean/wiki': path.join(PUBLIC_DIR, 'xanrean', 'wiki.html'),
    '/xanrean/characters/moderators': path.join(PUBLIC_DIR, 'xanrean', 'characters', 'moderators.html'),
    '/xanrean/lore': path.join(PUBLIC_DIR, 'xanrean', 'lore.html'),
    '/xanrean/lore/nekojin': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'nekojin.html'),
    '/xanrean/lore/foxkin': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'foxkin.html'),
    '/xanrean/lore/elves': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'elves.html'),
    '/xanrean/lore/travelers': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'travelers.html'),
    '/xanrean/lore/wolfkin': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'wolfkin.html'),
    '/xanrean/lore/kitsune': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'kitsune.html'),
    '/standalone': path.join(PUBLIC_DIR, 'standalone.html'),
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

    // Static assets with whitelist validation
    // Security: Only serve allowed file types from safe directories
    const ALLOWED_EXTENSIONS = new Set([
        '.html', '.css', '.js', '.xml', '.txt', '.json', '.md',
        '.png', '.jpg', '.jpeg', '.ico', '.svg', '.webp', '.gif'
    ]);
    
    const ALLOWED_DIRECTORIES = [
        '/covers/',
        '/assets/',
        '/images/',
        '/fonts/',
        '/data/'
    ];
    
    if (req.method === 'GET') {
        // Decode URL to handle spaces and special characters
        const decodedUrl = decodeURIComponent(url);
        const ext = path.extname(decodedUrl).toLowerCase();
        const isAllowedExt = ALLOWED_EXTENSIONS.has(ext);
        const isAllowedDir = ALLOWED_DIRECTORIES.some(dir => decodedUrl.startsWith(dir));
        
        // Block path traversal attempts
        const resolvedPath = path.resolve(path.join(PUBLIC_DIR, decodedUrl));
        const isPathSafe = resolvedPath.startsWith(PUBLIC_DIR);
        
        if ((isAllowedExt || isAllowedDir) && isPathSafe) {
            return serveFile(res, resolvedPath);
        } else if (isAllowedExt && !isPathSafe) {
            // Path traversal attempt detected
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            return res.end('Forbidden: Invalid path');
        }
    }

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

    // ── MANUSCRIPT API (OPTION 1: DISABLED) ─────────────────
    // Set MANUSCRIPTS_ENABLED = true above to re-enable
    // Manuscript reading system hidden to focus on external platform links
    if (MANUSCRIPTS_ENABLED) {
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
    }
    // ── END MANUSCRIPT API ──────────────────────────────────

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
        // Rate limit check
        const limit = checkRateLimit(req, '/login');
        if (!limit.allowed) {
            res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': limit.retryAfter });
            return res.end(limit.message);
        }
        
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
        // Rate limit check
        const limit = checkRateLimit(req, '/register');
        if (!limit.allowed) {
            res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': limit.retryAfter });
            return res.end(limit.message);
        }
        
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
        // Rate limit check
        const limit = checkRateLimit(req, '/newsletter');
        if (!limit.allowed) {
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': limit.retryAfter });
            return res.end(JSON.stringify({ error: limit.message }));
        }
        
        try {
            const body = await readRawBody(req);
            const { email } = JSON.parse(body.toString());
            if (!email || !email.includes('@')) { 
                res.writeHead(400); 
                return res.end(JSON.stringify({ error: 'Invalid email' }));
            }
            
            // Use database instead of JSON file
            const result = await contentDB.InsertSubscriber(email, 'website');
            if (!result.success) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: result.error }));
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end('{"ok":true}');
        } catch (e) { 
            res.writeHead(500); 
            return res.end(e.message); 
        }
    }

    // ── PUBLIC HOMEPAGE SETTINGS API ──────────────────────
    // Get homepage settings (public, no auth required)
    if (req.method === 'GET' && url === '/api/homepage') {
        try {
            const settings = await contentDB.SelectHomepageSettings();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(settings));
        } catch (e) {
            res.writeHead(500);
            return res.end(JSON.stringify({ error: e.message }));
        }
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

    // Cover image upload (admin only) with optimization
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
            // Use fixed filename for homepage and xanrean backgrounds (overwrite), timestamp for others
            const useFixedName = bookId.startsWith('homepage-cover-') || bookId.startsWith('xanrean-cover-');
            const fname = useFixedName ? `${bookId}.webp` : `${bookId}-${Date.now()}.webp`;
            const thumbFname = useFixedName ? `${bookId}-thumb.webp` : `${bookId}-${Date.now()}-thumb.webp`;
            
            // Process image with sharp
            const image = sharp(file.data);
            const metadata = await image.metadata();
            
            // Panel backgrounds get portrait resize (800x1200), books get standard resize
            const isPanelBg = bookId.startsWith('homepage-cover-') || bookId.startsWith('xanrean-cover-');
            
            if (isPanelBg) {
                // Force portrait 800x1200 for panel backgrounds
                image.resize(800, 1200, { 
                    fit: 'cover',
                    position: 'center'
                });
            } else {
                // Standard resize for book covers (max 1200px)
                const maxDimension = 1200;
                if (metadata.width > maxDimension || metadata.height > maxDimension) {
                    image.resize(maxDimension, maxDimension, { 
                        fit: 'inside', 
                        withoutEnlargement: true 
                    });
                }
            }
            
            // Save optimized WebP
            await image
                .webp({ quality: 85, effort: 4 })
                .toFile(path.join(COVERS_DIR, fname));
            
            // Generate thumbnail - panels get portrait thumb, books get square
            if (isPanelBg) {
                await sharp(file.data)
                    .resize(400, 600, { fit: 'cover', position: 'center' })
                    .webp({ quality: 80, effort: 4 })
                    .toFile(path.join(COVERS_DIR, thumbFname));
            } else {
                await sharp(file.data)
                    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 80, effort: 4 })
                    .toFile(path.join(COVERS_DIR, thumbFname));
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ 
                path: `/covers/${fname}`,
                thumbnail: `/covers/${thumbFname}`,
                originalSize: file.data.length,
                optimized: true
            }));
        } catch (e) { 
            res.writeHead(500); 
            return res.end(e.message); 
        }
    }

    // Upload manuscript .docx (OPTION 1: DISABLED)
    // Set MANUSCRIPTS_ENABLED = true above to re-enable
    if (MANUSCRIPTS_ENABLED && req.method === 'POST' && url === '/upload-manuscript') {
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

    // Disabled manuscript upload response
    if (!MANUSCRIPTS_ENABLED && req.method === 'POST' && url === '/upload-manuscript') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Manuscript upload disabled (Option 1). Set MANUSCRIPTS_ENABLED=true to re-enable.' }));
    }

    // ── BACKUP API ───────────────────────────────────────────
    // Create manual backup (admin only)
    if (req.method === 'POST' && url === '/api/backup') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const success = backup.createBackup();
            const cleaned = backup.cleanupOldBackups();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: success, cleaned }));
        } catch (e) { res.writeHead(500); return res.end(e.message); }
    }

    // Get backup status (admin only)
    if (url === '/api/backup/status') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const backupDir = path.join(__dirname, 'data', 'backups');
            const files = fs.readdirSync(backupDir)
                .filter(f => f.startsWith('nekojin-') && f.endsWith('.db'))
                .map(f => {
                    const stats = fs.statSync(path.join(backupDir, f));
                    return {
                        name: f,
                        date: f.replace('nekojin-', '').replace('.db', ''),
                        size: stats.size,
                        created: stats.mtime
                    };
                })
                .sort((a, b) => b.created - a.created);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ backups: files, count: files.length }));
        } catch (e) { 
            res.writeHead(500); 
            return res.end(JSON.stringify({ error: e.message })); 
        }
    }

    console.log(`>>> REQUEST: ${req.method} ${url}`);
    
    // ── HOMEPAGE SETTINGS API (POST - admin only) ─────────
    // Update homepage settings (admin only)
    if (req.method === 'POST' && url === '/api/homepage') {
        console.log('>>> POST /api/homepage HIT');
        if (!accounts.isAdmin(req)) { 
            console.log('>>> AUTH FAILED');
            res.writeHead(403); 
            return res.end('Forbidden'); 
        }
        try {
            const body = await readRawBody(req);
            console.log('>>> Raw body:', body.toString());
            const data = JSON.parse(body.toString());
            console.log('>>> Parsed data:', data);
            const result = await contentDB.UpdateHomepageSettings(data);
            console.log('>>> DB update result:', result);
            // Check what's actually in the database
            const before = await contentDB.SelectHomepageSettings();
            console.log('>>> DB after update:', before);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(before));
        } catch (e) {
            console.error('>>> POST /api/homepage ERROR:', e);
            res.writeHead(500);
            return res.end(JSON.stringify({ error: e.message }));
        }
    }

    // ── XANREAN SETTINGS API ──────────────────────────────
    // Get xanrean settings (public)
    if (req.method === 'GET' && url === '/api/xanrean') {
        try {
            const settings = await contentDB.SelectXanreanSettings();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(settings));
        } catch (e) {
            res.writeHead(500);
            return res.end(JSON.stringify({ error: e.message }));
        }
    }

    // Update xanrean settings (admin only)
    if (req.method === 'POST' && url === '/api/xanrean') {
        console.log('>>> POST /api/xanrean HIT');
        if (!accounts.isAdmin(req)) { 
            console.log('>>> AUTH FAILED');
            res.writeHead(403); 
            return res.end('Forbidden'); 
        }
        try {
            const body = await readRawBody(req);
            console.log('>>> Raw body:', body.toString());
            const data = JSON.parse(body.toString());
            console.log('>>> Parsed data:', data);
            const result = await contentDB.UpdateXanreanSettings(data);
            console.log('>>> DB update result:', result);
            const before = await contentDB.SelectXanreanSettings();
            console.log('>>> DB after update:', before);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(before));
        } catch (e) {
            console.error('>>> POST /api/xanrean ERROR:', e);
            res.writeHead(500);
            return res.end(JSON.stringify({ error: e.message }));
        }
    }

    // ── USER MANAGEMENT API ───────────────────────────────
    // List all users (admin only)
    if (req.method === 'GET' && url === '/api/users') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        
        // Rate limit check
        const limit = checkRateLimit(req, '/api/users');
        if (!limit.allowed) {
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': limit.retryAfter });
            return res.end(JSON.stringify({ error: limit.message }));
        }
        
        try {
            const users = accounts.listAllUsers();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(users));
        } catch (e) { res.writeHead(500); return res.end(e.message); }
    }

    // Create new user (admin only)
    if (req.method === 'POST' && url === '/api/users') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        
        // Rate limit check
        const limit = checkRateLimit(req, '/api/users');
        if (!limit.allowed) {
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': limit.retryAfter });
            return res.end(JSON.stringify({ error: limit.message }));
        }
        
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
