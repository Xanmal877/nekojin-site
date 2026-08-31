// Focused contracts for the public Community page and its integration APIs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const youtube = require('../lib/youtube.js');

const COMMUNITY = fs.readFileSync(path.join(__dirname, '..', 'public', 'xanrean', 'community.html'), 'utf8');

test('Community page is reachable from the homepage and has accessible controls', () => {
    const homepage = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.match(homepage, /href="\/xanrean\/community"/);
    assert.match(COMMUNITY, /<html lang="en">/);
    assert.match(COMMUNITY, /<meta name="viewport"/);
    assert.match(COMMUNITY, /aria-label="Toggle theme"/);
    assert.match(COMMUNITY, /<h1[^>]*>Community<\/h1>/);
    assert.match(COMMUNITY, /<h2[^>]*>Latest Videos<\/h2>/);
});

test('Community page renders loading, empty, and error states for videos', () => {
    assert.match(COMMUNITY, /Loading videos\.\.\./);
    assert.match(COMMUNITY, /No videos yet\./);
    assert.match(COMMUNITY, /Failed to load videos\./);
    assert.match(COMMUNITY, /fetch\('\/api\/youtube'\)/);
});

test('Community video cards use safe links and lazy thumbnails', () => {
    assert.match(COMMUNITY, /(?:const watchUrl = 'https:\/\/www\.youtube\.com\/watch\?v=' \+ encodeURIComponent\(String\(v\.id|https:\/\/www\.youtube\.com\/watch\?v=\$\{esc\(v\.id\)\})/);
    assert.match(COMMUNITY, /(?:href="\$\{safeUrl\(watchUrl\)\}"|href="https:\/\/www\.youtube\.com\/watch\?v=\$\{esc\(v\.id\)\}")/);
    assert.match(COMMUNITY, /target="_blank" rel="noopener"/);
    assert.match(COMMUNITY, /<img src="(?:\$\{safeUrl\(v\.thumbnail\)\}|\$\{esc\(v\.thumbnail\)\})" alt="\$\{esc\(v\.title\)\}" loading="lazy">/);
});

test('Community Discord widget is accessible, sandboxed, and has loading/error behavior', () => {
    assert.match(COMMUNITY, /(?:const widgetUrl = 'https:\/\/discord\.com\/widget\?id=' \+ encodeURIComponent\(String\(data\.server_id\)|<iframe src="https:\/\/discord\.com\/widget\?id=\$\{esc\(data\.server_id\)\})/);
    assert.match(COMMUNITY, /(?:<iframe src="\$\{safeUrl\(widgetUrl\)\}" title="Join the Nekojin Discord server"|<iframe src="https:\/\/discord\.com\/widget\?id=\$\{esc\(data\.server_id\)\})/);
    assert.match(COMMUNITY, /sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"/);
    assert.match(COMMUNITY, /Loading Discord\.\.\./);
    assert.match(COMMUNITY, /id="discord-join-btn"/);
});

test('YouTube RSS parser maps entries, decodes basic entities, and caps results at 12', async () => {
    const entries = Array.from({ length: 13 }, (_, i) => `<entry><title>Video ${i} &amp; more</title><yt:videoId>AbcdefGhi${String(i).padStart(2, '0')}</yt:videoId><published>2026-01-${String(i + 1).padStart(2, '0')}</published><media:thumbnail url="https://img.test/${i}.jpg"/></entry>`).join('');
    youtube.setCache({ expires: 0, videos: [] });
    const videos = await youtube.fetchLatestVideos('UC12345678901234567890', {
        now: 1000,
        fetchFn: async () => ({ ok: true, text: async () => entries })
    });
    assert.equal(videos.length, 12);
    assert.deepEqual(videos[0], {
        title: 'Video 0 & more', id: 'AbcdefGhi00', published: '2026-01-01', thumbnail: 'https://i.ytimg.com/vi/AbcdefGhi00/maxresdefault.jpg'
    });
});

test('YouTube parser returns no videos for an unsuccessful feed response', async () => {
    youtube.setCache({ expires: 0, videos: [] });
    const videos = await youtube.fetchLatestVideos('missing-channel', {
        now: 2000,
        fetchFn: async () => ({ ok: false, text: async () => '' })
    });
    assert.deepEqual(videos, []);
});
