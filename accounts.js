/**
 * accounts.js - Authentication and user management module
 * Extracted from dashboard-server.js for modularity
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// ── CONFIG ──────────────────────────────────────────────
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days
const SALT_ROUNDS = 10;

// ── PATHS ───────────────────────────────────────────────
const USERS_FILE = path.join(__dirname, 'users.json');
const USER_KEYS_FILE = path.join(__dirname, 'user-keys.json');
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

// Ensure files exist
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}');

// ── SESSIONS ────────────────────────────────────────────
const sessions = new Map();

function loadSessions() {
    try {
        const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        const now = Date.now();
        let cleaned = false;
        for (const [id, s] of Object.entries(raw)) {
            if (now - s.createdAt < SESSION_TTL) {
                sessions.set(id, s);
            } else {
                cleaned = true;
            }
        }
        // Save cleaned file if we removed expired sessions
        if (cleaned) saveSessions();
    } catch {}
}

function cleanupExpiredSessions() {
    try {
        const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        const now = Date.now();
        let removed = 0;
        
        for (const [id, s] of Object.entries(raw)) {
            if (now - s.createdAt > SESSION_TTL) {
                delete raw[id];
                sessions.delete(id);
                removed++;
            }
        }
        
        if (removed > 0) {
            fs.writeFileSync(SESSIONS_FILE, JSON.stringify(raw, null, 2));
            console.log(`Session cleanup: removed ${removed} expired sessions`);
        }
    } catch (e) {
        console.error('Session cleanup error:', e);
    }
}

// Run cleanup every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

function saveSessions() {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2));
        fs.chmodSync(SESSIONS_FILE, 0o600);
    } catch {}
}

function createSession(username) {
    const id = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    sessions.set(id, { createdAt: Date.now(), username, csrfToken });
    saveSessions();
    return id;
}

function getSessionCsrfToken(id) {
    const s = sessions.get(id);
    if (!s) return null;
    // Lazily backfill sessions created before CSRF tokens existed, so
    // already-logged-in users aren't forced to re-authenticate.
    if (!s.csrfToken) {
        s.csrfToken = crypto.randomBytes(24).toString('hex');
        saveSessions();
    }
    return s.csrfToken;
}

function isValidCsrfToken(sessionId, token) {
    const s = sessions.get(sessionId);
    if (!s || !s.csrfToken || !token) return false;
    const a = Buffer.from(String(s.csrfToken));
    const b = Buffer.from(String(token));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function isValidSession(id) {
    const s = sessions.get(id);
    if (!s) return false;
    if (Date.now() - s.createdAt > SESSION_TTL) {
        sessions.delete(id);
        saveSessions();
        return false;
    }
    return true;
}

function getSessionUser(id) {
    const s = sessions.get(id);
    return s ? s.username : null;
}

function deleteSession(id) {
    sessions.delete(id);
    saveSessions();
}

// ── USERS ───────────────────────────────────────────────
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

function createUser(username, password, role = 'user') {
    const db = loadUsers();
    if (db.users[username]) return false;
    db.users[username] = {
        passwordHash: bcrypt.hashSync(password, SALT_ROUNDS),
        role: role,
        createdAt: Date.now()
    };
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

function ensureAdminUser() {
    const db = loadUsers();
    let migrated = false;
    for (const [name, u] of Object.entries(db.users)) {
        if (!u.role) {
            u.role = 'user'; // legacy accounts default to non-admin; promote explicitly via /api/users
            migrated = true;
        }
    }

    // Only bootstrap an admin account on a genuinely fresh install (no users at all).
    // No hardcoded credentials: use ADMIN_BOOTSTRAP_USER/ADMIN_BOOTSTRAP_PASSWORD env vars,
    // or fall back to a randomly generated password printed once to the console.
    if (Object.keys(db.users).length === 0) {
        const bootstrapUser = process.env.ADMIN_BOOTSTRAP_USER || 'admin';
        const usedEnvPassword = !!process.env.ADMIN_BOOTSTRAP_PASSWORD;
        const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || crypto.randomBytes(12).toString('base64url');

        db.users[bootstrapUser] = {
            passwordHash: bcrypt.hashSync(bootstrapPassword, SALT_ROUNDS),
            role: 'admin',
            createdAt: Date.now()
        };
        migrated = true;

        if (usedEnvPassword) {
            console.log(`Created initial admin user "${bootstrapUser}" from ADMIN_BOOTSTRAP_PASSWORD env var.`);
        } else {
            console.log('='.repeat(64));
            console.log(`No users found. Created initial admin user: ${bootstrapUser}`);
            console.log(`Generated password: ${bootstrapPassword}`);
            console.log('Save this now — it will not be shown again. Log in and change it,');
            console.log('or set ADMIN_BOOTSTRAP_USER / ADMIN_BOOTSTRAP_PASSWORD env vars before');
            console.log('first boot to control the initial credentials.');
            console.log('='.repeat(64));
        }
    }

    if (migrated) saveUsers(db);
}

// ── USER MANAGEMENT ────────────────────────────────────
function listAllUsers() {
    const db = loadUsers();
    return Object.entries(db.users).map(([username, user]) => ({
        username,
        role: user.role || 'user',
        createdAt: user.createdAt
    }));
}

function deleteUser(username) {
    const db = loadUsers();
    if (!db.users[username]) return false;
    delete db.users[username];
    saveUsers(db);
    return true;
}

function resetPassword(username, newPassword) {
    const db = loadUsers();
    if (!db.users[username]) return false;
    db.users[username].passwordHash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
    saveUsers(db);
    return true;
}

function setUserRole(username, role) {
    const db = loadUsers();
    if (!db.users[username]) return false;
    db.users[username].role = role;
    saveUsers(db);
    return true;
}

// True if `username` is an admin and removing/demoting them would leave
// zero admin accounts — used to block deletes/role-changes that would lock
// everyone out of the admin panel with no recovery path.
function isLastAdmin(username) {
    const db = loadUsers();
    const user = db.users[username];
    if (!user || (user.role || 'user') !== 'admin') return false;
    const adminCount = Object.values(db.users).filter(u => (u.role || 'user') === 'admin').length;
    return adminCount <= 1;
}

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

// ── REQUEST HELPERS ─────────────────────────────────────
function parseCookies(h) {
    const c = {};
    if (!h) return c;
    h.split(';').forEach(p => {
        const [k, ...v] = p.trim().split('=');
        if (k) c[k.trim()] = decodeURIComponent(v.join('=').trim());
    });
    return c;
}

function getSessionId(req) {
    return parseCookies(req.headers['cookie'])['nki_session'] || null;
}

function isAuthenticated(req) {
    const sid = getSessionId(req);
    return sid && isValidSession(sid);
}

function getUsername(req) {
    const sid = getSessionId(req);
    return getSessionUser(sid);
}

// Initialize sessions on load
loadSessions();
ensureAdminUser();

// ── EXPORTS ───────────────────────────────────────────
module.exports = {
    // Sessions
    createSession,
    isValidSession,
    getSessionUser,
    deleteSession,
    cleanupExpiredSessions,
    getSessionCsrfToken,
    isValidCsrfToken,
    // Users
    findUser,
    createUser,
    verifyUser,
    getUserRole,
    isAdmin,
    // User management
    listAllUsers,
    deleteUser,
    resetPassword,
    setUserRole,
    isLastAdmin,
    // User keys
    getUserKeys,
    setUserKey,
    // Request helpers
    parseCookies,
    getSessionId,
    isAuthenticated,
    getUsername,
    // Constants
    SESSION_TTL
};