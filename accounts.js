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

// ── ATOMIC WRITE HELPERS ────────────────────────────────
/**
 * Write JSON atomically using temp file + rename pattern (synchronous).
 * Validates the JSON before committing the write.
 * Logs detailed errors for observability.
 * @param {string} filePath - Target file path
 * @param {object} data - Data to serialize
 * @returns {boolean} - True if write succeeded
 */
function atomicWriteSync(filePath, data) {
    try {
        // Serialize and validate
        const json = JSON.stringify(data, null, 2);
        const parsed = JSON.parse(json); // Verify roundtrip
        if (!parsed) throw new Error('Deserialized data is falsy');

        // Atomic write via temp + rename
        const tempPath = `${filePath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
        fs.writeFileSync(tempPath, json, { flag: 'w' });

        // Chmod before rename for consistency
        try {
            fs.chmodSync(tempPath, 0o600);
        } catch (e) {
            console.warn(`[PERSISTENCE] Failed to chmod ${tempPath}:`, e.message);
        }

        // Atomic rename
        fs.renameSync(tempPath, filePath);
        return true;
    } catch (err) {
        const msg = `Atomic write failed for ${path.basename(filePath)}: ${err.message}`;
        console.error(`[PERSISTENCE] ${msg}`);
        return false;
    }
}

/**
 * Read and validate JSON with graceful fallback (synchronous).
 * Returns both the data and whether the file was valid.
 * @param {string} filePath - File to read
 * @param {object} fallback - Default to return if parsing fails
 * @returns {{data: object, valid: boolean, error?: string}}
 */
function readJsonWithFallbackSync(filePath, fallback = {}) {
    try {
        if (!fs.existsSync(filePath)) {
            return { data: fallback, valid: true, created: true };
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        return { data, valid: true };
    } catch (err) {
        const msg = `Malformed JSON in ${path.basename(filePath)}: ${err.message}`;
        console.error(`[PERSISTENCE] ${msg}`);
        console.error(`[PERSISTENCE] Falling back to default state to avoid lockout`);
        return { data: fallback, valid: false, error: msg };
    }
}

// Ensure files exist with initial state
if (!fs.existsSync(SESSIONS_FILE)) {
    atomicWriteSync(SESSIONS_FILE, {});
}

// ── SESSIONS ────────────────────────────────────────────
const sessions = new Map();

function loadSessions() {
    const result = readJsonWithFallbackSync(SESSIONS_FILE, {});
    const now = Date.now();
    let cleaned = false;
    for (const [id, s] of Object.entries(result.data)) {
        if (now - s.createdAt < SESSION_TTL) {
            sessions.set(id, s);
        } else {
            cleaned = true;
        }
    }
    // Save cleaned file if we removed expired sessions
    if (cleaned) saveSessions();
    if (!result.valid) {
        console.warn('[PERSISTENCE] Recovered from malformed sessions.json, cleaned state loaded');
    }
}

function cleanupExpiredSessions() {
    try {
        const result = readJsonWithFallbackSync(SESSIONS_FILE, {});
        const now = Date.now();
        let removed = 0;

        for (const [id, s] of Object.entries(result.data)) {
            if (now - s.createdAt > SESSION_TTL) {
                delete result.data[id];
                sessions.delete(id);
                removed++;
            }
        }

        if (removed > 0) {
            const written = atomicWriteSync(SESSIONS_FILE, result.data);
            if (written) {
                console.log(`[PERSISTENCE] Session cleanup: removed ${removed} expired sessions`);
            } else {
                console.error(`[PERSISTENCE] Failed to persist session cleanup`);
            }
        }
    } catch (e) {
        console.error('[PERSISTENCE] Session cleanup error:', e);
    }
}

// Run cleanup every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

function saveSessions() {
    const data = Object.fromEntries(sessions);
    const written = atomicWriteSync(SESSIONS_FILE, data);
    if (!written) {
        console.error(`[PERSISTENCE] Failed to save sessions to disk (in-memory state preserved)`);
    }
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

function invalidateUserSessions(username) {
    let removed = 0;
    for (const [id, session] of sessions) {
        if (session.username === username) {
            sessions.delete(id);
            removed++;
        }
    }
    if (removed) saveSessions();
    return removed;
}

// ── USERS ───────────────────────────────────────────────
/**
 * Read the users file and report its state.
 * @returns {{data: object, absent: boolean, valid: boolean}}
 *   - data: the parsed users structure ({ users: {...} }) when valid
 *   - absent: true only when the file genuinely does not exist
 *   - valid: false when the file exists but is malformed or structurally invalid
 */
function readUsersState() {
    const result = readJsonWithFallbackSync(USERS_FILE, { users: {} });
    const data = result.data;

    // Validate structure: must have a "users" key with object value
    if (!data.users || typeof data.users !== 'object' || Array.isArray(data.users)) {
        console.error(`[PERSISTENCE] Invalid users.json structure detected`);
        return { data: null, absent: false, valid: false };
    }

    if (!result.valid) {
        console.warn('[PERSISTENCE] Recovered from malformed users.json');
    }
    return { data, absent: !!result.created, valid: result.valid };
}

/**
 * Load users with validation and fallback.
 * Ensures the structure is { users: {...} } even if malformed.
 */
function loadUsers() {
    const state = readUsersState();
    return state.data || { users: {} };
}

/**
 * Save users atomically and log failures.
 * If write fails, logs the error with full context for debugging.
 * In-memory state is always preserved even if disk write fails.
 */
function saveUsers(users) {
    // Validate before write
    if (!users || typeof users !== 'object' || !users.users || typeof users.users !== 'object') {
        console.error(`[PERSISTENCE] Cannot save invalid users structure:`, users);
        return false;
    }

    const written = atomicWriteSync(USERS_FILE, users);
    if (!written) {
        console.error(`[PERSISTENCE] Failed to save users to disk (in-memory state preserved)`);
        return false;
    }
    return true;
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
    if (!saveUsers(db)) {
        // Write failed: roll back the in-memory change so we don't report success.
        delete db.users[username];
        return false;
    }
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
    const state = readUsersState();

    // Fail closed: if users.json exists but is malformed or structurally invalid,
    // do NOT overwrite it. Preserve the file and refuse to bootstrap, so a corrupt
    // file cannot silently wipe existing accounts or mint a fresh admin.
    if (!state.valid) {
        console.error('[PERSISTENCE] users.json is malformed or structurally invalid; refusing to modify it. ' +
            'Fix or remove the file manually to recover.');
        return;
    }

    const db = state.data;
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
    if (state.absent && Object.keys(db.users).length === 0) {
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
            console.log('Save this now. It will not be shown again. Log in and change it,');
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
    const original = db.users[username];
    delete db.users[username];
    if (!saveUsers(db)) {
        // Write failed: roll back the in-memory change so we don't report success.
        db.users[username] = original;
        return false;
    }
    invalidateUserSessions(username);
    return true;
}

function resetPassword(username, newPassword) {
    const db = loadUsers();
    if (!db.users[username]) return false;
    const originalHash = db.users[username].passwordHash;
    db.users[username].passwordHash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
    if (!saveUsers(db)) {
        // Write failed: roll back the in-memory change so we don't report success.
        db.users[username].passwordHash = originalHash;
        return false;
    }
    invalidateUserSessions(username);
    return true;
}

function setUserRole(username, role) {
    const db = loadUsers();
    if (!db.users[username]) return false;
    const originalRole = db.users[username].role;
    db.users[username].role = role;
    if (!saveUsers(db)) {
        // Write failed: roll back the in-memory change so we don't report success.
        db.users[username].role = originalRole;
        return false;
    }
    invalidateUserSessions(username);
    return true;
}

// True if `username` is an admin and removing/demoting them would leave
// zero admin accounts, used to block deletes/role-changes that would lock
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
    const result = readJsonWithFallbackSync(USER_KEYS_FILE, {});
    if (!result.valid) {
        console.warn('[PERSISTENCE] Recovered from malformed user-keys.json');
    }
    return result.data;
}

function saveUserKeys(data) {
    const written = atomicWriteSync(USER_KEYS_FILE, data);
    if (!written) {
        console.error(`[PERSISTENCE] Failed to save user keys to disk (in-memory state preserved)`);
        return false;
    }
    return true;
}

function getUserKeys(username) {
    const all = loadUserKeys();
    return all[username] || {};
}

function setUserKey(username, provider, key) {
    const all = loadUserKeys();
    if (!all[username]) all[username] = {};
    const original = all[username][provider];
    all[username][provider] = key;
    if (!saveUserKeys(all)) {
        // Write failed: roll back the in-memory change so we don't report success.
        if (original === undefined) {
            delete all[username][provider];
        } else {
            all[username][provider] = original;
        }
        return false;
    }
    return true;
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
    invalidateUserSessions,
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
