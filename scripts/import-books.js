// One-off backfill: import the 7 released Her Majesty, Tamaneko / Xanrean
// Chronicles books (plus 3 in-progress titles as "Coming Soon") from the
// author's local manuscript folder + verified Gumroad/KDP storefront links.
// Safe to re-run: InsertSeries/InsertBook are upserts keyed on id.
const db = require('../database.js');

const SERIES_ID = 'her-majesty-tamaneko';

const series = {
    id: SERIES_ID,
    universe: 'Her Majesty, Tamaneko',
    universeDesc: "Tama and Saki's arc through Xanrea — a Nekojin princess who never wanted a crown, and the Kitsune who complicates everything.",
    sort_order: 0
};

const books = [
    {
        id: 'third-person-tempest',
        title: 'Third Person Tempest',
        slug: 'third-person-tempest',
        seriesId: SERIES_ID,
        volume: 'Volume 1',
        volumeNumber: 1,
        status: 'published',
        cover: '/covers/book-third-person-tempest.webp',
        blurb: "A powerful but simple Nekojin and a cynical but caring Kitsune stumble through goblin armies, undead liches, and ancient dragons.",
        description: "Tama is a ninja. She speaks in the third person, hates wearing clothes, and thinks her pet boar Jiggle is the best thing since burnt fish. She is also, apparently, the lost princess of a kingdom she's never heard of and the living avatar of the Goddess of Creation. Saki is a Kitsune who has spent her life manipulating everyone around her, hiding her true nature, and ignoring the voice in her head that whispers erase. She thought she was beyond caring about anyone. Then she met Tama. Together, a powerful but simple Nekojin and a cynical but caring Kitsune stumble through goblin armies, undead liches, and ancient dragons — and the worst enemy of all: responsibility.",
        ctaPlatform: 'gumroad',
        platforms: [
            { type: 'gumroad', name: 'Gumroad', url: 'https://purplexanmal.gumroad.com/l/third-person-tempest' },
            { type: 'kdp', name: 'Kindle', url: 'https://www.amazon.com/Third-Person-Tempest-Xanrean-Chronicles-ebook/dp/B0F4RG6P86' }
        ]
    },
    {
        id: 'vulpine-mastermind',
        title: 'Vulpine Mastermind',
        slug: 'vulpine-mastermind',
        seriesId: SERIES_ID,
        volume: 'Volume 2',
        volumeNumber: 2,
        status: 'published',
        cover: '/covers/book-vulpine-mastermind.webp',
        blurb: "A Kitsune with a plan for revenge and none for what comes after. Captured, cornered, and about to find out what she's actually willing to fight for.",
        description: "Captured by goblins and forced to confront her failures, Saki discovers that Tama has been friends with their tribe since childhood. There's no time for shock — the Lich Jabrome has murdered Tama's Sensei and now marches on Drestor with an undead army. As goblins clash with the dead and the city faces annihilation, Saki must choose between revenge and redemption, and decide whether some monsters deserve saving.",
        ctaPlatform: 'gumroad',
        platforms: [
            { type: 'gumroad', name: 'Gumroad', url: 'https://purplexanmal.gumroad.com/l/vulpine-mastermind' },
            { type: 'kdp', name: 'Kindle', url: 'https://www.amazon.com/Vulpine-Mastermind-Xanrean-Chronicles-Book-ebook/dp/B0FG3D9M47' }
        ]
    },
    {
        id: 'water-spirits-sin',
        title: "Water Spirit's Sin",
        slug: 'water-spirits-sin',
        seriesId: SERIES_ID,
        volume: 'Volume 3',
        volumeNumber: 3,
        status: 'published',
        cover: '/covers/book-water-spirits-sin.webp',
        blurb: "A divine water spirit, ancient and powerful, who has decided Saki is her new best friend. She has no morals whatsoever, and she is delighted about it.",
        description: "Separated from Saki and stranded in the ruined underwater city of Muosil, Tama faces an impossible choice. Miles away, Saki wakes alone in an ancient temple — and she isn't alone for long. Anna, a water spirit as old as the ruins themselves, has claimed her as a host and wants to be the very best of friends. Goblin politics, ancient ruins, and the truth of Tama's royal blood are about to collide.",
        ctaPlatform: 'gumroad',
        platforms: [
            { type: 'gumroad', name: 'Gumroad', url: 'https://purplexanmal.gumroad.com/l/water-spirits-sin' },
            { type: 'kdp', name: 'Kindle', url: 'https://www.amazon.com/Water-Spirits-Xanrean-Chronicles-Book-ebook/dp/B0G634SWGC' }
        ]
    },
    {
        id: 'the-guardian',
        title: 'The Guardian',
        slug: 'the-guardian',
        seriesId: SERIES_ID,
        volume: 'Volume 4',
        volumeNumber: 4,
        status: 'published',
        cover: '/covers/book-the-guardian.webp',
        blurb: "A princess who never asked for a crown, an advisor out of her depth, and a dragon who isn't asking permission.",
        description: "When the carefree Nekojin princess and her cunning Foxkin advisor Saki return to Drestor after their ordeal in the ancient ruins of Muosil, they expect a moment of peace. Instead, they walk into a political storm. Regent Alissa has arrived with royal guards demanding the reluctant princess claim her throne for the sake of the kingdom. As Tama struggles to accept a crown she never wanted, Saki learns that for all her charm, she is utterly helpless when it comes to love. And when the ancient dragon Mantheria makes her move, Tama must confront a foe even she can't outrun.",
        ctaPlatform: 'gumroad',
        platforms: [
            { type: 'gumroad', name: 'Gumroad', url: 'https://purplexanmal.gumroad.com/l/the-guardian' },
            { type: 'kdp', name: 'Kindle', url: 'https://www.amazon.com/Guardian-Xanrean-Chronicles-Book-ebook/dp/B0H9BH2DSM' }
        ]
    },
    {
        id: 'her-majesty-tamaneko',
        title: 'Her Majesty, Tamaneko',
        slug: 'her-majesty-tamaneko',
        volume: 'Complete Series',
        status: 'published',
        cover: '/covers/book-her-majesty-tamaneko.webp',
        blurb: "Tama is a ninja. Saki is a Kitsune. Together they stumble through goblin armies, undead liches, ancient dragons, and the worst enemy of all: responsibility.",
        description: "Tama is a ninja. She speaks in the third person, hates wearing clothes, and thinks her pet boar Jiggle is the best thing since burnt fish. She is also, apparently, the lost princess of a kingdom she's never heard of and the living avatar of the Goddess of Creation. She'd rather fight goblins. Saki is a Kitsune. She's spent her entire life manipulating everyone around her, hiding her true nature, and ignoring the voice in her head that whispers erase. She thought she was beyond caring about anyone. Then she met Tama. Together, a powerful but simple Nekojin and a cynical but caring Kitsune stumble through goblin armies, undead liches, ancient dragons, and the worst enemy of all: Responsibility. Along the way, they'll collect a divine water spirit who wants to be a pet, an elf child who wants to be a weapon, and a princess who wants to be a slave.",
        ctaPlatform: 'gumroad',
        platforms: [
            { type: 'gumroad', name: 'Gumroad', url: 'https://purplexanmal.gumroad.com/l/her-majesty-tamaneko' },
            { type: 'kdp', name: 'Kindle', url: 'https://www.amazon.com/Her-Majesty-Tamaneko-Xanrean-Chronicles-ebook/dp/B0GX2TMKHG' }
        ]
    },
    {
        id: 'lucas-the-grand-strategist',
        title: 'Lucas the Grand Strategist',
        slug: 'lucas-the-grand-strategist',
        status: 'published',
        cover: '/covers/book-lucas-the-grand-strategist.webp',
        blurb: "He defeated a dragon, cleared eighty goblins, and dismantled a bandit operation. None of that is true. He tripped, panicked, and got lucky. Repeatedly.",
        description: "Lucas the Grand Strategist is the most feared adventurer in the kingdom. He defeated an ancient dragon on his first day, cleared eighty goblins in a single afternoon, and dismantled an entire bandit operation without breaking a sweat. None of that is true. The dragon died because he fell down. The goblins died because he ran in circles. The bandits died because he threw something out of spite and didn't know what it was. Unfortunately nobody believes him. Not the elf ranger who has decided she is on a grand romantic adventure with a tactical genius. Not the Nekojin who keeps showing up in his room at night, who he is absolutely certain is an assassin. Not the adventurers guild who keeps giving him quests he doesn't understand. And certainly not the Demon Queen, who will one day face him in single combat and lose in a way she will never be able to adequately explain. Lucas just wants to survive long enough to figure out why everyone in this world is trying to either kill him or marry him. He is not lucky enough for either.",
        ctaPlatform: 'gumroad',
        platforms: [
            { type: 'gumroad', name: 'Gumroad', url: 'https://purplexanmal.gumroad.com/l/lucas-the-grand-strategist' },
            { type: 'kdp', name: 'Kindle', url: 'https://www.amazon.com/Lucas-Grand-Strategist-Purple-Xanmal-ebook/dp/B0GX2WYVZQ' }
        ]
    },
    {
        id: 'the-hero-is-perfect',
        title: 'The Hero is Perfect',
        slug: 'the-hero-is-perfect',
        status: 'published',
        cover: '/covers/book-the-hero-is-perfect.webp',
        tags: ['Mature'],
        blurb: "The Toybox runs on broken quests, worse incentives, and mechanics that should not exist. Then one day, one of the NPCs wakes up.",
        description: "This is the lullaby sung to the residents of the Toybox from the moment they are born: The Hero is perfect, The Hero is grand. He is less a person and more a force of nature. There is just one tiny problem — \"The Hero\" has died countless times in the Toybox. He hates it, he hates them, and he wants to escape more than anything. Except there is no escape. The Toybox runs on broken quests, worse incentives, and mechanics that should not exist. Then one day, during a random iteration like any other, one of the NPCs wakes up. She was written to serve, to adore, to worship — a perfect NPC in a perfect role, never meant to awaken to the horrors of the Toybox. But she did. Now she's caught between what she was programmed to feel and what she actually feels. In a world built on broken mechanics, she might be the most broken of all.\n\nContent Warning: This story contains explicit sexual content, dubious consent that evolves into agency, psychological horror, existential themes, and meta commentary on game mechanics and player ethics.",
        ctaPlatform: 'gumroad',
        platforms: [
            { type: 'gumroad', name: 'Gumroad', url: 'https://purplexanmal.gumroad.com/l/the-hero-is-perfect' },
            { type: 'kdp', name: 'Kindle', url: 'https://www.amazon.com/Hero-Perfect-Purple-Xanmal-ebook/dp/B0GBV1TGJ5' }
        ]
    },
    // In-progress — no cover/platforms yet, shown as "Coming Soon"
    {
        id: 'the-bedrock',
        title: 'The Bedrock',
        slug: 'the-bedrock',
        status: 'draft',
        volume: 'Coming Soon',
        blurb: "Xanari Telis died proving humanity wrong. He woke up in Xanrea and started experimenting with magic the same way he once approached engineering.",
        description: "Xanari Telis died proving humanity wrong. After creating the world's first truly sentient artificial life, the brilliant young inventor awakens in Xanrea, a world of magic, monsters, and ancient gods. Armed with an obsessive mind, revolutionary rune concepts, and absolutely catastrophic social skills, Xan begins experimenting with magic the same way he once approached engineering. What starts as a simple attempt to create companionship quickly spirals into something far larger as Xan unintentionally overturns magical theory, terrifies priestesses, destabilizes economies, and lays the foundation for creations the world was never meant to possess. Accompanied by Tina, a Nekojin priestess rapidly losing control of her life, Xan journeys across Xanrea in search of knowledge, materials, and answers. But while kingdoms chase power and heroes fight monsters… Xan is quietly building something that may outlast them all.",
        platforms: []
    },
    {
        id: 'the-tyrants-rose',
        title: "The Tyrant's Rose",
        slug: 'the-tyrants-rose',
        status: 'draft',
        volume: 'Coming Soon',
        blurb: "Timothy \"Acros\" Dram conquered the world for one woman, Rose. He never found her. Now he gets a chance to go back and try again.",
        description: "Timothy \"Acros\" Dram conquered the world for one woman, Rose. He never found her. He enslaved gods, broke kingdoms, and killed millions. As he stood on a rooftop watching a statue built in her image, a mysterious figure appeared and offered him a chance to go back and try again. Acros took it without a second thought. Except the moment he arrived, he learned that the Rose he knew was fake — the Goddess of Chaos, Trixiarie, had been wearing her face. Trixiarie claimed Rose was never real. Everything he did, everything he destroyed, was for nothing. Acros refuses to believe that. There must be more going on. Now a seer is telling him to save the world if he wants his answers. Was Rose real? The answer might break him. But Acros is going to find out, even if it kills him. Just one tiny problem: Acros is now a level-four nobody with an evil spirit attached to him. Eh, minor setback.",
        platforms: []
    },
    {
        id: 'the-godling-and-her-husband',
        title: 'The Godling and Her Husband',
        slug: 'the-godling-and-her-husband',
        status: 'draft',
        volume: 'Coming Soon',
        blurb: "When she turned six, she started being able to see blue things inside people. She could reach out and change them. She used it to build her perfect husband.",
        description: "My parents considered me an accident, but useful as a tax write-off. When I turned six, I started being able to see blue things inside people. I could reach out and take them or change them to be better. When I took mommy's blue thing she fell down and stopped moving. I put it back and she got up. I realized when I did things to the blue thing, mommy started doing what I wanted. Then I met Mark. I knew in an instant it was him, my perfect husband. There were a few small flaws — but mommy helped me fix them. We were going to find him a new body, an even better one, and we would be married and I would be the perfect wife! At least, that was the plan. It's been fifteen years and Mark still hasn't chosen a body. He uses mine.",
        platforms: []
    }
];

(async () => {
    await db.Open();
    await db.InsertSeries(series);
    for (const b of books) {
        await db.InsertBook(b);
        console.log('inserted', b.id);
    }
    console.log('Done.');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
