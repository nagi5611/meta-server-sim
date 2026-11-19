-- SQLite: NULL/空の lobby_role を user に正規化（admin 昇格 SQL の後に実行推奨）
BEGIN TRANSACTION;
UPDATE teachers
SET lobby_role = 'user'
WHERE lobby_role IS NULL OR trim(lobby_role) = '';
COMMIT;