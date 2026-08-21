// One-off backfill: the `characters` DB table was empty, so every
// /xanrean/characters/<slug> page (character.html) hung on "Loading
// character data..." forever even though full markdown bios already
// existed on disk at public/data/characters/*.md. This reads those files
// in as-is and inserts them. Safe to re-run (InsertCharacter is an upsert).
const fs = require('fs');
const path = require('path');
const db = require('../database.js');

const CHAR_DIR = path.join(__dirname, '..', 'public', 'data', 'characters');

const characters = [
    { slug: 'tama', file: 'tama.md', name: 'Fuyuki "Tama" Tamaneko', title: 'Admin Creation', char_type: 'Admin', species: 'Nekojin', emoji: '🐱', sort_order: 1 },
    { slug: 'saki', file: 'saki.md', name: 'Autumnal "Saki" Sakilera', title: 'Admin Destruction', char_type: 'Admin', species: 'Kitsune', emoji: '🦊', sort_order: 2 },
    { slug: 'anna', file: 'anna.md', name: 'Annabelle "Anna" Trissaile', title: 'Moderator Time', char_type: 'Moderator', species: 'Water Spirit', emoji: '💧', sort_order: 3 },
    { slug: 'xanari', file: 'xanari.md', name: 'Xanari Telis', title: 'Moderator Space', char_type: 'Moderator', species: 'Traveler', emoji: '🌌', sort_order: 4 },
    { slug: 'acros', file: 'acros.md', name: 'Timothy "Acros" Dramtheir', title: 'First Incarnation of Moderator Order', char_type: 'Traveler', species: 'Traveler', emoji: '⚔️', sort_order: 5 },
    { slug: 'sarah', file: 'sarah.md', name: 'Sarah', title: 'First Incarnation of Moderator Chaos', char_type: 'Spirit', species: 'Possessing Spirit', emoji: '👻', sort_order: 6 },
    { slug: 'moderator-chaos', file: 'moderator-chaos.md', name: 'Moderator Chaos', title: 'Moderator of Chaos', char_type: 'Moderator', species: 'System Entity', emoji: '🔥', sort_order: 7 },
    { slug: 'moderator-order', file: 'moderator-order.md', name: 'Moderator Order', title: 'Moderator of Order', char_type: 'Moderator', species: 'System Entity', emoji: '⚖️', sort_order: 8 },
    { slug: 'moderator-space', file: 'moderator-space.md', name: 'Moderator Space', title: 'Moderator of Space', char_type: 'Moderator', species: 'System Entity', emoji: '🌌', sort_order: 9 },
    // Content is still just bracketed placeholder text on disk, so import it
    // (so the row exists once it's written) but keep it hidden from the
    // public site until someone actually writes it.
    { slug: 'moderator-devotion', file: 'moderator-devotion.md', name: 'Moderator Devotion', title: 'Moderator of Devotion', char_type: 'Moderator', species: 'System Entity', emoji: '💜', sort_order: 10, visible: false }
];

(async () => {
    await db.Open();
    for (const c of characters) {
        const content = fs.readFileSync(path.join(CHAR_DIR, c.file), 'utf8');
        await db.InsertCharacter({
            id: c.slug,
            slug: c.slug,
            name: c.name,
            title: c.title,
            char_type: c.char_type,
            species: c.species,
            emoji: c.emoji,
            content,
            sort_order: c.sort_order,
            visible: c.visible !== false
        });
        console.log('inserted', c.slug);
    }
    console.log('Done.');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
