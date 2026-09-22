// Shared HTTP plumbing: the response writers, the JSON/multipart body readers,
// and the small input guards. Every other module answers through these.

const { checkRateLimit } = require('./rate-limit');
const { readRawBody, parseMultipart } = require('./body-parsing');

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

// Slugs go into URLs and filenames, so they stay lowercase alphanumeric.
const SLUG_PATTERN = /^[a-z0-9_-]+$/;
function isValidSlug(value) {
    return SLUG_PATTERN.test(String(value));
}

// Read one file part out of a multipart/form-data request. Returns
// { error, status } when the request can't be used, otherwise { parts, file }.
// Both upload routes need exactly this preamble, and the failure responses
// must stay identical between them.
async function readMultipartFile(req, field, maxBytes) {
    const body = await readRawBody(req, maxBytes);
    const boundary = (req.headers['content-type'] || '').match(/boundary=([^\s;]+)/);
    if (!boundary) return { error: 'No boundary', status: 400 };
    const parts = parseMultipart(body, boundary[1]);
    const file = parts[field];
    if (!file || !file.data) return { error: 'No file', status: 400 };
    return { parts, file };
}

// Anything derived from user input that lands in a filename goes through here:
// covers are written under COVERS_DIR and manuscripts under MANUSCRIPTS_DIR,
// so a path separator must never survive.
function safePathSegment(name, fallback) {
    return String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || fallback;
}

module.exports = {
    sendJson, sendHtml, sendText, redirect, forbidden, notFound,
    enforceRateLimit, readJsonBody, isValidSlug, readMultipartFile,
    safePathSegment
};
