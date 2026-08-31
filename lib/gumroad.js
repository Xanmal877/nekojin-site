/**
 * gumroad.js - Gumroad webhook helper
 */

function parsePingBody(rawBodyText) {
    if (!rawBodyText) return {};
    
    // Gumroad sends x-www-form-urlencoded
    const params = {};
    const pairs = rawBodyText.toString().split('&');
    
    for (const pair of pairs) {
        const [key, value] = pair.split('=');
        if (key) {
            params[decodeURIComponent(key)] = decodeURIComponent((value || '').replace(/\+/g, ' '));
        }
    }

    return {
        product_name: params.product_name || '',
        price: params.price || '', // Gumroad sends price in cents
        currency: params.currency || 'USD',
        recurrence: params.recurrence || 'one-time',
        email: params.email || '',
        sale_id: params.sale_id || '',
        seller_id: params.seller_id || '',
        is_test: params.test === 'true' ? 1 : 0
    };
}

function validateSellerId(ping, configuredSellerId) {
    if (!configuredSellerId) return true; // If not configured, accept but log (handled in route)
    return ping.seller_id === configuredSellerId;
}

// Known Gumroad billing recurrence values. Anything else is treated as invalid
// so a malformed or forged payload is rejected rather than persisted.
const VALID_RECURRENCES = new Set([
    'one-time', 'monthly', 'yearly', 'quarterly', 'every_two_months', 'bimonthly'
]);

// Convert price string to validated integer in cents
function parsePriceInCents(priceStr) {
    if (!priceStr) return 0;
    const trimmed = String(priceStr).trim();
    if (!/^\d+$/.test(trimmed)) return null; // Invalid: non-digits
    const num = Number(trimmed);
    if (num < 0 || !Number.isFinite(num)) return null;
    if (num > 999999999) return null; // Sanity: price won't exceed $9,999,999.99
    return num;
}

// Field-level validation for a parsed ping. Returns an array of human-readable
// problems; an empty array means the payload is well-formed enough to persist.
function validatePing(ping) {
    const errors = [];

    // sale_id is required for deduplication (ON CONFLICT(gumroad_sale_id)).
    if (!ping.sale_id) errors.push('missing sale_id');

    // price is in cents and must be a non-negative integer.
    const priceCents = parsePriceInCents(ping.price);
    if (priceCents === null) errors.push('invalid price');

    // Currency should be a 3-letter ISO code.
    if (typeof ping.currency !== 'string' || !/^[A-Z]{3}$/.test(ping.currency)) {
        errors.push('invalid currency');
    }

    // Email, when present, must look like an email address.
    if (ping.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ping.email)) {
        errors.push('invalid email');
    }

    // Recurrence must be a known Gumroad value.
    if (ping.recurrence && !VALID_RECURRENCES.has(ping.recurrence)) {
        errors.push('invalid recurrence');
    }

    return errors;
}

module.exports = {
    parsePingBody,
    validateSellerId,
    validatePing,
    parsePriceInCents
};
