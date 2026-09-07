// Request-level regression checks in an isolated throwaway server/database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '..');
const WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nekojin-security-'));
const PORT = 7790 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'RegressionAdminPass123';
const GUMROAD_WEBHOOK_SECRET = 'regression-webhook-secret';
let serverProcess;

function copyRepoFiles() {
    for (const file of ['dashboard-server.js', 'accounts.js', 'database.js', 'backup.js', 'generate-meta.js', 'package.json', 'publishing-calendar.js']) {
        fs.copyFileSync(path.join(ROOT, file), path.join(WORKDIR, file));
    }
    for (const dir of ['public', 'lib', 'node_modules']) {
        fs.cpSync(path.join(ROOT, dir), path.join(WORKDIR, dir), { recursive: true });
    }
}

async function waitForServer() {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(`${BASE}/api/health`)).ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('isolated server did not become healthy');
}

function authFromResponse(res) {
    const setCookie = res.headers.get('set-cookie') || '';
    const session = setCookie.match(/nki_session=[^;]+/);
    const csrf = setCookie.match(/nki_csrf=[^;]+/);
    assert.ok(session && csrf, `login did not issue expected cookies: ${setCookie}`);
    const cookieHeader = `${session[0]}; ${csrf[0]}`;
    return { cookieHeader, headers: { 'Content-Type': 'application/json', Cookie: cookieHeader, 'X-CSRF-Token': csrf[0].split('=')[1] } };
}

async function login(username, password) {
    const res = await fetch(`${BASE}/login`, {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&next=/admin`
    });
    assert.equal(res.status, 302);
    return authFromResponse(res);
}

let admin;
let user;

before(async () => {
    copyRepoFiles();
    serverProcess = spawn(process.execPath, ['dashboard-server.js'], {
        cwd: WORKDIR,
        env: { ...process.env, PORT: String(PORT), ADMIN_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD, GUMROAD_WEBHOOK_SECRET },
        stdio: 'ignore'
    });
    await waitForServer();
    admin = await login('admin', ADMIN_PASSWORD);
    const create = await fetch(`${BASE}/api/users`, {
        method: 'POST', headers: admin.headers,
        body: JSON.stringify({ username: 'limited', password: 'LimitedUserPass123', role: 'user' })
    });
    assert.equal(create.status, 201);
    user = await login('limited', 'LimitedUserPass123');
});

after(() => {
    if (serverProcess) serverProcess.kill();
    fs.rmSync(WORKDIR, { recursive: true, force: true });
});

test('non-admin sessions cannot access admin-only APIs or save content', async () => {
    assert.equal((await fetch(`${BASE}/admin`, { headers: { Cookie: user.cookieHeader }, redirect: 'manual' })).status, 403);
    assert.equal((await fetch(`${BASE}/api/settings`, { headers: { Cookie: user.cookieHeader }, redirect: 'manual' })).status, 403);
    assert.equal((await fetch(`${BASE}/api/backup`, { method: 'POST', headers: user.headers })).status, 403);
    assert.equal((await fetch(`${BASE}/save-content`, {
        method: 'POST', headers: user.headers, body: JSON.stringify({ series: [], books: [], game: [], about: {} })
    })).status, 403);
});

test('admin-created usernames must match the safe format and cannot inject markup', async () => {
    const malicious = [
        '"><script>alert(1)</script>',
        "'; alert(1); //",
        'ab',            // too short
        'a'.repeat(33),  // too long
        'has space',
        'dash-name',
        'dot.name',
        'semi;colon',
    ];
    for (const bad of malicious) {
        const res = await fetch(`${BASE}/api/users`, {
            method: 'POST', headers: admin.headers,
            body: JSON.stringify({ username: bad, password: 'ValidPass123', role: 'user' })
        });
        assert.equal(res.status, 400, `expected 400 for username ${JSON.stringify(bad)}`);
    }

    // A valid username still succeeds, so the format check is not over-broad.
    const ok = await fetch(`${BASE}/api/users`, {
        method: 'POST', headers: admin.headers,
        body: JSON.stringify({ username: 'valid_user_1', password: 'ValidPass123', role: 'user' })
    });
    assert.equal(ok.status, 201);
    const listed = await (await fetch(`${BASE}/api/users`, { headers: admin.headers })).json();
    assert.equal(listed.some(u => u.username === 'valid_user_1'), true);
});

test('accounts.createUser rejects malicious usernames at the module boundary', async () => {
    // Run in a child process so accounts.js's session-cleanup interval does not
    // keep this test's event loop alive. The child uses its own isolated
    // users.json (no concurrent-write races with the running server).
    const isolated = path.join(WORKDIR, 'isolated-accounts');
    fs.mkdirSync(isolated, { recursive: true });
    fs.copyFileSync(path.join(WORKDIR, 'accounts.js'), path.join(isolated, 'accounts.js'));

    const script = `
        const accounts = require(${JSON.stringify(path.join(isolated, 'accounts.js'))});
        const malicious = ['"><script>alert(1)</script>', 'ab', 'has space', 'dot.name'];
        for (const bad of malicious) {
            if (accounts.createUser(bad, 'ValidPass123') !== false) {
                console.error('expected createUser to reject ' + JSON.stringify(bad));
                process.exit(1);
            }
        }
        if (accounts.createUser('module_boundary_ok', 'ValidPass123') !== true) {
            console.error('valid username should create successfully');
            process.exit(1);
        }
        if (accounts.findUser('module_boundary_ok') === null) {
            console.error('created user should be findable');
            process.exit(1);
        }
        process.exit(0);
    `;

    const result = await new Promise((resolve) => {
        const child = spawn(process.execPath, ['-e', script], { cwd: WORKDIR, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', d => out += d);
        child.stderr.on('data', d => out += d);
        child.on('close', code => resolve({ code, out }));
    });
    assert.equal(result.code, 0, `module-boundary check failed:\n${result.out}`);
    fs.rmSync(isolated, { recursive: true, force: true });
});

test('public APIs hide invisible details from non-admin requests', async () => {
    const hiddenChar = await fetch(`${BASE}/api/characters`, { method: 'POST', headers: admin.headers,
        body: JSON.stringify({ id: 'hidden-char', slug: 'hidden-char', name: 'Hidden', content: 'secret', visible: false }) });
    assert.equal(hiddenChar.status, 200);
    const hiddenLore = await fetch(`${BASE}/api/lore-topics`, { method: 'POST', headers: admin.headers,
        body: JSON.stringify({ id: 'hidden-lore', slug: 'hidden-lore', section: 'world', title: 'Hidden', content: 'secret', visible: false }) });
    assert.equal(hiddenLore.status, 200);
    assert.equal((await fetch(`${BASE}/api/characters/hidden-char`)).status, 404);
    assert.equal((await fetch(`${BASE}/api/lore-topics/hidden-lore`)).status, 404);
    const characters = await (await fetch(`${BASE}/api/characters`, { headers: { Cookie: user.cookieHeader } })).json();
    assert.equal(characters.some(x => x.slug === 'hidden-char'), false);
});

test('changing a user role revokes that user’s existing session', async () => {
    const revoke = await fetch(`${BASE}/api/users/limited/role`, {
        method: 'POST', headers: admin.headers, body: JSON.stringify({ role: 'admin' })
    });
    assert.equal(revoke.status, 200);
    const stale = await fetch(`${BASE}/api/settings`, { headers: { Cookie: user.cookieHeader }, redirect: 'manual' });
    assert.equal(stale.status, 302);
    assert.match(stale.headers.get('location'), /^\/login/);
});

test('invalid Gumroad payloads are rejected and save creates a backup', async () => {
    console.log('DBG: 6th test start');
    const settings = await fetch(`${BASE}/api/settings`, { method: 'POST', headers: admin.headers,
        body: JSON.stringify({ gumroad_seller_id: 'seller-regression' }) });
    console.log('DBG: settings', settings.status);
    assert.equal(settings.status, 200);

    const missingSecret = await fetch(`${BASE}/webhook/gumroad`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'product_name=Forged&price=1000&currency=USD&sale_id=forged-1&seller_id=seller-regression'
    });
    console.log('DBG: missingSecret', missingSecret.status);
    assert.equal(missingSecret.status, 403);

    const invalid = await fetch(`${BASE}/webhook/gumroad`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Gumroad-Webhook-Secret': GUMROAD_WEBHOOK_SECRET },
        body: 'product_name=Bad&price=not-cents&currency=USD&sale_id=bad-1&seller_id=seller-regression'
    });
    console.log('DBG: invalid', invalid.status);
    assert.equal(invalid.status, 403);
    console.log('DBG: about to save-content');
    const save = await fetch(`${BASE}/save-content`, { method: 'POST', headers: admin.headers,
        body: JSON.stringify({ series: [{ id: 'backup-series', universe: 'Backup Test' }], books: [], game: [], about: {} }) });
    console.log('DBG: save', save.status);
    assert.equal(save.status, 200);
    const status = await fetch(`${BASE}/api/backup/status`, { headers: admin.headers });
    console.log('DBG: status', status.status);
    assert.equal(status.status, 200);
    const backups = await status.json();
    assert.ok(backups.count >= 1, 'save-content should leave a recoverable backup');
    assert.ok(backups.backups.some(file => file.name.endsWith('.db')));
    console.log('DBG: 6th test done');
});

test('static paths cannot use encoded traversal to reach private data', async () => {
    const res = await fetch(`${BASE}/covers/%2e%2e/data/lore/compendium.md`);
    assert.equal(res.status, 403);
});

test('wiki sources remain available only through their approved APIs', async () => {
    const compendium = await fetch(`${BASE}/api/compendium`);
    assert.equal(compendium.status, 200);
    assert.match(await compendium.text(), /Xanrea Lore Compendium/);

    const character = await fetch(`${BASE}/api/wiki/tama`);
    assert.equal(character.status, 200);
    assert.ok((await character.text()).length > 0);
});

test('public /api/xanrean redacts the Gumroad access token but admin /api/settings keeps it', async () => {
    // Seed a token through the admin settings API.
    const set = await fetch(`${BASE}/api/settings`, { method: 'POST', headers: admin.headers,
        body: JSON.stringify({ gumroad_access_token: 'super-secret-token-123' }) });
    assert.equal(set.status, 200);

    // Public endpoint must not leak the token.
    const pub = await (await fetch(`${BASE}/api/xanrean`)).json();
    assert.equal(pub.gumroad_access_token, undefined);
    assert.equal('gumroad_access_token' in pub, false);

    // Admin endpoint still returns it for the settings editor.
    const priv = await (await fetch(`${BASE}/api/settings`, { headers: admin.headers })).json();
    assert.equal(priv.gumroad_access_token, 'super-secret-token-123');
});

test('protocol-relative and CRLF login redirects are rejected', async () => {
    const protoRel = await fetch(`${BASE}/login`, {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=admin&password=${encodeURIComponent(ADMIN_PASSWORD)}&next=//evil.example.com`
    });
    assert.equal(protoRel.status, 302);
    assert.equal(protoRel.headers.get('location'), '/admin');

    const crlf = await fetch(`${BASE}/login`, {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=admin&password=${encodeURIComponent(ADMIN_PASSWORD)}&next=%2Fadmin%0d%0aX-Evil:%20yes`
    });
    assert.equal(crlf.status, 302);
    assert.equal(crlf.headers.get('location'), '/admin');
});

test('public /content hides books and games that are not explicitly visible', async () => {
    const seed = await fetch(`${BASE}/save-content`, { method: 'POST', headers: admin.headers,
        body: JSON.stringify({
            series: [],
            books: [
                { id: 'vis-book', title: 'Visible Book', slug: 'visible-book', status: 'published', visible: true },
                { id: 'inv-book', title: 'Invisible Book', slug: 'invisible-book', status: 'published', visible: false },
            ],
            game: [
                { id: 'vis-game', title: 'Visible Game', visible: true },
                { id: 'inv-game', title: 'Invisible Game', visible: false },
            ],
            about: {},
        }) });
    assert.equal(seed.status, 200);

    const content = await (await fetch(`${BASE}/content`)).json();
    assert.equal(content.books.some(b => b.id === 'vis-book'), true);
    assert.equal(content.books.some(b => b.id === 'inv-book'), false);
    assert.equal(content.game.some(g => g.id === 'vis-game'), true);
    assert.equal(content.game.some(g => g.id === 'inv-game'), false);
});

test('calendar URLs are restricted to http(s) schemes', async () => {
    const bad = await fetch(`${BASE}/api/admin/publishing-calendar`, {
        method: 'POST', headers: admin.headers,
        body: JSON.stringify({
            title: 'Bad URL', series: 'Test', platform: 'Other',
            release_date: '2099-03-01', url: 'javascript:alert(1)'
        }),
    });
    assert.equal(bad.status, 400);

    const good = await fetch(`${BASE}/api/admin/publishing-calendar`, {
        method: 'POST', headers: admin.headers,
        body: JSON.stringify({
            title: 'Good URL', series: 'Test', platform: 'Other',
            release_date: '2099-03-02', url: 'https://example.com/chapter'
        }),
    });
    assert.equal(good.status, 200);
    const created = (await good.json()).entry;

    // Simulate a legacy row that predates URL validation. Public responses
    // must still drop unsafe schemes at the serialization boundary.
    await new Promise((resolve, reject) => {
        const db = new sqlite3.Database(path.join(WORKDIR, 'data', 'publishing-calendar.db'));
        db.run('UPDATE publishing_calendar SET url = ? WHERE id = ?', ['javascript:alert(1)', created.id], err => {
            db.close(closeErr => closeErr ? reject(closeErr) : (err ? reject(err) : resolve()));
        });
    });
    const publicCalendar = await (await fetch(`${BASE}/api/public/publishing-calendar?start=2099-03-02&end=2099-03-03`)).json();
    assert.equal(publicCalendar.entries.find(entry => entry.id === created.id).url, null);

    await fetch(`${BASE}/api/admin/publishing-calendar/${created.id}`, { method: 'DELETE', headers: admin.headers });
});
