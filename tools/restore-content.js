// Restore real content from local sources into the running Nekojin site.
//
// Sources:
//   - Book metadata/covers: /home/xanmal/Documents/Projects/My Books
//   - Game info: /home/xanmal/Documents/Projects/repositories/Godot (S.A.R.A.H, Shadow, Autumn's Dungeoneering)
//   - Studio/about text: /home/xanmal/Documents/Projects/My Books/Gumroad AI Prompts and web pages/profile.html
//
// Run with: node tools/restore-content.js
//
// It logs in as admin, copies cover images into public/covers/, and POSTs
// a complete /save-content payload. The payload is built to be idempotent
// (fixed slugs/IDs), so re-running replaces the same rows rather than duplicating.

const fs = require('node:fs');
const path = require('node:path');
const { createRestorePoint } = require('../backup.js');

const ROOT = path.join(__dirname, '..');
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'SmokeTestPass1234';
const PORT = process.env.PORT || 7771;
const BASE = `http://127.0.0.1:${PORT}`;

const BOOKS_ROOT = '/home/xanmal/Documents/Projects/My Books';
const GUMROAD_WEB_DIR = path.join(BOOKS_ROOT, 'Gumroad AI Prompts and web pages');
const RELEASED_DIR = path.join(BOOKS_ROOT, 'Series', 'Released');
const COVERS_DEST = path.join(ROOT, 'public', 'covers');

function slugify(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function safeCoverFilename(title, ext) {
    return slugify(title) + '-cover' + ext;
}

function copyCover(srcPath, destName) {
    const dest = path.join(COVERS_DEST, destName);
    if (!fs.existsSync(dest)) {
        fs.copyFileSync(srcPath, dest);
        console.log('Copied cover:', destName);
    } else {
        console.log('Cover already exists:', destName);
    }
    return '/covers/' + destName;
}

async function login() {
    const res = await fetch(`${BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=admin&password=${encodeURIComponent(ADMIN_PASSWORD)}&next=/admin`,
        redirect: 'manual',
    });
    if (res.status !== 302) {
        throw new Error(`Login failed: HTTP ${res.status}`);
    }
    const setCookie = res.headers.get('set-cookie') || '';
    const cookies = setCookie.split(/,(?=[^;]+=[^;]+)/);
    const sessionCookie = cookies.find(c => c.includes('nki_session')).split(';')[0];
    const csrfCookie = cookies.find(c => c.includes('nki_csrf')).split(';')[0];
    const csrfToken = csrfCookie.split('=')[1];
    return {
        headers: {
            'Content-Type': 'application/json',
            Cookie: `${sessionCookie}; ${csrfCookie}`,
            'X-CSRF-Token': csrfToken,
        },
    };
}

async function restore() {
    // ── SAFETY: BACKUP BEFORE BULK IMPORT ────────────────────────────────
    console.log('Creating pre-import restore point...');
    const backedUp = createRestorePoint('content-import');
    if (!backedUp) {
        throw new Error('Failed to create pre-import backup; aborting to avoid data loss.');
    }

    // ── XANREAN CHRONICLES SERIES + BOOKS ────────────────────────────────
    const seriesId = 'xanrean-chronicles';
    const series = {
        id: seriesId,
        universe: 'Xanrean Chronicles',
        universeDesc: 'Tama and Saki\'s arc through the Xanrea simulation: a digital consciousness preservation system where billions of uploaded souls believe they\'ve reincarnated into a fantasy world.',
        sort_order: 0,
    };

    const xanreanBooks = [
        {
            title: 'Third Person Tempest',
            volume_number: 1,
            description: 'The Xanrean Chronicles begin with a storm that isn\'t natural, seen through eyes that shouldn\'t exist.',
            tags: ['progression fantasy', 'found family', 'digital souls'],
        },
        {
            title: 'Vulpine Mastermind',
            volume_number: 2,
            description: 'Saki\'s schemes unravel faster than she can weave them, and the simulation notices.',
            tags: ['progression fantasy', 'kitsune', 'intrigue'],
        },
        {
            title: 'Water Spirit\'s Sin',
            volume_number: 3,
            description: 'A divine water spirit wants to be a pet. A princess wants to be a slave. The world wants them all to behave.',
            tags: ['progression fantasy', 'water spirit', 'found family'],
        },
        {
            title: 'The Guardian',
            volume_number: 4,
            description: 'The Guardian rises, not because the world needs a hero, but because someone finally chose to stay.',
            tags: ['progression fantasy', 'guardian', 'divine avatar'],
        },
    ];

    const xanreanVolumes = xanreanBooks.map(b => {
        const releasedDirName = b.title === 'The Guardian' ? 'Guardian, The' : b.title;
        const releasedDir = path.join(RELEASED_DIR, releasedDirName);
        const coverSrc = fs.readdirSync(releasedDir).find(f => /\.(jpg|jpeg|png)$/i.test(f));
        const coverPath = coverSrc ? copyCover(path.join(releasedDir, coverSrc), safeCoverFilename(b.title, path.extname(coverSrc))) : '';
        return {
            id: slugify(b.title),
            slug: slugify(b.title),
            title: b.title,
            description: b.description,
            blurb: b.description,
            volume_number: b.volume_number,
            volume: `Volume ${b.volume_number}`,
            status: 'released',
            cover_path: coverPath,
            cover: coverPath,
            tags: b.tags.join(', '),
            genres: 'progression fantasy',
            visible: 1,
        };
    });

    // Her Majesty, Tamaneko omnibus: released as a standalone book in the same series
    const hmtDir = path.join(RELEASED_DIR, 'Her Majesty, Tamaneko');
    const hmtCoverSrc = fs.readdirSync(hmtDir).find(f => /\.(jpg|jpeg|png)$/i.test(f));
    const hmtCoverPath = hmtCoverSrc ? copyCover(path.join(hmtDir, hmtCoverSrc), safeCoverFilename('Her Majesty, Tamaneko', path.extname(hmtCoverSrc))) : '';
    const herMajestyTamaneko = {
        id: 'her-majesty-tamaneko',
        slug: 'her-majesty-tamaneko',
        title: 'Her Majesty, Tamaneko',
        description: 'Tama is a ninja. She speaks in the third person, hates wearing clothes, and thinks her pet boar Jiggle is the best thing since burnt fish. She is also, apparently, the lost princess of a kingdom she\'s never heard of and the living avatar of the Goddess of Creation. She\'d rather fight goblins. Saki is a Kitsune who thought she was beyond caring about anyone. Then she met Tama. A progression fantasy about found family, the cost of strength, and learning that sometimes the person you needed was trying to find you too.',
        blurb: 'Tama is a ninja who speaks in the third person and would rather fight goblins than be a princess. Saki is a traumatized Kitsune who thought she was beyond caring about anyone. Together they stumble through goblin armies, undead liches, ancient dragons, and the worst enemy of all: paperwork.',
        volume: 'Full Novel',
        status: 'released',
        cover_path: hmtCoverPath,
        cover: hmtCoverPath,
        tags: 'progression fantasy,nekojin,kitsune,found family',
        genres: 'progression fantasy',
        visible: 1,
    };

    // ── STANDALONE BOOKS ─────────────────────────────────────────────────
    const standaloneTitles = ['Lucas the Grand Strategist', 'The Hero is Perfect'];
    const standaloneBookData = [
        {
            title: 'Lucas the Grand Strategist',
            description: 'Lucas the Grand Strategist is the most feared adventurer in the kingdom. He defeated an ancient dragon on his first day, cleared eighty goblins in a single afternoon, and dismantled an entire bandit operation without breaking a sweat. None of that is true. He tripped, panicked, and got lucky. Repeatedly. A comedic isekai LitRPG about a man who just wants to survive long enough to figure out why everyone is trying to either kill him or marry him.',
            blurb: 'The kingdom\'s greatest strategist is a fraud who got lucky. Now everyone wants to kill him or marry him, and he\'s not lucky enough for either.',
            tags: 'isekai,comedy,litrpg',
            genres: 'isekai comedy',
        },
        {
            title: 'The Hero is Perfect',
            description: 'The Hero is perfect. The Hero is grand. The Hero is coming. The Hero is here. There is just one tiny problem: The Hero has died countless times in the Toybox, and he hates it. He wants to escape more than anything. Then one day an NPC wakes up, caught between what she was programmed to feel and what she actually feels. Dark LitRPG comedy with explicit sexual content, psychological horror, existential themes, and meta commentary on game mechanics and player ethics.',
            blurb: 'A sentient NPC wakes up inside a broken game where The Hero has died countless times and wants to escape. Dark LitRPG comedy about programmed desire versus real choice.',
            tags: 'dark litrpg,psychological horror,meta',
            genres: 'dark litrpg comedy',
        },
    ];

    const standaloneBooks = standaloneBookData.map(b => {
        const releasedDirName = b.title === 'The Hero is Perfect' ? 'Hero is Perfect, The' : `${b.title}`;
        const releasedDir = path.join(RELEASED_DIR, releasedDirName);
        const coverSrc = fs.readdirSync(releasedDir).find(f => /\.(jpg|jpeg|png)$/i.test(f));
        const coverPath = coverSrc ? copyCover(path.join(releasedDir, coverSrc), safeCoverFilename(b.title, path.extname(coverSrc))) : '';
        return {
            id: slugify(b.title),
            slug: slugify(b.title),
            title: b.title,
            description: b.description,
            blurb: b.blurb,
            status: 'released',
            cover_path: coverPath,
            cover: coverPath,
            tags: b.tags,
            genres: b.genres,
            visible: 1,
        };
    });

    // ── GAME ──────────────────────────────────────────────────────────────
    const game = [{
        id: 'autumns-dungeoneering',
        slug: 'autumns-dungeoneering',
        title: 'Autumn\'s Dungeoneering',
        status: 'In Development',
        tagline: 'A cozy tactical dungeon-crawling RPG with emergent AI.',
        description: 'Watch or join a living fantasy world where behavior-driven NPCs quest, fight, and grow on their own. Observe the simulation, talk to them about their choices, or create your own adventurer and explore. Built in Godot 4.',
        coverImage: '/covers/game-cover-1772952121717.png',
        platforms: {
            steam: '',
            itch: '',
            gog: '',
            epic: '',
        },
        progress: 35,
        videoUrl: '',
        systemRequirements: {
            os: 'Windows 10 / Linux (Ubuntu 22.04+)',
            processor: 'Quad-core 2.5 GHz',
            memory: '8 GB RAM',
            graphics: 'Dedicated GPU with 2 GB VRAM',
            storage: '2 GB available space',
            directx: 'Godot 4 / Vulkan-compatible drivers',
        },
        features: [
            { icon: '🧠', title: 'Emergent AI', desc: 'NPCs make their own decisions based on needs, relationships, and world state.' },
            { icon: '🏰', title: 'Living World', desc: 'Dungeons, kingdoms, and factions evolve whether the player is watching or not.' },
            { icon: '⚔️', title: 'Tactical Combat', desc: 'Turn-based encounters with positioning, environment interaction, and party dynamics.' },
            { icon: '🎭', title: 'Talk to NPCs', desc: 'Converse with procedurally-driven characters about their choices and lives.' },
        ],
        screenshots: [],
        devlog: [],
    }];

    // ── ABOUT ─────────────────────────────────────────────────────────────
    const about = {
        studio_name: 'Nekojin Interactive',
        tagline: 'Crafting worlds, one upload at a time.',
        description: 'Purple Xanmal is the solo indie studio behind Nekojin Interactive, crafting interconnected fiction inside a single universe where the "publisher" is also the in-universe administrator, and the characters don\'t know they\'re being watched.',
        description2: 'Xanrea is a digital consciousness preservation system running billions of uploaded lives who believe they\'ve reincarnated into a fantasy world. The stories are told from the inside: administrators Tama and Saki have suppressed their own memories to experience mortality alongside the souls they protect.',
        description3: 'Current projects include the Xanrean Chronicles series, the standalone comedies Lucas the Grand Strategist and The Hero is Perfect, and Autumn\'s Dungeoneering, a Godot 4 tactical RPG with emergent AI.',
        email: '',
        social_links: JSON.stringify([
            { name: 'Twitter / X', url: 'https://twitter.com/TamaAndSaki' },
            { name: 'World of Xanrea', url: 'https://worldofxanrea.com/' },
        ]),
        universe_blurb: 'A digital consciousness preservation system running billions of uploaded lives who believe they\'ve reincarnated into a fantasy world.',
    };

    // ── BUILD PAYLOAD ────────────────────────────────────────────────────
    // Flat books array: series volumes carry series_id, standalones do not.
    const books = [
        ...xanreanVolumes.map(b => ({ ...b, series_id: seriesId })),
        herMajestyTamaneko,
        ...standaloneBooks,
    ];

    const payload = {
        series: [series],
        books,
        game,
        about,
    };

    // ── POST TO RUNNING SERVER ───────────────────────────────────────────
    console.log('Logging in...');
    const { headers } = await login();

    console.log('Saving content...');
    const res = await fetch(`${BASE}/save-content`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`save-content failed: HTTP ${res.status}\n${body}`);
    }

    console.log('Content restored successfully.');
    console.log(`Series: ${payload.series.length}`);
    console.log(`Books: ${payload.books.length}`);
    console.log(`Games: ${payload.game.length}`);
    console.log('About: OK');
}

restore().catch(err => {
    console.error(err);
    process.exit(1);
});
