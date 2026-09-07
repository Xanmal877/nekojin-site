/**
 * database.js - SQLite module for Nekojin Interactive
 * Pattern matches your Godot AccountDB/SoulBlueprintDB structure
 * Uses Node.js sqlite3 package (similar to Godot's SQLite addon)
 *
 * Persistence Features:
 * - Backup API for pre-save snapshots
 * - Graceful database close with timeout protection
 * - Consistent transaction handling
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('node:crypto');

// Database location - single file like your Godot project
const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'nekojin.db');
const BACKUP_DIR = path.join(DB_DIR, 'backups');

/**
 * ContentDB - Manages books, series, game, and about data
 * Similar to your AccountDB class in Godot
 */
class ContentDB {
    constructor() {
        this.db = null;
        this.isOpen = false;
        this.initPromise = null;
        this.backupInProgress = false;
        // All mutations and backups share one queue. Separate queues can form
        // a circular wait when a backup is requested between two saves.
        this.operationQueue = Promise.resolve();
    }

    /**
     * Create a backup file for disaster recovery
     * Uses SQLite backup API when DB is open, file copy for offline backups
     *
     * Ensures backups and saves are serialized: a backup will not begin while
     * a save is in progress, and vice versa. This prevents race conditions where
     * backup reads half-written data or a save corrupts backup state.
     */
    async CreateBackup(label = 'manual') {
        const operation = this.operationQueue.then(() => this._createBackup(label));
        this.operationQueue = operation.catch(() => {});
        return operation;
    }

    async _createBackup(label = 'manual') {
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
        }
        // Backups contain the full database, including stored credentials and
        // customer data. Enforce owner-only access for existing directories too.
        fs.chmodSync(BACKUP_DIR, 0o700);

        if (!fs.existsSync(DB_PATH)) {
            throw new Error(`Database not found: ${DB_PATH}`);
        }

        this.backupInProgress = true;
        try {
            const now = new Date();
            const safeLabel = String(label).replace(/[^a-z0-9_-]/gi, '-').slice(0, 50);
            const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const backupPath = path.join(BACKUP_DIR,
                `nekojin-${safeLabel}-${timestamp}-${crypto.randomBytes(4).toString('hex')}.db`);

            // Use SQLite backup API if open, file copy otherwise
            if (this.isOpen && this.db) {
                await this._backupViaApi(backupPath);
            } else {
                fs.copyFileSync(DB_PATH, backupPath);
            }

            // Restrict backup file permissions to owner only
            fs.chmodSync(backupPath, 0o600);

            // Validate it's a real SQLite database with expected schema
            await this._validateBackup(backupPath);

            const stats = fs.statSync(backupPath);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            console.log(`✅ Backup created: ${path.basename(backupPath)} (${sizeMB} MB)`);
            return backupPath;
        } finally {
            this.backupInProgress = false;
        }
    }

    async _backupViaApi(targetPath) {
        return new Promise((resolve, reject) => {
            try {
                this.db.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`, err => {
                    if (err) reject(new Error(`SQLite backup failed: ${err.message}`));
                    else resolve();
                });
            } catch (err) { reject(err); }
        });
    }

    async _validateBackup(backupPath) {
        return new Promise((resolve, reject) => {
            const backup = new sqlite3.Database(backupPath, sqlite3.OPEN_READONLY, (err) => {
                if (err) {
                    reject(new Error(`Backup validation failed: ${err.message}`));
                    return;
                }

                // Run PRAGMA integrity_check to detect corruption
                backup.get('PRAGMA integrity_check', (integrityErr, integrityRow) => {
                    if (integrityErr) {
                        backup.close(() => {
                            reject(new Error(`Backup integrity check failed: ${integrityErr.message}`));
                        });
                        return;
                    }

                    // integrity_check returns 'ok' on success, otherwise a description
                    const integrityStatus = integrityRow && integrityRow.integrity_check;
                    if (integrityStatus !== 'ok') {
                        backup.close(() => {
                            reject(new Error(`Backup integrity violation: ${integrityStatus || 'unknown'}`));
                        });
                        return;
                    }

                    // Verify expected schema: check for critical tables
                    const criticalTables = ['books', 'series', 'characters', 'game'];
                    const checkSql = `
                        SELECT COUNT(*) as found FROM
                        (SELECT 1 WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='books')
                         UNION ALL SELECT 1 WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='series')
                         UNION ALL SELECT 1 WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='characters')
                         UNION ALL SELECT 1 WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='game'))
                    `;
                    backup.get(checkSql, (schemaErr, schemaRow) => {
                        backup.close(() => {
                            if (schemaErr) {
                                reject(new Error(`Backup schema validation error: ${schemaErr.message}`));
                            } else if (!schemaRow || schemaRow.found < criticalTables.length) {
                                reject(new Error(`Backup missing expected schema tables`));
                            } else {
                                resolve();
                            }
                        });
                    });
                });
            });
        });
    }

    /**
     * Open the database connection
     * Similar to your Open(path) method
     */
    async Open() {
        if (this.isOpen) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this._initialize();
        return this.initPromise;
    }

    async _initialize() {
        try {
            if (!fs.existsSync(DB_DIR)) {
                fs.mkdirSync(DB_DIR, { recursive: true });
            }
            // Enforce restrictive permissions on database directory.
            // Do this for both new and existing directories to ensure consistency
            // even if permissions were inadvertently loosened.
            fs.chmodSync(DB_DIR, 0o700);

            await new Promise((resolve, reject) => {
                this.db = new sqlite3.Database(DB_PATH, (err) => {
                    if (err) {
                        console.error('Failed to open database:', err);
                        reject(err);
                    } else {
                        console.log('ContentDB: Connected to', DB_PATH);
                        resolve();
                    }
                });
            });

            // Enforce restrictive permissions on database file (owner read/write only)
            fs.chmodSync(DB_PATH, 0o600);

            await this._run('PRAGMA foreign_keys = ON');
            await this._CreateTables();
            this.isOpen = true;
            console.log('ContentDB: Tables created');
        } catch (err) {
            const db = this.db;
            this.db = null;
            this.isOpen = false;
            this.initPromise = null;
            if (db) await new Promise(resolve => db.close(() => resolve()));
            throw err;
        }
    }

    /**
     * Helper: Run SQL with promise
     */
    _run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    /**
     * Helper: Get single row
     */
    _get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    /**
     * Helper: Get all rows
     */
    _all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    /**
     * Create all tables
     * Similar to your _CreateTables() method
     */
    async _CreateTables() {
        // Series table
        await this._run(`
            CREATE TABLE IF NOT EXISTS series (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Books table
        await this._run(`
            CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                slug TEXT UNIQUE NOT NULL,
                description TEXT,
                blurb TEXT,
                volume TEXT,
                status TEXT DEFAULT 'draft',
                series_id TEXT,
                volume_number INTEGER,
                word_count INTEGER DEFAULT 0,
                cover_path TEXT,
                visible BOOLEAN DEFAULT 1,
                genres TEXT,
                tags TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE SET NULL
            )
        `);

        // Book platforms
        await this._run(`
            CREATE TABLE IF NOT EXISTS book_platforms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id TEXT NOT NULL,
                platform_type TEXT NOT NULL,
                platform_name TEXT NOT NULL,
                url TEXT,
                external_id TEXT,
                sort_order INTEGER DEFAULT 0,
                FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
            )
        `);

        // Migration: Add tier column to books table (if not exists)
        try {
            await this._run(`ALTER TABLE books ADD COLUMN tier TEXT`);
            console.log('ContentDB: Added tier column to books table');
        } catch (e) {
            // Column likely already exists, ignore
        }

        // Migration: Add cta_platform column to books table (if not exists)
        try {
            await this._run(`ALTER TABLE books ADD COLUMN cta_platform TEXT`);
            console.log('ContentDB: Added cta_platform column to books table');
        } catch (e) {
            // Column likely already exists, ignore
        }

        // Migration: Add publish_at column to books table (if not exists)
        try {
            await this._run(`ALTER TABLE books ADD COLUMN publish_at DATETIME`);
            console.log('ContentDB: Added publish_at column to books table');
        } catch (e) {
            // Column likely already exists, ignore
        }

        // Game info
        await this._run(`
            CREATE TABLE IF NOT EXISTS game (
                id TEXT PRIMARY KEY DEFAULT 'main',
                title TEXT NOT NULL,
                data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Game screenshots
        await this._run(`
            CREATE TABLE IF NOT EXISTS game_screenshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT DEFAULT 'main',
                path TEXT NOT NULL,
                caption TEXT,
                sort_order INTEGER DEFAULT 0,
                FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE CASCADE
            )
        `);

        // Devlog entries
        await this._run(`
            CREATE TABLE IF NOT EXISTS devlog (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT DEFAULT 'main',
                title TEXT NOT NULL,
                content TEXT,
                date TEXT,
                visible BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE CASCADE
            )
        `);

        // About/studio info
        await this._run(`
            CREATE TABLE IF NOT EXISTS about (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                studio_name TEXT,
                founded_date TEXT,
                description TEXT,
                email TEXT,
                social_links TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migration: Add missing about-page columns (if not exists)
        for (const col of ['tagline TEXT', 'portrait TEXT', 'description2 TEXT', 'description3 TEXT', 'universe_blurb TEXT']) {
            try {
                await this._run(`ALTER TABLE about ADD COLUMN ${col}`);
            } catch (e) {
                // Column likely already exists, ignore
            }
        }

        // Migration: Add series table extensions (if not exists)
        for (const col of ['cover_image TEXT', 'status TEXT', 'word_count INTEGER DEFAULT 0', 'reading_order INTEGER DEFAULT 0']) {
            try {
                await this._run(`ALTER TABLE series ADD COLUMN ${col}`);
            } catch (e) {
                // Column likely already exists, ignore
            }
        }

        // Newsletter subscribers
        await this._run(`
            CREATE TABLE IF NOT EXISTS subscribers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                source TEXT DEFAULT 'website',
                active BOOLEAN DEFAULT 1
            )
        `);

        // Homepage settings table
        await this._run(`
            CREATE TABLE IF NOT EXISTS homepage_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                xanrean_bg TEXT DEFAULT '/covers/homepage-cover-xanrean.webp',
                standalone_bg TEXT DEFAULT '/covers/homepage-cover-standalone.webp',
                community_bg TEXT DEFAULT '/covers/homepage-cover-community.webp',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Insert default row if not exists
        await this._run(`
            INSERT OR IGNORE INTO homepage_settings (id) VALUES (1)
        `);

        // Add community_bg column if not exists (migration)
        try {
            await this._get('SELECT community_bg FROM homepage_settings');
        } catch (e) {
            await this._run('ALTER TABLE homepage_settings ADD COLUMN community_bg TEXT DEFAULT \'/covers/homepage-cover-community.webp\'');
        }

        // Xanrean page settings table
        await this._run(`
            CREATE TABLE IF NOT EXISTS xanrean_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                books_bg TEXT DEFAULT '/covers/xanrean-cover-books.webp',
                characters_bg TEXT DEFAULT '/covers/xanrean-cover-characters.webp',
                lore_bg TEXT DEFAULT '/covers/xanrean-cover-lore.webp',
                game_bg TEXT DEFAULT '/covers/xanrean-cover-game.webp',
                gumroad_seller_id TEXT,
                gumroad_access_token TEXT,
                youtube_channel_id TEXT,
                discord_server_id TEXT,
                discord_invite_code TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Insert default row if not exists
        await this._run(`
            INSERT OR IGNORE INTO xanrean_settings (id) VALUES (1)
        `);

        // Characters table
        await this._run(`
            CREATE TABLE IF NOT EXISTS characters (
                id TEXT PRIMARY KEY,
                slug TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                title TEXT,
                char_type TEXT,
                species TEXT,
                emoji TEXT,
                content TEXT,
                image TEXT,
                sort_order INTEGER DEFAULT 0,
                visible INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Character appearances table (links a character to the series
        // whose cast page it shows up on; one row per character has
        // is_home=1, marking that series as the character's canonical bio
        // owner, others are cross-series guest links to the same card)
        await this._run(`
            CREATE TABLE IF NOT EXISTS character_appearances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT NOT NULL,
                series_id TEXT NOT NULL,
                cast_group TEXT,
                is_home INTEGER DEFAULT 0,
                sort_order INTEGER DEFAULT 0,
                FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
                FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
            )
        `);

        // Lore Topics table
        await this._run(`
            CREATE TABLE IF NOT EXISTS lore_topics (
                id TEXT PRIMARY KEY,
                slug TEXT UNIQUE NOT NULL,
                section TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT,
                sort_order INTEGER DEFAULT 0,
                visible INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await this._run('CREATE INDEX IF NOT EXISTS idx_books_series ON books(series_id)');
        await this._run('CREATE INDEX IF NOT EXISTS idx_books_status ON books(status)');
        await this._run('CREATE INDEX IF NOT EXISTS idx_books_visible ON books(visible)');
        await this._run('CREATE INDEX IF NOT EXISTS idx_platforms_book ON book_platforms(book_id)');
        await this._run('CREATE INDEX IF NOT EXISTS idx_chars_slug ON characters(slug)');
        await this._run('CREATE INDEX IF NOT EXISTS idx_appearances_character ON character_appearances(character_id)');
        await this._run('CREATE INDEX IF NOT EXISTS idx_appearances_series ON character_appearances(series_id)');
        await this._run('CREATE INDEX IF NOT EXISTS idx_lore_slug ON lore_topics(slug)');
        // Migration: Add relationships column to characters table (if not exists)
        try {
            await this._run(`ALTER TABLE characters ADD COLUMN relationships TEXT`);
            console.log('ContentDB: Added relationships column to characters table');
        } catch (e) {
            // Column likely already exists, ignore
        }

        // Timeline Events table
        await this._run(`
            CREATE TABLE IF NOT EXISTS timeline_events (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                era TEXT,
                description TEXT,
                related_character_slugs TEXT,
                related_book_id TEXT,
                sort_order INTEGER DEFAULT 0,
                visible INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Sales table
        await this._run(`
            CREATE TABLE IF NOT EXISTS sales (
                id TEXT PRIMARY KEY,
                gumroad_sale_id TEXT UNIQUE,
                product_name TEXT,
                price_cents INTEGER,
                currency TEXT,
                recurrence TEXT,
                email TEXT,
                seller_id TEXT,
                is_test INTEGER DEFAULT 0,
                purchased_at TEXT
            )
        `);
        await this._run('CREATE INDEX IF NOT EXISTS idx_sales_purchased_at ON sales(purchased_at)');

        await this._run('CREATE INDEX IF NOT EXISTS idx_timeline_sort ON timeline_events(sort_order)');
    }

    /**
      * Close the database connection gracefully
      * Similar to your Close(path) method
      * Ensures pending operations are flushed with timeout protection
      */
    async Close() {
        if (!this.db || !this.isOpen) return;
        this.isOpen = false;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.warn('Database close timeout, forcing...');
                reject(new Error('Database close timeout'));
            }, 5000);

            this.db.close((err) => {
                clearTimeout(timeout);
                this.initPromise = null;
                if (err) {
                    console.error('Error closing database:', err);
                    reject(err);
                } else {
                    console.log('ContentDB: Closed gracefully');
                    resolve();
                }
            });
        });
    }

    // ============================================================
    // SERIES CRUD
    // ============================================================

    async InsertSeries(data) {
        const sql = `
            INSERT INTO series (id, name, description, sort_order, cover_image, status, word_count, reading_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                sort_order = excluded.sort_order,
                cover_image = excluded.cover_image,
                status = excluded.status,
                word_count = excluded.word_count,
                reading_order = excluded.reading_order,
                updated_at = CURRENT_TIMESTAMP
        `;
        const result = await this._run(sql, [
            data.id,
            // SelectSeries echoes the DB columns back as `name`/`description`
            // *and* as the UI-facing `universe`/`universeDesc` aliases (see
            // below). admin.html only ever edits `universe`/`universeDesc`,
            // so when a caller round-trips a loaded series back through here
            // those must win. Otherwise the stale `name`/`description`
            // riding along in the object silently overwrites every edit.
            data.universe || data.name || data.title || '',
            data.universeDesc || data.description || '',
            data.sort_order || 0,
            data.cover_image || null,
            data.status || null,
            data.word_count || 0,
            data.reading_order || 0
        ]);
        return { id: data.id, changes: result.changes };
    }

    async SelectSeries() {
        const rows = await this._all('SELECT * FROM series ORDER BY sort_order, name');
        // Admin UI and public pages use "universe"/"universeDesc" field names
        for (const row of rows) {
            row.universe = row.name;
            row.universeDesc = row.description;
        }
        return rows;
    }

    async DeleteSeries(id) {
        const result = await this._run('DELETE FROM series WHERE id = ?', [id]);
        return { changes: result.changes };
    }

    // ============================================================
    // BOOKS CRUD
    // ============================================================

    async InsertBook(data) {
        const validStatuses = new Set(['draft', 'preview', 'published', 'archived']);
        const status = validStatuses.has(data.status) ? data.status : 'draft';
        const publishAt = data.publishAt || data.publish_at || null;

        const sql = `
            INSERT INTO books (
                id, title, slug, description, blurb, volume, status, series_id,
                volume_number, word_count, cover_path, visible, genres, tags, tier, cta_platform, publish_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                slug = excluded.slug,
                description = excluded.description,
                blurb = excluded.blurb,
                volume = excluded.volume,
                status = excluded.status,
                series_id = excluded.series_id,
                volume_number = excluded.volume_number,
                word_count = excluded.word_count,
                cover_path = excluded.cover_path,
                visible = excluded.visible,
                genres = excluded.genres,
                tags = excluded.tags,
                tier = excluded.tier,
                cta_platform = excluded.cta_platform,
                publish_at = excluded.publish_at,
                updated_at = CURRENT_TIMESTAMP
        `;

        await this._run(sql, [
            data.id,
            data.title,
            data.slug,
            data.description || '',
            data.blurb || '',
            data.volume || '',
            status,
            data.seriesId || data.series_id || null,
            data.volumeNumber || data.volume_number || null,
            data.wordCount || data.word_count || 0,
            data.cover || data.cover_path || null,
            data.visible !== false ? 1 : 0,
            JSON.stringify(data.genres || []),
            JSON.stringify(data.tags || []),
            data.tier || null,
            data.ctaPlatform || data.cta_platform || 'kdp',
            publishAt
        ]);

        // Insert platforms with normalized field names
        const platforms = data.platforms || [];
        for (let i = 0; i < platforms.length; i++) {
            const p = platforms[i];
            await this._run(`
                INSERT INTO book_platforms (book_id, platform_type, platform_name, url, sort_order)
                VALUES (?, ?, ?, ?, ?)
            `, [
                data.id,
                p.type || p.platform_type,
                p.name || p.platform_name,
                p.url,
                i
            ]);
        }

        return { id: data.id };
    }

    async SelectBooks(slugOrId = null) {
        const sql = slugOrId === null
            ? 'SELECT * FROM books ORDER BY series_id, volume_number, title'
            : 'SELECT * FROM books WHERE slug = ? OR id = ? ORDER BY series_id, volume_number, title';
        const params = slugOrId === null ? [] : [slugOrId, slugOrId];
        const rows = await this._all(sql, params);

        // Parse JSON and load platforms
        const books = [];
        for (const row of rows) {
            try {
                row.genres = row.genres ? JSON.parse(row.genres) : [];
                row.tags = row.tags ? JSON.parse(row.tags) : [];
            } catch {
                row.genres = [];
                row.tags = [];
            }
            row.visible = !!row.visible;
            row.wordCount = row.word_count;
            row.publishAt = row.publish_at || null;

            // Map database fields to expected API format
            row.cover = row.cover_path;
            row.volume = row.volume || '';
            row.ctaPlatform = row.cta_platform || 'kdp';

            // Load platforms and normalize field names
            row.platforms = await this.SelectBookPlatforms(row.id);
            // Map platform fields for compatibility
            row.platforms = row.platforms.map(p => ({
                type: p.platform_type,
                name: p.platform_name,
                url: p.url,
                ...p
            }));

            books.push(row);
        }
        return books;
    }

    async DeleteBook(id) {
        // Platforms delete via CASCADE
        const result = await this._run('DELETE FROM books WHERE id = ?', [id]);
        return { changes: result.changes };
    }

    // ============================================================
    // BOOK PLATFORMS
    // ============================================================

    async SelectBookPlatforms(bookId) {
        return await this._all(
            'SELECT * FROM book_platforms WHERE book_id = ? ORDER BY sort_order',
            [bookId]
        );
    }

    effectiveStatus(book) {
        const raw = book.status || 'draft';
        if (raw === 'published' && book.publishAt) {
            const pub = new Date(book.publishAt);
            const now = new Date();
            if (!isNaN(pub) && pub > now) return 'preview';
        }
        return raw;
    }

    isBookPublic(book, previewAllowed = false) {
        const status = this.effectiveStatus(book);
        if (status === 'published' || status === 'released') return true;
        if (status === 'preview' && previewAllowed) return true;
        return false;
    }

    async DeleteBookPlatforms(bookId) {
        const result = await this._run('DELETE FROM book_platforms WHERE book_id = ?', [bookId]);
        return { changes: result.changes };
    }

    // ============================================================
    // GAME CRUD
    // ============================================================

    async InsertGame(data) {
        const sql = `
            INSERT INTO game (id, title, data)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                data = excluded.data,
                updated_at = CURRENT_TIMESTAMP
        `;
        await this._run(sql, [
            data.id || 'main',
            data.title || 'Untitled',
            JSON.stringify(data)
        ]);
        return { id: data.id || 'main' };
    }


    async SelectGames() {
        const rows = await this._all('SELECT * FROM game ORDER BY created_at DESC');
        if (!rows || rows.length === 0) return [];

        const games = [];
        for (const row of rows) {
            let gameData = {};
            if (row.data) {
                try {
                    gameData = JSON.parse(row.data);
                } catch {
                    gameData = {};
                }
            }

            // Ensure fields are present
            gameData.id = row.id;
            gameData.title = gameData.title || row.title;
            if (typeof gameData.sort_order !== 'number') gameData.sort_order = 0;
            if (typeof gameData.visible !== 'boolean') gameData.visible = true;

            // Load related data for this game
            gameData.screenshots = await this.SelectGameScreenshots(row.id);
            gameData.devlog = await this.SelectDevlog(row.id);

            games.push(gameData);
        }

        // sort_order (set via ReorderGames / the admin drag-and-drop UI)
        // decides display and "featured" order, not insertion time.
        games.sort((a, b) => a.sort_order - b.sort_order);

        return games;
    }

    async ReorderGames(gameIds) {
        const operation = this.operationQueue.then(() => this._reorderGames(gameIds));
        this.operationQueue = operation.catch(() => {});
        return operation;
    }

    async _reorderGames(gameIds) {
        if (!gameIds || !Array.isArray(gameIds)) return { success: false, error: 'Invalid game IDs' };

        const rows = await this._all('SELECT * FROM game');
        const byId = new Map(rows.map(r => [r.id, r]));

        try {
            await this._run('BEGIN TRANSACTION');
            for (let i = 0; i < gameIds.length; i++) {
                const row = byId.get(gameIds[i]);
                if (!row) continue;
                let gameData = {};
                try { gameData = JSON.parse(row.data) || {}; } catch { gameData = {}; }
                gameData.sort_order = i;
                await this._run('UPDATE game SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(gameData), row.id]);
            }
            await this._run('COMMIT');
            return { success: true, changes: gameIds.length };
        } catch (err) {
            await this._run('ROLLBACK').catch(() => {});
            console.error('ReorderGames error:', err);
            throw err;
        }
    }

    // ============================================================
    // GAME SCREENSHOTS
    // ============================================================

    async InsertGameScreenshot(data) {
        const sql = `
            INSERT INTO game_screenshots (game_id, path, caption, sort_order)
            VALUES (?, ?, ?, ?)
        `;
        const result = await this._run(sql, [
            data.game_id || 'main',
            data.path,
            data.caption || '',
            data.sort_order || 0
        ]);
        return { id: result.lastID };
    }

    async SelectGameScreenshots(gameId = 'main') {
        return await this._all(
            'SELECT * FROM game_screenshots WHERE game_id = ? ORDER BY sort_order',
            [gameId]
        );
    }

    async DeleteGameScreenshots(gameId = 'main') {
        const result = await this._run('DELETE FROM game_screenshots WHERE game_id = ?', [gameId]);
        return { changes: result.changes };
    }

    // ============================================================
    // DEVLOG
    // ============================================================

    async InsertDevlog(data) {
        const sql = `
            INSERT INTO devlog (game_id, title, content, date, visible)
            VALUES (?, ?, ?, ?, ?)
        `;
        const result = await this._run(sql, [
            data.game_id || 'main',
            data.title,
            data.content || '',
            data.date || new Date().toISOString().split('T')[0],
            data.visible !== false ? 1 : 0
        ]);
        return { id: result.lastID };
    }

    async SelectDevlog(gameId = 'main', visibleOnly = true) {
        // Also alias content AS body: admin.html's devlog editor and
        // games.html's public renderer both read/write `.body`, only the
        // DB column is `content`. Without the alias, re-opening a saved
        // entry in the admin panel shows an empty textarea.
        let sql = 'SELECT *, content AS body FROM devlog WHERE game_id = ? ORDER BY date DESC';
        const params = [gameId];
        if (visibleOnly) {
            sql = 'SELECT *, content AS body FROM devlog WHERE game_id = ? AND visible = 1 ORDER BY date DESC';
        }
        return await this._all(sql, params);
    }

    /**
     * Select all visible devlog entries across all games (used for global feeds).
     */
    async SelectAllVisibleDevlogEntries() {
        return await this._all(
            'SELECT * FROM devlog WHERE visible = 1 ORDER BY date DESC',
            []
        );
    }

    // ============================================================
    // ABOUT CRUD
    // ============================================================
    // ABOUT CRUD
    // ============================================================

    async InsertAbout(data) {
        const sql = `
            INSERT INTO about (id, studio_name, founded_date, description, email, social_links, tagline, portrait, description2, description3, universe_blurb)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                studio_name = excluded.studio_name,
                founded_date = excluded.founded_date,
                description = excluded.description,
                email = excluded.email,
                social_links = excluded.social_links,
                tagline = excluded.tagline,
                portrait = excluded.portrait,
                description2 = excluded.description2,
                description3 = excluded.description3,
                universe_blurb = excluded.universe_blurb,
                updated_at = CURRENT_TIMESTAMP
        `;
        await this._run(sql, [
            data.studio_name || data.studioName || '',
            data.founded_date || data.foundedDate || '',
            data.description || '',
            data.email || '',
            JSON.stringify(data.social_links || data.socialLinks || data.links || {}),
            data.tagline || '',
            data.portrait || '',
            data.description2 || '',
            data.description3 || '',
            data.universe_blurb || data.universeBlurb || ''
        ]);
        return { id: 1 };
    }

    async SelectAbout() {
        const row = await this._get('SELECT * FROM about WHERE id = 1', []);
        if (!row) return {};
        row.universeBlurb = row.universe_blurb || '';
        try {
            row.social_links = row.social_links ? JSON.parse(row.social_links) : {};
        } catch {
            row.social_links = {};
        }
        row.links = row.social_links; // admin.html / public pages use "links"
        return row;
    }

    // ============================================================
    // HOMEPAGE SETTINGS
    // ============================================================

    async SelectHomepageSettings() {
        const row = await this._get('SELECT * FROM homepage_settings WHERE id = 1');
        return row || {
            xanrean_bg: '/covers/homepage-cover-xanrean.webp',
            standalone_bg: '/covers/homepage-cover-standalone.webp',
            community_bg: '/covers/homepage-cover-community.webp'
        };
    }

    async UpdateHomepageSettings(data) {
        const sql = `
            INSERT INTO homepage_settings (id, xanrean_bg, standalone_bg, community_bg)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                xanrean_bg = excluded.xanrean_bg,
                standalone_bg = excluded.standalone_bg,
                community_bg = excluded.community_bg,
                updated_at = CURRENT_TIMESTAMP
        `;
        const params = [
            data.xanrean_bg || '/covers/homepage-cover-xanrean.webp',
            data.standalone_bg || '/covers/homepage-cover-standalone.webp',
            data.community_bg || '/covers/homepage-cover-community.webp'
        ];
        try {
            const result = await this._run(sql, params);
            return { success: true, changes: result.changes };
        } catch (err) {
            console.error('UpdateHomepageSettings error:', err);
            throw err;
        }
    }

    // XANREAN SETTINGS
    // ============================================================

    async SelectXanreanSettings() {
        const row = await this._get('SELECT * FROM xanrean_settings WHERE id = 1');
        return row || {
            books_bg: '/covers/xanrean-cover-books.webp',
            characters_bg: '/covers/xanrean-cover-characters.webp',
            lore_bg: '/covers/xanrean-cover-lore.webp',
            game_bg: '/covers/xanrean-cover-game.webp',
            gumroad_seller_id: null,
            gumroad_access_token: null,
            youtube_channel_id: null,
            discord_server_id: null,
            discord_invite_code: null
        };
    }

    async UpdateXanreanSettings(data) {
        const sql = `
            INSERT INTO xanrean_settings (id, books_bg, characters_bg, lore_bg, game_bg, gumroad_seller_id, gumroad_access_token, youtube_channel_id, discord_server_id, discord_invite_code)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                books_bg = excluded.books_bg,
                characters_bg = excluded.characters_bg,
                lore_bg = excluded.lore_bg,
                game_bg = excluded.game_bg,
                gumroad_seller_id = excluded.gumroad_seller_id,
                gumroad_access_token = excluded.gumroad_access_token,
                youtube_channel_id = excluded.youtube_channel_id,
                discord_server_id = excluded.discord_server_id,
                discord_invite_code = excluded.discord_invite_code,
                updated_at = CURRENT_TIMESTAMP
        `;
        const params = [
            data.books_bg || '/covers/xanrean-cover-books.webp',
            data.characters_bg || '/covers/xanrean-cover-characters.webp',
            data.lore_bg || '/covers/xanrean-cover-lore.webp',
            data.game_bg || '/covers/xanrean-cover-game.webp',
            data.gumroad_seller_id || null,
            data.gumroad_access_token || null,
            data.youtube_channel_id || null,
            data.discord_server_id || null,
            data.discord_invite_code || null
        ];
        try {
            const result = await this._run(sql, params);
            return { success: true, changes: result.changes };
        } catch (err) {
            console.error('UpdateXanreanSettings error:', err);
            throw err;
        }
    }

    async UpdateBookSequence(seriesId, bookIds) {
        const operation = this.operationQueue.then(() => this._updateBookSequence(seriesId, bookIds));
        this.operationQueue = operation.catch(() => {});
        return operation;
    }

    async _updateBookSequence(seriesId, bookIds) {
        if (!bookIds || !Array.isArray(bookIds)) return { success: false, error: 'Invalid book IDs' };

        try {
            await this._run('BEGIN TRANSACTION');
            for (let i = 0; i < bookIds.length; i++) {
                const sql = seriesId
                    ? 'UPDATE books SET volume_number = ? WHERE id = ? AND series_id = ?'
                    : 'UPDATE books SET volume_number = ? WHERE id = ? AND series_id IS NULL';

                const params = seriesId ? [i + 1, bookIds[i], seriesId] : [i + 1, bookIds[i]];
                await this._run(sql, params);
            }
            await this._run('COMMIT');
            return { success: true, changes: bookIds.length };
        } catch (err) {
            await this._run('ROLLBACK').catch(() => {});
            console.error('UpdateBookSequence error:', err);
            throw err;
        }
    }

    async InsertSale(data) {
        const sql = `
            INSERT INTO sales (id, gumroad_sale_id, product_name, price_cents, currency, recurrence, email, seller_id, is_test, purchased_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(gumroad_sale_id) DO NOTHING
        `;
        const result = await this._run(sql, [
            data.id || crypto.randomUUID(),
            data.sale_id,
            data.product_name,
            data.price,
            data.currency,
            data.recurrence,
            data.email,
            data.seller_id,
            data.is_test,
            data.purchased_at
        ]);
        return { id: data.id, changes: result.changes };
    }

    async SelectRecentSales(limit = 25) {
        return await this._all(
            'SELECT * FROM sales WHERE is_test = 0 ORDER BY purchased_at DESC LIMIT ?',
            [limit]
        );
    }

    async SelectAllSales() {
        return await this._all('SELECT * FROM sales ORDER BY purchased_at DESC');
    }

    // ============================================================
    // CHARACTERS CRUD
    // ============================================================

    async InsertCharacter(data) {
        if (!data || !data.id || !/^[a-zA-Z0-9_-]{1,64}$/.test(String(data.id))) {
            throw new Error('Character ID is required and must be URL-safe');
        }
        const sql = `
            INSERT INTO characters (id, slug, name, title, char_type, species, emoji, content, image, sort_order, visible, relationships, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                slug = excluded.slug,
                name = excluded.name,
                title = excluded.title,
                char_type = excluded.char_type,
                species = excluded.species,
                emoji = excluded.emoji,
                content = excluded.content,
                image = excluded.image,
                sort_order = excluded.sort_order,
                visible = excluded.visible,
                relationships = excluded.relationships,
                updated_at = CURRENT_TIMESTAMP
        `;
        const result = await this._run(sql, [
            data.id,
            data.slug,
            data.name,
            data.title || null,
            data.char_type,
            data.species || null,
            data.emoji || '',
            data.content,
            data.image || null,
            data.sort_order || 0,
            data.visible !== false ? 1 : 0,
            JSON.stringify(data.relationships || [])
        ]);
        return { id: data.id, changes: result.changes };
    }

    async SelectCharacters() {
        const rows = await this._all('SELECT * FROM characters ORDER BY sort_order, name');
        for (const row of rows) {
            try {
                row.relationships = row.relationships ? JSON.parse(row.relationships) : [];
            } catch {
                row.relationships = [];
            }
            row.appearances = await this.SelectCharacterAppearances(row.id);
        }
        return rows;
    }

    async SelectCharacterBySlug(slug) {
        const row = await this._get('SELECT * FROM characters WHERE slug = ?', [slug]);
        if (row) {
            try {
                row.relationships = row.relationships ? JSON.parse(row.relationships) : [];
            } catch {
                row.relationships = [];
            }
            row.appearances = await this.SelectCharacterAppearances(row.id);
        }
        return row;
    }

    async DeleteCharacter(id) {
        const result = await this._run('DELETE FROM characters WHERE id = ?', [id]);
        return { changes: result.changes };
    }

    // ============================================================
    // CHARACTER APPEARANCES (character <-> series links)
    // ============================================================

    async SelectCharacterAppearances(characterId) {
        return await this._all(
            'SELECT * FROM character_appearances WHERE character_id = ? ORDER BY is_home DESC, sort_order',
            [characterId]
        );
    }

    async ReplaceCharacterAppearances(characterId, appearances) {
        await this._run('BEGIN TRANSACTION');
        try {
            await this._run('DELETE FROM character_appearances WHERE character_id = ?', [characterId]);
            for (let i = 0; i < (appearances || []).length; i++) {
                const a = appearances[i];
                if (!a.series_id) continue;
                await this._run(
                    `INSERT INTO character_appearances (character_id, series_id, cast_group, is_home, sort_order)
                     VALUES (?, ?, ?, ?, ?)`,
                    [characterId, a.series_id, a.cast_group || null, a.is_home ? 1 : 0, i]
                );
            }
            await this._run('COMMIT');
        } catch (err) {
            await this._run('ROLLBACK').catch(() => {});
            throw err;
        }
        return await this.SelectCharacterAppearances(characterId);
    }

    // ============================================================
    // TIMELINE EVENTS CRUD
    // ============================================================

    async InsertTimelineEvent(data) {
        const sql = `
            INSERT INTO timeline_events (id, title, era, description, related_character_slugs, related_book_id, sort_order, visible, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                era = excluded.era,
                description = excluded.description,
                related_character_slugs = excluded.related_character_slugs,
                related_book_id = excluded.related_book_id,
                sort_order = excluded.sort_order,
                visible = excluded.visible,
                updated_at = CURRENT_TIMESTAMP
        `;
        const result = await this._run(sql, [
            data.id,
            data.title,
            data.era || null,
            data.description || '',
            JSON.stringify(data.related_character_slugs || []),
            data.related_book_id || null,
            data.sort_order || 0,
            data.visible !== false ? 1 : 0
        ]);
        return { id: data.id, changes: result.changes };
    }

    async SelectTimelineEvents(whereClause = '', params = []) {
        let sql = 'SELECT * FROM timeline_events ORDER BY sort_order, created_at';
        if (whereClause) {
            sql = `SELECT * FROM timeline_events WHERE ${whereClause} ORDER BY sort_order, created_at`;
        }
        const rows = await this._all(sql, params);
        for (const row of rows) {
            try {
                row.related_character_slugs = row.related_character_slugs ? JSON.parse(row.related_character_slugs) : [];
            } catch {
                row.related_character_slugs = [];
            }
        }
        return rows;
    }

    async SelectTimelineEventById(id) {
        const row = await this._get('SELECT * FROM timeline_events WHERE id = ?', [id]);
        if (row) {
            try {
                row.related_character_slugs = row.related_character_slugs ? JSON.parse(row.related_character_slugs) : [];
            } catch {
                row.related_character_slugs = [];
            }
        }
        return row;
    }

    async DeleteTimelineEvent(id) {
        const result = await this._run('DELETE FROM timeline_events WHERE id = ?', [id]);
        return { changes: result.changes };
    }

    async UpdateCharacterRelationships(slug, relationships) {
        const result = await this._run(
            'UPDATE characters SET relationships = ? WHERE slug = ?',
            [JSON.stringify(relationships), slug]
        );
        return { changes: result.changes };
    }

    // ============================================================

    async InsertLoreTopic(data) {
        if (!data || !data.id || !/^[a-zA-Z0-9_-]{1,64}$/.test(String(data.id))) {
            throw new Error('Lore topic ID is required and must be URL-safe');
        }
        const sql = `
            INSERT INTO lore_topics (id, slug, section, title, content, sort_order, visible, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                slug = excluded.slug,
                section = excluded.section,
                title = excluded.title,
                content = excluded.content,
                sort_order = excluded.sort_order,
                visible = excluded.visible,
                updated_at = CURRENT_TIMESTAMP
        `;
        const result = await this._run(sql, [
            data.id,
            data.slug,
            data.section,
            data.title,
            data.content,
            data.sort_order || 0,
            data.visible !== false ? 1 : 0
        ]);
        return { id: data.id, changes: result.changes };
    }

    async SelectLoreTopics(section = null) {
        const sql = section === null
            ? 'SELECT * FROM lore_topics ORDER BY sort_order, title'
            : 'SELECT * FROM lore_topics WHERE section = ? ORDER BY sort_order, title';
        return await this._all(sql, section === null ? [] : [section]);
    }

    async SelectLoreTopicBySlug(slug) {
        return await this._get('SELECT * FROM lore_topics WHERE slug = ?', [slug]);
    }

    async DeleteLoreTopic(id) {
        const result = await this._run('DELETE FROM lore_topics WHERE id = ?', [id]);
        return { changes: result.changes };
    }

    async InsertSubscriber(email, source = 'website') {
        try {
            const sql = `
                INSERT INTO subscribers (email, source)
                VALUES (?, ?)
                ON CONFLICT(email) DO UPDATE SET
                    active = 1,
                    subscribed_at = CURRENT_TIMESTAMP
            `;
            await this._run(sql, [email, source]);
            return { success: true, email };
        } catch (err) {
            console.error('Failed to insert subscriber:', err);
            return { success: false, error: err.message };
        }
    }

    async SelectSubscribers(activeOnly = true) {
        let sql = 'SELECT * FROM subscribers';
        const params = [];
        if (activeOnly) {
            sql += ' WHERE active = 1';
        }
        sql += ' ORDER BY subscribed_at DESC';
        return await this._all(sql, params);
    }

    async Unsubscribe(email) {
        const result = await this._run(
            'UPDATE subscribers SET active = 0 WHERE email = ?',
            [email]
        );
        return { changes: result.changes };
    }

    async DeleteSubscriber(email) {
        const result = await this._run(
            'DELETE FROM subscribers WHERE email = ?',
            [email]
        );
        return { changes: result.changes };
    }

    // ============================================================
    // BULK OPERATIONS
    // ============================================================

    async GetAllContent() {
        const [series, books, games, about, homepage] = await Promise.all([
            this.SelectSeries(),
            this.SelectBooks(),
            this.SelectGames(),
            this.SelectAbout(),
            this.SelectHomepageSettings()
        ]);

        const seriesWithCounts = (series || []).map(s => {
            const totalWords = books
                .filter(b => b.series_id === s.id)
                .reduce((sum, b) => sum + (b.wordCount || 0), 0);
            return { ...s, totalWordCount: totalWords };
        });

        return {
            series: seriesWithCounts,
            books: books || [],
            game: games || [],
            about: about || {},
            homepage: homepage || {}
        };
    }

    async SaveAllContent(data) {
        const operation = this.operationQueue.then(() => this._saveAllContent(data));
        this.operationQueue = operation.catch(() => {});
        return operation;
    }

    async _saveAllContent(data) {
        const { series = [], books = [], game = [], about = {} } = data;

        // Prevent duplicate slugs within the book set.
        const seenSlugs = new Set();
        for (const b of books) {
            const slug = b.slug || b.id;
            if (slug) {
                if (seenSlugs.has(slug)) {
                    const err = new Error(`Duplicate book slug detected: "${slug}" is used by multiple books.`);
                    err.code = 'DUPLICATE_SLUG';
                    throw err;
                }
                seenSlugs.add(slug);
            }
        }


        // Guard against wiping the site: /save-content does a full delete-and-
        // reinsert, so a client that sends an empty payload (e.g. because its
        // initial /content fetch silently failed) would otherwise erase every
        // book, series, game, and about record with no warning. If the incoming
        // payload is completely empty but the DB currently has real content,
        // this is almost certainly a broken client state, not an intentional
        // full wipe, so refuse it instead of committing the loss.
        const incomingHasContent =
            series.length > 0 || books.length > 0 ||
            (Array.isArray(game) ? game.length > 0 : !!(game && Object.keys(game).length > 0)) ||
            Object.keys(about).length > 0;

        if (!incomingHasContent) {
            const existing = await this._get(`
                SELECT
                    (SELECT COUNT(*) FROM series) AS seriesCount,
                    (SELECT COUNT(*) FROM books) AS booksCount,
                    (SELECT COUNT(*) FROM game) AS gameCount,
                    (SELECT COUNT(*) FROM about) AS aboutCount
            `);
            const hasExistingContent = existing && (
                existing.seriesCount > 0 || existing.booksCount > 0 ||
                existing.gameCount > 0 || existing.aboutCount > 0
            );
            if (hasExistingContent) {
                const err = new Error(
                    'Refusing to save: incoming content has no series, books, game, or ' +
                    'about data, but the database currently has content. This looks like ' +
                    'a failed page load rather than an intentional full wipe. Reload the ' +
                    'admin panel and try again.'
                );
                err.code = 'EMPTY_CONTENT_GUARD';
                throw err;
            }
        }

        await this._run('BEGIN TRANSACTION');
        try {
            // Clear existing data
            await this._run('DELETE FROM book_platforms');
            await this._run('DELETE FROM books');
            await this._run('DELETE FROM series');
            await this._run('DELETE FROM game_screenshots');
            await this._run('DELETE FROM devlog');
            await this._run('DELETE FROM game');
            await this._run('DELETE FROM about');

            // Insert series
            for (let i = 0; i < series.length; i++) {
                const s = series[i];
                // Pass both the raw DB field names and the UI-facing aliases
                // through unresolved. InsertSeries owns the precedence
                // between them (universe/universeDesc wins) so there's one
                // place, not two, that has to get the fallback order right.
                await this.InsertSeries({
                    id: s.id,
                    name: s.name,
                    universe: s.universe,
                    description: s.description,
                    universeDesc: s.universeDesc,
                    sort_order: s.sort_order || i,
                    cover_image: s.cover_image,
                    status: s.status,
                    word_count: s.word_count,
                    reading_order: s.reading_order
                });
            }

            // Insert books
            for (const b of books) {
                await this.InsertBook({
                    id: b.id,
                    title: b.title,
                    slug: b.slug || b.id,
                    description: b.description || '',
                    blurb: b.blurb || '',
                    volume: b.volume || b.volume_info || '',
                    status: b.status || 'draft',
                    seriesId: b.seriesId || b.series_id,
                    volumeNumber: b.volumeNumber || b.volume_number,
                    wordCount: b.wordCount || b.word_count || 0,
                    cover: b.cover || b.cover_path,
                    visible: b.visible !== false,
                    genres: b.genres || [],
                    tags: b.tags || [],
                    tier: b.tier,
                    ctaPlatform: b.ctaPlatform || b.cta_platform,
                    publishAt: b.publishAt || b.publish_at || null,
                    platforms: (b.platforms || b.links || []).map(p => ({
                        type: p.type || p.platform_type,
                        name: p.name || p.platform_name,
                        url: p.url
                    }))
                });
            }

            // Insert games - support array
            const games = Array.isArray(game) ? game : (game ? [game] : []);
            for (const g of games) {
                if (g && Object.keys(g).length > 0) {
                    const gameId = g.id || g.slug || 'main';
                    await this.InsertGame({
                        ...g,
                        id: gameId
                    });

                    // Screenshots
                    const screenshots = g.screenshots || [];
                    for (let i = 0; i < screenshots.length; i++) {
                        const ss = screenshots[i];
                        await this.InsertGameScreenshot({
                            game_id: gameId,
                            path: typeof ss === 'string' ? ss : ss.path,
                            caption: typeof ss === 'string' ? '' : (ss.caption || ''),
                            sort_order: i
                        });
                    }

                    // Devlog
                    const devlog = g.devlog || [];
                    for (const d of devlog) {
                        await this.InsertDevlog({
                            game_id: gameId,
                            title: d.title,
                            // admin.html's editor and games.html's public
                            // renderer both use `body`; only the DB column
                            // itself is named `content`. Reading d.content
                            // here silently discarded every devlog entry's
                            // text on save.
                             content: d.body ?? d.content ?? '',
                            date: d.date || d.created_at,
                            visible: d.visible !== false
                        });
                    }
                }
            }

            // Insert about
            if (about && Object.keys(about).length > 0) {
                await this.InsertAbout({
                    studioName: about.studio_name || about.studioName,
                    foundedDate: about.founded_date || about.foundedDate,
                    description: about.description || '',
                    email: about.email || '',
                    socialLinks: about.social_links || about.socialLinks || about.links || {},
                    tagline: about.tagline || '',
                    portrait: about.portrait || '',
                    description2: about.description2 || '',
                    description3: about.description3 || '',
                    universeBlurb: about.universe_blurb || about.universeBlurb || ''
                });
            }

            await this._run('COMMIT');
            console.log('ContentDB: All data saved');
        } catch (err) {
            await this._run('ROLLBACK').catch(() => {});
            console.error('ContentDB: SaveAllContent failed, rolled back:', err);
            throw err;
        }
    }
}

// Singleton instance
const contentDB = new ContentDB();

module.exports = contentDB;
