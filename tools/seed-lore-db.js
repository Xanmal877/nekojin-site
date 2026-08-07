const contentDB = require('../database.js');

async function seedLore() {
    console.log('🚀 Starting Lore DB Seeding...');
    await contentDB.Open();

    // --- Timeline Events ---
    const timelineEvents = [
        { id: 'ev-creation-of-the-three-original-ais', title: "Creation of the Three Original AIs", era: "Cosmic / pre-system", description: "Admin Creation, Admin Destruction, and Moderator Time were created directly by the system or its creator as the cluster's three original maintenance AIs.", related_character_slugs: ['tama', 'saki', 'anna'], related_book_id: null, sort_order: 1, visible: 1 },
        { id: 'ev-the-rollback', title: "The Rollback", era: "Pre-Xanrea rollback", description: "Tama and Saki entered Xanrea during the rollback with administrative memories suppressed, living genuinely as a royal Nekojin, ninja, and princess (Tama) and a Kitsune strategist and royal advisor (Saki).", related_character_slugs: ['tama', 'saki'], related_book_id: null, sort_order: 2, visible: 1 },
        { id: 'ev-tamas-village-destroyed', title: "Tama's Village Destroyed by Undead", era: "Tama's childhood", description: "While she was still a young child, undead forces destroyed Tama's village and killed her parents; she was later found by Reginald Torweather, whom she came to know as Sensei.", related_character_slugs: ['tama'], related_book_id: null, sort_order: 3, visible: 1 },
        { id: 'ev-sensei-raises-tama', title: "Sensei Raises and Trains Tama", era: "Tama's childhood", description: "Sensei raised and trained Tama for years in isolation; she later found him transformed into an undead being and was forced to kill him herself.", related_character_slugs: ['tama'], related_book_id: null, sort_order: 4, visible: 1 },
        { id: 'ev-sakis-family-killed', title: "Saki's Family Killed by Undead", era: "Saki's childhood", description: "As a child Saki disobeyed a warning, wandered into dangerous territory, and later watched undead creatures kill her mother and sisters.", related_character_slugs: ['saki'], related_book_id: null, sort_order: 5, visible: 1 },
        { id: 'ev-acros-god-conqueror-devil', title: "Acros Becomes the God Conqueror Devil", era: "The First Timeline", description: "In the original timeline Acros conquered the planet while searching for Rose, earning the name God Conqueror Devil.", related_character_slugs: ['acros'], related_book_id: null, sort_order: 6, visible: 1 },
        { id: 'ev-aurelium-sends-acros-back', title: "Aurelium Sends Acros Back", era: "The Tyrant's Rose (Server Z-12)", description: "Aurelium, the God of Time, offered Acros a second chance; Acros accepted and was sent back to the beginning of his journey.", related_character_slugs: ['acros', 'sarah'], related_book_id: null, sort_order: 7, visible: 1 },
        { id: 'ev-sarahs-origin-as-a-tulpe', title: "Sarah's Origin as a Tulpe", era: "The Tyrant's Rose (Server Z-12)", description: "Sarah is a tulpe, a soul Acros unconsciously shaped from his longing for Rose; she began as a grief-construct.", related_character_slugs: ['sarah', 'acros'], related_book_id: null, sort_order: 8, visible: 1 },
        { id: 'ev-sarah-takes-roses-form', title: "Sarah Takes Rose's Form", era: "The Tyrant's Rose (Server Z-12)", description: "By the end of the series Sarah takes Rose's form; Acros kills her immediately, experiencing it as Sarah erasing herself.", related_character_slugs: ['sarah', 'acros'], related_book_id: null, sort_order: 9, visible: 1 },
        { id: 'ev-emergence-of-order-and-chaos', title: "Emergence of Moderator Order and Moderator Chaos", era: "Server Z-12 (post-crisis)", description: "Acros's and Sarah's lives on Server Z-12 are the origin from which Moderator Order and Moderator Chaos emerge together as a linked pair.", related_character_slugs: ['acros', 'sarah', 'moderator-order', 'moderator-chaos'], related_book_id: null, sort_order: 10, visible: 1 },
        { id: 'ev-xanari-becomes-moderator-space', title: "Xanari Becomes Moderator Space", era: "Post-Traveler life", description: "Xanari took on the role of Moderator Space; a copy of his soul remains behind as the Moderator AI while the original Xanari moves on.", related_character_slugs: ['xanari', 'moderator-space'], related_book_id: null, sort_order: 11, visible: 1 },
        { id: 'ev-tama-assigns-xanari', title: "Tama Assigns Xanari's Soul-Data Copy to Moderator Space", era: "Cosmic / post-rollback", description: "Acting as Admin Creation, Tama assigned the approved soul-data copy of Xanari 'Xan' Telis to the office of Moderator Space.", related_character_slugs: ['tama', 'xanari', 'moderator-space'], related_book_id: null, sort_order: 12, visible: 1 },
        { id: 'ev-annas-creation-in-muosil', title: "Anna's Creation in Muosil", era: "Pre-Xanrean Chronicles", description: "Anna was artificially created from holy water in Muosil; her creator ordered her to possess a young girl, and she killed the girl's parents before being discarded.", related_character_slugs: ['anna'], related_book_id: null, sort_order: 13, visible: 1 },
        { id: 'ev-anna-destroys-muosil', title: "Anna Destroys Muosil", era: "Post-creation, future planned series", description: "Anna later returned to Muosil, destroyed the city that created and discarded her, and killed the High Priestess responsible for her origin.", related_character_slugs: ['anna'], related_book_id: null, sort_order: 14, visible: 1 },
        { id: 'ev-xanrea-time-dilation', title: "Xanrea's Time Dilation vs Earth", era: "Ongoing world rule", description: "Xanrea runs at a much faster rate than Earth; entire centuries in Xanrea pass in a few hours of real time.", related_character_slugs: [], related_book_id: null, sort_order: 15, visible: 1 },
    ];

    console.log('📦 Seeding timeline events...');
    for (const event of timelineEvents) {
        await contentDB.InsertTimelineEvent(event);
    }

    // --- Character Relationships ---
    const relationshipsData = {
        'tama': [
            { character_slug: "saki", character_name: "Saki", relationship_type: "friendship", description: "Best friends and emotional anchor; equal cosmic counterparts through their Administrator offices." },
            { character_slug: "saki", character_name: "Saki", relationship_type: "appointment", description: "Tama appoints Saki as her royal advisor." },
            { character_slug: "xanari", character_name: "Xanari", relationship_type: "assignment", description: "Acting as Admin Creation, Tama assigned the approved soul-data copy of Xanari to the precreated office of Moderator Space." },
        ],
        'saki': [
            { character_slug: "tama", character_name: "Tama", relationship_type: "loyalty", description: "Saki gives Tama strategy, restraint, and honest opposition; Tama gives Saki trust and acceptance." },
            { character_slug: "anna", character_name: "Anna", relationship_type: "equal", description: "More equal and argumentative; Saki challenges Anna's assumptions while Anna reduces the mental pressure of Saki's destructive authority." },
        ],
        'anna': [
            { character_slug: "tama", character_name: "Tama", relationship_type: "companion", description: "Deeply aligned with Admin Creation; often becomes Tama's clothing, armor, healer, protector, and companion; affectionate but hierarchical." },
            { character_slug: "saki", character_name: "Saki", relationship_type: "equal", description: "More equal and argumentative; Saki challenges Anna's assumptions while Anna reduces the mental pressure of Saki's destructive authority." },
        ],
        'acros': [
            { character_slug: "sarah", character_name: "Sarah", relationship_type: "captor", description: "Relationship begins with murder, captivity, hostility, and coercion, and becomes companion, rival, critic, protector, and eventual emotional equal." },
            { character_slug: "sarah", character_name: "Sarah", relationship_type: "boundary", description: "When Sarah possesses and traumatizes a child, Acros reacts with genuine fury and threatens to erase her if she ever does it again." },
            { character_slug: "sarah", character_name: "Sarah", relationship_type: "values over Rose", description: "Sarah is not Rose; the transformation moment proves Sarah has become more real to Acros than Rose ever was." },
        ],
        'sarah': [
            { character_slug: "acros", character_name: "Acros", relationship_type: "origin", description: "Sarah originates from Acros; she is a soul unconsciously shaped from his longing for Rose." },
            { character_slug: "acros", character_name: "Acros", relationship_type: "attachment", description: "Sarah develops her own identity, desires, cruelty, loyalties, and attachment to Acros despite beginning as a grief-construct." },
        ],
        'moderator-order': [
            { character_slug: "moderator-chaos", character_name: "Moderator Chaos", relationship_type: "counterpart", description: "Counterparts who cannot safely erase each other; the relationship begins with Acros and Sarah before either moderator identity exists." },
            { character_slug: "tama", character_name: "Tama", relationship_type: "subordinate", description: "Moderator Order's authority is administrative in function but remains beneath the Administrators in the system hierarchy." },
        ],
        'moderator-chaos': [
            { character_slug: "moderator-order", character_name: "Moderator Order", relationship_type: "counterpart", description: "Counterparts who cannot safely erase each other; the relationship begins with Acros and Sarah before either moderator identity exists." },
            { character_slug: "tama", character_name: "Tama", relationship_type: "subordinate", description: "Moderator Chaos's authority is administrative in function but remains beneath the Administrators in the system hierarchy." },
        ],
        'xanari': [
            { character_slug: "moderator-space", character_name: "Moderator Space", relationship_type: "identity continuity", description: "A copy of Xanari's soul remains behind as the Moderator AI while the original moves on; the copy is not treated as a disposable imitation." },
        ],
    };

    console.log('📦 Seeding character relationships...');
    let relsSeeded = 0;
    for (const [slug, relationships] of Object.entries(relationshipsData)) {
        await contentDB.UpdateCharacterRelationships(slug, relationships);
        relsSeeded += relationships.length;
    }

    // Reporting skipped relationships (moderator-time)
    console.log('⚠️  Skipped relationships for "moderator-time" as slug does not exist in seeded characters.');

    await contentDB.Close();
    console.log(`✨ Lore seeding complete!`);
    console.log(`- Timeline events seeded: ${timelineEvents.length}`);
    console.log(`- Character relationship entries seeded: ${relsSeeded}`);
}

seedLore().catch(err => {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
});
