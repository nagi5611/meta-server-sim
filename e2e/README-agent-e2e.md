# AI エージェント向けメタバース E2E

Cursor などのコーディングエージェントが **実際の localhost サーバー** に接続し、テナントメタバースへ入場・キー操作・移動確認まで行うための Playwright 基盤です。静的 DOM 断言だけでなく、`window.__tenantE2E` 経由の Socket / 座標を使った動作検証を想定しています。

## 前提

| 役割 | ポート | URL |
|------|--------|-----|
| Node API / Socket.io | **3002** | `http://localhost:3002/api/health` |
| Vite 開発入口（ブラウザはここ） | **3003** | `http://localhost:3003/P-01/` |

`playwright.config.js` の `webServer` が 3002 + 3003 を起動します。既に `npm run dev` 中なら `reuseExistingServer: true` で再利用されます。

## クイックスタート

```bash
# 依存インストール済み想定
npm run test:e2e:agent

# 画面を見ながら（エージェントのデバッグ向け）
npm run test:e2e:agent:headed

# 単体ファイル指定（エージェントがそのまま実行しやすい）
npx playwright test e2e/agent-metaverse-smoke.spec.js
npx playwright test e2e/agent-metaverse-smoke.spec.js --headed --debug
```

サーバーを手動で起動する場合:

```bash
npm run dev
# 別ターミナル
E2E_BASE_URL=http://localhost:3003 npx playwright test e2e/agent-metaverse-smoke.spec.js
```

`webServer` 自動起動を使わない場合は **3002 と 3003 の両方** が生きている必要があります。3003 だけでは API / Socket が通りません。

## 環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `E2E_BASE_URL` | `http://localhost:3003` | Playwright `baseURL` |
| `E2E_TENANT_ID` | `P-01` | テナント ID |
| `TENANT_SOCKET_SECRET` / `E2E_TENANT_SOCKET_JOIN` | 未設定 | Socket join シークレット有効時は E2E も同値を渡す（[docs/tenant-socket-join.md](../docs/tenant-socket-join.md)） |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `.env` / 開発用既定 | Basic 認証・管理 API |
| `E2E_HEADED` | 未設定 | `1` のとき `test:e2e:agent` をヘッド付きで実行（`package.json` スクリプト） |

## ファイル構成

| ファイル | 役割 |
|----------|------|
| `e2e/helpers/tenant-metaverse-agent.mjs` | エージェント向け操作 API（ログイン・入場・キー・Socket・デバッグ情報） |
| `e2e/helpers/tenant-metaverse.mjs` | 既存の低レベル harness（`__tenantE2E` 前提） |
| `e2e/agent-metaverse-smoke.spec.js` | 拡張用サンプル（ゲスト入場 → W キー → 座標変化） |

## E2E harness（ブラウザ側）

ページ読み込み**前**に `installTenantE2EHarness(page)` を呼ぶと:

- `document.documentElement.dataset.e2eHarness = '1'`
- `localStorage['metaverse-control-scheme'] = 'keyboard'`

初期化後に `window.__tenantE2E` が公開されます（`tenant-metaverse-app.js`）。主な API:

- `getSocket()` — Socket.io インスタンス
- `getLocalPosition()` — ローカルアバター座標
- `isPhysicsSuspended()` — 初回入力待ちの物理停止状態
- `holdMovementForE2e(axis, ms)` — 移動フラグを保持（`pressGameplayKeys` の長押しが内部利用。Playwright のキーだけでは歩行が不安定なため）
- `getCurrentWorldId()`, `switchToWorld(worldId)` など

## ヘルパー API（エージェント向け）

`tenant-metaverse-agent.mjs` の主な関数:

| 関数 | 用途 |
|------|------|
| `loginAsGuest(page, username?)` | `localStorage.username` を設定 |
| `loginAsAdmin(page, request)` | 管理 token + 表示名 |
| `enterWorld(page, opts?)` | harness → goto → ready → モーダル閉じ → 物理解除 → Socket 待ち |
| `dismissBlockingModals(page)` | 操作方式オーバーレイ・モーダル |
| `unlockGameplayPhysics(page)` | 初回 `KeyW` で IdleControlHint / spawn suspend を解除 |
| `pressGameplayKeys(page, keys, { holdMs })` | WASD 等 |
| `waitForSocketConnected(page)` | `__tenantE2E.getSocket().connected` |
| `getSceneDebugInfo(page)` | 座標・世界・Socket・プレイヤー数 |
| `waitForLocalMovement(page, minDelta)` | 移動量ポーリング |
| `requestPointerLockIfNeeded(page)` | 必要時のみ（headless では失敗しうる） |

### 典型的なエージェントフロー

```javascript
import { test, expect } from '@playwright/test';
import {
  enterWorld,
  pressGameplayKeys,
  getSceneDebugInfo,
} from './helpers/tenant-metaverse-agent.mjs';

test('my scenario', async ({ page }) => {
  await enterWorld(page, { developerMode: true });
  await pressGameplayKeys(page, ['KeyW', 'KeyD'], { holdMs: 800 });
  const info = await getSceneDebugInfo(page);
  expect(info.socketConnected).toBe(true);
});
```

## Cursor / AI エージェントへの指示例

エージェントに渡すプロンプト例:

1. リポジトリルートで `npm run test:e2e:agent` を実行する。
2. 失敗時は `test-results/` と trace を確認する。
3. 新シナリオは `e2e/agent-metaverse-smoke.spec.js` をコピーし、`enterWorld` と `pressGameplayKeys` を使う。
4. ブラウザ操作が必要なら `--headed` を付ける。
5. コミットはユーザーが依頼したときだけ行う。

## Storage state（任意）

ログイン状態を再利用する場合は Playwright の [storage state](https://playwright.dev/docs/auth) を利用できます。ゲスト名は `loginAsGuest` / `setGuestUsername` で `localStorage` に入れるため、多くのケースでは storage state は不要です。管理入場のみ `loginAsAdmin` + `storageState` の保存が有効です。

## トラブルシュート

| 症状 | 確認 |
|------|------|
| `data-tenant-metaverse-ready` が true にならない | 3002 ヘルス、`npm run dev`、コンソールの init エラー |
| Socket 未接続 | Vite 3003 経由か、テナント URL `/{tenantId}/` か |
| 移動しない | `unlockGameplayPhysics` / `pressGameplayKeys` で canvas フォーカス後に KeyW |
| `__tenantE2E` が無い | `installTenantE2EHarness` を **goto 前** に呼ぶ |
