# 管理 CONSOLE 再構築 — 移植対応表

基準: `docs/design/admin-console/` を土台に `public/admin-console/` を配置し、`public/admin.html` から起動する。

## ルーティング

| 旧 | 新 |
| --- | --- |
| `/admin.html` | 同左（新 CONSOLE SPA） |
| `/admin-tenant.html` | `/admin/tenant/:id`（SPA） |
| `/admin/tenant/:id/world-edit` | 同左（SPA・デザイン `mt-editor`） |
| — | `/admin-legacy.html` / `/admin-legacy/tenant/...`（旧 UI 退避） |

## 画面・データ層

| デザイン / プロトタイプ | 本番実装 | 状態 |
| --- | --- | --- |
| `mt-data.js` モック | `mt-data-live.js` → `/admin/tenants`, `/admin/stats`, `/admin/tenants/:id/stats`, `/admin/tenants/:id/worlds`, `/admin/tenant/:id/plugins`, `/admin/users` | 接続済み（グラフ時系列はスタブ） |
| 通信ログライブストリーム | テナント `stats.traffic.topPaths` から行生成 | 部分（リクエスト履歴 API なし時はパス集計のみ） |
| 通信ログ（未データ） | 行に「未接続」 | 接続済み |
| 監査ログ | `/admin/users` | 部分（API 形状次第） |
| ダッシュボードチャート | `hourly` / `daily` スタブ | 未接続（実メトリクス未配線） |
| プラットフォーム設定 | `mt-platform-extensions.js` + `/admin/env-config` 等 | 部分（読取中心。保存 UI は旧 legacy へリンク） |
| Tenant 追加 | `POST /admin/tenants` | 接続済み（簡易プロンプト） |
| ログインゲート `admin/admin1234` | HTTP Basic（サーバ） + `mt-app-boot.js` | 置換済み |
| ワールド編集 UI | `mt-editor.js` / `mt-world.js` / `mt-editor-state.js` | デザイン土台のみ |
| `setting.js` 本番保存・FDS・VDB・PDF・発着・ロック | `mt-production-editor-bridge.js` | **未接続** — 本番機能は `/admin-legacy/tenant/:id/world-edit` で維持 |
| アドオン切替 | プロトタイプ UI | 読取のみ（POST 未配線の場合あり） |

## ワールド編集機能（要継続移植）

| 本番 `admin-legacy-tenant-world-edit` + `setting.js` | 新 CONSOLE `mt-editor` | 状態 |
| --- | --- | --- |
| `worlds.json` GET/PUT | プロトタイプ JSON パネル | 未接続 API |
| モデル / MTL / GLB アップロード | プロトタイプ D&D | 未接続 |
| ライト・PDF・発着板・FDS・VDB・飛行機 | プロトタイプオブジェクト型 | 見た目のみ |
| 保存・ロック・競合 | — | 未実装 |
| `#canvas` Three 本番シーン | デザイン Three ビューポート | 別実装 |

## テスト

| テスト | 対応 |
| --- | --- |
| `e2e/admin-panel-layout.spec.js` | 新 CONSOLE 向けに更新予定 |
| `e2e/tenant-world-edit.spec.js` P-01 | 本番エディタ DOM 前提 → デザインエディタ用に更新予定、保存試験は legacy または API のみ |

## 同期

`node scripts/sync-admin-console-design.mjs` で `docs/design/admin-console` → `public/admin-console`（`mt-data-live.js` / boot / bridge / extensions は手動維持）。