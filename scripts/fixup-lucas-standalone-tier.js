// Lucas the Grand Strategist is the one standalone work, and it sits outside the
// Xanrean universe; The Hero is Perfect is a novella *inside* it. Both carried
// tier 'novella', which made the Xanrean collection list Lucas and /books'
// standalone grid list Hero next to him.
//
// tier now means: 'series' (a volume of a series), 'novella' (in-universe
// novella), 'omnibus' (collected edition). A book with no series_id and no
// 'novella' tier is a standalone work outside the universe — which is how the
// pages classify Lucas once his tier is cleared.
//
// Run it from the repo root, against whichever copy owns the content:
//   node scripts/fixup-lucas-standalone-tier.js
const db = require('../database.js');

const EXPECTED = [['lucas-the-grand-strategist', null], ['the-hero-is-perfect', 'novella']];

const show = (rows) => rows.map(b => `${b.id}=${b.tier ?? 'null'}`).join(' ');

(async () => {
    await db.Open();
    const ids = EXPECTED.map(([id]) => `'${id}'`).join(',');
    const select = `SELECT id, tier, series_id FROM books WHERE id IN (${ids}) ORDER BY id`;

    console.log('before:', show(await db._all(select)));

    await db._run(`UPDATE books SET tier = NULL, updated_at = CURRENT_TIMESTAMP
                   WHERE id = 'lucas-the-grand-strategist' AND tier = 'novella'`);
    await db._run(`UPDATE books SET tier = 'novella', updated_at = CURRENT_TIMESTAMP
                   WHERE id = 'the-hero-is-perfect' AND (tier IS NULL OR tier = '')`);

    const after = await db._all(select);
    console.log('after: ', show(after));

    const ok = EXPECTED.every(([id, tier]) => {
        const row = after.find(b => b.id === id);
        return row && (row.tier ?? null) === tier;
    });
    console.log(ok ? '✅ standalone and in-universe novella tiers are correct'
                   : '❌ tiers do not match expectations');
    process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
