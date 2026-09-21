# テナントメインメニュー E2E 検証環境

テナントメニュー全機能（Phase 0–6）向けの Playwright 検証スイートです。

## 実行方法

```bash
# メニュー専用スイート（推奨）
npm run test:e2e:tenant-menu

# 単体テスト
npm run test:unit
```

`playwright.config.js` が Node (3002) と Vite (3003) を自動起動します。既に `npm run dev` 中なら `reuseExistingServer: true` で再利用されます。

## 環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `E2E_BASE_URL` | `http://localhost:3003` | ブラウザ入口（Vite） |
| `E2E_TENANT_ID` | `P-01` | 検証テナント |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `.env` 参照 | 管理 API・Basic 認証 |
| `GEMINI_API_KEY` | 未設定可 | 設定時はチャット配信テストが有効 |

## テスト構成

| ファイル | 内容 |
|----------|------|
| `e2e/tenant-menu-system.spec.js` | メニュー全機能（16 ケース） |
| `e2e/tenant-menu.global-setup.js` | 起動前ヘルスチェック |
| `e2e/helpers/tenant-metaverse.mjs` | ブラウザ共通ヘルパー |
| `e2e/helpers/tenant-socket.mjs` | Node Socket.io（VC サーバー検証） |

## FDS smoke E2E

Fugaku 由来の FDS 煙 ZIP を管理 API／ワールド編集で扱い、テナントメタバースでボリュームが読めることを検証するスイートです。`tenant-menu` プロジェクトには含まれません（既定の Playwright プロジェクトで実行）。

### 前提

| 項目 | 内容 |
|------|------|
| テナント | `P-01`（`fugaku-prod01` 系はコード上固定。`E2E_TENANT_ID` はメニュー系ヘルパーのみ参照） |
| 管理認証 | `ADMIN_USERNAME` / `ADMIN_PASSWORD`（Basic + 管理 API） |
| Fugaku ZIP | 未登録時は `upload-fds-smoke-zip` で自動投入。ZIP が無い場合は先にエクスポートする |
| ロビー配置 | `tenant-fugaku-prod01-smoke.spec.js` の 1 本目が world-edit で Lobby に `fugaku-prod01` を追加・保存。2 本目（メタバース表示）は `lobby.fdsSmokes` に該当エントリが必要 |

ZIP の既定パス:

`tenants/P-01/data/simulations/fugaku-prod01.zip`

生成コマンド（Python スクリプト）:

```bash
npm run export:fugaku-prod01-smoke
```

別パスを使う場合は `FUGAKU_SMOKE_ZIP` に ZIP の絶対パスを指定する。

### 実行コマンド

```bash
# 全体（FDS 関連 3 ファイル）
npx playwright test e2e/tenant-fugaku-prod01-smoke.spec.js e2e/tenant-fds-smoke-head-debug-ball.spec.js e2e/tenant-fds-smoke-upload.spec.js

# fugaku-prod01: ロビー配置 → メタバースでマニフェスト・パート取得（順序依存。ファイル単位なら describe 内の順で実行）
npx playwright test e2e/tenant-fugaku-prod01-smoke.spec.js

# ヘッドデバッグ球（開発者モード・school ワールド）
npx playwright test e2e/tenant-fds-smoke-head-debug-ball.spec.js

# アップロード API 中心（ブラウザで煙ボリュームは表示しない）
npx playwright test e2e/tenant-fds-smoke-upload.spec.js
```

`playwright.config.js` の `webServer` により Node (3002) と Vite (3003) が起動する。`npm run dev` 実行中は `reuseExistingServer: true` で再利用される。

関連 npm スクリプト（E2E 専用ラッパーは無し）:

| スクリプト | 用途 |
|------------|------|
| `npm run test:e2e` | 全 Playwright（FDS 含む） |
| `npm run export:fugaku-prod01-smoke` | Fugaku prod01 煙 ZIP 生成 |
| `npm run export:fds-smoke` | 汎用 FDS smoke エクスポート（別用途） |

### 環境変数（FDS 追加分）

| 変数 | 既定 | 説明 |
|------|------|------|
| `FUGAKU_SMOKE_ZIP` | `tenants/P-01/data/simulations/fugaku-prod01.zip` | `fugaku-prod01` 投入用 ZIP |
| `E2E_BASE_URL` | `http://localhost:3003` | 上表「環境変数」と同じ |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `.env` 参照 | 上表と同じ |

### ファイルと役割

| ファイル | 内容 |
|----------|------|
| `e2e/tenant-fugaku-prod01-smoke.spec.js` | **目的**: Fugaku `fugaku-prod01` 煙を Lobby に配置し、テナント URL で multipart マニフェスト・大容量 `.uint8.bin` パートが取得できること、コンソールに manifest 失敗が出ないこと。**ケース**: (1) world-edit UI で Lobby に追加・座標保存・API で `worlds.json` 確認 (2) `/{tenant}/` でメタバース起動後ネットワーク・ログ検証 |
| `e2e/tenant-fds-smoke-head-debug-ball.spec.js` | **目的**: 開発者モードで FDS 煙ヘッド用デバッグメッシュ（`fds-smoke-head-debug`）が **1 台だけ** 見えること、露出 HUD が出ること。**前提**: `school` に `fdsSmokes` が既にあること、ZIP は fugaku 系と同様に未登録なら API 投入、`__tenantE2E` harness 使用 |
| `e2e/tenant-fds-smoke-upload.spec.js` | **スコープ**: メタバース表示は行わず、**管理 API** の FDS smoke ZIP アップロード（有効 ZIP・一覧・不正 ZIP 400・削除）、`storage-files?store=simulations`、world-edit の `fds-smoke-sim-id` pattern が RegExp エラーにならないこと |

タイムアウトが長い（最大 600s）テストがあるため、CI では余裕を持った設定を推奨する。

## 検証範囲

- **UI**: メニューバー、設定・ヘルプ・リスタート・退出モーダル
- **チャット**: スタンプ同期、Gemini 有無によるチャット送受信
- **VC**: `vc-join` / `video-vc-join`（Socket 経由）、ビデオモーダル
- **字幕**: ボタン表示
- **管理者**: token 発行、admin メニュー、透明化同期
- **ヘルス**: Socket 接続・プレイヤー数

## E2E harness

ブラウザテストでは `data-e2e-harness="1"` 時に `window.__tenantE2E` を公開します（`tenant-metaverse-app.js`）。
