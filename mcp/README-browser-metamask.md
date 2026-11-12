# Browser + MetaMask MCP (`browser-metamask-mcp-server.js`)

Fleet Ops MCP（`fleet-ops-mcp-server.js`）と同様の **stdio MCP** です。Playwright で **テナントメタバース（localhost:3003 等）** と **MetaMask 拡張の通知 UI**（接続・署名・ネットワーク切替）を AI がスナップショット／クリックできます。

常駐デーモンや TCP ポートは **開きません**（Cursor / Claude Desktop が子プロセスとして起動）。

## 前提

| 項目 | 内容 |
|------|------|
| 開発サーバー | `npm run dev` → API **3002**, Vite **3003**（[e2e/README-agent-e2e.md](../e2e/README-agent-e2e.md) と同じ） |
| MetaMask | **アンパック済み**拡張ディレクトリ（`manifest.json` があるフォルダ） |
| ブラウザ | 既定 `channel: chrome`（Cloud Agent VM の Google Chrome）。拡張は **非 headless 推奨** |

### MetaMask 拡張の用意

1. [MetaMask releases](https://github.com/MetaMask/metamask-extension/releases) からソースを clone して `yarn build` する、または Chrome に入れた拡張の ID 配下を開発者モードでコピーする。
2. パスを環境変数に設定:

```bash
export METAMASK_EXTENSION_PATH=/path/to/metamask-extension/dist/chrome
```

初回はウォレット作成・解除が必要な場合があります（`userDataDir` に状態が残ります）。

## 環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `METAMASK_EXTENSION_PATH` | — | **必須**（`browser_session_start` 時） |
| `BROWSER_METAMASK_USER_DATA_DIR` | `.data/mcp-metamask-profile` | 永続プロファイル（拡張・ログイン状態） |
| `BROWSER_METAMASK_BASE_URL` | `http://127.0.0.1:3003` | `browser_navigate` の既定 URL |
| `BROWSER_METAMASK_HEADLESS` | 未設定（= headed） | `1` で headless（拡張は非推奨） |
| `BROWSER_METAMASK_CHANNEL` | `chrome` | Playwright `channel`（`chromium` に変更可） |

## 起動（npm script）

```bash
npm run mcp:browser-metamask
```

## Cursor 設定例（`.cursor/mcp.json`）

```json
{
  "mcpServers": {
    "metasim-browser-metamask": {
      "command": "node",
      "args": ["mcp/browser-metamask-mcp-server.js"],
      "cwd": "/path/to/meta-server-sim",
      "env": {
        "METAMASK_EXTENSION_PATH": "/path/to/metamask-extension/dist/chrome",
        "BROWSER_METAMASK_BASE_URL": "http://127.0.0.1:3003/P-01/"
      }
    }
  }
}
```

## 典型フロー（メタバース + MetaMask）

1. ターミナル: `npm run dev`
2. MCP: `browser_session_start`
3. MCP: `browser_navigate`（または既定で `/{tenantId}/`）
4. アプリ上で「ウォレット接続」等を押す（または `browser_app_click`）
5. MCP: `metamask_wait_notification` → スナップショット（`uiKind`: `connect` / `signature` / `network`）
6. MCP: `metamask_approve_connect` / `metamask_confirm` / `metamask_switch_network`
7. MCP: `browser_snapshot_app` でメタバース画面を再確認
8. 終了: `browser_session_close`

## ツール一覧

| ツール | 用途 |
|--------|------|
| `browser_metamask_config` | 設定確認（ブラウザは起動しない） |
| `browser_session_start` / `status` / `close` | セッション管理 |
| `browser_navigate` | メタバース URL へ遷移 |
| `browser_snapshot_app` | Dapp タブのスクショ・ボタン一覧 |
| `metamask_wait_notification` | 通知待ち + スナップショット |
| `metamask_snapshot` | 既存の MetaMask ページ |
| `metamask_click` | 任意ラベルクリック |
| `metamask_approve_connect` | Connect |
| `metamask_confirm` | Confirm / Sign |
| `metamask_switch_network` | Switch network |
| `browser_app_click` | Dapp 側ボタン |

スナップショットは JSON に `textPreview`, `buttonLabels`, `uiKind`, `screenshotBase64`（MCP image も返す）を含みます。

## Cloud Agent / Playwright E2E との関係

- **本 MCP**: Cursor から対話的にブラウザ + MetaMask を操作（人間の computer-use に近い）。
- **Playwright E2E**（`npm run test:e2e:agent`）: CI 向けスクリプト。MetaMask を載せる場合は同じ `METAMASK_EXTENSION_PATH` パターンを E2E の `launchPersistentContext` に流用可能（本 README の lib: `lib/mcp-browser-metamask.js`）。

## 本番（sim.mmh-virtual.jp）について

本番 HTTPS への接続も `browser_navigate` で可能ですが、**本番用 MetaMask ネットワーク・秘密鍵は MCP ログに載せない**こと。通常は **localhost dev** で検証してください。

## トラブルシュート

- `METAMASK_EXTENSION_PATH must point to...` → パスと `manifest.json` を確認。
- 通知が出ない → Dapp 側で接続操作後 `metamask_wait_notification`、headed モードを確認。
- `channel: chrome` 失敗 → `BROWSER_METAMASK_CHANNEL=chromium` と Playwright の `npx playwright install chromium`。
