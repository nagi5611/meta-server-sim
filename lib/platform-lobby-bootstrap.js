// lib/platform-lobby-bootstrap.js — 本番で data/platform/lobby-catalog.json が空のとき tenant から再構築
import { listTenants } from './tenant-registry.js';
import { loadLobbyCatalog, upsertLobbyEntryForTenant } from './platform-lobby-catalog.js';
import { syncLobbyCatalogToWorker } from './platform-lobby-sync.js';

/**
 * @param {{ syncToWorker?: boolean }} [options]
 */
export async function ensureLobbyCatalogSeeded(options = {}) {
    const catalog = loadLobbyCatalog();
    if (catalog.metaverses.length > 0) {
        return { seeded: false, catalog, workerSync: { ok: true, skipped: true } };
    }
    const tenants = listTenants();
    if (!tenants.length) {
        return { seeded: false, catalog, workerSync: { ok: true, skipped: true } };
    }
    for (const t of tenants) {
        upsertLobbyEntryForTenant({
            tenantId: t.id,
            displayName: t.displayName,
        });
    }
    const rebuilt = loadLobbyCatalog();
    let workerSync = { ok: true, skipped: true };
    if (options.syncToWorker) {
        workerSync = await syncLobbyCatalogToWorker(rebuilt);
    }
    return { seeded: true, catalog: rebuilt, workerSync };
}