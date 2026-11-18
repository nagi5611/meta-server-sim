# メタバースロビー（Cloudflare Pages + Worker）

デザインハンドオフ `design_handoff_metaverse-lobby` に基づく入口画面です。`metaverse-lobby/` を Cloudflare にデプロイし、各メタバース（本リポジトリのシミュレーションサーバー等）の状態を集約します。

## アーキテクチャ

| 層 | 役割 |
|----|------|
| **Pages（静的）** | ロビー UI。10 秒ごとに `GET /api/metaverses` をポーリング |
| **Worker** | カタログ配信、管理同期、**1 分 Cron** で各 `statusUrl` を確認 |
| **Durable Object `LobbyPoller`** | **10 秒**ごとに各 `presenceUrl` を叩き、オンライン人数を KV に集約 |
| **各メタバースサーバー** | `GET /api/lobby/status`（状態）、`GET /api/lobby/presence`（人数・要 `LOBBY_PRESENCE_SECRET`） |
| **管理 API** | `GET/PUT /admin/lobby-catalog`、tenant 作成・削除時に自動 upsert + Worker へ push |

## 表示名の引き継ぎ

ロビーで入力した表示名は、参加先 URL に `?displayName=` を付与します。テナント側 `tenant-lobby-entry.js` が `localStorage.username` に書き込み、既存のソケット入場フローでその名前が使われます。

## 環境変数（シミュレーションサーバー）

| 変数 | 用途 |
|------|------|
| `LOBBY_PRESENCE_SECRET` | Worker が presence API を叩くときの Bearer トークン |
| `LOBBY_WORKER_SYNC_URL` | 例: `https://lobby.example.workers.dev/api/admin/sync` |
| `LOBBY_WORKER_SYNC_SECRET` | sync POST の Bearer（Worker 側 `LOBBY_WORKER_SYNC_SECRET` と同一） |
| `LOBBY_MAINTENANCE=1` | ロビー向けにメンテ表示を強制 |

カタログ本体: `data/platform/lobby-catalog.json`

## Worker デプロイ

**自動（推奨）** — リポジトリルートで:

```bash
export CLOUDFLARE_API_TOKEN=…   # Workers Scripts Edit + KV Edit
export CLOUDFLARE_ACCOUNT_ID=…    # 任意
bash scripts/lobby-provision-cloudflare.sh
```

生成された `LOBBY_*` はリポジトリ直下の `lobby-secrets.env`（または `LOBBY_SECRETS_OUTPUT`）に出力されます。sim 本番 `.env` にその3行を追記してください。

**GitHub Actions** — リポジトリ Secrets に `CLOUDFLARE_API_TOKEN`（必須）、`CLOUDFLARE_ACCOUNT_ID`、固定したい場合は `LOBBY_PRESENCE_SECRET` / `LOBBY_WORKER_SYNC_SECRET` を登録し、workflow **Deploy metaverse-lobby Worker** を実行（`main` の `metaverse-lobby/` 変更でも自動）。

**手動**

```bash
cd metaverse-lobby
npm install
wrangler secret put LOBBY_WORKER_SYNC_SECRET
wrangler secret put LOBBY_PRESENCE_SECRET
npm run deploy
```

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