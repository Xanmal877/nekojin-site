// Populates the game table from the design-doc pack at
// ~/Documents/xanrea_game_gdds/, four Xanrea game projects, none
// released or with public store links yet. Status/scope text is pulled
// straight from each project's GDD.md and README.md, not invented.
// Echo World is inserted last (SelectGames orders by created_at DESC,
// so the most recently inserted row is the "featured" one) since its
// GDD is the only one marked as an actively active project; the other
// three are legacy/paused concepts under consideration for revival.
const db = require('../database.js');

const games = [
    {
        id: 'autumns-dungeoneering',
        title: "Autumn's Dungeoneering",
        tagline: 'Watch a Xanrean adventurer go dungeoneering. Help when it matters.',
        status: 'In Development',
        engine: 'Godot',
        players: 'Single-player',
        icon: '⚔️',
        description: `A tight, mostly-idle dungeon RPG. Pick Autumn or another Xanrean adventurer, send them into a dungeon, and watch them fight and explore on their own. You don't control them directly, they navigate, pick targets, and use abilities themselves. Your job is prep work: gear them up, watch the run play out, and step in with limited help when it actually matters.

Loot and progression carry over between runs, and different adventurers behave differently, so runs stay varied even without direct control.

This one's built deliberately small. It's not trying to simulate all of Xanrea, just give you a character worth watching.`,
        features: [
            { icon: '🎲', title: 'Autonomous runs', desc: 'The adventurer navigates, fights, and makes their own calls. You watch, you don\'t puppet them.' },
            { icon: '🛠️', title: 'Prep, not control', desc: 'Gear up before the run and step in with limited help mid-run when it counts.' },
            { icon: '🎒', title: 'Loot & progression', desc: 'What you bring back between runs carries forward.' },
            { icon: '🐾', title: 'More than one adventurer', desc: 'Different Xanreans, different behavior, different runs.' },
        ],
    },
    {
        id: 'purple-horizons-shadow-of-a-kingdom',
        title: 'Purple Horizons: Shadow of a Kingdom',
        tagline: 'Build a kingdom in a dangerous generated world, then convince autonomous heroes to save it.',
        status: 'Concept',
        engine: 'Godot',
        players: 'Single-player',
        icon: '🏰',
        description: `A Xanrea strategy game built on Majesty-style indirect control. You don't command adventurers like RTS units, you build the kingdom, put up bounties and services, and hope your heroes decide your problem is worth solving badly enough to go do it themselves.

Instead of a string of small mission maps, a campaign starts in a generated world full of threats your kingdom has to actually survive.

Special Xanrean units show up too, Tama and Saki among them. The scope is bigger than a straight Majesty clone, but the design rule stays simple: Majesty first. The generated world is meant to expand that formula, not replace it.`,
        features: [
            { icon: '👑', title: 'Indirect control', desc: 'No direct commands. Build, incentivize, and hope the heroes bite.' },
            { icon: '🗺️', title: 'Generated campaigns', desc: 'Each run drops your kingdom into a new world full of things trying to end it.' },
            { icon: '⚔️', title: 'Autonomous heroes', desc: 'Adventurers act on their own judgment, including Xanrea specials like Tama and Saki.' },
            { icon: '📈', title: 'Class advancement', desc: 'Heroes grow the more they take your work.' },
        ],
    },
    {
        id: 'purple-shadows',
        title: 'Purple Shadows',
        tagline: 'Tama has an apprentice. Someone has been marked.',
        status: 'Concept',
        engine: 'Godot',
        players: 'Single-player',
        icon: '🥷',
        description: `A single-player, mission-based assassination game. You play as Tama's apprentice, working through assassination missions with stealth, combat, movement, and a bit of Xanrea's supernatural side.

The target feel is Dishonored: responsive movement, more than one way into a job, dangerous powers, and handcrafted spaces that let you decide how you actually reach the target.

The first real milestone isn't a full campaign, it's one complete mission that proves out the movement, the powers, the stealth, the target, and the escape, all the way through.`,
        features: [
            { icon: '🗡️', title: "Tama's apprentice", desc: "You're not Tama. You're who she trained." },
            { icon: '🎯', title: 'Mission-based assassinations', desc: 'Handcrafted targets, not an open world.' },
            { icon: '👻', title: 'Xanrean abilities', desc: 'Supernatural tools layered on top of stealth and combat.' },
            { icon: '🚪', title: 'Multiple approaches', desc: 'Where scope allows, more than one way to reach the target.' },
        ],
    },
    {
        id: 'echo-world-the-adventurers-terrarium',
        title: "Echo World: The Adventurer's Terrarium",
        tagline: "Log out. Xanrea doesn't.",
        status: 'In Development',
        engine: 'Godot',
        players: 'Multiplayer',
        icon: '🌌',
        description: `This is Xanrea life. Echo World is an attempt to simulate what actually living in Xanrea would be like, starting with a bounded piece of the world called the Caldera.

The people who live there are Natives. Real players enter that same world as Travelers, and Natives aren't just standing around waiting for them, they have lives, work, relationships, adventures, and consequences of their own. A Traveler is walking into a world that was already going.

It's not just an autonomous-adventurer game, or a city builder, or an RPG with unusually complicated NPCs, though it can look like all three at once. The actual goal is building a functioning little piece of Xanrea and letting real people step into it.

The scope here is the whole reason it's called the giant project. The right milestone isn't "simulate all of Xanrea." It's make one small piece of the Caldera convincingly live. Then widen the glass.`,
        features: [
            { icon: '🧑‍🌾', title: 'Persistent Natives', desc: 'NPCs with their own goals, work, and relationships, not idle set dressing.' },
            { icon: '🧳', title: 'Real players as Travelers', desc: 'You enter a world that keeps going whether or not you\'re logged in.' },
            { icon: '🖥️', title: 'Server-authoritative shared world', desc: 'One persistent Caldera, not an instance per player.' },
            { icon: '🔥', title: 'Settlements, economy, danger', desc: 'Adventuring, travel, and social systems that actually interact with each other.' },
        ],
    },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    await db.Open();
    // created_at determines SelectGames' order (most recent first = the
    // featured card), so space inserts out past SQLite's 1s timestamp
    // resolution rather than relying on tie-break behavior.
    for (const g of games) {
        await db.InsertGame(g);
        console.log('inserted', g.id);
        await sleep(1100);
    }
    console.log('done');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
