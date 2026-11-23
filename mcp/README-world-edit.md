# MetaSim World Edit MCP

管理画面のワールド編集と **同じ Admin HTTP API** を MCP から操作します。編集ロジックの二重実装はありません。

## 登録（`.cursor/mcp.json`）

```json
"metasim-world-edit": {
  "command": "node",
  "args": ["mcp/world-edit-mcp-server.js"],
  "cwd": "/path/to/meta-server-sim",
  "env": {
    "WORLD_EDIT_MCP_BASE_URL": "http://127.0.0.1:3002",
    "WORLD_EDIT_MCP_TENANT_ID": "P-01",
    "WORLD_EDIT_MCP_ADMIN_USERNAME": "admin",
    "WORLD_EDIT_MCP_ADMIN_PASSWORD": "<from env secret>"
  }
}
```

本番例: `WORLD_EDIT_MCP_BASE_URL=https://sim.mmh-virtual.jp`

## 環境変数

| 変数 | 説明 |
|------|------|
| `WORLD_EDIT_MCP_BASE_URL` | Admin API のオリジン |
| `WORLD_EDIT_MCP_TENANT_ID` | テナント ID（既定 P-01） |
| `WORLD_EDIT_MCP_ADMIN_USERNAME` | Basic 認証ユーザー |
| `WORLD_EDIT_MCP_ADMIN_PASSWORD` | Basic 認証パスワード（**コミットしない**） |
| `WORLD_EDIT_MCP_SNAPSHOT_DIR` | 書き込み前バックアップ（既定 `/opt/cursor/artifacts/world-edit-snapshots`） |
| `WORLD_EDIT_MCP_ALLOW_WRITES` | `0` で書き込み系を拒否 |
| `AIRCRAFT_SCENARIO_BASE_URL` | シナリオ再生のメタバース URL（既定 base の 3003 相当） |

## 認証・API ルート

- Basic 認証 + `GET /admin/csrf-token` → `X-Admin-CSRF` で POST/PUT
- `GET/POST /admin/tenants/:tenantId/worlds`
- `POST /admin/tenants/:tenantId/worlds/patch`
- `POST /admin/tenants/:tenantId/upload`
- `GET/PUT /admin/tenants/:tenantId/addons/aircraft/airframes/:id`

## ツール一覧

| ツール | 説明 |
|--------|------|
| `world_edit_config` | 接続設定 |
| `world_edit_list_worlds` | ワールド ID 一覧 |
| `world_edit_get_world` | ワールド全体 |
| `world_edit_list_object_types` | 種類とスキーマ |
| `world_edit_list_objects` / `get_object` | models[] 操作 |
| `world_edit_add_object` / `update_object` / `delete_object` | オブジェクト CRUD（`dry_run`） |
| `world_edit_place_model` | モデル配置 + 検証 |
| `world_edit_list_models` / `upload_model` | モデル一覧・アップロード |
| `world_edit_list_snapshots` / `restore_snapshot` | バックアップ |
| `aircraft_*` | 機体 DB・ワールド physics・スロット配置 |
| `aircraft_run_scenario` | [飛行シナリオ](./../docs/aircraft-scenario-testing.md) 再生 |

## 飛行検証ループ（AI 向け）

1. `aircraft_place_slot` または既存 `p01-scenario-a320` を確認
2. `aircraft_set_airframe` / `aircraft_patch_world_physics` でパラメータ調整（`dry_run` で確認可）
3. `aircraft_run_scenario` に `scenario` または `scenarios/aircraft/p01-straight.json` 相当を渡す
4. レポートの `pass` と checkpoint ズレを見て再調整

## CLI スモーク

```bash
npm run mcp:world-edit:invoke -- world_edit_config
npm run mcp:world-edit:invoke -- world_edit_list_worlds
```

## 注意

- R2 の `meta/models/` 既存オブジェクトは上書きしない（新規ファイルのみアップロード）
- 書き込み前に自動で worlds スナップショットを保存