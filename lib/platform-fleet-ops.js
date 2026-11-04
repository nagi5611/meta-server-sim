// lib/platform-fleet-ops.js — Fleet 統合 ops（MCP / 管理 API 共通）
import fs from 'node:fs';
import {
    FLEET_EDITABLE_ENV_KEYS,
    getFleetCore,
    isFleetOpsEnabled,
    loadFleetCores,
} from './platform-fleet-registry.js';
import { pickEnvKeys, readEnvFile, writeEnvFileUpdates, pickAddonEnvKeys, writeAddonEnvFileUpdates } from './platform-fleet-env.js';
import { controlFleetService, getFleetServiceStatus } from './platform-fleet-systemd.js';

export function getFleetOpsMeta() {
    return {
        enabled: isFleetOpsEnabled(),
        editableKeys: FLEET_EDITABLE_ENV_KEYS,
        cores: loadFleetCores().map((c) => ({
            id: c.id,
            label: c.label,
            systemdUnit: c.systemdUnit,
            envFile: c.envFile,
            publicHost: c.publicHost,
            nginxPort: c.nginxPort,
            envFileExists: fs.existsSync(c.envFile),
        })),
    };
}

/**
 * @param {string} coreId
 */
export async function fleetGetEnv(coreId) {
    const core = getFleetCore(coreId);
    if (!core) throw new Error(`unknown core: ${coreId}`);
    const all = readEnvFile(core.envFile);
    return {
        coreId: core.id,
        envFile: core.envFile,
        values: pickEnvKeys(all, FLEET_EDITABLE_ENV_KEYS),
    };
}

/**
 * @param {string} coreId
 * @param {Record<string, string>} updates
 */
export async function fleetSetEnv(coreId, updates) {
    const core = getFleetCore(coreId);
    if (!core) throw new Error(`unknown core: ${coreId}`);
    const result = writeEnvFileUpdates(core.envFile, updates);
    if (!result.ok) {
        throw new Error(result.error);
    }
    return {
        coreId: core.id,
        envFile: core.envFile,
        changed: result.changed,
        restartRequired: result.changed.length > 0,
    };
}

/**
 * @param {string} coreId
 */
export async function fleetGetAddonEnv(coreId) {
    const core = getFleetCore(coreId);
    if (!core) throw new Error(`unknown core: ${coreId}`);
    const all = readEnvFile(core.envFile);
    return {
        coreId: core.id,
        envFile: core.envFile,
        values: pickAddonEnvKeys(all),
    };
}

/**
 * @param {string} coreId
 * @param {Record<string, string>} updates
 */
export async function fleetSetAddonEnv(coreId, updates) {
    const core = getFleetCore(coreId);
    if (!core) throw new Error(`unknown core: ${coreId}`);
    const result = writeAddonEnvFileUpdates(core.envFile, updates);
    if (!result.ok) {
        throw new Error(result.error);
    }
    return {
        coreId: core.id,
        envFile: core.envFile,
        changed: result.changed,
        restartRequired: result.changed.length > 0,
    };
}

export { getFleetServiceStatus, controlFleetService, isFleetOpsEnabled };
