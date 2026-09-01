// common.js - Shared utilities for Nekojin Interactive website

/**
 * Escape HTML special characters to prevent XSS
 * @param {*} str - Value to escape
 * @returns {string} Escaped string
 */
function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Validate a URL before it is injected into an href/src/style attribute.
 * Allows http(s) absolute URLs and safe same-origin absolute paths (starting
 * with a single "/"). Rejects javascript:, data:, vbscript:, protocol-relative
 * ("//"), backslash tricks, and any other scheme so invalid values render
 * inertly ('#') instead of executing. Also rejects quotes, angle brackets, and
 * backticks so a value can never break out of a double-quoted attribute when
 * interpolated into a template (e.g. src="...", href="...").
 * @param {*} url - Value to validate
 * @returns {string} Safe URL, or '#' when invalid
 */
function safeUrl(url) {
    if (!url) return '#';
    const text = String(url);
    // Attribute-breakout guard: none of these characters are valid in a URL
    // we allow, so reject them outright.
    if (/["'<>`]/.test(text)) return '#';
    if (/^https?:\/\//i.test(text)) return text;
    // Same-origin absolute path: single leading slash, no backslash (which
    // some browsers treat as a path separator), no protocol-relative "//".
    if (/^\/(?!\/)/.test(text) && !text.includes('\\')) return text;
    return '#';
}

/**
 * Format a number with k/M suffix (e.g., 1500 -> 1.5k)
 * @param {number} n - Number to format
 * @returns {string} Formatted number
 */
function fmtNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
}

/**
 * Debounce function calls
 * @param {Function} fn - Function to debounce
 * @param {number} ms - Milliseconds to wait
 * @returns {Function} Debounced function
 */
function debounce(fn, ms = 150) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} Success status
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to copy:', err);
        return false;
    }
}

// Export for module systems (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { esc, safeUrl, fmtNum, debounce, copyToClipboard };
}
