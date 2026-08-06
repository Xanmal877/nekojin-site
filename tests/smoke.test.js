// Smoke test: boots a throwaway copy of the server and exercises the
// critical paths (health, public routes, login, CSRF-gated save).
// Run with: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nekojin-smoke-'));
const PORT = 7781;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'SmokeTestPass1234';

let serverProcess;
let serverStderr = '';
let sharedAuth = null;

function copyRepoFiles() {
    const filesToCopy = [
        'dashboard-server.js', 'accounts.js', 'database.js', 'backup.js', 'generate-meta.js',
        'package.json'
    ];
    for (const f of filesToCopy) fs.copyFileSync(path.join(ROOT, f), path.join(WORKDIR, f));
    fs.cpSync(path.join(ROOT, 'public'), path.join(WORKDIR, 'public'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'node_modules'), path.join(WORKDIR, 'node_modules'), { recursive: true });
}

async function waitForServer(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`${BASE}/api/health`);
            if (res.ok) return;
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    throw new Error('Server did not become healthy in time');
}

async function loginAs(username, password) {
    const res = await fetch(`${BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&next=/admin`,
        redirect: 'manual',
    });
    const setCookie = res.headers.get('set-cookie') || '';
    const cookies = setCookie.split(/,(?=[^;]+=[^;]+)/);
    const sessionCookie = cookies.find(c => c.includes('nki_session')).split(';')[0];
    const csrfCookie = cookies.find(c => c.includes('nki_csrf')).split(';')[0];
    const csrfToken = csrfCookie.split('=')[1];
    const cookieHeader = `${sessionCookie}; ${csrfCookie}`;
    return {
        cookieHeader,
        csrfToken,
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader, 'X-CSRF-Token': csrfToken },
    };
}

before(async () => {
    copyRepoFiles();
    serverProcess = spawn(process.execPath, ['dashboard-server.js'], {
        cwd: WORKDIR,
        env: {
            ...process.env,
            ADMIN_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
            PORT: String(PORT),
        },
        stdio: 'pipe',
    });
    serverProcess.stderr.on('data', chunk => { serverStderr += chunk; });
    await waitForServer();
    // Re-use one admin login across tests so we don't hit the 5-per-15-min
    // /login rate limit as the test file grows.
    sharedAuth = await loginAs('admin', ADMIN_PASSWORD);
});

after(() => {
    if (serverProcess) serverProcess.kill();
    fs.rmSync(WORKDIR, { recursive: true, force: true });
});

test('GET /api/health reports ok', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.dbConnected, true);
});

test('GET / serves the homepage', async () => {
    const res = await fetch(`${BASE}/`);
    assert.strictEqual(res.status, 200);
});

test('server warns on startup when content tables are empty but covers exist', () => {
    // The smoke-test server starts with an empty DB but real covers copied
    // from public/. The startup sanity check should log a warning.
    assert(serverStderr.includes('WARNING: content tables are empty but /public/covers/ still has files'),
        `Expected startup warning in stderr, got:\n${serverStderr}`);
});

test('GET /register is disabled by default', async () => {
    const res = await fetch(`${BASE}/register`, { redirect: 'manual' });
    assert.strictEqual(res.status, 404);
});

test('unauthenticated /admin redirects to /login', async () => {
    const res = await fetch(`${BASE}/admin`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.match(res.headers.get('location'), /^\/login/);
});

test('login succeeds and issues session + csrf cookies', () => {
    assert.match(sharedAuth.cookieHeader, /nki_session=/);
    assert.match(sharedAuth.cookieHeader, /nki_csrf=/);
    assert.ok(sharedAuth.csrfToken);
});

test('save-content is rejected without a CSRF token, accepted with one', async () => {
    const noTokenHeaders = { 'Content-Type': 'application/json', Cookie: sharedAuth.cookieHeader };

    const noTokenRes = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: noTokenHeaders,
        body: JSON.stringify({ series: [] }),
    });
    assert.strictEqual(noTokenRes.status, 403);

    const withTokenRes = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            series: [{ id: 's1', universe: 'Test Universe', universeDesc: 'desc' }],
            books: [], about: {},
        }),
    });
    assert.strictEqual(withTokenRes.status, 200);

    const contentRes = await fetch(`${BASE}/content`);
    const content = await contentRes.json();
    assert.strictEqual(content.series[0].universe, 'Test Universe');
});

test('editing a series universe/description after a round-trip through GET /content actually persists', async () => {
    // Regression test: GET /content echoes the DB columns as both `name`/
    // `description` (raw columns) and `universe`/`universeDesc` (the fields
    // admin.html actually edits). InsertSeries used to prefer the stale
    // `name`/`description` over `universe`/`universeDesc` when both were
    // present, so re-saving an object fetched from /content silently
    // discarded any edit to the series name or description — reproduced
    // live in the admin panel before this fix.
    const seedRes = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            series: [{ id: 'precedence-test', universe: 'Original Name', universeDesc: 'Original Desc' }],
            books: [], game: [], about: {},
        }),
    });
    assert.strictEqual(seedRes.status, 200);

    // This is exactly what admin.html's loadContent() receives: both the
    // raw `name`/`description` columns AND the `universe`/`universeDesc`
    // aliases are present, because SelectSeries copies one onto the other.
    const loaded = await (await fetch(`${BASE}/content`)).json();
    const series = loaded.series.find(s => s.id === 'precedence-test');
    assert.strictEqual(series.name, 'Original Name');

    // Simulate an admin editing the universe/universeDesc fields (what the
    // UI actually binds to) and re-saving the whole fetched object as-is.
    series.universe = 'Renamed Universe';
    series.universeDesc = 'Renamed Desc';
    const resaveRes = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({ series: loaded.series, books: [], game: [], about: {} }),
    });
    assert.strictEqual(resaveRes.status, 200);

    const after = await (await fetch(`${BASE}/content`)).json();
    const afterSeries = after.series.find(s => s.id === 'precedence-test');
    assert.strictEqual(afterSeries.universe, 'Renamed Universe');
    assert.strictEqual(afterSeries.universeDesc, 'Renamed Desc');
});

test('save-content refuses an empty payload that would wipe existing content', async () => {
    // Seed real content first (this reproduces the bug found in production:
    // a client that sends {} for everything must not be able to erase it).
    const seedRes = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            series: [{ id: 's2', universe: 'Guard Test Universe', universeDesc: 'desc' }],
            books: [{ id: 'b1', title: 'Guard Test Book', slug: 'guard-test-book', status: 'published' }],
            game: [], about: { studio_name: 'Guard Test Studio' },
        }),
    });
    assert.strictEqual(seedRes.status, 200);

    // A completely empty payload (what admin.html would send if its initial
    // /content fetch had silently failed) must be rejected, not persisted.
    const emptyRes = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({ series: [], books: [], game: [], about: {} }),
    });
    assert.strictEqual(emptyRes.status, 409);

    const contentRes = await fetch(`${BASE}/content`);
    const content = await contentRes.json();
    assert.strictEqual(content.series.some(s => s.universe === 'Guard Test Universe'), true);
    assert.strictEqual(content.books.some(b => b.title === 'Guard Test Book'), true);
});

test('cannot delete or demote the last remaining admin, but can once a second admin exists', async () => {
    // With only the bootstrap admin, both destructive actions must be blocked.
    const deleteBlocked = await fetch(`${BASE}/api/users/admin`, { method: 'DELETE', headers: sharedAuth.headers });
    assert.strictEqual(deleteBlocked.status, 400);
    const demoteBlocked = await fetch(`${BASE}/api/users/admin/role`, {
        method: 'POST', headers: sharedAuth.headers, body: JSON.stringify({ role: 'user' }),
    });
    assert.strictEqual(demoteBlocked.status, 400);

    // A second admin makes "admin" no longer the last one — both should now succeed.
    const createRes = await fetch(`${BASE}/api/users`, {
        method: 'POST', headers: sharedAuth.headers,
        body: JSON.stringify({ username: 'guardtest', password: 'GuardTestPass1234', role: 'admin' }),
    });
    assert.strictEqual(createRes.status, 201);

    const deleteAllowed = await fetch(`${BASE}/api/users/admin`, { method: 'DELETE', headers: sharedAuth.headers });
    assert.strictEqual(deleteAllowed.status, 200);

    // Deleting your own account revokes your own session's admin rights immediately,
    // so restoring the bootstrap admin has to happen as the still-valid "guardtest" admin.
    const guardAuth = await loginAs('guardtest', 'GuardTestPass1234');

    const recreateRes = await fetch(`${BASE}/api/users`, {
        method: 'POST',
        headers: guardAuth.headers,
        body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD, role: 'admin' }),
    });
    assert.strictEqual(recreateRes.status, 201);
});

test('draft books are hidden from public GET /content', async () => {
    const seedRes = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            series: [],
            books: [{ id: 'draft-book', title: 'Draft Hidden Book', slug: 'draft-hidden-book', status: 'draft' }],
            game: [], about: {},
        }),
    });
    assert.strictEqual(seedRes.status, 200);

    const content = await (await fetch(`${BASE}/content`)).json();
    assert.strictEqual(content.books.some(b => b.id === 'draft-book'), false);
});

test('published books are visible in public GET /content', async () => {
    const seedRes = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            series: [],
            books: [{ id: 'pub-book', title: 'Public Visible Book', slug: 'public-visible-book', status: 'published' }],
            game: [], about: {},
        }),
    });
    assert.strictEqual(seedRes.status, 200);

    const content = await (await fetch(`${BASE}/content`)).json();
    assert.strictEqual(content.books.some(b => b.id === 'pub-book'), true);
});

test('preview books are hidden from plain /content but reachable via the preview endpoint', async () => {
    const seedRes = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            series: [],
            books: [{ id: 'pre-book', title: 'Preview Book', slug: 'preview-book', status: 'preview' }],
            game: [], about: {},
        }),
    });
    assert.strictEqual(seedRes.status, 200);

    // Plain public catalog must not list preview books.
    const content = await (await fetch(`${BASE}/content`)).json();
    assert.strictEqual(content.books.some(b => b.id === 'pre-book'), false);

    // Preview mode must serve the single book.
    const previewRes = await fetch(`${BASE}/book-by-slug?slug=preview-book&preview=1`);
    assert.strictEqual(previewRes.status, 200);
    const previewBody = await previewRes.json();
    assert.strictEqual(previewBody.book.id, 'pre-book');

    // Without the preview flag the same slug must 404.
    const noPreviewRes = await fetch(`${BASE}/book-by-slug?slug=preview-book`);
    assert.strictEqual(noPreviewRes.status, 404);
});
