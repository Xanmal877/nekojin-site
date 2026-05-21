#!/usr/bin/env node
/**
 * Multi-Platform Story Metrics Scraper
 * Royal Road + ScribbleHub
 * - Reads story config dynamically from content.json (same file the admin site manages)
 * - Adding/removing a book in the admin site automatically affects what gets scraped
 * - Uses Puppeteer to render JavaScript and extract live metrics
 * - Appends daily history, deduplicates by calendar date
 * - Computes growth vs previous entry
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs   = require('fs');
const path = require('path');

const METRICS_FILE = path.join(__dirname, 'story-metrics.json');
const CONTENT_FILE = path.join(__dirname, '..', 'site-content.json');

////////////////////////////////////////////////////////////
// CONFIG LOADER
// Reads content.json and extracts RR + SH platform links.
// Expected content.json shape:
//   { books: [ { title, platforms: [ { type, url } ] } ] }
//
// Platform types recognised:
//   'rr'  -> Royal Road  (extracts numeric fiction ID from URL)
//   'sh'  -> ScribbleHub (uses full URL as-is — bare IDs are unreliable)
////////////////////////////////////////////////////////////

function loadStoryConfig() {
    let content;
    try {
        content = JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
    } catch (err) {
        console.error(`❌  Could not read ${CONTENT_FILE}:`, err.message);
        process.exit(1);
    }

    // { rrId: title }
    const royalroad   = {};
    // { title: fullUrl }
    const scribblehub = {};

    // Helper: extract platforms from a single book
    function processBook(book) {
        if (!book.title) return;
        for (const plat of (book.platforms || [])) {
            if (!plat.url) continue;
            if (plat.type === 'rr') {
                const m = plat.url.match(/\/fiction\/(\d+)/);
                if (m) royalroad[m[1]] = book.title;
            } else if (plat.type === 'sh') {
                scribblehub[book.title] = plat.url;
            }
        }
    }

    // Books inside series
    for (const series of (content.series || [])) {
        for (const book of (series.books || [])) processBook(book);
    }

    // Standalone books (content.books array)
    for (const book of (content.books || [])) processBook(book);

    return { royalroad, scribblehub };
}

////////////////////////////////////////////////////////////
// ROYAL ROAD
// FIX: Was scraping PAGES (length estimate) instead of CHAPTERS (chapter count)
////////////////////////////////////////////////////////////

async function scrapeRoyalRoad(page, fictionId) {
    const url = `https://www.royalroad.com/fiction/${fictionId}`;

    try {
        // Bumped to 60s — networkidle2 on RR can be slow with stealth headers
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('.fiction-stats', { timeout: 15000 }).catch(() => {});

        const metrics = await page.evaluate(() => {
            const text = document.body.innerText;

            const followers = text.match(/FOLLOWERS\s*[:\s]\s*([\d,]+)/i);
            const views     = text.match(/(?:TOTAL\s+)?VIEWS\s*[:\s]\s*([\d,]+)/i);

            // "154 Chapters" appears in the TABLE OF CONTENTS header as plain text
            const tocText      = document.body.innerText.match(/(\d+)\s+Chapters?/i);
            const chapterCount = tocText ? parseInt(tocText[1]) : null;

            return {
                followers: followers ? parseInt(followers[1].replace(/,/g, ''))  : null,
                views:     views     ? parseInt(views[1].replace(/,/g, ''))      : null,
                chapters:  chapterCount,
            };
        });

        return metrics;
    } catch (err) {
        console.error(`RR scrape error ${fictionId}:`, err.message);
        return { followers: null, views: null, chapters: null };
    }
}

////////////////////////////////////////////////////////////
// SCRIBBLEHUB
// FIX: Receives full URL — bare /series/<id>/ redirects are unreliable
// FIX: Stat label is "Reading" (active list), NOT "Favorites" (bookmarks)
////////////////////////////////////////////////////////////

async function scrapeScribblehub(page, url) {
    try {
        // networkidle2 hangs on SH due to persistent background JS
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // CRITICAL: Wait for Cloudflare challenge to complete
        // Cloudflare typically takes 5-10 seconds to verify the browser
        console.log('    Waiting for Cloudflare (10 seconds)...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // DEBUG: Take screenshot and dump text
        try {
            const screenshotPath = path.join(__dirname, 'sh-debug-screenshot.png');
            await page.screenshot({ path: screenshotPath });
            console.log(`    📸 Screenshot saved: ${screenshotPath}`);
        } catch (e) {
            console.log('    ⚠️  Screenshot failed:', e.message);
        }

        const metrics = await page.evaluate(() => {
            const text = document.body.innerText;

            // Check if we're still on Cloudflare page
            const isCloudflare = text.includes('Checking your browser') || 
                                text.includes('Just a moment') ||
                                text.includes('Cloudflare');

            // Anchor to word boundary — must NOT match "Plan to Read"
            const readers  = text.match(/([\d,.]+[kKmM]?)\s+Reading\b/i);
            const viewsRaw = text.match(/([\d,.]+[kKmM]?)\s+Views?/i);
            const chapters = text.match(/(\d+)\s+Chapters?/i);

            function parseShNum(str) {
                if (!str) return null;
                str = str.replace(/,/g, '').toLowerCase();
                let mult = 1;
                if (str.endsWith('k')) { mult = 1_000;     str = str.slice(0, -1); }
                if (str.endsWith('m')) { mult = 1_000_000; str = str.slice(0, -1); }
                return Math.round(parseFloat(str) * mult);
            }

            return {
                followers: parseShNum(readers?.[1]),
                views:     parseShNum(viewsRaw?.[1]),
                chapters:  chapters ? parseInt(chapters[1]) : null,
                __debug: {
                    isCloudflare,
                    textSample: text.slice(0, 300),
                }
            };
        });

        // Log debug info
        if (metrics.__debug.isCloudflare) {
            console.log(`    ⚠️  STILL ON CLOUDFLARE PAGE`);
            console.log(`    Page text: ${metrics.__debug.textSample}`);
        } else if (metrics.followers === null && metrics.views === null) {
            console.log(`    ⚠️  No stats found in page`);
            console.log(`    Page text: ${metrics.__debug.textSample}`);
        }

        delete metrics.__debug;
        return metrics;
    } catch (err) {
        console.error(`SH scrape error (${url}):`, err.message);
        return { followers: null, views: null, chapters: null };
    }
}

////////////////////////////////////////////////////////////
// SAVE + HISTORY SYSTEM
////////////////////////////////////////////////////////////

function loadMetrics() {
    try {
        return JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
    } catch {
        return { stories: {}, lastUpdated: null };
    }
}

function saveMetrics(data) {
    fs.writeFileSync(METRICS_FILE, JSON.stringify(data, null, 2));
}

function updateHistory(metricsData, key, scraped, meta) {
    const story = metricsData.stories[key] || { history: [] };

    const now       = new Date();
    const today     = now.toISOString().split('T')[0];
    const timestamp = now.toISOString();

    const entry = {
        date:      today,
        timestamp,
        followers: scraped.followers,
        chapters:  scraped.chapters,
        views:     scraped.views,
    };

    // Deduplicate by calendar date — replace same-day entry if re-run
    const idx = story.history.findIndex(e => e.date === today);
    if (idx === -1) story.history.push(entry);
    else            story.history[idx] = entry;

    // Sort newest first
    story.history.sort((a, b) => new Date(b.timestamp ?? b.date) - new Date(a.timestamp ?? a.date));

    story.platform  = meta.platform;
    story.title     = meta.title;
    story.id        = meta.id;
    story.followers = scraped.followers;
    story.chapters  = scraped.chapters;
    story.views     = scraped.views;

    if (story.history.length > 1) {
        const prev = story.history[1];
        story.growth = {
            followers: (scraped.followers ?? 0) - (prev.followers ?? 0),
            chapters:  (scraped.chapters  ?? 0) - (prev.chapters  ?? 0),
            views:     (scraped.views     ?? 0) - (prev.views     ?? 0),
        };
    } else {
        story.growth = { followers: 0, chapters: 0, views: 0 };
    }

    metricsData.stories[key] = story;
}

////////////////////////////////////////////////////////////
// CLEANUP: Remove ghost entries from story-metrics.json
// (URL-keyed entries, null-title entries, old wp- entries)
////////////////////////////////////////////////////////////

function cleanGhostEntries(metricsData) {
    let removed = 0;
    for (const key of Object.keys(metricsData.stories)) {
        const story    = metricsData.stories[key];
        const isGhost  =
            !story.title                ||
            key.startsWith('http')      ||
            key.startsWith('wp-')       ||  // Wattpad entries removed
            (!key.startsWith('sh-') && !key.startsWith('rr-'));
        if (isGhost) {
            delete metricsData.stories[key];
            removed++;
        }
    }
    if (removed > 0) console.log(`🧹  Cleaned ${removed} ghost/Wattpad entry(s) from metrics file`);
}

////////////////////////////////////////////////////////////
// MAIN
////////////////////////////////////////////////////////////

async function main() {
    console.log('📊  Multi-Platform Metrics Scraper\n');

    const { royalroad, scribblehub } = loadStoryConfig();

    const rrCount = Object.keys(royalroad).length;
    const shCount = Object.keys(scribblehub).length;

    if (rrCount + shCount === 0) {
        console.error('❌  No stories found in content.json. Make sure books have rr/sh platform links.');
        process.exit(1);
    }

    console.log(`📋  Loaded from content.json: ${rrCount} Royal Road, ${shCount} ScribbleHub\n`);

    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: '/usr/bin/chromium',
        userDataDir: path.join(__dirname, 'chrome-profile'),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--lang=en-US,en',
            '--disable-blink-features=AutomationControlled',
        ],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 1365, height: 768 });

    const metricsData = loadMetrics();
    cleanGhostEntries(metricsData);

    // ── ROYAL ROAD ──────────────────────────────────────────
    if (rrCount > 0) {
        console.log('📖  Royal Road:');
        for (const [id, title] of Object.entries(royalroad)) {
            console.log(`  Scraping ${title}...`);
            const data = await scrapeRoyalRoad(page, id);
            updateHistory(metricsData, `rr-${id}`, data, { platform: 'royalroad', title, id });
            console.log(`    Followers: ${data.followers ?? 'N/A'} | Chapters: ${data.chapters ?? 'N/A'} | Views: ${data.views?.toLocaleString() ?? 'N/A'}`);
        }
    }

    // ── SCRIBBLEHUB ─────────────────────────────────────────
    if (shCount > 0) {
        console.log('\n📚  ScribbleHub:');
        let shIndex = 0;
        for (const [title, url] of Object.entries(scribblehub)) {
            console.log(`  Scraping ${title}...`);
            const data = await scrapeScribblehub(page, url);

            // Extract numeric ID from URL for stable history keys
            const idMatch = url.match(/\/series\/(\d+)\//);
            const id      = idMatch ? idMatch[1] : title;

            updateHistory(metricsData, `sh-${id}`, data, { platform: 'scribblehub', title, id });
            console.log(`    Readers: ${data.followers ?? 'N/A'} | Chapters: ${data.chapters ?? 'N/A'} | Views: ${data.views?.toLocaleString() ?? 'N/A'}`);
            
            // Add delay between stories to avoid rate limiting (except for last story)
            shIndex++;
            if (shIndex < shCount) {
                console.log('    Waiting 5 seconds before next story...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    metricsData.lastUpdated = new Date().toISOString();
    saveMetrics(metricsData);

    // ── GROWTH REPORT ────────────────────────────────────────
    console.log('\n📈  Growth Report (vs previous entry):');
    for (const story of Object.values(metricsData.stories)) {
        if (!story.title || !story.platform) continue;
        const g    = story.growth || { followers: 0, chapters: 0, views: 0 };
        const sign = n => n >= 0 ? `+${n}` : `${n}`;
        console.log(`  ${story.title} (${story.platform}): ${sign(g.followers)} followers, ${sign(g.views)} views`);
    }

    await browser.close();
    console.log('\n✨  Done.');
}

main();
