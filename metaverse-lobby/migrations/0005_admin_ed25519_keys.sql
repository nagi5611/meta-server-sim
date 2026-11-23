-- スーパー管理者 Ed25519 公開鍵（複数登録可）
CREATE TABLE IF NOT EXISTS admin_ed25519_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public_key_b64 TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  disabled_at TEXT,
  created_ip TEXT,
  created_ua TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_ed25519_keys_active
  ON admin_ed25519_keys (disabled_at, created_at);