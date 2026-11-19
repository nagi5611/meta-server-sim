# メタバースロビー（Cloudflare Pages + Worker）

デザインハンドオフ `design_handoff_metaverse-lobby` に基づく入口画面です。`metaverse-lobby/` を Cloudflare にデプロイし、各メタバース（本リポジトリのシミュレーションサーバー等）の状態を集約します。

## アーキテクチャ

| 層 | 役割 |
|----|------|
| **Pages（静的）** | ロビー UI。10 秒ごとに `GET /api/metaverses` をポーリング |
| **Worker（API のみ）** | `/api/*` — カタログ配信、管理同期、**1 分 Cron** で各 `statusUrl` を確認 |
| **カスタムドメイン** | 既定 `m.mmh-virtual.jp`（Pages）。`/api/*` は **Pages Functions** で Worker にプロキシ |
| **Durable Object `LobbyPoller`** | **10 秒**ごとに各 `presenceUrl` を叩き、オンライン人数を KV に集約 |
| **各メタバースサーバー** | `GET /api/lobby/status`（状態）、`GET /api/lobby/presence`（人数・要 `LOBBY_PRESENCE_SECRET`） |
| **管理 API** | `GET/PUT /admin/lobby-catalog`、tenant 作成・削除時に自動 upsert + Worker へ push |

## 表示名の引き継ぎ

ロビーで入力した表示名は、参加先 URL に `?displayName=` を付与します。テナント側 `tenant-lobby-entry.js` が `localStorage.username` に書き込み、既存のソケット入場フローでその名前が使われます。

参加確認（`POST /api/join-world`）では Worker が **Jev** で表示名を検査します（Secret `LOBBY_JEV_API_KEY`、vars は `metaverse-lobby/wrangler.toml`）。お知らせ翻訳用 `GEMINI_TRANSLATION_API_KEY` とは別です。

## 環境変数（シミュレーションサーバー）

| 変数 | 用途 |
|------|------|
| `LOBBY_PRESENCE_SECRET` | Worker が presence API を叩くときの Bearer トークン |
| `LOBBY_WORKER_SYNC_URL` | 例: `https://metaverse-lobby.<account>.workers.dev/api/admin/sync`（sync は Worker 直 URL 推奨） |
| `LOBBY_WORKER_SYNC_SECRET` | sync POST の Bearer（Worker 側 `LOBBY_WORKER_SYNC_SECRET` と同一） |
| `LOBBY_MAINTENANCE=1` | ロビー向けにメンテ表示を強制 |
| `LOBBY_SIM_SERVICE_TOKEN` | ロビー Worker → sim `/service/*` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`（Worker） | 公開ロビーの Google 新規登録・ログイン（[lobby-google-oauth.md](./lobby-google-oauth.md)） |
| `RESEND_API_KEY` | パスワード再設定メール（Resend） |
| `RESEND_FROM_EMAIL` | 送信元（例: `みんなでメタ <noreply@yourdomain.com>`） |
| `LOBBY_PASSWORD_RESET_URL` | 任意。再設定ページ URL（既定 `https://m.mmh-virtual.jp/reset-password.html`） |

### Google OAuth（ロビー登録・ログイン）

ブラウザは `GET /api/auth/google/start` → Google → `GET /api/auth/google/callback`（Pages が `/api/*` を Worker にプロキシ）。**新規** Google 利用者はコールバック後に表示名モーダル（`POST /api/auth/google/complete`）を経てから sim がアカウントを作成します。既存は従来どおり即ログイン。詳細は [lobby-google-oauth.md](./lobby-google-oauth.md)。

| 保存先 | 名前 | 備考 |
|--------|------|------|
| **GitHub Actions**（Repository secrets） | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 推奨。`deploy-metaverse-lobby` が provision へ渡す |
| **互換（GHA）** | `LOBBY_GOOGLE_CLIENT_ID`, `LOBBY_GOOGLE_CLIENT_SECRET` | 未設定時のフォールバック |
| **Cursor Environment secrets** | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`（または互換 `LOBBY_GOOGLE_*`） | ローカル provision / 手動デプロイ用 |
| **Cloudflare Worker** | var `GOOGLE_CLIENT_ID`、secret `GOOGLE_CLIENT_SECRET` | provision が GHA / 環境変数をマッピングして投入 |
| **任意** | `GOOGLE_OAUTH_REDIRECT_URI` / `LOBBY_GOOGLE_REDIRECT_URI` | 未設定時はリクエスト origin（本番は `wrangler.toml` で `https://m.mmh-virtual.jp/api/auth/google/callback` に固定） |
| **互換** | `GOOGLE_OAUTH_CLIENT_ID`（Actions variable 可）, `GOOGLE_OAUTH_CLIENT_SECRET` | 旧名。Worker コードと provision がフォールバック読み取り |

Google Cloud Console の OAuth クライアントで **承認済みリダイレクト URI** に `https://m.mmh-virtual.jp/api/auth/google/callback`（および staging の origin があれば同様）を登録してください。

`LOBBY_JWT_SECRET` も OAuth フロー（state JWT）に必須です（既存のロビー JWT と同じ Worker secret）。

### スーパー管理者（LOBBY_ADMIN）ログイン hardening

Worker 静的アカウント `LOBBY_ADMIN_USER` / `LOBBY_ADMIN_PASSWORD` は JWT に `superAdmin: true` を付与します（ロビー内 `lobbyRole: admin` の教師・学生とは別系統）。

| 保存先 | 名前 | 用途 |
|--------|------|------|
| **GitHub Actions** secrets | `ADMIN_PHONE` | **推奨。** スーパー管理者 OTP の SMS 送信先（`09012345678` / `07070379203` または `+819012345678` 形式。**`+811070…` のように国番号直後に余分な桁があるとデプロイまたは送信時に失敗**）。`ADMIN_PHONE` 設定時はメールより SMS が優先 |
| **GitHub Actions** secrets | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SNS_REGION` | SNS `Publish` 用（リージョン未設定時 Worker は `ap-northeast-1`）。SMS タイプは Transactional |
| **GitHub Actions** secrets | `ADMIN_EMAIL` | OTP 送信先（`ADMIN_PHONE` 未設定時のメールフォールバック） |
| **GitHub Actions** secrets | `ADMIN_OTP_SECRET` | 任意。OTP HMAC 用（未設定時は `LOBBY_ADMIN_SESSION_SECRET`） |
| **GitHub Actions** secrets | `RESEND_API_KEY` | メール OTP / パスワード再設定（sim の Resend と同じキーで可） |
| **Worker** var | `RESEND_FROM_EMAIL` | 任意。未設定時 `みんなでメタ <noreply@mmh-virtual.jp>` |
| **Worker** secrets | 上記 | `scripts/lobby-provision-cloudflare.sh` が投入 |

`ADMIN_PHONE` も `ADMIN_EMAIL` も未設定のときは OTP をスキップし、従来どおり即セッションです。

管理 UI は `POST /admin/api/login`（Cloudflare Pages → Worker `POST /api/admin/login`）を使います。パスワード誤りは **401** `invalid_credentials`。スーパー管理者で OTP 送信に失敗すると **503**（例: `admin_phone_invalid`, `otp_sms_not_configured`）または **502** `otp_sms_send_failed`。

試行は D1 `super_admin_login_events` に **クライアント IP + JST 時刻** を記録します。管理 UI のゲート（OTP 手順）と設定画面の監査表、サイドバーの「前回ログイン」に表示します。OTP は KV（TTL 10 分）にハッシュ保存します。

有効化確認: `GET /api/auth/google/status` → `{ "enabled": true }`。`/api/auth/google/start` は 302 で `accounts.google.com` へリダイレクト（未設定時 503 `google_oauth_not_configured`）。

カタログ本体: `data/platform/lobby-catalog.json`

## Worker デプロイ

**自動（推奨）** — リポジトリルートで:

```bash
export CLOUDFLARE_API_TOKEN=…   # Account: Workers Scripts Edit + Workers KV Storage Edit + Account Settings Read
export CLOUDFLARE_ACCOUNT_ID=…    # 任意
bash scripts/lobby-provision-cloudflare.sh
```

生成された `LOBBY_*` はリポジトリ直下の `lobby-secrets.env`（または `LOBBY_SECRETS_OUTPUT`）に出力されます。sim 本番 `.env` にその3行を追記してください。

**GitHub Actions** — **Repository secrets** に `CLOUDFLARE_API_TOKEN`（必須）、`CLOUDFLARE_ACCOUNT_ID`、`LOBBY_PRESENCE_SECRET`、`LOBBY_WORKER_SYNC_SECRET`（sim `.env` と同一・ローテ禁止）を登録。Google OAuth 利用時は推奨で `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`（互換 `LOBBY_GOOGLE_*` / 旧 `GOOGLE_OAUTH_*`）。初回ローカル provision のみ `LOBBY_ALLOW_SECRET_GENERATE=1` で自動生成可。**Environment secrets** は本 workflow では未使用（`environment:` 未指定のため）。成功時 **Artifacts** に `lobby-secrets.env`（3 日保存）。トークン未設定時はデプロイ step が notice を出してス

**手動**

```bash
cd metaverse-lobby
npm install
wrangler secret put LOBBY_WORKER_SYNC_SECRET
wrangler secret put LOBBY_PRESENCE_SECRET
npm run deploy:worker
npm run deploy:pages
```

**DNS（Xserver）** — `m.mmh-virtual.jp` を Cloudflare Pages のプロジェクト `metaverse-lobby` に CNAME 連携（Deploy ログまたは Dashboard に表示されるターゲット）。別ホストにしたい場合は `LOBBY_CUSTOM_HOSTNAME` を指定。権威 DNS は ns1〜5.xserver.jp。Worker は workers.dev のまま、ブラウザ向け API は Pages 経由で同一オリジンになります。

## sim ユーザー BAN（期限・履歴）

D1 / ローカル `users.db` に次を適用します。

```bash
npx wrangler d1 execute metaverse-sim --remote --file=./migrations/lobby_users_ban_duration.sql
```

- カラム: `students.ban_expires_at`, `teachers.ban_expires_at`（`NULL` = 永久 BAN）
- テーブル: `lobby_ban_history`（who / action / started_at / ends_at）
- 管理 UI: `metaverse-lobby/public/admin/panel.js`（ユーザー → BAN 期限・履歴）
- サービス API: `PATCH /service/users/:kind/:id`（`banned`, `banExpiresAt`, `actor`）、`GET .../ban-history`

期限切れ BAN は sim 読み取り時に自動解除され、履歴に `expire` が残ります。

## 本番 sim への反映

`cursor` SSH では `nagi` の home にアクセスできないため、**自宅サーバー上で root / nagi** が次を実行します:

```bash
# lobby-secrets.env をサーバーに安全にコピーしたうえで:
sudo LOBBY_ENV_FILE=/path/to/lobby-secrets.env bash /home/nagi/sim-server/meta-server-sim/scripts/lobby-production-apply.sh
```

または従来どおり `sudo /usr/local/bin/metasim-production-git-sync.sh` のあと、`.env` に `LOBBY_*` を追記して `sudo systemctl restart metasim-server`。

初回は管理画面から tenant を保存するか、`PUT /admin/lobby-catalog` でカタログを登録後、`POST /admin/lobby-catalog/sync`（設定 → ネットワーク）で Worker に反映します。

### 一覧がすべて「診断中」（`degraded`）のとき

`statusUrl` / `presenceUrl` は **テナントパスではなく** `entryUrl` の origin 直下（例: `https://sim.mmh-virtual.jp/api/lobby/status`）です。誤 URL が KV に残っていると `pollStatus` が失敗し `degraded` のままになります。

**復旧（sim 本番）**

1. sim 管理の **ロビーカタログ同期**（`POST /admin/lobby-catalog/sync`）— 内部で Worker へ `POST /api/admin/sync` し、正規化した registry を KV に書き込み、直後に `pollStatus` を実行します。
2. または Worker 直 URL に Bearer `LOBBY_WORKER_SYNC_SECRET` で同期:

```bash
curl -sS -X POST "https://metaverse-lobby.<account>.workers.dev/api/admin/sync" \
  -H "Authorization: Bearer $LOBBY_WORKER_SYNC_SECRET" \
  -H "Content-Type: application/json" \
  --data-binary @data/platform/lobby-catalog.json
```

（ペイロードは `buildLobbyWorkerRegistry` 形式: `{ "metaverses": [...], "updatedAt": "..." }`）

3. `GET https://m.mmh-virtual.jp/api/metaverses` で `status` が `online` になり `statusAt` が更新されることを確認。

Worker は **1 分 Cron** に加え、Durable Object ポーラーが約 60 秒ごとに `pollStatus` をバックアップ実行します。presence が成功したテナントは `degraded` から自動で `online` に戻ります（メンテ・イベント中を除く）。

## Pages ロビー管理パネル（デザイン handoff）

- URL: **`https://m.mmh-virtual.jp/admin/`**（静的 UI + localStorage モック）
- ソース: `metaverse-lobby/public/admin/`
- バックエンド連携一覧: [`docs/metaverse-lobby-admin-integration.md`](metaverse-lobby-admin-integration.md)

sim 本番の Tenant / env 管理は従来どおり **`https://sim.mmh-virtual.jp/admin/`**。

## 管理画面との連携（sim API）

- **Tenant 新規作成** (`POST /admin/tenants`): ロビー項目を自動追加し、Worker sync を試行
- **Tenant 削除**: ロビー項目を削除
- **手動編集**: `GET/PUT /admin/lobby-catalog`