import { getPublicSession } from './auth-api.js';
import { insertJoinEvent } from './db-ops.js';
import { moderateLobbyDisplayName } from './display-name-moderator.js';
import { fetchSim } from './sim-client.js';

/**
 * @param {unknown[]} metaverses
 * @param {string} tenantId
 */
function findWorldIdForTenant(metaverses, tenantId) {
    const tid = String(tenantId || '').trim();
    if (!tid) return '';
    const hit = metaverses.find((m) => String(/** @type {Record<string, unknown>} */ (m).tenantId || '') === tid);
    return hit ? String(/** @type {Record<string, unknown>} */ (hit).id || tid) : tid;
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
        },
    });
}

/**
 * @param {string} pathname
 * @returns {{ tenantId: string, action: 'resolve' | 'join' } | null}
 */
function parseShareJoinPath(pathname) {
    const decodeSeg = (s) => {
        try {
            return decodeURIComponent(s);
        } catch {
            return s;
        }
    };
    const joinMatch = pathname.match(/^\/api\/share-join\/([^/]+)\/join\/?$/);
    if (joinMatch) {
        return { tenantId: decodeSeg(joinMatch[1]), action: 'join' };
    }
    const resolveMatch = pathname.match(/^\/api\/share-join\/([^/]+)\/?$/);
    if (resolveMatch) {
        return { tenantId: decodeSeg(resolveMatch[1]), action: 'resolve' };
    }
    return null;
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 */
export async function handleShareJoinRequest(request, env) {
    const url = new URL(request.url);
    const parsed = parseShareJoinPath(url.pathname);
    if (!parsed) return null;

    const tenantEnc = encodeURIComponent(parsed.tenantId);

    if (parsed.action === 'resolve' && request.method === 'GET') {
        const simRes = await fetchSim(env, `/service/lobby/share-join/${tenantEnc}`, { method: 'GET' });
        if (!simRes.ok) {
            const err = simRes.data?.error || 'not_found';
            const status = simRes.status === 503 ? 503 : err === 'not_found' ? 404 : simRes.status || 502;
            return json(simRes.data || { error: err }, status);
        }
        return json(simRes.data, 200);
    }

    if (parsed.action === 'join' && request.method === 'POST') {
        let body;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'invalid_json' }, 400);
        }
        const displayName = String(body?.displayName || '').trim();
        if (!displayName) return json({ error: 'display_name_required' }, 400);
        if (displayName.length > 64) return json({ error: 'name_too_long', maxLength: 64 }, 400);
        if (!/^[\p{L}\p{N}_\- ]+$/u.test(displayName)) {
            return json({ error: 'invalid_name_chars' }, 400);
        }
        const moderation = await moderateLobbyDisplayName({ env, displayName });
        if (!moderation.allowed) {
            return json(
                {
                    error: 'display_name_rejected',
                    reason_ja: moderation.reason_ja || undefined,
                },
                422,
            );
        }
        const simRes = await fetchSim(env, `/service/lobby/share-join/${tenantEnc}/join`, {
            method: 'POST',
            body: { displayName },
        });
        if (!simRes.ok) {
            const status = simRes.status || 502;
            return json(simRes.data || { error: 'join_failed' }, status);
        }
        const db = /** @type {D1Database | undefined} */ (env.LOBBY_DB);
        const session = await getPublicSession(request, env);
        const userRef = session?.sub ? String(session.sub) : null;
        if (db && userRef) {
            const kv = /** @type {KVNamespace | undefined} */ (env.LOBBY_KV);
            const registry = kv ? (await kv.get('registry', 'json')) || { metaverses: [] } : { metaverses: [] };
            const worldId = findWorldIdForTenant(registry.metaverses || [], parsed.tenantId);
            await insertJoinEvent(db, {
                id: `je-${crypto.randomUUID()}`,
                user_ref: userRef,
                display_name: displayName,
                world_id: worldId,
                tenant_id: parsed.tenantId,
                joined_at: new Date().toISOString(),
                left_at: null,
                ok: true,
                meta: { via: 'share-join' },
            });
        }
        return json(simRes.data, 200);
    }

    return json({ error: 'method_not_allowed' }, 405);
}