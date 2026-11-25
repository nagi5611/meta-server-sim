# 管理 CONSOLE 再構築 — 移植対応表

基準: `docs/design/admin-console/` を土台に `public/admin-console/` を配置し、`/console/*` で配信（`/admin` ミドルウェアとのパス衝突回避）。`public/admin.html` から起動する。

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
| ダッシュボードチャート | `/admin/stats` + テナント接続数から生成した系列 | **部分**（履歴 API なし・現接続数ベースの近似） |
| プラットフォーム設定 | `admin-console-settings-mount.mjs` | **接続**（env PUT・network PUT JSON） |
| Tenant 追加 | `POST /admin/tenants` | 接続済み（簡易プロンプト） |
| ログインゲート `admin/admin1234` | HTTP Basic（サーバ） + `mt-app-boot.js` | 置換済み |
| ワールド編集 UI | `mt-editor.js` / `mt-world.js` / `mt-editor-state.js` | デザイン土台のみ |
| `setting.js` 本番保存・FDS・VDB・PDF・発着・ロック | `mt-design-world-edit-host.js` + `tenant-setting-editor.js` | **接続**（デザイン rail + `wed-root` ブリッジ） |
| アドオン切替 | `mt-addons-live.js` → enable/disable API | **接続** |

## ワールド編集機能（要継続移植）

| 本番 `admin-legacy-tenant-world-edit` + `setting.js` | 新 CONSOLE `mt-editor` | 状態 |
| --- | --- | --- |
| `worlds.json` GET/PUT | `setting.js` + tenant shims | **接続** |
| モデル / MTL / GLB アップロード | R2 shims + setting.js | **接続** |
| ライト・PDF・発着板・FDS・VDB・飛行機 | setting.js 各パネル | **接続** |
| 保存・ロック・競合 | setting.js | **接続** |
| `#canvas` Three 本番シーン | setting.js（`wed-root` レイアウト） | **接続** |

## テスト

| テスト | 対応 |
| --- | --- |
| `e2e/admin-panel-layout.spec.js` | 新 CONSOLE 向けに更新予定 |
| `e2e/tenant-world-edit.spec.js` P-01 | 本番エディタ DOM 前提 → デザインエディタ用に更新予定、保存試験は legacy または API のみ |

## 同期

`node scripts/sync-admin-console-design.mjs` で `docs/design/admin-console` → `public/admin-console`（`mt-data-live.js` / boot / bridge / extensions は手動維持）。