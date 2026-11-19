# teachers の lobby_role 未設定（#48）

## 背景

教員（`teachers`）で `lobby_role` が NULL または空文字だった場合、従来はロビー上 **admin** 相当として扱われていました。修正後は **deny-by-default** で、未設定は `user`（一般メンバー）です。ロビー管理画面ログイン（`/service/lobby/admin-login`）や `lobbyRole === 'admin'` が必要な操作は、**明示的に `lobby_role = 'admin'` を設定したアカウントのみ**が利用できます。

## 適用順序（本番）

**コードデプロイより前**に、正当な管理者を DB 上で明示してください。デプロイ後に未設定のままだと、従来暗黙 admin だった教員はメンバーになり、管理操作に入れなくなります。

1. **一覧**: 未設定教員を洗い出す（下記スクリプト / SQL）。
2. **確認**: 運用担当（藤原）が「ロビー admin として残すべき教員」を決める（ユーザー名・id をメモ）。
3. **昇格（デプロイ前）**: 対象 id にだけ `lobby_role = 'admin'` を設定する SQL を実行。
4. **任意の正規化**: それ以外の NULL/空は `lobby_role = 'user'` に揃えてよい（デプロイ後も同じ結果になる）。
5. **デプロイ**: `main` の push による GitHub Actions（`deploy-metaverse-lobby.yml`）完了を待つ。
6. **検証**: 昇格した教員でロビー admin ログイン、一般教員は 403 `admin_required` になることを確認。

## SQLite（sim 本番 `data/users.db`）

リポジトリルートから:

```bash
./scripts/security/list-teachers-missing-lobby-role.sh
# または DB パス指定:
USERS_DB_PATH=/path/to/users.db ./scripts/security/list-teachers-missing-lobby-role.sh
```

管理者に昇格する例（**id は一覧で確認した値に置き換える**）:

```bash
sqlite3 data/users.db < scripts/security/promote-teachers-lobby-admin.sql
# 実行前に promote-teachers-lobby-admin.sql 内の id リストを編集すること
```

未設定を `user` に揃える（昇格 SQL の後、または admin 以外のみ）:

```bash
sqlite3 data/users.db < scripts/security/normalize-teachers-lobby-role-user.sql
```

## Cloudflare D1（metaverse-sim）

Wrangler が設定された環境で、まず一覧:

```bash
wrangler d1 execute metaverse-sim --remote --file=scripts/security/d1-list-teachers-missing-lobby-role.sql
```

昇格・正規化は `promote-teachers-lobby-admin-d1.sql` / `normalize-teachers-lobby-role-user-d1.sql` を **id を編集したうえで** `--remote` 実行。

## ロールバック方針

誤って admin を外した場合は、当該行だけ `UPDATE teachers SET lobby_role = 'admin' WHERE id = ?` で復旧できます（super-admin ヘッダ付き PATCH API が使える環境ではそちらでも可）。

## 関連コード

- `db/users-sqlite.js` — `rowToLobbyUser`
- `db/users.js` — D1 クエリ・`mapVerifiedUserRow`
- `lib/platform-lobby-auth-user.js` — 公開ログイン応答のロール