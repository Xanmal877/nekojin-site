// Public support tickets: validate a submitted ticket, keep a copy on disk,
// then forward it to the studio inbox from the server.
//
// The inbox address never leaves this process. The page only ever talks to
// POST /api/support and gets back a ticket number; it is not sent to the
// browser, rendered into any page, or echoed in an error.
//
// Delivery goes through FormSubmit's JSON endpoint, which needs no SMTP
// credentials on the host. The first ticket triggers a one-time activation
// email to the inbox; tickets still land in the on-disk log before then.
// SUPPORT_EMAIL overrides the inbox; SUPPORT_FORWARD=off disables delivery.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_INBOX = 'Xanmal@protonmail.com';
const FORWARD_URL = 'https://formsubmit.co/ajax/';
const SITE_ORIGIN = 'https://worldofxanrea.com';

const CATEGORIES = ['Bug report', 'Game help', 'Website problem', 'Purchase or account', 'Feedback', 'Other'];
const PRODUCTS = ["Sakilera's Guide to Dungeoneering", 'Xanrean Tides', 'Echo World', 'Books', 'Website', 'Other'];
const LIMITS = { name: 80, email: 254, subject: 140, message: 5000, platform: 120, version: 60 };
const MIN_FILL_MS = 3000;  // humans take longer than this to fill the form

let ticketLog = null;

function configure(dataDir) {
    if (!dataDir) throw new Error('support-tickets.configure requires the data directory');
    ticketLog = path.join(dataDir, 'support-tickets.jsonl');
}

function clean(value, max) {
    return String(value == null ? '' : value)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim()
        .slice(0, max);
}

// Returns { ticket } on success or { error } with a message safe to show.
function validate(body) {
    if (!body || typeof body !== 'object') return { error: 'Invalid request.' };
    // Honeypot: a field real visitors never see. Bots fill it.
    if (body.website) return { spam: true };
    const started = Number(body.startedAt);
    if (Number.isFinite(started) && Date.now() - started < MIN_FILL_MS) return { spam: true };

    const ticket = {
        name: clean(body.name, LIMITS.name),
        email: clean(body.email, LIMITS.email),
        category: clean(body.category, 40),
        product: clean(body.product, 60),
        platform: clean(body.platform, LIMITS.platform),
        version: clean(body.version, LIMITS.version),
        subject: clean(body.subject, LIMITS.subject).replace(/[\r\n]+/g, ' '),
        message: clean(body.message, LIMITS.message)
    };

    if (!ticket.name) return { error: 'Please tell us your name.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ticket.email)) return { error: 'Please enter a valid email so we can reply.' };
    if (!CATEGORIES.includes(ticket.category)) return { error: 'Please pick what this is about.' };
    if (!PRODUCTS.includes(ticket.product)) return { error: 'Please pick which game or product.' };
    if (ticket.subject.length < 4) return { error: 'Please add a short subject.' };
    if (ticket.message.length < 15) return { error: 'Please describe the problem in a little more detail.' };
    return { ticket };
}

function newTicketId() {
    const d = new Date();
    const day = d.toISOString().slice(2, 10).replace(/-/g, '');
    return `NKJ-${day}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function appendToLog(record) {
    if (!ticketLog) throw new Error('support-tickets.configure() must be called before use');
    fs.mkdirSync(path.dirname(ticketLog), { recursive: true, mode: 0o700 });
    fs.appendFileSync(ticketLog, JSON.stringify(record) + '\n', { mode: 0o600 });
}

async function forward(record) {
    if (String(process.env.SUPPORT_FORWARD || '').toLowerCase() === 'off') {
        return { ok: false, skipped: true };
    }
    const inbox = process.env.SUPPORT_EMAIL || DEFAULT_INBOX;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const res = await fetch(FORWARD_URL + encodeURIComponent(inbox), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Origin': SITE_ORIGIN,
                'Referer': SITE_ORIGIN + '/support'
            },
            body: JSON.stringify({
                _subject: `[${record.id}] ${record.category}: ${record.subject}`,
                _replyto: record.email,
                _template: 'table',
                _captcha: 'false',
                Ticket: record.id,
                Name: record.name,
                Email: record.email,
                Category: record.category,
                Product: record.product,
                Platform: record.platform || '(not given)',
                Version: record.version || '(not given)',
                Subject: record.subject,
                Message: record.message,
                Submitted: record.createdAt
            }),
            signal: controller.signal
        });
        const text = await res.text();
        let data = {};
        try { data = JSON.parse(text); } catch (_) { /* non-JSON reply */ }
        const ok = res.ok && (data.success === true || data.success === 'true');
        return { ok, status: res.status, detail: ok ? undefined : (data.message || text.slice(0, 200)) };
    } catch (err) {
        return { ok: false, detail: err.name === 'AbortError' ? 'timeout' : err.message };
    } finally {
        clearTimeout(timer);
    }
}

// Validate, store, forward. Storage is the source of truth: a ticket is
// accepted once it is on disk, even if the email relay is down.
async function submitTicket(body, meta = {}) {
    const result = validate(body);
    if (result.spam) return { ok: true, id: newTicketId(), spam: true };
    if (result.error) return { ok: false, status: 400, error: result.error };

    const record = {
        id: newTicketId(),
        createdAt: new Date().toISOString(),
        ...result.ticket,
        ip: meta.ip || '',
        userAgent: clean(meta.userAgent, 300)
    };
    try {
        appendToLog(record);
    } catch (err) {
        console.error('[Support] could not store ticket:', err.message);
        return { ok: false, status: 500, error: 'We could not save your ticket. Please try again later.' };
    }

    const delivery = await forward(record);
    if (!delivery.ok && !delivery.skipped) {
        console.error(`[Support] ticket ${record.id} stored but not emailed:`, delivery.status || '', delivery.detail || '');
    }
    try {
        appendToLog({ id: record.id, delivered: delivery.ok, at: new Date().toISOString() });
    } catch (_) { /* the ticket itself is already stored */ }

    return { ok: true, id: record.id };
}

module.exports = { configure, submitTicket, CATEGORIES, PRODUCTS };
