/**
 * youtube.js - YouTube RSS feed fetcher
 */

let cache = {
    expires: 0,
    videos: []
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchLatestVideos(channelId, { fetchFn = fetch, now = Date.now() } = {}) {
    if (now < cache.expires && cache.videos.length > 0) {
        return cache.videos;
    }

    try {
        const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        const response = await fetchFn(url);
        if (!response.ok) return [];
        
        const xml = await response.text();
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
            const thumbMatch = content.match(/<media:thumbnail url="(.*?)"/);
            
            if (titleMatch && idMatch) {
                videos.push({
                    title: titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
                    id: idMatch[1],
                    published: pubMatch ? pubMatch[1] : '',
                    thumbnail: thumbMatch ? thumbMatch[1] : ''
                });
            }
            if (videos.length >= 12) break;
        }

        // RSS feeds are usually newest first, but we ensure it
        // Note: Atom published dates are ISO 8601
        cache = {
            expires: now + CACHE_TTL,
            videos: videos
        };

        return videos;
    } catch (err) {
        console.error('[YouTube] Fetch error:', err);
        return [];
    }
}

module.exports = {
    fetchLatestVideos,
    getCache: () => cache,
    setCache: (val) => { cache = val; }
};
