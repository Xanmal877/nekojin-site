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

module.exports = { isSafeHttpUrl };
