# vdb-volume（テナントプラグイン）

メタバース内に **NanoVDB**（`.nvdb`）および **OpenVDB**（`.vdb`、zip/blosc 圧縮含む）のスカラー密度グリッドをレイマーチ表示するアドオン。

## 形式の選定

| 形式 | 採用 |
|------|------|
| **NanoVDB** | 主対象（フラットバイナリ、ブラウザで `three-vdb-loader` によりパース可能） |
| **OpenVDB** | `three-vdb-loader` が同じ API で読めるため副次対応 |

OpenVDB 単体の木構造＋blosc はブラウザでは重いが、ローダー側でサポートされているため `.vdb` も指定可能。

## 描画方式

`three-vdb-loader` がアクティブボクセルを **Data3DTexture** に展開し、**BackSide Box + レイマーチ GLSL** で表示する。Beer–Lambert 透過、太陽方向のライトマーチ（自己影）、Henyey–Greenstein 位相、環境光、レイ開始ジッター、線形サンプリング。FDS の `VolumeRenderer` とは別パス。

## 有効化

1. 管理画面 → テナント **P-01**（など）→ **Plugins** → `vdb-volume` を有効化 → **Reload**
2. ワールド JSON に `vdbs` を追加（下記）
3. メタバースでそのワールドへ入場

## worlds.json 例（P-01 `school` にサンプル済み）

```json
"vdbs": [
  {
    "id": "cloud-demo",
    "file": "samples/cloud-cumulus.nvdb",
    "gridName": "density",
    "position": { "x": 22, "y": 4, "z": 18 },
    "worldScale": 2.2,
    "densityScale": 0.62,
    "raySteps": 72,
    "lightSteps": 10,
    "extinction": 1.35,
    "scattering": 0.9,
    "ambient": 0.2,
    "anisotropy": 0.58,
    "tint": [0.94, 0.97, 1.0],
    "sun": { "yaw": 48, "pitch": 62 }
  }
]
```

- `file`: `addons/vdb-volume/` からの相対パス（`/{tenantId}/addons-client/vdb-volume/...` で配信）
- `gridName`: 省略時 `density`
- `sun` / `sunDirection`: 太陽（自己影の向き）
- `tint`, `ambient`, `anisotropy`（HG の g）, `lightSteps` で見た目と負荷を調整

## サンプルデータ

- `samples/cloud-cumulus.nvdb` — 手続き生成の積雲型フォグボリューム（約 66KB、zlib 圧縮 NanoVDB。リポジトリ内 `scripts/gen-cloud-vdb.cpp` で生成、ライセンス: 本リポジトリ由来・再利用自由）
- `samples/smoke-0016.nvdb` — 煙検証用サンプル（約 93KB）

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