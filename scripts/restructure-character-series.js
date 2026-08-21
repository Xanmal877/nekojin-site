// Restructures the character system from one flat universe-wide list into
// series-owned casts, per the two source docs the author supplied:
// ~/Downloads/GHH_Cast_and_Overview.md and ~/Downloads/HMT_Cast_and_Overview.md
//
// - Creates series rows for The Godling and Her Husband and The Bedrock
//   (both previously standalone books with no series_id), linking their
//   existing book rows in.
// - Sets home-series appearances for the characters that already existed
//   (Tama, Saki, Anna -> Her Majesty, Tamaneko; Xanari -> The Bedrock, with
//   a guest appearance in The Godling and Her Husband since he's already
//   visible there in a released book).
// - Adds full profiles for the docs' Core + Major recurring cast tiers.
//   Minor named figures (one-liners in the docs) are intentionally NOT
//   added here; they render as a static list on the series cast page
//   instead (see public/xanrean/series/cast.html's MINOR_CAST block).
//
// Visibility follows the rule worked out this session: a character is
// visible only if at least one of their appearances is in a book that's
// actually purchasable right now (a real book_platforms row with a URL),
// not just DB status. Checked against the DB at the time this script was
// written:
//   - The Godling and Her Husband Vol. 1: real Gumroad link, genuinely out.
//   - The Bedrock: status says published but has zero real platform links,
//     same situation as Tyrant's Rose. Not actually out yet.
//   - Her Majesty, Tamaneko: only Volumes 1-4 are published books. The HMT
//     doc's "First major appearance: Volume N" per character decides who's
//     visible; Volume 5+ characters stay hidden until those books exist.
const db = require('../database.js');

async function ensureSeries(id, name, description) {
    await db.InsertSeries({ id, universe: name, universeDesc: description, sort_order: 0 });
}

async function linkBookToSeries(bookSlug, seriesId, volumeNumber) {
    const books = await db.SelectBooks();
    const book = books.find(b => b.slug === bookSlug);
    if (!book) { console.log('MISSING BOOK', bookSlug); return; }
    await db.InsertBook({ ...book, series_id: seriesId, volume_number: volumeNumber });
    console.log('linked book', bookSlug, '->', seriesId);
}

async function setAppearances(slug, appearances) {
    const c = await db.SelectCharacterBySlug(slug);
    if (!c) { console.log('MISSING CHARACTER', slug); return; }
    await db.ReplaceCharacterAppearances(c.id, appearances);
    console.log('set appearances for', slug);
}

async function upsertCharacter(data) {
    await db.InsertCharacter(data);
    await db.ReplaceCharacterAppearances(data.id, data.appearances || []);
    console.log('upserted character', data.slug);
}

const HMT = 'her-majesty-tamaneko';
const GHH = 'the-godling-and-her-husband';
const BEDROCK = 'the-bedrock';

const ghhCharacters = [
    {
        id: 'char-arissa', slug: 'arissa', name: 'Arissa', title: 'The Godling',
        char_type: 'Character', species: 'Godling', emoji: '👑', visible: true,
        content: `# Arissa

## Role

Main protagonist of The Godling and Her Husband. Arissa is secretly the Godling everyone in the hero world is hunting, and eventually becomes the CleanSweeper.

## Function

Arissa is the cosmic center of the series: immensely powerful, delusional, obsessive, and devoted to Mark. Over the course of Volume 1 she moves from a darkly comic domestic partner to a figure capable of modifying souls, people, and eventually reality itself, culminating in her consuming the universe to preserve Mark.

## Key relationships

Wife of Mark. Lifelong connection to Sabrina. Ally, rival, and eventually target of the HGO. Later linked to Clara and Sabtee through the Wife Games and the reconstructed universe.

## Point of view

One of the primary narrators throughout both volumes.`,
        appearances: [{ series_id: GHH, cast_group: 'Main Cast', is_home: true }],
    },
    {
        id: 'char-mark', slug: 'mark', name: 'Mark', title: "Arissa's Husband",
        char_type: 'Character', species: 'Human', emoji: '🧑', visible: true,
        content: `# Mark

## Role

Arissa's husband and soul-bound partner, and co-protagonist of The Godling and Her Husband.

## Function

Strategist, manipulator, and the person most able to direct Arissa's extreme worldview. His survival becomes the decisive motive behind the end of Volume 1, when Arissa consumes the universe to preserve him.

## Key relationships

Husband to Arissa. Later accepted by Sabtee as husband. Object of Clara's interest. Connected to Sarah primarily through Arissa.

## Point of view

One of the primary narrators in Volume 1.`,
        appearances: [{ series_id: GHH, cast_group: 'Main Cast', is_home: true }],
    },
    {
        id: 'char-sabrina', slug: 'sabrina', name: 'Sabrina', title: "Arissa's Friend",
        char_type: 'Character', species: 'Human', emoji: '🦸', visible: true,
        content: `# Sabrina

## Role

Arissa's longtime friend and lover, an HGO-connected heroine, and later one of the central survivors and resisters in the reconstructed universe.

## Function

Emotional anchor to Arissa's pre-Godling life and a skeptic toward the cosmic explanation for what Arissa is. She becomes a major threat to the false reality Arissa builds, because she retains memories that shouldn't have survived.

## Key relationships

Loves Arissa. Clashes with Clara. Competes in the Wife Games. Works with, and against, the golems depending on circumstance.

## Point of view

Major POV character late in Volume 1 and at the start of Volume 2.`,
        appearances: [{ series_id: GHH, cast_group: 'Main Cast', is_home: true }],
    },
    {
        id: 'char-clara', slug: 'clara', name: 'Clara', title: 'Time-Powered Heroine',
        char_type: 'Character', species: 'Human', emoji: '⏱️', visible: true,
        content: `# Clara

## Role

A time-powered heroine, former teammate of Terantha, who becomes a follower of Arissa and a Wife Games participant.

## Function

Brings HGO politics, time manipulation, and a deliberately warped social worldview into the core household. Becomes one of the main secondary POVs.

## Key relationships

Attracted to Mark. Fascinated by Arissa. Rivals Sabrina and Sabtee. Old teammate of Terantha.

## Point of view

Major POV character in Volume 1.`,
        appearances: [{ series_id: GHH, cast_group: 'Main Cast', is_home: true }],
    },
    {
        id: 'char-sabtee', slug: 'sabtee', name: 'Sabrina "Sabtee"', title: 'Cosmic Golem',
        char_type: 'Character', species: 'Golem', emoji: '✨', visible: true,
        content: `# Sabtee

## Role

A Xanari-created cosmic golem, the blonde and robed one, who adopts the nickname Sabtee to avoid confusion with the human Sabrina.

## Function

One of the two golems sent to locate and activate the CleanSweeper. Becomes fascinated with Mark, chooses him as husband, and joins the household.

## Key traits

Extremely powerful, literal, service-oriented, and highly loyal. Comfortable treating cosmic-scale events as ordinary job functions.

## Key relationships

Creation of Xanari. Sister counterpart to Sarah. Devoted to Mark. Friendly with Arissa. Rival to Clara and Sabrina in the Wife Games.`,
        appearances: [{ series_id: GHH, cast_group: 'Household / Wife Games', is_home: true }],
    },
    {
        id: 'char-sarah-golem', slug: 'sarah-golem', name: 'Sarah', title: 'Combat Golem',
        char_type: 'Character', species: 'Golem', emoji: '🔨', visible: true,
        content: `# Sarah

## Role

A red-haired combat golem created by Xanari.

## Function

The violent, hammer-wielding counterpart to Sabtee. Sent to locate the CleanSweeper, and acts as a terrifying physical threat even to top-tier heroes.

## Key traits

Short speech, enormous physical power, loves fighting and smashing enemies.

## Key relationships

Golem-sister counterpart to Sabtee. Creation of Xanari.

*Not to be confused with the golem/spirit companion Sarah tied to The Tyrant's Rose, or with Sarah Liturgis referenced in Her Majesty, Tamaneko.*`,
        appearances: [{ series_id: GHH, cast_group: 'Golems / Cosmic Agents', is_home: true }],
    },
    {
        id: 'char-oldresca', slug: 'oldresca', name: 'Oldresca', title: 'HGO Guardian',
        char_type: 'Character', species: 'Non-human', emoji: '🛡️', visible: true,
        content: `# Oldresca

## Role

An extremely powerful non-human hero and guardian associated with the HGO.

## Function

A mentor-like figure and heavy hitter. His caution, technical mindset, and danger sense make him one of the few characters who immediately recognizes how dangerous Sarah is.

## Key relationships

Works around Clara, Arissa, Mark, Sabrina, and the HGO. Repeatedly clashes with Sarah.`,
        appearances: [{ series_id: GHH, cast_group: 'HGO / Heroes', is_home: true }],
    },
    {
        id: 'char-zerk', slug: 'zerk', name: 'Zerk', title: 'Broker / Fixer',
        char_type: 'Character', species: 'Human', emoji: '💼', visible: true,
        content: `# Zerk

## Role

A broker, fixer, and quest-giver with access to rare technology, knowledge, jobs, and payment schemes.

## Function

A recurring source of missions and deals, providing the street-level and commercial connective tissue between the household and the larger plots.

## Key relationships

Familiar with Mark, Arissa, Oldresca, and the wider hero and mercenary ecosystem.`,
        appearances: [{ series_id: GHH, cast_group: 'Fixers / Mission Contacts', is_home: true }],
    },
    {
        id: 'char-terantha', slug: 'terantha', name: 'Terantha', title: 'The Spiderqueen',
        char_type: 'Character', species: 'Human', emoji: '🕷️', visible: true,
        content: `# Terantha

## Role

A heroine known as the Spiderqueen, Clara's former teammate, with web and string-based powers.

## Function

An HGO authority and contact who investigates Clara's increasingly suspicious behavior, and is later altered by Arissa.

## Key relationships

Old friend and teammate of Clara.`,
        appearances: [{ series_id: GHH, cast_group: 'HGO / Heroes', is_home: true }],
    },
    {
        id: 'char-reaver', slug: 'reaver', name: 'Reaver', title: 'HGO Hero',
        char_type: 'Character', species: 'Human', emoji: '⚔️', visible: true,
        content: `# Reaver

## Role

An HGO hero.

## Function

A recurring hero-world supporting character who participates in the Godling briefing and the broader HGO social network.`,
        appearances: [{ series_id: GHH, cast_group: 'HGO / Heroes', is_home: true }],
    },
    {
        id: 'char-canary', slug: 'canary', name: 'Canary', title: 'HGO Heroine',
        char_type: 'Character', species: 'Human', emoji: '🐤', visible: true,
        content: `# Canary

## Role

An HGO heroine.

## Function

Participates in the Godling investigation and briefing, and acts as one of the more grounded hero-world voices around the core cast.`,
        appearances: [{ series_id: GHH, cast_group: 'HGO / Heroes', is_home: true }],
    },
    {
        id: 'char-tresca', slug: 'tresca', name: 'Tresca', title: 'HGO Hero',
        char_type: 'Character', species: 'Human', emoji: '🌀', visible: true,
        content: `# Tresca

## Role

A teleport-capable supporting figure in the HGO and hero network.

## Function

A recurring supporting hero involved in missions and movement between locations.`,
        appearances: [{ series_id: GHH, cast_group: 'HGO / Heroes', is_home: true }],
    },
    {
        id: 'char-tarthrissa', slug: 'tarthrissa', name: "Tar'Thrissa", title: 'Alien Ruler',
        char_type: 'Character', species: 'Non-human', emoji: '👽', visible: false,
        content: `# Tar'Thrissa

## Role

A powerful non-human ruler or authority associated with Trum'Thar and the later cosmic-scale rebuilding storyline.

## Function

Represents the wider non-human civilization affected by Arissa, Sabtee, and the CleanSweeper aftermath.

*Part of the Volume 2 storyline, which hasn't published yet, so this profile stays hidden until that book is out.*`,
        appearances: [{ series_id: GHH, cast_group: 'Alien / Later-arc Cast', is_home: true }],
    },
    {
        id: 'char-drekmur', slug: 'drekmur', name: "Drek'mur", title: 'Alien Supporting Figure',
        char_type: 'Character', species: 'Non-human', emoji: '👽', visible: false,
        content: `# Drek'mur

## Role

A supporting non-human figure tied to Tar'Thrissa's world and city.

## Function

Part of the later alien and cosmic supporting cast.

*Part of the Volume 2 storyline, which hasn't published yet, so this profile stays hidden until that book is out.*`,
        appearances: [{ series_id: GHH, cast_group: 'Alien / Later-arc Cast', is_home: true }],
    },
];

const hmtCharacters = [
    {
        id: 'char-talia', slug: 'talia', name: 'Matriarch Talia', title: 'The Forge of Fire',
        char_type: 'Character', species: 'Wolfkin', emoji: '🔥', visible: true,
        content: `# Matriarch Talia, "The Forge of Fire"

## Role

Drestor Adventurers' Guild master, a powerful Wolfkin, and Tama's aunt.

## Function

Mentor, military heavyweight, experienced authority figure, and one of the few people capable of physically challenging Tama early in the series.

First major appearance: Volume 1.`,
        appearances: [{ series_id: HMT, cast_group: 'Inner Circle', is_home: true }],
    },
    {
        id: 'char-tera', slug: 'tera', name: 'Teranthia "Tera" Tulip', title: "Tama's Royal Protector",
        char_type: 'Character', species: 'Human', emoji: '🗡️', visible: true,
        content: `# Teranthia "Tera" Tulip

## Role

A warrior and adventurer, later formally named Tama's Royal Protector.

## Function

Forces Tama to confront royal duty and responsibility, and becomes one of the core military and personal members of Tama's circle.

First major appearance: Volume 1.`,
        appearances: [{ series_id: HMT, cast_group: 'Inner Circle', is_home: true }],
    },
    {
        id: 'char-david', slug: 'david', name: 'David', title: 'Adventurer',
        char_type: 'Character', species: 'Human', emoji: '🏹', visible: true,
        content: `# David

## Role

An adventurer and member of Tama and Saki's wider party.

## Function

A recurring frontline companion closely associated with Tera and the Drestor group.

First major appearance: Volume 1.`,
        appearances: [{ series_id: HMT, cast_group: 'Inner Circle', is_home: true }],
    },
    {
        id: 'char-grok', slug: 'grok', name: 'Grok', title: 'Goblin War Chief',
        char_type: 'Character', species: 'Goblin', emoji: '🪓', visible: true,
        content: `# Grok

## Role

Goblin war chief and leader of the Grub'tera-aligned goblin forces.

## Function

Tama's goblin ally and one of her most important unconventional military partners. Despite his crude manner, he's repeatedly shown to be an effective leader of his people.

First major appearance: Volume 2.`,
        appearances: [{ series_id: HMT, cast_group: 'Inner Circle', is_home: true }],
    },
    {
        id: 'char-manna', slug: 'manna', name: 'Mantheria "Manna"', title: 'Ancient Green Dragon',
        char_type: 'Character', species: 'Dragon', emoji: '🐉', visible: true,
        content: `# Mantheria "Manna"

## Role

An ancient green dragon and recurring divine and ancient power around Tama.

## Function

Starts as a mysterious watcher who insists Tama is destined for greatness, then becomes a protector, antagonist, ally, and eventually a major hinge point in the Caldera's divine and political structure.

First major appearance: Volume 1.`,
        appearances: [{ series_id: HMT, cast_group: 'Powerful Allies / Wildcards', is_home: true }],
    },
    {
        id: 'char-lyran', slug: 'lyran', name: 'Lyran', title: "Saki's Partner",
        char_type: 'Character', species: 'Human', emoji: '🔧', visible: true,
        content: `# Lyran

## Role

Engineer and inventor, Saki's partner, later the kingdom's chief technical problem-solver.

## Function

Handles technology, teleportation, scanning, magical engineering, and later wartime technical work.

First major appearance: mid-series, becoming central by Volumes 4 through 7.`,
        appearances: [{ series_id: HMT, cast_group: 'Inner Circle', is_home: true }],
    },
    {
        id: 'char-tristy', slug: 'tristy', name: 'Tristy', title: 'Court Companion',
        char_type: 'Character', species: 'Human', emoji: '🎭', visible: true,
        content: `# Tristy

## Role

A servant and slave turned recurring companion, and a showy arena personality.

## Function

Recurring court and party member with strong loyalty to Tama and a flamboyant presence.

First major appearance: Volume 3.`,
        appearances: [{ series_id: HMT, cast_group: 'Inner Circle', is_home: true }],
    },
    {
        id: 'char-usaki', slug: 'usaki', name: 'Usaki', title: 'Political Operator',
        char_type: 'Character', species: 'Kitsune', emoji: '🦊', visible: true,
        content: `# Usaki

## Role

A Saki-derived clone or alternate figure, later a trusted regent-level political operator.

## Function

A powerful mirror of Saki whose intelligence and political instincts make her useful in crises, especially during Saki's incapacitation.

First major appearance: Volume 2, with a larger political role later.`,
        appearances: [{ series_id: HMT, cast_group: 'Inner Circle', is_home: true }],
    },
    {
        id: 'char-kita', slug: 'kita', name: 'Kita', title: 'Princess of Rojier',
        char_type: 'Character', species: 'Human', emoji: '👸', visible: false,
        content: `# Kita

## Role

Princess, later Empress, of Rojier. Daughter of Rodrick and Mixie.

## Function

Powerful royal ally, obsessive subordinate to Tama, and eventually ruler of Rojier. Her relationship with Tama creates direct political consequences between kingdoms.

First major appearance: Volume 5, which hasn't published yet, so this profile stays hidden until that book is out.`,
        appearances: [{ series_id: HMT, cast_group: 'Royal / Political', is_home: true }],
    },
    {
        id: 'char-rodrick', slug: 'rodrick', name: 'King Rodrick', title: 'King of Rojier',
        char_type: 'Character', species: 'Human', emoji: '👑', visible: false,
        content: `# King Rodrick

## Role

Long-lived king of Rojier, Kita's father.

## Function

Allied monarch, comic political force, and bridge between Tama's rise and Rojier's succession.

First major appearance: Volume 5, which hasn't published yet, so this profile stays hidden until that book is out.`,
        appearances: [{ series_id: HMT, cast_group: 'Royal / Political', is_home: true }],
    },
    {
        id: 'char-mixie', slug: 'mixie', name: 'Mixie', title: 'Royal Advisor of Rojier',
        char_type: 'Character', species: 'Human', emoji: '📜', visible: false,
        content: `# Mixie

## Role

Royal Advisor and royal figure of Rojier, Kita's mother.

## Function

Political counterpart to Saki and recurring member of Rojier's royal family.

First major appearance: Volume 5, which hasn't published yet, so this profile stays hidden until that book is out.`,
        appearances: [{ series_id: HMT, cast_group: 'Royal / Political', is_home: true }],
    },
    {
        id: 'char-alissa', slug: 'alissa', name: 'Regent Alissa', title: 'Regent of Trissaile',
        char_type: 'Character', species: 'Human', emoji: '🏛️', visible: false,
        content: `# Regent Alissa

## Role

Regent of Trissaile, Tama's aunt.

## Function

Holds the kingdom before Tama's coronation and represents the older family and government structure Tama inherits.

First major appearance: Volume 5, which hasn't published yet, so this profile stays hidden until that book is out.`,
        appearances: [{ series_id: HMT, cast_group: 'Royal / Political', is_home: true }],
    },
    {
        id: 'char-tully', slug: 'tully', name: 'General Tully', title: 'Trissaile Military Officer',
        char_type: 'Character', species: 'Human', emoji: '🎖️', visible: false,
        content: `# General Tully

## Role

Senior Trissaile military officer.

## Function

Loyal commander, palace authority, and one of the grounded military voices around Tama and Saki.

First major appearance: Volume 5, which hasn't published yet, so this profile stays hidden until that book is out.`,
        appearances: [{ series_id: HMT, cast_group: 'Royal / Political', is_home: true }],
    },
    {
        id: 'char-drake', slug: 'drake', name: 'Drake', title: 'Arena Fighter',
        char_type: 'Character', species: 'Human', emoji: '🏃', visible: false,
        content: `# Drake

## Role

Extremely fast combatant and arena fighter.

## Function

Rival, transport solution, and later recurring wartime ally.

First major appearance: Volume 5, which hasn't published yet, so this profile stays hidden until that book is out.`,
        appearances: [{ series_id: HMT, cast_group: 'Powerful Allies / Wildcards', is_home: true }],
    },
    {
        id: 'char-fuyu', slug: 'fuyu', name: 'Fuyu / Hero Tama', title: "Tama's Heroic Split",
        char_type: 'Character', species: 'Nekojin', emoji: '⚡', visible: false,
        content: `# Fuyu / Hero Tama

## Role

A heroic split or alternate manifestation of Tama, effectively a second Tama with maximized heroic qualities.

## Function

Major power player and a destabilizing, comedic force whose existence complicates identity, leadership, and war planning.

First major appearance: Volume 6, *Fuyu The Hero*, which hasn't published yet, so this profile stays hidden until that book is out.`,
        appearances: [{ series_id: HMT, cast_group: 'Powerful Allies / Wildcards', is_home: true }],
    },
    {
        id: 'char-aurelia', slug: 'aurelia', name: 'Aurelia', title: 'Imperial Princess',
        char_type: 'Character', species: 'Human', emoji: '⚜️', visible: false,
        content: `# Aurelia

## Role

Imperial princess and officer captured during the outside invasion, later temporary Royal Advisor.

## Function

Enemy-turned-ally and inside source on the Empire. Her divided loyalty becomes central during the war.

First major appearance: Volume 7, *War on the Horizon*, which hasn't published yet, so this profile stays hidden until that book is out.`,
        appearances: [{ series_id: HMT, cast_group: 'Royal / Political', is_home: true }],
    },
    {
        id: 'char-brogar', slug: 'brogar', name: 'Brogar', title: 'Imperial Commander',
        char_type: 'Character', species: 'Human', emoji: '🗡️', visible: false,
        content: `# Brogar

## Role

Imperial commander and prince, Aurelia's brother.

## Function

Major military antagonist during the Empire conflict.

First major appearance: Volume 7, which hasn't published yet, so this profile stays hidden until that book is out.`,
        appearances: [{ series_id: HMT, cast_group: 'Antagonists / Opposition', is_home: true }],
    },
    {
        id: 'char-tina', slug: 'tina', name: 'Tina', title: "Xan's Partner",
        char_type: 'Character', species: 'Nekojin', emoji: '🐾', visible: false,
        content: `# Tina

## Role

Nekojin priestess, Xan's partner and wife.

## Function

Religious and personal counterweight to Xan, often restraining or contextualizing his engineering impulses.

First major appearance: Volume 5 of Her Majesty, Tamaneko, which hasn't published yet. Her book-level story with Xan (The Bedrock) is also not yet purchasable, so this profile stays hidden until one of those is actually out.`,
        appearances: [{ series_id: HMT, cast_group: 'Powerful Allies / Wildcards', is_home: true }],
    },
];

(async () => {
    await db.Open();

    await ensureSeries(GHH, 'The Godling and Her Husband',
        'Arissa and Mark inside a superhero-heavy world where Arissa is secretly the Godling everyone is hunting, and Mark is bound to her at the soul level.');
    await ensureSeries(BEDROCK, 'The Bedrock',
        "Xanari Telis wakes up in Xanrea after proving humanity wrong on Earth, and starts experimenting with magic the same way he once approached engineering.");

    await linkBookToSeries('the-godling-and-her-husband', GHH, 1);
    await linkBookToSeries('the-bedrock', BEDROCK, 1);

    // Existing characters: set their home series
    await setAppearances('tama', [{ series_id: HMT, cast_group: 'Main Cast', is_home: true }]);
    await setAppearances('saki', [{ series_id: HMT, cast_group: 'Main Cast', is_home: true }]);
    await setAppearances('anna', [{ series_id: HMT, cast_group: 'Inner Circle', is_home: true }]);
    await setAppearances('xanari', [
        { series_id: BEDROCK, cast_group: 'Main Cast', is_home: true },
        { series_id: GHH, cast_group: 'Golems / Cosmic Agents', is_home: false },
    ]);

    for (const c of [...ghhCharacters, ...hmtCharacters]) {
        await upsertCharacter(c);
    }

    console.log('done');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
