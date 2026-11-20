// lib/aircraft-server/deps-registry.js — server.js が登録する getRoomState / readWorlds への遅延参照

/** @typedef {{ getRoomState: (roomId: string) => object, readWorlds: () => Record<string, unknown> }} AircraftServerDeps */

/** @type {Map<string, AircraftServerDeps>} */
const depsByTenant = new Map();

/**
 * テナントごとに getRoomState / readWorlds を登録する。
 * @param {string} tenantId
 * @param {AircraftServerDeps} d
 */
export function setAircraftServerDepsForTenant(tenantId, d) {
    const id = String(tenantId || '').trim();
    if (!id || !d) return;
    depsByTenant.set(id, d);
}

/**
 * @param {string} [tenantId]
 * @returns {AircraftServerDeps|null}
 */
export function getAircraftServerDeps(tenantId) {
    if (tenantId) {
        return depsByTenant.get(String(tenantId)) ?? null;
    }
    if (depsByTenant.size === 1) {
        return [...depsByTenant.values()][0];
    }
    return null;
}

/**
 * @param {string} tenantId
 */
export function clearAircraftServerDepsForTenant(tenantId) {
    depsByTenant.delete(String(tenantId || '').trim());
}
