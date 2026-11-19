import { normalizeRegistryMetaverse } from './lobby-registry-urls.js';

const LIVE_KEY = 'live';

/**
 * @param {Record<string, unknown>} env
 */
export async function pollStatus(env) {
    const kv = /** @type {KVNamespace} */ (env.LOBBY_KV);
    const registry = await kv.get('registry', 'json');
    const list = Array.isArray(registry?.metaverses) ? registry.metaverses : [];
    const prevLive = (await kv.get(LIVE_KEY, 'json')) || { worlds: {}, series: {} };
    const worlds = { ...(prevLive.worlds || {}) };

    for (const raw of list) {
        const world = normalizeRegistryMetaverse(raw, env);
        const id = String(world?.id || '');
        if (!id) continue;
        let status = 'online';
        let maintenance = Boolean(world.maintenance);
        if (world.lobbyStatus === 'event') status = 'live';
        if (world.lobbyStatus === 'maint' || maintenance) status = 'maint';
        const statusUrl = world.statusUrl ? String(world.statusUrl) : '';
        if (statusUrl) {
            try {
                const res = await fetch(statusUrl, { signal: AbortSignal.timeout(12_000) });
                if (res.ok) {
                    const data = await res.json();
                    maintenance = Boolean(data.maintenance) || data.status === 'maint' || !data.ok;
                    if (maintenance) status = 'maint';
                    else if (data.status === 'live' || world.lobbyStatus === 'event') status = 'live';
                    else status = 'online';
                } else {
                    status = 'degraded';
                }
            } catch {
                status = maintenance ? 'maint' : 'degraded';
            }
        } else if (maintenance) {
            status = 'maint';
        }
        const prev = worlds[id] || {};
        worlds[id] = {
            ...prev,
            status,
            maintenance,
            statusAt: new Date().toISOString(),
            name: world.name,
            capacity: world.capacity ?? null,
        };
    }

    await kv.put(
        LIVE_KEY,
        JSON.stringify({
            ...prevLive,
            worlds,
            statusAt: new Date().toISOString(),
        }),
    );
}