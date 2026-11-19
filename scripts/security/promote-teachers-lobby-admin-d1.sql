-- D1: 正当なロビー管理者だけ admin に昇格（wrangler d1 execute --remote --file=...）
-- IN (...) の id を編集してから実行。

UPDATE teachers SET lobby_role = 'admin' WHERE id IN (
    -- 999
);