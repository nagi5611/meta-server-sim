// lib/world-edit-mcp-ops.js — ワールド編集 MCP 操作（管理 HTTP API をそのまま利用）

import fs from 'node:fs';
import path from 'node:path';
import { resolveAdminCredentials } from './admin-auth.js';
import { WorldEditAdminHttpClient } from './world-edit-mcp-admin-http.js';
import { getWorldEditMcpConfig, resolveWorldEditMcpPassword } from './world-edit-mcp-config.js';
import {
    buildModelEntryFromType,
    getWorldEditTypeCatalog,
    normalizeVec3,
    vec3Near,
} from './world-edit-mcp-object-types.js';
import {
    listWorldsSnapshots,
    readWorldsSnapshot,
    writeWorldsSnapshot,
} from './world-edit-mcp-snapshots.js';
import {
    runAircraftScenarioFromPathOrObject,
} from './mcp-aircraft-scenario-run.js';

/** @type {WorldEditAdminHttpClient | null} */
let cachedClient = null;

/**
 * @returns {WorldEditAdminHttpClient}
 */
export function getWorldEditAdminClient() {
    if (cachedClient) return cachedClient;
    const cfg = getWorldEditMcpConfig();
    const password = resolveWorldEditMcpPassword(resolveAdminCredentials);
    cachedClient = new WorldEditAdminHttpClient({
        baseUrl: cfg.baseUrl,
        username: cfg.username,
        password,
        tenantId: cfg.tenantId,
    });
    return cachedClient;
}

export function resetWorldEditAdminClientForTests() {
    cachedClient = null;
}

export function worldEditMcpConfigGetForMcp() {
    const cfg = getWorldEditMcpConfig();
    return {
        baseUrl: cfg.baseUrl,
        tenantId: cfg.tenantId,
        username: cfg.username,
        snapshotDir: cfg.snapshotDir,
        scenarioBaseUrl: cfg.scenarioBaseUrl,
        allowProductionWrites: cfg.allowProductionWrites,
        passwordConfigured:
            Boolean(process.env.WORLD_EDIT_MCP_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD) ||
            Boolean(resolveAdminCredentials().password),
    };
}

/**
 * @param {{ dryRun?: boolean, snapshotLabel?: string }} [opts]
 */
async function maybeSnapshotBeforeWrite(opts) {
    const cfg = getWorldEditMcpConfig();
    const client = getWorldEditAdminClient();
    const worlds = await client.getWorlds();
    const snap = writeWorldsSnapshot(
        cfg.snapshotDir,
        cfg.tenantId,
        worlds,
        opts?.snapshotLabel || 'pre-write',
    );
    return { worlds, snapshot: snap };
}

/**
 * @param {boolean} dryRun
 */
function assertWritesAllowed(dryRun) {
    const cfg = getWorldEditMcpConfig();
    if (dryRun) return;
    if (!cfg.allowProductionWrites) {
        throw new Error('writes disabled (set WORLD_EDIT_MCP_ALLOW_WRITES=1 to enable)');
    }
}

export async function worldEditListWorldsForMcp() {
    const client = getWorldEditAdminClient();
    const worlds = await client.getWorlds();
    return {
        tenantId: client.tenantId,
        worldIds: Object.keys(worlds),
        count: Object.keys(worlds).length,
    };
}

/**
 * @param {string} worldId
 */
export async function worldEditGetWorldForMcp(worldId) {
    const client = getWorldEditAdminClient();
    const worlds = await client.getWorlds();
    const w = worlds[worldId];
    if (!w) throw new Error(`world not found: ${worldId}`);
    return { worldId, world: w };
}

export function worldEditListObjectTypesForMcp() {
    return getWorldEditTypeCatalog();
}

/**
 * @param {string} worldId
 */
export async function worldEditListObjectsForMcp(worldId) {
    const { world } = await worldEditGetWorldForMcp(worldId);
    const models = Array.isArray(world.models) ? world.models : [];
    return {
        worldId,
        count: models.length,
        objects: models.map((m, index) => ({
            index,
            path: m?.path,
            hasTeleporter: Boolean(m?.teleporter),
            hasAircraft: Boolean(m?.aircraft),
            aircraftId: m?.aircraft?.id,
            position: m?.position,
        })),
    };
}

/**
 * @param {string} worldId
 * @param {number} objectIndex
 */
export async function worldEditGetObjectForMcp(worldId, objectIndex) {
    const { world } = await worldEditGetWorldForMcp(worldId);
    const models = Array.isArray(world.models) ? world.models : [];
    const obj = models[objectIndex];
    if (!obj) throw new Error(`object index out of range: ${objectIndex}`);
    return { worldId, objectIndex, object: obj };
}

/**
 * @param {string} worldId
 * @param {string} type
 * @param {Record<string, unknown>} params
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function worldEditAddObjectForMcp(worldId, type, params, opts = {}) {
    const dryRun = !!opts.dryRun;
    assertWritesAllowed(dryRun);
    const entry = buildModelEntryFromType(type, params);
    const { worlds, snapshot } = await maybeSnapshotBeforeWrite({ snapshotLabel: 'pre-add-object' });
    const world = worlds[worldId];
    if (!world || typeof world !== 'object') throw new Error(`world not found: ${worldId}`);
    const models = Array.isArray(world.models) ? [...world.models] : [];
    const newIndex = models.length;
    models.push(entry);
  if (dryRun) {
        return {
            dryRun: true,
            snapshot,
            worldId,
            newIndex,
            object: entry,
            wouldPatch: { models },
        };
    }
    await getWorldEditAdminClient().patchWorld(worldId, { models });
    const verified = await worldEditGetObjectForMcp(worldId, newIndex);
    return { ok: true, snapshot, worldId, objectIndex: newIndex, object: verified.object };
}

/**
 * @param {string} worldId
 * @param {number} objectIndex
 * @param {Record<string, unknown>} patch
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function worldEditUpdateObjectForMcp(worldId, objectIndex, patch, opts = {}) {
    const dryRun = !!opts.dryRun;
    assertWritesAllowed(dryRun);
    const { worlds, snapshot } = await maybeSnapshotBeforeWrite({ snapshotLabel: 'pre-update-object' });
    const world = worlds[worldId];
    const models = Array.isArray(world?.models) ? [...world.models] : [];
    const prev = models[objectIndex];
    if (!prev) throw new Error(`object index out of range: ${objectIndex}`);
    models[objectIndex] = { ...prev, ...patch };
    if (dryRun) {
        return { dryRun: true, snapshot, worldId, objectIndex, wouldSet: models[objectIndex] };
    }
    await getWorldEditAdminClient().patchWorld(worldId, { models });
    const verified = await worldEditGetObjectForMcp(worldId, objectIndex);
    return { ok: true, snapshot, ...verified };
}

/**
 * @param {string} worldId
 * @param {number} objectIndex
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function worldEditDeleteObjectForMcp(worldId, objectIndex, opts = {}) {
    const dryRun = !!opts.dryRun;
    assertWritesAllowed(dryRun);
    const { worlds, snapshot } = await maybeSnapshotBeforeWrite({ snapshotLabel: 'pre-delete-object' });
    const world = worlds[worldId];
    const models = Array.isArray(world?.models) ? [...world.models] : [];
    if (!models[objectIndex]) throw new Error(`object index out of range: ${objectIndex}`);
    const removed = models.splice(objectIndex, 1)[0];
    if (dryRun) {
        return { dryRun: true, snapshot, worldId, objectIndex, removed };
    }
    await getWorldEditAdminClient().patchWorld(worldId, { models });
    return { ok: true, snapshot, worldId, objectIndex, removed };
}

/**
 * @param {string} worldId
 * @param {string} modelPath
 * @param {{ position?: unknown, rotation?: unknown, scale?: unknown, dryRun?: boolean, verify?: boolean }} opts
 */
export async function worldEditPlaceModelForMcp(worldId, modelPath, opts = {}) {
    const position = normalizeVec3(opts.position, { x: 0, y: 1, z: 0 });
    const rotation = normalizeVec3(opts.rotation, { x: 0, y: 0, z: 0 });
    const scale = opts.scale !== undefined ? opts.scale : { x: 1, y: 1, z: 1 };
    const result = await worldEditAddObjectForMcp(
        worldId,
        'model',
        { path: modelPath, position, rotation, scale },
        { dryRun: opts.dryRun },
    );
    if (opts.verify && !opts.dryRun && result.objectIndex !== undefined) {
        const pos = result.object?.position;
        result.verified = {
            positionMatches: vec3Near(pos, position, 0.01),
            pathMatches: result.object?.path === modelPath,
        };
    }
    return result;
}

/**
 * @param {string} filePath
 * @param {{ dryRun?: boolean, confirm?: boolean }} [opts]
 */
export async function worldEditUploadModelForMcp(filePath, opts = {}) {
    const dryRun = !!opts.dryRun;
    assertWritesAllowed(dryRun);
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) throw new Error(`file not found: ${abs}`);
    const filename = path.basename(abs);
    const stat = fs.statSync(abs);
    if (dryRun) {
        return { dryRun: true, filename, bytes: stat.size, wouldUploadTo: `/admin/tenants/.../upload` };
    }
    const buf = fs.readFileSync(abs);
    const uploaded = await getWorldEditAdminClient().uploadModel(buf, filename, { confirm: opts.confirm });
    return { ok: true, filename, uploaded };
}

export async function worldEditListModelsForMcp() {
    const names = await getWorldEditAdminClient().listModels();
    return { models: names };
}

export function worldEditListSnapshotsForMcp() {
    const cfg = getWorldEditMcpConfig();
    return { snapshots: listWorldsSnapshots(cfg.snapshotDir) };
}

/**
 * @param {string} snapshotPath
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function worldEditRestoreSnapshotForMcp(snapshotPath, opts = {}) {
    const dryRun = !!opts.dryRun;
    assertWritesAllowed(dryRun);
    const snap = readWorldsSnapshot(snapshotPath);
    if (dryRun) {
        return { dryRun: true, snapshotPath, worldCount: Object.keys(snap.worlds).length };
    }
    await getWorldEditAdminClient().saveWorlds(snap.worlds);
    return { ok: true, snapshotPath, restoredWorldCount: Object.keys(snap.worlds).length };
}

export async function aircraftListAirframesForMcp() {
    return getWorldEditAdminClient().listAirframes();
}

/**
 * @param {string} airframeId
 */
export async function aircraftGetAirframeForMcp(airframeId) {
    return getWorldEditAdminClient().getAirframe(airframeId);
}

/**
 * @param {string} airframeId
 * @param {Record<string, unknown>} body
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function aircraftSetAirframeForMcp(airframeId, body, opts = {}) {
    const dryRun = !!opts.dryRun;
    assertWritesAllowed(dryRun);
    if (dryRun) return { dryRun: true, airframeId, wouldSet: body };
    return getWorldEditAdminClient().putAirframe(airframeId, body);
}

/**
 * @param {string} worldId
 * @param {Record<string, unknown>} aircraftPhysics
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function aircraftPatchWorldPhysicsForMcp(worldId, aircraftPhysics, opts = {}) {
    const dryRun = !!opts.dryRun;
    assertWritesAllowed(dryRun);
    const { snapshot } = await maybeSnapshotBeforeWrite({ snapshotLabel: 'pre-aircraft-physics' });
    if (dryRun) return { dryRun: true, snapshot, worldId, wouldPatch: { aircraftPhysics } };
    await getWorldEditAdminClient().patchWorld(worldId, { aircraftPhysics });
    const { world } = await worldEditGetWorldForMcp(worldId);
    return { ok: true, snapshot, aircraftPhysics: world.aircraftPhysics };
}

/**
 * @param {string} worldId
 * @param {Record<string, unknown>} aircraftSlot
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function aircraftPlaceSlotForMcp(worldId, aircraftSlot, opts = {}) {
    const slot = aircraftSlot && typeof aircraftSlot === 'object' ? aircraftSlot : {};
    return worldEditAddObjectForMcp(
        worldId,
        'aircraft',
        {
            path: slot.path || 'models/monument.glb',
            position: slot.position || { x: 212, y: 1.05, z: 12 },
            scale: slot.scale || { x: 0.02, y: 0.02, z: 0.02 },
            aircraft: {
                id: slot.id || `mcp-aircraft-${Date.now()}`,
                aircraftLibraryId: slot.aircraftLibraryId || 'A320',
                radius: slot.radius ?? 14,
                label: slot.label || '操縦する',
                cockpitOffset: slot.cockpitOffset || { x: 0, y: 1.4, z: 0.3 },
                chaseOffset: slot.chaseOffset || { x: 0, y: 5.5, z: 18 },
            },
        },
        { dryRun: opts.dryRun },
    );
}

/**
 * @param {Record<string, unknown> | string} scenarioOrPath
 * @param {{ baseUrl?: string, tenantId?: string, teleportNearSlot?: boolean }} [opts]
 */
export async function aircraftRunScenarioForMcp(scenarioOrPath, opts = {}) {
    const cfg = getWorldEditMcpConfig();
    return runAircraftScenarioFromPathOrObject(scenarioOrPath, {
        baseUrl: opts.baseUrl || cfg.scenarioBaseUrl,
        tenantId: opts.tenantId || cfg.tenantId,
        teleportNearSlot: opts.teleportNearSlot,
        artifactsDir: '/opt/cursor/artifacts',
    });
}