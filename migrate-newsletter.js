#!/usr/bin/env node
/**
 * migrate-newsletter.js
 * One-time migration from newsletter-subscribers.json to SQLite
 * Run: node migrate-newsletter.js
 */

const fs = require('fs');
const path = require('path');
const contentDB = require('./database.js');

const NEWSLETTER_FILE = path.join(__dirname, 'newsletter-subscribers.json');

async function migrate() {
    console.log('📧 Newsletter Migration: JSON → SQLite\n');

    // Check if JSON file exists
    if (!fs.existsSync(NEWSLETTER_FILE)) {
        console.log('⚠️  No newsletter-subscribers.json found');
        console.log('   Creating fresh subscribers table...');
        
        await contentDB.Open();
        await contentDB.Close();
        console.log('✅ Subscribers table ready (no data to migrate)');
        return;
    }

    // Read JSON data
    console.log('📖 Reading newsletter-subscribers.json...');
    let subscribers = [];
    try {
        const raw = fs.readFileSync(NEWSLETTER_FILE, 'utf8');
        subscribers = JSON.parse(raw);
        console.log(`   Found ${subscribers.length} subscribers`);
    } catch (err) {
        console.error('❌ Failed to parse JSON:', err.message);
        return;
    }

    if (subscribers.length === 0) {
        console.log('✅ No subscribers to migrate');
        await contentDB.Open();
        await contentDB.Close();
        return;
    }

    // Open database
    console.log('\n🗄️  Opening database...');
    await contentDB.Open();

    // Migrate each subscriber
    console.log('\n📝 Migrating subscribers...');
    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const sub of subscribers) {
        const email = sub.email;
        const source = sub.source || 'website';
        
        try {
            const result = await contentDB.InsertSubscriber(email, source);
            if (result.success) {
                migrated++;
                process.stdout.write(`✓ ${email}\n`);
            } else {
                skipped++;
                process.stdout.write(`⊘ ${email} (duplicate)\n`);
            }
        } catch (err) {
            errors++;
            process.stdout.write(`✗ ${email} (${err.message})\n`);
        }
    }

    // Close database
    await contentDB.Close();

    // Summary
    console.log('\n✅ Migration complete!');
    console.log(`   Migrated: ${migrated}`);
    console.log(`   Skipped (duplicates): ${skipped}`);
    console.log(`   Errors: ${errors}`);
    
    // Backup old file
    const backupPath = NEWSLETTER_FILE + '.backup.' + Date.now();
    fs.renameSync(NEWSLETTER_FILE, backupPath);
    console.log(`\n📦 Backed up old file to: ${backupPath}`);
}

migrate().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
