# ロビー公開 — Google OAuth（新規登録・ログイン）

公開ロビー（`metaverse-lobby`）の **新規登録** モーダルから Google でアカウントを作成できます。同じ OAuth フローで、既に `google_sub` が紐づいた利用者は **ログイン** として扱われます（メール/パスワード登録は変更なし）。

## Google Cloud コンソール

1. **APIs & Services → Credentials → OAuth client ID**（Web アプリケーション）
2. **Authorized redirect URIs**（コールバック）:
   - 本番例: `https://m.mmh-virtual.jp/api/auth/google/callback`
   - workers.dev 直叩き時: `https://metaverse-lobby.<account>.workers.dev/api/auth/google/callback`
3. **Scopes**（Worker が要求）: `openid`, `email`, `profile`

## Worker シークレット / 変数

| 名前 | 種別 | 用途 |
|------|------|------|
| `LOBBY_GOOGLE_CLIENT_ID` | Wrangler **var**（`wrangler.toml`、provision が上書き） | OAuth Client ID（公開値） |
| `LOBBY_GOOGLE_CLIENT_SECRET` | Wrangler **secret** | Client secret（リポジトリに入れない） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 互換 | GHA 旧名・provision が secret を二重投入 |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | 互換 | さらに古いデプロイ向け |
| `LOBBY_JWT_SECRET` | secret | OAuth `state` 署名とロビーセッション JWT |
| `LOBBY_SIM_SERVICE_TOKEN` | secret | Worker → sim `POST /service/lobby/auth/google` |

任意:

| 名前 | 用途 |
|------|------|
| `GOOGLE_OAUTH_REDIRECT_URI` | コールバック URL を固定（未設定時はリクエストの `Origin` + `/api/auth/google/callback`） |
| `LOBBY_PUBLIC_ORIGIN` | Pages 以外から Worker を直接叩くときのフォールバック Origin |

ローカル: `metaverse-lobby/.dev.vars` に上記を記載（`.dev.vars.example` 参照）。

```bash
cd metaverse-lobby
npx wrangler secret put LOBBY_GOOGLE_CLIENT_SECRET
```

**GitHub Actions**（Repository secrets、`deploy-metaverse-lobby.yml`）— **必須名（推奨）:**

- `LOBBY_GOOGLE_CLIENT_ID`
- `LOBBY_GOOGLE_CLIENT_SECRET`

互換: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`、`GOOGLE_OAUTH_CLIENT_ID`（variable 可）/ `GOOGLE_OAUTH_CLIENT_SECRET`。エージェントは GitHub Secrets を設定できないため、リポジトリ **Settings → Secrets and variables → Actions** で手動追加してください。

**Cursor Environment secrets**（Cloud Agent / ローカル provision）— 上記と**同じ名前・同じ値**を登録。

## sim 側（ユーザー DB）

マイグレーション（D1 metaverse-sim）:

```bash
npx wrangler d1 execute metaverse-sim --remote --file=./migrations/lobby_users_google_oauth.sql
```

- カラム: `students.google_sub`, `teachers.google_sub`（部分 UNIQUE インデックス）
- ローカル SQLite は起動時 `initSqliteUsersDb` が同カラムを追加

Worker コールバック後、sim の `completeLobbyGoogleAuth` が次を行います。

- `google_sub` 一致 → ログイン
- 同一メールの既存アカウント（パスワード登録含む）→ `google_sub` をリンクしてログイン
- 未登録 → 学生を新規作成（ランダム不可パスワードハッシュ、メール/パスワード登録は従来どおり利用可）

## API

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/auth/google/status` | `{ enabled, scopes }` — UI が Google ボタン表示可否 |
| GET | `/api/auth/google/start` | Google へ 302 リダイレクト |
| GET | `/api/auth/google/callback` | コード交換・セッション Cookie 発行→ `/` へリダイレクト |
| POST | `/service/lobby/auth/google` | sim のみ（Bearer `LOBBY_SIM_SERVICE_TOKEN`） |

## UI

- **新規登録**タブ: 「Google で登録」＋「または」区切りのメール/パスワードフォーム
- **ログイン**タブ: テキストリンク「Google でログイン」（`google_sub` 済み利用者向け）