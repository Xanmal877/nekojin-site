// Admin CRUD for characters, timeline events, and lore topics. All three are
// the same shape - validate, upsert, delete, and a list/detail read that hides
// invisible rows - so they share one table and one handler.

const contentDB = require('../database.js');
const { sendJson, readJsonBody, isValidSlug } = require('./http-helpers');

// ── ADMIN CONTENT CRUD ────────────────────────────────────
// Characters, timeline events, and lore topics are the same shape: an upsert
// that validates a couple of fields, a delete by id, and one list/detail GET
// that hides invisible rows from non-admins. The three blocks used to be
// near-identical copies; this table is the shared version of all of them.
//
// `validate(data)` returns an error string to reject the payload, or null to
// accept. `slugError` is set for the types whose slug lands in a URL, and the
// message doubles as the markup-safety check's rejection reason.
const ADMIN_CONTENT_TYPES = {
    characters: {
        base: '/api/characters',
        insert: data => contentDB.InsertCharacter(data),
        remove: id => contentDB.DeleteCharacter(id),
        validate: data => (!data.name || !data.slug ? 'Name and slug are required' : null),
        slugError: 'Invalid character slug'
    },
    timeline: {
        base: '/api/timeline',
        insert: data => contentDB.InsertTimelineEvent(data),
        remove: id => contentDB.DeleteTimelineEvent(id),
        validate: data => (data.title ? null : 'Title is required')
    },
    'lore-topics': {
        base: '/api/lore-topics',
        insert: data => contentDB.InsertLoreTopic(data),
        remove: id => contentDB.DeleteLoreTopic(id),
        validate: data => (!data.title || !data.slug || !data.section
            ? 'Title, slug, and section are required' : null),
        slugError: 'Invalid lore slug'
    }
};

const ADMIN_CONTENT_MATCHERS = Object.values(ADMIN_CONTENT_TYPES).map(type => ({
    type,
    // Exact base URL, an /appearances sub-resource, or a single-entity id.
    exact: new RegExp(`^${type.base}$`),
    appearances: new RegExp(`^${type.base}/([^/]+)/appearances$`),
    byId: new RegExp(`^${type.base}/([^/]+)$`)
}));

function matchAdminContent(url) {
    for (const matcher of ADMIN_CONTENT_MATCHERS) {
        if (matcher.exact.test(url)) return { type: matcher.type };
        const byId = url.match(matcher.byId);
        if (byId) return { type: matcher.type, id: byId[1] };
        if (matcher.appearances.test(url)) {
            return { type: matcher.type, id: url.split('/')[3], appearances: true };
        }
    }
    return null;
}

// Admin view of characters / timeline / lore topics. `id` is undefined for a
// collection request, set for a single entity or its /appearances sub-resource.
async function handleAdminContent(req, res, match) {
    const { type, id, appearances } = match;
    const isList = id === undefined;

    // Characters expose a per-character appearances editor.
    if (appearances && req.method === 'POST') {
        const { appearances: rows } = await readJsonBody(req, 64 * 1024);
        return sendJson(res, await contentDB.ReplaceCharacterAppearances(id, rows || []));
    }

    if (req.method === 'POST' || req.method === 'PUT') {
        const data = await readJsonBody(req, 10 * 1024 * 1024);
        const problem = type.validate(data);
        if (problem) return sendJson(res, { error: problem }, 400);
        if (type.slugError && !isValidSlug(data.slug)) {
            return sendJson(res, { error: type.slugError }, 400);
        }
        return sendJson(res, await type.insert(data));
    }

    if (req.method === 'DELETE' && !isList) {
        return sendJson(res, await type.remove(id));
    }

    // Reads on a collection are served publicly before the auth gate, so any
    // other method on a collection URL is a genuine method error. Answering
    // here (rather than falling through) keeps this handler terminal.
    return sendJson(res, { error: 'Method not allowed' }, 405);
}

// Reorder endpoints: drag-and-drop ordering for books and games.
const REORDER_ROUTES = {
    '/api/books/reorder': {
        idField: 'bookIds',
        apply: (body, ids) => contentDB.UpdateBookSequence(body.seriesId || null, ids)
    },
    '/api/games/reorder': {
        idField: 'gameIds',
        apply: (body, ids) => contentDB.ReorderGames(ids)
    }
};

module.exports = {
    ADMIN_CONTENT_TYPES, matchAdminContent, handleAdminContent, REORDER_ROUTES
};
