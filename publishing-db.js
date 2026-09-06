/**
 * publishing-db.js - Read-only Publishing Database Service
 *
 * Provides async methods for server routes:
 * - health: database connectivity check
 * - overview: summary statistics
 * - filters: available filter values (series, platforms, statuses)
 * - catalog: paginated release catalog with filtering
 * - seriesAnalytics: metrics per series
 * - healthChecks: detailed system health
 *
 * All queries are read-only (OPEN_READONLY).
 * Uses latest metric snapshot per release (not summed).
 * Parameterized queries prevent SQL injection.
 * Local times (release_datetime_local/release_timezone) for display.
 * UTC for sorting.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const os = require('os');

// Configuration
const PUBLISHING_DB_PATH = process.env.PUBLISHING_DB_PATH ||
    path.join(__dirname, 'data', 'Xanmal_Publishing_Database.sqlite');

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * PublishingDB - Read-only access to publishing metrics and release catalog
 */
class PublishingDB {
    constructor() {
        this.db = null;
        this.isOpen = false;
        this.initPromise = null;
    }

    /**
     * Open database connection in read-only mode
     */
    async open() {
        if (this.isOpen) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this._initialize();
        return this.initPromise;
    }

    async _initialize() {
        try {
            // Verify file exists before opening
            if (!fs.existsSync(PUBLISHING_DB_PATH)) {
                throw new Error(`Publishing database not found: ${PUBLISHING_DB_PATH}`);
            }

            await new Promise((resolve, reject) => {
                this.db = new sqlite3.Database(
                    PUBLISHING_DB_PATH,
                    sqlite3.OPEN_READONLY,
                    (err) => {
                        if (err) {
                            console.error('Failed to open publishing database:', err.message);
                            reject(err);
                        } else {
                            console.log('PublishingDB: Connected (read-only) to', PUBLISHING_DB_PATH);
                            resolve();
                        }
                    }
                );
            });

            // Verify database is accessible
            await this._get('SELECT 1 AS ok');
            this.isOpen = true;
            console.log('PublishingDB: Ready');
        } catch (err) {
            const db = this.db;
            this.db = null;
            this.isOpen = false;
            this.initPromise = null;
            if (db) {
                await new Promise(resolve => db.close(() => resolve()));
            }
            throw err;
        }
    }

    /**
     * Helper: Run SQL and get single row
     */
    _get(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (!this.db) reject(new Error('Database not open'));
            else {
                this.db.get(sql, params, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            }
        });
    }

    /**
     * Helper: Run SQL and get all rows
     */
    _all(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (!this.db) reject(new Error('Database not open'));
            else {
                this.db.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            }
        });
    }

    /**
     * health() - Simple connectivity check
     * @returns {Object} { ok: boolean, timestamp: string, path: string }
     */
    async health() {
        try {
            await this.open();
            const result = await this._get('SELECT datetime("now") AS now');
            return {
                ok: true,
                timestamp: result.now,
                path: PUBLISHING_DB_PATH
            };
        } catch (err) {
            return {
                ok: false,
                error: err.message,
                path: PUBLISHING_DB_PATH
            };
        }
    }

    /**
     * overview() - Summary statistics
     * @returns {Object} { totalReleases, publishedCount, scheduledCount, draftCount, platforms, series }
     */
    async overview() {
        try {
            await this.open();

            const stats = await this._get(`
                SELECT
                    COUNT(*) AS total_releases,
                    SUM(CASE WHEN status = 'Published' THEN 1 ELSE 0 END) AS published_count,
                    SUM(CASE WHEN status = 'Scheduled' THEN 1 ELSE 0 END) AS scheduled_count,
                    SUM(CASE WHEN status = 'Draft' THEN 1 ELSE 0 END) AS draft_count
                FROM releases
            `);

            const platformCount = await this._get('SELECT COUNT(*) AS count FROM platforms');
            const seriesCount = await this._get('SELECT COUNT(*) AS count FROM series');

            return {
                totalReleases: stats.total_releases || 0,
                publishedCount: stats.published_count || 0,
                scheduledCount: stats.scheduled_count || 0,
                draftCount: stats.draft_count || 0,
                platformCount: platformCount.count || 0,
                seriesCount: seriesCount.count || 0
            };
        } catch (err) {
            throw new Error(`Overview query failed: ${err.message}`);
        }
    }

    /**
     * totals() - Aggregate word count and views across all releases.
     * Uses the latest metric snapshot per release (not summed across snapshots).
     * @returns {Object} { words, views }
     */
    async totals() {
        try {
            await this.open();
            const row = await this._get(`
                SELECT
                    COALESCE(SUM(r.word_count), 0) AS words,
                    COALESCE(SUM(m.views), 0) AS views
                FROM releases r
                LEFT JOIN release_metrics m
                  ON m.id = (
                      SELECT m2.id
                      FROM release_metrics m2
                      WHERE m2.release_id = r.id
                      ORDER BY m2.captured_at DESC, m2.id DESC
                      LIMIT 1
                  )
            `);
            return {
                words: row.words || 0,
                views: row.views || 0
            };
        } catch (err) {
            throw new Error(`Totals query failed: ${err.message}`);
        }
    }

    /**
     * cadence() - Published releases per month (UTC).
     * @returns {Array} [{ month: 'YYYY-MM', releases }]
     */
    async cadence() {
        try {
            await this.open();
            const rows = await this._all(`
                SELECT strftime('%Y-%m', release_datetime_utc) AS month,
                       COUNT(*) AS releases
                FROM releases
                WHERE status = 'Published' AND release_datetime_utc IS NOT NULL
                GROUP BY month
                ORDER BY month
            `);
            return rows.map(r => ({ month: r.month, releases: r.releases || 0 }));
        } catch (err) {
            throw new Error(`Cadence query failed: ${err.message}`);
        }
    }

    /**
     * seriesComparison() - Releases, words, and views per series.
     * Uses the latest metric snapshot per release.
     * @returns {Array} [{ series, releases, words, views }]
     */
    async seriesComparison() {
        try {
            await this.open();
            const rows = await this._all(`
                SELECT
                    s.name AS series,
                    COUNT(DISTINCT r.id) AS releases,
                    COALESCE(SUM(r.word_count), 0) AS words,
                    COALESCE(SUM(m.views), 0) AS views
                FROM series s
                JOIN content_items c ON c.series_id = s.id
                JOIN releases r ON r.content_item_id = c.id
                LEFT JOIN release_metrics m
                  ON m.id = (
                      SELECT m2.id
                      FROM release_metrics m2
                      WHERE m2.release_id = r.id
                      ORDER BY m2.captured_at DESC, m2.id DESC
                      LIMIT 1
                  )
                GROUP BY s.name
                ORDER BY releases DESC, s.name ASC
            `);
            return rows.map(r => ({
                series: r.series,
                releases: r.releases || 0,
                words: r.words || 0,
                views: r.views || 0
            }));
        } catch (err) {
            throw new Error(`Series comparison query failed: ${err.message}`);
        }
    }

    /**
     * platformComparison() - Releases, words, and views per platform.
     * Uses the latest metric snapshot per release.
     * @returns {Array} [{ platform, releases, words, views }]
     */
    async platformComparison() {
        try {
            await this.open();
            const rows = await this._all(`
                SELECT
                    p.name AS platform,
                    COUNT(DISTINCT r.id) AS releases,
                    COALESCE(SUM(r.word_count), 0) AS words,
                    COALESCE(SUM(m.views), 0) AS views
                FROM platforms p
                JOIN releases r ON r.platform_id = p.id
                LEFT JOIN release_metrics m
                  ON m.id = (
                      SELECT m2.id
                      FROM release_metrics m2
                      WHERE m2.release_id = r.id
                      ORDER BY m2.captured_at DESC, m2.id DESC
                      LIMIT 1
                  )
                GROUP BY p.name
                ORDER BY releases DESC, p.name ASC
            `);
            return rows.map(r => ({
                platform: r.platform,
                releases: r.releases || 0,
                words: r.words || 0,
                views: r.views || 0
            }));
        } catch (err) {
            throw new Error(`Platform comparison query failed: ${err.message}`);
        }
    }

    /**
     * upcoming() - Scheduled releases from now onward.
     * @param {number} limit - Max results (default 12)
     * @returns {Array} Formatted release objects sorted by release_datetime_utc
     */
    async upcoming(limit = 12) {
        try {
            await this.open();
            const safeLimit = Math.min(100, Math.max(1, parseInt(limit) || 12));
            const query = `
                SELECT
                    r.id AS release_id,
                    p.name AS platform,
                    s.name AS series,
                    c.chapter_label,
                    c.chapter_number,
                    c.content_type,
                    COALESCE(r.platform_title, c.canonical_title) AS title,
                    r.release_datetime AS release_datetime_local,
                    r.release_timezone,
                    r.release_datetime_utc,
                    r.status,
                    r.word_count,
                    m.views,
                    m.metric2,
                    m.metric3,
                    r.url,
                    r.notes
                FROM releases r
                JOIN content_items c ON c.id = r.content_item_id
                JOIN series s ON s.id = c.series_id
                JOIN platforms p ON p.id = r.platform_id
                LEFT JOIN release_metrics m
                  ON m.id = (
                      SELECT m2.id
                      FROM release_metrics m2
                      WHERE m2.release_id = r.id
                      ORDER BY m2.captured_at DESC, m2.id DESC
                      LIMIT 1
                  )
                WHERE r.status = 'Scheduled'
                  AND r.release_datetime_utc >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                ORDER BY r.release_datetime_utc ASC, r.id ASC
                LIMIT ?
            `;
            const rows = await this._all(query, [safeLimit]);
            return rows.map(r => this._formatRelease(r));
        } catch (err) {
            throw new Error(`Upcoming query failed: ${err.message}`);
        }
    }

    /**
     * filters() - Available filter values for catalog queries
     * @returns {Object} { series: Array, platforms: Array, statuses: Array }
     */
    async filters() {
        try {
            await this.open();

            const series = await this._all('SELECT DISTINCT name FROM series ORDER BY name ASC');
            const platforms = await this._all('SELECT DISTINCT name FROM platforms ORDER BY name ASC');
            const statuses = ['Published', 'Scheduled', 'Draft'];

            return {
                series: series.map(s => s.name),
                platforms: platforms.map(p => p.name),
                statuses
            };
        } catch (err) {
            throw new Error(`Filters query failed: ${err.message}`);
        }
    }

    /**
     * Escape LIKE wildcards for safe pattern matching
     * Escapes %, _, and [ characters with backslash
     */
    _escapeLike(str) {
        return str.replace(/[%_\[]/g, '\\$&');
    }

    /**
     * catalog() - Paginated release catalog with filtering
     *
     * @param {Object} options
     * @param {string} options.q - Search query (searches title, chapter_label)
     * @param {string} options.series - Filter by series name
     * @param {string} options.platform - Filter by platform name
     * @param {string} options.status - Filter by status (Published/Scheduled/Draft)
     * @param {number} options.page - Page number (1-indexed, default 1)
     * @param {number} options.pageSize - Items per page (default 50, max 100)
     *
     * @returns {Object} { releases: Array, page, pageSize, total, totalPages }
     */
    async catalog(options = {}) {
        try {
            await this.open();

            // Validate and clamp pagination
            let page = Math.max(1, parseInt(options.page) || 1);
            let pageSize = Math.min(
                MAX_PAGE_SIZE,
                Math.max(1, parseInt(options.pageSize) || DEFAULT_PAGE_SIZE)
            );

            // Build WHERE clause with parameterized queries
            const whereConditions = [];
            const params = [];

            // Search filter (title, chapter_label, or series)
            if (options.q) {
                const searchPattern = this._escapeLike(String(options.q).trim());
                whereConditions.push(
                    `(LOWER(c.canonical_title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(c.chapter_label) LIKE LOWER(?) ESCAPE '\\' OR LOWER(s.name) LIKE LOWER(?) ESCAPE '\\')`
                );
                params.push(`%${searchPattern}%`, `%${searchPattern}%`, `%${searchPattern}%`);
            }

            // Series filter
            if (options.series) {
                whereConditions.push('s.name = ?');
                params.push(String(options.series).trim());
            }

            // Platform filter
            if (options.platform) {
                whereConditions.push('p.name = ?');
                params.push(String(options.platform).trim());
            }

            // Status filter
            if (options.status) {
                const validStatuses = ['Published', 'Scheduled', 'Draft'];
                const status = String(options.status).trim();
                if (validStatuses.includes(status)) {
                    whereConditions.push('r.status = ?');
                    params.push(status);
                }
            }

            const whereClause = whereConditions.length > 0
                ? `WHERE ${whereConditions.join(' AND ')}`
                : '';

            // Get filtered totals across the full result set, not just the page.
            const countQuery = `
                SELECT COUNT(DISTINCT r.id) AS total,
                       COALESCE(SUM(r.word_count), 0) AS words,
                       COALESCE(SUM(m.views), 0) AS views
                FROM releases r
                JOIN content_items c ON c.id = r.content_item_id
                JOIN series s ON s.id = c.series_id
                JOIN platforms p ON p.id = r.platform_id
                LEFT JOIN release_metrics m
                  ON m.id = (
                      SELECT m2.id
                      FROM release_metrics m2
                      WHERE m2.release_id = r.id
                      ORDER BY m2.captured_at DESC, m2.id DESC
                      LIMIT 1
                  )
                ${whereClause}
            `;
            const countResult = await this._get(countQuery, params);
            const total = countResult.total || 0;
            const totalPages = Math.ceil(total / pageSize);

            // Clamp page to valid range
            page = Math.min(page, Math.max(1, totalPages));

            const offset = (page - 1) * pageSize;

            // Get paginated results
            const query = `
                SELECT
                    r.id AS release_id,
                    p.name AS platform,
                    s.name AS series,
                    c.chapter_label,
                    c.chapter_number,
                    c.content_type,
                    COALESCE(r.platform_title, c.canonical_title) AS title,
                    r.release_datetime AS release_datetime_local,
                    r.release_timezone,
                    r.release_datetime_utc,
                    r.status,
                    r.word_count,
                    m.views,
                    m.metric2,
                    m.metric3,
                    r.url,
                    r.notes
                FROM releases r
                JOIN content_items c ON c.id = r.content_item_id
                JOIN series s ON s.id = c.series_id
                JOIN platforms p ON p.id = r.platform_id
                LEFT JOIN release_metrics m
                  ON m.id = (
                      SELECT m2.id
                      FROM release_metrics m2
                      WHERE m2.release_id = r.id
                      ORDER BY m2.captured_at DESC, m2.id DESC
                      LIMIT 1
                  )
                ${whereClause}
                ORDER BY r.release_datetime_utc DESC, r.id DESC
                LIMIT ? OFFSET ?
            `;

            params.push(pageSize, offset);
            const releases = await this._all(query, params);

            return {
                releases: releases.map(r => this._formatRelease(r)),
                page,
                pageSize,
                total,
                totalPages,
                summary: {
                    words: countResult.words || 0,
                    views: countResult.views || 0
                }
            };
        } catch (err) {
            throw new Error(`Catalog query failed: ${err.message}`);
        }
    }

    /**
     * Format release row for API response
     */
    _formatRelease(row) {
        return {
            releaseId: row.release_id,
            platform: row.platform,
            series: row.series,
            chapterLabel: row.chapter_label,
            chapterNumber: row.chapter_number,
            contentType: row.content_type,
            title: row.title,
            releaseDateTime: row.release_datetime_local,
            releaseTimezone: row.release_timezone,
            releaseDateTimeUtc: row.release_datetime_utc,
            status: row.status,
            wordCount: row.word_count,
            views: row.views,
            metric2: row.metric2,
            metric3: row.metric3,
            url: row.url,
            notes: row.notes
        };
    }

    /**
     * seriesAnalytics() - Metrics per series
     *
     * Groups by series and sums latest metrics per release.
     * Each release's latest snapshot contributes once to the total.
     *
     * @param {Object} options
     * @param {string} options.series - Optional: filter to specific series name
     *
     * @returns {Array} [{
     *     series,
     *     totalReleases,
     *     publishedCount,
     *     totalViews,
     *     platformCount,
     *     firstRelease,
     *     lastRelease
     * }]
     */
    async seriesAnalytics(options = {}) {
        try {
            await this.open();

            let whereClause = '';
            const params = [];

            if (options.series) {
                whereClause = 'WHERE s.name = ?';
                params.push(String(options.series).trim());
            }

            const query = `
                SELECT
                    s.name AS series,
                    COUNT(DISTINCT r.id) AS total_releases,
                    SUM(CASE WHEN r.status = 'Published' THEN 1 ELSE 0 END) AS published_count,
                    COUNT(DISTINCT p.id) AS platform_count,
                    COALESCE(SUM(m.views), 0) AS total_views,
                    MIN(r.release_datetime_utc) AS first_release,
                    MAX(r.release_datetime_utc) AS last_release
                FROM series s
                JOIN content_items c ON c.series_id = s.id
                JOIN releases r ON r.content_item_id = c.id
                JOIN platforms p ON p.id = r.platform_id
                LEFT JOIN release_metrics m
                  ON m.id = (
                      SELECT m2.id
                      FROM release_metrics m2
                      WHERE m2.release_id = r.id
                      ORDER BY m2.captured_at DESC, m2.id DESC
                      LIMIT 1
                  )
                ${whereClause}
                GROUP BY s.id, s.name
                ORDER BY s.name ASC
            `;

            const results = await this._all(query, params);

            return results.map(row => ({
                series: row.series,
                totalReleases: row.total_releases || 0,
                publishedCount: row.published_count || 0,
                platformCount: row.platform_count || 0,
                totalViews: row.total_views || 0,
                firstRelease: row.first_release,
                lastRelease: row.last_release
            }));
        } catch (err) {
            throw new Error(`Series analytics query failed: ${err.message}`);
        }
    }

    /**
     * healthChecks() - Detailed system health and data quality
     *
     * @returns {Object} {
     *     database: { ok, version, integrityCheck },
     *     tables: { series, platforms, contentItems, releases, releaseMetrics },
     *     recentActivity: { latestRelease, latestMetricCapture },
     *     warnings: Array
     * }
     */
    async healthChecks() {
        try {
            await this.open();

            const warnings = [];
            const health = {};

            // Database integrity and version
            try {
                const integrity = await this._get('PRAGMA integrity_check(1)');
                health.database = {
                    ok: integrity.integrity_check === 'ok',
                    integrityMessage: integrity.integrity_check,
                    path: PUBLISHING_DB_PATH
                };
            } catch (err) {
                health.database = {
                    ok: false,
                    error: err.message
                };
                warnings.push(`Database integrity check failed: ${err.message}`);
            }

            // Table row counts
            try {
                const series = await this._get('SELECT COUNT(*) AS count FROM series');
                const platforms = await this._get('SELECT COUNT(*) AS count FROM platforms');
                const contentItems = await this._get('SELECT COUNT(*) AS count FROM content_items');
                const releases = await this._get('SELECT COUNT(*) AS count FROM releases');
                const releaseMetrics = await this._get('SELECT COUNT(*) AS count FROM release_metrics');

                health.tables = {
                    series: series.count || 0,
                    platforms: platforms.count || 0,
                    contentItems: contentItems.count || 0,
                    releases: releases.count || 0,
                    releaseMetrics: releaseMetrics.count || 0
                };

                // Warnings for empty critical tables
                if (!health.tables.series) warnings.push('No series data');
                if (!health.tables.platforms) warnings.push('No platforms data');
                if (!health.tables.releases) warnings.push('No releases data');
            } catch (err) {
                health.tables = { error: err.message };
                warnings.push(`Table count query failed: ${err.message}`);
            }

            // Recent activity
            try {
                const latestRelease = await this._get(`
                    SELECT r.id, r.release_datetime_utc, s.name AS series
                    FROM releases r
                    JOIN content_items c ON c.id = r.content_item_id
                    JOIN series s ON s.id = c.series_id
                    ORDER BY r.release_datetime_utc DESC
                    LIMIT 1
                `);

                const latestMetric = await this._get(`
                    SELECT rm.captured_at, rm.release_id
                    FROM release_metrics rm
                    ORDER BY rm.captured_at DESC
                    LIMIT 1
                `);

                health.recentActivity = {
                    latestRelease: latestRelease ? {
                        releaseId: latestRelease.id,
                        dateTime: latestRelease.release_datetime_utc,
                        series: latestRelease.series
                    } : null,
                    latestMetricCapture: latestMetric ? latestMetric.captured_at : null
                };
            } catch (err) {
                health.recentActivity = { error: err.message };
                warnings.push(`Recent activity query failed: ${err.message}`);
            }

            health.warnings = warnings;
            health.timestamp = new Date().toISOString();

            return health;
        } catch (err) {
            throw new Error(`Health checks failed: ${err.message}`);
        }
    }

    /**
     * freshness() - Data freshness metadata for the dashboard masthead.
     * @returns {Object} { metrics_captured_at, last_imported_at, latest_release_utc, import_count, status_history_count }
     */
    async freshness() {
        try {
            await this.open();
            const row = await this._get(`
                SELECT
                    (SELECT MAX(captured_at) FROM release_metrics) AS metrics_captured_at,
                    (SELECT MAX(imported_at) FROM imports) AS last_imported_at,
                    (SELECT MAX(release_datetime_utc) FROM releases) AS latest_release_utc,
                    (SELECT COUNT(*) FROM imports) AS import_count,
                    (SELECT COUNT(*) FROM release_status_history) AS status_history_count
            `);
            return {
                metrics_captured_at: row.metrics_captured_at || null,
                last_imported_at: row.last_imported_at || null,
                latest_release_utc: row.latest_release_utc || null,
                import_count: row.import_count || 0,
                status_history_count: row.status_history_count || 0
            };
        } catch (err) {
            throw new Error(`Freshness query failed: ${err.message}`);
        }
    }

    /**
     * releaseWindow() - Get releases within a date/time window
     * Useful for calendar/timeline views
     *
     * @param {Object} options
     * @param {string} options.startUtc - ISO string or SQLite datetime
     * @param {string} options.endUtc - ISO string or SQLite datetime
     * @param {string} options.status - Optional: filter by status
     * @param {number} options.limit - Max results (default 500)
     *
     * @returns {Array} Release objects sorted by release_datetime_utc
     */
    async releaseWindow(options = {}) {
        try {
            await this.open();

            if (!options.startUtc || !options.endUtc) {
                throw new Error('startUtc and endUtc are required');
            }

            const whereConditions = [
                'r.release_datetime_utc >= ?',
                'r.release_datetime_utc < ?'
            ];
            const params = [String(options.startUtc), String(options.endUtc)];

            if (options.status) {
                const validStatuses = ['Published', 'Scheduled', 'Draft'];
                const status = String(options.status).trim();
                if (validStatuses.includes(status)) {
                    whereConditions.push('r.status = ?');
                    params.push(status);
                }
            }

            const limit = Math.min(500, Math.max(1, parseInt(options.limit) || 500));

            const query = `
                SELECT
                    r.id AS release_id,
                    p.name AS platform,
                    s.name AS series,
                    c.chapter_label,
                    c.chapter_number,
                    c.content_type,
                    COALESCE(r.platform_title, c.canonical_title) AS title,
                    r.release_datetime AS release_datetime_local,
                    r.release_timezone,
                    r.release_datetime_utc,
                    r.status,
                    r.word_count,
                    m.views,
                    m.metric2,
                    m.metric3,
                    r.url,
                    r.notes
                FROM releases r
                JOIN content_items c ON c.id = r.content_item_id
                JOIN series s ON s.id = c.series_id
                JOIN platforms p ON p.id = r.platform_id
                LEFT JOIN release_metrics m
                  ON m.id = (
                      SELECT m2.id
                      FROM release_metrics m2
                      WHERE m2.release_id = r.id
                      ORDER BY m2.captured_at DESC, m2.id DESC
                      LIMIT 1
                  )
                WHERE ${whereConditions.join(' AND ')}
                ORDER BY r.release_datetime_utc ASC, r.id ASC
                LIMIT ?
            `;

            params.push(limit);
            const releases = await this._all(query, params);

            return releases.map(r => this._formatRelease(r));
        } catch (err) {
            throw new Error(`Release window query failed: ${err.message}`);
        }
    }

    /**
     * close() - Gracefully close database connection
     */
    async close() {
        if (!this.db) return;

        return new Promise((resolve) => {
            const closeTimeout = setTimeout(() => {
                console.warn('PublishingDB: Close timeout after 5s');
                resolve();
            }, 5000);

            this.db.close((err) => {
                clearTimeout(closeTimeout);
                if (err) {
                    console.error('PublishingDB: Error closing database:', err.message);
                } else {
                    console.log('PublishingDB: Closed');
                }
                this.db = null;
                this.isOpen = false;
                resolve();
            });
        });
    }
}

// Export factory/class for CommonJS
module.exports = PublishingDB;
