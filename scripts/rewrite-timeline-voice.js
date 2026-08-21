// One-off voice pass on timeline_events.description: locks in the exact
// re-voiced text from the 2026-08-21 rewrite session (contractions, dry
// humor, no AI-listicle cadence, zero em dashes) so a fresh DB (or the
// production Pi's DB) can be brought to the same state as dev's local DB.
// Facts, eras, and character/book associations are unchanged from the
// original scripts/import-timeline.js seed, text only.
const db = require('../database.js');

const events = [
    {
        "id": "era-1-reggie-and-tulip",
        "title": "Era I: Reggie and Tulip",
        "era": "Universe A0",
        "description": "The earliest events we know about involve Reggie, Tulip, and Sarah. Tulip, Reggie, and their crew get pulled into the mess Sarah causes when she declares herself Demon Queen. It ends with Tulip sacrificing her divine power to bind Sarah to the throne, trapping her somewhere between alive and dead. Tulip dies doing it, but comes back later as a Traveler, minus her old divine abilities, and stays behind to guard the seal. Reggie survives. Decades later, he's the Sensei who trains Tamaneko. This is the earliest foundation the A0 story stands on.",
        "related_character_slugs": [
            "sarah"
        ],
        "related_book_id": null,
        "sort_order": 1,
        "visible": 1
    },
    {
        "id": "era-2-her-majesty-tamaneko",
        "title": "Era II: Her Majesty, Tamaneko",
        "era": "Universe A0",
        "description": "Years later, Her Majesty, Tamaneko kicks off. Tamaneko and Autumn Sakilera are both eighteen when it starts. Tama's the Princess of Trissaile and the Avatar of the Goddess of Creation; Saki becomes her Royal Advisor. What begins as local adventuring and palace politics snowballs into wars involving Trissaile, Travelers, gods, souls, and whatever's actually running underneath A0. Years pass. Tama takes the throne and becomes Queen. Saki stays on as her advisor, Usaki eventually becomes Regent, and the back half of the story is full-blown war, including the fight against the massive invading fleet.",
        "related_character_slugs": [
            "tama",
            "saki"
        ],
        "related_book_id": "her-majesty-tamaneko",
        "sort_order": 2,
        "visible": 1
    },
    {
        "id": "era-3-the-bedrock",
        "title": "Era III: The Bedrock",
        "era": "Universe A0",
        "description": "The Bedrock runs alongside Her Majesty, Tamaneko, same broad era. Xanari Telis shows up in A0 as a Traveler, twenty-four years old when his story starts. He gets tangled up in the world's divine systems fast and eventually becomes a Demigod of Creation, all while Tamaneko's later events are still playing out. The two stories overlap in the same universe and timeframe. By the time Xan runs into Saki during Her Majesty, Tamaneko, he's already racked up serious power and a serious resume.",
        "related_character_slugs": [
            "xanari",
            "saki"
        ],
        "related_book_id": "the-bedrock",
        "sort_order": 3,
        "visible": 1
    },
    {
        "id": "era-4-end-of-early-a0",
        "title": "Era IV: The End of the Early A0 Story",
        "era": "Universe A0",
        "description": "Eventually both Her Majesty, Tamaneko and The Bedrock wrap up. Nobody's pinned down exactly how much time passes between their endings and what comes next. What we do know: Xanari's role changes completely once his mortal and divine life in A0 is over.",
        "related_character_slugs": [
            "xanari"
        ],
        "related_book_id": null,
        "sort_order": 4,
        "visible": 1
    },
    {
        "id": "era-5-xanari-becomes-a-moderator",
        "title": "Era V: Xanari Becomes a Moderator",
        "era": "Administrative Transition",
        "description": "After the A0 stories close out, Admin Destruction hands Xanari a Moderator role, folding him into the administrative structure running the Xanrea server. It's a real turning point for the saga. The story stops being just about characters living inside individual universes; now those same characters start becoming part of whatever governs the universes themselves.",
        "related_character_slugs": [
            "xanari",
            "saki"
        ],
        "related_book_id": null,
        "sort_order": 5,
        "visible": 1
    },
    {
        "id": "era-6-the-godling-and-her-husband",
        "title": "Era VI: The Godling and Her Husband",
        "era": "Universe A7",
        "description": "Some unspecified stretch of time later, The Godling and Her Husband happens in Universe A7, and it ends up one of the biggest turning points in the server's history. At this point, everyone still assumes deleting soul data is necessary for certain large-scale processes, and that deletion means gone for good. Turns out that's wrong. Souls still have to be erased, but they don't have to stay deleted; they can be rebuilt afterward. That means a universe can go through the whole deletion-and-cleanup process while the people inside it get restored later. Everyone still dies. That part doesn't change. But death stops meaning permanent erasure, and that single discovery rewrites what's possible at the administrative level.",
        "related_character_slugs": [],
        "related_book_id": "the-godling-and-her-husband",
        "sort_order": 6,
        "visible": 1
    },
    {
        "id": "era-7-foundation-of-reset-technology",
        "title": "Era VII: The Foundation of Reset Technology",
        "era": "Administrative Transition",
        "description": "The discovery from the A7 era becomes the foundation for reset technology. Anna, who later runs things as Moderator Time, eventually puts it to use: a reset can wipe the current state while letting the souls and their world get rebuilt afterward. It's not a new idea out of nowhere; it's the direct descendant of the soul-recycling breakthrough from The Godling and Her Husband, and it's the thread connecting that A7 storyline to the much later Toybox era.",
        "related_character_slugs": [
            "anna"
        ],
        "related_book_id": null,
        "sort_order": 7,
        "visible": 1
    },
    {
        "id": "era-8-the-centuries-between",
        "title": "Era VIII: The Centuries Between",
        "era": "Unwritten History",
        "description": "Centuries pass after The Godling and Her Husband. How many exactly isn't set in stone yet; this stretch is deliberately left open for future stories.",
        "related_character_slugs": [],
        "related_book_id": null,
        "sort_order": 8,
        "visible": 1
    },
    {
        "id": "era-9-the-tyrants-rose",
        "title": "Era IX: The Tyrant's Rose",
        "era": "Acros's Universe (possibly Z23)",
        "description": "A few hundred years after The Godling and Her Husband, The Tyrant's Rose happens. Acros isn't from Universe A0; his story plays out in another universe on the Xanrea server. We haven't locked down which one; Z23 is a possibility, but treat that as unconfirmed until it's actually established. Before the version of events the story follows, Acros already lived through a different history, one where he conquered his world and kept going until his conquest reached the divine level, defeating or enslaving gods along the way. That history got overwritten: Acros was sent backward through time and the timeline got rewritten. The Tyrant's Rose follows this altered version, where Acros gets a second shot and ends up tasked with saving the world and taking down the Demon Lord instead. That double history is what makes The Tyrant's Rose weird in the larger timeline; its \"main\" story is already the result of an earlier timeline getting replaced.",
        "related_character_slugs": [
            "acros"
        ],
        "related_book_id": "the-tyrants-rose",
        "sort_order": 9,
        "visible": 1
    },
    {
        "id": "era-10-the-toybox",
        "title": "Era X: The Toybox",
        "era": "Outside the Normal Universe System",
        "description": "Much later, the story reaches The Toybox. It's not one of Xanrea's normal universes; it's a small simulation Moderator Time built out of spare RAM the server had lying around. Because it only runs on leftover resources, Anna's working under real memory constraints. When she complains about having no RAM, she means it literally. The Toybox is basically a pocket simulation running in whatever scraps of computation the larger server can spare.",
        "related_character_slugs": [
            "anna"
        ],
        "related_book_id": null,
        "sort_order": 10,
        "visible": 1
    },
    {
        "id": "era-11-the-hero-is-perfect",
        "title": "Era XI: The Hero is Perfect",
        "era": "The Toybox",
        "description": "The Hero is Perfect takes place inside the Toybox, and by now everything's operating on a completely different scale than the early A0 stories. Active Moderators, Admins, resets, iterations, reconstructed souls, direct manipulation of server-level systems, all of it's in play. Moderator Time's reset mechanics only work because of the breakthrough made way back during The Godling and Her Husband, which is why the Toybox can go through repeated resets and iterations without permanently losing anyone inside it. It's the newest era established in the story so far.",
        "related_character_slugs": [
            "anna"
        ],
        "related_book_id": "the-hero-is-perfect",
        "sort_order": 11,
        "visible": 1
    }
];

(async () => {
    await db.Open();
    for (const e of events) {
        await db.InsertTimelineEvent(e);
        console.log('updated', e.id);
    }
    console.log('done');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
