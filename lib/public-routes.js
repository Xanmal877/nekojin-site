// Which URL renders which template, and the public read handlers for the three
// content types the admin CRUD module writes.
//
// Both tables embed the public directory, which the server only hands over at
// boot, so they are built on first use instead of at require time. configure()
// drops the memo, so a second server boot in the same process can never reuse
// paths from the first.

const path = require('path');
const contentDB = require('../database.js');

let cachedRoutes = null;
let cachedReads = null;
let build = () => { throw new Error('public-routes.configure() must be called before use'); };

function configure(publicDir) {
    if (!publicDir) throw new Error('public-routes.configure requires the public directory');
    cachedRoutes = null;
    cachedReads = null;
    build = () => ({ routes: routesFor(publicDir), reads: readsFor(contentDB) });
}

function getPublicRoutes() {
    if (!cachedRoutes) cachedRoutes = build().routes;
    return cachedRoutes;
}

// The public read surface for one content type, or undefined for anything else.
function readBaseFor(readBase) {
    if (!cachedReads) cachedReads = build().reads;
    return cachedReads[readBase];
}

function routesFor(PUBLIC_DIR) {
    return {
        '/': path.join(PUBLIC_DIR, 'index.html'),
        '/books': path.join(PUBLIC_DIR, 'books.html'),
        '/book': path.join(PUBLIC_DIR, 'book.html'),
        '/read': path.join(PUBLIC_DIR, 'read.html'),
        '/games': path.join(PUBLIC_DIR, 'games.html'),
        '/about': path.join(PUBLIC_DIR, 'about.html'),
        '/publishing-calendar': path.join(PUBLIC_DIR, 'publishing-calendar.html'),
        '/xanrean': path.join(PUBLIC_DIR, 'xanrean.html'),
        '/xanrean/books': path.join(PUBLIC_DIR, 'xanrean', 'books.html'),
        '/xanrean/characters': path.join(PUBLIC_DIR, 'xanrean', 'characters.html'),
        '/xanrean/characters/admins':
            path.join(PUBLIC_DIR, 'xanrean', 'characters', 'admins', 'admins.html'),
        '/xanrean/wiki': path.join(PUBLIC_DIR, 'xanrean', 'wiki.html'),
        '/xanrean/community': path.join(PUBLIC_DIR, 'xanrean', 'community.html'),
        '/xanrean/characters/moderators':
            path.join(PUBLIC_DIR, 'xanrean', 'characters', 'moderators', 'moderators.html'),
        '/xanrean/lore': path.join(PUBLIC_DIR, 'xanrean', 'lore.html'),
        '/xanrean/lore/timeline': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'timeline.html'),
        '/xanrean/lore/characters': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'characters.html'),
        '/xanrean/lore/species': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'species.html'),
        '/xanrean/lore/world': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'world.html'),
        '/xanrean/lore/nekojin': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'nekojin.html'),
        '/xanrean/lore/foxkin': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'foxkin.html'),
        '/xanrean/lore/elves': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'elves.html'),
        '/xanrean/lore/travelers': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'travelers.html'),
        '/xanrean/lore/wolfkin': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'wolfkin.html'),
        '/xanrean/lore/kitsune': path.join(PUBLIC_DIR, 'xanrean', 'lore', 'kitsune.html')
    };
}

// The unauthenticated half of the three content types the admin CRUD module
// writes. Invisible rows are filtered out for non-admins before this is used;
// a hidden single entity 404s rather than leaking that it exists.
function readsFor(contentDB) {
    return {
        '/api/characters': {
            list: () => contentDB.SelectCharacters(),
            one: slug => contentDB.SelectCharacterBySlug(slug),
            label: 'Character'
        },
        '/api/timeline': {
            list: () => contentDB.SelectTimelineEvents(),
            one: id => contentDB.SelectTimelineEventById(id),
            label: 'Timeline event'
        },
        '/api/lore-topics': {
            list: section => contentDB.SelectLoreTopics(section),
            one: slug => contentDB.SelectLoreTopicBySlug(slug),
            label: 'Lore topic'
        }
    };
}

module.exports = { configure, getPublicRoutes, readBaseFor };
