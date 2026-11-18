# メタバースロビー（Cloudflare Pages + Worker）

デザインハンドオフ `design_handoff_metaverse-lobby` に基づく入口画面です。`metaverse-lobby/` を Cloudflare にデプロイし、各メタバース（本リポジトリのシミュレーションサーバー等）の状態を集約します。

## アーキテクチャ

| 層 | 役割 |
|----|------|
| **Pages（静的）** | ロビー UI。10 秒ごとに `GET /api/metaverses` をポーリング |
| **Worker（API のみ）** | `/api/*` — カタログ配信、管理同期、**1 分 Cron** で各 `statusUrl` を確認 |
| **カスタムドメイン** | 既定 `lobby.mmh-virtual.jp`（Pages）。`/api/*` は `_redirects` で Worker にプロキシ |
| **Durable Object `LobbyPoller`** | **10 秒**ごとに各 `presenceUrl` を叩き、オンライン人数を KV に集約 |
| **各メタバースサーバー** | `GET /api/lobby/status`（状態）、`GET /api/lobby/presence`（人数・要 `LOBBY_PRESENCE_SECRET`） |
| **管理 API** | `GET/PUT /admin/lobby-catalog`、tenant 作成・削除時に自動 upsert + Worker へ push |

## 表示名の引き継ぎ

ロビーで入力した表示名は、参加先 URL に `?displayName=` を付与します。テナント側 `tenant-lobby-entry.js` が `localStorage.username` に書き込み、既存のソケット入場フローでその名前が使われます。

## 環境変数（シミュレーションサーバー）

| 変数 | 用途 |
|------|------|
| `LOBBY_PRESENCE_SECRET` | Worker が presence API を叩くときの Bearer トークン |
| `LOBBY_WORKER_SYNC_URL` | 例: `https://metaverse-lobby.<account>.workers.dev/api/admin/sync`（sync は Worker 直 URL 推奨） |
| `LOBBY_WORKER_SYNC_SECRET` | sync POST の Bearer（Worker 側 `LOBBY_WORKER_SYNC_SECRET` と同一） |
| `LOBBY_MAINTENANCE=1` | ロビー向けにメンテ表示を強制 |

カタログ本体: `data/platform/lobby-catalog.json`

## Worker デプロイ

**自動（推奨）** — リポジトリルートで:

```bash
export CLOUDFLARE_API_TOKEN=…   # Account: Workers Scripts Edit + Workers KV Storage Edit + Account Settings Read
export CLOUDFLARE_ACCOUNT_ID=…    # 任意
bash scripts/lobby-provision-cloudflare.sh
```

生成された `LOBBY_*` はリポジトリ直下の `lobby-secrets.env`（または `LOBBY_SECRETS_OUTPUT`）に出力されます。sim 本番 `.env` にその3行を追記してください。

**GitHub Actions** — **Repository secrets** に `CLOUDFLARE_API_TOKEN`（必須）、`CLOUDFLARE_ACCOUNT_ID`、`LOBBY_PRESENCE_SECRET`、`LOBBY_WORKER_SYNC_SECRET`（sim `.env` と同一・ローテ禁止）を登録。初回ローカル provision のみ `LOBBY_ALLOW_SECRET_GENERATE=1` で自動生成可。**Environment secrets** は本 workflow では未使用（`environment:` 未指定のため）。Cursor アプリ Secret と同じ値を複製する。任意で `LOBBY_*`。成功時 **Artifacts** に `lobby-secrets.env`（3 日保存）。トークン未設定時はデプロイ step が notice を出してスキップ（緑）。

**手動**

```bash
cd metaverse-lobby
npm install
wrangler secret put LOBBY_WORKER_SYNC_SECRET
wrangler secret put LOBBY_PRESENCE_SECRET
npm run deploy:worker
npm run deploy:pages
```

**DNS（Xserver）** — `lobby.mmh-virtual.jp` を Cloudflare Pages のプロジェクト `metaverse-lobby` に CNAME 連携（Deploy ログまたは Dashboard に表示されるターゲット）。権威 DNS は ns1〜5.xserver.jp。Worker は workers.dev のまま、ブラウザ向け API は Pages 経由で同一オリジンになります。

## 本番 sim への反映

`cursor` SSH では `nagi` の home にアクセスできないため、**自宅サーバー上で root / nagi** が次を実行します:

```bash
# lobby-secrets.env をサーバーに安全にコピーしたうえで:
sudo LOBBY_ENV_FILE=/path/to/lobby-secrets.env bash /home/nagi/sim-server/meta-server-sim/scripts/lobby-production-apply.sh
```

または従来どおり `sudo /usr/local/bin/metasim-production-git-sync.sh` のあと、`.env` に `LOBBY_*` を追記して `sudo systemctl restart metasim-server`。

初回は管理画面から tenant を保存するか、`PUT /admin/lobby-catalog` でカタログを登録後、`POST /admin/lobby-catalog/sync`（設定 → ネットワーク）で Worker に反映します。

## 管理画面との連携

- **Tenant 新規作成** (`POST /admin/tenants`): ロビー項目を自動追加し、Worker sync を試行
- **Tenant 削除**: ロビー項目を削除
- **手動編集**: `GET/PUT /admin/lobby-catalog`