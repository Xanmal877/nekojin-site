// Public provider APIs (YouTube, Discord, sales). One entry per provider; each
// reads its config from the admin-editable settings row, falls back to an env
// var, and answers one JSON shape. Failures are logged, never surfaced.

const contentDB = require('../database.js');
const youtube = require('./youtube.js');

// ── INTEGRATION APIS (public) ─────────────────────────────
// Each integration reads its config from the settings row (admin-editable)
// and falls back to an env var, then responds with one JSON shape. Failures
// are logged but never surfaced to the client. Defined as a table so the
// routes stay one line each and adding a provider doesn't mean another
// copy of the same try/catch/rate-limit block.
const INTEGRATION_ROUTES = {
    '/api/youtube': async () => {
        const settings = await contentDB.SelectXanreanSettings();
        const channelId = settings.youtube_channel_id || process.env.YOUTUBE_CHANNEL_ID;
        if (!channelId) return { videos: [] };
        return { videos: await youtube.fetchLatestVideos(channelId) };
    },

    '/api/discord': async () => {
        const settings = await contentDB.SelectXanreanSettings();
        const server_id = settings.discord_server_id || process.env.DISCORD_SERVER_ID || null;
        const invite_code = settings.discord_invite_code || process.env.DISCORD_INVITE_CODE || null;
        return {
            server_id,
            invite_code,
            invite_url: invite_code ? `https://discord.gg/${invite_code}` : null
        };
    },

    '/api/sales': async () => {
        const sales = await contentDB.SelectRecentSales(25);
        return {
            // email deliberately excluded for privacy
            sales: sales.map(s => ({
                product_name: s.product_name,
                price_cents: s.price_cents,
                currency: s.currency,
                purchased_at: s.purchased_at
            }))
        };
    }
};

module.exports = { INTEGRATION_ROUTES };
