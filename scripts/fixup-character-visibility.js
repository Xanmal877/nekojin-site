// Hides characters that shouldn't be publicly visible yet:
// - moderator-chaos, moderator-order, moderator-devotion: generic stub
//   characters for Moderator roles that don't have a real named character
//   assigned yet (unlike Time -> Anna and Space -> Xanari).
// - moderator-space: a redundant stub duplicating Xanari Telis, who already
//   holds the Moderator Space role with a real name and bio.
// - acros, sarah: characters from The Tyrant's Rose, which is still
//   "Coming Soon" with no platform links, i.e. not actually out yet.
const db = require('../database.js');

const slugsToHide = [
    'acros',
    'sarah',
    'moderator-chaos',
    'moderator-order',
    'moderator-devotion',
    'moderator-space',
];

(async () => {
    await db.Open();
    for (const slug of slugsToHide) {
        const c = await db.SelectCharacterBySlug(slug);
        if (!c) { console.log('MISSING', slug); continue; }
        await db.InsertCharacter({ ...c, visible: false });
        console.log('hid', slug);
    }
    console.log('done');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
