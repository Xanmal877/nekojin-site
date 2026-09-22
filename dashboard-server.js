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

// ── RESPONSE HELPERS ──────────────────────────────────────
// Almost every handler answers with one JSON body, so keep the
// status/header/body triad in one place instead of spelling it out per route.
function sendJson(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function sendHtml(res, markup, status = 200) {
    res.writeHead(status, { 'Content-Type': 'text/html' });
    res.end(markup);
}

function sendText(res, text, status = 200) {
    res.writeHead(status, { 'Content-Type': 'text/plain' });
    res.end(text);
}

// Every redirect this server issues is a plain 302 to a local path.
function redirect(res, location) {
    res.writeHead(302, { Location: location });
    res.end();
}

// Short forms for the statuses this server returns constantly without a body.
const forbidden = res => sendText(res, 'Forbidden', 403);
const notFound = res => sendText(res, 'Not found', 404);

// Rate-limit gate. Returns true when the caller must stop (the 429 is already
// sent). `json` picks the error body style: API callers get JSON, form posts
// get plain text.
function enforceRateLimit(req, res, endpoint, { json = false } = {}) {
    const limit = checkRateLimit(req, endpoint);
    if (limit.allowed) return false;
    res.writeHead(429, {
        'Content-Type': json ? 'application/json' : 'text/plain',
        'Retry-After': limit.retryAfter
    });
    res.end(json ? JSON.stringify({ error: limit.message }) : limit.message);
    return true;
}

// Read and parse a JSON request body. Throws the same SyntaxError a bare
// JSON.parse would, so existing error handling keeps working.
async function readJsonBody(req, maxBytes) {
    const body = await readRawBody(req, maxBytes);
    return JSON.parse(body.toString());
}

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

// Disabled by default; set MANUSCRIPTS_ENABLED=true to enable .docx reading
// and the /read page in a deployment that has reviewed the upload surface.
const MANUSCRIPTS_ENABLED = process.env.MANUSCRIPTS_ENABLED === 'true';

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
        return sendJson(res, { error: 'start and end must be valid YYYY-MM-DD dates' }, 400);
    }
    if (start >= end) {
        return sendJson(res, { error: 'start must be before end' }, 400);
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

    return sendJson(res, { start, end, entries }, 200);
}

const ADMIN_CALENDAR_RATE_KEY = '/api/admin/publishing-calendar';

// Serve the admin publishing calendar API. Only reachable past the auth + CSRF
// gates and requires an admin role (caller enforces the former two).
async function handleAdminPublishingCalendar(req, res, url) {
    const isList = url === '/api/admin/publishing-calendar';
    const delMatch = url.match(/^\/api\/admin\/publishing-calendar\/([^/]+)$/);

    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
        return sendJson(res, { error: 'Method not allowed' }, 405);
    }
    if (req.method === 'GET' && !isList) {
        return sendJson(res, { error: 'Method not allowed' }, 405);
    }
    if (req.method === 'POST' && !isList) {
        return sendJson(res, { error: 'Method not allowed' }, 405);
    }
    if (req.method === 'DELETE' && !delMatch) {
        return sendJson(res, { error: 'Not found' }, 404);
    }

    if (enforceRateLimit(req, res, ADMIN_CALENDAR_RATE_KEY, { json: true })) return;

    try {
        const calendar = getPublishingCalendar();

        if (req.method === 'GET') {
            await calendar.Open();
            const entries = await calendar.ListAll();
            return sendJson(res, { entries }, 200);
        }

        if (req.method === 'POST') {
            const body = await readRawBody(req, 64 * 1024);
            const data = JSON.parse(body.toString());
            if (!data || typeof data !== 'object') {
                return sendJson(res, { error: 'Invalid JSON body' }, 400);
            }
            await calendar.Open();
            const entry = await calendar.Upsert(data);
            if (!entry) {
                return sendJson(res, { error: 'Entry not found for update' }, 404);
            }
            return sendJson(res, { ok: true, entry }, 200);
        }

        // DELETE /api/admin/publishing-calendar/:id
        const deleted = await calendar.Delete(delMatch[1]);
        if (!deleted) {
            return sendJson(res, { error: 'Entry not found' }, 404);
        }
        return sendJson(res, { ok: true }, 200);
    } catch (err) {
        const msg = err && err.message ? err.message : 'Admin calendar error';
        let status = 500;
        if (err instanceof SyntaxError || /json/i.test(msg)) status = 400;
        else if (/^Entry /.test(msg) || /must |required|format|be exactly/i.test(msg)) status = 400;
        else if (/not found/i.test(msg)) status = 404;
        return sendJson(res, { error: msg }, status);
    }
}

// ── MANUSCRIPTS (disabled by default) ─────────────────────
// Reading .docx manuscripts is a whole optional feature, so it lives in one
// function instead of being sprinkled through the request dispatch chain.
// With MANUSCRIPTS_ENABLED=false (the default) none of this is reachable:
// reads 503 and the list/chapters endpoints simply stay unmapped.
async function handleManuscriptRequest(req, res, url) {
    if (req.method === 'GET' && url === '/api/manuscripts') {
        return sendJson(res, { manuscripts: listManuscripts() });
    }

    const chaptersMatch = url.match(/^\/api\/manuscripts\/([^\/]+)\/chapters$/);
    if (req.method === 'GET' && chaptersMatch) {
        const slug = chaptersMatch[1];
        const chapters = await parseManuscript(slug);
        if (!chapters) return notFound(res);
        return sendJson(res, {
            slug,
            total: chapters.length,
            preview: chapters.length > 3 ? 3 : chapters.length,
            chapters: chapters.map((c, i) => ({ num: c.num, title: c.title, index: i }))
        });
    }

    const chapterMatch = url.match(/^\/api\/manuscripts\/([^\/]+)\/chapters\/([0-9]+)$/);
    if (req.method === 'GET' && chapterMatch) {
        const chapters = await parseManuscript(chapterMatch[1]);
        if (!chapters) return notFound(res);
        const chapter = chapters.find(c => c.num === parseInt(chapterMatch[2], 10));
        if (!chapter) return sendText(res, 'Chapter not found', 404);
        return sendJson({
            num: chapter.num,
            title: chapter.title,
            content: chapter.content,
            total: chapters.length
        });
    }
}

async function handleManuscriptUpload(req, res) {
    try {
        const body = await readRawBody(req);
        const ct = req.headers['content-type'] || '';
        const bm = ct.match(/boundary=([^\s;]+)/);
        if (!bm) return sendText(res, 'No boundary', 400);
        const parts = parseMultipart(body, bm[1]);
        const file = parts['file'];
        if (!file || !file.data) return sendText(res, 'No file', 400);
        if (!/\.docx$/i.test(file.filename || '')) return sendText(res, 'Only .docx files supported', 400);
        const formSlug = (parts['slug'] || '').trim();
        const slug = formSlug
            ? formSlug.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
            : (file.filename || 'manuscript').replace(/\.docx$/i, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
        fs.writeFileSync(path.join(MANUSCRIPTS_DIR, slug + '.docx'), file.data);
        MANUSCRIPT_CACHE.delete(slug);
        return sendJson(res, { slug, name: slug + '.docx', size: file.data.length });
    } catch (e) {
        return sendText(res, e.message, 500);
    }
}

const MANUSCRIPT_DISABLED = {
    error: 'Manuscript upload disabled (Option 1). Set MANUSCRIPTS_ENABLED=true to re-enable.'
};

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
        return notFound(res);
    }
}

// ── LOGIN/REGISTER PAGES ─────────────────────────────
// Resolve a post-login redirect target to a safe local path. Rejects
// protocol-relative URLs (//host), any backslash (\host / \\host), CRLF and
// other control characters (which could smuggle extra headers), and anything
// that isn't a local path. Falls back to /admin on any suspicious input.
function safeRedirectPath(next) {
    if (typeof next !== 'string' || !next) return '/admin';
    if (next.startsWith('//') || next.includes('\\') || /[\r\n\x00-\x1f]/.test(next)) return '/admin';
    if (!next.startsWith('/')) return '/admin';
    return next;
}

// The login and register pages are the same card with a different form, so
// the shell (fonts, palette, layout) lives here once and each page supplies
// only its own fields.
const AUTH_PAGE_CSS = `
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
    .link-row{display:flex;justify-content:center;gap:1rem;margin-top:1.25rem;font-size:0.82rem}
    .link-row a{color:#d4c8f0;text-decoration:none}
    .link-row a:hover{color:#8B44E8}
    .hint{font-size:0.75rem;color:#5A4A80;margin-bottom:1.25rem}
`;

function authPage({ title, heading, error = '', success = '', form }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Nekojin Interactive</title>
  <link href="https://fonts.googleapis.com/css2?family=Darumadrop+One&family=Zen+Kaku+Gothic+New:wght@400;500;600&display=swap" rel="stylesheet">
  <style>${AUTH_PAGE_CSS}</style>
</head>
<body>
  <div class="card">
    <div class="logo">Nekojin Interactive</div>
    <div class="sub">✦ ${heading} ✦</div>
    ${error ? `<div class="error">${error}</div>` : ''}
    ${success ? `<div class="success">${success}</div>` : ''}
${form}
  </div>
</body>
</html>`;
}

function loginPage(nextUrl = '/admin', error = '') {
    const safeNext = safeRedirectPath(nextUrl);
    return authPage({
        title: 'Admin Login',
        heading: 'Sign In',
        error,
        form: `    <form method="POST" action="/login">
      <input type="hidden" name="next" value="${safeNext.replace(/"/g, '&quot;')}">
      <label>Username</label>
      <input type="text" name="username" autocomplete="username" required>
      <label>Password</label>
      <input type="password" name="password" autocomplete="current-password" required>
      <button type="submit">Sign In</button>
    </form>
    <div class="link-row"><a href="/register">Create account</a><a href="/">Back to site</a></div>`
    });
}

function registerPage(error = '', success = '') {
    return authPage({
        title: 'Create Account',
        heading: 'Create Account',
        error,
        success,
        form: `    <form method="POST" action="/register" ${success ? 'style="display:none;"' : ''}>
      <label>Username</label>
      <p class="hint">3-32 characters, letters, numbers, underscores only.</p>
      <input type="text" name="username" autocomplete="username" required pattern="[a-z0-9_]{3,32}" title="3-32 lowercase letters, numbers, underscores">
      <label>Password</label>
      <input type="password" name="password" autocomplete="new-password" required minlength="8">
      <label>Confirm Password</label>
      <input type="password" name="confirm" autocomplete="new-password" required minlength="8">
      <button type="submit">Create Account</button>
    </form>
    <a href="/login" class="back">← Back to sign in</a>`
    });
}

// ── COVER VERSIONING ──────────────────────────────────────
// Cover files are replaced in place (same filename, new art), so a browser
// holding the old bytes has no way to know. Hash the file content and append
// it as a query string: same art -> same URL (stays cached), new art -> new
// URL (fetched immediately). Memoised by mtime+size so re-requesting /content
// doesn't re-hash every cover.
const coverVersionCache = new Map();

function coverVersion(coverPath) {
    if (typeof coverPath !== 'string' || !coverPath.startsWith('/covers/')) return '';
    // Ignore anything with a query/dot-segment trick in it.
    if (coverPath.includes('..') || coverPath.includes('?') || coverPath.includes('#')) return '';
    const file = path.join(PUBLIC_DIR, coverPath.slice(1));
    try {
        const st = fs.statSync(file);
        const key = `${st.mtimeMs}:${st.size}`;
        let v = coverVersionCache.get(coverPath);
        if (!v || v.key !== key) {
            v = { key, version: crypto.createHash('sha1')
                .update(fs.readFileSync(file)).digest('hex').slice(0, 8) };
            coverVersionCache.set(coverPath, v);
        }
        return `?v=${v.version}`;
    } catch {
        return '';   // missing file: leave the URL alone, let it 404 visibly
    }
}

function withCoverVersion(book) {
    if (!book || typeof book !== 'object') return book;
    const v = coverVersion(book.cover);
    return v ? { ...book, cover: book.cover + v } : book;
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

// ── PUBLIC CONTENT READS (characters / timeline / lore) ────
// The unauthenticated half of the same three content types the admin CRUD
// section writes. Invisible rows are filtered out for non-admins; a hidden
// single entity 404s rather than leaking that it exists.
const PUBLIC_READS = {
    '/api/characters': {
        list: () => contentDB.SelectCharacters(),
        one: slug => contentDB.SelectCharacterBySlug(slug),
        label: 'Character'
    },
    '/api/timeline': {
        list: () => contentDB.SelectTimelineEvents(),
        one: id => contentDB.SelectTimelineEventById(id),
        label: 'Timeline event'
    },
    '/api/lore-topics': {
        list: section => contentDB.SelectLoreTopics(section),
        one: slug => contentDB.SelectLoreTopicBySlug(slug),
        label: 'Lore topic'
    }
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

    // Cache-Control: public *static assets* cache reasonably; HTML pages and
    // admin/API routes do not.
    //
    // HTML is deliberately excluded. Page markup and cover art are both edited
    // in place under fixed URLs, and every public page renders its content with
    // an inline script. Caching the HTML meant a normal reload kept serving the
    // *old* inline script — old section headings, old cover filenames — until
    // the entry expired, so only a hard reload showed current content. Markup
    // gets no-cache so the document and its script always match; the data it
    // fetches (/content) is already no-store, and cover URLs are content-hashed
    // (see withCoverVersion) so their bytes can't go stale either.
    const isStaticAsset = req.method === 'GET' && (
        url.startsWith('/assets/') ||
        url.startsWith('/covers/') ||
        url.startsWith('/images/') ||
        url.startsWith('/fonts/') ||
        url === '/style.css' ||
        url === '/common.js' ||
        url.startsWith('/publishing/')
    );
    if (isStaticAsset) {
        res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    } else {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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
          if (enforceRateLimit(req, res, '/webhook/gumroad')) return;

          try {
              // Validate webhook signature (cryptographically strong authentication)
              // Gumroad's ping requests cannot be signed. In production, ONLY accept
              // the secret via the X-Gumroad-Webhook-Secret header (set by reverse proxy).
              // Query-string secrets are unsafe as they appear in logs/referrers.
              // For local development, query-string fallback is allowed if not in production.
              let providedSecret = req.headers['x-gumroad-webhook-secret'];
              const isProduction = process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true';
              if (!providedSecret && !isProduction) {
                  providedSecret = query.get('secret'); // Fallback only in dev
              }
              const configuredSecret = process.env.GUMROAD_WEBHOOK_SECRET;

             if (!configuredSecret) {
                 console.error('[Gumroad Webhook] GUMROAD_WEBHOOK_SECRET not configured');
                 return sendText(res, 'Forbidden: Webhook secret not configured', 403);
             }

             if (!providedSecret) {
                 console.warn('[Gumroad Webhook] Missing webhook secret');
                 return sendText(res, 'Forbidden: Missing webhook secret header', 403);
             }

             let secretValid = false;
             try {
                 secretValid = gumroad.validateWebhookSignature(configuredSecret, providedSecret);
             } catch (err) {
                 console.error('[Gumroad Webhook] Signature comparison error:', err);
                 return sendText(res, 'Forbidden: Invalid webhook secret', 403);
             }

             if (!secretValid) {
                 console.warn('[Gumroad Webhook] Invalid webhook secret');
                 return sendText(res, 'Forbidden: Invalid webhook secret', 403);
             }

             const body = await readRawBody(req, 512 * 1024);
             const ping = gumroad.parsePingBody(body);

             const settings = await contentDB.SelectXanreanSettings();
             const sellerId = settings.gumroad_seller_id || process.env.GUMROAD_SELLER_ID;

             const pingErrors = gumroad.validatePing(ping);
             if (!sellerId || pingErrors.length || !gumroad.validateSellerId(ping, sellerId)) {
                 return sendText(res, 'Forbidden: Invalid webhook', 403);
             }

            // Convert and validate price strictly as integer (cents)
            const priceCents = gumroad.parsePriceInCents(ping.price);
            if (priceCents === null) {
                console.warn('[Gumroad Webhook] Price validation failed:', ping.price);
                return sendText(res, 'Invalid price format', 400);
            }

            await contentDB.InsertSale({
                ...ping,
                price: priceCents,
                purchased_at: ping.purchased_at || new Date().toISOString()
            });

            return sendJson(res, { ok: true }, 200);
        } catch (err) {
            console.error('[Gumroad Webhook] Error:', err);
            return sendText(res, 'Internal Server Error', 500);
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

            return sendJson(res, {
                ok: true,
                uptimeSeconds: Math.floor(process.uptime()),
                dbConnected: true,
                diskFreeBytes: diskFree,
                diskStatus: diskStatus,
                alerts: alerts
            }, 200);
        } catch (err) {
            return sendJson(res, { ok: false, dbConnected: false, error: 'Service unavailable' }, 503);
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
            // Cover art is re-uploaded in place under the same filename, so the
            // URL alone can't tell a browser its bytes changed. Append a
            // content hash so a replaced cover gets a new URL and the old one
            // can be cached forever without ever going stale.
            data.books = (data.books || []).map(withCoverVersion);
            return sendJson(res, data, 200);
        } catch (err) {
            console.error('Database error:', err);
            return sendText(res, '{"error":"Failed to load content"}', 500);
        }
    }

    // Public content reads: characters, timeline, lore topics.
    const readBase = url.split('/').slice(0, 3).join('/');
    const publicRead = PUBLIC_READS[readBase];
    if (publicRead && req.method === 'GET') {
        const rest = url.slice(readBase.length);
        try {
            if (!rest) {
                const rows = await publicRead.list(query.get('section'));
                const visible = accounts.isAdmin(req) ? rows : rows.filter(r => r.visible === 1);
                return sendJson(res, visible);
            }
            if (/^\/[^/]+$/.test(rest)) {
                const entity = await publicRead.one(decodeURIComponent(rest.slice(1)));
                if (!entity || (entity.visible !== 1 && !accounts.isAdmin(req))) {
                    return sendJson(res, { error: `${publicRead.label} not found` }, 404);
                }
                return sendJson(res, entity);
            }
        } catch (err) {
            console.error(`${publicRead.label} API error:`, err);
            return sendJson(res, { error: `Failed to load ${publicRead.label.toLowerCase()}s` }, 500);
        }
    }





// ── INTEGRATION APIS (public) ─────────────────────────────
// Each integration reads its config from the settings row (admin-editable)
// and falls back to an env var, then responds with one JSON shape. Failures
// are logged but never surfaced to the client. Defined as a table so the
// routes stay one line each and adding a provider doesn't mean another
// copy of the same try/catch/rate-limit block.
const INTEGRATION_ROUTES = {
    '/api/youtube': async () => {
        const settings = await contentDB.SelectXanreanSettings();
        const channelId = settings.youtube_channel_id || process.env.YOUTUBE_CHANNEL_ID;
        if (!channelId) return { videos: [] };
        return { videos: await youtube.fetchLatestVideos(channelId) };
    },

    '/api/discord': async () => {
        const settings = await contentDB.SelectXanreanSettings();
        const server_id = settings.discord_server_id || process.env.DISCORD_SERVER_ID || null;
        const invite_code = settings.discord_invite_code || process.env.DISCORD_INVITE_CODE || null;
        return {
            server_id,
            invite_code,
            invite_url: invite_code ? `https://discord.gg/${invite_code}` : null
        };
    },

    '/api/sales': async () => {
        const sales = await contentDB.SelectRecentSales(25);
        return {
            // email deliberately excluded for privacy
            sales: sales.map(s => ({
                product_name: s.product_name,
                price_cents: s.price_cents,
                currency: s.currency,
                purchased_at: s.purchased_at
            }))
        };
    }
};

async function handleIntegrationRequest(req, res, url) {
    try {
        return sendJson(res, await INTEGRATION_ROUTES[url]());
    } catch (e) {
        // Don't expose internal errors to the client; log for debugging
        console.error(`[${url}] Error:`, e.message);
        return sendJson(res, { error: 'Service temporarily unavailable' }, 500);
    }
}



    // Integration APIs (public): one handler per provider in INTEGRATION_ROUTES
    if (req.method === 'GET' && INTEGRATION_ROUTES[url]) {
        if (enforceRateLimit(req, res, url, { json: true })) return;
        return handleIntegrationRequest(req, res, url);
    }

    // Public single-book lookup (supports preview mode).
    // Used by public/book.html when ?preview=1 is present so a direct link
    // can show a preview book that is not listed in the regular catalog.
    if (req.method === 'GET' && url === '/book-by-slug') {
        try {
            const slug = query.get('slug');
            if (!slug) {
                return sendJson(res, { error: 'Missing slug' }, 400);
            }
            const previewAllowed = query.get('preview') === '1';
            const rows = await contentDB.SelectBooks(slug);
            const book = rows.find(b => contentDB.isBookPublic(b, previewAllowed));
            if (!book) {
                return sendJson(res, { error: 'Book not found' }, 404);
            }
            return sendJson(res, { book }, 200);
        } catch (err) {
            console.error('Database error:', err);
            return sendText(res, '{"error":"Failed to load book"}', 500);
        }
    }


    // Manuscript API + upload: one optional feature, one gate.
    if (MANUSCRIPTS_ENABLED && url.startsWith('/api/manuscripts')) {
        return handleManuscriptRequest(req, res, url);
    }
    if (url === '/upload-manuscript') {
        if (!MANUSCRIPTS_ENABLED) return sendJson(res, MANUSCRIPT_DISABLED, 503);
        if (!accounts.isAdmin(req)) return forbidden(res);
        return handleManuscriptUpload(req, res);
    }

    // ── LOGIN / LOGOUT / REGISTER ─────────────────────────
    if (req.method === 'GET' && url === '/login') {
        if (accounts.isAuthenticated(req)) {
            return redirect(res, '/admin');
        }
        return sendHtml(res, loginPage(query.get('next') || '/admin'));
    }

    if (req.method === 'POST' && url === '/login') {
        // Rate limit check
        if (enforceRateLimit(req, res, '/login')) return;

        const body = await readRawBody(req, 16 * 1024);
        const params = parseFormBody(body);
         if (accounts.verifyUser(params.username, params.password)) {
             const sid = accounts.createSession(params.username);
             const csrfToken = accounts.getSessionCsrfToken(sid);
             const next = safeRedirectPath(params.next);
             res.writeHead(302, {
                 Location: next,
                 'Set-Cookie': [
                     accounts.setCookieHeader('nki_session', sid, { sameSite: 'Strict' }),
                     // Double-submit CSRF: the client must be able to read this
                     // cookie to echo it back in the X-CSRF-Token header, so it
                     // is the one cookie that is deliberately not HttpOnly.
                     accounts.setCookieHeader('nki_csrf', csrfToken, { sameSite: 'Strict', httpOnly: false }),
                 ],
             });
             return res.end();
         }
        return sendHtml(res, loginPage(params.next || '/admin', 'Incorrect username or password.'));
    }

    if (req.method === 'GET' && url === '/register') {
        if (!PUBLIC_REGISTRATION_ENABLED) { return notFound(res); }
        return sendHtml(res, registerPage());
    }

    if (req.method === 'POST' && url === '/register') {
        if (!PUBLIC_REGISTRATION_ENABLED) { return notFound(res); }

        // Rate limit check
        if (enforceRateLimit(req, res, '/register')) return;

        const body = await readRawBody(req, 16 * 1024);
        const params = parseFormBody(body);
        const username = (params.username || '').trim().toLowerCase();
        const password = params.password || '';
        const confirm = params.confirm || '';
        if (!/^[a-z0-9_]{3,32}$/.test(username)) {
            return sendHtml(res, registerPage('Username must be 3-32 characters: letters, numbers, underscores.'));
        }
        if (password.length < 8) {
            return sendHtml(res, registerPage('Password must be at least 8 characters.'));
        }
        if (password !== confirm) {
            return sendHtml(res, registerPage('Passwords do not match.'));
        }
        if (!accounts.createUser(username, password)) {
            return sendHtml(res, registerPage('Username already taken.'));
        }
        return sendHtml(res, registerPage('', 'Account created. You can now log in.'));
    }

     if (req.method === 'GET' && url === '/logout') {
         const sid = accounts.getSessionId(req);
         if (sid) accounts.deleteSession(sid);
         res.writeHead(302, {
             Location: '/login',
             'Set-Cookie': [
                 accounts.setCookieHeader('nki_session', '', { maxAge: 0, sameSite: 'Strict' }),
                 accounts.setCookieHeader('nki_csrf', '', { maxAge: 0, sameSite: 'Strict' }),
             ],
         });
         return res.end();
     }

    // ── PUBLIC NEWSLETTER ─────────────────────────────────
    if (req.method === 'POST' && url === '/newsletter') {
        // Rate limit check
        if (enforceRateLimit(req, res, '/newsletter', { json: true })) return;

        try {
            const body = await readRawBody(req, 16 * 1024);
            const { email } = JSON.parse(body.toString());
            if (!email || !email.includes('@')) {
                return sendJson(res, { error: 'Invalid email' }, 400);
            }

            // Use database instead of JSON file
            const result = await contentDB.InsertSubscriber(email, 'website');
            if (!result.success) {
                return sendJson(res, { error: result.error }, 500);
            }

            // Fire-and-forget call to external provider.
            // We do not await this to ensure the user gets an immediate response
            // and doesn't suffer latency from 3rd party API calls.
            // Internal try/catch and timeout in subscribeToProvider handle errors.
            subscribeToProvider(email, 'website').catch(err =>
                console.error('[Newsletter] Critical failure in provider call:', err)
            );

            return sendJson(res, { ok: true });
        } catch (e) {
            return sendText(res, e.message, 500);
        }
    }

    // ── PUBLIC HOMEPAGE SETTINGS API ──────────────────────
    // Get homepage settings (public, no auth required)
    if (req.method === 'GET' && url === '/api/homepage') {
        try {
            const settings = await contentDB.SelectHomepageSettings();
            return sendJson(res, settings, 200);
        } catch (e) {
            return sendJson(res, { error: e.message }, 500);
        }
    }

    // Get Xanrean panel settings (public, no auth required)
    if (req.method === 'GET' && url === '/api/xanrean') {
        try {
            const settings = await contentDB.SelectXanreanSettings();
            // Public endpoint must never leak the Gumroad access token; it is
            // only ever returned to admins via /api/settings.
            const { gumroad_access_token, ...publicSettings } = settings;
            return sendJson(res, publicSettings, 200);
        } catch (e) {
            return sendJson(res, { error: e.message }, 500);
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
            return redirect(res, '/login?next=' + encodeURIComponent(req.url));
        }
        return sendText(res, 'Unauthorized', 401);
    }

    // ── CSRF GATE ─────────────────────────────────────────
    // Double-submit cookie check for state-changing requests. The session
    // cookie is HttpOnly and SameSite=Strict, but this adds defense-in-depth
    // against CSRF from same-site subdomains / CORS misconfiguration.
    if ((req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT') && url !== '/webhook/gumroad') {
        const sid = accounts.getSessionId(req);
        const csrfHeader = req.headers['x-csrf-token'];
        if (!accounts.isValidCsrfToken(sid, csrfHeader)) {
            return sendJson(res, { error: 'Invalid or missing CSRF token' }, 403);
        }
    }

    // ── AUTHENTICATED ROUTES ──────────────────────────────
    const username = accounts.getUsername(req);

    // Admin Character API
// ── ADMIN CONTENT CRUD ────────────────────────────────────
// Characters, timeline events, and lore topics are the same shape: an upsert
// that validates a couple of fields, a delete by id, and one list/detail GET
// that hides invisible rows from non-admins. The three blocks used to be
// near-identical copies; this table is the shared version of all of them.
//
// `validate(data)` returns an error string to reject the payload, or null to
// accept. `validateSlug` is the markup-safety check (slugs end up in URLs and
// inline page scripts, so they must stay URL-safe).
const ADMIN_CONTENT_TYPES = {
    characters: {
        base: '/api/characters',
        insert: data => contentDB.InsertCharacter(data),
        remove: id => contentDB.DeleteCharacter(id),
        validate: data => (!data.name || !data.slug ? 'Name and slug are required' : null),
        validateSlug: () => 'Invalid character slug'
    },
    timeline: {
        base: '/api/timeline',
        insert: data => contentDB.InsertTimelineEvent(data.id ? data : { ...data, id: crypto.randomUUID() }),
        remove: id => contentDB.DeleteTimelineEvent(id),
        validate: data => (data.title ? null : 'Title is required')
    },
    'lore-topics': {
        base: '/api/lore-topics',
        insert: data => contentDB.InsertLoreTopic(data),
        remove: id => contentDB.DeleteLoreTopic(id),
        validate: data => (!data.title || !data.slug || !data.section
            ? 'Title, slug, and section are required' : null),
        validateSlug: () => 'Invalid lore slug'
    }
};

const ADMIN_CONTENT_MATCHERS = Object.values(ADMIN_CONTENT_TYPES).map(type => ({
    type,
    // Exact base URL, an /appearances sub-resource, or a single-entity id.
    exact: new RegExp(`^${type.base}$`),
    appearances: new RegExp(`^${type.base}/([^/]+)/appearances$`),
    byId: new RegExp(`^${type.base}/([^/]+)$`)
}));

function matchAdminContent(url) {
    for (const matcher of ADMIN_CONTENT_MATCHERS) {
        if (matcher.exact.test(url)) return { type: matcher.type };
        const byId = url.match(matcher.byId);
        if (byId) return { type: matcher.type, id: byId[1] };
        if (matcher.appearances.test(url)) {
            return { type: matcher.type, id: url.split('/')[3], appearances: true };
        }
    }
    return null;
}

// Admin view of characters / timeline / lore topics. `id` is null for a
// collection request, set for a single entity or its /appearances sub-resource.
async function handleAdminContent(req, res, match) {
    const { type, id, appearances } = match;
    const isList = id === undefined;

    // Characters expose a per-character appearances editor.
    if (appearances && req.method === 'POST') {
        const { appearances: rows } = await readJsonBody(req, 64 * 1024);
        return sendJson(res, await contentDB.ReplaceCharacterAppearances(id, rows || []));
    }

    if (req.method === 'POST' || req.method === 'PUT') {
        const data = await readJsonBody(req, 10 * 1024 * 1024);
        const problem = type.validate(data);
        if (problem) return sendJson(res, { error: problem }, 400);
        if (type.validateSlug && !/^[a-z0-9_-]+$/.test(String(data.slug))) {
            return sendJson(res, { error: type.validateSlug() }, 400);
        }
        return sendJson(res, await type.insert(data));
    }

    if (req.method === 'DELETE' && !isList) {
        return sendJson(res, await type.remove(id));
    }

    return isList ? undefined : sendJson(res, { error: 'Method not allowed' }, 405);
}



    // Admin Character / Timeline / Lore API (auth already enforced above).
    // The public GET side is served before the auth gate; everything that
    // reaches here is an admin-gated write or a single-entity read.
    const contentMatch = matchAdminContent(url);
    if (contentMatch) {
        if (!accounts.isAdmin(req)) return forbidden(res);
        try {
            const response = await handleAdminContent(req, res, contentMatch);
            if (response !== undefined) return response;
        } catch (err) {
            console.error(`Admin ${contentMatch.type.base} API error:`, err);
            return sendJson(res, { error: err.message }, 500);
        }
    }

    // API Keys (read / write) - kept for potential future use
    if (url === '/api/keys') {
        if (req.method === 'GET') {
            return sendJson(res, accounts.getUserKeys(username), 200);
        }
        if (req.method === 'POST') {
            try {
                const body = await readRawBody(req, 16 * 1024);
                const data = JSON.parse(body.toString('utf8'));
                for (const [provider, key] of Object.entries(data)) {
                    if (!accounts.setUserKey(username, provider, key || '')) {
                        return sendJson(res, { error: 'Failed to persist API key' }, 500);
                    }
                }
                return sendJson(res, { ok: true });
            } catch (e) { return sendText(res, e.message, 400); }
        }
    }

    // Admin Integrations Settings API (auth already enforced by the gate above)
    if (url === '/api/settings') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        if (req.method === 'GET') {
            try {
                const settings = await contentDB.SelectXanreanSettings();
                return sendJson(res, {
                    gumroad_seller_id: settings.gumroad_seller_id,
                    gumroad_access_token: settings.gumroad_access_token,
                    youtube_channel_id: settings.youtube_channel_id,
                    discord_server_id: settings.discord_server_id,
                    discord_invite_code: settings.discord_invite_code
                }, 200);
            } catch (e) {
                return sendJson(res, { error: e.message }, 500);
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
                return sendJson(res, { ok: true }, 200);
            } catch (e) {
                return sendJson(res, { error: e.message }, 400);
            }
        }
    }

    // Admin page (admin only)
    if (req.method === 'GET' && (url === '/admin' || url === '/dashboard')) {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        return serveFile(res, ADMIN_FILE);
    }

    // Update book sequence (admin only)
    if (req.method === 'POST' && url === '/api/books/reorder') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        try {
            const body = await readRawBody(req, 64 * 1024);
            const { seriesId, bookIds } = JSON.parse(body.toString());
            if (!Array.isArray(bookIds)) {
                return sendJson(res, { error: 'bookIds must be an array' }, 400);
            }
            const result = await contentDB.UpdateBookSequence(seriesId || null, bookIds);
            return sendJson(res, result, 200);
        } catch (e) {
            return sendJson(res, { error: e.message }, 500);
        }
    }

    // Update game sequence (admin only)
    if (req.method === 'POST' && url === '/api/games/reorder') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        try {
            const body = await readRawBody(req, 64 * 1024);
            const { gameIds } = JSON.parse(body.toString());
            if (!Array.isArray(gameIds)) {
                return sendJson(res, { error: 'gameIds must be an array' }, 400);
            }
            const result = await contentDB.ReorderGames(gameIds);
            return sendJson(res, result, 200);
        } catch (e) {
            return sendJson(res, { error: e.message }, 500);
        }
    }

    // Save site content (admin only) - now to database
    if (req.method === 'POST' && url === '/save-content') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        try {
            const body = await readRawBody(req, 10 * 1024 * 1024);
            const data = JSON.parse(body.toString());

            // Validate book slugs: lowercase, numbers, hyphens, underscores only.
            if (data.books && Array.isArray(data.books)) {
                for (const book of data.books) {
                    const slug = book.slug || book.id;
                    if (!/^[a-z0-9_-]+$/.test(slug)) {
                        return sendJson(res, {
                            error: `Invalid slug for book "${book.title || 'Unknown'}": "${slug}". Slugs must be lowercase, numbers, hyphens, or underscores.`
                        }, 400);
                    }
                }
            }

            // Required field enforcement to prevent DB NOT NULL constraint violations.
            if (data.books && Array.isArray(data.books)) {
                for (const book of data.books) {
                    if (!book.title) {
                        return sendJson(res, { error: `Book (ID: ${book.id}) is missing a title.` }, 400);
                    }
                }
            }
            if (data.series && Array.isArray(data.series)) {
                for (const s of data.series) {
                    if (!s.name && !s.universe) {
                        return sendJson(res, { error: `Series (ID: ${s.id}) is missing a name.` }, 400);
                    }
                }
            }
            if (data.game) {
                const games = Array.isArray(data.game) ? data.game : [data.game];
                for (const g of games) {
                    if (g && Object.keys(g).length > 0 && !g.title) {
                        return sendJson(res, { error: `Game is missing a title.` }, 400);
                    }
                }
            }
            if (data.about && Object.keys(data.about).length > 0) {
                if (!data.about.studio_name && !data.about.studioName) {
                    return sendJson(res, { error: `About page is missing the studio name.` }, 400);
                }
            }

            // Safety: backup the DB before any bulk replacement, then proceed.
            const restorePoint = await contentDB.CreateBackup('save-content');
            await contentDB.SaveAllContent(data);
            // Best-effort: keep sitemap.xml/rss.xml in sync with content changes.
            meta.generateAll().catch(err => console.error('Meta regeneration failed:', err));
            return sendJson(res, { ok: true });
        } catch (e) {
            console.error('Save content error:', e);
            let status = 500;
            if (e.code === 'EMPTY_CONTENT_GUARD' || e.code === 'DUPLICATE_SLUG') {
                status = 409;
            }
            return sendJson(res, { error: e.message }, status);
        }
    }

    // Cover image upload (admin only) with optimization
    if (req.method === 'POST' && url === '/upload-cover') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        try {
            const body = await readRawBody(req, 25 * 1024 * 1024);
            const ct = req.headers['content-type'] || '';
            const bm = ct.match(/boundary=([^\s;]+)/);
            if (!bm) { return sendText(res, 'No boundary', 400); }
            const parts = parseMultipart(body, bm[1]);
            const file = parts['cover'];
            if (!file || !file.data) { return sendText(res, 'No file', 400); }
            if (file.data.length === 0) { return sendText(res, 'Image file is empty', 400); }
            if (file.data.length > 20 * 1024 * 1024) { return sendText(res, 'Image too large (max 20MB)', 413); }

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

            return sendJson(res, {
                path: `/covers/${fname}`,
                originalSize: file.data.length,
                optimized: true
            }, 200);
        } catch (e) {
            const isSharpError = e.message && (e.message.includes('unsupported image format') || e.message.includes('Input buffer contains insufficient pixel data'));
            res.writeHead(isSharpError ? 400 : 500, { 'Content-Type': 'text/plain' });
            return res.end(isSharpError ? `Invalid image file: ${e.message}` : e.message);
        }
    }

    // ── BACKUP API ───────────────────────────────────────────
    // Create manual backup (admin only)
    if (req.method === 'POST' && url === '/api/backup') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        try {
            const backupPath = await backup.createBackup();
            const cleaned = backup.cleanupOldBackups();
            return sendJson(res, { ok: !!backupPath, cleaned }, 200);
        } catch (e) { return sendText(res, e.message, 500); }
    }

    // Get backup status (admin only)
    if (url === '/api/backup/status') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
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

            return sendJson(res, { backups: files, count: files.length }, 200);
        } catch (e) {
            return sendJson(res, { error: e.message }, 500);
        }
    }

    // ── HOMEPAGE SETTINGS API (POST - admin only) ─────────
    // Update homepage settings (admin only)
    if (req.method === 'POST' && url === '/api/homepage') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        try {
            const body = await readRawBody(req, 64 * 1024);
            const data = JSON.parse(body.toString());
            await contentDB.UpdateHomepageSettings(data);
            const updated = await contentDB.SelectHomepageSettings();
            return sendJson(res, updated, 200);
        } catch (e) {
            console.error('POST /api/homepage error:', e);
            return sendJson(res, { error: e.message }, 500);
        }
    }

    // ── XANREAN SETTINGS API ──────────────────────────────
    // Get xanrean settings (public)

    // Update xanrean settings (admin only)
    if (req.method === 'POST' && url === '/api/xanrean') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        try {
            const body = await readRawBody(req, 64 * 1024);
            const data = JSON.parse(body.toString());
            await contentDB.UpdateXanreanSettings(data);
            const updated = await contentDB.SelectXanreanSettings();
            return sendJson(res, updated, 200);
        } catch (e) {
            console.error('POST /api/xanrean error:', e);
            return sendJson(res, { error: e.message }, 500);
        }
    }

    // ── USER MANAGEMENT API ───────────────────────────────
    // List all users (admin only)
    if (req.method === 'GET' && url === '/api/users') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }

        // Rate limit check
        if (enforceRateLimit(req, res, '/api/users', { json: true })) return;

        try {
            const users = accounts.listAllUsers();
            return sendJson(res, users, 200);
        } catch (e) { return sendText(res, e.message, 500); }
    }

    // Create new user (admin only)
    if (req.method === 'POST' && url === '/api/users') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }

        // Rate limit check
        if (enforceRateLimit(req, res, '/api/users', { json: true })) return;

        try {
            const body = await readRawBody(req, 16 * 1024);
            const { username, password, role } = JSON.parse(body.toString());
            if (!username || !password) { return sendText(res, 'Missing username or password', 400); }
            if (!/^[a-z0-9_]{3,32}$/.test(String(username).trim().toLowerCase())) {
                return sendText(res, 'Username must be 3-32 characters: letters, numbers, underscores', 400);
            }
            if (password.length < 8) { return sendText(res, 'Password must be at least 8 characters', 400); }
            if (role && !['admin', 'user'].includes(role)) { return sendText(res, 'Invalid role', 400); }
            const success = accounts.createUser(username, password, role || 'user');
            if (!success) { return sendText(res, 'Username already exists', 409); }
            return sendJson(res, { ok: true, username }, 201);
        } catch (e) { return sendText(res, e.message, 500); }
    }

    // Delete user (admin only)
    if (req.method === 'DELETE' && url.startsWith('/api/users/')) {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        try {
            const username = decodeURIComponent(url.slice(11)); // Remove '/api/users/'
            if (!username) { return sendText(res, 'Missing username', 400); }
            if (accounts.isLastAdmin(username)) {
                return sendJson(res, { error: 'Cannot delete the last remaining admin account.' }, 400);
            }
            const success = accounts.deleteUser(username);
            if (!success) { return sendText(res, 'User not found', 404); }
            return sendJson(res, { ok: true }, 200);
        } catch (e) { return sendText(res, e.message, 500); }
    }

    // Reset user password (admin only)
    if (req.method === 'POST' && url.match(/^\/api\/users\/[^\/]+\/reset-password$/)) {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        try {
            const username = decodeURIComponent(url.match(/^\/api\/users\/([^\/]+)/)[1]);
            const body = await readRawBody(req, 16 * 1024);
            const { password } = JSON.parse(body.toString());
            if (!password) { return sendText(res, 'Missing new password', 400); }
            if (password.length < 8) { return sendText(res, 'Password must be at least 8 characters', 400); }
            const success = accounts.resetPassword(username, password);
            if (!success) { return sendText(res, 'User not found', 404); }
            return sendJson(res, { ok: true }, 200);
        } catch (e) { return sendText(res, e.message, 500); }
    }

    // Change user role (admin only)
    if (req.method === 'POST' && url.match(/^\/api\/users\/[^\/]+\/role$/)) {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        try {
            const username = decodeURIComponent(url.match(/^\/api\/users\/([^\/]+)/)[1]);
            const body = await readRawBody(req, 16 * 1024);
            const { role } = JSON.parse(body.toString());
            if (!role || !['admin', 'user'].includes(role)) { return sendText(res, 'Invalid role', 400); }
            if (role !== 'admin' && accounts.isLastAdmin(username)) {
                return sendJson(res, { error: 'Cannot demote the last remaining admin account.' }, 400);
            }
            const success = accounts.setUserRole(username, role);
            if (!success) { return sendText(res, 'User not found', 404); }
            return sendJson(res, { ok: true }, 200);
        } catch (e) { return sendText(res, e.message, 500); }
    }

    // ── PUBLISHING CALENDAR (ADMIN) ───────────────────────
    // Admin-only. The page is served at /admin/publishing-calendar and the API
    // lives under /api/admin/publishing-calendar. The auth gate above redirects
    // unauthenticated requests to login; these require an admin role. POST and
    // DELETE are additionally protected by the CSRF gate that runs earlier.

    // Admin calendar page (admin only)
    if (req.method === 'GET' && url === '/admin/publishing-calendar') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        return serveFile(res, path.join(PUBLIC_DIR, 'publishing-calendar-admin.html'));
    }

    // Admin calendar API (admin only)
    if (url.startsWith('/api/admin/publishing-calendar')) {
        if (!accounts.isAdmin(req)) {
            return sendJson(res, { error: 'Forbidden' }, 403);
        }
        return handleAdminPublishingCalendar(req, res, url);
    }

    // ── PUBLISHING DASHBOARD ───────────────────────────────
    // Admin-only. The page is served at /admin/publishing and the read-only
    // API lives under /api/publishing/*. Unauthenticated browser requests are
    // redirected to login by the auth gate above; non-admins get 403 here.

    // Admin page (admin only)
    if (req.method === 'GET' && url === '/admin/publishing') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        return serveFile(res, path.join(PUBLIC_DIR, 'publishing', 'index.html'));
    }

    // Publishing API (admin only)
    if (url.startsWith('/api/publishing')) {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        if (req.method !== 'GET') { return sendText(res, 'Method Not Allowed', 405); }

        try {
            const db = getPublishingDB();
            const send = (data) => {
                return sendJson(res, data, 200);
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
                    return sendJson(res, { error: 'startUtc and endUtc are required' }, 400);
                }
                const releases = await db.releaseWindow({
                    startUtc,
                    endUtc,
                    status: query.get('status') || undefined,
                    limit: parseInt(query.get('limit') || '500', 10),
                });
                return send({ releases });
            }

            return sendText(res, 'Not found', 404);
        } catch (err) {
            console.error('Publishing API error:', err);
            return sendJson(res, { error: err.message }, 500);
        }
    }

    // ── 404 ────────────────────────────────────────────────
    return notFound(res);
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
