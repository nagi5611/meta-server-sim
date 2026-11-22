# WS-9: 太鼓譜面プレイのクライアント

## 目的

WS-3（譜面 API）・WS-6（chart-bgm 配信）に対し、テナント入場クライアントに太鼓の接近検知・選曲・ノーツ・BGM/ヒット音・スコア送信を実装する。

## 依存

- main にマージ済み: WS-3 / WS-6
- metaverse-simple: `scene-manager` / `teleport-manager` の太鼓ゾーン（本番 sibling と同内容）

## 変更概要

| 領域 | ファイル |
|------|----------|
| クライアント | `public/js/tenant-taiko-game-manager.js`, `tenant-chart-bgm-fetch.js`, `tenant-metaverse-app.js`, `tenant.html`, `public/css/tenant-taiko.css` |
| Socket | `lib/tenant-taiko-socket.js`, `lib/tenant-socket.js` |
| 静的 | `lib/tenant-api.js`（`/music`）、`public/music/don_.mp3`, `ka_.mp3`, `public/images/*` |
| テスト | `test/tenant-taiko-socket.test.js`, `e2e/tenant-taiko-chart.spec.js` |

`chartFeaturesEnabled: false` のテナントではマネージャを読み込まず従来どおり。