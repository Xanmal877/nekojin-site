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
        price: params.price ? parseInt(params.price, 10) : 0, // Gumroad sends price in cents
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

module.exports = {
    parsePingBody,
    validateSellerId
};
