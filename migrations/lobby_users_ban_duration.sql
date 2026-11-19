-- Cloudflare D1 metaverse-sim: timed bans + audit history (wrangler d1 execute metaverse-sim)
-- After apply, restart sim / verify GET /service/users/students includes banExpiresAt.

ALTER TABLE students ADD COLUMN ban_expires_at TEXT;
ALTER TABLE teachers ADD COLUMN ban_expires_at TEXT;

CREATE TABLE IF NOT EXISTS lobby_ban_history (
    id TEXT PRIMARY KEY,
    user_kind TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    actor TEXT,
    action TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ends_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lobby_ban_history_user
    ON lobby_ban_history (user_kind, user_id, created_at DESC);