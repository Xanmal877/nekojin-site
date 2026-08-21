// Covers for The Bedrock, The Tyrant's Rose, and The Godling and Her
// Husband existed all along in My Books/My Characters/Book Covers/ but were
// missed during the initial import. Wire them in now that they've been
// processed into public/covers/.
const db = require('../database.js');

(async () => {
    await db.Open();
    await db._run("UPDATE books SET cover_path = '/covers/book-the-bedrock.webp' WHERE id = 'the-bedrock'");
    await db._run("UPDATE books SET cover_path = '/covers/book-the-tyrants-rose.webp' WHERE id = 'the-tyrants-rose'");
    await db._run("UPDATE books SET cover_path = '/covers/book-the-godling-and-her-husband.webp' WHERE id = 'the-godling-and-her-husband'");
    console.log('fixed');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
