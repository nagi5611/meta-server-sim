-- Cloudflare D1 metaverse-sim: lobby world favorites (wrangler d1 execute metaverse-sim --remote --file=./migrations/lobby_world_favorites.sql)
-- Local sqlite: table also created on init via db/users-sqlite.js

CREATE TABLE IF NOT EXISTS lobby_world_favorites (
    user_ref TEXT NOT NULL,
    world_slug TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_ref, world_slug)
);

CREATE INDEX IF NOT EXISTS idx_lobby_world_favorites_user
    ON lobby_world_favorites (user_ref, created_at DESC);
