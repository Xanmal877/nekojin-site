// Cleanup after import-books.js: a stray empty draft stub for "The Tyrant's
// Rose" already existed (id the-tyrant-s-rose, created 2026-08-18) with a
// real cover already uploaded for it but no synopsis. Remove the stub,
// carry its cover over to the properly-populated record, and flip all three
// in-progress titles to published (still purchase-link-free) so they render
// as "Coming Soon" on the public site instead of being hidden entirely.
const db = require('../database.js');

(async () => {
    await db.Open();
    await db._run('DELETE FROM books WHERE id = ?', ['the-tyrant-s-rose']);
    await db._run(
        'UPDATE books SET cover_path = ?, status = ? WHERE id = ?',
        ['/covers/the-tyrant-s-rose-1787031402510.webp', 'published', 'the-tyrants-rose']
    );
    await db._run(
        "UPDATE books SET status = 'published' WHERE id IN ('the-bedrock', 'the-godling-and-her-husband')"
    );
    console.log('fixed');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
