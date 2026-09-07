#!/usr/bin/env node
/**
 * Nekojin Interactive - Server
 * - Public site at / (served from ./public/)
 * - Admin panel at /admin (login required)
 * - /content        GET   → database (public)
 * - /save-content   POST  → database (auth required)
 * - /upload-cover   POST  → image optimization (auth required)
 */

// ── PERSISTENCE HARDENING: Set restrictive umask at earliest startup ──
// Prevents inadvertent file creation with world-readable permissions.
// umask(0o077) = owner-only files (rw-------), owner-only dirs (rwx------)
// This guards against accidental exposure of sensitive database files, backups,
// and uploaded content before explicit chmod() calls can restrict them.
process.umask(0o077);

const http = require('http');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const crypto = require('node:crypto');

// Import modules
const accounts = require('./accounts.js');
const contentDB = require('./database.js');
const backup = require('./backup.js');
const meta = require('./generate-meta.js');
const { subscribeToProvider } = require('./lib/newsletter-provider.js');
const gumroad = require('./lib/gumroad.js');
const youtube = require('./lib/youtube.js');

// ── DEPLOYMENT / ENV CONFIG ────────────────────────────────
// Only trust X-Forwarded-For / X-Real-IP when actually running behind a
// reverse proxy that sets them (e.g. nginx). Otherwise these headers are
// client-controlled and let anyone bypass rate limiting by spoofing them.
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

// Comma-separated list of origins allowed to make credentialed cross-origin
// requests (e.g. "https://worldofxanrea.com,https://www.worldofxanrea.com").
// Same-origin requests (the normal case for this site) don't need CORS at all.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://worldofxanrea.com')
    .split(',').map(s => s.trim()).filter(Boolean);

// Public self-registration is off by default for a solo-author site.
// Set ALLOW_PUBLIC_REGISTRATION=true to let visitors create accounts.
const PUBLIC_REGISTRATION_ENABLED = process.env.ALLOW_PUBLIC_REGISTRATION === 'true';

// ── RATE LIMITING ─────────────────────────────────────────
const rateLimits = new Map();

const RATE_LIMIT_CONFIG = {
    '/login': { windowMs: 15 * 60 * 1000, max: 5, message: 'Too many login attempts. Try again in 15 minutes.' },
    '/register': { windowMs: 60 * 60 * 1000, max: 3, message: 'Too many registration attempts. Try again in 1 hour.' },
    '/newsletter': { windowMs: 60 * 60 * 1000, max: 10, message: 'Too many newsletter signups from this IP.' },
    '/api/users': { windowMs: 15 * 60 * 1000, max: 20, message: 'Too many user management requests.' },
    '/webhook/gumroad': { windowMs: 60 * 1000, max: 10, message: 'Too many webhook requests.' },
    '/api/youtube': { windowMs: 60 * 1000, max: 30, message: 'Too many YouTube API requests.' },
    '/api/discord': { windowMs: 60 * 1000, max: 30, message: 'Too many Discord API requests.' },
    '/api/sales': { windowMs: 60 * 1000, max: 20, message: 'Too many sales requests.' },
    'default': { windowMs: 60 * 1000, max: 100, message: 'Too many requests. Please slow down.' }
};

function getClientIP(req) {
    if (TRUST_PROXY) {
        return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
               req.headers['x-real-ip'] ||
               req.connection.remoteAddress ||
               'unknown';
    }
    return req.connection.remoteAddress || 'unknown';
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
const PORT = Number(process.env.PORT) || 7771;

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

// Publishing dashboard database (read-only). Loaded lazily on first request so
// the server still boots in environments that don't ship publishing-db.js
// (e.g. the smoke-test harness, which copies a fixed file list).
let publishingDB = null;
function getPublishingDB() {
    if (!publishingDB) {
        const PublishingDB = require('./publishing-db.js');
        publishingDB = new PublishingDB();
    }
    return publishingDB;
}

// Publishing calendar store (manual public release entries). Loaded lazily on
// first request; opened only when a calendar endpoint is actually hit so the
// server still boots if publishing-calendar.js isn't shipped.
let publishingCalendar = null;
function getPublishingCalendar() {
    if (!publishingCalendar) {
        const PublishingCalendar = require('./publishing-calendar.js');
        publishingCalendar = new PublishingCalendar();
    }
    return publishingCalendar;
}

// ── CALENDAR HELPERS ──────────────────────────────────────
// Valid YYYY-MM-DD local date (checked against a real calendar date, not just
// the regex) so bad strings like "2025-02-30" are rejected up front.
function isValidDateStr(str) {
    if (typeof str !== 'string') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    const d = new Date(str + 'T00:00:00Z');
    return d instanceof Date && !isNaN(d) && d.toISOString().startsWith(str);
}

// Map a source platform name to the display key used by the badge, falling back
// to 'Other' for anything that isn't Royal Road or ScribbleHub.
function platformKey(name) {
    const n = String(name || '').trim().toLowerCase();
    if (n === 'rr' || n.includes('royal')) return 'RR';
    if (n === 'sh' || n.includes('scribble')) return 'SH';
    return 'Other';
}

// Preserve the source platform name for display (Royal Road, ScribbleHub, ...),
// normalizing unknowns to a readable value.
function platformDisplay(name) {
    const n = String(name || '').trim();
    if (!n) return 'Other';
    const k = platformKey(n);
    if (k === 'RR') return 'Royal Road';
    if (k === 'SH') return 'ScribbleHub';
    return n;
}

// Build a UTC-range datetime string for the read-only publishing DB's
// releaseWindow(). The public calendar only ever exposes / consumes local dates,
// so we over-fetch in UTC and filter by local date afterwards (see below).
function utcWindowStart(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString();
}
function utcWindowEnd(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
}

// Normalize a manual calendar row to the public-safe shape (notes and any
// internal/db fields are deliberately stripped).
function normalizeManualRelease(e) {
    return {
        id: e.id,
        source: 'manual',
        date: e.release_date,
        time: e.release_time || null,
        title: e.title,
        series: e.series,
        platform: platformDisplay(e.platform),
        platformKey: platformKey(e.platform),
        url: safePublicUrl(e.url),
        timezone: e.timezone || 'America/Phoenix'
    };
}

// Only http(s) URLs are safe to expose on the public calendar. Legacy rows that
// predate URL validation (or any future bad data) must have their URL dropped
// at the serialization boundary rather than rendered as a link.
function safePublicUrl(url) {
    if (typeof url !== 'string' || !url) return null;
    try {
        const parsed = new URL(url);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? url : null;
    } catch (e) {
        return null;
    }
}

// Normalize an imported release (from PublishingDB) to the public-safe shape.
// Dates/times stay as the source's local strings; they are never reinterpreted
// through the browser's timezone.
function normalizeImportedRelease(r) {
    const localDt = r.releaseDateTime; // "YYYY-MM-DD HH:MM:SS" (Phoenix local)
    const date = typeof localDt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(localDt)
        ? localDt.slice(0, 10) : null;
    const time = typeof localDt === 'string' && localDt.length >= 16
        ? localDt.slice(11, 16) : null;
    return {
        id: `import-${r.releaseId}`,
        source: 'import',
        date,
        time,
        title: r.title || 'Untitled Release',
        series: r.series || 'Unknown Series',
        platform: platformDisplay(r.platform),
        platformKey: platformKey(r.platform),
        url: safePublicUrl(r.url),
        timezone: r.releaseTimezone || 'America/Phoenix'
    };
}

// Serve the public publishing calendar: combines read-only imported releases
// with manual entries, both bucketed by local (YYYY-MM-DD) date with a
// half-open [start, end) boundary. Failures degrade safely without crashing.
async function handlePublicPublishingCalendar(req, res, query) {
    const start = query.get('start');
    const end = query.get('end');

    if (!isValidDateStr(start) || !isValidDateStr(end)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'start and end must be valid YYYY-MM-DD dates' }));
    }
    if (start >= end) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'start must be before end' }));
    }

    // Manual entries come from the calendar store (already local-date, half-open).
    let manual = [];
    try {
        const calendar = getPublishingCalendar();
        await calendar.Open();
        manual = (await calendar.ListPublic(start, end)) || [];
    } catch (err) {
        console.error('[Public Calendar] Manual entries unavailable:', err.message);
        manual = [];
    }

    // Imported entries come from the read-only publishing DB. We over-fetch a
    // UTC window that covers every possible local date in [start, end), then
    // keep only rows whose LOCAL date falls in the half-open range.
    let imported = [];
    try {
        const db = getPublishingDB();
        const window = {
            startUtc: utcWindowStart(start),
            endUtc: utcWindowEnd(end),
            limit: 500
        };
        const [published, scheduled] = await Promise.all([
            db.releaseWindow({ ...window, status: 'Published' }),
            db.releaseWindow({ ...window, status: 'Scheduled' })
        ]);
        const rows = [...published, ...scheduled];
        imported = (rows || [])
            .filter(r => {
                const localDate = typeof r.releaseDateTime === 'string'
                    ? r.releaseDateTime.slice(0, 10) : null;
                return !!localDate && localDate >= start && localDate < end;
            })
            .map(normalizeImportedRelease);
    } catch (err) {
        console.error('[Public Calendar] Imported releases unavailable:', err.message);
        imported = [];
    }

    const entries = manual.map(normalizeManualRelease).concat(imported);
    entries.sort((a, b) =>
        (a.date || '').localeCompare(b.date || '') ||
        (a.time || '').localeCompare(b.time || '') ||
        (a.platform || '').localeCompare(b.platform || '')
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ start, end, entries }));
}

const ADMIN_CALENDAR_RATE_KEY = '/api/admin/publishing-calendar';

// Serve the admin publishing calendar API. Only reachable past the auth + CSRF
// gates and requires an admin role (caller enforces the former two).
async function handleAdminPublishingCalendar(req, res, url) {
    const isList = url === '/api/admin/publishing-calendar';
    const delMatch = url.match(/^\/api\/admin\/publishing-calendar\/([^/]+)$/);

    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
    if (req.method === 'GET' && !isList) {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
    if (req.method === 'POST' && !isList) {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
    if (req.method === 'DELETE' && !delMatch) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Not found' }));
    }

    const limit = checkRateLimit(req, ADMIN_CALENDAR_RATE_KEY);
    if (!limit.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': limit.retryAfter });
        return res.end(JSON.stringify({ error: limit.message }));
    }

    try {
        const calendar = getPublishingCalendar();

        if (req.method === 'GET') {
            await calendar.Open();
            const entries = await calendar.ListAll();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ entries }));
        }

        if (req.method === 'POST') {
            const body = await readRawBody(req, 64 * 1024);
            const data = JSON.parse(body.toString());
            if (!data || typeof data !== 'object') {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
            }
            await calendar.Open();
            const entry = await calendar.Upsert(data);
            if (!entry) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Entry not found for update' }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true, entry }));
        }

        // DELETE /api/admin/publishing-calendar/:id
        const deleted = await calendar.Delete(delMatch[1]);
        if (!deleted) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Entry not found' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
    } catch (err) {
        const msg = err && err.message ? err.message : 'Admin calendar error';
        let status = 500;
        if (err instanceof SyntaxError || /json/i.test(msg)) status = 400;
        else if (/^Entry /.test(msg) || /must |required|format|be exactly/i.test(msg)) status = 400;
        else if (/not found/i.test(msg)) status = 404;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: msg }));
    }
}

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
// maxBytes guards against unbounded memory use from oversized request bodies
// (a cheap DoS vector since the whole body is buffered before parsing).
function readRawBody(req, maxBytes = 2 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', c => {
            size += c.length;
            if (size > maxBytes) {
                req.destroy();
                const err = new Error('Request body too large');
                err.status = 413;
                reject(err);
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
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
// Resolve a post-login redirect target to a safe local path. Rejects
// protocol-relative URLs (//host) and any CRLF/control characters that could
// smuggle extra headers, falling back to /admin.
function safeRedirectPath(next) {
    if (typeof next !== 'string' || !next) return '/admin';
    if (next.startsWith('//') || /[\r\n]/.test(next)) return '/admin';
    if (!next.startsWith('/')) return '/admin';
    return next;
}

function loginPage(nextUrl = '/admin', error = '') {
    const safeNext = safeRedirectPath(nextUrl);
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
      <input type="password" name="password" autocomplete="new-password" required minlength="8">
      <label>Confirm Password</label>
      <input type="password" name="confirm" autocomplete="new-password" required minlength="8">
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
    '/publishing-calendar': path.join(PUBLIC_DIR, 'publishing-calendar.html'),
    '/xanrean': path.join(PUBLIC_DIR, 'xanrean.html'),
    '/xanrean/books': path.join(PUBLIC_DIR, 'xanrean', 'books.html'),
    '/xanrean/characters': path.join(PUBLIC_DIR, 'xanrean', 'characters.html'),
    '/xanrean/characters/admins': path.join(PUBLIC_DIR, 'xanrean', 'characters', 'admins', 'admins.html'),
    '/xanrean/wiki': path.join(PUBLIC_DIR, 'xanrean', 'wiki.html'),
    '/xanrean/community': path.join(PUBLIC_DIR, 'xanrean', 'community.html'),
    '/xanrean/characters/moderators': path.join(PUBLIC_DIR, 'xanrean', 'characters', 'moderators', 'moderators.html'),
    '/xanrean/lore': path.join(PUBLIC_DIR, 'xanrean', 'lore.html'),
    '/xanrean/lore/timeline': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'timeline.html'),
    '/xanrean/lore/characters': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'characters.html'),
    '/xanrean/lore/species': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'species.html'),
    '/xanrean/lore/world': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'world.html'),
    '/xanrean/lore/nekojin': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'nekojin.html'),
    '/xanrean/lore/foxkin': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'foxkin.html'),
    '/xanrean/lore/elves': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'elves.html'),
    '/xanrean/lore/travelers': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'travelers.html'),
    '/xanrean/lore/wolfkin': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'wolfkin.html'),
    '/xanrean/lore/kitsune': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'kitsune.html'),
};

// ── SERVER ────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
        console.error('Unhandled request error:', err);
        try {
            if (!res.headersSent) {
                const status = err && err.status === 413 ? 413 : 500;
                res.writeHead(status, { 'Content-Type': 'text/plain' });
                res.end(status === 413 ? 'Payload too large' : 'Internal server error');
            } else {
                res.end();
            }
        } catch {}
    });
});

async function handleRequest(req, res) {
    const url = req.url.split('?')[0];
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;

    // CORS / preflight: only reflect an Origin that's on the allow-list.
    // Reflecting *any* Origin while allowing credentials would let any
    // website make authenticated cross-origin requests against admin APIs.
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie, X-CSRF-Token');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    // Security Headers: Defense in depth against common web vulnerabilities
    // X-Content-Type-Options: Prevent MIME-type sniffing (IE/Edge vulnerability)
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // X-Frame-Options: Prevent clickjacking by disallowing framing
    res.setHeader('X-Frame-Options', 'DENY');

    // X-XSS-Protection: Legacy XSS filter directive (for older browsers)
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer-Policy: Limit referrer leakage across origins
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions-Policy: Disable potentially dangerous APIs
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');

    // Cache-Control: Public routes cache reasonably; admin/API routes don't
    const isPublic = req.method === 'GET' && (
        url === '/' ||
        url.startsWith('/assets/') ||
        url.startsWith('/covers/') ||
        url.startsWith('/images/') ||
        url.startsWith('/xanrean/') ||
        url.startsWith('/data/')
    );
    if (isPublic) {
        res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    } else {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }

    // Public HTML pages
    if (req.method === 'GET' && PUBLIC_ROUTES[url])
        return serveFile(res, PUBLIC_ROUTES[url]);

    // World lore topic detail pages, one shared template, slug read client-side
    if (req.method === 'GET' && /^\/xanrean\/lore\/world\/[^\/]+$/.test(url))
        return serveFile(res, path.join(PUBLIC_DIR, 'xanrean', 'lore', 'world-topic.html'));

    // Individual character detail pages, one shared template, slug read
    // client-side. Excludes /admins and /moderators, which are legacy
    // redirect stubs handled by the exact-match PUBLIC_ROUTES above.
    if (req.method === 'GET' && /^\/xanrean\/characters\/(?!admins$|moderators$)[^\/]+$/.test(url))
        return serveFile(res, path.join(PUBLIC_DIR, 'xanrean', 'characters', 'character.html'));

    // Per-series cast pages, one shared template, series id read client-side
    if (req.method === 'GET' && /^\/xanrean\/series\/[^\/]+\/cast$/.test(url))
        return serveFile(res, path.join(PUBLIC_DIR, 'xanrean', 'series', 'cast.html'));

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
        '/publishing/'
    ];

    const ROOT_ASSETS = new Set([
        '/style.css',
        '/common.js',
        '/manifest.json',
        '/robots.txt',
        '/sitemap.xml',
        '/rss.xml'
    ]);

    if (req.method === 'GET') {
        let decodedUrl;
        try {
            decodedUrl = decodeURIComponent(url);
        } catch {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('Bad Request');
        }
        if (decodedUrl.includes('\0')) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('Bad Request');
        }

        const resolvedPath = path.resolve(PUBLIC_DIR, `.${decodedUrl}`);
        const isPathSafe = resolvedPath.startsWith(PUBLIC_DIR + path.sep);
        const relativeUrl = isPathSafe
            ? '/' + path.relative(PUBLIC_DIR, resolvedPath).split(path.sep).join('/')
            : '';
        const ext = path.extname(relativeUrl).toLowerCase();
        const isAllowedExt = ALLOWED_EXTENSIONS.has(ext);
        const isPublishingAsset = relativeUrl.startsWith('/publishing/') && ext !== '.html';
        const isAllowedDir = ALLOWED_DIRECTORIES.some(dir => relativeUrl.startsWith(dir)) &&
            (!relativeUrl.startsWith('/publishing/') || isPublishingAsset);
        const isRootAsset = ROOT_ASSETS.has(relativeUrl);

        if (isPathSafe && isAllowedExt && (isAllowedDir || isRootAsset)) {
            return serveFile(res, resolvedPath);
        }
        if (isAllowedExt || decodedUrl.startsWith('/covers/') || decodedUrl.startsWith('/assets/') ||
            decodedUrl.startsWith('/images/') || decodedUrl.startsWith('/fonts/')) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            return res.end('Forbidden: Invalid path');
        }
    }

    // Wiki Markdown is exposed through narrow APIs rather than reopening
    // /public/data/ as a static directory.
    if (req.method === 'GET' && url === '/api/compendium') {
        return serveFile(res, path.join(PUBLIC_DIR, 'data', 'lore', 'compendium.md'));
    }
    if (req.method === 'GET' && /^\/api\/wiki\/[a-z0-9-]+$/.test(url)) {
        const file = url.slice('/api/wiki/'.length);
        return serveFile(res, path.join(PUBLIC_DIR, 'data', 'characters', `${file}.md`));
    }

    // Gumroad Webhook (PUBLIC, CSRF-exempt)
     if (req.method === 'POST' && url === '/webhook/gumroad') {
         const limit = checkRateLimit(req, '/webhook/gumroad');
         if (!limit.allowed) {
             res.writeHead(429);
             return res.end(limit.message);
         }

         try {
             // Validate webhook signature (cryptographically strong authentication)
             // Gumroad's ping requests cannot be signed. Configure its ping URL
             // as /webhook/gumroad?secret=<GUMROAD_WEBHOOK_SECRET>; the header
             // form also supports a reverse proxy that injects the secret.
             const providedSecret = req.headers['x-gumroad-webhook-secret'] || query.get('secret');
             const configuredSecret = process.env.GUMROAD_WEBHOOK_SECRET;

             if (!configuredSecret) {
                 console.error('[Gumroad Webhook] GUMROAD_WEBHOOK_SECRET not configured');
                 res.writeHead(403);
                 return res.end('Forbidden: Webhook secret not configured');
             }

             if (!providedSecret) {
                 console.warn('[Gumroad Webhook] Missing webhook secret');
                 res.writeHead(403);
                 return res.end('Forbidden: Missing webhook secret header');
             }

             let secretValid = false;
             try {
                 secretValid = gumroad.validateWebhookSignature(configuredSecret, providedSecret);
             } catch (err) {
                 console.error('[Gumroad Webhook] Signature comparison error:', err);
                 res.writeHead(403);
                 return res.end('Forbidden: Invalid webhook secret');
             }

             if (!secretValid) {
                 console.warn('[Gumroad Webhook] Invalid webhook secret');
                 res.writeHead(403);
                 return res.end('Forbidden: Invalid webhook secret');
             }

             const body = await readRawBody(req, 512 * 1024);
             const ping = gumroad.parsePingBody(body);

             const settings = await contentDB.SelectXanreanSettings();
             const sellerId = settings.gumroad_seller_id || process.env.GUMROAD_SELLER_ID;

             const pingErrors = gumroad.validatePing(ping);
             if (!sellerId || pingErrors.length || !gumroad.validateSellerId(ping, sellerId)) {
                 res.writeHead(403);
                 return res.end('Forbidden: Invalid webhook');
             }

            // Convert and validate price strictly as integer (cents)
            const priceCents = gumroad.parsePriceInCents(ping.price);
            if (priceCents === null) {
                console.warn('[Gumroad Webhook] Price validation failed:', ping.price);
                res.writeHead(400);
                return res.end('Invalid price format');
            }

            await contentDB.InsertSale({
                ...ping,
                price: priceCents,
                purchased_at: ping.purchased_at || new Date().toISOString()
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true }));
        } catch (err) {
            console.error('[Gumroad Webhook] Error:', err);
            res.writeHead(500);
            return res.end('Internal Server Error');
        }
    }

    // Health check (public): DB connectivity + uptime, for monitoring/alerts
    if (req.method === 'GET' && url === '/api/health') {
        try {
            await contentDB.SelectHomepageSettings();
            let diskFree = null;
            try { diskFree = fs.statfsSync(__dirname).bfree * fs.statfsSync(__dirname).bsize; } catch {}

            let diskStatus = 'unknown';
            let alerts = [];

            if (diskFree === null) {
                alerts = ['Could not determine available disk space'];
            } else if (diskFree < 100 * 1024 * 1024) {
                diskStatus = 'critical';
                alerts = ['Disk space is critically low (< 100MB)'];
            } else if (diskFree < 1 * 1024 * 1024 * 1024) {
                diskStatus = 'warning';
                alerts = ['Disk space is low (< 1GB)'];
            } else {
                diskStatus = 'ok';
                alerts = [];
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                ok: true,
                uptimeSeconds: Math.floor(process.uptime()),
                dbConnected: true,
                diskFreeBytes: diskFree,
                diskStatus: diskStatus,
                alerts: alerts
            }));
        } catch (err) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, dbConnected: false, error: 'Service unavailable' }));
        }
    }

    // Public content API - now from database
    if (req.method === 'GET' && url === '/content') {
        try {
            const data = await contentDB.GetAllContent();
            // Public visitors only see published/released books (and previews
            // only when explicitly requested). Admins loading the editor get
            // the full, unfiltered catalog.
            if (!accounts.isAdmin(req)) {
                const previewRequested = query.get('preview') === '1';
                // Books must be both explicitly visible and in a public status.
                data.books = data.books.filter(b =>
                    b.visible !== false && contentDB.isBookPublic(b, previewRequested));
                // Games must be explicitly visible.
                data.game = (data.game || []).filter(g => g.visible !== false);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(data));
        } catch (err) {
            console.error('Database error:', err);
            res.writeHead(500);
            return res.end('{"error":"Failed to load content"}');
        }
    }

    // Character API
    if (url.startsWith('/api/characters')) {
        try {
            if (req.method === 'GET' && url === '/api/characters') {
                const characters = await contentDB.SelectCharacters();
                const filtered = accounts.isAdmin(req)
                    ? characters
                    : characters.filter(c => c.visible === 1);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(filtered));
            }
            if (req.method === 'GET' && url.match(/\/api\/characters\/([^\/]+)$/)) {
                const slug = url.split('/').pop();
                const char = await contentDB.SelectCharacterBySlug(slug);
                if (!char || (char.visible !== 1 && !accounts.isAdmin(req))) {
                    res.writeHead(404);
                    return res.end(JSON.stringify({ error: 'Character not found' }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(char));
            }
        } catch (err) {
            console.error('Character API error:', err);
            res.writeHead(500);
            return res.end(JSON.stringify({ error: 'Failed to load characters' }));
        }
    }

    // Timeline API
    if (url.startsWith('/api/timeline')) {
        try {
            if (req.method === 'GET' && url === '/api/timeline') {
                const events = await contentDB.SelectTimelineEvents();
                const filtered = accounts.isAdmin(req)
                    ? events
                    : events.filter(e => e.visible === 1);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(filtered));
            }
            if (req.method === 'GET' && url.match(/\/api\/timeline\/([^\/]+)$/)) {
                const id = url.split('/').pop();
                const event = await contentDB.SelectTimelineEventById(id);
                if (!event || (event.visible !== 1 && !accounts.isAdmin(req))) {
                    res.writeHead(404);
                    return res.end(JSON.stringify({ error: 'Timeline event not found' }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(event));
            }
        } catch (err) {
            console.error('Timeline API error:', err);
            res.writeHead(500);
            return res.end(JSON.stringify({ error: 'Failed to load timeline' }));
        }
    }

    // Lore API
    if (url.startsWith('/api/lore-topics')) {
        try {
            if (req.method === 'GET' && url === '/api/lore-topics') {
                const section = query.get('section');
                const topics = await contentDB.SelectLoreTopics(section || null);
                const filtered = accounts.isAdmin(req)
                    ? topics
                    : topics.filter(t => t.visible === 1);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(filtered));
            }
            if (req.method === 'GET' && url.match(/\/api\/lore-topics\/([^\/]+)$/)) {
                const slug = url.split('/').pop();
                const topic = await contentDB.SelectLoreTopicBySlug(slug);
                if (!topic || (topic.visible !== 1 && !accounts.isAdmin(req))) {
                    res.writeHead(404);
                    return res.end(JSON.stringify({ error: 'Lore topic not found' }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(topic));
            }
        } catch (err) {
            console.error('Lore API error:', err);
            res.writeHead(500);
            return res.end(JSON.stringify({ error: 'Failed to load lore topics' }));
        }
    }

    // Integration APIs (public)
    if (req.method === 'GET') {
        if (url === '/api/youtube') {
            const limit = checkRateLimit(req, '/api/youtube');
            if (!limit.allowed) {
                res.writeHead(429);
                return res.end(JSON.stringify({ error: limit.message }));
            }
            try {
                const settings = await contentDB.SelectXanreanSettings();
                const channelId = settings.youtube_channel_id || process.env.YOUTUBE_CHANNEL_ID;
                if (!channelId) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ videos: [] }));
                }
                const videos = await youtube.fetchLatestVideos(channelId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ videos }));
            } catch (e) {
                // Don't expose internal errors to client; log for debugging
                console.error('[YouTube API] Error:', e.message);
                res.writeHead(500);
                return res.end(JSON.stringify({ error: 'Service temporarily unavailable' }));
            }
        }
        if (url === '/api/discord') {
            const limit = checkRateLimit(req, '/api/discord');
            if (!limit.allowed) {
                res.writeHead(429);
                return res.end(JSON.stringify({ error: limit.message }));
            }
            try {
                const settings = await contentDB.SelectXanreanSettings();
                const server_id = settings.discord_server_id || process.env.DISCORD_SERVER_ID || null;
                const invite_code = settings.discord_invite_code || process.env.DISCORD_INVITE_CODE || null;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                    server_id,
                    invite_code,
                    invite_url: invite_code ? `https://discord.gg/${invite_code}` : null
                }));
            } catch (e) {
                console.error('[Discord API] Error:', e.message);
                res.writeHead(500);
                return res.end(JSON.stringify({ error: 'Service temporarily unavailable' }));
            }
        }
        if (url === '/api/sales') {
            const limit = checkRateLimit(req, '/api/sales');
            if (!limit.allowed) {
                res.writeHead(429);
                return res.end(JSON.stringify({ error: limit.message }));
            }
            try {
                const sales = await contentDB.SelectRecentSales(25);
                const mapped = sales.map(s => ({
                    product_name: s.product_name,
                    price_cents: s.price_cents,
                    currency: s.currency,
                    purchased_at: s.purchased_at
                    // Note: email deliberately excluded for privacy
                }));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ sales: mapped }));
            } catch (e) {
                console.error('[Sales API] Error:', e.message);
                res.writeHead(500);
                return res.end(JSON.stringify({ error: 'Service temporarily unavailable' }));
            }
        }
    }

    // Public single-book lookup (supports preview mode).
    // Used by public/book.html when ?preview=1 is present so a direct link
    // can show a preview book that is not listed in the regular catalog.
    if (req.method === 'GET' && url === '/book-by-slug') {
        try {
            const slug = query.get('slug');
            if (!slug) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Missing slug' }));
            }
            const previewAllowed = query.get('preview') === '1';
            const rows = await contentDB.SelectBooks(slug);
            const book = rows.find(b => contentDB.isBookPublic(b, previewAllowed));
            if (!book) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Book not found' }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ book }));
        } catch (err) {
            console.error('Database error:', err);
            res.writeHead(500);
            return res.end('{"error":"Failed to load book"}');
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

        const body = await readRawBody(req, 16 * 1024);
        const params = parseFormBody(body);
        if (accounts.verifyUser(params.username, params.password)) {
            const sid = accounts.createSession(params.username);
            const csrfToken = accounts.getSessionCsrfToken(sid);
            const next = safeRedirectPath(params.next);
            res.writeHead(302, {
                Location: next,
                'Set-Cookie': [
                    `nki_session=${sid}; HttpOnly; SameSite=Strict; Max-Age=${accounts.SESSION_TTL / 1000}; Path=/`,
                    `nki_csrf=${csrfToken}; SameSite=Strict; Max-Age=${accounts.SESSION_TTL / 1000}; Path=/`,
                ],
            });
            return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(loginPage(params.next || '/admin', 'Incorrect username or password.'));
    }

    if (req.method === 'GET' && url === '/register') {
        if (!PUBLIC_REGISTRATION_ENABLED) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(registerPage());
    }

    if (req.method === 'POST' && url === '/register') {
        if (!PUBLIC_REGISTRATION_ENABLED) { res.writeHead(404); return res.end('Not found'); }

        // Rate limit check
        const limit = checkRateLimit(req, '/register');
        if (!limit.allowed) {
            res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': limit.retryAfter });
            return res.end(limit.message);
        }

        const body = await readRawBody(req, 16 * 1024);
        const params = parseFormBody(body);
        const username = (params.username || '').trim().toLowerCase();
        const password = params.password || '';
        const confirm = params.confirm || '';
        if (!/^[a-z0-9_]{3,32}$/.test(username)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(registerPage('Username must be 3-32 characters: letters, numbers, underscores.'));
        }
        if (password.length < 8) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(registerPage('Password must be at least 8 characters.'));
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
        res.writeHead(302, {
            Location: '/login',
            'Set-Cookie': [
                'nki_session=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/',
                'nki_csrf=; SameSite=Strict; Max-Age=0; Path=/',
            ],
        });
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
            const body = await readRawBody(req, 16 * 1024);
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

            // Fire-and-forget call to external provider.
            // We do not await this to ensure the user gets an immediate response
            // and doesn't suffer latency from 3rd party API calls.
            // Internal try/catch and timeout in subscribeToProvider handle errors.
            subscribeToProvider(email, 'website').catch(err =>
                console.error('[Newsletter] Critical failure in provider call:', err)
            );

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

    // Get Xanrean panel settings (public, no auth required)
    if (req.method === 'GET' && url === '/api/xanrean') {
        try {
            const settings = await contentDB.SelectXanreanSettings();
            // Public endpoint must never leak the Gumroad access token; it is
            // only ever returned to admins via /api/settings.
            const { gumroad_access_token, ...publicSettings } = settings;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(publicSettings));
        } catch (e) {
            res.writeHead(500);
            return res.end(JSON.stringify({ error: e.message }));
        }
    }

    // ── PUBLIC PUBLISHING CALENDAR API ────────────────────
    // Intentional before the auth gate: this is deliberately public. It only
    // ever returns safe public fields (title, series, platform, local date/time,
    // optional platform URL) — never notes or the underlying DB path. Uses the
    // half-open [start, end) local-date window.
    if (req.method === 'GET' && url === '/api/public/publishing-calendar') {
        return handlePublicPublishingCalendar(req, res, query);
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

    // ── CSRF GATE ─────────────────────────────────────────
    // Double-submit cookie check for state-changing requests. The session
    // cookie is HttpOnly and SameSite=Strict, but this adds defense-in-depth
    // against CSRF from same-site subdomains / CORS misconfiguration.
    if ((req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT') && url !== '/webhook/gumroad') {
        const sid = accounts.getSessionId(req);
        const csrfHeader = req.headers['x-csrf-token'];
        if (!accounts.isValidCsrfToken(sid, csrfHeader)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Invalid or missing CSRF token' }));
        }
    }

    // ── AUTHENTICATED ROUTES ──────────────────────────────
    const username = accounts.getUsername(req);

    // Admin Character API
    if (url.startsWith('/api/characters')) {
        try {
            if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
            if (req.method === 'POST' && url.match(/^\/api\/characters\/([^\/]+)\/appearances$/)) {
                const id = url.split('/')[3];
                const body = await readRawBody(req, 64 * 1024);
                const { appearances } = JSON.parse(body.toString());
                const result = await contentDB.ReplaceCharacterAppearances(id, appearances || []);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(result));
            }
            if (req.method === 'POST' || req.method === 'PUT') {
                const body = await readRawBody(req, 10 * 1024 * 1024);
                const data = JSON.parse(body.toString());
                if (!data.name || !data.slug) {
                    res.writeHead(400);
                    return res.end(JSON.stringify({ error: 'Name and slug are required' }));
                }
                if (!/^[a-z0-9_-]+$/.test(String(data.slug))) {
                    res.writeHead(400);
                    return res.end(JSON.stringify({ error: 'Invalid character slug' }));
                }
                const result = await contentDB.InsertCharacter(data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(result));
            }
            if (req.method === 'DELETE' && url.match(/\/api\/characters\/([^\/]+)$/)) {
                const id = url.split('/').pop();
                const result = await contentDB.DeleteCharacter(id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(result));
            }
        } catch (err) {
            console.error('Admin Character API error:', err);
            res.writeHead(500);
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    // Admin Timeline API
    if (url.startsWith('/api/timeline')) {
        try {
            if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
            if (req.method === 'POST' || req.method === 'PUT') {
                const body = await readRawBody(req, 10 * 1024 * 1024);
                const data = JSON.parse(body.toString());
                if (!data.title) {
                    res.writeHead(400);
                    return res.end(JSON.stringify({ error: 'Title is required' }));
                }
                if (!data.id) {
                    data.id = crypto.randomUUID();
                }
                const result = await contentDB.InsertTimelineEvent(data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(result));
            }
            if (req.method === 'DELETE' && url.match(/\/api\/timeline\/([^\/]+)$/)) {
                const id = url.split('/').pop();
                const result = await contentDB.DeleteTimelineEvent(id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(result));
            }
        } catch (err) {
            console.error('Admin Timeline API error:', err);
            res.writeHead(500);
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    // Admin Lore API
    if (url.startsWith('/api/lore-topics')) {
        try {
            if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
            if (req.method === 'POST' || req.method === 'PUT') {
                const body = await readRawBody(req, 10 * 1024 * 1024);
                const data = JSON.parse(body.toString());
                if (!data.title || !data.slug || !data.section) {
                    res.writeHead(400);
                    return res.end(JSON.stringify({ error: 'Title, slug, and section are required' }));
                }
                if (!/^[a-z0-9_-]+$/.test(String(data.slug))) {
                    res.writeHead(400);
                    return res.end(JSON.stringify({ error: 'Invalid lore slug' }));
                }
                const result = await contentDB.InsertLoreTopic(data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(result));
            }
            if (req.method === 'DELETE' && url.match(/\/api\/lore-topics\/([^\/]+)$/)) {
                const id = url.split('/').pop();
                const result = await contentDB.DeleteLoreTopic(id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(result));
            }
        } catch (err) {
            console.error('Admin Lore API error:', err);
            res.writeHead(500);
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    // API Keys (read / write) - kept for potential future use
    if (url === '/api/keys') {
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(accounts.getUserKeys(username)));
        }
        if (req.method === 'POST') {
            try {
                const body = await readRawBody(req, 16 * 1024);
                const data = JSON.parse(body.toString('utf8'));
                for (const [provider, key] of Object.entries(data)) {
                    if (!accounts.setUserKey(username, provider, key || '')) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: 'Failed to persist API key' }));
                    }
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end('{"ok":true}');
            } catch (e) { res.writeHead(400); return res.end(e.message); }
        }
    }

    // Admin Integrations Settings API (auth already enforced by the gate above)
    if (url === '/api/settings') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        if (req.method === 'GET') {
            try {
                const settings = await contentDB.SelectXanreanSettings();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                    gumroad_seller_id: settings.gumroad_seller_id,
                    gumroad_access_token: settings.gumroad_access_token,
                    youtube_channel_id: settings.youtube_channel_id,
                    discord_server_id: settings.discord_server_id,
                    discord_invite_code: settings.discord_invite_code
                }));
            } catch (e) {
                res.writeHead(500);
                return res.end(JSON.stringify({ error: e.message }));
            }
        }
        if (req.method === 'POST') {
            try {
                const body = await readRawBody(req, 16 * 1024);
                const data = JSON.parse(body.toString());
                const current = await contentDB.SelectXanreanSettings();
                await contentDB.UpdateXanreanSettings({
                    ...current,
                    gumroad_seller_id: data.gumroad_seller_id,
                    gumroad_access_token: data.gumroad_access_token,
                    youtube_channel_id: data.youtube_channel_id,
                    discord_server_id: data.discord_server_id,
                    discord_invite_code: data.discord_invite_code
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: true }));
            } catch (e) {
                res.writeHead(400);
                return res.end(JSON.stringify({ error: e.message }));
            }
        }
    }

    // Admin page (admin only)
    if (req.method === 'GET' && (url === '/admin' || url === '/dashboard')) {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        return serveFile(res, ADMIN_FILE);
    }

    // Update book sequence (admin only)
    if (req.method === 'POST' && url === '/api/books/reorder') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req, 64 * 1024);
            const { seriesId, bookIds } = JSON.parse(body.toString());
            if (!Array.isArray(bookIds)) {
                res.writeHead(400);
                return res.end(JSON.stringify({ error: 'bookIds must be an array' }));
            }
            const result = await contentDB.UpdateBookSequence(seriesId || null, bookIds);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result));
        } catch (e) {
            res.writeHead(500);
            return res.end(JSON.stringify({ error: e.message }));
        }
    }

    // Update game sequence (admin only)
    if (req.method === 'POST' && url === '/api/games/reorder') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req, 64 * 1024);
            const { gameIds } = JSON.parse(body.toString());
            if (!Array.isArray(gameIds)) {
                res.writeHead(400);
                return res.end(JSON.stringify({ error: 'gameIds must be an array' }));
            }
            const result = await contentDB.ReorderGames(gameIds);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result));
        } catch (e) {
            res.writeHead(500);
            return res.end(JSON.stringify({ error: e.message }));
        }
    }

    // Save site content (admin only) - now to database
    if (req.method === 'POST' && url === '/save-content') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req, 10 * 1024 * 1024);
            const data = JSON.parse(body.toString());

            // Validate book slugs: lowercase, numbers, hyphens, underscores only.
            if (data.books && Array.isArray(data.books)) {
                for (const book of data.books) {
                    const slug = book.slug || book.id;
                    if (!/^[a-z0-9_-]+$/.test(slug)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({
                            error: `Invalid slug for book "${book.title || 'Unknown'}": "${slug}". Slugs must be lowercase, numbers, hyphens, or underscores.`
                        }));
                    }
                }
            }

            // Required field enforcement to prevent DB NOT NULL constraint violations.
            if (data.books && Array.isArray(data.books)) {
                for (const book of data.books) {
                    if (!book.title) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: `Book (ID: ${book.id}) is missing a title.` }));
                    }
                }
            }
            if (data.series && Array.isArray(data.series)) {
                for (const s of data.series) {
                    if (!s.name && !s.universe) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: `Series (ID: ${s.id}) is missing a name.` }));
                    }
                }
            }
            if (data.game) {
                const games = Array.isArray(data.game) ? data.game : [data.game];
                for (const g of games) {
                    if (g && Object.keys(g).length > 0 && !g.title) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: `Game is missing a title.` }));
                    }
                }
            }
            if (data.about && Object.keys(data.about).length > 0) {
                if (!data.about.studio_name && !data.about.studioName) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: `About page is missing the studio name.` }));
                }
            }

            // Safety: backup the DB before any bulk replacement, then proceed.
            const restorePoint = await contentDB.CreateBackup('save-content');
            await contentDB.SaveAllContent(data);
            // Best-effort: keep sitemap.xml/rss.xml in sync with content changes.
            meta.generateAll().catch(err => console.error('Meta regeneration failed:', err));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end('{"ok":true}');
        } catch (e) {
            console.error('Save content error:', e);
            let status = 500;
            if (e.code === 'EMPTY_CONTENT_GUARD' || e.code === 'DUPLICATE_SLUG') {
                status = 409;
            }
            res.writeHead(status, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: e.message }));
        }
    }

    // Cover image upload (admin only) with optimization
    if (req.method === 'POST' && url === '/upload-cover') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req, 25 * 1024 * 1024);
            const ct = req.headers['content-type'] || '';
            const bm = ct.match(/boundary=([^\s;]+)/);
            if (!bm) { res.writeHead(400); return res.end('No boundary'); }
            const parts = parseMultipart(body, bm[1]);
            const file = parts['cover'];
            if (!file || !file.data) { res.writeHead(400); return res.end('No file'); }
            if (file.data.length === 0) { res.writeHead(400); return res.end('Image file is empty'); }
            if (file.data.length > 20 * 1024 * 1024) { res.writeHead(413); return res.end('Image too large (max 20MB)'); }

            // bookId ends up in a filename written under COVERS_DIR, so strip
            // anything that isn't safe for a path segment to prevent traversal.
            const bookId = (parts['bookId'] || 'cover').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'cover';
            // Use fixed filename for homepage and xanrean backgrounds (overwrite), timestamp for others
            const useFixedName = bookId.startsWith('homepage-cover-') || bookId.startsWith('xanrean-cover-');
            const fname = useFixedName ? `${bookId}.webp` : `${bookId}-${Date.now()}.webp`;

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

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                path: `/covers/${fname}`,
                originalSize: file.data.length,
                optimized: true
            }));
        } catch (e) {
            const isSharpError = e.message && (e.message.includes('unsupported image format') || e.message.includes('Input buffer contains insufficient pixel data'));
            res.writeHead(isSharpError ? 400 : 500, { 'Content-Type': 'text/plain' });
            return res.end(isSharpError ? `Invalid image file: ${e.message}` : e.message);
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
            const backupPath = await backup.createBackup();
            const cleaned = backup.cleanupOldBackups();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: !!backupPath, cleaned }));
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

    // ── HOMEPAGE SETTINGS API (POST - admin only) ─────────
    // Update homepage settings (admin only)
    if (req.method === 'POST' && url === '/api/homepage') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req, 64 * 1024);
            const data = JSON.parse(body.toString());
            await contentDB.UpdateHomepageSettings(data);
            const updated = await contentDB.SelectHomepageSettings();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(updated));
        } catch (e) {
            console.error('POST /api/homepage error:', e);
            res.writeHead(500);
            return res.end(JSON.stringify({ error: e.message }));
        }
    }

    // ── XANREAN SETTINGS API ──────────────────────────────
    // Get xanrean settings (public)

    // Update xanrean settings (admin only)
    if (req.method === 'POST' && url === '/api/xanrean') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req, 64 * 1024);
            const data = JSON.parse(body.toString());
            await contentDB.UpdateXanreanSettings(data);
            const updated = await contentDB.SelectXanreanSettings();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(updated));
        } catch (e) {
            console.error('POST /api/xanrean error:', e);
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
            const body = await readRawBody(req, 16 * 1024);
            const { username, password, role } = JSON.parse(body.toString());
            if (!username || !password) { res.writeHead(400); return res.end('Missing username or password'); }
            if (!/^[a-z0-9_]{3,32}$/.test(String(username).trim().toLowerCase())) {
                res.writeHead(400); return res.end('Username must be 3-32 characters: letters, numbers, underscores');
            }
            if (password.length < 8) { res.writeHead(400); return res.end('Password must be at least 8 characters'); }
            if (role && !['admin', 'user'].includes(role)) { res.writeHead(400); return res.end('Invalid role'); }
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
            if (accounts.isLastAdmin(username)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Cannot delete the last remaining admin account.' }));
            }
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
            const body = await readRawBody(req, 16 * 1024);
            const { password } = JSON.parse(body.toString());
            if (!password) { res.writeHead(400); return res.end('Missing new password'); }
            if (password.length < 8) { res.writeHead(400); return res.end('Password must be at least 8 characters'); }
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
            const body = await readRawBody(req, 16 * 1024);
            const { role } = JSON.parse(body.toString());
            if (!role || !['admin', 'user'].includes(role)) { res.writeHead(400); return res.end('Invalid role'); }
            if (role !== 'admin' && accounts.isLastAdmin(username)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Cannot demote the last remaining admin account.' }));
            }
            const success = accounts.setUserRole(username, role);
            if (!success) { res.writeHead(404); return res.end('User not found'); }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true }));
        } catch (e) { res.writeHead(500); return res.end(e.message); }
    }

    // ── PUBLISHING CALENDAR (ADMIN) ───────────────────────
    // Admin-only. The page is served at /admin/publishing-calendar and the API
    // lives under /api/admin/publishing-calendar. The auth gate above redirects
    // unauthenticated requests to login; these require an admin role. POST and
    // DELETE are additionally protected by the CSRF gate that runs earlier.

    // Admin calendar page (admin only)
    if (req.method === 'GET' && url === '/admin/publishing-calendar') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        return serveFile(res, path.join(PUBLIC_DIR, 'publishing-calendar-admin.html'));
    }

    // Admin calendar API (admin only)
    if (url.startsWith('/api/admin/publishing-calendar')) {
        if (!accounts.isAdmin(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }
        return handleAdminPublishingCalendar(req, res, url);
    }

    // ── PUBLISHING DASHBOARD ───────────────────────────────
    // Admin-only. The page is served at /admin/publishing and the read-only
    // API lives under /api/publishing/*. Unauthenticated browser requests are
    // redirected to login by the auth gate above; non-admins get 403 here.

    // Admin page (admin only)
    if (req.method === 'GET' && url === '/admin/publishing') {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        return serveFile(res, path.join(PUBLIC_DIR, 'publishing', 'index.html'));
    }

    // Publishing API (admin only)
    if (url.startsWith('/api/publishing')) {
        if (!accounts.isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        if (req.method !== 'GET') { res.writeHead(405); return res.end('Method Not Allowed'); }

        try {
            const db = getPublishingDB();
            const send = (data) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(data));
            };

            if (url === '/api/publishing/health') {
                return send(await db.health());
            }
            if (url === '/api/publishing/overview') {
                const [kpis, cadence, series, platforms, upcoming] = await Promise.all([
                    db.overview(),
                    db.cadence(),
                    db.seriesComparison(),
                    db.platformComparison(),
                    db.upcoming(12),
                ]);
                return send({ kpis, cadence, series, platforms, upcoming });
            }
            if (url === '/api/publishing/catalog') {
                const page = parseInt(query.get('page') || '1', 10);
                const pageSize = parseInt(query.get('pageSize') || '50', 10);
                const result = await db.catalog({
                    q: query.get('q') || undefined,
                    series: query.get('series') || undefined,
                    platform: query.get('platform') || undefined,
                    status: query.get('status') || undefined,
                    page,
                    pageSize,
                });
                return send(result);
            }
            if (url === '/api/publishing/filters') {
                return send(await db.filters());
            }
            if (url === '/api/publishing/series') {
                const rows = await db.seriesAnalytics();
                return send({ rows });
            }
            if (url === '/api/publishing/health-checks') {
                return send(await db.healthChecks());
            }
            if (url === '/api/publishing/freshness') {
                return send(await db.freshness());
            }
            if (url === '/api/publishing/releases') {
                const startUtc = query.get('startUtc');
                const endUtc = query.get('endUtc');
                if (!startUtc || !endUtc) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'startUtc and endUtc are required' }));
                }
                const releases = await db.releaseWindow({
                    startUtc,
                    endUtc,
                    status: query.get('status') || undefined,
                    limit: parseInt(query.get('limit') || '500', 10),
                });
                return send({ releases });
            }

            res.writeHead(404);
            return res.end('Not found');
        } catch (err) {
            console.error('Publishing API error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    // ── 404 ────────────────────────────────────────────────
    res.writeHead(404);
    res.end('Not found');
}

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} in use.`);
        process.exit(1);
    } else throw err;
});

// Safety net: a single bad request should never take the whole server down.
process.on('unhandledRejection', err => {
    console.error('Unhandled rejection (server kept running):', err);
});

// Graceful shutdown - close database
process.on('SIGTERM', async () => {
    console.log('\nSIGTERM received, closing database...');
    await contentDB.Close();
    if (publishingDB) await publishingDB.close();
    if (publishingCalendar) await publishingCalendar.Close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\nSIGINT received, closing database...');
    await contentDB.Close();
    if (publishingDB) await publishingDB.close();
    if (publishingCalendar) await publishingCalendar.Close();
    process.exit(0);
});

server.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n🐾 Nekojin Interactive`);
    console.log(`   Public site:  http://0.0.0.0:${PORT}/`);
    console.log(`   Login:        http://0.0.0.0:${PORT}/login`);
    console.log(`   Admin:        http://0.0.0.0:${PORT}/admin\n`);

    // Startup sanity check: detect the silent-wipe failure mode where the DB
    // content tables are empty but cover uploads still exist on disk.
    try {
        await contentDB.Open();
        const runScheduledBackup = async () => {
            try {
                await backup.createBackup();
                backup.cleanupOldBackups();
            } catch (err) {
                console.error('Scheduled backup failed:', err.message);
            }
        };
        void runScheduledBackup();
        setInterval(() => {
            console.log(`[${new Date().toISOString()}] Running scheduled backup...`);
            void runScheduledBackup();
        }, 24 * 60 * 60 * 1000);
        const { series, books, game, about } = await contentDB.GetAllContent();
        const hasContent = (series && series.length > 0) ||
                           (books && books.length > 0) ||
                           (game && game.length > 0) ||
                           (about && Object.keys(about).length > 1); // id only = empty
        if (!hasContent) {
            const coversDir = path.join(PUBLIC_DIR, 'covers');
            const coverFiles = fs.existsSync(coversDir) ? fs.readdirSync(coversDir) : [];
            const hasCovers = coverFiles.some(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f));
            if (hasCovers) {
                console.warn('⚠️  WARNING: content tables are empty but /public/covers/ still has files.');
                console.warn('   This matches the silent-wipe failure mode. Restore from backup or run');
                console.warn(`   ${path.relative(process.cwd(), path.join(__dirname, 'tools', 'restore-content.js'))} before editing in the admin panel.\n`);
            }
        }
    } catch (err) {
        console.error('⚠️  Startup content check failed:', err.message);
    }
});
