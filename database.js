/**
 * database.js - SQLite module for Nekojin Interactive
 * Pattern matches your Godot AccountDB/SoulBlueprintDB structure
 * Uses Node.js sqlite3 package (similar to Godot's SQLite addon)
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const os = require('os');

// Database location - single file like your Godot project
const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'nekojin.db');

/**
 * ContentDB - Manages books, series, game, and about data
 * Similar to your AccountDB class in Godot
 */
class ContentDB {
    constructor() {
        this.db = null;
        this.isOpen = false;
        this.initPromise = null;
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
        // Ensure directory exists
        if (!fs.existsSync(DB_DIR)) {
            fs.mkdirSync(DB_DIR, { recursive: true });
        }

        // Open database
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

        // Enable foreign keys
        await this._run('PRAGMA foreign_keys = ON');
        this.isOpen = true;

        // Create tables
        await this._CreateTables();
        console.log('ContentDB: Tables created');
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
                xanrean_bg TEXT DEFAULT '/covers/sb-cover.png',
                standalone_bg TEXT DEFAULT '/covers/book-1776403239514-1778880332704.jpg',
                community_bg TEXT DEFAULT '/images/tama-bg.png',
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
            await this._run('ALTER TABLE homepage_settings ADD COLUMN community_bg TEXT DEFAULT \'/images/tama-bg.png\'');
        }
        await this._run('CREATE INDEX IF NOT EXISTS idx_books_series ON books(series_id)');
        await this._run('CREATE INDEX IF NOT EXISTS idx_books_status ON books(status)');
        await this._run('CREATE INDEX IF NOT EXISTS idx_books_visible ON books(visible)');
        await this._run('CREATE INDEX IF NOT EXISTS idx_platforms_book ON book_platforms(book_id)');
    }

    /**
     * Close the database connection
     * Similar to your Close(path) method
     */
    async Close() {
        if (!this.db || !this.isOpen) return;
        this.isOpen = false;
        await new Promise((resolve) => {
            this.db.close((err) => {
                if (err) console.error('Error closing database:', err);
                else console.log('ContentDB: Closed');
                this.initPromise = null;
                resolve();
            });
        });
    }

    // ============================================================
    // SERIES CRUD
    // ============================================================

    async InsertSeries(data) {
        const sql = `
            INSERT INTO series (id, name, description, sort_order)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                sort_order = excluded.sort_order,
                updated_at = CURRENT_TIMESTAMP
        `;
        const result = await this._run(sql, [
            data.id,
            data.name || data.title || '',
            data.description || '',
            data.sort_order || 0
        ]);
        return { id: data.id, changes: result.changes };
    }

    async SelectSeries(whereClause = '', params = []) {
        let sql = 'SELECT * FROM series ORDER BY sort_order, name';
        if (whereClause) {
            sql = `SELECT * FROM series WHERE ${whereClause} ORDER BY sort_order, name`;
        }
        return await this._all(sql, params);
    }

    async DeleteSeries(id) {
        const result = await this._run('DELETE FROM series WHERE id = ?', [id]);
        return { changes: result.changes };
    }

    // ============================================================
    // BOOKS CRUD
    // ============================================================

    async InsertBook(data) {
        const sql = `
            INSERT INTO books (
                id, title, slug, description, blurb, volume, status, series_id,
                volume_number, word_count, cover_path, visible, genres, tags
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                updated_at = CURRENT_TIMESTAMP
        `;

        await this._run(sql, [
            data.id,
            data.title,
            data.slug,
            data.description || '',
            data.blurb || '',
            data.volume || '',
            data.status || 'draft',
            data.seriesId || data.series_id || null,
            data.volumeNumber || data.volume_number || null,
            data.wordCount || data.word_count || 0,
            data.cover || data.cover_path || null,
            data.visible !== false ? 1 : 0,
            JSON.stringify(data.genres || []),
            JSON.stringify(data.tags || [])
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

    async SelectBooks(whereClause = '', params = []) {
        let sql = 'SELECT * FROM books ORDER BY series_id, volume_number, title';
        if (whereClause) {
            sql = `SELECT * FROM books WHERE ${whereClause} ORDER BY series_id, volume_number, title`;
        }
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

            // Map database fields to expected API format
            row.cover = row.cover_path;
            row.volume = row.volume || '';
            row.ctaPlatform = 'kdp'; // Default, not stored in DB
            
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

    async SelectGame() {
        const row = await this._get('SELECT * FROM game WHERE id = ?', ['main']);
        if (!row) return null;

        // Parse the stored JSON data
        let gameData = {};
        if (row.data) {
            try {
                gameData = JSON.parse(row.data);
            } catch {
                gameData = {};
            }
        }

        // Ensure title is present
        gameData.title = gameData.title || row.title;

        // Load related data
        gameData.screenshots = await this.SelectGameScreenshots(row.id);
        gameData.devlog = await this.SelectDevlog(row.id);

        return gameData;
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

            // Load related data for this game
            gameData.screenshots = await this.SelectGameScreenshots(row.id);
            gameData.devlog = await this.SelectDevlog(row.id);

            games.push(gameData);
        }

        return games;
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
        let sql = 'SELECT * FROM devlog WHERE game_id = ? ORDER BY date DESC';
        const params = [gameId];
        if (visibleOnly) {
            sql = 'SELECT * FROM devlog WHERE game_id = ? AND visible = 1 ORDER BY date DESC';
        }
        return await this._all(sql, params);
    }

    // ============================================================
    // ABOUT CRUD
    // ============================================================

    async InsertAbout(data) {
        const sql = `
            INSERT INTO about (id, studio_name, founded_date, description, email, social_links)
            VALUES (1, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                studio_name = excluded.studio_name,
                founded_date = excluded.founded_date,
                description = excluded.description,
                email = excluded.email,
                social_links = excluded.social_links,
                updated_at = CURRENT_TIMESTAMP
        `;
        await this._run(sql, [
            data.studio_name || data.studioName || '',
            data.founded_date || data.foundedDate || '',
            data.description || '',
            data.email || '',
            JSON.stringify(data.social_links || data.socialLinks || {})
        ]);
        return { id: 1 };
    }

    async SelectAbout() {
        const row = await this._get('SELECT * FROM about WHERE id = 1', []);
        if (row && row.social_links) {
            try {
                row.social_links = JSON.parse(row.social_links);
            } catch {
                row.social_links = {};
            }
        }
        return row || {};
    }

    // ============================================================
    // HOMEPAGE SETTINGS
    // ============================================================

    async SelectHomepageSettings() {
        const row = await this._get('SELECT * FROM homepage_settings WHERE id = 1');
        return row || {
            xanrean_bg: '/covers/sb-cover.png',
            standalone_bg: '/covers/book-1776403239514-1778880332704.jpg',
            community_bg: '/images/tama-bg.png'
        };
    }

    async UpdateHomepageSettings(data) {
        console.log('>>> DB UpdateHomepageSettings called with:', data);
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
            data.xanrean_bg || '/covers/sb-cover.png',
            data.standalone_bg || '/covers/book-1776403239514-1778880332704.jpg',
            data.community_bg || '/images/tama-bg.png'
        ];
        console.log('>>> DB SQL:', sql);
        console.log('>>> DB params:', params);
        try {
            const result = await this._run(sql, params);
            console.log('>>> DB _run result:', result);
            // Verify the update
            const verify = await this._get('SELECT * FROM homepage_settings WHERE id = 1');
            console.log('>>> DB verification:', verify);
            return { success: true, changes: result.changes };
        } catch (err) {
            console.error('>>> DB ERROR:', err);
            throw err;
        }
    }

    // ============================================================
    // NEWSLETTER SUBSCRIBERS
    // ============================================================

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

        return {
            series: series || [],
            books: books || [],
            game: games || [],
            about: about || {},
            homepage: homepage || {}
        };
    }

    async SaveAllContent(data) {
        const { series = [], books = [], game = [], about = {} } = data;

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
            await this.InsertSeries({
                id: s.id,
                name: s.name || s.title,
                description: s.description || '',
                sort_order: s.sort_order || i
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
                        content: d.content || '',
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
                socialLinks: about.social_links || about.socialLinks || {}
            });
        }

        console.log('ContentDB: All data saved');
    }
}

// Singleton instance
const contentDB = new ContentDB();

module.exports = contentDB;
