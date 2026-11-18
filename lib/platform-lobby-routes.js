// lib/platform-lobby-routes.js — 各メタバースサーバーのロビー向け API
import {
    getPlannedRestartPublicState,
} from './platform-planned-restart.js';
import {
    getPlatformSocketTotals,
    getTenantSocketStatsList,
} from './tenant-socket.js';
import { listTenants } from './tenant-registry.js';

function resolvePresenceSecret(req) {
    const expected = String(process.env.LOBBY_PRESENCE_SECRET || '').trim();
    if (!expected) return false;
    const auth = String(req.headers.authorization || '');
    if (auth === `Bearer ${expected}`) return true;
    const q = String(req.query?.secret || req.query?.token || '').trim();
    return q === expected;
}

/**
 * @param {import('express').Express} app
 */
export function registerPlatformLobbyRoutes(app) {
    app.get('/api/lobby/status', (_req, res) => {
        const restart = getPlannedRestartPublicState();
        const maintenance =
            Boolean(restart?.scheduled) || String(process.env.LOBBY_MAINTENANCE || '').trim() === '1';
        let status = 'online';
        if (maintenance) status = 'maint';
        else if (restart?.scheduled) status = 'maint';
        res.json({
            ok: !maintenance,
            service: 'metaverse-simulation-platform',
            status,
            maintenance,
            plannedRestart: restart ?? null,
            timestamp: new Date().toISOString(),
        });
    });

    app.get('/api/lobby/presence', (req, res) => {
        if (process.env.LOBBY_PRESENCE_SECRET) {
            if (!resolvePresenceSecret(req)) {
                return res.status(401).json({ error: 'unauthorized' });
            }
        }
        const totals = getPlatformSocketTotals();
        const perTenant = getTenantSocketStatsList();
        res.json({
            ok: true,
            onlinePlayers: totals.totalPlayers,
            rooms: totals.totalRooms,
            tenantCount: totals.tenantCount,
            tenants: perTenant,
            tenantsRegistered: listTenants().length,
            timestamp: new Date().toISOString(),
        });
    });
}