/**
 * URL validation shared by persistence and generated metadata.
 */
function isSafeHttpUrl(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return false;
    try {
        const parsed = new URL(trimmed);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

// A real calendar date in YYYY-MM-DD form, not just a regex match: 2026-02-30
// passes the pattern but is rejected here because the parsed date won't
// round-trip. Shared with the publishing calendar, which validates the same
// shape on its public API.
function isValidDateStr(value) {
    if (typeof value !== 'string') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + 'T00:00:00Z');
    return d instanceof Date && !isNaN(d) && d.toISOString().startsWith(value);
}

module.exports = { isSafeHttpUrl, isValidDateStr };
