// Gumroad is being dropped as a storefront, so every gumroad link has to come
// off the site: the book_platforms rows that render the store buttons on
// /books and /book, and the cta_platform values that decide which store the
// reader CTAs point at. Anything left on 'gumroad' would fall through to the
// generic "Other" button with a dead URL, so those books move to 'kdp'.
//
// Safe to re-run: deleting by URL prefix is idempotent, and the cta_platform
// update only touches rows that are still on gumroad.
//
//   node archive/fixups/remove-gumroad-links.js           # print what would change
//   node archive/fixups/remove-gumroad-links.js --apply   # back up, then change
const db = require('../../database.js');

const GUMROAD_URL_PREFIX = 'https://purplexanmal.gumroad.com/%';
const APPLY = process.argv.includes('--apply');

(async () => {
    await db.Open();

    const platforms = await db._all(
        'SELECT id, book_id, platform_type, url FROM book_platforms WHERE url LIKE ? OR platform_type = ?',
        [GUMROAD_URL_PREFIX, 'gumroad']
    );
    const ctas = await db._all(
        "SELECT id, title, cta_platform FROM books WHERE cta_platform = 'gumroad'"
    );

    console.log(`gumroad platform rows to delete: ${platforms.length}`);
    for (const p of platforms) console.log(`  [${p.id}] ${p.book_id} ${p.platform_type} ${p.url}`);
    console.log(`books with a gumroad CTA to move to kdp: ${ctas.length}`);
    for (const b of ctas) console.log(`  ${b.id} (${b.title})`);

    if (!platforms.length && !ctas.length) {
        console.log('Nothing to do — no gumroad links left.');
        process.exit(0);
    }

    if (!APPLY) {
        console.log('\nDry run. Re-run with --apply to back up and write.');
        process.exit(0);
    }

    const backupPath = await db.CreateBackup('pre-gumroad-removal');
    console.log(`\nBackup: ${backupPath}`);

    // Match on the URL as well as platform_type so an old row that was tagged
    // 'other' but still points at Gumroad cannot survive the cleanup.
    const del = await db._run(
        'DELETE FROM book_platforms WHERE url LIKE ? OR platform_type = ?',
        [GUMROAD_URL_PREFIX, 'gumroad']
    );
    const upd = await db._run(
        "UPDATE books SET cta_platform = 'kdp' WHERE cta_platform = 'gumroad'"
    );

    console.log(`Deleted ${del.changes} platform row(s); moved ${upd.changes} CTA(s) to kdp.`);

    const left = await db._all(
        'SELECT id FROM book_platforms WHERE url LIKE ? OR platform_type = ?',
        [GUMROAD_URL_PREFIX, 'gumroad']
    );
    console.log(`Remaining gumroad rows: ${left.length}`);

    console.log('Run `npm run meta` to regenerate rss.xml.');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
