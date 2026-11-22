# WS-3: 譜面（チャート）機能 — sim テナント実装

## 目的

meta-server の太鼓譜面（`charts.json` + `chart-bgm/` + `/api/charts`）を **sim テナント単位**で動かす。現状 sim は `chartFeaturesEnabled: false` スタブのため、meta-server `server.js` の挙動を sim パターン（テナント `data/` + テナントルーター）に移植する。

## 担当 ToDo

T07, T08, T24（チャート関連 admin API）

## 所有範囲

- `lib/tenant-charts.js`（新規）
- `lib/tenant-chart-routes.js`（新規）
- `lib/tenant-api.js`（chart ルート登録・`client-config` の `chartFeaturesEnabled`）
- `lib/tenant-world-admin.js`（`GET .../charts` の 503 解除、chart-bgm store）
- `lib/tenant-storage-paths.js`（`CHARTS_PATH`, `CHART_BGM_DIR` 追加）
- `lib/r2/constants.js`（必要なら `chart-bgm` を `TENANT_STORES` に追加）
- `test/tenant-charts.test.js`
- `tenants/meta-server/data/charts.json`（WS-1 と調整: 本 WS で取込可）

**触ってはいけない:** CSP / helmet 緩和、P-01 の worlds

## 依存

- WS-1 の `DATA_DIR` パス
- WS-6 が chart-bgm を R2/ローカルに載せる（API は本 WS で先に実装可、BGM 実体は WS-6）

## インターフェース

| API | パス |
|-----|------|
| 一覧 | `GET /:tenantId/api/charts` |
| スコア | `POST /:tenantId/api/charts/:id/score` |
| ランキング | `GET /:tenantId/api/charts/:id/ranking` |
| データ | `tenants/{id}/data/charts.json` |
| BGM | `tenants/{id}/data/chart-bgm/` または R2 store `chart-bgm` |
| 有効化 | `ENABLE_CHART_FEATURES=1`（プラットフォーム env）またはテナント単位フラグ（実装方針を PR で決定） |

## 作業指示

### 共通制約

（計画書「共通制約」全文を遵守。）

### 手順

1. ブランチ `cursor/meta-tenant-ws3-charts-7179`。
2. meta-server から `/server_src/data/charts.json` を読み取り、テナント data に配置（**git に含めてよい**）。
3. `readCharts(tenant)` をテナントパス対応で実装。ランキングは **プロセス内メモリ**（meta と同様）でテナント ID ごとに分離。
4. `tenant-api.js` の `client-config` で `chartFeaturesEnabled` をフラグ連動。
5. `tenant-world-admin.js` の charts / chart-bgm エンドポイントを実装または WS-6 と分割 PR。
6. 単体テスト: charts 読込、404 chart id、スコア投稿・ランキング top 10。
7. **デプロイ・Playwright はしない**。

### 完了条件

- PR + `npm run test:unit` 通過
- P-01 でフラグ off のとき従来どおり 503/false であること（回帰テスト）