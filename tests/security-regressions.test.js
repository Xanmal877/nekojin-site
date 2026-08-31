// Request-level regression checks in an isolated throwaway server/database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nekojin-security-'));
const PORT = 7790 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'RegressionAdminPass123';
let serverProcess;

function copyRepoFiles() {
    for (const file of ['dashboard-server.js', 'accounts.js', 'database.js', 'backup.js', 'generate-meta.js', 'package.json']) {
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
        env: { ...process.env, PORT: String(PORT), ADMIN_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD },
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
    const settings = await fetch(`${BASE}/api/settings`, { method: 'POST', headers: admin.headers,
        body: JSON.stringify({ gumroad_seller_id: 'seller-regression' }) });
    assert.equal(settings.status, 200);
    const invalid = await fetch(`${BASE}/webhook/gumroad`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'product_name=Bad&price=not-cents&currency=USD&sale_id=bad-1&seller_id=seller-regression'
    });
    assert.equal(invalid.status, 403);
    const save = await fetch(`${BASE}/save-content`, { method: 'POST', headers: admin.headers,
        body: JSON.stringify({ series: [{ id: 'backup-series', universe: 'Backup Test' }], books: [], game: [], about: {} }) });
    assert.equal(save.status, 200);
    const status = await fetch(`${BASE}/api/backup/status`, { headers: admin.headers });
    assert.equal(status.status, 200);
    const backups = await status.json();
    assert.ok(backups.count >= 1, 'save-content should leave a recoverable backup');
    assert.ok(backups.backups.some(file => file.name.endsWith('.db')));
});
