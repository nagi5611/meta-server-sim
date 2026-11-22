# Tenant plugins (MetaSim)

MetaSim adds a **per-tenant** plugin layer modeled on meta-server addons, without replacing Fleet ops or systemd control.

## Layout

| Path | Purpose |
|------|---------|
| `addons/<plugin-id>/` | Platform-shipped plugins (all tenants may enable) |
| `tenants/<tenant-id>/addons/<plugin-id>/` | Optional tenant-local plugins (`scope`: `tenant` or `both`) |
| `data/platform/tenant_plugins.db` | Enable flags + config per tenant |
| `lib/tenant-plugin-*.js` | Loader, catalog, admin API, HTTP registry |
| `lib/hook-registry.js` | Process-wide hooks (`tenantId` in every payload) |

## `plugin.json`

```json
{
  "id": "sample-echo",
  "version": "1.0.0",
  "main": "server/main.js",
  "engines": { "meta-server-sim": "^1.0.0" },
  "scope": "platform",
  "tenantIds": ["P-01"],
  "client": { "game": "client/game.js", "admin": "client/admin.js" }
}
```

- **`engines.meta-server-sim`**: semver range against `meta-server-sim` `package.json` version (validated on **enable**).
- **`scope`**: `platform` (repo `addons/` only), `tenant` (tenant folder only), or `both`.
- **`tenantIds`**: optional allowlist; omit to allow all tenants.

## Server module

Default export with `async register(ctx)`:

- **`ctx.tenantId`**, **`ctx.tenant`**, **`ctx.config`**, **`ctx.logger`**, **`ctx.hooks`**
- **`ctx.mountHttp(router => …)`** — routes mounted at **`/api/tenant-plugins/:pluginId/…`** (tenant-scoped dispatcher).
- **`ctx.openDatabase()`** — SQLite under `tenants/<id>/db/plugins/<plugin-id>.db`
- **`ctx.getIo()`** — tenant Socket.io server when registered

Do not call `systemctl` or edit Fleet registry from plugins.

## Hooks

| Name | When |
|------|------|
| `server:tenant:init` | Before plugins load for a tenant (lazy) |
| `server:tenant:routes_mounted` | After enabled plugins registered HTTP |
| `socket:tenant:connect` | After player joins default room |
| `socket:tenant:disconnect` | On socket disconnect |
| `shutdown` | HTTP server `close` |

Handlers must filter on `payload.tenantId` when needed.

## Admin HTTP (Basic auth + CSRF on writes)

Base: **`/admin/tenant/:tenantId/plugins`**

| Method | Path | Action |
|--------|------|--------|
| GET | `/admin/tenant/:tenantId/plugins` | Catalog + enabled state |
| GET | `…/:pluginId/config` | Config map |
| PUT | `…/:pluginId/config` | `{ "updates": { "key": "value" } }` |
| POST | `…/:pluginId/enable` | Validates manifest; enable |
| POST | `…/:pluginId/disable` | Disable |
| POST | `…/reload` | Reload plugins for tenant |

## Public / client

| Path | Purpose |
|------|---------|
| `GET /:tenantId/api/addons/enabled` | Legacy map `{ "plugin-id": true }` (empty `{}` if none) |
| `GET /:tenantId/api/tenants/:tenantId/addons/enabled` | `{ tenantId, plugins: [{ id, version, gameModule }] }` |
| `GET /:tenantId/addons-client/:pluginId/<file>` | Serve client assets for **enabled** plugins |

`tenant-metaverse-app.js` calls `loadTenantPluginClientModules()` to dynamic-import `client.game` modules.

## Sample plugin

Enable **`sample-echo`** for a tenant in admin, POST reload, then:

- `GET /:tenantId/api/tenant-plugins/sample-echo/hello`
- Socket event `tenant-plugin:sample-echo` on connect

## XR (`addons/xr`)

Port of meta **`webxr-vr`**. Client hooks into `metaverse-simple` via `__tenantPluginClientBridge` (set in `tenant-plugin-client-loader.js`). Enable **`xr`** for a tenant; legacy `/api/addons/enabled` exposes `{ "xr": true }`.

## NFC spawn (`addons/nfc-spawn`)

Port of meta **`nfc-spawn`**. Teleport / instance spawns stored in per-tenant SQLite (`tenants/<id>/db/plugins/nfc-spawn.db`) and baked GLB under `tenants/<id>/data/nfc-instances/`.

- HTTP: `GET /:tenantId/api/tenant-plugins/nfc-spawn/spawn/:token` (legacy also `.../api/addons/nfc-spawn/spawn/:token`)
- Game client: `?spawn=TOKEN` on `/:tenantId/` via `client-spawn-registry.js`
- Instance viewer: `GET /:tenantId/instance/?token=TOKEN` (A-Frame vendored under addon `static/vendor/`, no CSP change)
- Admin: `/admin/tenants/:tenantId/addons/nfc-spawn/spawns`

## Admin reboot (`addons/admin-reboot`)

Tenant-safe replacement for meta **`admin-reboot`**: **no** `systemctl` or `restart.sh`. Only `POST .../reload-tenant-plugins` for the current tenant (optional PIN via plugin config `pin`). Host restart remains Fleet ops / WS-8.

## ARXR (`addons/arxr`)

Port of meta **`qr-ar`**. Static AR UI at **`GET /:tenantId/api/tenant-plugins/arxr/`** (import map + `/deps/` for Three.js and `@web-ar-studio/webar-engine-sdk`). Client **`client/game.js`** sets `window.__tenantArxrEntryUrl` for in-world links. Optional env: **`VITE_WEBAR_API_KEY`** (falls back to meta test key in `ar-app.js`).

## time-machine (`addons/time-machine`)

Backup / rollback addon (ported from meta-server). Platform admin routes at **`/admin/addons/time-machine/*`** when enabled for an allowed tenant (`tenantIds` in `plugin.json`, default **`P-01`**). Config: `ADDON_TIME_MACHINE_MOUNTS`, `ADDON_TIME_MACHINE_ROLLBACK_PIN`, `systemdServiceName` (default **`meta-server-sim`**). Snapshots use mount prefix **`meta-server-sim/`** (not `metaverse-simple`). CloudFront invalidation is a no-op on sim (R2).

## matsuyama-flights (`addons/matsuyama-flights`)

松山空港（MYJ）発着情報を 3D パネルに表示。主データ源は公式 timetable HTML、レイアウト変更時は ODPT/Jetstar バックアップ（`ADDON_MATSUYAMA_FLIGHTS_ODPT_CONSUMER_KEY` またはテナント env `TENANT_<ID>_ADDON_MATSUYAMA_FLIGHTS_ODPT_CONSUMER_KEY`）。キー未設定でも公式 HTML が取れれば動作。

- HTTP: `GET /:tenantId/api/tenant-plugins/matsuyama-flights/board` およびレガシー `GET /:tenantId/api/addons/matsuyama-flights/board`
- ワールド: `worlds.json` の `flightBoards[]`（管理画面「発着」カテゴリ）
- 管理プレビュー: `/addons/matsuyama-flights/client/*` 静的配信 + `setting.js` から import

## meta-bench-r1 (`addons/meta-bench-r1`)

Load-test orchestration (ported from meta-server). Admin UI via **`client/admin.js`** and **`/admin/addons/meta-bench-r1/*`**. Runner socket events use tenant Socket.io from the enabling tenant. Worlds list comes from that tenant's **`worlds.json`**.

## meta-server テナント推奨プラグイン（移行 WS-4）

テナント ID **`meta-server`** では meta-server 本番の有効アドオンを sim 形式へ写す。本番 `tenant_plugins.db` への反映は **`node scripts/enable-tenant-plugins.mjs`**（WS-8 で実行）。`admin-reboot` / `nfc-spawn` は WS-7。`aircraft` / **`qr-ar`（sim では `arxr`）** はユーザー指示により **移行対象外**（有効化・マッピングしない）。

| meta-server（legacy） | sim `plugin_id` | 既定 enabled |
|-----------------------|-----------------|--------------|
| （ディレクトリのみ）松山フライツ | matsuyama-flights | 1 |
| aircraft | — | **対象外（ユーザー指示）** |
| qr-ar | — | **対象外（ユーザー指示・`arxr` も有効化しない）** |
| webxr-vr | xr | 1 |
| meta-bench-r1 | meta-bench-r1 | 1 |
| time-machine | time-machine | 1 |
| smoke-view / play_vdb | vdb-volume | 1 |

煙・雲は `worlds.json` の `vdbs[]` と vdb-volume クライアント（meta `smoke-view` の sim 置換）。

## vdb-volume (`addons/vdb-volume`)

meta **`smoke-view`** の後継。NanoVDB / OpenVDB を `worlds.json` の **`vdbs[]`** からレイマーチ表示。サンプル `addons/vdb-volume/samples/cloud-cumulus.nvdb`。

## Platform admin bridge

Plugins may implement **`ctx.registerPlatformAdmin((app, guards) => …)`** for global admin routes. **`client.admin`** modules load on **`admin-tenant.html`** via **`tenant-plugin-admin-client-loader.js`**.

## Reload caveat

`POST …/reload` clears plugin HTTP routers and reloads server modules. Hook handlers registered with `hooks.on` may duplicate if reload is called repeatedly; prefer disable/enable or process restart for production hook changes.
