-- metasim users.db → Cloudflare D1 (database: metaverse-sim)
-- Target D1 UUID: d2102b3c-e357-479f-befc-a22cc0ddcd96
--
-- Source: meta-server/data/users.db (.dump), adjusted for D1 / wrangler d1 execute
-- Changes from raw sqlite3 .dump:
--   - Removed PRAGMA foreign_keys and wrapping TRANSACTION (D1 batch executes per statement)
--   - DROP IF EXISTS for idempotent re-import on empty or dev DB
--   - Explicit column lists on INSERT
--   - sqlite_sequence updated after row inserts (preserves AUTOINCREMENT counters)
--
-- Apply (remote):
--   npx wrangler d1 execute metaverse-sim --remote --file=./scripts/d1/metasim-users-import.sql
--
-- Apply (local miniflare DB):
--   npx wrangler d1 execute metaverse-sim --local --file=./scripts/d1/metasim-users-import.sql

DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS teachers;

CREATE TABLE students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO students (id, username, password_hash, display_name, created_at) VALUES
    (2, 'test1', '$2b$10$nWBOs6nCOvFF/7v5gH.WJ.gHgsZyyLQIrzYur1qdIZNBUOVt7z7Rm', 'test1', '2026-02-16 12:49:52'),
    (1999, 'test0999', '$2b$10$3XQUtTF8CQwdNGsOIutHvukerQat5t8MEOrXbJ1e7Eq9Y7pI22oK2', 'test0999', '2026-02-16 13:48:00'),
    (2000, 'test1000', '$2b$10$9d7wgZWZaxL8RUws//TMF.eISq/JxOUwOsuH2qpiGMFcU/NZh1p0m', 'test1000', '2026-02-16 13:48:00');

INSERT INTO teachers (id, username, password_hash, display_name, created_at) VALUES
    (1, 'teacher@example.com', '$2b$10$Z6BrzzWIExWe4UvIPYVFA.YrGX/q4Sua3z.342hy2CKricP2vyfgm', 'Test Teacher', '2026-02-15 20:53:57');

INSERT INTO sqlite_sequence (name, seq) VALUES ('students', 2000);
INSERT INTO sqlite_sequence (name, seq) VALUES ('teachers', 1);
