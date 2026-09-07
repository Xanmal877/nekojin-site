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
const GUMROAD_WEBHOOK_SECRET = 'smoke-webhook-secret';

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
    fs.cpSync(path.join(ROOT, 'lib'), path.join(WORKDIR, 'lib'), { recursive: true });
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
            GUMROAD_WEBHOOK_SECRET,
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
    // discarded any edit to the series name or description, reproduced
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

    // A second admin makes "admin" no longer the last one, so both should now succeed.
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
    // The original bootstrap admin session was intentionally revoked when its
    // account was deleted; use the surviving admin session for later tests.
    sharedAuth = guardAuth;

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

test('save-content rejects duplicate book slugs', async () => {
    const res = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            series: [],
            books: [
                { id: 'dup1', title: 'Book One', slug: 'same-slug', status: 'published' },
                { id: 'dup2', title: 'Book Two', slug: 'same-slug', status: 'published' },
            ],
            game: [], about: {},
        }),
    });
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /Duplicate book slug detected/);
});

test('save-content rejects invalid book slugs', async () => {
    const res = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            series: [],
            books: [{ id: 'inv1', title: 'Invalid Book', slug: 'Invalid Slug!', status: 'published' }],
            game: [], about: {},
        }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Slugs must be lowercase, numbers, hyphens, or underscores/);
});

test('save-content enforces required fields', async () => {
    // Missing book title
    const resBook = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            series: [],
            books: [{ id: 'nobook', slug: 'no-title', status: 'published' }],
            game: [], about: {},
        }),
    });
    assert.strictEqual(resBook.status, 400);

    // Missing series name/universe
    const resSeries = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            series: [{ id: 'noseries' }],
            books: [], game: [], about: {},
        }),
    });
    assert.strictEqual(resSeries.status, 400);
});

test('series cover image persists', async () => {
    const coverPath = '/covers/series-test-cover.webp';
    const res = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            series: [{ id: 'cover-test', universe: 'Cover Test Universe', cover_image: coverPath }],
            books: [], game: [], about: {},
        }),
    });
    assert.strictEqual(res.status, 200);

    const content = await (await fetch(`${BASE}/content`)).json();
    const series = content.series.find(s => s.id === 'cover-test');
    assert.ok(series);
    assert.strictEqual(series.cover_image, coverPath);
});

test('book sequence reordering persists', async () => {
    // Seed a series with 2 books
    await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            series: [{ id: 'order-series', universe: 'Order Test' }],
            books: [
                { id: 'book-a', title: 'Book A', slug: 'book-a', seriesId: 'order-series', volumeNumber: 1, status: 'published' },
                { id: 'book-b', title: 'Book B', slug: 'book-b', seriesId: 'order-series', volumeNumber: 2, status: 'published' },
            ],
            game: [], about: {},
        }),
    });

    // Reorder: B then A
    const reorderRes = await fetch(`${BASE}/api/books/reorder`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({ seriesId: 'order-series', bookIds: ['book-b', 'book-a'] }),
    });
    assert.strictEqual(reorderRes.status, 200);

    const content = await (await fetch(`${BASE}/content`)).json();
    const bookA = content.books.find(b => b.id === 'book-a');
    const bookB = content.books.find(b => b.id === 'book-b');

    // Book B should now be 1, Book A should be 2
    assert.strictEqual(bookB.volume_number, 1);
    assert.strictEqual(bookA.volume_number, 2);
});

// ── CHARACTERS API TESTS ───────────────────────────────────

test('GET /api/characters returns visible characters', async () => {
    // Seed characters
    const seedRes = await fetch(`${BASE}/api/characters`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            id: 'char-tama', slug: 'tama', name: 'Tama', content: 'Tama content', visible: true
        }),
    });
    assert.strictEqual(seedRes.status, 200);

    const res = await fetch(`${BASE}/api/characters`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.ok(body.some(c => c.slug === 'tama'));
});

test('GET /api/characters/:slug returns full character object', async () => {
    const res = await fetch(`${BASE}/api/characters/tama`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.slug, 'tama');
    assert.strictEqual(body.content, 'Tama content');
});

test('GET /api/characters/:slug returns 404 for nonexistent slug', async () => {
    const res = await fetch(`${BASE}/api/characters/nonexistent-slug`);
    assert.strictEqual(res.status, 404);
});

test('unauthenticated POST /api/characters is rejected', async () => {
    const res = await fetch(`${BASE}/api/characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'fail', slug: 'fail', name: 'Fail' }),
    });
    assert.strictEqual(res.status, 401);
});

test('authenticated POST /api/characters WITHOUT CSRF is rejected', async () => {
    const res = await fetch(`${BASE}/api/characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sharedAuth.cookieHeader },
        body: JSON.stringify({ id: 'csrf-fail', slug: 'csrf-fail', name: 'CSRF Fail' }),
    });
    assert.strictEqual(res.status, 403);
});

test('authenticated POST /api/characters WITH CSRF succeeds and persists', async () => {
    const charData = { id: 'char-saki', slug: 'saki', name: 'Saki', content: 'Saki content', visible: true };
    const res = await fetch(`${BASE}/api/characters`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify(charData),
    });
    assert.strictEqual(res.status, 200);

    const checkRes = await fetch(`${BASE}/api/characters/saki`);
    const checkBody = await checkRes.json();
    assert.strictEqual(checkBody.name, 'Saki');
});

test('POST /api/characters rejects slugs that could break out of markup', async () => {
    const res = await fetch(`${BASE}/api/characters`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({ id: 'bad-char', slug: '"><img src=x onerror=alert(1)>', name: 'Bad Char' }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Invalid character slug/);
});

// ── LORE TOPICS API TESTS ──────────────────────────────────

test('GET /api/lore-topics returns visible topics', async () => {
    // Seed topics
    await fetch(`${BASE}/api/lore-topics`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({ id: 'lore-world', slug: 'world-lore', section: 'world', title: 'World Lore', content: 'World content', visible: true }),
    });
    await fetch(`${BASE}/api/lore-topics`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({ id: 'lore-char', slug: 'char-lore', section: 'characters', title: 'Char Lore', content: 'Char content', visible: true }),
    });

    const res = await fetch(`${BASE}/api/lore-topics`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.ok(body.some(t => t.slug === 'world-lore'));
});

test('GET /api/lore-topics?section= filters correctly', async () => {
    const res = await fetch(`${BASE}/api/lore-topics?section=world`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.every(t => t.section === 'world'));
    assert.ok(body.some(t => t.slug === 'world-lore'));
});

test('GET /api/lore-topics/:slug returns full topic object', async () => {
    const res = await fetch(`${BASE}/api/lore-topics/world-lore`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.slug, 'world-lore');
    assert.strictEqual(body.content, 'World content');
});

test('GET /api/lore-topics/:slug returns 404 for nonexistent slug', async () => {
    const res = await fetch(`${BASE}/api/lore-topics/nonexistent-lore`);
    assert.strictEqual(res.status, 404);
});

test('unauthenticated POST /api/lore-topics is rejected', async () => {
    const res = await fetch(`${BASE}/api/lore-topics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'fail', slug: 'fail', section: 'world', title: 'Fail' }),
    });
    assert.strictEqual(res.status, 401);
});

test('authenticated POST /api/lore-topics WITHOUT CSRF is rejected', async () => {
    const res = await fetch(`${BASE}/api/lore-topics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sharedAuth.cookieHeader },
        body: JSON.stringify({ id: 'csrf-fail', slug: 'csrf-fail', section: 'world', title: 'CSRF Fail' }),
    });
    assert.strictEqual(res.status, 403);
});

test('authenticated POST /api/lore-topics WITH CSRF succeeds and persists', async () => {
    const loreData = { id: 'lore-test', slug: 'test-lore', section: 'test', title: 'Test Lore', content: 'Test content', visible: true };
    const res = await fetch(`${BASE}/api/lore-topics`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify(loreData),
    });
    assert.strictEqual(res.status, 200);
    const checkRes = await fetch(`${BASE}/api/lore-topics/test-lore`);
    const checkBody = await checkRes.json();
    assert.strictEqual(checkBody.title, 'Test Lore');
});

test('POST /api/lore-topics rejects slugs that could break out of markup', async () => {
    const res = await fetch(`${BASE}/api/lore-topics`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({ id: 'bad-lore', slug: '"><script>alert(1)</script>', section: 'world', title: 'Bad Lore' }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Invalid lore slug/);
});

// ── TIMELINE API TESTS ──────────────────────────────────

test('GET /api/timeline returns an array', async () => {
    const res = await fetch(`${BASE}/api/timeline`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
});

test('GET /api/timeline/:id returns 404 for nonexistent id', async () => {
    const res = await fetch(`${BASE}/api/timeline/nonexistent-id`);
    assert.strictEqual(res.status, 404);
});

test('unauthenticated POST /api/timeline is rejected', async () => {
    const res = await fetch(`${BASE}/api/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Fail', era: 'Fail', description: 'Fail' }),
    });
    assert.ok([401, 403].includes(res.status));
});

test('authenticated POST /api/timeline WITHOUT CSRF is rejected', async () => {
    const res = await fetch(`${BASE}/api/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sharedAuth.cookieHeader },
        body: JSON.stringify({ title: 'CSRF Fail', era: 'Fail', description: 'Fail' }),
    });
    assert.strictEqual(res.status, 403);
});

test('authenticated POST /api/timeline WITH CSRF persists and can be deleted', async () => {
    const eventData = { title: 'Timeline Event', era: 'Test Era', description: 'Test Desc' };
    const res = await fetch(`${BASE}/api/timeline`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify(eventData),
    });
    assert.strictEqual(res.status, 200);
    const created = await res.json();
    assert.ok(created.id);

    const checkRes = await fetch(`${BASE}/api/timeline`);
    const list = await checkRes.json();
    const found = list.find(e => e.id === created.id);
    assert.ok(found);
    assert.strictEqual(found.title, eventData.title);
    assert.strictEqual(found.era, eventData.era);
    assert.strictEqual(found.description, eventData.description);

    const delRes = await fetch(`${BASE}/api/timeline/${created.id}`, {
        method: 'DELETE',
        headers: sharedAuth.headers,
    });
    assert.strictEqual(delRes.status, 200);

    const finalRes = await fetch(`${BASE}/api/timeline/${created.id}`);
    assert.strictEqual(finalRes.status, 404);
});

test('Gumroad webhook persists sales and handles duplicates', async () => {
    const ping = 'product_name=Test+Product&price=1000&currency=USD&sale_id=sale_123&seller_id=test_seller&test=false';

    // Webhooks require an explicit seller configuration; establish it here so
    // this test does not depend on another test's execution order.
    const settingsRes = await fetch(`${BASE}/api/settings`, {
        method: 'POST', headers: sharedAuth.headers,
        body: JSON.stringify({ gumroad_seller_id: 'test_seller' }),
    });
    assert.strictEqual(settingsRes.status, 200);

    // First ping
    const res1 = await fetch(`${BASE}/webhook/gumroad`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Gumroad-Webhook-Secret': GUMROAD_WEBHOOK_SECRET },
        body: ping,
    });
    assert.strictEqual(res1.status, 200);

    // Duplicate ping
    const res2 = await fetch(`${BASE}/webhook/gumroad`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Gumroad-Webhook-Secret': GUMROAD_WEBHOOK_SECRET },
        body: ping,
    });
    assert.strictEqual(res2.status, 200);

    const salesRes = await fetch(`${BASE}/api/sales`);
    const salesData = await salesRes.json();
    const matches = salesData.sales.filter(s => s.product_name === 'Test Product');
    assert.strictEqual(matches.length, 1, 'Should deduplicate sales by sale_id');
});

test('Integration APIs return correct shapes', async () => {
    const youtubeRes = await fetch(`${BASE}/api/youtube`);
    const youtubeData = await youtubeRes.json();
    assert.ok(Array.isArray(youtubeData.videos));

    const discordRes = await fetch(`${BASE}/api/discord`);
    const discordData = await discordRes.json();
    assert.ok('server_id' in discordData);
    assert.ok('invite_code' in discordData);
});

test('Admin settings API is protected and persists', async () => {
    // Unauth'd
    const unauthRes = await fetch(`${BASE}/api/settings`, { redirect: 'manual' });
    assert.strictEqual(unauthRes.status, 302);

    // Auth'd GET
    const authGetRes = await fetch(`${BASE}/api/settings`, { headers: sharedAuth.headers });
    assert.strictEqual(authGetRes.status, 200);

    // Auth'd POST
    const postRes = await fetch(`${BASE}/api/settings`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify({
            gumroad_seller_id: 'set_seller',
            gumroad_access_token: 'set_token',
            youtube_channel_id: 'set_yt',
            discord_server_id: 'set_ds',
            discord_invite_code: 'set_inv'
        }),
    });
    assert.strictEqual(postRes.status, 200);

    const verifyRes = await fetch(`${BASE}/api/settings`, { headers: sharedAuth.headers });
    const verifyData = await verifyRes.json();
    assert.strictEqual(verifyData.gumroad_seller_id, 'set_seller');
});

test('DELETE /api/timeline/:id requires CSRF', async () => {
    const eventData = { title: 'Delete Guard', era: 'Fail', description: 'Fail' };
    const createRes = await fetch(`${BASE}/api/timeline`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify(eventData),
    });
    const created = await createRes.json();

    const delRes = await fetch(`${BASE}/api/timeline/${created.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Cookie: sharedAuth.cookieHeader },
    });
    assert.strictEqual(delRes.status, 403);

    // Cleanup
    await fetch(`${BASE}/api/timeline/${created.id}`, { method: 'DELETE', headers: sharedAuth.headers });
});

// ── CHARACTER RELATIONSHIPS TESTS ────────────────────────────────

test('character relationships round-trip', async () => {
    const charSlug = `test-char-rel-${Math.random().toString(36).substring(7)}`;
    const charData = {
        id: `char-rel-${charSlug}`,
        slug: charSlug,
        name: 'Rel Test Char',
        content: 'Rel content',
        visible: true,
        relationships: [
            { character_slug: 'tama', character_name: 'Tama', relationship_type: 'Friend', description: 'Best buds' },
            { character_slug: 'saki', character_name: 'Saki', relationship_type: 'Rival', description: 'Technical rivalry' }
        ]
    };

    const createRes = await fetch(`${BASE}/api/characters`, {
        method: 'POST',
        headers: sharedAuth.headers,
        body: JSON.stringify(charData),
    });
    assert.strictEqual(createRes.status, 200);

    const getRes = await fetch(`${BASE}/api/characters/${charSlug}`);
    assert.strictEqual(getRes.status, 200);
    const body = await getRes.json();

    assert.ok(Array.isArray(body.relationships));
    assert.strictEqual(body.relationships.length, 2);
    assert.ok(body.relationships.some(r => r.character_slug === 'tama' && r.relationship_type === 'Friend'));
    assert.ok(body.relationships.some(r => r.character_slug === 'saki' && r.relationship_type === 'Rival'));

    // Cleanup
    await fetch(`${BASE}/api/characters/${charSlug}`, { method: 'DELETE', headers: sharedAuth.headers });
});
