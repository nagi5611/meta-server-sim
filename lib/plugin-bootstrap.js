// lib/plugin-bootstrap.js — addon catalog snapshot for bench / diagnostics
import { discoverPlatformPlugins } from './tenant-plugin-catalog.js';

/**
 * @returns {{ plugins: Array<{ id: string, version?: string }>, generatedAt: string }}
 */
export function getAddonCatalogSnapshot() {
    const discovered = discoverPlatformPlugins();
    return {
        generatedAt: new Date().toISOString(),
        plugins: discovered.map((p) => ({
            id: p.id,
            version: p.manifest?.version,
        })),
    };
}
