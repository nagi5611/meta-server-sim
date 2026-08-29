# metaverse-simulation R2 ストレージ統合 — 分析レポート

**調査日:** 2026-08-29  
**出典:** `ScienceHUB` および `metaverse-simulation` リポジトリのソースコード直接調査

## 1. アーキテクチャ比較

| 観点 | ScienceHUB | metaverse-simulation（現行） | 移植後 |
|------|-----------|---------------------------|--------|
| ランタイム | Cloudflare Pages Functions | Express (Node.js) | Express 維持 |
| R2（サーバー側） | `R2Bucket` バインディング | なし | `@aws-sdk/client-s3` |
| R2（ブラウザ直） | `aws4fetch` presigned URL | なし | `aws4fetch`（同一） |
| セッション管理 | D1 | multer 一発 POST | JSON 永続化 + TTL |
| 認証 | OAuth | Basic Auth + CSRF | 既存維持 |
| キー設計 | `storage/u/{user}/...` | `tenants/P-01/models/...` | `metaverse/tenants/{id}/{store}/...` |

## 2. ScienceHUB アップロード（クラウドストレージ方式）

1. `POST upload/init` — セッション作成、R2 キー決定
2. `GET upload/url` — presigned PUT（≤30MB）
3. ブラウザ → R2 直 PUT（ETag 取得）
4. `GET upload/part-url` × N — マルチパート（>30MB）
5. `POST upload/complete` — 完了

定数: `MULTIPART_THRESHOLD=30MB`, `PART_SIZE=32MB`, `PRESIGN_EXPIRES_SEC=3600`

## 3. ScienceHUB ダウンロード

- `GET download/url` — `mode: direct`（presigned GET）または `proxy`
- `GET download` — Worker ストリーム（フォールバック）

## 4. metaverse-simulation 現行

- アップロード: multer memoryStorage → `fs.writeFileSync`
- 配信: `res.sendFile`（テナント URL 空間で公開）
- クライアント: `setting.js` が `/admin/upload` 等へ直接 POST

## 5. Express 移植の差分

| ScienceHUB | 移植先 |
|-----------|--------|
| R2 Binding | S3 互換 API |
| D1 セッション | `data/platform/r2-upload-sessions.json` |
| `/api/storage/*` | `/admin/tenants/:tenantId/r2-storage/*` |

## 6. R2 キー設計

| store | R2 キー例 |
|-------|----------|
| models | `metaverse/tenants/P-04/models/foo.glb` |
| pdfs | `metaverse/tenants/P-04/pdfs/doc.pdf` |
| images | `metaverse/tenants/P-04/images/bg.png` |
| env | `metaverse/tenants/P-04/env/default.hdr` |
| avatars | `metaverse/tenants/P-04/avatars/char.glb` |

`worlds.json` / `users.db` はローカル維持。

## 7. 環境変数

```
STORAGE_BACKEND=local|r2
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ACCOUNT_ID=
R2_BUCKET_NAME=metaverse-files
R2_KEY_PREFIX=metaverse
```

R2 CORS: `GET, PUT, HEAD` 許可、`ETag` を Expose。
