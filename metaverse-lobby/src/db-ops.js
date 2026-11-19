import { normalizeAnnouncementLocale, parseAnnouncementI18nJson } from './announcement-i18n.js';

const METRICS_1H = `INSERT INTO metrics_presence_1h (world_id, bucket_at, peak, avg, sample_count)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(world_id, bucket_at) DO UPDATE SET
  peak = MAX(metrics_presence_1h.peak, excluded.peak),
  avg = (metrics_presence_1h.avg * metrics_presence_1h.sample_count + excluded.avg) /
        (metrics_presence_1h.sample_count + excluded.sample_count),
  sample_count = metrics_presence_1h.sample_count + excluded.sample_count`;

/**
 * @param {D1Database} db
 */
export async function ensureLobbyOpsSchema(db) {
    if (!db) return;
    await db.exec(`CREATE TABLE IF NOT EXISTS metrics_presence_1h (
      world_id TEXT NOT NULL, bucket_at TEXT NOT NULL, peak INTEGER DEFAULT 0,
      avg REAL DEFAULT 0, sample_count INTEGER DEFAULT 0,
      PRIMARY KEY (world_id, bucket_at))`);
    await db.exec(`CREATE TABLE IF NOT EXISTS metrics_presence_1d (
      world_id TEXT NOT NULL, bucket_at TEXT NOT NULL, peak INTEGER DEFAULT 0,
      avg REAL DEFAULT 0, PRIMARY KEY (world_id, bucket_at))`);
    await db.exec(`CREATE TABLE IF NOT EXISTS join_events (
      id TEXT PRIMARY KEY, user_ref TEXT, display_name TEXT, world_id TEXT,
      tenant_id TEXT, joined_at TEXT, left_at TEXT, ok INTEGER DEFAULT 1, meta TEXT)`);
    await db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, actor TEXT, action TEXT, target_type TEXT, target_id TEXT,
      detail TEXT, created_at TEXT)`);
    await db.exec(`CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
}

/** @param {Record<string, unknown>} row */
function mapAnnouncementRow(row) {
    return {
        id: String(row.id),
        title: String(row.title || ''),
        body: String(row.body || ''),
        published: Boolean(Number(row.published)),
        sortOrder: Number(row.sort_order) || 0,
        createdAt: String(row.created_at || ''),
        updatedAt: String(row.updated_at || ''),
        sourceLocale: normalizeAnnouncementLocale(
            row.source_locale != null ? String(row.source_locale) : 'ja',
        ),
        i18n: parseAnnouncementI18nJson(row.i18n_json),
    };
}

/**
 * @param {D1Database} db
 * @param {{ limit?: number, publishedOnly?: boolean }} [opts]
 */
export async function listAnnouncements(db, opts = {}) {
    if (!db) return [];
    const publishedOnly = opts.publishedOnly !== false;
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 100);
    const sql = publishedOnly
        ? `SELECT * FROM announcements WHERE published = 1 ORDER BY created_at DESC LIMIT ?`
        : `SELECT * FROM announcements ORDER BY created_at DESC LIMIT ?`;
    const rows = await db.prepare(sql).bind(limit).all();
    return (rows.results || []).map(mapAnnouncementRow);
}

/**
 * @param {D1Database} db
 * @param {Record<string, unknown>} input
 * @param {string} id
 */
export async function insertAnnouncement(db, id, input) {
    const now = new Date().toISOString();
    const body = input.body === undefined || input.body === null ? '' : String(input.body).trim();
    const sourceLocale = normalizeAnnouncementLocale(
        input.sourceLocale != null ? String(input.sourceLocale) : 'ja',
    );
    const i18nJson = input.i18n ? JSON.stringify(input.i18n) : null;
    await db
        .prepare(
            `INSERT INTO announcements (
               id, title, body, published, sort_order, created_at, updated_at, source_locale, i18n_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            id,
            input.title,
            body,
            input.published === false ? 0 : 1,
            Number(input.sortOrder) || 0,
            now,
            now,
            sourceLocale,
            i18nJson,
        )
        .run();
    return mapAnnouncementRow({
        id,
        title: input.title,
        body,
        published: input.published === false ? 0 : 1,
        sort_order: Number(input.sortOrder) || 0,
        source_locale: sourceLocale,
        i18n_json: i18nJson,
        created_at: now,
        updated_at: now,
    });
}

/**
 * @param {D1Database} db
 * @param {string} id
 * @param {Record<string, unknown>} input
 */
export async function updateAnnouncement(db, id, input) {
    const now = new Date().toISOString();
    const prev = await db.prepare(`SELECT * FROM announcements WHERE id = ?`).bind(id).first();
    if (!prev) return null;
    const title = input.title !== undefined ? String(input.title).trim() : String(prev.title);
    const body = input.body !== undefined ? String(input.body).trim() : String(prev.body);
    const published =
        input.published !== undefined ? (input.published ? 1 : 0) : Number(prev.published);
    const sortOrder =
        input.sortOrder !== undefined ? Number(input.sortOrder) || 0 : Number(prev.sort_order) || 0;
    const sourceLocale =
        input.sourceLocale !== undefined
            ? normalizeAnnouncementLocale(String(input.sourceLocale))
            : normalizeAnnouncementLocale(prev.source_locale != null ? String(prev.source_locale) : 'ja');
    const i18nJson =
        input.i18n !== undefined ? (input.i18n ? JSON.stringify(input.i18n) : null) : prev.i18n_json;
    await db
        .prepare(
            `UPDATE announcements SET title = ?, body = ?, published = ?, sort_order = ?, updated_at = ?,
             source_locale = ?, i18n_json = ?
             WHERE id = ?`,
        )
        .bind(title, body, published, sortOrder, now, sourceLocale, i18nJson, id)
        .run();
    return mapAnnouncementRow({
        id,
        title,
        body,
        published,
        sort_order: sortOrder,
        source_locale: sourceLocale,
        i18n_json: i18nJson,
        created_at: prev.created_at,
        updated_at: now,
    });
}

/**
 * @param {D1Database} db
 * @param {string} id
 */
export async function deleteAnnouncement(db, id) {
    if (!db) return false;
    const res = await db.prepare(`DELETE FROM announcements WHERE id = ?`).bind(id).run();
    return (res.meta?.changes || 0) > 0;
}

/**
 * @param {D1Database} db
 * @param {string} worldId
 * @param {number} players
 */
export async function recordPresenceSample(db, worldId, players) {
    if (!db || !worldId) return;
    const d = new Date();
    d.setMinutes(0, 0, 0);
    const bucket = d.toISOString();
    await db
        .prepare(METRICS_1H)
        .bind(worldId, bucket, players, players, 1)
        .run();
}

/**
 * @param {D1Database} db
 */
export async function rollupDailyMetrics(db) {
    if (!db) return;
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(day.getTime() - 864e5);
    const from = yesterday.toISOString();
    const to = day.toISOString();
    const rows = await db
        .prepare(
            `SELECT world_id, MAX(peak) AS peak, AVG(avg) AS avg FROM metrics_presence_1h
             WHERE bucket_at >= ? AND bucket_at < ? GROUP BY world_id`,
        )
        .bind(from, to)
        .all();
    for (const row of rows.results || []) {
        await db
            .prepare(
                `INSERT INTO metrics_presence_1d (world_id, bucket_at, peak, avg)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(world_id, bucket_at) DO UPDATE SET peak=excluded.peak, avg=excluded.avg`,
            )
            .bind(row.world_id, from.slice(0, 10), row.peak, row.avg)
            .run();
    }
}

/**
 * @param {D1Database} db
 * @param {Record<string, unknown>} row
 */
export async function insertJoinEvent(db, row) {
    if (!db) return;
    await db
        .prepare(
            `INSERT INTO join_events (id, user_ref, display_name, world_id, tenant_id, joined_at, left_at, ok, meta)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            row.id,
            row.user_ref || null,
            row.display_name,
            row.world_id,
            row.tenant_id || null,
            row.joined_at,
            row.left_at || null,
            row.ok ? 1 : 0,
            row.meta ? JSON.stringify(row.meta) : null,
        )
        .run();
}

/**
 * @param {D1Database} db
 * @param {Record<string, unknown>} row
 */
export async function insertAuditLog(db, row) {
    if (!db) return;
    await db
        .prepare(
            `INSERT INTO audit_log (id, actor, action, target_type, target_id, detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            row.id,
            row.actor || null,
            row.action,
            row.target_type || null,
            row.target_id || null,
            row.detail ? JSON.stringify(row.detail) : null,
            row.created_at,
        )
        .run();
}