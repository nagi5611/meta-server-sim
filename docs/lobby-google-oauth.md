# ロビー公開 — Google OAuth（新規登録・ログイン）

公開ロビー（`metaverse-lobby`）の **新規登録** モーダルから Google でアカウントを作成できます。同じ OAuth フローで、既に `google_sub` が紐づいた利用者は **ログイン** として扱われます（メール/パスワード登録は変更なし）。

## Google Cloud コンソール

1. **APIs & Services → Credentials → OAuth client ID**（種別: **Web application**）
2. **Authorized JavaScript origins**（本番のみ）:
   - `https://m.mmh-virtual.jp`
3. **Authorized redirect URIs** — 本番 `m.mmh-virtual.jp` では **次の 1 行を完全一致で** 登録（末尾スラッシュ・`www`・別ホストは不可）:

   ```
   https://m.mmh-virtual.jp/api/auth/google/callback
   ```

   Worker が Google に送る `redirect_uri` は上記固定です（`wrangler.toml` の `GOOGLE_OAUTH_REDIRECT_URI` と本番 curl で確認済み）。Console にこの URI が無いと **Error 400: redirect_uri_mismatch** になります。

   ローカル / workers.dev 直叩き用（本番ホストと混同しないこと）:

   - ローカル wrangler: `http://127.0.0.1:8787/api/auth/google/callback`（または利用ポート）
   - workers.dev のみ: `https://metaverse-lobby.<account>.workers.dev/api/auth/google/callback`

4. **Scopes**（Worker が要求）: `openid`, `email`, `profile`

### 本番で送信中の redirect_uri を確認

```bash
curl -s -D - -o /dev/null 'https://m.mmh-virtual.jp/api/auth/google/start' \
  | awk -F'[?&]' '/^location:/ { for (i=1;i<=NF;i++) if ($i ~ /^redirect_uri=/) print $i }' \
  | sed 's/redirect_uri=//' | python3 -c "import sys,urllib.parse; print(urllib.parse.unquote(sys.stdin.read().strip()))"
# 期待: https://m.mmh-virtual.jp/api/auth/google/callback
```

`GET /api/auth/google/callback` は Worker 上に存在し、未完了フローでは `/?google_auth=error&google_error=invalid_state` へ 302 します（ルート欠落ではありません）。

## Worker シークレット / 変数

| 名前 | 種別 | 用途 |
|------|------|------|
| `GOOGLE_CLIENT_ID` | Wrangler **var**（`wrangler.toml`、provision が上書き） | OAuth Client ID（公開値） |
| `GOOGLE_CLIENT_SECRET` | Wrangler **secret** | Client secret（リポジトリに入れない） |
| `LOBBY_GOOGLE_CLIENT_ID` / `LOBBY_GOOGLE_CLIENT_SECRET` | 互換（Worker・provision がフォールバック読み取り） | 旧 GHA 名 |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | 互換（旧 Wrangler 名） | さらに古いデプロイ向け |
| `LOBBY_JWT_SECRET` | secret | OAuth `state` 署名とロビーセッション JWT |
| `LOBBY_SIM_SERVICE_TOKEN` | secret | Worker → sim `POST /service/lobby/auth/google` |

任意:

| 名前 | 用途 |
|------|------|
| `GOOGLE_OAUTH_REDIRECT_URI` / `LOBBY_GOOGLE_REDIRECT_URI` | コールバック URL を固定（本番は `https://m.mmh-virtual.jp/api/auth/google/callback`） |
| `LOBBY_PUBLIC_ORIGIN` / `LOBBY_PUBLIC_URL` | `redirect_uri` 未固定時のフォールバック Origin（`wrangler.toml` で `LOBBY_PUBLIC_ORIGIN`） |

ローカル: `metaverse-lobby/.dev.vars` に上記を記載（`.dev.vars.example` 参照）。

```bash
cd metaverse-lobby
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

GitHub Actions デプロイ時は Repository secrets **`GOOGLE_CLIENT_ID`** と **`GOOGLE_CLIENT_SECRET`** を設定（`deploy-metaverse-lobby.yml`）。互換として `LOBBY_GOOGLE_*` または variable `GOOGLE_OAUTH_CLIENT_ID` + secret `GOOGLE_OAUTH_CLIENT_SECRET` も provision が読み取れます。

## sim 側（ユーザー DB）

マイグレーション（D1 metaverse-sim）:

```bash
npx wrangler d1 execute metaverse-sim --remote --file=./migrations/lobby_users_google_oauth.sql
```

- カラム: `students.google_sub`, `teachers.google_sub`（部分 UNIQUE インデックス）
- ローカル SQLite は起動時 `initSqliteUsersDb` が同カラムを追加

OAuth コールバック後、Worker は sim に **peek**（`POST /service/lobby/auth/google/peek`）して新規か既存かを判定します。

| peek の `action` | 動作 |
|------------------|------|
| `login` / `link` | そのまま `POST /service/lobby/auth/google` でセッション発行 → `/?google_auth=ok` |
| `create` | **アカウントはまだ作らない**。短時間 JWT Cookie `lobby_google_pending` を発行 → `/?google_complete=1` |

新規（`create`）ではロビー UI が表示名モーダルを開き、利用者が送信すると Worker `POST /api/auth/google/complete` が Jev（表示名モデレーション）を通したうえで sim の `completeLobbyGoogleAuth` を呼びます（メール新規登録と同じポリシー）。

sim の `completeLobbyGoogleAuth` は次を行います。

- `google_sub` 一致 → ログイン
- 同一メールの既存アカウント（パスワード登録含む）→ `google_sub` をリンクしてログイン
- 未登録 → **送信された表示名**で学生を新規作成（ランダム不可パスワードハッシュ）

## API

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/auth/google/status` | `{ enabled, scopes }` — UI が Google ボタン表示可否 |
| GET | `/api/auth/google/start` | Google へ 302 リダイレクト |
| GET | `/api/auth/google/callback` | コード交換。既存はセッション Cookie、新規は pending Cookie → リダイレクト |
| GET | `/api/auth/google/pending` | 新規完了待ちの有無と表示名の提案 |
| POST | `/api/auth/google/complete` | 表示名送信 → Jev → sim 作成 → セッション Cookie |
| POST | `/service/lobby/auth/google/peek` | sim のみ — `{ action: create \| login \| link }` |
| POST | `/service/lobby/auth/google` | sim のみ — 作成・ログイン・リンク（新規は `displayName` 必須） |

## UI

- **新規登録**タブ: 「Google で登録」＋「または」区切りのメール/パスワードフォーム
- **ログイン**タブ: テキストリンク「Google でログイン」（`google_sub` 済み利用者向け）