// MIME types and serving files off disk. The whitelist tables are the single
// source of truth for what may be served: a path inside one of these
// directories, or one of the root assets, answers; anything else 403s/404s.
//
// PUBLIC_DIR is resolved against the repo root, not this module's directory,
// so it is injected at boot instead of recomputed here.

const fs = require('fs');
const path = require('path');

// Lazy: http-helpers requires this module, so pulling the response writers in
// at load time would be a require cycle.
let PUBLIC_DIR;
let sendText = () => { throw new Error('static-files.configure() not called'); };
let notFound = () => { throw new Error('static-files.configure() not called'); };

function configure(options) {
    PUBLIC_DIR = options.publicDir;
    sendText = options.sendText;
    notFound = options.notFound;
}

// ── MIME TYPES ───────────────────────────────────────────
const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
};

// Whether a path may be cached for an hour. Deliberately NOT the whole
// servable whitelist: the generated meta files (robots.txt, sitemap.xml,
// rss.xml, manifest.json) are servable but change on content save, so they
// have to stay no-store.
function isStaticAssetPath(url) {
    const isDir = ALLOWED_DIRECTORIES.some(dir => url.startsWith(dir));
    if (isDir && url.startsWith('/publishing/')) {
        // The dashboard's own HTML is not servable (only its assets are).
        return !url.endsWith('.html');
    }
    return isDir || ROOT_ASSETS.has(url);
}

// Serve a file from public/ when it passes the extension + directory
// whitelist. Returns true when the request was answered (including the 400/403
// rejections), false when the caller should keep routing.
function serveStaticAsset(req, res, url) {
    if (req.method !== 'GET') return false;

    let decodedUrl;
    try {
        decodedUrl = decodeURIComponent(url);
    } catch {
        return sendText(res, 'Bad Request', 400), true;
    }
    if (decodedUrl.includes('\0')) return sendText(res, 'Bad Request', 400), true;

    const resolvedPath = path.resolve(PUBLIC_DIR, `.${decodedUrl}`);
    const isPathSafe = resolvedPath.startsWith(PUBLIC_DIR + path.sep);
    const relativeUrl = isPathSafe
        ? '/' + path.relative(PUBLIC_DIR, resolvedPath).split(path.sep).join('/')
        : '';
    const ext = path.extname(relativeUrl).toLowerCase();
    const isAllowedExt = ALLOWED_EXTENSIONS.has(ext);
    // The publishing dashboard is a build output: its assets are servable,
    // its own HTML is not (the /admin/publishing route serves that).
    const isPublishingAsset = relativeUrl.startsWith('/publishing/') && ext !== '.html';
    const isAllowedDir = ALLOWED_DIRECTORIES.some(dir => relativeUrl.startsWith(dir)) &&
        (!relativeUrl.startsWith('/publishing/') || isPublishingAsset);

    if (isPathSafe && isAllowedExt && (isAllowedDir || ROOT_ASSETS.has(relativeUrl))) {
        return serveFile(res, resolvedPath, req), true;
    }

    // A request for something that *looks* like one of our asset paths but
    // resolves outside them is a traversal attempt, not a missing page.
    if (isAllowedExt || ALLOWED_DIRECTORIES.some(dir => decodedUrl.startsWith(dir))) {
        return sendText(res, 'Forbidden: Invalid path', 403), true;
    }

    return false;
}

function serveFile(res, filePath, req) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.mp4') return streamVideo(req, res, filePath);
    try {
        const data = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    } catch {
        return notFound(res);
    }
}

// Videos are streamed (never read whole into memory) and honour Range
// requests, which browsers need for seeking and Safari needs to play at all.
function streamVideo(req, res, filePath) {
    let size;
    try { size = fs.statSync(filePath).size; } catch { return notFound(res); }
    const headers = { 'Content-Type': MIME['.mp4'], 'Accept-Ranges': 'bytes' };
    const match = /^bytes=(\d*)-(\d*)$/.exec((req && req.headers.range) || '');
    if (!match || (!match[1] && !match[2])) {
        res.writeHead(200, { ...headers, 'Content-Length': size });
        return fs.createReadStream(filePath).pipe(res);
    }
    let start = match[1] ? parseInt(match[1], 10) : size - parseInt(match[2], 10);
    let end = match[1] && match[2] ? parseInt(match[2], 10) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(filePath, { start, end }).pipe(res);
}

// ── STATIC ASSETS ─────────────────────────────────────────
// Only these file types, inside these directories (or the handful of files
// that live at the site root), are served off disk. Anything else 403s.
// `isStaticAsset` in the header logic uses the same directory set.
const ALLOWED_EXTENSIONS = new Set([
    '.html', '.css', '.js', '.xml', '.txt', '.json', '.md',
    '.png', '.jpg', '.jpeg', '.ico', '.svg', '.webp', '.gif', '.mp4'
]);

const ALLOWED_DIRECTORIES = [
    '/covers/',
    '/assets/',
    '/css/',
    '/images/',
    '/fonts/',
    '/js/',
    '/videos/',
    '/publishing/'
];

const ROOT_ASSETS = new Set([
    '/style.css',
    '/common.js',
    '/admin.css',
    '/manifest.json',
    '/robots.txt',
    '/sitemap.xml',
    '/rss.xml'
]);

module.exports = {
    configure,
    MIME, ALLOWED_EXTENSIONS, ALLOWED_DIRECTORIES, ROOT_ASSETS,
    isStaticAssetPath, serveStaticAsset, serveFile
};
