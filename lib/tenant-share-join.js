// lib/tenant-share-join.js — /join/<tenantId> 共有参加の解決

import { isValidTenantId, isReservedTenantId } from './tenant-id.js';
import { getTenant } from './tenant-registry.js';
import { loadLobbyCatalog } from './platform-lobby-catalog.js';
import { resolveLobbyPublicUrl } from './lobby-public-url.js';
import { getTenantPublicUrl } from './platform-network-config.js';
import { isLobbyEntryUrlAllowed } from './lobby-entry-url-policy.js';
import { getPlannedRestartPublicState } from './platform-planned-restart.js';

/**
 * @param {string} tenantId
 * @returns {string | null}
 */
export function normalizeShareJoinTenantId(tenantId) {
    const id = String(tenantId || '').trim();
    if (!id || !isValidTenantId(id) || isReservedTenantId(id)) return null;
    return id;
}

/**
 * @param {string} tenantId
 * @returns {string}
 */
export function buildShareJoinPublicUrl(tenantId) {
    const id = normalizeShareJoinTenantId(tenantId);
    if (!id) return '';
    const base = resolveLobbyPublicUrl();
    const url = new URL(`join/${encodeURIComponent(id)}`, base);
    return url.href;
}

/**
 * @param {string} tenantId
 * @returns {import('./platform-lobby-catalog.js').LobbyMetaverseEntry | null}
 */
export function findLobbyCatalogEntryForTenant(tenantId) {
    const id = normalizeShareJoinTenantId(tenantId);
    if (!id) return null;
    const catalog = loadLobbyCatalog();
    const slugId = `tenant-${id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return (
        catalog.metaverses.find((m) => m.tenantId === id)
        || catalog.metaverses.find((m) => m.id === slugId)
        || catalog.metaverses.find((m) => {
            try {
                const path = new URL(m.entryUrl).pathname.replace(/\/$/, '');
                return path === `/${id}` || path.endsWith(`/${id}`);
            } catch {
                return false;
            }
        })
        || null
    );
}

/**
 * @param {string} tenantId
 * @param {{ requireAudienceAll?: boolean }} [opts]
 * @returns {{
 *   ok: true,
 *   tenantId: string,
 *   displayName: string,
 *   worldName: string,
 *   entryUrl: string,
 *   shareUrl: string,
 *   maintenance: boolean,
 *   catalogEntry: import('./platform-lobby-catalog.js').LobbyMetaverseEntry,
 * } | { ok: false, error: string, status: number }}
 */
export function resolveShareJoinTarget(tenantId, opts = {}) {
    const id = normalizeShareJoinTenantId(tenantId);
    if (!id) {
        return { ok: false, error: 'not_found', status: 404 };
    }
    const tenant = getTenant(id);
    if (!tenant) {
        return { ok: false, error: 'not_found', status: 404 };
    }
    const catalogEntry = findLobbyCatalogEntryForTenant(id);
    if (!catalogEntry || catalogEntry.enabled === false) {
        return { ok: false, error: 'not_found', status: 404 };
    }
    const entryUrl = String(catalogEntry.entryUrl || getTenantPublicUrl(id) || `/${id}/`).trim();
    if (!isLobbyEntryUrlAllowed(entryUrl, process.env)) {
        return { ok: false, error: 'not_found', status: 404 };
    }
    const audience = String(catalogEntry.audience || 'all');
    if (opts.requireAudienceAll !== false && audience !== 'all') {
        return { ok: false, error: 'not_found', status: 404 };
    }
    const restart = getPlannedRestartPublicState();
    const platformMaint =
        Boolean(restart?.scheduled) || String(process.env.LOBBY_MAINTENANCE || '').trim() === '1';
    const maintenance =
        platformMaint
        || Boolean(catalogEntry.maintenance)
        || catalogEntry.lobbyStatus === 'maint';
    return {
        ok: true,
        tenantId: id,
        displayName: tenant.displayName,
        worldName: catalogEntry.name || tenant.displayName,
        entryUrl: entryUrl.endsWith('/') ? entryUrl : `${entryUrl}/`,
        shareUrl: buildShareJoinPublicUrl(id),
        maintenance,
        catalogEntry,
    };
}