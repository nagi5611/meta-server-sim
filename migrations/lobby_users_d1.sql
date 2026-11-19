-- Cloudflare D1 metaverse-sim: lobby admin flags (run via wrangler d1 execute)
ALTER TABLE students ADD COLUMN banned INTEGER DEFAULT 0;
ALTER TABLE students ADD COLUMN lobby_role TEXT DEFAULT 'user';
ALTER TABLE students ADD COLUMN email TEXT DEFAULT '';
ALTER TABLE teachers ADD COLUMN banned INTEGER DEFAULT 0;
ALTER TABLE teachers ADD COLUMN lobby_role TEXT DEFAULT 'admin';
ALTER TABLE teachers ADD COLUMN email TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN avatar_url TEXT DEFAULT '';
ALTER TABLE teachers ADD COLUMN avatar_url TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_kind TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens (user_kind, user_id);