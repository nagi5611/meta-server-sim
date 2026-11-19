CREATE TABLE IF NOT EXISTS metrics_presence_1h (
    world_id TEXT NOT NULL,
    bucket_at TEXT NOT NULL,
    peak INTEGER NOT NULL DEFAULT 0,
    avg REAL NOT NULL DEFAULT 0,
    sample_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (world_id, bucket_at)
);

CREATE TABLE IF NOT EXISTS metrics_presence_1d (
    world_id TEXT NOT NULL,
    bucket_at TEXT NOT NULL,
    peak INTEGER NOT NULL DEFAULT 0,
    avg REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (world_id, bucket_at)
);

CREATE TABLE IF NOT EXISTS join_events (
    id TEXT PRIMARY KEY,
    user_ref TEXT,
    display_name TEXT NOT NULL,
    world_id TEXT NOT NULL,
    tenant_id TEXT,
    joined_at TEXT NOT NULL,
    left_at TEXT,
    ok INTEGER NOT NULL DEFAULT 1,
    meta TEXT
);

CREATE INDEX IF NOT EXISTS idx_join_events_joined ON join_events(joined_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
);