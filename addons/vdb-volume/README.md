# vdb-volume（テナントプラグイン）

メタバース内に **NanoVDB**（`.nvdb`）および **OpenVDB**（`.vdb`、zip/blosc 圧縮含む）のスカラー密度グリッドをレイマーチ表示するアドオン。

## 形式の選定

| 形式 | 採用 |
|------|------|
| **NanoVDB** | 主対象（フラットバイナリ、ブラウザで `three-vdb-loader` によりパース可能） |
| **OpenVDB** | `three-vdb-loader` が同じ API で読めるため副次対応 |

OpenVDB 単体の木構造＋blosc はブラウザでは重いが、ローダー側でサポートされているため `.vdb` も指定可能。

## 描画方式

`three-vdb-loader` がアクティブボクセルを **Data3DTexture** に展開し、**BackSide Box + レイマーチ GLSL** で密度を表示（FDS の `VolumeRenderer` とは別パス。シーン内にメッシュとして配置）。

## 有効化

1. 管理画面 → テナント **P-01**（など）→ **Plugins** → `vdb-volume` を有効化 → **Reload**
2. ワールド JSON に `vdbs` を追加（下記）
3. メタバースでそのワールドへ入場

## worlds.json 例（P-01 `school` にサンプル済み）

```json
"vdbs": [
  {
    "id": "smoke-demo",
    "file": "samples/smoke-0016.nvdb",
    "gridName": "density",
    "position": { "x": 30, "y": 6, "z": 22 },
    "worldScale": 4,
    "densityScale": 0.12
  }
]
```

- `file`: `addons/vdb-volume/` からの相対パス（`/{tenantId}/addons-client/vdb-volume/...` で配信）
- `gridName`: 省略時 `density`

## サンプルデータ

- `samples/smoke-0016.nvdb` — `meta-server` の smoke-view 検証用サンプル（約 93KB、zlib 圧縮 NanoVDB）を同梱

## 依存

- npm `three-vdb-loader`（MIT、`addons/vdb-volume/client/vendor/` にコピー）

## 既知の制限

- ベクターグリッド・シーケンス再生は未対応（単一スカラーグリッドのみ）
- 大きい `.nvdb`（数十 MB）は展開にメモリと時間がかかる
- FDS 煙と同じ深度オクルージョンは未統合
- WebGL2 / `OES_texture_float` 環境が必要

## 単体テスト

```bash
node --test addons/vdb-volume/test/nanovdb-parse.test.js
```