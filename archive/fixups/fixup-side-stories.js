// The Bedrock, The Tyrant's Rose, and The Godling and Her Husband are
// Xanrean Chronicles side stories (tier: 'moderators', same bucket as The
// Hero is Perfect). The Bedrock and Godling are each planned as multi-volume
// works, so their first entries are relabeled "Volume 1" instead of the
// generic "Coming Soon" placeholder - Godling Vol. 1 is actually finished,
// just not yet published/priced anywhere.
const db = require('../database.js');

(async () => {
    await db.Open();
    await db._run("UPDATE books SET tier = 'moderators' WHERE id IN ('the-bedrock', 'the-tyrants-rose', 'the-godling-and-her-husband')");
    await db._run("UPDATE books SET volume = 'Volume 1' WHERE id IN ('the-bedrock', 'the-godling-and-her-husband')");
    console.log('fixed');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
