const fs = require('fs');
const path = require('path');
const contentDB = require('../database.js');

async function migrate() {
    console.log('🚀 Starting Lore & Character Migration...');
    await contentDB.Open();

    // 1. Seed Characters
    console.log('📦 Seeding characters...');
    
    // Current live mapping for metadata
    const CHARACTERS_CONFIG = {
        'admin-creation': { emoji: '👑', type: 'Admin' },
        'admin-destruction': { emoji: '🔥', type: 'Admin' },
        'tama': { emoji: '🐱', type: 'Incarnation' },
        'saki': { emoji: '🔥', type: 'Incarnation' },
        'sarah': { emoji: '⚔️', type: 'Character' },
        'moderator-time': { emoji: '⏰', type: 'Moderator' },
        'moderator-space': { emoji: '🌌', type: 'Moderator' },
        'moderator-chaos': { emoji: '⚡', type: 'Moderator' },
        'moderator-order': { emoji: '⚖️', type: 'Moderator' },
        'moderator-devotion': { emoji: '💜', type: 'Moderator' },
        'anna': { emoji: '💧', type: 'Incarnation' },
        'xanari': { emoji: '⚡', type: 'Incarnation' },
        'acros': { emoji: '🌹', type: 'Incarnation' },
    };

    const charFiles = fs.readdirSync(path.join(__dirname, '../public/data/characters')).filter(f => f.endsWith('.md'));
    
    for (const file of charFiles) {
        const slug = file.replace('.md', '');
        const livePath = path.join(__dirname, '../public/data/characters', file);
        
        // Rich source paths
        const richSources = [
            `/home/xanmal/Documents/Projects/My Books/My Characters/Character Profiles and Lore/Profiles/old/${slug.charAt(0).toUpperCase() + slug.slice(1)}.md`,
            `/home/xanmal/Documents/Projects/My Books/My Characters/Character Profiles and Lore/Profiles/old/Tyrants Rose/${slug.charAt(0).toUpperCase() + slug.slice(1)}.md`,
            `/home/xanmal/Documents/Projects/My Books/My Characters/Character Profiles and Lore/Profiles/old/Bedrock/${slug.charAt(0).toUpperCase() + slug.slice(1)}.md`,
        ];

        let content = fs.readFileSync(livePath, 'utf8');
        let sourceUsed = 'live';

        // Try rich sources
        for (const src of richSources) {
            if (fs.existsSync(src)) {
                content = fs.readFileSync(src, 'utf8');
                sourceUsed = src;
                break;
            }
        }

        // Extract Name from # Name
        const nameMatch = content.match(/^#\s+(.+?)(?:\n|$)/m);
        const name = nameMatch ? nameMatch[1].trim() : slug;

        const config = CHARACTERS_CONFIG[slug] || {};

        await contentDB.InsertCharacter({
            id: `char-${slug}`,
            slug: slug,
            name: name,
            char_type: config.type || 'Character',
            emoji: config.emoji || '',
            content: content,
            visible: true
        });
        console.log(`✅ Migrated ${slug} (Source: ${sourceUsed})`);
    }

    // 2. Seed Lore
    console.log('📦 Seeding lore topics...');
    
    // Compendium
    const compendiumPath = path.join(__dirname, '../public/data/lore/compendium.md');
    if (fs.existsSync(compendiumPath)) {
        const content = fs.readFileSync(compendiumPath, 'utf8');
        await contentDB.InsertLoreTopic({
            id: 'lore-compendium',
            slug: 'compendium',
            section: 'compendium',
            title: 'The Lore Compendium',
            content: content,
            visible: true
        });
        console.log('✅ Migrated compendium');
    }

    // World topics
    const worldDir = path.join(__dirname, '../public/data/lore/world');
    if (fs.existsSync(worldDir)) {
        const topics = fs.readdirSync(worldDir);
        for (const topic of topics) {
            const overviewPath = path.join(worldDir, topic, 'overview.md');
            if (fs.existsSync(overviewPath)) {
                const content = fs.readFileSync(overviewPath, 'utf8');
                await contentDB.InsertLoreTopic({
                    id: `lore-world-${topic}`,
                    slug: topic,
                    section: 'world',
                    title: topic.replace(/-/g, ' ').replace(/_/g, ' '),
                    content: content,
                    visible: true
                });
                console.log(`✅ Migrated world topic: ${topic}`);
            }
        }
    }

    await contentDB.Close();
    console.log('✨ Migration complete!');
}

migrate().catch(console.error);
