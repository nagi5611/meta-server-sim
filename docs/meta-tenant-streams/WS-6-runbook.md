# WS-6 / WS-8: meta-server テナント非モデルアセット同期

**前提（マージ順）:** WS-3（chart-bgm store・`/{tenantId}/chart-bgm/*`）→ 本 PR（WS-6）→ WS-1 骨格 → WS-2 モデルミラー。

**本番作業は WS-8 のみ。** 以下は sim サーバー上で `cursor` / `nagi` が実行するコマンド列。R2 への実書き込みは `STORAGE_BACKEND=r2` かつ認証済み `.env` がある場合のみ。

## 1. ローカルテナントへ取込（/server_src → `tenants/meta-server`）

```bash
cd /home/nagi/sim-server/meta-server-sim   # 本番パスに読み替え

# WS-1: worlds.json / avatars-registry（骨格）
META_SRC_DIRECTORY=/server_src node scripts/provision-meta-server-tenant-from-src.mjs --dry-run
META_SRC_DIRECTORY=/server_src node scripts/provision-meta-server-tenant-from-src.mjs

# WS-6: env / images / pdfs / chart-bgm（約151MiB）/ 既定アバター GLB
META_SRC_DIRECTORY=/server_src node scripts/sync-meta-server-tenant-assets.mjs --dry-run
META_SRC_DIRECTORY=/server_src node scripts/sync-meta-server-tenant-assets.mjs
```

**載せないもの:** `plane/`・aircraft 関連、`models/`（WS-2）、ジオラマ、P-01〜P-03 テナント。

## 2. R2 ミラー（models は WS-2、それ以外は一括 migrate）

```bash
# WS-2: meta/models → tenants/meta-server/models（キーはテナント models store）
TENANT_ID=meta-server node scripts/r2-mirror-prefix-to-tenant-models.mjs --dry-run
TENANT_ID=meta-server node scripts/r2-mirror-prefix-to-tenant-models.mjs

# WS-6: pdfs / images / env / avatars / chart-bgm
STORAGE_BACKEND=r2 node scripts/migrate-tenant-assets-to-r2.mjs meta-server

# 差分のみ再同期（運用）
# Node API: lib/tenant-r2-sync.js reconcileTenantAssetsToR2（chart-bgm 含む）
```

## 3. 検証（読み取り）

| 種別 | 公開 URL 例（R2 有効時も同一オリジン） |
|------|----------------------------------------|
| models | `GET /meta-server/models/monument.glb` |
| env | `GET /meta-server/env/default.hdr` |
| avatars | `GET /meta-server/avatars/avatar_v_momj3una_13923a4c0b.glb` |
| chart-bgm | `GET /meta-server/chart-bgm/{chartId}.mp3`（`chartFeaturesEnabled` 要） |
| 署名バッチ | `POST /meta-server/api/sign-asset-urls` body `{ "paths": ["models/foo.glb"] }` |

CloudFront 署名 URL は使用しない（sim R2 presign のみ）。

## 4. 本番実測（2026-11-22 SSH 読み取り `/server_src`）

| ストア | ファイル数 | サイズ |
|--------|-----------|--------|
| avatars (*.glb) | 1 | 16M |
| env | 1 | 1.4M |
| images | 0 | 4K（空） |
| pdfs | 4 | 2.2M |
| chart-bgm | 58 | 151M |