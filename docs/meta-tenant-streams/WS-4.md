# WS-4: アドオン・プラグイン・飛行機（sim 形式）

## 目的

meta-server の有効アドオンを sim の **tenant_plugins.db** 形式に写し、legacy meta `aircraft` を sim `addons/aircraft` プラグインに置き換える。ワールド内の松山・煙・WebXR 等がテナント入場後に動く状態にする。

## 担当 ToDo

T11–T17

## 所有範囲

- `scripts/enable-tenant-plugins.mjs`（新規: SQLite へ `meta-server` 行を INSERT）
- `db/tenant-plugins-registry.js`（読み取りのみ想定、変更は最小）
- `addons/aircraft/**`（meta-server 互換が足りない場合のみ最小修正）
- `test/tenant-plugins-meta-server.test.js`
- ドキュメント `docs/tenant-plugins.md`（meta-server 行の追記）

**触ってはいけない:** meta-server の `addons_registry.db`、P-01 の plugin 行

## 依存

- WS-1（tenant 存在）

## インターフェース（meta-server 稼働 registry → sim）

| meta `plugin_id` | sim プラグイン | 既定 enabled |
|------------------|----------------|--------------|
| matsuyama-flights | matsuyama-flights | 1（meta に明示行なしだがディレクトリあり → 有効化） |
| aircraft | aircraft | 1（sim 版。**meta 側 registry は 0**） |
| webxr-vr | xr | 1 |
| meta-bench-r1 | meta-bench-r1 | 1 |
| time-machine | time-machine | 1 |
| admin-reboot | **WS-7 へ** | — |
| nfc-spawn | **WS-7 へ** | — |
| smoke-view | vdb-volume | 1（機能対応） |

設定キーは `addons/*/config` と `tenant_plugin_config_kv` に sim 形式で格納（meta の `ADDON_*` env は WS-5 でマッピング表のみ）。

## 作業指示

### 共通制約

（計画書「共通制約」全文を遵守。）

### 手順

1. ブランチ `cursor/meta-tenant-ws4-plugins-7179`。
2. `enable-tenant-plugins.mjs`: 引数 `meta-server`，idempotent に `tenant_plugin_enabled` を upsert。
3. aircraft: meta-server の `/lib/aircraft-server` 静的配信は使わない。sim `plugin.json` + テナント HTTP ベースパスのみ。
4. 単体テスト: enable スクリプトが期待 id を返す（一時 DB）。
5. PR のみ。**本番 sqlite 書き込みは WS-8**。

### 完了条件

- PR + unit test
- README に「meta-server テナント推奨プラグイン一覧」