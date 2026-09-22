// Cover art is replaced in place under the same filename, so a URL alone
// cannot tell a browser its bytes changed. Hash the file and append it as a
// query string: same art -> same URL (stays cached), new art -> new URL.
// PUBLIC_DIR is injected because this module sits one level below it.

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

let PUBLIC_DIR;
function configure(publicDir) { PUBLIC_DIR = publicDir; }

// ── COVER VERSIONING ──────────────────────────────────────
// Cover files are replaced in place (same filename, new art), so a browser
// holding the old bytes has no way to know. Hash the file content and append
// it as a query string: same art -> same URL (stays cached), new art -> new
// URL (fetched immediately). Memoised by mtime+size so re-requesting /content
// doesn't re-hash every cover.
const coverVersionCache = new Map();

function coverVersion(coverPath) {
    if (typeof coverPath !== 'string' || !coverPath.startsWith('/covers/')) return '';
    // Ignore anything with a query/dot-segment trick in it.
    if (coverPath.includes('..') || coverPath.includes('?') || coverPath.includes('#')) return '';
    const file = path.join(PUBLIC_DIR, coverPath.slice(1));
    try {
        const st = fs.statSync(file);
        const key = `${st.mtimeMs}:${st.size}`;
        let v = coverVersionCache.get(coverPath);
        if (!v || v.key !== key) {
            v = { key, version: crypto.createHash('sha1')
                .update(fs.readFileSync(file)).digest('hex').slice(0, 8) };
            coverVersionCache.set(coverPath, v);
        }
        return `?v=${v.version}`;
    } catch {
        return '';   // missing file: leave the URL alone, let it 404 visibly
    }
}

function withCoverVersion(book) {
    if (!book || typeof book !== 'object') return book;
    const v = coverVersion(book.cover);
    return v ? { ...book, cover: book.cover + v } : book;
}

module.exports = { configure, coverVersion, withCoverVersion };
