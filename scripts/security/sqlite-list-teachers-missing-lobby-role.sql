-- teachers: lobby_role 未設定（NULL または空）。適用前に admin 昇格対象を決める。
SELECT id, username, display_name, lobby_role, email, created_at
FROM teachers
WHERE lobby_role IS NULL OR trim(lobby_role) = ''
ORDER BY id;