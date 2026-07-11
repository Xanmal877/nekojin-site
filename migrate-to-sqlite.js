#!/usr/bin/env node
/**
 * migrate-to-sqlite.js
 * One-time migration from site-content.json to SQLite database
 * Run: node migrate-to-sqlite.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Import the database module
const contentDB = require('./database.js');

const CONTENT_FILE = path.join(os.homedir(), 'Documents', 'nekojin-data', 'site-content.json');
const BACKUP_FILE = path.join(os.homedir(), 'Documents', 'nekojin-data', 'site-content.json.backup');

async function migrate() {
    console.log('🗄️  Nekojin Content Migration: JSON → SQLite\n');

    // Check if JSON file exists
    if (!fs.existsSync(CONTENT_FILE)) {
        console.log('⚠️  No site-content.json found at:');
        console.log('   ' + CONTENT_FILE);
        console.log('\nCreating fresh database with empty tables...');
        
        contentDB.Open();
        await contentDB.Close();
        console.log('✅ Database initialized (no data to migrate)');
        return;
    }

    // Read JSON data
    console.log('📖 Reading site-content.json...');
    let jsonData;
    try {
        const raw = fs.readFileSync(CONTENT_FILE, 'utf8');
        jsonData = JSON.parse(raw);
    } catch (err) {
        console.error('❌ Failed to parse JSON:', err.message);
        process.exit(1);
    }

    console.log(`   Found ${jsonData.series?.length || 0} series`);
    console.log(`   Found ${jsonData.books?.length || 0} books`);
    console.log(`   Game data: ${jsonData.game && Object.keys(jsonData.game).length > 0 ? 'yes' : 'no'}`);
    console.log(`   About data: ${jsonData.about && Object.keys(jsonData.about).length > 0 ? 'yes' : 'no'}`);

    // Open database
    console.log('\n🔌 Opening SQLite database...');
    await contentDB.Open();
    console.log('ContentDB: Database opened');

    // Migrate in transaction
    console.log('📝 Migrating data...\n');

    try {
        // Series first (books reference them)
        if (jsonData.series && jsonData.series.length > 0) {
            console.log('  → Migrating series...');
            for (const series of jsonData.series) {
                await contentDB.InsertSeries({
                    id: series.id,
                    name: series.name || series.title,
                    description: series.description || '',
                    sort_order: series.sort_order || 0
                });
            }
            console.log(`     ✓ Migrated ${jsonData.series.length} series`);
        }

        // Books
        if (jsonData.books && jsonData.books.length > 0) {
            console.log('  → Migrating books...');
            for (const book of jsonData.books) {
                await contentDB.InsertBook({
                    id: book.id,
                    title: book.title,
                    slug: book.slug || book.id,
                    description: book.description || '',
                    blurb: book.blurb || '',
                    volume: book.volume || '',
                    status: book.status || 'draft',
                    seriesId: book.seriesId || book.series_id,
                    volumeNumber: book.volumeNumber || book.volume_number,
                    wordCount: book.wordCount || book.word_count || 0,
                    cover: book.cover || book.cover_path,
                    visible: book.visible !== false,
                    genres: book.genres || [],
                    tags: book.tags || [],
                    platforms: book.platforms || book.links || []
                });
            }
            console.log(`     ✓ Migrated ${jsonData.books.length} books`);
        }

        // Game
        if (jsonData.game && Object.keys(jsonData.game).length > 0) {
            console.log('  → Migrating game data...');
            await contentDB.InsertGame({
                id: 'main',
                title: jsonData.game.title || 'Untitled Project',
                slug: jsonData.game.slug || 'current-project',
                description: jsonData.game.description || '',
                status: jsonData.game.status || 'in_development',
                cover: jsonData.game.cover,
                screenshots: jsonData.game.screenshots || [],
                devlog: jsonData.game.devlog || []
            });
            console.log('     ✓ Migrated game info');

            // Screenshots
            if (jsonData.game.screenshots) {
                for (let i = 0; i < jsonData.game.screenshots.length; i++) {
                    const ss = jsonData.game.screenshots[i];
                    await contentDB.InsertGameScreenshot({
                        game_id: 'main',
                        path: typeof ss === 'string' ? ss : ss.path,
                        caption: typeof ss === 'string' ? '' : (ss.caption || ''),
                        sort_order: i
                    });
                }
                console.log(`     ✓ Migrated ${jsonData.game.screenshots.length} screenshots`);
            }

            // Devlog
            if (jsonData.game.devlog) {
                for (const entry of jsonData.game.devlog) {
                    await contentDB.InsertDevlog({
                        game_id: 'main',
                        title: entry.title,
                        content: entry.content || '',
                        date: entry.date || entry.created_at || new Date().toISOString().split('T')[0],
                        visible: entry.visible !== false
                    });
                }
                console.log(`     ✓ Migrated ${jsonData.game.devlog.length} devlog entries`);
            }
        }

        // About
        if (jsonData.about && Object.keys(jsonData.about).length > 0) {
            console.log('  → Migrating about/studio data...');
            await contentDB.InsertAbout({
                studioName: jsonData.about.studio_name || jsonData.about.studioName,
                foundedDate: jsonData.about.founded_date || jsonData.about.foundedDate,
                description: jsonData.about.description || '',
                email: jsonData.about.email || '',
                socialLinks: jsonData.about.social_links || jsonData.about.socialLinks || {}
            });
            console.log('     ✓ Migrated about data');
        }

        console.log('\n✅ Migration complete!');

        // Create backup of JSON file
        console.log('\n💾 Creating backup...');
        fs.copyFileSync(CONTENT_FILE, BACKUP_FILE);
        console.log('   Backup saved to:');
        console.log('   ' + BACKUP_FILE);

        // Verify by reading back
        console.log('\n🔍 Verifying migration...');
        const verifyData = await contentDB.GetAllContent();
        console.log(`   Series in DB: ${verifyData.series.length}`);
        console.log(`   Books in DB: ${verifyData.books.length}`);
        console.log(`   Game in DB: ${verifyData.game ? 'yes' : 'no'}`);
        console.log(`   About in DB: ${verifyData.about && verifyData.about.studio_name ? 'yes' : 'no'}`);

        console.log('\n🎉 Migration successful!');
        console.log('\nNext steps:');
        console.log('  1. Update dashboard-server.js to use database');
        console.log('  2. Test the website');
        console.log('  3. If all good, you can remove site-content.json (backup kept)');

    } catch (err) {
        console.error('\n❌ Migration failed:', err.message);
        console.error(err.stack);
        process.exit(1);
    } finally {
        await contentDB.Close();
    }
}

// Run migration
migrate().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
