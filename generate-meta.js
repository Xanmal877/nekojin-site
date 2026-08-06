#!/usr/bin/env node
/**
 * Generate sitemap.xml, rss.xml, and robots.txt from the live SQLite content DB.
 * Run manually (`npm run meta`) or import generateAll() to call after a save.
 */
const fs = require('fs');
const path = require('path');
const contentDB = require('./database.js');

const BASE_URL = 'https://worldofxanrea.com';
const PUBLIC_DIR = path.join(__dirname, 'public');

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function nowIso() {
  return new Date().toISOString();
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── robots.txt ────────────────────────────────────────────
function generateRobots() {
  const txt = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /dashboard
Disallow: /login
Disallow: /logout
Disallow: /register
Disallow: /api/

Sitemap: ${BASE_URL}/sitemap.xml
`;
  fs.writeFileSync(path.join(PUBLIC_DIR, 'robots.txt'), txt);
}

// Static (non-content-driven) public routes worth indexing.
const STATIC_URLS = [
  { loc: '/', priority: '1.0', changefreq: 'weekly' },
  { loc: '/books', priority: '0.9', changefreq: 'weekly' },
  { loc: '/games', priority: '0.9', changefreq: 'monthly' },
  { loc: '/about', priority: '0.7', changefreq: 'monthly' },
  { loc: '/xanrean', priority: '0.8', changefreq: 'monthly' },
  { loc: '/xanrean/books', priority: '0.8', changefreq: 'weekly' },
  { loc: '/xanrean/characters', priority: '0.7', changefreq: 'monthly' },
  { loc: '/xanrean/characters/moderators', priority: '0.6', changefreq: 'monthly' },
  { loc: '/xanrean/wiki', priority: '0.6', changefreq: 'monthly' },
  { loc: '/xanrean/lore', priority: '0.7', changefreq: 'monthly' },
  { loc: '/xanrean/lore/characters', priority: '0.6', changefreq: 'monthly' },
  { loc: '/xanrean/lore/species', priority: '0.6', changefreq: 'monthly' },
  { loc: '/xanrean/lore/world', priority: '0.5', changefreq: 'monthly' },
  { loc: '/xanrean/lore/nekojin', priority: '0.5', changefreq: 'monthly' },
  { loc: '/xanrean/lore/foxkin', priority: '0.5', changefreq: 'monthly' },
  { loc: '/xanrean/lore/elves', priority: '0.5', changefreq: 'monthly' },
  { loc: '/xanrean/lore/travelers', priority: '0.5', changefreq: 'monthly' },
  { loc: '/xanrean/lore/wolfkin', priority: '0.5', changefreq: 'monthly' },
  { loc: '/xanrean/lore/kitsune', priority: '0.5', changefreq: 'monthly' },
];

// ── sitemap.xml ─────────────────────────────────────────
async function generateSitemap(books) {
  const urls = [...STATIC_URLS];

  for (const book of books.filter(b => b.visible !== false)) {
    urls.push({
      loc: `/book?id=${encodeURIComponent(book.id)}`,
      priority: '0.9',
      changefreq: 'weekly',
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${BASE_URL}${u.loc}</loc>
    <lastmod>${todayIso()}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap.xml'), xml);
}

// ── rss.xml (Atom) ──────────────────────────────────────
async function generateRSS(books) {
  const visibleBooks = books.filter(b => b.visible !== false);

  const entries = visibleBooks.map(book => {
    const description = book.description || '';
    const platforms = (book.platforms || []).map(p =>
      `<a href="${esc(p.url)}">${esc(p.name || p.type)}</a>`
    ).join(' · ');

    return `  <entry>
    <title>${esc(book.title)}${book.volume ? ' - ' + esc(book.volume) : ''}</title>
    <link href="${BASE_URL}/books#${encodeURIComponent(book.id)}" />
    <id>${BASE_URL}/books#${encodeURIComponent(book.id)}</id>
    <updated>${nowIso()}</updated>
    <summary>${esc(description.slice(0, 300))}${description.length > 300 ? '…' : ''}</summary>
    <content type="html"><![CDATA[
      <p>${esc(description)}</p>
      <p><strong>Platforms:</strong> ${platforms}</p>
    ]]></content>
  </entry>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Nekojin Interactive - Latest Books</title>
  <link href="${BASE_URL}/" />
  <link rel="self" href="${BASE_URL}/rss.xml" />
  <updated>${nowIso()}</updated>
  <id>${BASE_URL}/</id>
  <author>
    <name>Nekojin Interactive</name>
  </author>
${entries}
</feed>`;

  fs.writeFileSync(path.join(PUBLIC_DIR, 'rss.xml'), xml);
}

// Regenerates robots.txt, sitemap.xml, and rss.xml from the current DB content.
// Safe to call repeatedly (e.g. after every /save-content).
async function generateAll() {
  await contentDB.Open();
  const books = await contentDB.SelectBooks();
  generateRobots();
  await generateSitemap(books);
  await generateRSS(books);
}

module.exports = { generateAll };

// CLI usage: `node generate-meta.js` / `npm run meta`
if (require.main === module) {
  generateAll()
    .then(() => {
      console.log('✓ robots.txt, sitemap.xml, rss.xml regenerated from database');
      return contentDB.Close();
    })
    .catch(err => {
      console.error('Meta generation failed:', err);
      process.exit(1);
    });
}
