/**
 * publishing-calendar.js - SQLite module for Nekojin Interactive
 *
 * PublishingCalendar - Manages manually added public release calendar entries
 * Persists to dedicated SQLite database with full async support
 *
 * Environment: PUBLISHING_CALENDAR_DB_PATH or <repo>/data/publishing-calendar.db
 * Schema: id, title, series, platform, release_date, release_time, timezone, url, notes, created_at, updated_at
 *
 * Features:
 * - Safe ID generation (nanoid-like)
 * - Comprehensive input validation with safe length limits
 * - Parameterized SQL (no SQL injection)
 * - Automatic timestamps (created_at, updated_at)
 * - Public read (date range [start, end))
 * - Admin read (all entries)
 * - Upsert and delete operations
 * - Async open/close/list/upsert/delete
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');

// Database location
const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.PUBLISHING_CALENDAR_DB_PATH || path.join(DB_DIR, 'publishing-calendar.db');

// Validation constraints
const VALIDATION = {
    ID_LENGTH: 24,
    TITLE_MAX: 255,
    SERIES_MAX: 255,
    PLATFORM_CHOICES: ['Royal Road', 'ScribbleHub', 'Other'],
    TIMEZONE_MAX: 50,
    URL_MAX: 1024,
    NOTES_MAX: 2000,
    RELEASE_TIME_PATTERN: /^([0-1]\d|2[0-3]):[0-5]\d$/
};

/**
 * PublishingCalendar - Manages public release calendar entries
 */
class PublishingCalendar {
    constructor() {
        this.db = null;
        this.isOpen = false;
        this.initPromise = null;
    }

    /**
     * Open the database connection
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

            await new Promise((resolve, reject) => {
                this.db = new sqlite3.Database(DB_PATH, (err) => {
                    if (err) {
                        console.error('Failed to open publishing calendar database:', err);
                        reject(err);
                    } else {
                        console.log('PublishingCalendar: Connected to', DB_PATH);
                        resolve();
                    }
                });
            });

            await this._run('PRAGMA foreign_keys = ON');
            await this._CreateTables();
            this.isOpen = true;
            console.log('PublishingCalendar: Tables created');
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
     * Close the database connection
     */
    async Close() {
        if (!this.isOpen || !this.db) return;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.warn('PublishingCalendar: Close timeout, forcing shutdown');
                this.isOpen = false;
                resolve();
            }, 5000);

            this.db.close((err) => {
                clearTimeout(timeout);
                this.isOpen = false;
                this.db = null;
                this.initPromise = null;
                if (err) reject(err);
                else resolve();
            });
        });
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
     * Create publishing calendar table
     */
    async _CreateTables() {
        await this._run(`
            CREATE TABLE IF NOT EXISTS publishing_calendar (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                series TEXT NOT NULL,
                platform TEXT NOT NULL,
                release_date TEXT NOT NULL,
                release_time TEXT,
                timezone TEXT NOT NULL DEFAULT 'America/Phoenix',
                url TEXT,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create index for common queries
        await this._run(`
            CREATE INDEX IF NOT EXISTS idx_publishing_calendar_date
            ON publishing_calendar(release_date)
        `);

        await this._run(`
            CREATE INDEX IF NOT EXISTS idx_publishing_calendar_series
            ON publishing_calendar(series)
        `);

    }

    /**
     * Generate safe ID (nanoid-like)
     * @returns {string} 24-character alphanumeric ID
     */
    _generateId() {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
        let id = '';
        const bytes = crypto.randomBytes(24);
        for (let i = 0; i < 24; i++) {
            id += chars[bytes[i] % chars.length];
        }
        return id;
    }

    /**
     * Validate date format YYYY-MM-DD
     * @param {string} date
     * @returns {boolean}
     */
    _isValidDate(date) {
        if (typeof date !== 'string') return false;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
        const d = new Date(date + 'T00:00:00Z');
        return d instanceof Date && !isNaN(d) && d.toISOString().startsWith(date);
    }

    /**
     * Validate release_time format HH:MM (24-hour)
     * @param {string} time
     * @returns {boolean}
     */
    _isValidTime(time) {
        if (!time) return true; // Optional
        if (typeof time !== 'string') return false;
        return VALIDATION.RELEASE_TIME_PATTERN.test(time);
    }

    /**
     * Validate platform
     * @param {string} platform
     * @returns {boolean}
     */
    _isValidPlatform(platform) {
        return VALIDATION.PLATFORM_CHOICES.includes(platform);
    }

    /**
     * Validate timezone (must be valid IANA timezone)
     * @param {string} timezone
     * @returns {boolean}
     */
    _isValidTimezone(timezone) {
        if (typeof timezone !== 'string') return false;
        if (timezone.length > VALIDATION.TIMEZONE_MAX) return false;
        try {
            // Check if timezone can be used with Intl API
            Intl.DateTimeFormat(undefined, { timeZone: timezone });
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Validate URL (http/https only)
     * @param {string} url
     * @returns {boolean}
     */
    _isValidUrl(url) {
        if (!url) return true; // Optional
        if (typeof url !== 'string') return false;
        if (url.length > VALIDATION.URL_MAX) return false;
        try {
            const parsed = new URL(url);
            // Only http(s) schemes are allowed. This blocks javascript:, data:,
            // file:, and other schemes that could be used for XSS or local file
            // access when the URL is rendered as a link on the public calendar.
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch (e) {
            return false;
        }
    }

    /**
     * Validate string length
     * @param {string} str
     * @param {number} max
     * @returns {boolean}
     */
    _isValidLength(str, max) {
        if (typeof str !== 'string') return false;
        return str.length > 0 && str.length <= max;
    }

    /**
     * Validate entry for upsert
     * @param {object} entry
     * @param {boolean} requireId - Whether id is required (false for new entries)
     * @returns {{valid: boolean, error?: string}}
     */
    _validateEntry(entry, requireId = true) {
        if (!entry || typeof entry !== 'object') {
            return { valid: false, error: 'Entry must be an object' };
        }

        if (requireId) {
            if (!entry.id || typeof entry.id !== 'string') {
                return { valid: false, error: 'Entry id is required and must be a string' };
            }
            if (entry.id.length !== VALIDATION.ID_LENGTH) {
                return { valid: false, error: `Entry id must be exactly ${VALIDATION.ID_LENGTH} characters` };
            }
        }

        if (!this._isValidLength(entry.title, VALIDATION.TITLE_MAX)) {
            return { valid: false, error: `Title must be 1-${VALIDATION.TITLE_MAX} characters` };
        }

        if (!this._isValidLength(entry.series, VALIDATION.SERIES_MAX)) {
            return { valid: false, error: `Series must be 1-${VALIDATION.SERIES_MAX} characters` };
        }

        if (!this._isValidPlatform(entry.platform)) {
            return { valid: false, error: `Platform must be one of: ${VALIDATION.PLATFORM_CHOICES.join(', ')}` };
        }

        if (!this._isValidDate(entry.release_date)) {
            return { valid: false, error: 'release_date must be valid YYYY-MM-DD format' };
        }

        if (!this._isValidTime(entry.release_time)) {
            return { valid: false, error: 'release_time must be valid HH:MM format (24-hour) or empty' };
        }

        const timezone = entry.timezone || 'America/Phoenix';
        if (!this._isValidTimezone(timezone)) {
            return { valid: false, error: 'timezone must be valid IANA timezone' };
        }

        if (!this._isValidUrl(entry.url)) {
            return { valid: false, error: `URL must be valid format or empty, max ${VALIDATION.URL_MAX} characters` };
        }

        if (entry.notes && !this._isValidLength(entry.notes, VALIDATION.NOTES_MAX)) {
            return { valid: false, error: `Notes must be 0-${VALIDATION.NOTES_MAX} characters` };
        }

        return { valid: true };
    }

    /**
     * List public entries for a date range [start, end)
     * @param {string} startDate - YYYY-MM-DD (inclusive)
     * @param {string} endDate - YYYY-MM-DD (exclusive)
     * @returns {Promise<Array>}
     */
    async ListPublic(startDate, endDate) {
        if (!this.isOpen) throw new Error('Database not open');

        if (!this._isValidDate(startDate) || !this._isValidDate(endDate)) {
            throw new Error('startDate and endDate must be valid YYYY-MM-DD format');
        }

        if (startDate >= endDate) {
            throw new Error('startDate must be before endDate');
        }

        const sql = `
            SELECT * FROM publishing_calendar
            WHERE release_date >= ? AND release_date < ?
            ORDER BY release_date ASC, release_time ASC
        `;

        return this._all(sql, [startDate, endDate]);
    }

    /**
     * List all entries (admin view)
     * @returns {Promise<Array>}
     */
    async ListAll() {
        if (!this.isOpen) throw new Error('Database not open');

        const sql = `
            SELECT * FROM publishing_calendar
            ORDER BY release_date DESC, release_time DESC
        `;

        return this._all(sql);
    }

    /**
     * Upsert an entry (insert or update)
     * @param {object} entry - Entry object with optional id
     * @returns {Promise<object>} Entry with id, created_at, updated_at
     */
    async Upsert(entry) {
        if (!this.isOpen) throw new Error('Database not open');

        const isUpdate = !!entry.id;
        const validation = this._validateEntry(entry, isUpdate);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        const id = entry.id || this._generateId();
        const title = entry.title.trim();
        const series = entry.series.trim();
        const platform = entry.platform;
        const release_date = entry.release_date;
        const release_time = entry.release_time || null;
        const timezone = (entry.timezone || 'America/Phoenix').trim();
        const url = entry.url ? entry.url.trim() : null;
        const notes = entry.notes ? entry.notes.trim() : null;
        const now = new Date().toISOString();

        if (isUpdate) {
            // Update existing entry
            const sql = `
                UPDATE publishing_calendar
                SET title = ?, series = ?, platform = ?, release_date = ?,
                    release_time = ?, timezone = ?, url = ?, notes = ?, updated_at = ?
                WHERE id = ?
            `;

            await this._run(sql, [
                title, series, platform, release_date,
                release_time, timezone, url, notes, now, id
            ]);

            return this._get('SELECT * FROM publishing_calendar WHERE id = ?', [id]);
        } else {
            // Insert new entry
            const sql = `
                INSERT INTO publishing_calendar
                (id, title, series, platform, release_date, release_time, timezone, url, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            await this._run(sql, [
                id, title, series, platform, release_date,
                release_time, timezone, url, notes, now, now
            ]);

            return this._get('SELECT * FROM publishing_calendar WHERE id = ?', [id]);
        }
    }

    /**
     * Delete an entry by id
     * @param {string} id - Entry id
     * @returns {Promise<boolean>} True if entry was deleted, false if not found
     */
    async Delete(id) {
        if (!this.isOpen) throw new Error('Database not open');

        if (typeof id !== 'string' || id.length !== VALIDATION.ID_LENGTH) {
            throw new Error(`ID must be exactly ${VALIDATION.ID_LENGTH} characters`);
        }

        const sql = 'DELETE FROM publishing_calendar WHERE id = ?';
        const result = await this._run(sql, [id]);
        return result.changes > 0;
    }

    /**
     * Get a single entry by id
     * @param {string} id - Entry id
     * @returns {Promise<object|undefined>}
     */
    async GetById(id) {
        if (!this.isOpen) throw new Error('Database not open');

        if (typeof id !== 'string' || id.length !== VALIDATION.ID_LENGTH) {
            throw new Error(`ID must be exactly ${VALIDATION.ID_LENGTH} characters`);
        }

        return this._get('SELECT * FROM publishing_calendar WHERE id = ?', [id]);
    }

}

module.exports = PublishingCalendar;
