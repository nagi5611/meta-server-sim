# WS-6: アセット配信（R2・chart-bgm・avatars/env/images）

## 目的

CloudFront 署名 URL 経路を廃止し、sim 標準の R2 テナント配信（`sign-asset-urls` + 静的ハンドラ）に統一。`/server_src` の非モデルアセットと chart-bgm をテナント構造へ載せる。

## 担当 ToDo

T04, T06, T03（GLB 実体）

## 所有範囲

- `lib/r2/constants.js`（`chart-bgm` store 追加等）
- `lib/tenant-world-admin.js`（chart-bgm storage roots）
- `lib/tenant-r2-sync.js`（chart-bgm 同期対象）
- `scripts/sync-meta-server-tenant-assets.mjs`（新規: env/images/pdfs/chart-bgm/avatars glb）
- `test/tenant-r2-chart-bgm.test.js`（軽量）

**触ってはいけない:** `meta/models/`、CloudFront キーファイルのコミット

## 依存

- WS-1 骨格
- WS-3 chart API（BGM URL 参照）
- WS-2 モデルミラー（またはローカル models 欠けを R2 で補完）

## インターフェース

| store | ローカル | R2 キー |
|-------|----------|---------|
| models | `tenants/meta-server/models/` | `.../models/` |
| chart-bgm | `tenants/meta-server/data/chart-bgm/` | `.../chart-bgm/`（store 名は PR で確定） |
| avatars | `tenants/meta-server/avatars/` | `.../avatars/` |
| env | `tenants/meta-server/env/` | `.../env/` |

`client-config.assetModels.signEndpoint` = `/{tenantId}/api/sign-asset-urls`（既存）

## 作業指示

### 共通制約

（計画書「共通制約」全文を遵守。）

### 手順

1. ブランチ `cursor/meta-tenant-ws6-assets-7179`。
2. SSH 読み取り: `/server_src/avatars/*.glb`, `/server_src/env`, `data/chart-bgm` — **コピーはスクリプト化**、大容量は git LFS 不要なら WS-8 でサーバー実行のみ。
3. chart-bgm 151MiB は **リポジトリに blob コミットしない**（サーバー sync スクリプトのみ）。
4. R2 有効時の配信パスが `models/monument.glb` 等で 200 になること（テストはモック）。
5. PR のみ。

### 完了条件

- PR + unit tests
- WS-8 用 runbook 1 節（sync コマンド列）