/** @typedef {{ id: string, presenceUrl?: string | null, statusUrl?: string | null }} RegistryMetaverse */

import { recordPresenceSample } from './db-ops.js';

const LIVE_KEY = 'live';

/**
 * 10 秒ごとに各メタバースの presence API を叩き KV に集約
 */
export class LobbyPoller {
    /**
     * @param {DurableObjectState} state
     * @param {Record<string, unknown>} env
     */
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/poll') {
            await this.pollPresence();
            return new Response('ok');
        }
        if (url.pathname === '/wake') {
            const current = await this.state.storage.getAlarm();
            if (!current) {
                await this.state.storage.setAlarm(Date.now() + 500);
            }
            return new Response('ok');
        }
        return new Response('not found', { status: 404 });
    }

    async alarm() {
        await this.pollPresence();
        await this.state.storage.setAlarm(Date.now() + 10_000);
    }

    async pollPresence() {
        const kv = /** @type {KVNamespace} */ (this.env.LOBBY_KV);
        const secret = String(this.env.LOBBY_PRESENCE_SECRET || '').trim();
        const registry = await kv.get('registry', 'json');
        const list = Array.isArray(registry?.metaverses) ? registry.metaverses : [];
        const prevLive = (await kv.get(LIVE_KEY, 'json')) || { worlds: {}, series: {} };
        const worlds = { ...(prevLive.worlds || {}) };
        const series = { ...(prevLive.series || {}) };

        await Promise.all(
            list.map(async (/** @type {RegistryMetaverse} */ world) => {
                const id = String(world?.id || '');
                if (!id || !world.presenceUrl) return;
                const headers = secret ? { authorization: `Bearer ${secret}` } : {};
                try {
                    const res = await fetch(world.presenceUrl, {
                        headers,
                        signal: AbortSignal.timeout(8_000),
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    const players = Number(data.onlinePlayers ?? data.players ?? 0) || 0;
                    const prev = worlds[id] || {};
                    worlds[id] = {
                        ...prev,
                        players,
                        rooms: Number(data.rooms ?? 0) || 0,
                        status: prev.status || 'online',
                        presenceAt: new Date().toISOString(),
                    };
                    const ring = Array.isArray(series[id]) ? [...series[id]] : [];
                    ring.push(players);
                    while (ring.length > 24) ring.shift();
                    series[id] = ring;
                } catch (err) {
                    const prev = worlds[id] || {};
                    worlds[id] = {
                        ...prev,
                        players: prev.players ?? 0,
                        status: prev.status === 'maint' ? 'maint' : 'degraded',
                        presenceError: String(err?.message || err).slice(0, 120),
                        presenceAt: new Date().toISOString(),
                    };
                }
            }),
        );

        await kv.put(
            LIVE_KEY,
            JSON.stringify({
                worlds,
                series,
                updatedAt: new Date().toISOString(),
            }),
        );

        const db = /** @type {D1Database | undefined} */ (this.env.LOBBY_DB);
        if (db) {
            for (const world of list) {
                const id = String(world?.id || '');
                if (!id) continue;
                const players = Number(worlds[id]?.players ?? 0) || 0;
                await recordPresenceSample(db, id, players);
            }
        }
    }
}