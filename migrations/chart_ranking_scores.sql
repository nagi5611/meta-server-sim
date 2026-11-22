-- D1: per-tenant chart score rankings (metaverse-sim-staging / optional production DB)
-- Apply: wrangler d1 execute <db> --remote --file=./migrations/chart_ranking_scores.sql
--        or scripts/apply-d1-migration-file.mjs chart-ranking <path-to-this-file>

CREATE TABLE IF NOT EXISTS chart_ranking_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    chart_id TEXT NOT NULL,
    part INTEGER NOT NULL DEFAULT 0,
    username TEXT NOT NULL,
    score INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_chart_ranking_scores_lookup
    ON chart_ranking_scores (tenant_id, chart_id, part, score DESC, id ASC);