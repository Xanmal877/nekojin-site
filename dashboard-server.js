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
const { isSafeHttpUrl, isValidDateStr } = require('./lib/url');
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

// ── MODULES ───────────────────────────────────────────────
// Routing lives in this file; everything a route calls lives in one named
// module under lib/. Every path a module needs is relative to the repo root,
// which is __dirname here and NOT inside lib/, so those values are handed over
// at boot with configure() (see the bottom of this file).
const { sendJson, sendHtml, sendText, redirect, forbidden, notFound, enforceRateLimit,
        readJsonBody, isValidSlug, readMultipartFile, safePathSegment } = require('./lib/http-helpers');
const { readRawBody, parseFormBody } = require('./lib/body-parsing');
const rateLimit = require('./lib/rate-limit');
const staticFiles = require('./lib/static-files');
const { serveStaticAsset, serveFile, isStaticAssetPath } = staticFiles;
const publicRoutes = require('./lib/public-routes');
const { getPublicRoutes, readBaseFor } = publicRoutes;
const { INTEGRATION_ROUTES } = require('./lib/integrations');
const { matchAdminContent, handleAdminContent, REORDER_ROUTES } = require('./lib/admin-content');
const cover = require('./lib/cover-versioning');
const { withCoverVersion } = cover;
const { loginPage, registerPage, safeRedirectPath } = require('./lib/auth-pages');
const manuscripts = require('./lib/manuscripts');
const { MANUSCRIPT_DISABLED, handleManuscriptRequest, handleManuscriptUpload } = manuscripts;
const calendar = require('./lib/calendar');
const { handlePublicPublishingCalendar, handleAdminPublishingCalendar } = calendar;
const { handlePublishingApi } = require('./lib/publishing-api');

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

// Hand the modules the values they cannot resolve themselves. Every path here
// is relative to the repo root, which is __dirname for this file only.
rateLimit.configure({ trustProxy: TRUST_PROXY });
staticFiles.configure({ publicDir: PUBLIC_DIR, sendText, notFound });
publicRoutes.configure(PUBLIC_DIR);
cover.configure(PUBLIC_DIR);
calendar.configure({ getPublishingDB, getPublishingCalendar });
manuscripts.configure({ manuscriptsDir: MANUSCRIPTS_DIR, mammoth });

// Open database connection
contentDB.Open();
console.log('Database connection opened');

// Publishing dashboard database (read-only). Loaded lazily on first request so
// the server still boots in environments that don't ship publishing-db.js
// (e.g. a test harness that only copies a subset of the repo).
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
    if (req.method === 'GET' && isStaticAssetPath(url)) {
        res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    } else {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }

    // Public HTML pages
    if (req.method === 'GET' && getPublicRoutes()[url]) {
        return serveFile(res, getPublicRoutes()[url]);
    }

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
    if (req.method === 'GET' && serveStaticAsset(req, res, url)) return;

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
              const isProduction = process.env.NODE_ENV === 'production' || TRUST_PROXY;
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
            return sendJson(res, { error: 'Failed to load content' }, 500);
        }
    }

    // Public content reads: characters, timeline, lore topics.
    const readBase = url.split('/').slice(0, 3).join('/');
    const publicRead = readBaseFor(readBase);
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






    // Integration APIs (public): one handler per provider in INTEGRATION_ROUTES
    if (req.method === 'GET' && INTEGRATION_ROUTES[url]) {
        if (enforceRateLimit(req, res, url, { json: true })) return;
        const load = INTEGRATION_ROUTES[url];
        try {
            return sendJson(res, await load());
        } catch (e) {
            // Don't expose internal errors to the client; log for debugging.
            console.error(`[${url}] Error:`, e.message);
            return sendJson(res, { error: 'Service temporarily unavailable' }, 500);
        }
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
            return sendJson(res, { error: 'Failed to load book' }, 500);
        }
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
    // Manuscript API + upload: one optional feature, one gate. Deliberately
    // below the auth gate with the other admin/private routes, so the feature's
    // existence isn't disclosed and unpublished drafts need a session.
    if (MANUSCRIPTS_ENABLED && url.startsWith('/api/manuscripts')) {
        return handleManuscriptRequest(req, res, url);
    }
    if (req.method === 'POST' && url === '/upload-manuscript') {
        if (!MANUSCRIPTS_ENABLED) return sendJson(res, MANUSCRIPT_DISABLED, 503);
        if (!accounts.isAdmin(req)) return forbidden(res);
        return handleManuscriptUpload(req, res);
    }



    // Admin Character / Timeline / Lore API (auth already enforced above).
    // The public GET side is served before the auth gate; everything that
    // reaches here is an admin-gated write or a single-entity read.
    const contentMatch = matchAdminContent(url);
    if (contentMatch) {
        if (!accounts.isAdmin(req)) return forbidden(res);
        try {
            return await handleAdminContent(req, res, contentMatch);
        } catch (err) {
            console.error(`Admin ${contentMatch.type.base} API error:`, err);
            return sendJson(res, { error: err.message }, 500);
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
                const data = await readJsonBody(req, 16 * 1024);
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


    const reorder = REORDER_ROUTES[url];
    if (req.method === 'POST' && reorder) {
        if (!accounts.isAdmin(req)) return forbidden(res);
        try {
            const body = await readJsonBody(req, 64 * 1024);
            const ids = body[reorder.idField];
            if (!Array.isArray(ids)) {
                return sendJson(res, { error: `${reorder.idField} must be an array` }, 400);
            }
            return sendJson(res, await reorder.apply(body, ids));
        } catch (e) {
            return sendJson(res, { error: e.message }, 500);
        }
    }

    // Save site content (admin only) - now to database
    if (req.method === 'POST' && url === '/save-content') {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        try {
            const data = await readJsonBody(req, 10 * 1024 * 1024);

            // Validate book slugs: lowercase, numbers, hyphens, underscores only.
            if (data.books && Array.isArray(data.books)) {
                for (const book of data.books) {
                    const slug = book.slug || book.id;
                    if (!isValidSlug(slug)) {
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
            await contentDB.CreateBackup('save-content');
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
            const upload = await readMultipartFile(req, 'cover', 25 * 1024 * 1024);
            if (upload.error) return sendText(res, upload.error, upload.status);
            const { parts, file } = upload;
            if (file.data.length === 0) { return sendText(res, 'Image file is empty', 400); }
            if (file.data.length > 20 * 1024 * 1024) { return sendText(res, 'Image too large (max 20MB)', 413); }

            const bookId = safePathSegment(parts['bookId'], 'cover');
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
            const data = await readJsonBody(req, 64 * 1024);
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
            const data = await readJsonBody(req, 64 * 1024);
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

    // Publishing API (admin only). The routing table for this subtree lives in
    // lib/publishing-api.js; the role gate stays here.
    if (url.startsWith('/api/publishing')) {
        if (!accounts.isAdmin(req)) { return forbidden(res); }
        if (req.method !== 'GET') { return sendText(res, 'Method Not Allowed', 405); }
        try {
            // awaited so the catch below sees a rejection from the module
            return await handlePublishingApi(req, res, url, query, getPublishingDB);
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
