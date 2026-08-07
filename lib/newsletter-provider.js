/**
 * Newsletter Provider Interface
 *
 * This module provides a pluggable interface for integrating with various 
 * newsletter services. It is designed to be a secondary action to the 
 * primary local database storage.
 */

/**
 * Subscribes an email to the configured external provider.
 * 
 * @param {string} email - The subscriber's email address.
 * @param {string} source - Where the subscription originated from.
 * @returns {Promise<{ok: boolean, provider: string, error?: string}>}
 */
async function subscribeToProvider(email, source) {
    const provider = process.env.NEWSLETTER_PROVIDER || 'none';

    if (provider === 'none') {
        return { ok: true, provider: 'none' };
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        let response;

        switch (provider) {
            case 'buttondown':
                // Reference: https://api.buttondown.email/v1/subscribers
                // Note: verify exact field names against Buttondown's current API docs before going live.
                response = await fetch('https://api.buttondown.email/v1/subscribers', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Token ${process.env.BUTTONDOWN_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email }),
                    signal: controller.signal,
                });
                break;

            case 'mailerlite':
                // Reference: https://connect.mailerlite.com/api/subscribers
                // Note: verify exact field names against MailerLite's current API docs before going live.
                response = await fetch('https://connect.mailerlite.com/api/subscribers', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.MAILERLITE_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email }),
                    signal: controller.signal,
                });
                break;

            case 'convertkit':
                // Reference: https://api.convertkit.com/v3/forms/{form_id}/subscribe
                // Note: verify exact field names against ConvertKit's current API docs before going live.
                const formId = process.env.CONVERTKIT_FORM_ID;
                const apiKey = process.env.CONVERTKIT_API_KEY;
                if (!formId || !apiKey) {
                    throw new Error('ConvertKit requires CONVERTKIT_FORM_ID and CONVERTKIT_API_KEY');
                }
                response = await fetch(`https://api.convertkit.com/v3/forms/${formId}/subscribe?api_key=${apiKey}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email }),
                    signal: controller.signal,
                });
                break;

            case 'generic_webhook':
                const webhookUrl = process.env.NEWSLETTER_WEBHOOK_URL;
                if (!webhookUrl) {
                    throw new Error('generic_webhook requires NEWSLETTER_WEBHOOK_URL');
                }
                response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email, source }),
                    signal: controller.signal,
                });
                break;

            default:
                console.warn(`Unsupported newsletter provider configured: ${provider}`);
                return { ok: true, provider: 'unknown' };
        }

        clearTimeout(timeoutId);

        if (!response || !response.ok) {
            const errorText = response ? await response.text() : 'No response';
            throw new Error(`Provider ${provider} returned ${response?.status || 'unknown'}: ${errorText}`);
        }

        return { ok: true, provider };

    } catch (err) {
        // We log but do not throw, as this should not block the local DB subscription.
        console.error(`[NewsletterProvider] Error subscribing ${email} to ${provider}:`, err.message);
        return { 
            ok: false, 
            provider, 
            error: err.message 
        };
    }
}

module.exports = { subscribeToProvider };
