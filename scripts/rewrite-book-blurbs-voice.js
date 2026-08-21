// One-off voice pass on books.description/blurb: locks in the exact
// re-voiced text from the 2026-08-21 rewrite session (most books needed
// only surgical em-dash fixes since the back-cover copy already read in
// voice; a few got fuller rewrites). Text only, no other book fields
// touched, uses a raw parameterized UPDATE (not InsertBook, which would
// duplicate book_platforms rows on every re-run).
const db = require('../database.js');

const books = [
    {
        "slug": "her-majesty-tamaneko",
        "description": "Tama is a ninja. She speaks in the third person, hates wearing clothes, and thinks her pet boar Jiggle is the best thing since burnt fish. She is also, apparently, the lost princess of a kingdom she's never heard of and the living avatar of the Goddess of Creation. She'd rather fight goblins. Saki is a Kitsune. She's spent her entire life manipulating everyone around her, hiding her true nature, and ignoring the voice in her head that whispers erase. She thought she was beyond caring about anyone. Then she met Tama. Together, a powerful but simple Nekojin and a cynical but caring Kitsune stumble through goblin armies, undead liches, ancient dragons, and the worst enemy of all: Responsibility. Along the way, they'll collect a divine water spirit who wants to be a pet, an elf child who wants to be a weapon, and a princess who wants to be a slave.",
        "blurb": "Tama is a ninja. Saki is a Kitsune. Together they stumble through goblin armies, undead liches, ancient dragons, and the worst enemy of all: responsibility."
    },
    {
        "slug": "lucas-the-grand-strategist",
        "description": "Lucas the Grand Strategist is the most feared adventurer in the kingdom. He defeated an ancient dragon on his first day, cleared eighty goblins in a single afternoon, and dismantled an entire bandit operation without breaking a sweat. None of that is true. The dragon died because he fell down. The goblins died because he ran in circles. The bandits died because he threw something out of spite and didn't know what it was. Unfortunately nobody believes him. Not the elf ranger who has decided she is on a grand romantic adventure with a tactical genius. Not the Nekojin who keeps showing up in his room at night, who he is absolutely certain is an assassin. Not the adventurers guild who keeps giving him quests he doesn't understand. And certainly not the Demon Queen, who will one day face him in single combat and lose in a way she will never be able to adequately explain. Lucas just wants to survive long enough to figure out why everyone in this world is trying to either kill him or marry him. He is not lucky enough for either.",
        "blurb": "He defeated a dragon, cleared eighty goblins, and dismantled a bandit operation. None of that is true. He tripped, panicked, and got lucky. Repeatedly."
    },
    {
        "slug": "the-bedrock",
        "description": "Xanari Telis died proving humanity wrong. After creating the world's first truly sentient artificial life, the brilliant young inventor awakens in Xanrea, a world of magic, monsters, and ancient gods. Armed with an obsessive mind, revolutionary rune concepts, and absolutely catastrophic social skills, Xan begins experimenting with magic the same way he once approached engineering. What starts as a simple attempt to create companionship quickly spirals into something far larger as Xan unintentionally overturns magical theory, terrifies priestesses, destabilizes economies, and lays the foundation for creations the world was never meant to possess. Accompanied by Tina, a Nekojin priestess rapidly losing control of her life, Xan journeys across Xanrea in search of knowledge, materials, and answers. But while kingdoms chase power and heroes fight monsters… Xan is quietly building something that may outlast them all.",
        "blurb": "Xanari Telis died proving humanity wrong. He woke up in Xanrea and started experimenting with magic the same way he once approached engineering."
    },
    {
        "slug": "the-godling-and-her-husband",
        "description": "My parents considered me an accident, but useful as a tax write-off. When I turned six, I started being able to see blue things inside people. I could reach out and take them or change them to be better. When I took mommy's blue thing she fell down and stopped moving. I put it back and she got up. I realized when I did things to the blue thing, mommy started doing what I wanted. Then I met Mark. I knew in an instant it was him, my perfect husband. There were a few small flaws, but mommy helped me fix them. We were going to find him a new body, an even better one, and we would be married and I would be the perfect wife! At least, that was the plan. It's been fifteen years and Mark still hasn't chosen a body. He uses mine.",
        "blurb": "When she turned six, she started being able to see blue things inside people. She could reach out and change them. She used it to build her perfect husband."
    },
    {
        "slug": "the-guardian",
        "description": "When the carefree Nekojin princess and her cunning Foxkin advisor Saki return to Drestor after their ordeal in the ancient ruins of Muosil, they expect a moment of peace. Instead, they walk into a political storm. Regent Alissa has arrived with royal guards demanding the reluctant princess claim her throne for the sake of the kingdom. As Tama struggles to accept a crown she never wanted, Saki learns that for all her charm, she is utterly helpless when it comes to love. And when the ancient dragon Mantheria makes her move, Tama must confront a foe even she can't outrun.",
        "blurb": "A princess who never asked for a crown, an advisor out of her depth, and a dragon who isn't asking permission."
    },
    {
        "slug": "the-hero-is-perfect",
        "description": "This is the lullaby sung to the residents of the Toybox from the moment they are born: The Hero is perfect, The Hero is grand. He is less a person and more a force of nature. There is just one tiny problem: \"The Hero\" has died countless times in the Toybox. He hates it, he hates them, and he wants to escape more than anything. Except there is no escape. The Toybox runs on broken quests, worse incentives, and mechanics that should not exist. Then one day, during a random iteration like any other, one of the NPCs wakes up. She was written to serve, to adore, to worship: a perfect NPC in a perfect role, never meant to awaken to the horrors of the Toybox. But she did. Now she's caught between what she was programmed to feel and what she actually feels. In a world built on broken mechanics, she might be the most broken of all.\n\nContent Warning: This story contains explicit sexual content, dubious consent that evolves into agency, psychological horror, existential themes, and meta commentary on game mechanics and player ethics.",
        "blurb": "The Toybox runs on broken quests, worse incentives, and mechanics that should not exist. Then one day, one of the NPCs wakes up."
    },
    {
        "slug": "the-tyrants-rose",
        "description": "Timothy \"Acros\" Dram conquered the world for one woman, Rose. He never found her. He enslaved gods, broke kingdoms, and killed millions. As he stood on a rooftop watching a statue built in her image, a mysterious figure appeared and offered him a chance to go back and try again. Acros took it without a second thought. Except the moment he arrived, he learned that the Rose he knew was fake: the Goddess of Chaos, Trixiarie, had been wearing her face. Trixiarie claimed Rose was never real. Everything he did, everything he destroyed, was for nothing. Acros refuses to believe that. There must be more going on. Now a seer is telling him to save the world if he wants his answers. Was Rose real? The answer might break him. But Acros is going to find out, even if it kills him. Just one tiny problem: Acros is now a level-four nobody with an evil spirit attached to him. Eh, minor setback.",
        "blurb": "Timothy \"Acros\" Dram conquered the world for one woman, Rose. He never found her. Now he gets a chance to go back and try again."
    },
    {
        "slug": "third-person-tempest",
        "description": "Tama is a ninja. She speaks in the third person, hates wearing clothes, and thinks her pet boar Jiggle is the best thing since burnt fish. She is also, apparently, the lost princess of a kingdom she's never heard of and the living avatar of the Goddess of Creation. Saki is a Kitsune who has spent her life manipulating everyone around her, hiding her true nature, and ignoring the voice in her head that whispers erase. She thought she was beyond caring about anyone. Then she met Tama. Together, a powerful but simple Nekojin and a cynical but caring Kitsune stumble through goblin armies, undead liches, and ancient dragons, and the worst enemy of all: responsibility.",
        "blurb": "A powerful but simple Nekojin and a cynical but caring Kitsune stumble through goblin armies, undead liches, and ancient dragons."
    },
    {
        "slug": "vulpine-mastermind",
        "description": "Captured by goblins and forced to confront her failures, Saki discovers that Tama has been friends with their tribe since childhood. There's no time for shock. The Lich Jabrome has murdered Tama's Sensei and now marches on Drestor with an undead army. As goblins clash with the dead and the city faces annihilation, Saki must choose between revenge and redemption, and decide whether some monsters deserve saving.",
        "blurb": "A Kitsune with a plan for revenge and none for what comes after. Captured, cornered, and about to find out what she's actually willing to fight for."
    },
    {
        "slug": "water-spirits-sin",
        "description": "Separated from Saki and stranded in the ruined underwater city of Muosil, Tama faces an impossible choice. Miles away, Saki wakes alone in an ancient temple, and she isn't alone for long. Anna, a water spirit as old as the ruins themselves, has claimed her as a host and wants to be the very best of friends. Goblin politics, ancient ruins, and the truth of Tama's royal blood are about to collide.",
        "blurb": "A divine water spirit, ancient and powerful, who has decided Saki is her new best friend. She has no morals whatsoever, and she is delighted about it."
    }
];

(async () => {
    await db.Open();
    for (const b of books) {
        await db._run(
            'UPDATE books SET description = ?, blurb = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?',
            [b.description, b.blurb, b.slug]
        );
        console.log('updated', b.slug);
    }
    console.log('done');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
