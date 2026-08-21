// "The Hero is Perfect" is a Xanrean Chronicles side story, so it should
// render in the Side Stories grid on /xanrean/books (tier: 'moderators')
// instead of not appearing there at all.
const db = require('../database.js');

(async () => {
    await db.Open();
    await db._run("UPDATE books SET tier = 'moderators' WHERE id = 'the-hero-is-perfect'");
    console.log('fixed');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
