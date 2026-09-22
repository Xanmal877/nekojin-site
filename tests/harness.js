// Shared harness for the suites that boot a throwaway copy of the server.
//
// Every one of those suites needs the same four things: an isolated working
// directory holding copies of the server files, the copied server spawned on
// its own port, a wait-for-healthy poll, and a login that hands back the
// session + CSRF cookies. Keeping one copy means a new suite is a few lines
// instead of another 60-line preamble.
//
// The working directory deliberately gets COPIES (not symlinks) of the server
// files: suites mutate accounts.json / the database in there, and must never
// touch the real ones.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Everything the server needs at runtime. publishing-db.js and
// publishing-calendar.js are loaded lazily by the server, so copying them is
// harmless for suites that don't exercise the publishing dashboard and
// required for the one that does.
const SERVER_FILES = [
    'dashboard-server.js',
    'accounts.js',
    'database.js',
    'backup.js',
    'generate-meta.js',
    'publishing-db.js',
    'publishing-calendar.js',
    'package.json'
];

const SERVER_DIRS = ['public', 'lib'];

// node_modules is the one thing worth linking rather than copying: it is large
// and read-only for these tests. Its contents are already installed natively,
// so a link resolves the same as the real directory.
function copyRepoFiles(workdir) {
    for (const file of SERVER_FILES) {
        fs.copyFileSync(path.join(ROOT, file), path.join(workdir, file));
    }
    for (const dir of SERVER_DIRS) {
        fs.cpSync(path.join(ROOT, dir), path.join(workdir, dir), { recursive: true });
    }
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(workdir, 'node_modules'));
}

// Start an isolated server. Returns the child process plus the helpers bound to
// its port, so callers never have to rebuild a base URL or a cookie jar.
async function startTestServer({ prefix, port, adminPassword, webhookSecret, extraEnv = {} }) {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    copyRepoFiles(workdir);

    const base = `http://127.0.0.1:${port}`;
    const proc = spawn(process.execPath, ['dashboard-server.js'], {
        cwd: workdir,
        env: {
            ...process.env,
            PORT: String(port),
            ADMIN_BOOTSTRAP_USER: 'admin',
            ADMIN_BOOTSTRAP_PASSWORD: adminPassword,
            GUMROAD_WEBHOOK_SECRET: webhookSecret,
            ...extraEnv
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const stop = () => {
        proc.kill('SIGKILL');
        fs.rmSync(workdir, { recursive: true, force: true });
    };

    // Keep a bounded tail rather than growing a string for the whole run; the
    // startup-warning test only ever looks at the end of it.
    const OUTPUT_LIMIT = 64 * 1024;
    let output = '';
    const capture = d => {
        output += d;
        if (output.length > OUTPUT_LIMIT) output = output.slice(-OUTPUT_LIMIT);
    };
    proc.stdout.on('data', capture);
    proc.stderr.on('data', capture);

    let healthy = false;
    for (let waited = 0; waited < 10000; waited += 100) {
        try {
            if ((await fetch(`${base}/api/health`)).ok) { healthy = true; break; }
        } catch {}
        await new Promise(r => setTimeout(r, 100));
    }

    if (!healthy) {
        // Don't hand back a dead server: a suite that never binds would
        // otherwise burn its timeouts and leak the child plus the workdir.
        stop();
        throw new Error(`test server never became healthy on ${base}\n${output.slice(-2000)}`);
    }

    return {
        proc,
        workdir,
        base,
        get output() { return output; },
        stop
    };
}

// Log in and return headers that satisfy both the session and CSRF gates.
// `set-cookie` can arrive as one combined header, so split it on the commas
// that separate cookies rather than on every comma.
function authHeadersFromResponse(res) {
    const setCookie = res.headers.get('set-cookie') || '';
    const cookies = setCookie.split(/,(?=[^;]+=[^;]+)/);
    const session = cookies.find(c => c.includes('nki_session'));
    const csrf = cookies.find(c => c.includes('nki_csrf'));
    const cookieHeader = [session, csrf].filter(Boolean).map(c => c.split(';')[0]).join('; ');
    const csrfToken = csrf ? csrf.split(';')[0].split('=')[1] : '';
    return {
        cookieHeader,
        csrfToken,
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader, 'X-CSRF-Token': csrfToken }
    };
}

async function loginAs(base, username, password) {
    const res = await fetch(`${base}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&next=/admin`,
        redirect: 'manual'
    });
    return { status: res.status, ...authHeadersFromResponse(res) };
}

module.exports = { ROOT, copyRepoFiles, startTestServer, loginAs, authHeadersFromResponse };
