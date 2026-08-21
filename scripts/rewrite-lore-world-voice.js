// One-off voice pass on lore_topics (section='world').content: locks in
// the exact re-voiced text from the 2026-08-21 rewrite session, replacing
// the original scripts/import-world-topics.js seed (which pulled straight
// from public/data/lore/world/*/overview.md and read very AI-flavored).
// Run this AFTER import-world-topics.js on a fresh DB, or standalone
// against an existing DB to bring it in line with dev's local DB.
const db = require('../database.js');

const topics = [
    {
        "id": "world-magic-systems",
        "slug": "magic-systems",
        "section": "world",
        "title": "Magic Systems",
        "content": "Magic in Xanrea comes down to two things: Essence and Server Logic. What people call \"magic\" is usually just someone triggering a server-side function, on purpose or by accident.\n\n## Essence\nEssence is the fuel behind every life and every magical ability in the world.\n- **Getting it**: You build up essence through natural growth, specific rituals, or, for species like Kitsune, intimate acts.\n- **Spending it**: Casting magic means burning essence to overwrite the local simulation state.\n\n## Elemental Systems\nXanrea runs on a handful of primary elements, and they're not just flavor text like \"fire\" or \"water.\" Each one is a specific data type that shapes how things in the world interact.\n- **The Sorting**: how Elves manipulate elements at a high enough level to create new life.\n- **Fae Fire**: essence turned into pure sensory overload. It hurts like hell without ever touching the underlying data, meaning the physical body.\n\n## Soulmancy\nSoulmancy is the rarest and most dangerous magic there is: directly editing a Soul's data. The Moderator AIs ban it outright, and getting caught can mean permanent deletion from the server.",
        "sort_order": 1,
        "visible": 1
    },
    {
        "id": "world-server-clusters",
        "slug": "server-clusters",
        "section": "world",
        "title": "Server Clusters",
        "content": "Xanrea isn't a planet, not really. It's a network of server clusters running the simulation of reality, physics, and soul persistence underneath everything.\n\n## Cluster Architecture\n- **Core Cluster**: runs the fundamental laws of physics and hosts the Admin interface.\n- **Regional Nodes**: distributed clusters covering specific geographic areas, mostly to keep soul-processing latency down.\n- **Persistence Layers**: where every NPC's and Traveler's data actually lives.\n\n## The Server Logic\nThink of \"the World\" as a stack of layered simulations. When a Traveler shows up, they get assigned to a node. And \"death\"? That's just the server recycling a soul-vessel and shoving the essence back into the queue for reassignment.",
        "sort_order": 2,
        "visible": 1
    },
    {
        "id": "world-xanrea-a0",
        "slug": "xanrea-a0",
        "section": "world",
        "title": "Xanrea A0",
        "content": "Xanrea A0 is the original instance, the one everyone calls \"Genesis\" or \"Root.\"\n\n## Characteristics\n- **Stability**: the most stable instance there is, the baseline every other derivative cluster gets measured against.\n- **Density**: home to the highest concentration of original Traveler souls anywhere.\n- **The Root**: A0's center is where the server's core administrative conduits are easiest to reach.\n\n## A0 Logistics\nBecause it's the root, anything that goes wrong here can ripple out across every other cluster. Keep A0 stable, or risk the whole Xanrea network.",
        "sort_order": 3,
        "visible": 1
    }
];

(async () => {
    await db.Open();
    for (const t of topics) {
        await db.InsertLoreTopic(t);
        console.log('updated', t.slug);
    }
    console.log('done');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
