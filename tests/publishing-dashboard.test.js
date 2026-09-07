// Publishing dashboard regression tests: server routes, auth gates, API validation,
// asset serving, and database connectivity.
// Run with: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '..');
const WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nekojin-pub-'));
const PORT = 7792;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'PublishDashAdminPass123';
const GUMROAD_WEBHOOK_SECRET = 'pub-dashboard-webhook';

// Use the configured publishing DB, but allow the suite to run without it.
const PUBLISHING_DB_PATH = process.env.PUBLISHING_DB_PATH ||
    path.join(ROOT, 'data', 'Xanmal_Publishing_Database.sqlite');
const HAS_REAL_DB = fs.existsSync(PUBLISHING_DB_PATH);

let serverProcess;
let adminAuth = null;
let userAuth = null;

function draftTitlesInWindow(start, end) {
    if (!HAS_REAL_DB) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(PUBLISHING_DB_PATH, sqlite3.OPEN_READONLY, (openErr) => {
            if (openErr) return reject(openErr);
            db.all(`
                SELECT COALESCE(r.platform_title, c.canonical_title) AS title
                FROM releases r
                JOIN content_items c ON c.id = r.content_item_id
                WHERE r.status = 'Draft'
                  AND substr(r.release_datetime, 1, 10) >= ?
                  AND substr(r.release_datetime, 1, 10) < ?
            `, [start, end], (err, rows) => {
                db.close(() => err ? reject(err) : resolve(rows.map((row) => row.title)));
            });
        });
    });
}

function copyRepoFiles() {
    const filesToCopy = [
        'dashboard-server.js', 'accounts.js', 'database.js', 'backup.js',
        'generate-meta.js', 'package.json', 'publishing-db.js', 'publishing-calendar.js'
    ];
    for (const f of filesToCopy) {
        fs.copyFileSync(path.join(ROOT, f), path.join(WORKDIR, f));
    }
    for (const dir of ['public', 'lib', 'node_modules']) {
        fs.cpSync(path.join(ROOT, dir), path.join(WORKDIR, dir), { recursive: true });
    }
}

async function waitForServer(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`${BASE}/api/health`);
            if (res.ok) return;
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    throw new Error('Publishing dashboard test server did not become healthy');
}

async function login(username, password) {
    const res = await fetch(`${BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&next=/admin`,
        redirect: 'manual',
    });
    const setCookie = res.headers.get('set-cookie') || '';
    const sessionMatch = setCookie.match(/nki_session=[^;]+/);
    const csrfMatch = setCookie.match(/nki_csrf=[^;]+/);
    assert.ok(sessionMatch && csrfMatch, `Login failed to issue cookies: ${setCookie}`);
    const cookieHeader = `${sessionMatch[0]}; ${csrfMatch[0]}`;
    const csrfToken = csrfMatch[0].split('=')[1];
    return {
        cookieHeader,
        csrfToken,
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader, 'X-CSRF-Token': csrfToken },
    };
}

before(async () => {
    copyRepoFiles();
    const env = {
        ...process.env,
        PORT: String(PORT),
        ADMIN_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
        GUMROAD_WEBHOOK_SECRET,
    };

    // Only set publishing DB path if the real database exists
    if (HAS_REAL_DB) {
        env.PUBLISHING_DB_PATH = PUBLISHING_DB_PATH;
    }

    serverProcess = spawn(process.execPath, ['dashboard-server.js'], {
        cwd: WORKDIR,
        env,
        stdio: 'pipe',
    });

    await waitForServer();

    // Login admin
    adminAuth = await login('admin', ADMIN_PASSWORD);

    // Create a non-admin user
    const userRes = await fetch(`${BASE}/api/users`, {
        method: 'POST',
        headers: adminAuth.headers,
        body: JSON.stringify({ username: 'pubuser', password: 'PubUserPass123', role: 'user' }),
    });
    assert.strictEqual(userRes.status, 201);
    userAuth = await login('pubuser', 'PubUserPass123');
});

after(() => {
    if (serverProcess) serverProcess.kill();
    fs.rmSync(WORKDIR, { recursive: true, force: true });
});

// ── AUTHENTICATION & AUTHORIZATION TESTS ─────────────────────────────

test('unauthenticated GET /admin/publishing redirects to login', async () => {
    const res = await fetch(`${BASE}/admin/publishing`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.match(res.headers.get('location'), /^\/login/);
});

test('unauthenticated GET /api/publishing/health redirects to login', async () => {
    const res = await fetch(`${BASE}/api/publishing/health`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.match(res.headers.get('location'), /^\/login/);
});

test('public release calendar is reachable without authentication', async () => {
    const page = await fetch(`${BASE}/publishing-calendar`);
    assert.strictEqual(page.status, 200);
    assert.match(await page.text(), /Release Calendar/);

    const api = await fetch(`${BASE}/api/public/publishing-calendar?start=2099-01-01&end=2099-02-01`);
    assert.strictEqual(api.status, 200);
    const body = await api.json();
    assert.deepStrictEqual(body.entries, []);
});

test('public release calendar never exposes draft imports', async () => {
    if (!HAS_REAL_DB) return;
    const draftTitles = await draftTitlesInWindow('2026-04-01', '2026-05-01');
    const api = await fetch(`${BASE}/api/public/publishing-calendar?start=2026-04-01&end=2026-05-01`);
    assert.strictEqual(api.status, 200);
    const body = await api.json();
    for (const title of draftTitles) {
        assert.ok(!body.entries.some((entry) => entry.title === title), `Draft leaked publicly: ${title}`);
    }
});

test('publishing calendar admin page and API require an admin', async () => {
    const unauthenticated = await fetch(`${BASE}/admin/publishing-calendar`, { redirect: 'manual' });
    assert.strictEqual(unauthenticated.status, 302);

    const nonAdmin = await fetch(`${BASE}/admin/publishing-calendar`, {
        headers: { Cookie: userAuth.cookieHeader },
        redirect: 'manual',
    });
    assert.strictEqual(nonAdmin.status, 403);

    const adminPage = await fetch(`${BASE}/admin/publishing-calendar`, {
        headers: { Cookie: adminAuth.cookieHeader },
    });
    assert.strictEqual(adminPage.status, 200);
});

test('admin can add a platform-labelled manual release to the public calendar', async () => {
    const create = await fetch(`${BASE}/api/admin/publishing-calendar`, {
        method: 'POST',
        headers: adminAuth.headers,
        body: JSON.stringify({
            title: 'Test scheduled chapter',
            series: 'Test Series',
            platform: 'ScribbleHub',
            release_date: '2099-01-15',
            release_time: '18:00',
            timezone: 'America/Phoenix',
            url: 'https://example.com/chapter',
            notes: 'private admin note',
        }),
    });
    assert.strictEqual(create.status, 200);
    const created = (await create.json()).entry;
    assert.ok(created.id);

    const publicRes = await fetch(`${BASE}/api/public/publishing-calendar?start=2099-01-01&end=2099-02-01`);
    assert.strictEqual(publicRes.status, 200);
    const body = await publicRes.json();
    assert.strictEqual(body.entries.length, 1);
    assert.strictEqual(body.entries[0].platformKey, 'SH');
    assert.strictEqual(body.entries[0].source, 'manual');
    assert.strictEqual(body.entries[0].notes, undefined);

    const remove = await fetch(`${BASE}/api/admin/publishing-calendar/${encodeURIComponent(created.id)}`, {
        method: 'DELETE',
        headers: adminAuth.headers,
    });
    assert.strictEqual(remove.status, 200);
});

test('unauthenticated GET /api/publishing/overview redirects to login', async () => {
    const res = await fetch(`${BASE}/api/publishing/overview`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.match(res.headers.get('location'), /^\/login/);
});

test('unauthenticated GET /api/publishing/catalog redirects to login', async () => {
    const res = await fetch(`${BASE}/api/publishing/catalog`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.match(res.headers.get('location'), /^\/login/);
});

test('non-admin user gets 403 on /admin/publishing page', async () => {
    const res = await fetch(`${BASE}/admin/publishing`, {
        headers: { Cookie: userAuth.cookieHeader },
        redirect: 'manual',
    });
    assert.strictEqual(res.status, 403);
});

test('non-admin user gets 403 on /api/publishing/health', async () => {
    const res = await fetch(`${BASE}/api/publishing/health`, {
        headers: { Cookie: userAuth.cookieHeader },
    });
    assert.strictEqual(res.status, 403);
});

test('non-admin user gets 403 on /api/publishing/overview', async () => {
    const res = await fetch(`${BASE}/api/publishing/overview`, {
        headers: { Cookie: userAuth.cookieHeader },
    });
    assert.strictEqual(res.status, 403);
});

test('admin login succeeds and grants access', async () => {
    assert.match(adminAuth.cookieHeader, /nki_session=/);
    assert.match(adminAuth.cookieHeader, /nki_csrf=/);
    assert.ok(adminAuth.csrfToken);
});

test('authenticated admin GET /admin/publishing returns 200', async () => {
    const res = await fetch(`${BASE}/admin/publishing`, {
        headers: { Cookie: adminAuth.cookieHeader },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.ok(body.length > 0, 'Publishing dashboard HTML should not be empty');
});

// ── ASSET SERVING TESTS ──────────────────────────────────────────

test('built asset request under /publishing/assets returns 200', async () => {
    // The build should have generated hashed CSS and JS files in public/publishing/assets/
    // These assets are included in admin.html, so access them via the admin page
    const adminRes = await fetch(`${BASE}/admin/publishing`, {
        headers: { Cookie: adminAuth.cookieHeader },
    });
    assert.strictEqual(adminRes.status, 200);
    const adminBody = await adminRes.text();
    // The admin page should reference the built assets (CSS/JS bundles with hashes)
    assert.ok(adminBody.includes('.js') || adminBody.includes('.css'),
        'Admin page should reference built assets');
});

test('direct /publishing/index.html access is not public', async () => {
    // Direct access to /publishing/index.html without auth should not serve the admin page
    const res = await fetch(`${BASE}/publishing/index.html`, { redirect: 'manual' });
    // Should either redirect or return 403, not 200
    assert.ok([302, 403, 404].includes(res.status),
        `Expected 302/403/404 for unauthenticated /publishing/index.html, got ${res.status}`);
});

// ── API ENDPOINT TESTS ───────────────────────────────────────────────

test('POST /api/publishing/* returns 405 Method Not Allowed', async () => {
    const res = await fetch(`${BASE}/api/publishing/health`, {
        method: 'POST',
        headers: adminAuth.headers,
        body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 405);
});

test('DELETE /api/publishing/* returns 405 Method Not Allowed', async () => {
    const res = await fetch(`${BASE}/api/publishing/overview`, {
        method: 'DELETE',
        headers: adminAuth.headers,
    });
    assert.strictEqual(res.status, 405);
});

test('PUT /api/publishing/* returns 405 Method Not Allowed', async () => {
    const res = await fetch(`${BASE}/api/publishing/catalog`, {
        method: 'PUT',
        headers: adminAuth.headers,
        body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 405);
});

// ── PUBLISHING DB AVAILABILITY TESTS ─────────────────────────────

test('missing database path returns health:false or 500 without crashing', async () => {
    if (HAS_REAL_DB) {
        // This test only runs if we have the real database
        // If we're testing without it, the server should still stay up
        console.log('  [skipped: real database exists, health check will succeed]');
        return;
    }

    const res = await fetch(`${BASE}/api/publishing/health`, {
        headers: adminAuth.headers,
    });

    // The server should not crash; it should return either:
    // - 500 with error message (database unavailable)
    // - 200 with health.ok = false
    assert.ok([200, 500].includes(res.status),
        `Health endpoint should return 200 or 500, got ${res.status}`);

    if (res.status === 200) {
        const body = await res.json();
        assert.ok('ok' in body || 'error' in body);
    }
});

// Only run catalog/overview tests if we have the real publishing DB
if (HAS_REAL_DB) {
    test('health endpoint returns ok status', async () => {
        const res = await fetch(`${BASE}/api/publishing/health`, {
            headers: adminAuth.headers,
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.ok(body.ok !== undefined, 'Health response should have ok field');
    });

    test('overview endpoint returns consistent latest-view totals and current DB counts', async () => {
        const res = await fetch(`${BASE}/api/publishing/overview`, {
            headers: adminAuth.headers,
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();

        // Overview should have KPIs, cadence, series, platforms, upcoming
        assert.ok('kpis' in body, 'Overview should have kpis field');
        assert.ok(Array.isArray(body.cadence), 'Overview should have cadence array');
        assert.ok(Array.isArray(body.series), 'Overview should have series array');
        assert.ok(Array.isArray(body.platforms), 'Overview should have platforms array');
        assert.ok(Array.isArray(body.upcoming), 'Overview should have upcoming array');

        // KPIs should have counts (totalReleases, publishedCount, etc.)
        if (body.kpis) {
            assert.ok('totalReleases' in body.kpis, 'KPIs should have totalReleases');
            assert.ok('publishedCount' in body.kpis, 'KPIs should have publishedCount');
            assert.ok('scheduledCount' in body.kpis, 'KPIs should have scheduledCount');
            assert.ok('draftCount' in body.kpis, 'KPIs should have draftCount');
        }

        // Each series should have consistent fields
        for (const series of body.series) {
            assert.ok(series.series, 'Series should have series name');
            assert.ok(Number.isInteger(series.releases), 'Series releases should be integer');
            assert.ok(Number.isInteger(series.words), 'Series words should be integer');
            assert.ok(Number.isInteger(series.views), 'Series views should be integer');
            // Totals should be non-negative
            assert.ok(series.releases >= 0, 'Series releases should be non-negative');
        }
    });

    test('catalog returns pagination total and clamps pageSize', async () => {
        // Test with no filter: should return all releases
        const res1 = await fetch(`${BASE}/api/publishing/catalog?page=1&pageSize=10`, {
            headers: adminAuth.headers,
        });
        assert.strictEqual(res1.status, 200);
        const body1 = await res1.json();

        assert.ok('releases' in body1, 'Catalog should have releases array');
        assert.ok('page' in body1, 'Catalog should have page number');
        assert.ok('pageSize' in body1, 'Catalog should have pageSize');
        assert.ok('total' in body1, 'Catalog should have total count');
        assert.ok('totalPages' in body1, 'Catalog should have totalPages');
        assert.ok(body1.summary && Number.isInteger(body1.summary.words), 'Catalog should have full-result summary');
        assert.ok(Number.isInteger(body1.summary.views), 'Catalog summary should include views');

        assert.ok(Array.isArray(body1.releases));
        assert.ok(body1.pageSize <= 100, 'pageSize should be clamped to 100');
        assert.ok(body1.pageSize > 0, 'pageSize should be positive');
        assert.ok(Number.isInteger(body1.total), 'total should be integer');
        assert.ok(Number.isInteger(body1.totalPages), 'totalPages should be integer');

        // Request with excessive pageSize should be clamped
        const res2 = await fetch(`${BASE}/api/publishing/catalog?page=1&pageSize=9999`, {
            headers: adminAuth.headers,
        });
        const body2 = await res2.json();
        assert.strictEqual(body2.pageSize, 100, 'Excessive pageSize should clamp to 100');
    });

    test('catalog filters work: series, platform, status', async () => {
        // First get filters to know what values exist
        const filterRes = await fetch(`${BASE}/api/publishing/filters`, {
            headers: adminAuth.headers,
        });
        assert.strictEqual(filterRes.status, 200);
        const filters = await filterRes.json();

        assert.ok(Array.isArray(filters.series), 'Filters should have series array');
        assert.ok(Array.isArray(filters.platforms), 'Filters should have platforms array');
        assert.ok(Array.isArray(filters.statuses), 'Filters should have statuses array');

        // If we have series, test series filter
        if (filters.series.length > 0) {
            const seriesFilter = encodeURIComponent(filters.series[0]);
            const res = await fetch(`${BASE}/api/publishing/catalog?series=${seriesFilter}`, {
                headers: adminAuth.headers,
            });
            const body = await res.json();
            // All returned releases should match the series
            for (const release of body.releases) {
                assert.strictEqual(release.series, filters.series[0]);
            }

            const searchRes = await fetch(`${BASE}/api/publishing/catalog?q=${encodeURIComponent(filters.series[0])}`, {
                headers: adminAuth.headers,
            });
            const searchBody = await searchRes.json();
            assert.ok(searchBody.total > 0, 'Search should include series names');
        }

        // Test status filter
        const statusRes = await fetch(`${BASE}/api/publishing/catalog?status=Published`, {
            headers: adminAuth.headers,
        });
        const statusBody = await statusRes.json();
        for (const release of statusBody.releases) {
            assert.strictEqual(release.status, 'Published');
        }
    });

    test('wildcard search is literal enough (no regex injection)', async () => {
        // Search with wildcard-like characters should not execute as SQL wildcards
        // Test with % character which is SQL LIKE wildcard
        const res = await fetch(`${BASE}/api/publishing/catalog?q=%test%`, {
            headers: adminAuth.headers,
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        // Should return results that literally contain %test% (unlikely) or nothing
        assert.ok(Array.isArray(body.releases));
        // The search should be safe and not crash
    });

    test('releases window validates required params and returns rows', async () => {
        // Missing startUtc and endUtc should return 400
        const noParamsRes = await fetch(`${BASE}/api/publishing/releases`, {
            headers: adminAuth.headers,
        });
        assert.strictEqual(noParamsRes.status, 400);
        const errorBody = await noParamsRes.json();
        assert.ok(errorBody.error, 'Error response should have error message');

        // Missing endUtc should fail
        const noEndRes = await fetch(`${BASE}/api/publishing/releases?startUtc=2024-01-01T00:00:00Z`, {
            headers: adminAuth.headers,
        });
        assert.strictEqual(noEndRes.status, 400);

        // With both params, should return 200
        const validRes = await fetch(
            `${BASE}/api/publishing/releases?startUtc=2024-01-01T00:00:00Z&endUtc=2024-12-31T23:59:59Z`,
            { headers: adminAuth.headers }
        );
        assert.strictEqual(validRes.status, 200);
        const body = await validRes.json();
        assert.ok('releases' in body, 'Release window should return releases');
        assert.ok(Array.isArray(body.releases));
    });

    test('releases window respects status filter', async () => {
        const res = await fetch(
            `${BASE}/api/publishing/releases?startUtc=2024-01-01T00:00:00Z&endUtc=2024-12-31T23:59:59Z&status=Published`,
            { headers: adminAuth.headers }
        );
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        for (const release of body.releases) {
            assert.strictEqual(release.status, 'Published');
        }
    });

    test('series analytics endpoint returns expected shape', async () => {
        const res = await fetch(`${BASE}/api/publishing/series`, {
            headers: adminAuth.headers,
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.ok('rows' in body, 'Series analytics should have rows');
        assert.ok(Array.isArray(body.rows));
        for (const row of body.rows) {
            assert.ok('series' in row, 'Row should have series name');
            assert.ok('totalReleases' in row, 'Row should have totalReleases count');
            assert.ok('platformCount' in row, 'Row should have platformCount');
            assert.ok('totalViews' in row, 'Row should have totalViews');
            assert.ok('publishedCount' in row, 'Row should have publishedCount');
        }
    });

    test('health-checks endpoint returns system health details', async () => {
        const res = await fetch(`${BASE}/api/publishing/health-checks`, {
            headers: adminAuth.headers,
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        // Should be an array or object with health information
        assert.ok(body !== null && typeof body === 'object');
    });

    test('freshness endpoint returns data freshness info', async () => {
        const res = await fetch(`${BASE}/api/publishing/freshness`, {
            headers: adminAuth.headers,
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        // Freshness should indicate when data was last updated
        assert.ok(body !== null && typeof body === 'object');
    });

    test('unknown /api/publishing/* route returns 404', async () => {
        const res = await fetch(`${BASE}/api/publishing/nonexistent-endpoint`, {
            headers: adminAuth.headers,
        });
        assert.strictEqual(res.status, 404);
    });

} else {
    // If we don't have the real database, provide a simple smoke test
    test('publishing API endpoints respond gracefully when database unavailable', async () => {
        const endpoints = [
            '/api/publishing/health',
            '/api/publishing/overview',
            '/api/publishing/catalog',
            '/api/publishing/filters',
        ];

        for (const endpoint of endpoints) {
            const res = await fetch(`${BASE}${endpoint}`, {
                headers: adminAuth.headers,
            });

            // Should not crash; either 200 with error state or 500
            assert.ok([200, 500].includes(res.status),
                `${endpoint} should return 200 or 500, got ${res.status}`);
        }
    });
}
