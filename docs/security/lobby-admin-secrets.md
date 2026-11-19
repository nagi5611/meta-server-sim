# metaverse-lobby 管理系シークレットの分離

## 背景

公開ロビー JWT（`LOBBY_JWT_SECRET`）と管理画面セッション（`LOBBY_ADMIN_SESSION_SECRET`）、スーパー管理者 OTP の HMAC（`ADMIN_OTP_SECRET`）を同じ値で共有すると、1 件の漏洩で複数の認証境界が同時に危険になります。

Worker コードは用途別の環境変数を優先し、未設定時のみ従来どおりフォールバックします。フォールバック利用時は Workers ログに `[ADMIN_SECRETS]` 警告が 1 回だけ出ます。

## 各シークレットの役割

| 変数名 | 用途 | GHA（`deploy-metaverse-lobby.yml`） |
|--------|------|-------------------------------------|
| `LOBBY_JWT_SECRET` | ロビー利用者 JWT・Google OAuth state | 接続済み |
| `LOBBY_ADMIN_SESSION_SECRET` | 管理画面 cookie JWT（`lobby_admin_session`） | 接続済み |
| `ADMIN_OTP_SECRET` | スーパー管理者 SMS/メール OTP の HMAC | 接続済み（任意） |

解決順序（コード）:

- 管理セッション: `LOBBY_ADMIN_SESSION_SECRET` →（警告）→ `LOBBY_JWT_SECRET`
- OTP HMAC: `ADMIN_OTP_SECRET` →（警告）→ `LOBBY_ADMIN_SESSION_SECRET` →（警告）→ `LOBBY_JWT_SECRET`

## 推奨移行手順（オーナー作業）

本番でフォールバックがまだ使われているかは、デプロイ後の Workers ログで `[ADMIN_SECRETS]` を検索して確認してください。警告が出ていなければ、当該用途では専用シークレットが既に有効です。

### 1. 値の生成

各用途で **互いに異なる** ランダム文字列（32 バイト以上を hex 等で表現）を用意します。既存の `LOBBY_JWT_SECRET` をコピーしないでください。

### 2. GitHub Actions secrets

リポジトリ Settings → Secrets and variables → Actions で以下を確認または更新します（値はここに書かないこと）。

- `LOBBY_ADMIN_SESSION_SECRET`
- `ADMIN_OTP_SECRET`（OTP 2FA を使う場合は必須推奨）

`deploy-metaverse-lobby.yml` は push 時にこれらを Worker に渡します。

### 3. 手動プロビジョニング（スクリプト利用時）

```bash
cd metaverse-lobby
export LOBBY_ADMIN_SESSION_SECRET='…'
export ADMIN_OTP_SECRET='…'
# 既存: scripts/lobby-provision-cloudflare.sh が wrangler secret put を実行
```

### 4. 検証

1. `main` へマージ後のデプロイ完了を待つ。
2. Cloudflare Dashboard → Workers → 対象 lobby Worker → Logs で `[ADMIN_SECRETS]` が出ないことを確認。
3. 管理画面ログイン・（有効なら）スーパー管理者 OTP フローを一度実行し、セッションが発行されることを確認。

### 5. 将来のフォールバック削除（任意）

専用シークレットが本番で安定して設定され、ログに警告が出なくなったら、コードから `LOBBY_JWT_SECRET` へのフォールバック削除を別 issue で検討できます。削除前に必ず警告ログがゼロであることを確認してください。

## ローカル開発

`metaverse-lobby/.dev.vars.example` を `.dev.vars` にコピーし、`LOBBY_ADMIN_SESSION_SECRET` と必要なら `ADMIN_OTP_SECRET` を `LOBBY_JWT_SECRET` と別値に設定してください。