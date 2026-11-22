# WS-2: R2 モデルミラー（`meta/models/` → テナントキー）

## 目的

R2 上の共有プレフィックス `meta/models/`（bc-89ac0a70 が S3 から投入中）を**読み取りのみ**参照し、sim 標準キー `metaverse/tenants/meta-server/models/` へサーバーサイドコピーする。ワールドが参照する `models/*.glb` が R2 テナント配信で解決できるようにする。

## 担当 ToDo

T04（キー設計）, T05

## 所有範囲

- `scripts/r2-mirror-prefix-to-tenant-models.mjs`（新規）
- `lib/r2/r2-s3-client.js`（`CopyObjectCommand` 追加のみ・最小差分）
- `test/r2-mirror-prefix.test.js`（新規、モックまたは dry-run）
- `docs/meta-server-tenant-migration-plan.md`（ミラー仕様 1 段落追記可）

**触ってはいけない:** `meta/models/` への delete/put（スクリプトはソース側 read + 先方 copy のみ）、P-01 テナントキー

## 依存

- WS-1 で tenant ID 確定
- bc-89ac0a70 のコピー完了を待たず、**ListObjects できたオブジェクトから**順次コピー可能にする（マニフェスト `meta/models/_meta/s3-sync-manifest.json` があれば進捗表示）

## インターフェース

| 項目 | 値 |
|------|-----|
| ソースプレフィックス | `meta/models/`（**不変**） |
| 先プレフィックス | `{R2_KEY_PREFIX}/tenants/meta-server/models/` |
| 相対パス | ソースキーから `meta/models/` を除いた部分をそのまま先方に使用 |
| CLI | `node scripts/r2-mirror-prefix-to-tenant-models.mjs meta-server [--dry-run] [--limit N]` |

## 作業指示

### 共通制約

（計画書「共通制約」全文を遵守。特に R2 `meta/models/` 書き換え・削除禁止。）

### 手順

1. ブランチ `cursor/meta-tenant-ws2-r2-mirror-7179`。
2. `CopyObject` を `r2-s3-client.js` に追加（既存 `putObject` パターンに合わせる）。
3. ミラースクリプト:
   - `listObjects` で `meta/models/` をページング
   - 各オブジェクトを `headObject` で先方キーと比較（etag / size）— 同一なら skip
   - `--dry-run` でキー一覧のみ出力
4. テスト: キー変換関数のユニットテスト（`meta/models/foo.glb` → `metaverse/tenants/meta-server/models/foo.glb`）。
5. `.env.example` にコメント 1 行（実行は WS-8・認証情報は記載しない）。

### 完了条件

- PR（未マージ）
- dry-run のログ例を PR に貼れる（秘密なし）
- 本番 R2 での実行は **行わない**（WS-8）