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
        for (const [id, s] of Object.entries(raw)) {
            if (now - s.createdAt < SESSION_TTL) sessions.set(id, s);
        }
    } catch {}
}

function saveSessions() {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2));
    } catch {}
}

function createSession(username) {
    const id = crypto.randomBytes(32).toString('hex');
    sessions.set(id, { createdAt: Date.now(), username });
    saveSessions();
    return id;
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

function createUser(username, password) {
    const db = loadUsers();
    if (db.users[username]) return false;
    db.users[username] = {
        passwordHash: bcrypt.hashSync(password, SALT_ROUNDS),
        role: 'user',
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
            u.role = (name === 'xanmal') ? 'admin' : 'user';
            migrated = true;
        }
    }
    if (!db.users['xanmal']) {
        db.users['xanmal'] = {
            passwordHash: bcrypt.hashSync('nekojin2026', SALT_ROUNDS),
            role: 'admin',
            createdAt: Date.now()
        };
        migrated = true;
        console.log('Created default admin user: xanmal');
    }
    if (migrated) saveUsers(db);
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
    // Users
    findUser,
    createUser,
    verifyUser,
    getUserRole,
    isAdmin,
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