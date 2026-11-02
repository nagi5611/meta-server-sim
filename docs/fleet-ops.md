# MetaSim Fleet Ops（Stage B 統合管理）

系列メタバースコア（**meta-server**, **metair-server**, **metasim-server**, **metapre-server**, **metadogo-server**）を、MetaSim 管理画面と MCP から一括操作するレイヤーです。各コアは **別 systemd プロセスのまま**、registry でパスとユニットを束ねます。

## 構成

| パス | 役割 |
|------|------|
| `data/platform/fleet-registry.json` | コア ID・systemd ユニット・`.env` パス・公開ホスト |
| `lib/platform-fleet-*.js` | env 読み書き・systemctl ラッパー・管理 API |
| `scripts/platform-fleet-systemctl.sh` | ホワイトリスト付き `systemctl`（root / sudo） |
| `scripts/platform-fleet-sudoers.example` | 本番: `nagi` がラッパーのみ NOPASSWD sudo |
| `mcp/fleet-ops-mcp-server.js` | MCP stdio サーバー（Cursor 等） |
| 管理 UI | `/admin.html` → **設定 → 系列 Fleet** |

## 本番セットアップ

```bash
sudo install -m 0755 .../scripts/platform-fleet-systemctl.sh /usr/local/bin/platform-fleet-systemctl.sh
# またはリポジトリ内パスのまま PLATFORM_FLEET_SYSTEMCTL_WRAPPER で指定

sudo cp scripts/platform-fleet-sudoers.example /etc/sudoers.d/platform-fleet-ops
sudo visudo -cf /etc/sudoers.d/platform-fleet-ops
```

`metasim-server` は **User=nagi** で動く想定。systemd 操作は `sudo -n .../platform-fleet-systemctl.sh` 経由。

環境変数（任意）:

- `PLATFORM_FLEET_OPS_ENABLED=1`（既定有効、`0` で API/MCP 無効）
- `PLATFORM_FLEET_REGISTRY_PATH` — registry JSON
- `PLATFORM_FLEET_SYSTEMCTL_WRAPPER` — systemctl ラッパースクリプト

## 管理画面

1. `https://sim.mmh-virtual.jp/admin.html`（Basic 認証）
2. **設定 → 系列 Fleet**
3. 各コア: 状態表示、env 編集（IP/ポート/mediasoup）、起動/停止/再起動

編集可能キー: `PORT`, `HOST`, `MEDIASOUP_ANNOUNCED_IP`, `MEDIASOUP_ANNOUNCED_LAN_IP`, `VC_RTC_*`, `VIDEO_VC_RTC_*`, `PROXY_SERVICE_DOMAIN`, `PROXY_DOMAIN_PORT_MAP`

**.env 変更後は該当コアの restart が必要**（UI から実行可能）。

## MCP（Cursor / Claude Desktop）

`package.json`:

```bash
npm run mcp:fleet
```

`.cursor/mcp.json` 例（本番ホスト上で MetaSim の clone を cwd に）:

```json
{
  "mcpServers": {
    "metasim-fleet": {
      "command": "node",
      "args": ["mcp/fleet-ops-mcp-server.js"],
      "cwd": "/home/nagi/sim-server/meta-server-sim",
      "env": {
        "PLATFORM_FLEET_REGISTRY_PATH": "/home/nagi/sim-server/meta-server-sim/data/platform/fleet-registry.json"
      }
    }
  }
}
```

### ツール一覧

| ツール | 説明 |
|--------|------|
| `fleet_list_cores` | registry 一覧 |
| `fleet_service_status` | `coreId` の systemd 状態 |
| `fleet_service_control` | `start` / `stop` / `restart` |
| `fleet_env_get` | 編集可能 env 取得 |
| `fleet_env_set` | env 更新（ホワイトリスト） |

## HTTP API（管理 API と同一 Basic 認証）

- `GET /admin/fleet`
- `GET /admin/fleet/cores/:coreId/status`
- `POST /admin/fleet/cores/:coreId/service` `{ "action": "restart" }`
- `GET /admin/fleet/cores/:coreId/env`
- `PUT /admin/fleet/cores/:coreId/env` `{ "updates": { "MEDIASOUP_ANNOUNCED_IP": "..." } }`

MCP と管理 UI は同じ `lib/platform-fleet-ops.js` を共有します。
