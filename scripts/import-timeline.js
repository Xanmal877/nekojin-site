// Populates timeline_events from the Xanrea Lore Compendium's master timeline
// (Xanrea_Lore_Compendium.md, Eras I-XI + Confirmed Story Order section).
const db = require('../database.js');

const events = [
    {
        id: 'era-1-reggie-and-tulip',
        title: 'Era I: Reggie and Tulip',
        era: 'Universe A0',
        description: 'The earliest currently known events in the main storyline concern Reggie, Tulip, and Sarah. Tulip, Reggie, and their companions eventually become involved in the conflict surrounding Sarah, who declares herself the Demon Queen. The confrontation ultimately ends with Tulip sacrificing her divine power in order to bind Sarah into the throne. Sarah is trapped in a state between life and death. Tulip dies during the process but later returns as a Traveler, having lost her former divine abilities. She remains behind to guard Sarah\'s imprisonment. Reggie survives these events. Much later, Reggie becomes the Sensei who trains Tamaneko. This period forms the earliest known foundation of the A0 storyline.',
        related_character_slugs: ['sarah'],
        related_book_id: null,
        sort_order: 1
    },
    {
        id: 'era-2-her-majesty-tamaneko',
        title: 'Era II: Her Majesty, Tamaneko',
        era: 'Universe A0',
        description: 'Years later, the primary events of Her Majesty, Tamaneko begin. Tamaneko and Autumn Sakilera are both eighteen years old at the beginning of the story. Tama is the Princess of Trissaile and the Avatar of the Goddess of Creation. Saki becomes her Royal Advisor. Their story expands from local adventuring and political problems into increasingly large conflicts involving Trissaile, Travelers, gods, souls, and the deeper systems underlying A0. Over the course of the series, several years pass. Tama eventually claims the throne and becomes Queen of Trissaile. Saki remains her Royal Advisor. Usaki eventually becomes Regent. The later portions of the story involve war on a much greater scale, including the conflict surrounding the enormous invading fleet.',
        related_character_slugs: ['tama', 'saki'],
        related_book_id: 'her-majesty-tamaneko',
        sort_order: 2
    },
    {
        id: 'era-3-the-bedrock',
        title: 'Era III: The Bedrock',
        era: 'Universe A0',
        description: 'The Bedrock begins during the same broad era as Her Majesty, Tamaneko. Xanari Telis arrives in A0 as a Traveler. He is twenty-four years old when his story begins. Xan rapidly becomes involved with the divine systems of the world and eventually becomes a Demigod of Creation. His development occurs alongside the later events of Her Majesty, Tamaneko. The two stories overlap within the same universe and time period. By the time Xan encounters Saki during Her Majesty, Tamaneko, he has already accumulated significant power and accomplishments.',
        related_character_slugs: ['xanari', 'saki'],
        related_book_id: 'the-bedrock',
        sort_order: 3
    },
    {
        id: 'era-4-end-of-early-a0',
        title: 'Era IV: The End of the Early A0 Story',
        era: 'Universe A0',
        description: 'Eventually, the events of Her Majesty, Tamaneko and The Bedrock reach their conclusions. The exact amount of time separating their endings from later server history is currently undefined. What is known is that Xanari\'s role changes fundamentally after the conclusion of his mortal and divine life within A0.',
        related_character_slugs: ['xanari'],
        related_book_id: null,
        sort_order: 4
    },
    {
        id: 'era-5-xanari-becomes-a-moderator',
        title: 'Era V: Xanari Becomes a Moderator',
        era: 'Administrative Transition',
        description: 'After the A0-era stories conclude, Admin Destruction assigns Xanari a Moderator role. Xanari becomes part of the administrative structure governing the Xanrea server. This marks an important transition in the larger storyline. The saga is no longer concerned only with characters living inside individual universes. Characters originating from those universes are now becoming part of the systems that govern the universes themselves.',
        related_character_slugs: ['xanari', 'saki'],
        related_book_id: null,
        sort_order: 5
    },
    {
        id: 'era-6-the-godling-and-her-husband',
        title: 'Era VI: The Godling and Her Husband',
        era: 'Universe A7',
        description: 'After an unknown amount of time has passed, the events of The Godling and Her Husband take place in Universe A7. This story becomes one of the most important turning points in the entire server\'s history. At this point, deletion of soul data is still understood to be necessary for certain large-scale processes. The problem is that deletion appears to mean permanent loss. During the events surrounding The Godling and Her Husband, they discover that this assumption is incomplete. Soul data still has to be erased. However, the souls themselves do not need to remain permanently deleted. They can be recreated afterward. This means a universe can undergo the necessary deletion and cleanup process while its inhabitants can later be restored. Everything still has to die during the process. That part cannot be avoided. But death no longer has to mean permanent erasure. This discovery fundamentally changes what becomes possible at the administrative level.',
        related_character_slugs: [],
        related_book_id: 'the-godling-and-her-husband',
        sort_order: 6
    },
    {
        id: 'era-7-foundation-of-reset-technology',
        title: 'Era VII: The Foundation of Reset Technology',
        era: 'Administrative Transition',
        description: 'The discovery made during the A7 era becomes the foundation for later reset technology. Anna, who later operates as Moderator Time, is eventually able to make use of this principle. A reset can erase the current state while allowing souls and their world to be reconstructed afterward. The ability does not originate from nowhere. It is the later application of the soul-recycling discovery made during the events surrounding The Godling and Her Husband. This creates a direct causal link between the A7 storyline and the much later Toybox era.',
        related_character_slugs: ['anna'],
        related_book_id: null,
        sort_order: 7
    },
    {
        id: 'era-8-the-centuries-between',
        title: 'Era VIII: The Centuries Between',
        era: 'Unwritten History',
        description: 'Several centuries pass after the events of The Godling and Her Husband. The exact duration is not currently defined. This period remains intentionally open for future stories and events.',
        related_character_slugs: [],
        related_book_id: null,
        sort_order: 8
    },
    {
        id: 'era-9-the-tyrants-rose',
        title: 'Era IX: The Tyrant\'s Rose',
        era: 'Acros\'s Universe (possibly Z23)',
        description: 'A few hundred years after The Godling and Her Husband, the events of The Tyrant\'s Rose occur. Acros does not live in Universe A0. His story takes place in another universe hosted by the Xanrea server. The exact universe designation is currently unconfirmed; it may be Z23, but this should remain marked as uncertain until the designation is recovered or formally established. Before the primary version of the story, Acros has already lived through another history. In that original timeline, Acros conquers his world, and his conquest eventually reaches the divine level: gods and other divine beings are defeated or enslaved. That history is later overwritten: Acros is sent backward through time, and the timeline is rewritten. The version of The Tyrant\'s Rose followed by the story takes place within this altered history, where Acros is given another opportunity and is eventually tasked with saving the world and defeating the Demon Lord. The existence of both histories makes The Tyrant\'s Rose unusual within the larger timeline: its primary narrative is already the result of a previous timeline having been replaced.',
        related_character_slugs: ['acros'],
        related_book_id: 'the-tyrants-rose',
        sort_order: 9
    },
    {
        id: 'era-10-the-toybox',
        title: 'Era X: The Toybox',
        era: 'Outside the Normal Universe System',
        description: 'Much later, the storyline reaches the era of The Toybox. The Toybox is not one of the Xanrea server\'s normal universes. It\'s a small simulation world created by Moderator Time. Anna constructs it using spare RAM left over from the server itself. Because the Toybox only has access to unused server resources, Anna is working under extremely restrictive memory limitations; her complaints about having very little RAM are therefore literal. The Toybox is effectively a small simulation running in whatever computational space the larger server can spare.',
        related_character_slugs: ['anna'],
        related_book_id: null,
        sort_order: 10
    },
    {
        id: 'era-11-the-hero-is-perfect',
        title: 'Era XI: The Hero is Perfect',
        era: 'The Toybox',
        description: 'The Hero is Perfect takes place inside the Toybox. By this point, the characters involved are operating at a vastly different scale from the early A0 stories. The world now includes active Moderators, Admins, resets, iterations, reconstructed souls, and direct manipulation of server-level systems. The reset mechanics used by Moderator Time are possible because of the breakthrough made much earlier during The Godling and Her Husband. The Toybox can therefore undergo repeated resets and iterations without requiring the permanent loss of everyone inside it. This is the latest major era currently established in the storyline.',
        related_character_slugs: ['anna'],
        related_book_id: 'the-hero-is-perfect',
        sort_order: 11
    }
];

(async () => {
    await db.Open();
    for (const e of events) {
        await db.InsertTimelineEvent(e);
        console.log('inserted', e.id);
    }
    console.log('done');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
