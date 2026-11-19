CREATE TABLE IF NOT EXISTS super_admin_login_events (
    id TEXT PRIMARY KEY,
    client_ip TEXT,
    event_at_jst TEXT NOT NULL,
    event_at_utc TEXT NOT NULL,
    outcome TEXT NOT NULL,
    detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_super_admin_login_events_at
    ON super_admin_login_events(event_at_utc DESC);