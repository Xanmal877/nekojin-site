#!/usr/bin/env node
/**
 * Generate sitemap.xml, rss.xml, and robots.txt from site-content.json
 * Run manually after content changes, or add to a post-save hook.
 */
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://worldofxanrea.com';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONTENT_FILE = path.join(__dirname, 'site-content.json');

function loadContent() {
  return JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
}

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function nowIso() {
  return new Date().toISOString();
}

// ── robots.txt ────────────────────────────────────────────
function generateRobots() {
  const txt = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /dashboard
Disallow: /aichat.html
Disallow: /login
Disallow: /logout

Sitemap: ${BASE_URL}/sitemap.xml
`;
  fs.writeFileSync(path.join(PUBLIC_DIR, 'robots.txt'), txt);
  console.log('✓ robots.txt');
}

// ── sitemap.xml ─────────────────────────────────────────
function generateSitemap() {
  const data = loadContent();
  const urls = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/books', priority: '0.9', changefreq: 'weekly' },
    { loc: '/games', priority: '0.9', changefreq: 'monthly' },
    { loc: '/about', priority: '0.7', changefreq: 'monthly' },
    { loc: '/action_registry.html', priority: '0.3', changefreq: 'monthly' },
  ];

  for (const book of (data.books || []).filter(b => b.visible !== false)) {
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
  console.log('✓ sitemap.xml');
}

// ── rss.xml (Atom) ──────────────────────────────────────
function generateRSS() {
  const data = loadContent();
  const books = (data.books || []).filter(b => b.visible !== false);

  const entries = books.map(book => {
    const platforms = (book.platforms || []).map(p =>
      `<a href="${esc(p.url)}">${esc(p.name || p.type)}</a>`
    ).join(' · ');

    return `  <entry>
    <title>${esc(book.title)}${book.volume ? ' - ' + esc(book.volume) : ''}</title>
    <link href="${BASE_URL}/books#${encodeURIComponent(book.id)}" />
    <id>${BASE_URL}/books#${encodeURIComponent(book.id)}</id>
    <updated>${nowIso()}</updated>
    <summary>${esc(book.description.slice(0, 300))}${book.description.length > 300 ? '…' : ''}</summary>
    <content type="html"><![CDATA[
      <p>${esc(book.description)}</p>
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
  console.log('✓ rss.xml');
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Run
generateRobots();
generateSitemap();
generateRSS();
console.log('\nDone. Add this to your <head> on every page:');
console.log(`  <link rel="alternate" type="application/atom+xml" title="Nekojin Interactive Feed" href="${BASE_URL}/rss.xml" />`);
