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

## ARXR (`addons/arxr`)

Port of meta **`qr-ar`**. Static AR UI at **`GET /:tenantId/api/tenant-plugins/arxr/`** (import map + `/deps/` for Three.js and `@web-ar-studio/webar-engine-sdk`). Client **`client/game.js`** sets `window.__tenantArxrEntryUrl` for in-world links. Optional env: **`VITE_WEBAR_API_KEY`** (falls back to meta test key in `ar-app.js`).

## Reload caveat

`POST …/reload` clears plugin HTTP routers and reloads server modules. Hook handlers registered with `hooks.on` may duplicate if reload is called repeatedly; prefer disable/enable or process restart for production hook changes.
