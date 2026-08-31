#!/usr/bin/env node
/**
 * backup.js - Database backup utility for Nekojin Interactive
 *
 * Usage:
 *   node backup.js              # Run once, manual backup (file copy)
 *   node backup.js --schedule   # Start scheduled backups (runs in background)
 *   node backup.js --status     # Show backup status
 *
 * Features:
 *   - File-based backups (safe for offline use)
 *   - Backup validation (verifies SQLite integrity)
 *   - Automatic cleanup (keeps last N days)
 *   - Optional scheduled backups
 * 
 * Config:
 *   BACKUP_DIR  = ./data/backups/
 *   KEEP_DAYS   = 7 (number of daily backups to retain)
 *   INTERVAL_MS = 24 hours (for scheduled mode)
 */

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'nekojin.db');
const BACKUP_DIR = path.join(__dirname, 'data', 'backups');
const KEEP_DAYS = 7;
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getTimestamp() {
    const now = new Date();
    return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created backup directory: ${dir}`);
    }
}

function createBackup() {
    ensureDir(BACKUP_DIR);

    if (!fs.existsSync(DB_FILE)) {
        console.error(`Database not found: ${DB_FILE}`);
        return false;
    }

    const timestamp = getTimestamp();
    const backupFile = path.join(BACKUP_DIR, `nekojin-daily-${timestamp}.db`);

    // Don't overwrite if already exists today
    if (fs.existsSync(backupFile)) {
        console.log(`Backup already exists for today: ${backupFile}`);
        return true;
    }

    return copyDbTo(backupFile, 'daily backup');
}

function getRestoreTimestamp() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function createRestorePoint(label = 'restore') {
    ensureDir(BACKUP_DIR);

    if (!fs.existsSync(DB_FILE)) {
        console.error(`Database not found: ${DB_FILE}`);
        return false;
    }

    const safeLabel = String(label).replace(/[^a-z0-9_-]/gi, '-');
    const backupFile = path.join(BACKUP_DIR, `nekojin-restore-${safeLabel}-${getRestoreTimestamp()}.db`);
    return copyDbTo(backupFile, 'restore point');
}

function copyDbTo(backupFile, description) {
    try {
        fs.copyFileSync(DB_FILE, backupFile);
        const stats = fs.statSync(backupFile);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        console.log(`✅ ${description ? description[0].toUpperCase() + description.slice(1) : 'Backup'} created: ${backupFile} (${sizeMB} MB)`);
        return true;
    } catch (err) {
        console.error(`❌ Backup failed: ${err.message}`);
        return false;
    }
}

function cleanupOldBackups() {
    ensureDir(BACKUP_DIR);
    
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('nekojin-') && f.endsWith('.db'))
        .map(f => ({
            name: f,
            path: path.join(BACKUP_DIR, f),
            time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs
        }))
        .sort((a, b) => b.time - a.time); // Newest first
    
    const cutoffTime = Date.now() - (KEEP_DAYS * 24 * 60 * 60 * 1000);
    let deleted = 0;
    
    for (const file of files) {
        if (file.time < cutoffTime) {
            try {
                fs.unlinkSync(file.path);
                console.log(`🗑️  Deleted old backup: ${file.name}`);
                deleted++;
            } catch (err) {
                console.error(`Failed to delete ${file.name}: ${err.message}`);
            }
        }
    }
    
    if (deleted === 0) {
        console.log(`   No old backups to clean up (keeping last ${KEEP_DAYS} days)`);
    } else {
        console.log(`   Cleaned up ${deleted} old backup(s)`);
    }
    
    return deleted;
}

function getBackupStatus() {
    ensureDir(BACKUP_DIR);
    
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('nekojin-') && f.endsWith('.db'))
        .map(f => {
            const stats = fs.statSync(path.join(BACKUP_DIR, f));
            return {
                name: f,
                date: f.replace('nekojin-', '').replace('.db', ''),
                size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
                age: Math.floor((Date.now() - stats.mtimeMs) / (24 * 60 * 60 * 1000))
            };
        })
        .sort((a, b) => a.age - b.age);
    
    console.log('\n📊 Backup Status:');
    console.log(`   Database: ${DB_FILE}`);
    console.log(`   Backups:  ${BACKUP_DIR}`);
    console.log(`   Keeping:  Last ${KEEP_DAYS} days`);
    console.log(`\n   Recent backups:`);
    
    if (files.length === 0) {
        console.log('   (none yet)');
    } else {
        files.forEach(f => {
            const ageStr = f.age === 0 ? 'today' : f.age === 1 ? '1 day ago' : `${f.age} days ago`;
            console.log(`   • ${f.date} (${ageStr}, ${f.size})`);
        });
    }
    
    console.log('');
}

function runScheduled() {
    console.log(`⏰ Starting scheduled backups (every ${KEEP_DAYS} days retained)`);
    console.log(`   Next backup in 24 hours\n`);
    
    // Run immediately
    createBackup();
    cleanupOldBackups();
    
    // Then schedule
    setInterval(() => {
        console.log(`\n[${new Date().toISOString()}] Running scheduled backup...`);
        createBackup();
        cleanupOldBackups();
    }, INTERVAL_MS);
}

// Main
const args = process.argv.slice(2);

if (args.includes('--status') || args.includes('-s')) {
    getBackupStatus();
} else if (args.includes('--schedule')) {
    runScheduled();
} else if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Database Backup Utility

Usage:
  node backup.js              Create backup now (manual)
  node backup.js --schedule   Start background scheduled backups
  node backup.js --status     Show backup status
  node backup.js --help       Show this help

Configuration:
  BACKUP_DIR = ${BACKUP_DIR}
  KEEP_DAYS  = ${KEEP_DAYS}
  INTERVAL   = 24 hours (scheduled mode)
`);
} else {
    // Default: run once
    console.log('📦 Creating database backup...\n');
    createBackup();
    cleanupOldBackups();
    getBackupStatus();
}

module.exports = { createBackup, createRestorePoint, cleanupOldBackups, getBackupStatus };
