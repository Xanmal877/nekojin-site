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
const DB_DIR = path.join(os.homedir(), 'Documents', 'nekojin-data');
const DB_PATH = path.join(DB_DIR, 'nekojin.db');

/**
 * ContentDB - Manages books, series, game, and about data
 * Similar to your AccountDB class in Godot
 */
class ContentDB {
    constructor() {
        this.db = null;
        this.isOpen = false;
    }

    /**
     * Open the database connection
     * Similar to your Open(path) method
     */
    Open() {
        if (this.isOpen) return;

        // Ensure directory exists
        if (!fs.existsSync(DB_DIR)) {
            fs.mkdirSync(DB_DIR, { recursive: true });
        }

        this.db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Failed to open database:', err);
                throw err;
            }
            console.log('ContentDB: Connected to', DB_PATH);
        });

        // Enable foreign keys (like your foreign_keys = false/true)
        this.db.run('PRAGMA foreign_keys = ON');
        this.isOpen = true;

        // Auto-initialize tables
        this._CreateTables();
    }

    /**
     * Close the database connection
     * Similar to your Close(path) method
     */
    Close() {
        if (!this.db) return;
        return new Promise((resolve) => {
            this.db.close((err) => {
                if (err) console.error('Error closing database:', err);
                else console.log('ContentDB: Closed');
                this.isOpen = false;
                resolve();
            });
        });
    }

    /**
     * Create all tables
     * Similar to your _CreateTables() method
     */
    _CreateTables() {
        // Series table (like your accounts table)
        this.db.run(`
            CREATE TABLE IF NOT EXISTS series (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Books table (complex data like your account_souls)
        this.db.run(`
            CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                slug TEXT UNIQUE NOT NULL,
                description TEXT,
                blurb TEXT,
                status TEXT DEFAULT 'draft',
                series_id TEXT,
                volume_number INTEGER,
                word_count INTEGER DEFAULT 0,
                cover_path TEXT,
                visible BOOLEAN DEFAULT 1,
                genres TEXT, -- JSON array
                tags TEXT,   -- JSON array
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE SET NULL
            )
        `);

        // Book platforms (like account_souls linking table)
        this.db.run(`
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

        // Game info (singleton like your game data)
        this.db.run(`
            CREATE TABLE IF NOT EXISTS game (
                id TEXT PRIMARY KEY DEFAULT 'main',
                title TEXT NOT NULL,
                slug TEXT UNIQUE DEFAULT 'current-project',
                description TEXT,
                status TEXT DEFAULT 'in_development',
                cover_path TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Game screenshots
        this.db.run(`
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
        this.db.run(`
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

        // About/studio info (singleton)
        this.db.run(`
            CREATE TABLE IF NOT EXISTS about (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                studio_name TEXT,
                founded_date TEXT,
                description TEXT,
                email TEXT,
                social_links TEXT, -- JSON object
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes for performance
        this.db.run('CREATE INDEX IF NOT EXISTS idx_books_series ON books(series_id)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_books_status ON books(status)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_books_visible ON books(visible)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_platforms_book ON book_platforms(book_id)');

        console.log('ContentDB: Tables created');
    }

    // ============================================================
    // SERIES CRUD (similar to your accounts CRUD)
    // ============================================================

    InsertSeries(data) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO series (id, name, description, sort_order)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    sort_order = excluded.sort_order,
                    updated_at = CURRENT_TIMESTAMP
            `;
            this.db.run(sql, [
                data.id,
                data.name || data.title || '',
                data.description || '',
                data.sort_order || 0
            ], function(err) {
                if (err) reject(err);
                else resolve({ id: data.id, changes: this.changes });
            });
        });
    }

    SelectSeries(whereClause = '', params = []) {
        return new Promise((resolve, reject) => {
            let sql = 'SELECT * FROM series ORDER BY sort_order, name';
            if (whereClause) {
                sql = `SELECT * FROM series WHERE ${whereClause} ORDER BY sort_order, name`;
            }
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    DeleteSeries(id) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM series WHERE id = ?', [id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    // ============================================================
    // BOOKS CRUD (complex like your soul/account link tables)
    // ============================================================

    InsertBook(data) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO books (
                    id, title, slug, description, blurb, status, series_id,
                    volume_number, word_count, cover_path, visible, genres, tags
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    slug = excluded.slug,
                    description = excluded.description,
                    blurb = excluded.blurb,
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

            this.db.run(sql, [
                data.id,
                data.title,
                data.slug,
                data.description || '',
                data.blurb || '',
                data.status || 'draft',
                data.seriesId || data.series_id || null,
                data.volumeNumber || data.volume_number || null,
                data.wordCount || data.word_count || 0,
                data.cover || data.cover_path || null,
                data.visible !== false ? 1 : 0,
                JSON.stringify(data.genres || []),
                JSON.stringify(data.tags || [])
            ], function(err) {
                if (err) reject(err);
                else resolve({ id: data.id, changes: this.changes });
            });
        });
    }

    SelectBooks(whereClause = '', params = []) {
        return new Promise((resolve, reject) => {
            let sql = 'SELECT * FROM books ORDER BY series_id, volume_number, title';
            if (whereClause) {
                sql = `SELECT * FROM books WHERE ${whereClause} ORDER BY series_id, volume_number, title`;
            }
            this.db.all(sql, params, async (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Parse JSON fields and load platforms for each book
                const books = [];
                for (const row of rows || []) {
                    try {
                        row.genres = row.genres ? JSON.parse(row.genres) : [];
                        row.tags = row.tags ? JSON.parse(row.tags) : [];
                    } catch {
                        row.genres = [];
                        row.tags = [];
                    }
                    row.visible = !!row.visible;
                    row.wordCount = row.word_count;

                    // Load platforms (like your GetAccountSouls)
                    row.platforms = await this.SelectBookPlatforms(row.id);
                    books.push(row);
                }
                resolve(books);
            });
        });
    }

    DeleteBook(id) {
        return new Promise((resolve, reject) => {
            // Platforms delete automatically via CASCADE
            this.db.run('DELETE FROM books WHERE id = ?', [id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    // ============================================================
    // BOOK PLATFORMS (like account_souls linking table)
    // ============================================================

    InsertBookPlatform(data) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO book_platforms (book_id, platform_type, platform_name, url, sort_order)
                VALUES (?, ?, ?, ?, ?)
            `;
            this.db.run(sql, [
                data.book_id,
                data.platform_type || data.type,
                data.platform_name || data.name,
                data.url,
                data.sort_order || 0
            ], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    SelectBookPlatforms(bookId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM book_platforms WHERE book_id = ? ORDER BY sort_order',
                [bookId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    DeleteBookPlatforms(bookId) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM book_platforms WHERE book_id = ?', [bookId], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    // ============================================================
    // GAME CRUD (singleton, like your main game data)
    // ============================================================

    InsertGame(data) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO game (id, title, slug, description, status, cover_path)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    slug = excluded.slug,
                    description = excluded.description,
                    status = excluded.status,
                    cover_path = excluded.cover_path,
                    updated_at = CURRENT_TIMESTAMP
            `;
            this.db.run(sql, [
                data.id || 'main',
                data.title || 'Untitled',
                data.slug || 'current-project',
                data.description || '',
                data.status || 'in_development',
                data.cover || data.cover_path || null
            ], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    SelectGame() {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM game WHERE id = ?', ['main'], async (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (!row) {
                    resolve(null);
                    return;
                }

                // Load related data
                row.screenshots = await this.SelectGameScreenshots();
                row.devlog = await this.SelectDevlog();
                resolve(row);
            });
        });
    }

    // ============================================================
    // GAME SCREENSHOTS
    // ============================================================

    InsertGameScreenshot(data) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO game_screenshots (game_id, path, caption, sort_order)
                VALUES (?, ?, ?, ?)
            `;
            this.db.run(sql, [
                data.game_id || 'main',
                data.path,
                data.caption || '',
                data.sort_order || 0
            ], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            });
        });
    }

    SelectGameScreenshots() {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM game_screenshots WHERE game_id = ? ORDER BY sort_order',
                ['main'],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    DeleteGameScreenshots() {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM game_screenshots WHERE game_id = ?', ['main'], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    // ============================================================
    // DEVLOG
    // ============================================================

    InsertDevlog(data) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO devlog (game_id, title, content, date, visible)
                VALUES (?, ?, ?, ?, ?)
            `;
            this.db.run(sql, [
                data.game_id || 'main',
                data.title,
                data.content || '',
                data.date || new Date().toISOString().split('T')[0],
                data.visible !== false ? 1 : 0
            ], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            });
        });
    }

    SelectDevlog(visibleOnly = true) {
        return new Promise((resolve, reject) => {
            let sql = 'SELECT * FROM devlog WHERE game_id = ? ORDER BY date DESC';
            const params = ['main'];
            if (visibleOnly) {
                sql = 'SELECT * FROM devlog WHERE game_id = ? AND visible = 1 ORDER BY date DESC';
            }
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // ============================================================
    // ABOUT CRUD
    // ============================================================

    InsertAbout(data) {
        return new Promise((resolve, reject) => {
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
            this.db.run(sql, [
                data.studio_name || data.studioName || '',
                data.founded_date || data.foundedDate || '',
                data.description || '',
                data.email || '',
                JSON.stringify(data.social_links || data.socialLinks || {})
            ], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    SelectAbout() {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM about WHERE id = 1', [], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (row && row.social_links) {
                    try {
                        row.social_links = JSON.parse(row.social_links);
                    } catch {
                        row.social_links = {};
                    }
                }
                resolve(row || {});
            });
        });
    }

    // ============================================================
    // BULK OPERATIONS (for API compatibility)
    // ============================================================

    /**
     * Get all content in one call (matches your old JSON API)
     * Similar to loading all your game data at once
     */
    async GetAllContent() {
        const [series, books, game, about] = await Promise.all([
            this.SelectSeries(),
            this.SelectBooks(),
            this.SelectGame(),
            this.SelectAbout()
        ]);

        return {
            series: series || [],
            books: books || [],
            game: game || {},
            about: about || {}
        };
    }

    /**
     * Save all content (transaction-safe)
     * Similar to your SaveGame() in Godot
     */
    async SaveAllContent(data) {
        const { series = [], books = [], game = {}, about = {} } = data;

        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');

                // Clear existing data (like resetting your dictionaries)
                this.db.run('DELETE FROM book_platforms');
                this.db.run('DELETE FROM books');
                this.db.run('DELETE FROM series');
                this.db.run('DELETE FROM game_screenshots');
                this.db.run('DELETE FROM devlog');
                this.db.run('DELETE FROM game');
                this.db.run('DELETE FROM about');

                // Insert series
                const seriesStmt = this.db.prepare(`
                    INSERT INTO series (id, name, description, sort_order)
                    VALUES (?, ?, ?, ?)
                `);
                series.forEach((s, i) => {
                    seriesStmt.run(s.id, s.name || s.title, s.description || '', s.sort_order || i);
                });
                seriesStmt.finalize();

                // Insert books
                const bookStmt = this.db.prepare(`
                    INSERT INTO books (id, title, slug, description, blurb, status, series_id,
                        volume_number, word_count, cover_path, visible, genres, tags)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                books.forEach(b => {
                    bookStmt.run(
                        b.id,
                        b.title,
                        b.slug,
                        b.description || '',
                        b.blurb || '',
                        b.status || 'draft',
                        b.seriesId || b.series_id || null,
                        b.volume_number || b.volumeNumber || null,
                        b.word_count || b.wordCount || 0,
                        b.cover || b.cover_path || null,
                        b.visible !== false ? 1 : 0,
                        JSON.stringify(b.genres || []),
                        JSON.stringify(b.tags || [])
                    );
                });
                bookStmt.finalize();

                // Insert platforms
                const platStmt = this.db.prepare(`
                    INSERT INTO book_platforms (book_id, platform_type, platform_name, url, sort_order)
                    VALUES (?, ?, ?, ?, ?)
                `);
                books.forEach(b => {
                    const platforms = b.platforms || b.links || [];
                    platforms.forEach((p, i) => {
                        platStmt.run(
                            b.id,
                            p.type || p.platform_type,
                            p.name || p.platform_name,
                            p.url,
                            i
                        );
                    });
                });
                platStmt.finalize();

                // Insert game
                if (game && Object.keys(game).length > 0) {
                    this.db.run(`
                        INSERT INTO game (id, title, slug, description, status, cover_path)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [
                        'main',
                        game.title || 'Untitled',
                        game.slug || 'current-project',
                        game.description || '',
                        game.status || 'in_development',
                        game.cover || null
                    ]);

                    // Screenshots
                    const screenshots = game.screenshots || [];
                    const ssStmt = this.db.prepare(`
                        INSERT INTO game_screenshots (game_id, path, caption, sort_order)
                        VALUES (?, ?, ?, ?)
                    `);
                    screenshots.forEach((s, i) => {
                        ssStmt.run('main', s.path || s, s.caption || '', i);
                    });
                    ssStmt.finalize();

                    // Devlog
                    const devlog = game.devlog || [];
                    const devStmt = this.db.prepare(`
                        INSERT INTO devlog (game_id, title, content, date, visible)
                        VALUES (?, ?, ?, ?, ?)
                    `);
                    devlog.forEach(d => {
                        devStmt.run(
                            'main',
                            d.title,
                            d.content || '',
                            d.date || new Date().toISOString().split('T')[0],
                            d.visible !== false ? 1 : 0
                        );
                    });
                    devStmt.finalize();
                }

                // Insert about
                if (about && Object.keys(about).length > 0) {
                    this.db.run(`
                        INSERT INTO about (id, studio_name, founded_date, description, email, social_links)
                        VALUES (1, ?, ?, ?, ?, ?)
                    `, [
                        about.studio_name || about.studioName || '',
                        about.founded_date || about.foundedDate || '',
                        about.description || '',
                        about.email || '',
                        JSON.stringify(about.social_links || about.socialLinks || {})
                    ]);
                }

                this.db.run('COMMIT', (err) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        reject(err);
                    } else {
                        console.log('ContentDB: All data saved successfully');
                        resolve();
                    }
                });
            });
        });
    }
}

// ============================================================
// SINGLETON INSTANCE (like your static vars in Godot)
// Usage: const contentDB = require('./database.js');
//        contentDB.Open();
//        const books = await contentDB.SelectBooks();
// ============================================================

const contentDB = new ContentDB();

module.exports = contentDB;
