// Populates lore_topics (section='world') from the existing hand-written
// overview files under public/data/lore/world/, which were never wired into
// the DB even though /xanrean/lore/world already fetches /api/lore-topics?section=world.
const fs = require('fs');
const path = require('path');
const db = require('../database.js');

const WORLD_DIR = path.join(__dirname, '..', 'public', 'data', 'lore', 'world');

const topics = [
    { slug: 'magic-systems', sort_order: 1 },
    { slug: 'server-clusters', sort_order: 2 },
    { slug: 'xanrea-a0', sort_order: 3 },
];

async function main() {
    await db.Open();
    for (const t of topics) {
        const filePath = path.join(WORLD_DIR, t.slug, 'overview.md');
        const raw = fs.readFileSync(filePath, 'utf8');
        const titleMatch = raw.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : t.slug;
        const content = raw.replace(/^#\s+.+\n/, '').trim();

        await db.InsertLoreTopic({
            id: `world-${t.slug}`,
            slug: t.slug,
            section: 'world',
            title,
            content,
            sort_order: t.sort_order,
            visible: true,
        });
        console.log(`Upserted world/${t.slug}: "${title}"`);
    }
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
