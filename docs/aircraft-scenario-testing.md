# 飛行機シナリオ検証（AI / Playwright）

## なぜブラウザ再生か

飛行物理は **クライアント**（`addons/aircraft/client/aircraft-controller-*.js`）で積分されます。サーバーは `player-update` の `aircraftPose` を保持し `players-update`（33ms）で同期するだけです。サーバー単体シミュレーションでは本番と同じ挙動になりません。

## シナリオ JSON（version 1）

| フィールド | 説明 |
|-----------|------|
| `id` | `^[a-zA-Z0-9_-]{1,64}$` |
| `controlMode` | `easy`（P-01 の A320 既定） |
| `slotId` | 任意。例: `p01-scenario-a320` |
| `steps[]` | `{ durationSec, controls: { thrust, yaw, pitch, roll } }` 各 -1..1 |
| `checkpoints[]` | `atTimeSec`, `expect`, `tolerance` |

`expect` の例:

- `deltaPosition` — 開始サンプルからの並進 (m)
- `minHeadingChangeDeg` — 開始方位からの変化（度）
- `minAltitudeGain` — 開始高度からの上昇 (m)
- `position` / `headingDeg` / `altitude` — 絶対値

## CLI

```bash
npm run dev   # 3002 + 3003
npm run aircraft:scenario -- scenarios/aircraft/p01-straight.json
E2E_BASE_URL=https://sim.mmh-virtual.jp npm run aircraft:scenario:p01
```

レポートは既定で `/opt/cursor/artifacts/aircraft-scenario-<id>-<ts>.json`。

## Playwright / `__tenantE2E`

| API | 用途 |
|-----|------|
| `runAircraftScenario(scenario)` | 搭乗→再生→レポート |
| `getAircraftDebugState()` | 位置・姿勢・速度 |
| `tryBoardAircraftSlot(slotId)` | 搭乗 |
| `getAircraftHud()` | 高度など |

Harness: ページ読み込み前に `dataset.e2eHarness=1`。

```bash
npm run test:e2e:aircraft-scenario
```

## MCP（任意）

`npm run mcp:browser-metamask` のツール `aircraft_run_scenario` で同一フローを実行できます（MetaMask 不要。既存ブラウザ MCP の拡張）。

## AI ループ例

1. シナリオ JSON を編集
2. `npm run aircraft:scenario -- <file>` → レポート JSON でズレ確認
3. 許容誤差または `steps` を調整
4. `npm run test:e2e:aircraft-scenario` で CI 相当の回帰