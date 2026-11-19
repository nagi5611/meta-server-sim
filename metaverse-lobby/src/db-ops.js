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