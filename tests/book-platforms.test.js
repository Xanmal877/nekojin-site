// The single-book write path replaces a book's platform rows; a repeat save
// must not duplicate the previous set (the delete-then-insert has to happen
// inside the same save).
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { ROOT } = require('./harness.js');

test('re-saving a single book replaces its platforms instead of duplicating them', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'book-platforms-'));

    // database.js is a singleton bound to the real ./data/nekojin.db, so this
    // suite loads a copy with the path constants repointed. The copy needs
    // ./lib/url beside it and node_modules resolvable, and the temp dir plus
    // the open handle must be released even when the assert fails.
    let db = null;
    try {
        const dbFile = path.join(dir, 'books.db');
        const source = fs.readFileSync(path.join(ROOT, 'database.js'), 'utf8')
            .replace("const DB_PATH = path.join(DB_DIR, 'nekojin.db');", `const DB_PATH = ${JSON.stringify(dbFile)};`)
            .replace("const BACKUP_DIR = path.join(DB_DIR, 'backups');", `const BACKUP_DIR = ${JSON.stringify(path.join(dir, 'backups'))};`)
            .replace("const DB_DIR = path.join(__dirname, 'data');", `const DB_DIR = ${JSON.stringify(dir)};`);
        const modulePath = path.join(dir, 'database.js');
        fs.writeFileSync(modulePath, source);
        fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
        fs.copyFileSync(path.join(ROOT, 'lib', 'url.js'), path.join(dir, 'lib', 'url.js'));
        fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
        db = require(modulePath);

        await db.Open();
        const book = {
            id: 'dup-test', title: 'Dup Test', slug: 'dup-test', status: 'published',
            platforms: [{ type: 'rr', name: 'Royal Road', url: 'https://royalroad.com/fiction/1' }]
        };
        await db.InsertBook(book);
        await db.InsertBook(book);

        const platforms = await db.SelectBookPlatforms('dup-test');
        assert.strictEqual(platforms.length, 1, `expected 1 platform row, found ${platforms.length}`);
    } finally {
        if (db) await db.Close().catch(() => {});
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
