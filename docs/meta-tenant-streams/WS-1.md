# WS-1: テナント骨格・データ取込・lobby-catalog

## 目的

sim 形式でテナント `meta-server` のディレクトリ骨格をリポジトリに追加し、meta-server 稼働データ（読み取り専用 `/server_src`）からワールド・アバター registry を取り込む。lobby-catalog のエントリ定義をリポジトリ側に用意する（本番 JSON の上書きは WS-8）。

## 担当 ToDo

T01, T02, T03, T29, T21（registry 形式の整合のみ）

## 所有範囲（編集してよいパス）

- `tenants/meta-server/**`（**新規のみ**。P-01〜P-03 は触らない）
- `data/platform/lobby-catalog.example.json`（例の追記のみ）
- `test/meta-server-tenant-skeleton.test.js`（新規）
- 本 WS 専用 `scripts/provision-meta-server-tenant-from-src.mjs`（新規）

**触ってはいけない:** `tenants/P-0*`, `lib/*` の大規模変更, `addons/*`, 本番 SSH でのデプロイ

## 依存・順序

- **先行なし**（テナント ID `meta-server` は計画で固定済み）
- **後続:** WS-2（models）, WS-3（charts.json コピー）, WS-4（plugin enable）, WS-6（assets 同期）

## インターフェース

| 項目 | 値 |
|------|-----|
| tenant ID | `meta-server` |
| worlds | `tenants/meta-server/data/worlds.json` |
| avatars | `tenants/meta-server/avatars/_meta/avatars-registry.json` |
| lobby 例 ID | `tenant-meta-server` |

## 作業指示（自己完結）

### 共通制約

ジオラマは対象外。古い DB の生徒 3 人は移行しない。meta-server 本体（サービス・データ・`.env`・`nagi5611/meta-server` リポ）は読むだけ。ステージング確認後に本番反映（**本 WS ではデプロイしない**）。P-01〜P-03 のデータに触らない。CSP 変更禁止（unsafe-eval 不可）。秘密は平文で残さない。ステージング stash `pre-vdb-volume-cloud-deploy` に触らない。Dependabot PR #53–#65 はマージしない。スコープ外のサービス再起動なし。R2 `meta/models/` は書き換え・削除しない。

### 手順

1. ブランチ `cursor/meta-tenant-ws1-skeleton-7179` を `main` から作成。
2. SSH 読み取りのみ: `/server_src/data/worlds.json`, `/server_src/avatars/_meta/avatars-registry.json` を取得（**サービス停止・書き込み禁止**）。
3. `tenants/meta-server/tenant.json` を作成:
   ```json
   { "id": "meta-server", "displayName": "meta-server", "enabled": true }
   ```
4. ワールド JSON は sim 形式のまま取り込む（`path` は `models/...` のまま）。
5. アバター registry は sim/P-01 と同スキーマ（`schemaVersion`, `animationMap`）に揃える。GLB は WS-6 が配置；本 WS では `glbFilename` のみ一致させる。
6. `provision-meta-server-tenant-from-src.mjs`: 環境変数 `META_SRC_DIRECTORY`（既定 `/server_src`）から上記 2 ファイル + 空ディレクトリ `models/`, `env/`, `images/` を rsync **dry-run 対応**でコピーする Node スクリプト（本番実行は WS-8）。
7. `lobby-catalog.example.json` に staging/prod の `entryUrl` プレースホルダー付きエントリを追加。
8. 単体テスト: `tenant.json` id とディレクトリ名一致、`loadTenantFromDir` が通ること（`node --test`）。

### 完了条件

- PR 作成（マージはしない）
- CI `test:unit` 通過
- リポに `tenants/meta-server` が存在し、ワールド 3 件が JSON で確認できる
- 作業報告に「meta-server サービス・データ未変更」を明記