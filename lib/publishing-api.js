// Admin publishing dashboard API, backed by publishing-db.js. Read-only and
// admin-only: the router has already applied both gates by the time this runs,
// so this module only routes and answers.

const { sendJson, sendText } = require('./http-helpers');

async function handlePublishingApi(req, res, url, query, getPublishingDB) {
    if (req.method !== 'GET') { return sendText(res, 'Method Not Allowed', 405); }

    try {
        const db = getPublishingDB();
        const send = (data) => {
            return sendJson(res, data, 200);
        };

        if (url === '/api/publishing/health') {
            return send(await db.health());
        }
        if (url === '/api/publishing/overview') {
            const [kpis, cadence, series, platforms, upcoming] = await Promise.all([
                db.overview(),
                db.cadence(),
                db.seriesComparison(),
                db.platformComparison(),
                db.upcoming(12),
            ]);
            return send({ kpis, cadence, series, platforms, upcoming });
        }
        if (url === '/api/publishing/catalog') {
            const page = parseInt(query.get('page') || '1', 10);
            const pageSize = parseInt(query.get('pageSize') || '50', 10);
            const result = await db.catalog({
                q: query.get('q') || undefined,
                series: query.get('series') || undefined,
                platform: query.get('platform') || undefined,
                status: query.get('status') || undefined,
                page,
                pageSize,
            });
            return send(result);
        }
        if (url === '/api/publishing/filters') {
            return send(await db.filters());
        }
        if (url === '/api/publishing/series') {
            const rows = await db.seriesAnalytics();
            return send({ rows });
        }
        if (url === '/api/publishing/health-checks') {
            return send(await db.healthChecks());
        }
        if (url === '/api/publishing/freshness') {
            return send(await db.freshness());
        }
        if (url === '/api/publishing/releases') {
            const startUtc = query.get('startUtc');
            const endUtc = query.get('endUtc');
            if (!startUtc || !endUtc) {
                return sendJson(res, { error: 'startUtc and endUtc are required' }, 400);
            }
            const releases = await db.releaseWindow({
                startUtc,
                endUtc,
                status: query.get('status') || undefined,
                limit: parseInt(query.get('limit') || '500', 10),
            });
            return send({ releases });
        }

        return sendText(res, 'Not found', 404);
    } catch (err) {
        console.error('Publishing API error:', err);
        return sendJson(res, { error: err.message }, 500);
    }
}

module.exports = { handlePublishingApi };
