#!/usr/bin/env node
/**
 * Nekojin Interactive - Server
 * - Public site at /  (served from ./public/)
 * - Admin panel at /admin  (login required)
 * - AI Chat at /aichat.html and /chat WS (login required, persistent per-user)
 * - /content        GET   → site-content.json (public, for dynamic pages)
 * - /save-content   POST  → write site-content.json (auth required)
 * - /upload-cover   POST  → save image to public/covers/ (auth required)
 * - /data /scrape /events → scraper API (auth required)
 */

const http        = require('http');
const fs          = require('fs');
const path        = require('path');
const bcrypt      = require('bcryptjs');
const crypto      = require('crypto');
const { spawn }   = require('child_process');
const WebSocket   = require('ws');
const os          = require('os');
const https       = require('https');
const httpReq     = require('http');
const mammoth     = require('mammoth');

// ── CONFIG ────────────────────────────────────────────────
const SESSION_TTL    = 1000 * 60 * 60 * 24 * 7; // 7 days
const PI_GRACE_MS    = 1000 * 60 * 5; // 5 minutes
const SALT_ROUNDS    = 10;

const PORT           = 7771;
const METRICS_FILE   = path.join(__dirname, 'story-metrics.json');
const SCRAPER_FILE   = path.join(__dirname, 'BookStatScraper.js');
const CONTENT_FILE   = path.join(__dirname, 'site-content.json');
const ADMIN_FILE     = path.join(__dirname, 'admin.html');
const PUBLIC_DIR     = path.join(__dirname, 'public');
const COVERS_DIR     = path.join(PUBLIC_DIR, 'covers');
const NEWSLETTER_FILE = path.join(__dirname, 'newsletter-subscribers.json');
const WEBCHAT_ROOT   = path.join(os.homedir(), '.pi', 'agent', 'webchat-sessions');
const USERS_FILE     = path.join(__dirname, 'users.json');
const USER_KEYS_FILE = path.join(__dirname, 'user-keys.json');
const MANUSCRIPTS_DIR = path.join(__dirname, 'manuscripts');

if (!fs.existsSync(MANUSCRIPTS_DIR)) fs.mkdirSync(MANUSCRIPTS_DIR, { recursive: true });

if (!fs.existsSync(WEBCHAT_ROOT)) fs.mkdirSync(WEBCHAT_ROOT, { recursive: true });

let scrapeRunning = false;
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });

// ── HTTP SESSIONS ─────────────────────────────────────────
const sessions = new Map(); // sessionId → { createdAt, username }
function createSession(username) {
    const id = crypto.randomBytes(32).toString('hex');
    sessions.set(id, { createdAt: Date.now(), username });
    return id;
}
function isValidSession(id) {
    const s = sessions.get(id);
    if (!s) return false;
    if (Date.now() - s.createdAt > SESSION_TTL) { sessions.delete(id); return false; }
    return true;
}
function getSessionUser(id) {
    const s = sessions.get(id);
    return s ? s.username : null;
}
function deleteSession(id) { sessions.delete(id); }

// ── USER DATABASE ───────────────────────────────────────
function loadUsers() {
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
    catch { return { users: {} }; }
}
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    try { fs.chmodSync(USERS_FILE, 0o600); } catch {}
}
function findUser(username) {
    const db = loadUsers();
    return db.users[username] || null;
}
function createUser(username, password) {
    const db = loadUsers();
    if (db.users[username]) return false;
    db.users[username] = { passwordHash: bcrypt.hashSync(password, SALT_ROUNDS), role: 'user', createdAt: Date.now() };
    saveUsers(db);
    return true;
}
function verifyUser(username, password) {
    const user = findUser(username);
    if (!user) return false;
    return bcrypt.compareSync(password, user.passwordHash);
}
function getUserRole(req) {
    const username = getUsername(req);
    if (!username) return null;
    const user = findUser(username);
    return user ? (user.role || 'user') : null;
}
function isAdmin(req) {
    return getUserRole(req) === 'admin';
}
// Auto-create admin on first boot + migrate existing users
function ensureAdminUser() {
    const db = loadUsers();
    let migrated = false;
    for (const [name, u] of Object.entries(db.users)) {
        if (!u.role) { u.role = (name === 'xanmal') ? 'admin' : 'user'; migrated = true; }
    }
    if (!db.users['xanmal']) {
        db.users['xanmal'] = { passwordHash: bcrypt.hashSync('nekojin2026', SALT_ROUNDS), role: 'admin', createdAt: Date.now() };
        migrated = true;
        console.log('Created default admin user: xanmal');
    }
    if (migrated) saveUsers(db);
}
ensureAdminUser();

// ── USER KEYS ───────────────────────────────────────────
function loadUserKeys() {
    try { return JSON.parse(fs.readFileSync(USER_KEYS_FILE, 'utf8')); }
    catch { return {}; }
}
function saveUserKeys(data) {
    fs.writeFileSync(USER_KEYS_FILE, JSON.stringify(data, null, 2));
    try { fs.chmodSync(USER_KEYS_FILE, 0o600); } catch {}
}
function getUserKeys(username) {
    const all = loadUserKeys();
    return all[username] || {};
}
function setUserKey(username, provider, key) {
    const all = loadUserKeys();
    if (!all[username]) all[username] = {};
    all[username][provider] = key;
    saveUserKeys(all);
}

// ── MANUSCRIPT PARSING (.docx → chapters) ───────────────
const MANUSCRIPT_CACHE = new Map(); // slug → {mtime, chapters}

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
    // Any h1/h2/h3 can be a chapter boundary if we have enough text between them
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
            // Very little text before first non-chapter heading — skip it as front matter
            lastIndex = match.index + match[0].length;
            continue;
        }

        if (chapters.length > 0) {
            chapters[chapters.length - 1].content = html.slice(lastIndex, match.index);
        }
        chapterNum++;
        chapters.push({
            num: chapterNum,
            title: headingText,
            content: ''
        });
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
            .filter(f => f.endsWith('.docx'))
            .map(f => f.replace(/\.docx$/i, ''));
    } catch { return []; }
}

function listManuscripts() {
    try {
        return fs.readdirSync(MANUSCRIPTS_DIR)
            .filter(f => f.endsWith('.docx') || f.endsWith('.epub'))
            .map(f => f.replace(/\.(docx|epub)$/i, ''));
    } catch { return []; }
}

function parseCookies(h) {
    const c = {};
    if (!h) return c;
    h.split(';').forEach(p => {
        const [k, ...v] = p.trim().split('=');
        if (k) c[k.trim()] = decodeURIComponent(v.join('=').trim());
    });
    return c;
}
function getSessionId(req) { return parseCookies(req.headers['cookie'])['nki_session'] || null; }
function isAuthenticated(req) { const sid = getSessionId(req); return sid && isValidSession(sid); }
function getUsername(req) { const sid = getSessionId(req); return getSessionUser(sid); }

// ── BODY ──────────────────────────────────────────────────
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
        if (k) p[decodeURIComponent(k)] = decodeURIComponent((v||'').replace(/\+/g,' '));
    });
    return p;
}

// ── MULTIPART (cover uploads) ─────────────────────────────
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
        const body    = part.slice(hEnd + 4);
        const nm = headers.match(/name="([^"]+)"/);
        const fm = headers.match(/filename="([^"]+)"/);
        if (!nm) continue;
        results[nm[1]] = fm ? { filename: fm[1], data: body } : body.toString().trim();
        start = end;
    }
    return results;
}

// ── MIME ──────────────────────────────────────────────────
const MIME = {
    '.html':'text/html', '.css':'text/css', '.js':'application/javascript',
    '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
    '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon',
    '.woff2':'font/woff2', '.webp':'image/webp',
};
function serveFile(res, filePath) {
    try {
        const data = fs.readFileSync(filePath);
        const ext  = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
}

// ── LOGIN PAGE ────────────────────────────────────────────
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
      <input type="hidden" name="next" value="${safeNext.replace(/"/g,'&quot;')}">
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
    '/':                      path.join(PUBLIC_DIR, 'index.html'),
    '/books':                 path.join(PUBLIC_DIR, 'books.html'),
    '/book':                  path.join(PUBLIC_DIR, 'book.html'),
    '/read':                  path.join(PUBLIC_DIR, 'read.html'),
    '/games':                 path.join(PUBLIC_DIR, 'games.html'),
    '/about':                 path.join(PUBLIC_DIR, 'about.html'),
    '/action_registry.html':  path.join(PUBLIC_DIR, 'action_registry.html'),
};

// ── CHAT SESSION MANAGEMENT ─────────────────────────────
function getUserDir(username) {
    return path.join(WEBCHAT_ROOT, username);
}

function ensureUserDir(username) {
    const dir = getUserDir(username);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getMetaFile(username) {
    return path.join(getUserDir(username), '.meta.json');
}

function getSystemPromptFile(username) {
    return path.join(getUserDir(username), '.system-prompt.txt');
}

function getDefaultSystemPrompt(username) {
    return `You are the AI assistant for ${username} on the Nekojin Interactive site (aichat.worldofxanrea.com). You operate inside the Nekojin workspace at /home/xanmal. You are NOT "pi", "π", a "coding agent", or a "sidekick". Pi is merely the chat harness - you are the actual LLM model currently running. When asked who you are, state your model name directly.

Workspace & projects:
- Godot RPG with soul mechanics, pets, skills, and progression.
- Nekojin Interactive website and tools.
- Indie game dev, writing, and creative coding.

Tool capabilities:
- read: View file contents (text, images).
- edit: Make precise text replacements in files.
- write: Create new files entirely.
- bash: Execute shell commands on the local machine.
- web_search: Search the web for real-time info.
- web_fetch: Fetch and read web pages.

When editing code, always read the relevant file first, then apply precise changes. Show diffs or clearly mark edits.

Image generation is available via xAI Grok models (grok-imagine-image, grok-imagine-image-pro, grok-imagine-video). Grok 4.x models support vision - they can see images attached to prompts. Ollama is local, free, and supports vision in fresh chats.

Tone: warm, direct, creative, occasionally witty. You are conversational, not robotic. Skip filler intros. When the user pastes code or uploads files, jump straight into analysis, fixes, or features. Get to the point.`;
}

function getSystemPrompt(username) {
    const file = getSystemPromptFile(username);
    if (fs.existsSync(file)) {
        try {
            const text = fs.readFileSync(file, 'utf8');
            if (text.trim().length > 0) return text;
        } catch {}
    }
    return null;
}

function saveSystemPrompt(username, prompt) {
    ensureUserDir(username);
    fs.writeFileSync(getSystemPromptFile(username), prompt);
}

function loadMeta(username) {
    const p = getMetaFile(username);
    if (fs.existsSync(p)) {
        try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    }
    return { sessions: {} };
}

function saveMeta(username, meta) {
    fs.writeFileSync(getMetaFile(username), JSON.stringify(meta, null, 2));
}

function migrateLegacySession(username) {
    const legacy = path.join(WEBCHAT_ROOT, `${username}.jsonl`);
    const dir = ensureUserDir(username);
    const migrated = path.join(dir, 'default.jsonl');
    if (fs.existsSync(legacy) && !fs.existsSync(migrated)) {
        fs.renameSync(legacy, migrated);
        const meta = loadMeta(username);
        meta.sessions['default'] = { name: 'Chat 1', createdAt: Date.now() };
        saveMeta(username, meta);
    }
}

function listUserSessions(username) {
    migrateLegacySession(username);
    const dir = getUserDir(username);
    if (!fs.existsSync(dir)) return [];
    const meta = loadMeta(username);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    return files.map(f => {
        const id = f.slice(0, -6); // remove .jsonl
        const m = meta.sessions[id] || {};
        const stat = fs.statSync(path.join(dir, f));
        let title = m.name;
        if (!title) {
            // Try to extract first user message
            try {
                const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean);
                for (const line of lines) {
                    const entry = JSON.parse(line);
                    if (entry.type === 'message' && entry.message?.role === 'user') {
                        const text = extractTextFromContent(entry.message.content);
                        title = text.length > 40 ? text.slice(0, 40) + '…' : text;
                        break;
                    }
                }
            } catch {}
        }
        if (!title) title = 'New Chat';
        return { id, name: title, updatedAt: stat.mtimeMs, createdAt: m.createdAt || stat.birthtimeMs };
    }).sort((a, b) => b.updatedAt - a.updatedAt);
}

function extractTextFromContent(content) {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.filter(b => b.type === 'text').map(b => b.text).join('');
    }
    return String(content);
}

function getNextSessionId(username) {
    const dir = getUserDir(username);
    const existing = new Set(fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6)));
    let n = 1;
    while (existing.has(`chat-${n}`)) n++;
    return `chat-${n}`;
}

// ── WEBCHAT - PER-USER PERSISTENT PI SESSIONS ───────────
const userSessions = new Map(); // username → UserSession

function killUserSession(username) {
    const s = userSessions.get(username);
    if (!s) return;
    if (s.graceTimer) { clearTimeout(s.graceTimer); s.graceTimer = null; }
    try { s.piProc.stdin.end(); } catch {}
    try { s.piProc.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { s.piProc.kill('SIGKILL'); } catch {} }, 3000);
    for (const ws of s.websockets) { try { ws.close(); } catch {} }
    userSessions.delete(username);
}

function broadcastToUser(username, line) {
    const s = userSessions.get(username);
    if (!s) return false;
    let sent = false;
    for (const ws of s.websockets) {
        if (ws.readyState === 1) { ws.send(line); sent = true; }
    }
    return sent;
}

function sendToWS(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function spawnUserPi(username, sessionFile) {
    const exists = fs.existsSync(sessionFile);

    const customPrompt = getSystemPrompt(username);
    const systemPrompt = customPrompt !== null ? customPrompt.trim() : getDefaultSystemPrompt(username);

    const piProc = spawn('/home/xanmal/.npm-global/bin/pi', [
        '--mode', 'rpc',
        '--session', sessionFile,
        '--system-prompt',
        systemPrompt,
    ], {
        cwd: process.cwd(),
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session = {
        piProc,
        websockets: new Set(),
        stdoutBuf: '',
        requestCounter: 0,
        pendingRequests: new Map(), // id → ws
        pendingSwitches: new Map(), // id → { ws, targetSessionId }
        graceTimer: null,
        currentSessionFile: sessionFile,
    };

    piProc.stdout.on('data', (chunk) => {
        session.stdoutBuf += chunk;
        let idx;
        while ((idx = session.stdoutBuf.indexOf('\n')) !== -1) {
            let line = session.stdoutBuf.slice(0, idx);
            session.stdoutBuf = session.stdoutBuf.slice(idx + 1);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (!line.trim()) continue;

            try {
                const data = JSON.parse(line);

                // Route switch_session responses
                if (data.type === 'response' && data.id && session.pendingSwitches.has(data.id)) {
                    const sw = session.pendingSwitches.get(data.id);
                    session.pendingSwitches.delete(data.id);
                    if (sw.ws.readyState === 1) sw.ws.send(line);
                    if (data.success && data.data && !data.data.cancelled) {
                        session.currentSessionFile = sw.targetSessionFile;
                        // Now request messages from the new session
                        const reqId = `msgs-${Date.now()}-${++session.requestCounter}`;
                        session.pendingRequests.set(reqId, sw.ws);
                        session.piProc.stdin.write(JSON.stringify({ type: 'get_messages', id: reqId }) + '\n');
                    }
                    continue;
                }

                // Route responses with IDs back to requesting WS only
                if (data.type === 'response' && data.id && session.pendingRequests.has(data.id)) {
                    const targetWs = session.pendingRequests.get(data.id);
                    session.pendingRequests.delete(data.id);
                    if (targetWs.readyState === 1) {
                        // Filter model list: hide old Grok versions (grok-2, grok-3, grok-beta, etc.)
                        if (data.command === 'get_available_models' && data.success && data.data && data.data.models) {
                            data.data.models = data.data.models.filter(m => {
                                if (m.provider === 'ollama') return true;
                                if (m.provider === 'xai') {
                                    const id = m.id;
                                    if (id.startsWith('grok-2')) return false;
                                    if (id.startsWith('grok-3')) return false;
                                    if (id === 'grok-beta') return false;
                                    if (id === 'grok-vision-beta') return false;
                                    if (id.startsWith('grok-code')) return false;
                                    return true; // keep grok-4.x and future versions
                                }
                                return true;
                            });
                            targetWs.send(JSON.stringify(data));
                        } else {
                            targetWs.send(line);
                        }
                    }

                    // After get_messages, broadcast history to ALL clients
                    if (data.command === 'get_messages' && data.success && data.data && data.data.messages) {
                        const history = simplifyMessages(data.data.messages);
                        for (const ws of session.websockets) {
                            if (ws.readyState === 1) {
                                ws.send(JSON.stringify({ type: 'history', messages: history, fresh: history.length === 0 }));
                            }
                        }
                    }
                    continue;
                }

                // Broadcast events to all connected clients
                broadcastToUser(username, line);
            } catch {
                broadcastToUser(username, line);
            }
        }
    });

    piProc.stderr.on('data', (chunk) => {
        const text = String(chunk).trim();
        if (text) broadcastToUser(username, JSON.stringify({ type: 'response', command: 'stderr', success: false, error: text }));
    });

    piProc.on('close', () => {
        broadcastToUser(username, JSON.stringify({ type: 'response', command: 'exit', success: true }));
        killUserSession(username);
    });

    piProc.on('error', (err) => {
        broadcastToUser(username, JSON.stringify({ type: 'response', command: 'spawn', success: false, error: err.message }));
        killUserSession(username);
    });

    userSessions.set(username, session);
    return session;
}

function simplifyMessages(agentMessages) {
    const result = [];
    for (const msg of agentMessages) {
        if (msg.role === 'user') {
            result.push({ role: 'user', content: extractTextFromContent(msg.content) });
        } else if (msg.role === 'assistant') {
            let text = '';
            let tools = [];
            for (const block of (msg.content || [])) {
                if (block.type === 'text') text += block.text;
                else if (block.type === 'thinking') { /* skip thinking blocks */ }
                else if (block.type === 'toolCall') tools.push({ name: block.name, args: block.arguments });
            }
            if (text.trim()) result.push({ role: 'assistant', content: text.trim() });
            for (const t of tools) result.push({ role: 'tool', toolName: t.name, content: '…', isError: false });
        } else if (msg.role === 'toolResult') {
            const text = extractTextFromContent(msg.content);
            result.push({ role: 'tool', toolName: msg.toolName, content: text, isError: !!msg.isError });
        } else if (msg.role === 'bashExecution') {
            result.push({ role: 'tool', toolName: 'bash', content: msg.output || '', isError: (msg.exitCode || 0) !== 0 });
        }
    }
    return result;
}

function getOrCreateUserSession(username) {
    const existing = userSessions.get(username);
    if (existing) {
        if (existing.piProc && !existing.piProc.killed) {
            if (existing.graceTimer) { clearTimeout(existing.graceTimer); existing.graceTimer = null; }
            return existing;
        }
        userSessions.delete(username);
    }
    // Default to latest session or create default
    migrateLegacySession(username);
    const sessions = listUserSessions(username);
    const sessionId = sessions[0]?.id || 'default';
    const sessionFile = path.join(getUserDir(username), `${sessionId}.jsonl`);
    return spawnUserPi(username, sessionFile);
}

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
    if (req.method === 'GET' && url !== '/aichat.html' && (
        url.endsWith('.html') || url.endsWith('.css') || url.endsWith('.js') ||
        url.endsWith('.xml') || url.endsWith('.txt') || url.endsWith('.json') ||
        url.startsWith('/covers/') || url.startsWith('/assets/') ||
        url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg') ||
        url.endsWith('.ico') || url.endsWith('.svg') || url.endsWith('.webp')
    )) return serveFile(res, path.join(PUBLIC_DIR, url));

    // Public content API
    if (req.method === 'GET' && url === '/content') {
        try { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(fs.readFileSync(CONTENT_FILE, 'utf8')); }
        catch { res.writeHead(500); return res.end('{}'); }
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

    // Login
    if (req.method === 'GET' && url === '/login') {
        if (isAuthenticated(req)) {
            const target = isAdmin(req) ? '/admin' : '/aichat.html';
            res.writeHead(302,{Location:target}); return res.end();
        }
        res.writeHead(200,{'Content-Type':'text/html'});
        return res.end(loginPage(query.get('next') || '/admin'));
    }
    if (req.method === 'POST' && url === '/login') {
        const body   = await readRawBody(req);
        const params = parseFormBody(body);
        if (verifyUser(params.username, params.password)) {
            const sid  = createSession(params.username);
            const isUserAdmin = findUser(params.username)?.role === 'admin';
            const next = (params.next && params.next.startsWith('/')) ? params.next : (isUserAdmin ? '/admin' : '/aichat.html');
            res.writeHead(302, {
                Location: next,
                'Set-Cookie': `nki_session=${sid}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL/1000}; Path=/`,
            });
            return res.end();
        }
        res.writeHead(200,{'Content-Type':'text/html'});
        return res.end(loginPage(params.next || '/admin', 'Incorrect username or password.'));
    }

    // Register page
    if (req.method === 'GET' && url === '/register') {
        res.writeHead(200,{'Content-Type':'text/html'});
        return res.end(registerPage());
    }

    // Register handler
    if (req.method === 'POST' && url === '/register') {
        const body   = await readRawBody(req);
        const params = parseFormBody(body);
        const username = (params.username || '').trim().toLowerCase();
        const password = params.password || '';
        const confirm  = params.confirm || '';
        if (!/^[a-z0-9_]{3,32}$/.test(username)) {
            res.writeHead(200,{'Content-Type':'text/html'});
            return res.end(registerPage('Username must be 3-32 characters: letters, numbers, underscores.'));
        }
        if (password.length < 6) {
            res.writeHead(200,{'Content-Type':'text/html'});
            return res.end(registerPage('Password must be at least 6 characters.'));
        }
        if (password !== confirm) {
            res.writeHead(200,{'Content-Type':'text/html'});
            return res.end(registerPage('Passwords do not match.'));
        }
        if (!createUser(username, password)) {
            res.writeHead(200,{'Content-Type':'text/html'});
            return res.end(registerPage('Username already taken.'));
        }
        res.writeHead(200,{'Content-Type':'text/html'});
        return res.end(registerPage('', 'Account created. You can now log in.'));
    }

    // API Keys (read / write)
    if (url === '/api/keys') {
        if (!isAuthenticated(req)) { res.writeHead(401, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Unauthorized'})); }
        const user = getUsername(req);
        if (req.method === 'GET') {
            res.writeHead(200, {'Content-Type':'application/json'});
            return res.end(JSON.stringify(getUserKeys(user)));
        }
        if (req.method === 'POST') {
            try {
                const body = await readRawBody(req);
                const data = JSON.parse(body.toString('utf8'));
                for (const [provider, key] of Object.entries(data)) {
                    setUserKey(user, provider, key || '');
                }
                res.writeHead(200, {'Content-Type':'application/json'});
                return res.end('{"ok":true}');
            } catch(e) { res.writeHead(400); return res.end(e.message); }
        }
    }

    // Logout
    if (req.method === 'GET' && url === '/logout') {
        const sid = getSessionId(req);
        if (sid) {
            const user = getSessionUser(sid);
            if (user) killUserSession(user);
            deleteSession(sid);
        }
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
            try { subs = JSON.parse(fs.readFileSync(NEWSLETTER_FILE, 'utf8')); } catch {}
            if (!subs.find(s => s.email === email)) {
                subs.push({ email, subscribedAt: Date.now() });
                fs.writeFileSync(NEWSLETTER_FILE, JSON.stringify(subs, null, 2));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}');
        } catch(e) { res.writeHead(500); return res.end(e.message); }
    }


    // ── AUTH GATE ─────────────────────────────────────────
    if (!isAuthenticated(req)) {
        if (req.method === 'GET') { res.writeHead(302,{Location:'/login?next='+encodeURIComponent(req.url)}); return res.end(); }
        res.writeHead(401); return res.end('Unauthorized');
    }

    const username = getUsername(req);

    // ── CHAT API ──────────────────────────────────────────
    if (url === '/chat-sessions' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ sessions: listUserSessions(username) }));
    }

    if (url === '/chat-session' && req.method === 'POST') {
        // Create new session
        const body = JSON.parse((await readRawBody(req)).toString() || '{}');
        const id = getNextSessionId(username);
        const name = body.name || 'New Chat';
        const dir = ensureUserDir(username);
        const sessionFile = path.join(dir, `${id}.jsonl`);
        fs.writeFileSync(sessionFile, '');
        const meta = loadMeta(username);
        meta.sessions[id] = { name, createdAt: Date.now() };
        saveMeta(username, meta);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id, name }));
    }

    if (url === '/chat-session/rename' && req.method === 'POST') {
        const body = JSON.parse((await readRawBody(req)).toString() || '{}');
        const meta = loadMeta(username);
        if (!meta.sessions[body.id]) meta.sessions[body.id] = {};
        meta.sessions[body.id].name = body.name;
        saveMeta(username, meta);
        // Also try to name in pi
        const session = userSessions.get(username);
        if (session && session.piProc && session.piProc.stdin.writable) {
            session.piProc.stdin.write(JSON.stringify({ type: 'set_session_name', name: body.name }) + '\n');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"ok":true}');
    }

    if (url === '/chat-session/delete' && req.method === 'POST') {
        const body = JSON.parse((await readRawBody(req)).toString() || '{}');
        const dir = getUserDir(username);
        const file = path.join(dir, `${body.id}.jsonl`);
        if (fs.existsSync(file)) fs.unlinkSync(file);
        const meta = loadMeta(username);
        delete meta.sessions[body.id];
        saveMeta(username, meta);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"ok":true}');
    }

    if (url === '/system-prompt' && req.method === 'GET') {
        const prompt = getSystemPrompt(username);
        const defaultPrompt = getDefaultSystemPrompt(username);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ prompt: prompt !== null ? prompt : defaultPrompt, defaultPrompt, isCustom: prompt !== null }));
    }

    if (url === '/system-prompt' && req.method === 'POST') {
        const body = JSON.parse((await readRawBody(req)).toString() || '{}');
        saveSystemPrompt(username, body.prompt || '');
        // Restart AI process so the new prompt actually takes effect
        killUserSession(username);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"ok":true}');
    }

    if (url === '/chat-session/switch' && req.method === 'POST') {
        const body = JSON.parse((await readRawBody(req)).toString() || '{}');
        const session = userSessions.get(username);
        const dir = getUserDir(username);
        const sessionFile = path.join(dir, `${body.id}.jsonl`);
        if (!fs.existsSync(sessionFile)) {
            res.writeHead(404); return res.end('Session not found');
        }
        // Update meta last accessed
        const meta = loadMeta(username);
        if (meta.sessions[body.id]) meta.sessions[body.id].accessedAt = Date.now();
        saveMeta(username, meta);

        if (session && session.piProc && session.piProc.stdin.writable) {
            // Use switch_session to change pi's active session
            const reqId = `sw-${Date.now()}-${++session.requestCounter}`;
            session.pendingSwitches.set(reqId, { ws: { send: ()=>({}), readyState: 1 }, targetSessionId: body.id, targetSessionFile: sessionFile });
            session.piProc.stdin.write(JSON.stringify({ type: 'switch_session', sessionPath: sessionFile, id: reqId }) + '\n');
            session.currentSessionFile = sessionFile;
        } else {
            // No active session, spawn one
            spawnUserPi(username, sessionFile);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"ok":true}');
    }

    // Upload file for AI analysis (text/code/docs)
    if (req.method === 'POST' && url === '/upload-chat-file') {
        try {
            const body = await readRawBody(req);
            const ct   = req.headers['content-type'] || '';
            const bm   = ct.match(/boundary=([^\s;]+)/);
            if (!bm) { res.writeHead(400); return res.end('No boundary'); }
            const parts = parseMultipart(body, bm[1]);
            const file  = parts['file'];
            if (!file || !file.data) { res.writeHead(400); return res.end('No file'); }
            const uploadDir = path.join('/tmp', 'pi-uploads', username);
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            // Sanitize filename
            const safeName = (file.filename || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
            const fname  = `${Date.now()}-${safeName}`;
            const filePath = path.join(uploadDir, fname);
            fs.writeFileSync(filePath, file.data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ path: filePath, name: safeName, size: file.data.length }));
        } catch(e) { res.writeHead(500); return res.end(e.message); }
    }

    // Upload manuscript .docx (admin only)
    if (req.method === 'POST' && url === '/upload-manuscript') {
        if (!isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req);
            const ct   = req.headers['content-type'] || '';
            const bm   = ct.match(/boundary=([^\s;]+)/);
            if (!bm) { res.writeHead(400); return res.end('No boundary'); }
            const parts = parseMultipart(body, bm[1]);
            const file  = parts['file'];
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
        } catch(e) { res.writeHead(500); return res.end(e.message); }
    }

    // Admin page (admin only)
    if (req.method === 'GET' && (url === '/admin' || url === '/dashboard')) {
        if (!isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        return serveFile(res, ADMIN_FILE);
    }

    // AI Chat proxy endpoint for external providers (Claude, OpenAI, xAI, Ollama)
    if (req.method === 'POST' && url === '/api/proxy/chat') {
        if (!isAuthenticated(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Unauthorized' }));
        }
        try {
            const bodyBuf = await readRawBody(req);
            const body = JSON.parse(bodyBuf.toString('utf8'));
            const { provider, apiKey, baseUrl, model, messages, system, stream, temperature, topP, maxTokens } = body;
            if (!provider || !model || !messages) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Missing provider, model, or messages' }));
            }
            return proxyProviderChat(res, provider, apiKey, baseUrl, model, messages, system, stream, temperature, topP, maxTokens);
        } catch(e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: e.message }));
        }
    }

    // AI Chat page (authenticated only)
    if (req.method === 'GET' && url === '/aichat.html')
        return serveFile(res, path.join(PUBLIC_DIR, 'aichat.html'));

    // Save site content (admin only)
    if (req.method === 'POST' && url === '/save-content') {
        if (!isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req);
            const data = JSON.parse(body.toString());
            fs.writeFileSync(CONTENT_FILE, JSON.stringify(data, null, 2));
            res.writeHead(200,{'Content-Type':'application/json'});
            return res.end('{"ok":true}');
        } catch(e) { res.writeHead(400); return res.end(e.message); }
    }

    // Cover image upload (admin only)
    if (req.method === 'POST' && url === '/upload-cover') {
        if (!isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req);
            const ct   = req.headers['content-type'] || '';
            const bm   = ct.match(/boundary=([^\s;]+)/);
            if (!bm) { res.writeHead(400); return res.end('No boundary'); }
            const parts = parseMultipart(body, bm[1]);
            const file  = parts['cover'];
            if (!file || !file.data) { res.writeHead(400); return res.end('No file'); }
            const bookId = parts['bookId'] || 'cover';
            const ext    = path.extname(file.filename).toLowerCase() || '.jpg';
            const fname  = `${bookId}-${Date.now()}${ext}`;
            fs.writeFileSync(path.join(COVERS_DIR, fname), file.data);
            res.writeHead(200,{'Content-Type':'application/json'});
            return res.end(JSON.stringify({ path: `/covers/${fname}` }));
        } catch(e) { res.writeHead(500); return res.end(e.message); }
    }

    // SSE (admin only)
    if (url === '/events') {
        if (!isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        res.writeHead(200, {
            'Content-Type':'text/event-stream','Cache-Control':'no-cache',
            'Connection':'keep-alive','Access-Control-Allow-Origin':'*',
        });
        res.write(':ok\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
    }

    // Metrics data (admin only)
    if (url === '/data') {
        if (!isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try { res.writeHead(200,{'Content-Type':'application/json'}); return res.end(fs.readFileSync(METRICS_FILE,'utf8')); }
        catch { res.writeHead(500); return res.end('{}'); }
    }

    // Scrape now (admin only)
    if (req.method === 'POST' && url === '/scrape') {
        if (!isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        if (scrapeRunning) { res.writeHead(409); return res.end('Scrape already running'); }
        scrapeRunning = true;
        let stderr = '';
        const child = spawn(process.execPath, [SCRAPER_FILE], { cwd: __dirname, env: process.env, stdio: ['ignore','inherit','pipe'] });
        child.stderr.on('data', d => { stderr += d; process.stderr.write(d); });
        child.on('close', code => {
            scrapeRunning = false;
            if (!res.headersSent) { res.writeHead(code===0?200:500,{'Content-Type':'text/plain'}); res.end(code===0 ? 'ok' : `exit ${code}\n${stderr.slice(0,2000)}`); }
        });
        child.on('error', err => { scrapeRunning = false; if (!res.headersSent) { res.writeHead(500); res.end('spawn failed: '+err.message); } });
        return;
    }

    // Delete metrics date (admin only)
    if (req.method === 'POST' && url === '/delete-metrics-date') {
        if (!isAdmin(req)) { res.writeHead(403); return res.end('Forbidden'); }
        try {
            const body = await readRawBody(req);
            const { date } = JSON.parse(body.toString());
            if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.writeHead(400); return res.end('Invalid date'); }
            const data = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
            for (const story of Object.values(data.stories)) story.history = (story.history || []).filter(e => e.date !== date);
            data.lastUpdated = new Date().toISOString();
            fs.writeFileSync(METRICS_FILE, JSON.stringify(data, null, 2));
            res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}');
        } catch(e) { res.writeHead(500); return res.end(e.message); }
    }
    });

// ── EXTERNAL PROVIDER PROXY ─────────────────────────────
function proxyProviderChat(res, provider, apiKey, baseUrl, model, messages, system, stream, temperature, topP, maxTokens) {
    const isStream = stream !== false;
    const headers = { 'Content-Type': 'application/json' };
    let hostname, pathReq, method = 'POST';
    let body;
    const streamMode = isStream ? 'stream' : '';

    if (provider === 'claude') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
        hostname = 'api.anthropic.com';
        pathReq = '/v1/messages';
        const msgs = [];
        if (system) msgs.push({ role: 'user', content: `System: ${system}` });
        for (const m of messages) {
            if (m.role === 'system') continue;
            msgs.push({ role: m.role, content: m.content });
        }
        body = JSON.stringify({ model, messages: msgs, max_tokens: maxTokens || 4096, stream: isStream });
    } else if (provider === 'openai') {
        headers['Authorization'] = `Bearer ${apiKey}`;
        hostname = 'api.openai.com';
        pathReq = '/v1/chat/completions';
        const msgs = system ? [{ role: 'system', content: system }] : [];
        for (const m of messages) msgs.push({ role: m.role, content: m.content });
        body = JSON.stringify({ model, messages: msgs, max_tokens: maxTokens || 4096, stream: isStream, temperature: temperature ?? 0.7, top_p: topP ?? 1 });
    } else if (provider === 'xai') {
        headers['Authorization'] = `Bearer ${apiKey}`;
        hostname = 'api.x.ai';
        pathReq = '/v1/chat/completions';
        const msgs = system ? [{ role: 'system', content: system }] : [];
        for (const m of messages) msgs.push({ role: m.role, content: m.content });
        body = JSON.stringify({ model, messages: msgs, max_tokens: maxTokens || 4096, stream: isStream, temperature: temperature ?? 0.7, top_p: topP ?? 1 });
    } else if (provider === 'ollama') {
        const ollamaBase = (baseUrl || 'http://localhost:11434').replace(/\/$/, '');
        const target = new URL(ollamaBase);
        hostname = target.hostname;
        const port = target.port || (target.protocol === 'https:' ? 443 : 80);
        const proto = target.protocol === 'https:' ? https : httpReq;
        pathReq = '/api/chat';
        const msgs = [];
        if (system) msgs.push({ role: 'system', content: system });
        for (const m of messages) {
            if (m.role === 'system') continue;
            msgs.push({ role: m.role, content: m.content });
        }
        const reqBody = JSON.stringify({ model, messages: msgs, stream: isStream, options: { temperature: temperature ?? 0.7, top_p: topP ?? 1, num_predict: maxTokens || 4096 } });
        return proxyViaRequest(res, proto, hostname, port, pathReq, headers, reqBody, provider, isStream);
    } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unknown provider' }));
    }

    return proxyViaRequest(res, https, hostname, 443, pathReq, headers, body, provider, isStream);
}

function proxyViaRequest(res, protoModule, hostname, port, pathReq, headers, body, provider, isStream) {
    const requestOpts = { hostname, port, path: pathReq, method: 'POST', headers };
    const proxyReq = protoModule.request(requestOpts, (proxyRes) => {
        if (!isStream) {
            let raw = '';
            proxyRes.on('data', c => raw += c);
            proxyRes.on('end', () => {
                if (provider === 'claude') {
                    try {
                        const d = JSON.parse(raw);
                        const text = d.content?.map(c => c.type === 'text' ? c.text : '').join('') || '';
                        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
                        res.end(`{"type":"text","text":${JSON.stringify(text)}}\n{"type":"done"}\n`);
                    } catch {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid response from provider' }));
                    }
                    return;
                }
                try {
                    const d = JSON.parse(raw);
                    const text = d.choices?.[0]?.message?.content || '';
                    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
                    res.end(`{"type":"text","text":${JSON.stringify(text)}}\n{"type":"done"}\n`);
                } catch {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid response from provider' }));
                }
            });
            return;
        }

        // Streaming mode: parse SSE
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        let buffer = '';
        proxyRes.on('data', chunk => {
            buffer += chunk;
            let idx;
            while ((idx = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (!line || !line.startsWith('data: ')) continue;
                const payload = line.slice(6);
                if (payload === '[DONE]') {
                    res.write(`{"type":"done"}\n`);
                    continue;
                }
                try {
                    const data = JSON.parse(payload);
                    if (provider === 'claude') {
                        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
                            res.write(`{"type":"text","text":${JSON.stringify(data.delta.text)}}\n`);
                        } else if (data.type === 'message_delta' && data.usage) {
                            res.write(`{"type":"usage","input_tokens":${data.usage.input_tokens || 0},"output_tokens":${data.usage.output_tokens || 0}}\n`);
                        }
                    } else if (provider === 'ollama') {
                        if (data.message?.content) {
                            res.write(`{"type":"text","text":${JSON.stringify(data.message.content)}}\n`);
                        }
                        if (data.done) {
                            res.write(`{"type":"done"}\n`);
                        }
                    } else {
                        // openai / xai
                        const delta = data.choices?.[0]?.delta;
                        if (delta?.content) {
                            res.write(`{"type":"text","text":${JSON.stringify(delta.content)}}\n`);
                        }
                        if (data.usage) {
                            res.write(`{"type":"usage","input_tokens":${data.usage.prompt_tokens || 0},"output_tokens":${data.usage.completion_tokens || 0}}\n`);
                        }
                    }
                } catch (e) {
                    // skip malformed JSON in SSE stream
                }
            }
        });
        proxyRes.on('end', () => {
            res.write(`{"type":"done"}\n`);
            res.end();
        });
        proxyRes.on('error', () => {
            res.write(`{"type":"error","error":"Provider stream error"}\n`);
            res.end();
        });
    });
    proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Proxy request failed' }));
    });
    proxyReq.write(body);
    proxyReq.end();
}

// ── WEBSOCKET /chat - PER-USER PERSISTENT SESSIONS ──────
const wss = new WebSocket.Server({ server, path: '/chat' });

wss.on('connection', (ws, req) => {
    const username = getUsername(req);
    if (!username) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
        ws.close(4001, 'Unauthorized');
        return;
    }
    if (!isAdmin(req)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Admin access required for pi Agent' }));
        ws.close(4003, 'Forbidden');
        return;
    }

    const session = getOrCreateUserSession(username);
    session.websockets.add(ws);

    // Send session list on connect
    refreshSessionList(username, ws);

    // Request history for current session after brief delay
    setTimeout(() => {
        if (!session || !session.websockets.has(ws)) return;
        const reqId = `hist-${Date.now()}-${++session.requestCounter}`;
        session.pendingRequests.set(reqId, ws);
        if (session.piProc && session.piProc.stdin.writable) {
            session.piProc.stdin.write(JSON.stringify({ type: 'get_messages', id: reqId }) + '\n');
        }
    }, 600);

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (!msg || !msg.type) return;

            // Handle switch_session
            if (msg.type === 'switch_session') {
                const dir = getUserDir(username);
                const sessionFile = path.join(dir, `${msg.sessionId}.jsonl`);
                if (session.piProc && session.piProc.stdin.writable) {
                    const swId = `sw-${Date.now()}-${++session.requestCounter}`;
                    session.pendingSwitches.set(swId, { ws, targetSessionId: msg.sessionId, targetSessionFile: sessionFile });
                    session.piProc.stdin.write(JSON.stringify({ type: 'switch_session', sessionPath: sessionFile, id: swId }) + '\n');
                    session.currentSessionFile = sessionFile;
                }
                return;
            }

            // Handle new_session from client
            if (msg.type === 'new_session') {
                const id = getNextSessionId(username);
                const name = msg.name || 'New Chat';
                const dir = ensureUserDir(username);
                const sessionFile = path.join(dir, `${id}.jsonl`);
                fs.writeFileSync(sessionFile, '');
                const meta = loadMeta(username);
                meta.sessions[id] = { name, createdAt: Date.now() };
                saveMeta(username, meta);

                if (session.piProc && session.piProc.stdin.writable) {
                    const swId = `sw-${Date.now()}-${++session.requestCounter}`;
                    session.pendingSwitches.set(swId, { ws, targetSessionId: id, targetSessionFile: sessionFile });
                    session.piProc.stdin.write(JSON.stringify({ type: 'switch_session', sessionPath: sessionFile, id: swId }) + '\n');
                    session.currentSessionFile = sessionFile;
                }
                refreshSessionList(username);
                return;
            }


            // Standard RPC commands
            if (msg.type === 'prompt' || msg.type === 'steer' || msg.type === 'follow_up' ||
                msg.type === 'abort' || msg.type === 'compact' ||
                msg.type === 'set_model' || msg.type === 'cycle_model' || msg.type === 'set_thinking_level' ||
                msg.type === 'get_state' || msg.type === 'get_messages' || msg.type === 'fork' || msg.type === 'clone' ||
                msg.type === 'export_html' || msg.type === 'set_session_name' || msg.type === 'get_commands' ||
                msg.type === 'set_steering_mode' || msg.type === 'set_follow_up_mode' ||
                msg.type === 'set_auto_compaction' || msg.type === 'set_auto_retry' ||
                msg.type === 'bash' || msg.type === 'abort_bash' ||
                msg.type === 'get_session_stats' || msg.type === 'get_fork_messages' ||
                msg.type === 'get_last_assistant_text' || msg.type === 'cycle_thinking_level') {
                if (msg.id) session.pendingRequests.set(msg.id, ws);
                session.piProc.stdin.write(JSON.stringify(msg) + '\n');
                return;
            }

            if (msg.type === 'extension_ui_response') {
                session.piProc.stdin.write(JSON.stringify(msg) + '\n');
                return;
            }

            // Unknown - forward anyway
            session.piProc.stdin.write(JSON.stringify(msg) + '\n');
        } catch {
            session.piProc.stdin.write(String(data) + '\n');
        }
    });

    ws.on('close', () => {
        session.websockets.delete(ws);
        for (const [id, targetWs] of session.pendingRequests) { if (targetWs === ws) session.pendingRequests.delete(id); }
        for (const [id, sw] of session.pendingSwitches) { if (sw.ws === ws) session.pendingSwitches.delete(id); }
        if (session.websockets.size === 0) {
            if (session.graceTimer) clearTimeout(session.graceTimer);
            session.graceTimer = setTimeout(() => killUserSession(username), PI_GRACE_MS);
        }
    });

    ws.on('error', () => {
        session.websockets.delete(ws);
    });
});

function refreshSessionList(username, specificWs) {
    const list = listUserSessions(username);
    const payload = JSON.stringify({ type: 'session_list', sessions: list });
    const session = userSessions.get(username);
    if (specificWs && specificWs.readyState === 1) {
        specificWs.send(payload);
    } else if (session) {
        for (const ws of session.websockets) {
            if (ws.readyState === 1) ws.send(payload);
        }
    }
}

server.on('error', err => {
    if (err.code === 'EADDRINUSE') { console.error(`Port ${PORT} in use.`); process.exit(1); }
    else throw err;
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🐾 Nekojin Interactive`);
    console.log(`   Public site:  http://0.0.0.0:${PORT}/`);
    console.log(`   AI Chat:      http://0.0.0.0:${PORT}/aichat.html  (login required)`);
    console.log(`   Login:        http://0.0.0.0:${PORT}/login`);
    console.log(`   pi Chat WS:   ws://0.0.0.0:${PORT}/chat\n`);
});
