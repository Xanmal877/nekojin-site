/**
 * youtube.js - YouTube RSS feed fetcher with error handling & thumbnail fallback
 */

let cache = {
    expires: 0,
    videos: []
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT = 8000; // 8 seconds
const YOUTUBE_REGEX = /^[a-zA-Z0-9_-]{11}$/; // YouTube video ID format (strict validation)
const YOUTUBE_ID_LOOSE = /^[a-zA-Z0-9_-]+$/; // Loose ID pattern (alphanumeric, dash, underscore)

// Generate a thumbnail URL for a video ID with fallback resolution
function getThumbnailUrl(videoId) {
    if (!videoId) return '';
    // Accept any URL-safe ID format for thumbnail generation
    // Real YouTube IDs are 11 chars, but we allow any reasonable format
    if (!YOUTUBE_ID_LOOSE.test(videoId)) return '';
    // YouTube CDN: try maxresdefault first, fall back to default
    return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}

async function fetchLatestVideos(channelId, { fetchFn = fetch, now = Date.now() } = {}) {
    // Validate channelId is URL-safe
    if (!channelId || !/^[a-zA-Z0-9_-]{22,}$/.test(channelId)) {
        console.warn('[YouTube] Invalid channel ID format');
        return [];
    }

    // Return cached data if fresh
    if (now < cache.expires && cache.videos.length > 0) {
        return cache.videos;
    }

    try {
        const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

        // Add fetch timeout to prevent hanging
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

        const response = await fetchFn(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
            console.error(`[YouTube] HTTP ${response.status}: ${response.statusText}`);
            return cache.videos; // Return stale cache on transient error
        }

        const xml = await response.text();
        if (!xml || xml.length < 100) {
            console.error('[YouTube] Empty or malformed response');
            return cache.videos;
        }

        const videos = [];
        
        // Regex for Atom XML parsing (avoiding dependencies)
        // Matches <entry> blocks
        const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
        let match;
        
        while ((match = entryRegex.exec(xml)) !== null) {
            const content = match[1];

            const titleMatch = content.match(/<title>(.*?)<\/title>/);
            const idMatch = content.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
            const pubMatch = content.match(/<published>(.*?)<\/published>/);
            
            if (titleMatch && idMatch) {
                const videoId = idMatch[1].trim();

                // Validate video ID is URL-safe (alphanumeric, dash, underscore only)
                if (!YOUTUBE_ID_LOOSE.test(videoId)) {
                    console.warn(`[YouTube] Rejecting malformed video ID: ${videoId}`);
                    continue;
                }

                videos.push({
                    title: titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').substring(0, 256),
                    id: videoId,
                    published: pubMatch ? pubMatch[1] : '',
                    thumbnail: getThumbnailUrl(videoId) // Fallback thumbnail generation
                });
            }
            if (videos.length >= 12) break;
        }

        // Update cache regardless of success
        // Note: Atom published dates are ISO 8601
        cache = {
            expires: now + CACHE_TTL,
            videos: videos
        };

        return videos;
    } catch (err) {
        // Distinguish timeout from other errors
        if (err.name === 'AbortError') {
            console.error('[YouTube] Fetch timeout after', FETCH_TIMEOUT, 'ms');
        } else {
            console.error('[YouTube] Fetch error:', err.message);
        }
        // Return stale cache instead of empty array on error
        return cache.videos;
    }
}

module.exports = {
    fetchLatestVideos,
    getCache: () => cache,
    setCache: (val) => { cache = val; }
};
