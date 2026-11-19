-- SQLite: デプロイ前に正当なロビー管理者だけ admin に昇格する。
-- 下の IN (...) を実際の id に置き換えてから実行すること。
-- 例: sqlite3 data/users.db < scripts/security/promote-teachers-lobby-admin.sql

BEGIN TRANSACTION;

-- TODO: 運用担当が一覧で確認した id に置き換える
UPDATE teachers SET lobby_role = 'admin' WHERE id IN (
    -- 999
);

COMMIT;