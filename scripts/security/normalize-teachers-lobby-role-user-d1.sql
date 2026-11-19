-- D1: NULL/空の lobby_role を user に正規化
UPDATE teachers
SET lobby_role = 'user'
WHERE lobby_role IS NULL OR trim(lobby_role) = '';