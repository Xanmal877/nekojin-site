// The publishing calendar: the public read, the admin write, and the helpers
// that normalize a row into its public-safe shape. The manual calendar store
// and the read-only publishing DB are separate files that fail independently,
// so each load keeps its own fallback.
//
// The two DB handles are the server's lazy getters (injected) so this module
// cannot open a second connection to either file.

const { isSafeHttpUrl, isValidDateStr } = require('./url');
const { sendJson, readJsonBody, enforceRateLimit } = require('./http-helpers');

let getPublishingDB;
let getPublishingCalendar;
function configure(handles) {
    getPublishingDB = handles.getPublishingDB;
    getPublishingCalendar = handles.getPublishingCalendar;
}

// ── CALENDAR HELPERS ──────────────────────────────────────
// Valid YYYY-MM-DD local date (checked against a real calendar date, not just
// the regex) so bad strings like "2025-02-30" are rejected up front.


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
// Only http(s) URLs are handed to the public calendar; lib/url.js owns that
// rule so this can't drift from the copy database.js and generate-meta.js use.
function safePublicUrl(url) {
    if (typeof url !== 'string') return null;
    const trimmed = url.trim();
    return isSafeHttpUrl(trimmed) ? trimmed : null;
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

    // The manual calendar store and the read-only publishing DB are separate
    // files, so these two loads are independent and run together. Each keeps
    // its own fallback: one source being unavailable must not empty the other.
    const loadManual = async () => {
        // Already local-date and half-open.
        try {
            const calendar = getPublishingCalendar();
            await calendar.Open();
            return (await calendar.ListPublic(start, end)) || [];
        } catch (err) {
            console.error('[Public Calendar] Manual entries unavailable:', err.message);
            return [];
        }
    };

    const loadImported = async () => {
        // Over-fetch a UTC window covering every possible local date in
        // [start, end), then keep only rows whose LOCAL date is in range.
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
            return [...published, ...scheduled]
                .filter(r => {
                    const localDate = typeof r.releaseDateTime === 'string'
                        ? r.releaseDateTime.slice(0, 10) : null;
                    return !!localDate && localDate >= start && localDate < end;
                })
                .map(normalizeImportedRelease);
        } catch (err) {
            console.error('[Public Calendar] Imported releases unavailable:', err.message);
            return [];
        }
    };

    const [manual, imported] = await Promise.all([loadManual(), loadImported()]);

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
            const data = await readJsonBody(req, 64 * 1024);
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

module.exports = {
    configure,
    handlePublicPublishingCalendar, handleAdminPublishingCalendar
};
