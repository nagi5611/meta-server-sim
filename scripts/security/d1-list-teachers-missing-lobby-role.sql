-- D1: lobby_role 未設定の教員一覧（wrangler d1 execute --remote）
SELECT id, username, display_name, lobby_role, email, created_at
FROM teachers
WHERE lobby_role IS NULL OR trim(lobby_role) = ''
ORDER BY id;