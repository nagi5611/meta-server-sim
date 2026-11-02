-- Optional: bench_users table (present in meta-server db/users.js init, not in data/users.db dump)
-- Run after metasim-users-import.sql if benchmarks need bench_users.

CREATE TABLE IF NOT EXISTS bench_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bench_users_run_id ON bench_users(run_id);
