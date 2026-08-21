// The Godling and Her Husband is now actually published on Gumroad
// (purplexanmal.gumroad.com/l/the-godling-and-her-husband), so wire the
// real buy link into the site alongside its existing RR/ScribbleHub links.
const db = require('../database.js');

(async () => {
    await db.Open();
    await db._run(
        "INSERT INTO book_platforms (book_id, platform_type, platform_name, url, sort_order) VALUES (?, ?, ?, ?, ?)",
        ['the-godling-and-her-husband', 'gumroad', 'Gumroad', 'https://purplexanmal.gumroad.com/l/the-godling-and-her-husband', 2]
    );
    await db._run("UPDATE books SET cta_platform = 'gumroad' WHERE id = 'the-godling-and-her-husband'");
    console.log('done');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
