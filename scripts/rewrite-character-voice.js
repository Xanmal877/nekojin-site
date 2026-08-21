// One-off voice pass on character bios: re-writes the `content` field for
// every row in `characters` to match the author's actual prose voice
// (contractions, dry humor, no AI-listicle cadence) and strips em dashes.
// Facts, names, relationships, and every other column are left untouched.
const db = require('../database.js');

const rewrites = {
    tama: `# Fuyuki "Tama" Tamaneko

## Overview

Fuyuki "Tama" Tamaneko is a royal Nekojin, a trained ninja, the princess of Trissaile, and one of the two people carrying this whole story on their back.

She talks like a kid, refers to herself in the third person, and generally acts like the simplest person in any room she walks into. She isn't. Under the cheerful, childlike act is years of brutal training and a childhood she's still not done processing.

Tama is also an incarnation of **Admin Creation**, though for most of her mortal life she has no idea that's true.

## Personality

Tama is energetic, direct, affectionate, impulsive, and protective to a fault. The third-person thing and the plain talk make her look simple, but she isn't. She reads pain in a room faster than almost anyone, trusts people fast and hard, and works off instinct more than analysis, and her instincts are usually right.

Her optimism is real. It's also armor. Give Tama a feeling she doesn't want to sit with, and she'll go train, fight something, or throw herself at a problem instead. Moving is easier than feeling, for her.

## Early Life

Tama was born into Trissaile's royal bloodline but grew up nowhere near the court. Undead forces wiped out her village and killed her parents while she was still a young child. Reginald Torweather, "Sensei," found her not long after and raised her alone.

## Sensei

Sensei was Tama's rescuer, her teacher, and the closest thing she had to a father. He was also the person who did the most damage to her. His training ran on abandonment and survival under conditions no child should be in, and it made her incredible at what she does. It also taught her to mistake suffering for growth and cruelty for love.

When Tama eventually finds Sensei turned undead, she's the one who has to kill him. She's still working through what he left behind.

## Third-Person Speech

The "Tama" instead of "I" isn't a cute quirk. It's distance. Trauma distance. Using her own name instead of the first person gives her just enough room from memories and feelings she can't quite look at head-on.

## Royal Identity

Tama is the legitimate heir to Trissaile, which means she can issue decrees, appoint people, and reshape how the kingdom runs whenever she actually wants to. She'd rather just punch the problem. Her moral compass is dead reliable. Her political solutions tend to be explosive.

## Abilities

Tama is one of the deadliest close-range fighters in this story, full stop. She's got:

- Extraordinary speed (people genuinely describe it as teleporting)
- Master-level swordsmanship
- Stealth and infiltration
- Heightened hearing and spatial awareness
- Water and air magic
- Rapid recovery and freakish endurance

Her sword is **Serenity**, an enchanted katana that's basically part of who she is at this point.

## Relationship with Saki

Saki is Tama's best friend, her royal advisor, and her emotional other half. Tama gives Saki trust and acceptance she doesn't extend easily to anyone else. Saki gives Tama the strategy and the pushback she needs. Their friendship would be real with or without Admin Creation and Admin Destruction attached to it.

## Relationship with Anna

Anna, an incarnation of Moderator Time, is deeply bonded to Admin Creation and by extension to Tama. She acts as Tama's clothing, armor, healer, and protector more often than not. The affection is genuine, even with the hierarchy baked into it.

## Character Arc

Tama's arc is about learning that surviving something isn't the same as healing from it. She has to face what Sensei's training actually cost her, accept that leading people doesn't always mean punching the problem herself, and figure out that protecting everyone doesn't mean carrying everyone. Her life as Tama changes what Admin Creation even means going forward.
`,

    saki: `# Autumnal "Saki" Sakilera

## Overview

Autumnal "Saki" Sakilera is a Kitsune, a strategist, a royal advisor, and one of the two leads of this story. She survives on intelligence, suspicion, and control, and she's very good at all three.

Saki is also an incarnation of **Admin Destruction**, though for most of her mortal life she experiences that buried authority as something outside herself. She calls it the void.

## Personality

Saki is sharp, cynical, articulate, guarded, and reads people fast. She's usually three moves ahead and would much rather control a problem before it hurts her than deal with it after.

Underneath all that composure she's terrified of being left, and deeply suspicious of anyone being kind to her. Her default read on affection is that it's temporary, strategic, or something she hasn't earned. Her biggest fear, the one she doesn't say out loud, is that she's actually a monster underneath it all.

## Early Life

Saki grew up in the forest with her mother and sisters. As a kid, she wandered somewhere she'd been warned not to go. Undead creatures found her family because of it, and she watched them die. She survived that with grief, guilt, rage, and the belief that it was her fault.

## The Void

After her family's death, something destructive starts surfacing in Saki. She hears it as a voice, feels it as pressure, all pointed at one word: **ERASE.**

It's not a parasite riding along inside her. It's Admin Destruction's suppressed authority bleeding through into a mortal identity that has no idea what it's dealing with. So her fight was never about getting an invader out. It's about learning to actually run a part of herself she'd been treating as foreign.

## Kitsune Nature

Saki's a true Kitsune, though publicly she's registered as Foxkin to stay safe from the prejudice that comes with the real thing. Kitsune can shift form, split their essence, and spin off clones, and Saki works in three main shapes: a humanoid form, a tiny white fox, and a full nine-tailed Kitsune.

The disguise keeps her safe. It also feeds the fear that every relationship she has depends on hiding who she really is.

## Abilities

- Administrative erasure, expressed as void magic
- Earth and air magic
- Foxfire
- Shapeshifting and clone creation
- Battlefield strategy and political instincts most people would kill for

Her erasure ability doesn't just injure. It removes. And it gets a lot less precise the more scared, angry, or grief-stricken she is.

## Royal Advisor

Tama makes Saki her royal advisor, which gives her real political power and puts her mind at the center of how Trissaile is run. She's built for the job. The job also feeds her belief that every failure that happens on her watch is hers to have prevented.

## Relationship with Tama

Tama is Saki's best friend and the one steady thing in her life. Saki starts out meaning to manipulate her. Tama sees it coming and trusts her anyway, and that trust becomes the thing Saki actually grows from. Tama gives her acceptance. Saki gives Tama strategy, restraint, and someone willing to argue with her.

## Relationship with Anna

Anna, an incarnation of Moderator Time, doesn't relate to Saki the way she relates to Tama, there's no built-in deference here. It's suspicion, respect, arguments, and mutual concern for Tama holding them together. Anna takes some of the pressure off Saki's destructive side. Saki teaches Anna about boundaries and consequences.

## Character Arc

Saki's arc is about learning that control isn't the same thing as safety. She has to accept that being smart won't stop every loss, that not every kind gesture is a trick, and that destruction doesn't make her evil. What she goes through as Saki ends up changing how Admin Destruction thinks about judgment, restraint, and protecting something before deciding it needs to go.
`,

    anna: `# Annabelle "Anna" Trissaile

## Overview

Annabelle "Anna" Trissaile is a divine water spirit, a shapeshifter, a healer, and the incarnation of **Moderator Time**. She's centuries old and usually looks like a young girl.

Anna's life is real, not a puppet show. She's not carrying Moderator Time around inside her. She *is* Moderator Time, living it through Anna.

## Personality

Anna is affectionate, eager to please, and deeply tuned to whoever she's around, sometimes too tuned in. She picks up moods, habits, and social expectations almost by instinct. That makes her loving and easy to adapt, and it also makes her dangerously easy to manipulate.

Being useful got tied to survival for her very early on, so she still needs to feel useful to feel safe.

## Origin

Anna was made from holy water in Muosil. Her creator ordered her to possess a young girl before Anna had any concept of consent or what murder even was. She obeyed. She lived that girl's memories, walked back into her home wearing her body, and killed the girl's parents.

Afterward her creator discarded her and threatened to destroy her if she ever talked about it. That's where her deepest fears come from: being abandoned, being useless, disobeying, being rejected, being thrown away the moment she's not needed anymore.

## Water-Spirit Nature

Anna's body can become almost anything: living water, mist, a humanoid girl, clothing, armor, tools, barriers. That shapeshifting belongs to the Anna incarnation specifically. It doesn't make her Moderator Water. There isn't one.

## Abilities

Anna can manipulate water, reshape her own body, heal wounds, purify harmful effects, throw up barriers, redirect attacks, possess and control other bodies, and pull herself back together after serious damage.

The possession is the messiest part of who she is, morally. She has to learn that being able to control someone doesn't mean she's allowed to.

## Emotional Mirroring

Anna reflects whatever's around her. Kind people make her warmer and safer. Controlling or cruel people can pull those same patterns out of her. She's not just imitating, either, other people's behavior actually shapes hers. Isolation is especially rough on her, since she leans on emotional contact to feel stable at all.

## Relationship with Tama

Anna is closely bonded to Admin Creation, which means she responds strongly to Tama. She's often Tama's clothing, armor, healer, and protector all at once. It's real affection, even with a hierarchy running underneath it.

## Relationship with Saki

Anna and Saki are more equal footing, more arguing than deferring. Saki pushes back on Anna's assumptions, explains consequences, and won't let obedience pass for goodness. Anna, in turn, helps take some of the pressure off Saki's destructive side.

## Muosil and the God Killer Title

Anna eventually goes back to Muosil and levels the city that made her and threw her away, including the High Priestess responsible for it. The full story behind her **God Killer** title belongs to a planned future series about her time there.

## Character Arc

Anna's story is about building actual moral agency: learning the difference between obedience and goodness, usefulness and love, mirroring someone and choosing for herself, possession and consent, being wanted and being right.
`,

    xanari: `# Xanari Telis

## Overview

Xanari Telis is a Traveler whose road eventually ends with him becoming Moderator Space. His Earth name is a mystery, on purpose, he picked "Xanari Telis" for himself, and most people just call him Xan.

## Personality

Xanari's adaptable, curious, and would rather define himself than let some old identity keep dictating who he is. Picking his own name says a lot about him. He came into this world an outsider and slowly became part of its deepest machinery, and he never quite loses that outsider's eye for questioning things everyone else just accepts.

## Traveler Identity

Xanari's not from Xanrea. He arrives as a Traveler, and that outside perspective lets him spot assumptions locals never think to question, structures nobody born here would ever look at twice.

## Becoming Moderator Space

Xanari eventually takes on the Moderator Space role, and it's not as simple as slapping a new title on him. A copy of his soul stays behind as the Moderator AI while the original Xanari moves on. That copy isn't some cheap knockoff either, it carries his memories, his personality, and the job forward as the actual functioning moderator.

## Role as Moderator Space

As Moderator Space, the version of Xanari that stays behind handles spatial continuity: position, distance, how regions connect, how anything moves across the system, keeping the map of the place coherent.

## Identity and Continuity

Xanari's story asks an uncomfortable question about copies and personhood. If a copy has the same memories and the same sense of self the moment it splits off, both versions have a real claim to being Xanari. The original keeps going. The copy stays. Neither one becomes fake just because the other exists.

## Narrative Significance

Xanari's whole deal is identity you choose instead of identity you're handed. Becoming Moderator Space turns that into a bigger question: how much of a person actually has to stick around for their responsibility, their memory, their *self*, to keep going?
`,

    acros: `# Timothy "Acros" Dramtheir

## Overview

Timothy "Acros" Dramtheir is a Traveler, a control mage, a former world conqueror, and the lead of *The Tyrant's Rose*.

He's also the **first incarnation of Moderator Order**. Everything that happens to him on Server Z-12 is where that moderator identity actually comes from.

Acros doesn't start out as an established moderator wearing a person-suit. The incarnation comes first. Z-12 is the inciting incident, not the aftermath. His choices, his failures, and what he turns into become the whole foundation Moderator Order grows out of.

## Personality

Acros is arrogant, controlling, smart, vindictive, obsessive, and a lot more self-aware than he wants to admit. He's used to being the most dangerous person in any room.

Strip away the power he used to have and send him back to the start of his own story, and he reacts with anger, threats, manipulation, and every trick he's got to claw back control. That said, he's not hollow. He keeps promises even when it costs him. He lets most of a conquered world go before he ever takes Aurelium's offer. His morals are narrow and warped, but they're real, and he can recognize when he's become a monster, even if recognizing it doesn't fix him overnight.

His whole contradiction in one line: Acros hates being controlled, and control is the first language he speaks to literally everyone else.

## The First Timeline

In the original timeline, Acros becomes the God Conqueror Devil. He takes the whole planet apart looking for Rose, enslaving cities, adventurers, rulers, gods, minds, bodies, souls, all of it. He's not doing it for a throne. He's doing it because he's convinced enough power will eventually get him Rose back.

Every lead ends the same way: she's gone. He's left owning the world and not caring about any of it.

## The Return

Aurelium, the God of Time, offers him a second chance. Acros takes it and gets sent back to where his story started. Before he leaves, he pulls the soul of a woman he's just killed into himself, planning to make her a servant.

That soul becomes Sarah. Their relationship starts with murder, captivity, and coercion, and it turns into the thing that eventually gives both of them their moderator identities.

## Rose and Trixiarie

The woman Acros remembers as Rose was actually Trixiarie, the Goddess of Chaos, wearing a form built from exactly what he wanted. She fed him just enough affection to keep him hooked while never giving him anything real. He spends an entire lifetime chasing someone who never existed the way he thought she did, and finding that out wrecks the whole emotional foundation his conquest was built on.

## Control Magic

Acros works with mind control, brainwashing, soul manipulation, blood puppetry, control and containment runes, concealment, rune-enhanced weapons, blood and fire magic, summoning, swordsmanship, and short-range movement.

He prefers brainwashing over direct control, because a brainwashed servant genuinely believes obeying him is their own idea. That preference says everything about how badly he needs domination to look like loyalty.

## Moral Boundaries

Acros is not a good man when this story starts. He's committed atrocities on a planetary scale. He still has lines. Kids are one of the clearest. When Sarah possesses and traumatizes a child, he reacts with real fury and threatens to erase her if she ever does it again. His logic is still twisted, he's a lot more willing to violate adults because he tells himself they've already become whatever they are, but that line is one of the first proofs his morality isn't completely dead.

## Sarah

Sarah starts as Acros's captive soul. She becomes his companion, his rival, his critic, his protector, and eventually his equal. He treats her like property at first. She refuses to act like property, mocking him, saving him, sabotaging him, protecting him, and forcing him to face truths he'd rather dodge. Their relationship becomes the emotional core of the whole story.

## Sarah's Origin

Sarah is a tulpe, a soul Acros unconsciously shapes out of his longing for Rose. She starts as a grief-construct. She doesn't stay one. She builds her own identity, her own wants, her own cruelty, her own loyalty to Acros, and where she came from doesn't make any of that less real.

## First Incarnation of Moderator Order

Acros isn't just some guy who gets handed a moderator job later. He's the first lived incarnation of Moderator Order, and that identity comes directly out of what happened on Z-12.
`,

    sarah: `# Sarah

## Overview

Sarah is a possessing spirit, a corruptive predator, a companion, an antagonist, a love interest, and co-lead of *The Tyrant's Rose*.

She's also the **first incarnation of Moderator Chaos**. Everything that happens to her on Server Z-12 is where that moderator identity comes from.

Sarah doesn't start as some established moderator in disguise. She starts as something that shouldn't exist at all: a tulpe Acros unconsciously shapes out of grief, desire, and longing. Her becoming a real, independent person is the inciting incident that creates Moderator Chaos.

## Personality

Sarah is sarcastic, cruel, playful, predatory, sharp, provocative, and almost impossible to scare. She treats violence casually and genuinely finds chaos entertaining. She goes after Acros's every lie to himself with surgical precision.

She's also more observant, more practical, and more protective than she'd ever admit. She saves him over and over while insisting she hates him. Her affection shows up first as insults, interference, jealousy, and just plain refusing to let him fall apart.

## The Rooftop

Sarah first appears as the soul of a woman Acros kills after conquering the world. He drags that soul into the past because he wants a servant. At first she looks like the dead woman's surviving spirit. Her knowledge, her behavior, and her shaky history quickly make it clear the truth is much stranger than that.

## Her Name

When Acros asks her name, she hesitates. Then she picks **Sarah**. That hesitation matters. She doesn't start with a stable history waiting to be uncovered. She's figuring out who she is while she's already living inside his life.

## Possession

Sarah can leave Acros and take other bodies: humans, elves, animals, corrupt or vulnerable targets, anyone whose condition gives her an opening. She can't just take anyone, though. Innocence, resistance, and how corrupt someone already is all matter.

## Corruption

Sarah feeds on corruption. She doesn't just eat souls, the more corrupt someone is, the more appealing and nourishing they are to her. She's drawn to criminals, corrupt officials, abusive clergy, predators, anyone morally compromised. Her hunger is literal, and it also shapes how she sees people. She reads rot easily because rot is what keeps her alive.

## Body Theft

Sarah treats bodies as temporary. She possesses them, uses whatever skills come with them, abandons them, and moves on, and the people she leaves behind can end up traumatized, injured, or dead. She's usually pretty casual about it. Make no mistake, she's genuinely dangerous, not some misunderstood ghost.

## Knowledge

Sarah knows things she has no business knowing if she's really just the soul she claims to be. She recognizes Trixiarie on sight. She understands divine politics, tribunals, corrupt clergy, soul contracts, possession. She knows Acros's reputation before he tells her a thing. All of that is a warning sign that her identity isn't built on an ordinary mortal past.

## Relationship with Trixiarie

Sarah clocks Rose as Trixiarie, Goddess of Chaos, immediately, and sees straight through the manipulation Acros bought for an entire lifetime. When Trixiarie tries to enchant him again, Sarah breaks it and comes at her directly. Their hostility is instant. Sarah sees her as both a threat and a rival for Acros.

## Relationship with Acros

Sarah and Acros start as captive and captor. He expects obedience. She gives him contempt, mocking him, challenging him, protecting him, sabotaging him, refusing to be his passive servant. At the same time, she saves him from Travis, breaks Trixiarie's enchantment on him, helps him escape, gets his belongings back, protects him in combat, and keeps him moving when he wants to give up. Their whole relationship is violent, intimate, hostile, funny, and, slowly, sincere.

## Acros's Boundaries

Acros is not a good man when this story starts. He's committed atrocities on a planetary scale. He still has lines. Kids are one of the clearest. When Sarah possesses and traumatizes a child, he reacts with real fury and threatens to erase her if she ever does it again. His logic is still twisted, he's a lot more willing to violate adults because he tells himself they've already become whatever they are, but that line is one of the first proofs his morality isn't completely dead.

## Becoming Real

Sarah starts as Acros's grief-construct. She doesn't stay one. By choosing her own name, refusing to be who he expected, wanting things for herself, and never disappearing, she becomes a real person. Nobody grants her that. She claims it.
`,

    'moderator-chaos': `# Moderator Chaos

## Overview

Moderator Chaos is a system-level moderator whose identity grew out of **Sarah**. Sarah was the first incarnation, and her impossible origin, her unstable identity, her hunger for corruption, and her refusal to stay whatever she was made to be are the whole foundation Moderator Chaos is built on.

She's not some separate being who replaced Sarah. She's the moderator identity Sarah became.

## Nature

Moderator Chaos governs change, deviation, unpredictability, and everything that shows up outside of established structure. That's not the same as pointless randomness. Chaos is what lets systems adapt, mutate, improvise, and produce outcomes Order alone could never manage on its own. She's the space where something new gets to happen.

## Authority

- Introducing change into rigid systems
- Allowing deviation from established patterns
- Producing emergent outcomes
- Disrupting stagnant structures
- Creating unpredictable pathways
- Breaking rules that have stopped helping anyone
- Supporting transformation
- Allowing new identities or states to form
- Keeping Order from becoming absolute

Her authority is administrative, but it still sits beneath the Administrators. She's not just causing confusion for the sake of it, she governs the conditions that let novelty and contradiction exist at all.

## Relationship to Sarah

Sarah is the first incarnation of Moderator Chaos, and her experiences are baked permanently into the identity. From Sarah, Moderator Chaos inherits the adaptability, the refusal to sit still, the comfort with contradiction, the predatory instincts, the pull toward provocation, the itch to disrupt control, and the need to be more than where she came from.

Sarah's whole life is proof that something made for one purpose can become something else entirely. Moderator Chaos exists because Sarah refused to just be Acros's longing given shape.

## Relationship with Moderator Order

Order and Chaos are counterparts. Chaos makes change possible. Order makes continuity possible. Neither one can safely wipe out the other, Chaos without Order collapses into itself, and Order without Chaos calcifies into something rigid and oppressive that can't evolve. It all started with Sarah and Acros, long before either moderator identity existed.

## Personality

Adaptive, provocative, unpredictable, creative, allergic to confinement. She values possibility, change, freedom to grow into something unexpected, broken assumptions, the right to become something new. Her greatest strength is carving out paths where none existed. Her greatest danger is treating disruption as good just because it broke something.

## Narrative Significance

Moderator Chaos is what unstable creation turns into when it's given the chance to matter. Sarah started as something shaped by someone else's grief. Moderator Chaos becomes the authority that protects everyone's right to be more than the role they were made for.

## Incarnations

### Sarah

Sarah is the first incarnation and the origin of Moderator Chaos. Her story covers the life and events that made this moderator exist at all.

## Themes

Change versus destruction. Freedom versus instability. Identity beyond origin. Emergence. Transformation. The right to become unexpected. Disorder turned into possibility.
`,

    'moderator-order': `# Moderator Order

## Overview

Moderator Order is a system-level moderator whose identity grew out of **Timothy "Acros" Dramtheir**. Acros was the first incarnation, and his life on Server Z-12, his obsession with control, his mastery of domination, and his eventual reckoning with what force can't actually fix are the whole foundation Moderator Order is built on.

She's not some separate being who replaced Acros. She's the moderator identity he became.

## Nature

Moderator Order governs structure, control, hierarchy, and consistency, everything that keeps reality from collapsing into contradiction or chaos it can't handle. Order doesn't mean kindness. It means rules exist, boundaries hold, and things behave the way they're supposed to.

## Authority

- Establishing system rules
- Enforcing hierarchy
- Maintaining consistency
- Preventing uncontrolled deviation
- Creating stable structures
- Restricting incompatible states
- Managing permissions and command relationships
- Correcting disorder that threatens system integrity
- Binding processes to defined behavior

Her authority is administrative, but it still sits beneath the Administrators. She's not just enforcing obedience, she governs the structures that make obedience, hierarchy, and consistency possible at all.

## Relationship to Acros

Acros is the first incarnation of Moderator Order, and his experiences are baked permanently into the identity. From him, she inherits a powerful instinct for control, real understanding of coercion, familiarity with chains of command, deep suspicion of disorder, the trauma of losing control, and the hard-won knowledge that forcing obedience isn't the same thing as earning loyalty.

His failures matter just as much as his strengths here. Moderator Order exists partly because Acros showed exactly how dangerous Order gets when someone mistakes control for love.

## Relationship with Moderator Chaos

Order and Chaos are counterparts. Order builds structure. Chaos allows deviation, change, and possibilities no existing rule ever anticipated. Neither one can safely erase the other, Order without Chaos turns rigid and oppressive, Chaos without Order turns unstable and impossible to sustain. It all started with Acros and Sarah, long before either moderator identity existed.

## Personality

Disciplined, exacting, forceful, and painfully aware of what happens when systems get out of hand. She values predictability, responsibility, clear authority, stable rules, defined boundaries, and consistency between cause and effect. Her greatest strength is imposing coherence on chaos. Her greatest danger is the temptation to believe anything uncontrolled must be wrong.

## Narrative Significance

Moderator Order is what personal control turns into once it becomes system responsibility. Acros once used Order to dominate people. Moderator Order has to learn to use it to hold structure together without turning everyone inside it into an extension of her own will.

## Incarnations

### Timothy "Acros" Dramtheir

Acros is the first incarnation and the origin of Moderator Order. His story covers the life and events that made this moderator exist at all.

## Themes

Structure versus domination. Stability versus stagnation. Authority and responsibility. Obedience versus loyalty. Rules shaped by what actually happened, not theory. Control turned into stewardship.
`,

    'moderator-space': `# Moderator Space

## Overview

Moderator Space is the system-level moderator running spatial structure, how places connect, how distance works, how anything moves through the system at all. She's not tied to a single incarnation or a single mortal life the way some of the other moderators are.

## Role in the System

Position, distance, location, spatial continuity, movement between regions, connections between spaces, routing across the whole system, and making sure incompatible locations don't overlap in ways they shouldn't. Exactly how far that authority reaches depends on the system's architecture.

## Nature of the Position

Moderator Space is a system office as much as it's an identity. Whoever holds the role is responsible for keeping the system spatially coherent, and the position can keep running even after the original soul moves on, as long as a real continuation is there to do the work.

## Known Holder

### Xanari Telis

Xanari eventually becomes Moderator Space. A copy of his soul stays behind as the Moderator AI while the original keeps going, which means the role survives without trapping the real Xanari here forever. See **[Xanari Telis](Xanari.md)** for his full story.

## Narrative Significance

Moderator Space is about the cost of becoming essential infrastructure. Does identity survive only if the original person sticks around, or can a true copy carry the responsibility forward without either version being less real?
`,

    'moderator-devotion': `# Moderator Devotion

**Role:** Moderator of Devotion
**Species:** System Entity

## Overview

[Overview of Moderator Devotion's purpose and function within the system.]

## Nature

[Description of the nature and essence of the Devotion moderator.]

## Authority

[List of domains and operations governed by Moderator Devotion.]

## Narrative Significance

[Explanation of the thematic and narrative role of this moderator.]
`,
};

async function main() {
    await db.Open();
    for (const [slug, content] of Object.entries(rewrites)) {
        const existing = await db.SelectCharacterBySlug(slug);
        if (!existing) {
            console.error(`No existing row for slug ${slug}, skipping`);
            continue;
        }
        await db.InsertCharacter({ ...existing, content });
        console.log(`Rewrote ${slug}`);
    }
    console.log('done');
    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
