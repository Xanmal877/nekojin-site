// Per-IP rate limiting. RATE_LIMIT_CONFIG is keyed by the endpoint string the
// caller passes to enforceRateLimit; anything not listed falls into 'default'.
// The sweep interval is registered on require, exactly where it used to run
// when this lived in the server.

// ── RATE LIMITING ─────────────────────────────────────────
// Only trust X-Forwarded-For / X-Real-IP when the server actually runs behind
// a reverse proxy that sets them: otherwise those headers are client-controlled
// and let anyone bypass a limit by spoofing them. The server owns this flag.
let TRUST_PROXY = false;
function configure(options = {}) {
    TRUST_PROXY = options.trustProxy === true;
}

const rateLimits = new Map();

const RATE_LIMIT_CONFIG = {
    '/login': { windowMs: 15 * 60 * 1000, max: 5, message: 'Too many login attempts. Try again in 15 minutes.' },
    '/register': { windowMs: 60 * 60 * 1000, max: 3, message: 'Too many registration attempts. Try again in 1 hour.' },
    '/newsletter': { windowMs: 60 * 60 * 1000, max: 10, message: 'Too many newsletter signups from this IP.' },
    '/api/users': { windowMs: 15 * 60 * 1000, max: 20, message: 'Too many user management requests.' },
    '/webhook/gumroad': { windowMs: 60 * 1000, max: 10, message: 'Too many webhook requests.' },
    '/api/youtube': { windowMs: 60 * 1000, max: 30, message: 'Too many YouTube API requests.' },
    '/api/discord': { windowMs: 60 * 1000, max: 30, message: 'Too many Discord API requests.' },
    '/api/sales': { windowMs: 60 * 1000, max: 20, message: 'Too many sales requests.' },
    'default': { windowMs: 60 * 1000, max: 100, message: 'Too many requests. Please slow down.' }
};

function getClientIP(req) {
    if (TRUST_PROXY) {
        return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
               req.headers['x-real-ip'] ||
               req.connection.remoteAddress ||
               'unknown';
    }
    return req.connection.remoteAddress || 'unknown';
}

function checkRateLimit(req, endpoint) {
    const ip = getClientIP(req);
    const config = RATE_LIMIT_CONFIG[endpoint] || RATE_LIMIT_CONFIG['default'];
    const key = `${ip}:${endpoint}`;
    const now = Date.now();

    if (!rateLimits.has(key)) {
        rateLimits.set(key, { count: 1, resetTime: now + config.windowMs });
        return { allowed: true };
    }

    const record = rateLimits.get(key);

    // Reset if window expired
    if (now > record.resetTime) {
        record.count = 1;
        record.resetTime = now + config.windowMs;
        return { allowed: true };
    }

    // Check limit
    if (record.count >= config.max) {
        const retryAfter = Math.ceil((record.resetTime - now) / 1000);
        return {
            allowed: false,
            status: 429,
            message: config.message,
            retryAfter
        };
    }

    record.count++;
    return { allowed: true };
}

// Cleanup old entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimits) {
        if (now > record.resetTime) rateLimits.delete(key);
    }
}, 10 * 60 * 1000);

module.exports = { configure, RATE_LIMIT_CONFIG, getClientIP, checkRateLimit };
