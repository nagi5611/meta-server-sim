// lib/platform-lobby-sync.js — ロビー Worker へカタログを push
import { buildLobbyWorkerRegistry } from './platform-lobby-catalog.js';

/**
 * @param {import('./platform-lobby-catalog.js').LobbyCatalogFile} [catalog]
 */
export async function syncLobbyCatalogToWorker(catalog) {
    const syncUrl = String(process.env.LOBBY_WORKER_SYNC_URL || '').trim();
    const secret = String(process.env.LOBBY_WORKER_SYNC_SECRET || '').trim();
    if (!syncUrl || !secret) {
        return { ok: true, skipped: true, reason: 'LOBBY_WORKER_SYNC_URL or secret not set' };
    }
    const body = JSON.stringify(buildLobbyWorkerRegistry(catalog));
    const res = await fetch(syncUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${secret}`,
        },
        body,
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
            ok: false,
            status: res.status,
            error: text.slice(0, 500) || `HTTP ${res.status}`,
        };
    }
    return { ok: true, skipped: false };
}