// lib/world-edit-mcp-object-types.js — worlds.json models[] の種類とパラメータスキーマ（管理 API 互換）

/** @typedef {{ type: string, description: string, required: string[], properties: Record<string, unknown> }} WorldEditObjectTypeDef */

/** @type {WorldEditObjectTypeDef[]} */
export const WORLD_EDIT_OBJECT_TYPES = [
    {
        type: 'model',
        description: '3D モデル（GLB/OBJ）。path は models/ 配下のファイル名。',
        required: ['path', 'position'],
        properties: {
            path: { type: 'string', example: 'models/monument.glb' },
            position: { $ref: 'vec3' },
            rotation: { $ref: 'vec3', default: { x: 0, y: 0, z: 0 } },
            scale: { oneOf: [{ $ref: 'vec3' }, { type: 'number' }] },
            animate: { type: 'object', optional: true },
        },
    },
    {
        type: 'teleporter',
        description: 'テレポーター付きモデル。',
        required: ['path', 'position', 'teleporter'],
        properties: {
            path: { type: 'string' },
            position: { $ref: 'vec3' },
            rotation: { $ref: 'vec3' },
            scale: { oneOf: [{ $ref: 'vec3' }, { type: 'number' }] },
            teleporter: {
                type: 'object',
                required: ['destinationWorld'],
                properties: {
                    id: { type: 'string' },
                    destinationWorld: { type: 'string' },
                    radius: { type: 'number' },
                    label: { type: 'string' },
                    access: { enum: ['public', 'private'] },
                    autoTeleport: { type: 'boolean' },
                    autoTeleportOnContact: { type: 'boolean' },
                },
            },
        },
    },
    {
        type: 'aircraft',
        description: '飛行機スロット付きモデル（操縦 UI）。',
        required: ['path', 'position', 'aircraft'],
        properties: {
            path: { type: 'string' },
            position: { $ref: 'vec3' },
            rotation: { $ref: 'vec3' },
            scale: { oneOf: [{ $ref: 'vec3' }, { type: 'number' }] },
            aircraft: {
                type: 'object',
                required: ['id', 'aircraftLibraryId'],
                properties: {
                    id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
                    aircraftLibraryId: { type: 'string' },
                    radius: { type: 'number' },
                    label: { type: 'string' },
                    cockpitOffset: { $ref: 'vec3' },
                    chaseOffset: { $ref: 'vec3' },
                },
            },
        },
    },
];

const VEC3_SCHEMA = {
    type: 'object',
    required: ['x', 'y', 'z'],
    properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
};

/**
 * @returns {{ objectTypes: WorldEditObjectTypeDef[], sharedSchemas: { vec3: typeof VEC3_SCHEMA }, worldLevelFields: string[] }}
 */
export function getWorldEditTypeCatalog() {
    return {
        objectTypes: WORLD_EDIT_OBJECT_TYPES,
        sharedSchemas: { vec3: VEC3_SCHEMA },
        worldLevelFields: [
            'spawnPoint',
            'aircraftPhysics',
            'models',
            'lights',
            'pdfs',
            'vdbs',
            'fdsSmoke',
            'fdsSmokeButtons',
            'floorEnabled',
            'floorWidth',
            'floorDepth',
        ],
    };
}

/**
 * @param {string} type
 * @param {Record<string, unknown>} params
 * @returns {Record<string, unknown>}
 */
export function buildModelEntryFromType(type, params) {
    const p = params && typeof params === 'object' ? params : {};
    if (type === 'model') {
        return {
            path: String(p.path || ''),
            position: normalizeVec3(p.position),
            rotation: normalizeVec3(p.rotation, { x: 0, y: 0, z: 0 }),
            scale: p.scale !== undefined ? p.scale : { x: 1, y: 1, z: 1 },
            ...(p.animate && typeof p.animate === 'object' ? { animate: p.animate } : {}),
        };
    }
    if (type === 'teleporter') {
        return {
            path: String(p.path || ''),
            position: normalizeVec3(p.position),
            rotation: normalizeVec3(p.rotation, { x: 0, y: 0, z: 0 }),
            scale: p.scale !== undefined ? p.scale : { x: 1, y: 1, z: 1 },
            teleporter: p.teleporter,
        };
    }
    if (type === 'aircraft') {
        return {
            path: String(p.path || 'models/monument.glb'),
            position: normalizeVec3(p.position),
            rotation: normalizeVec3(p.rotation, { x: 0, y: 0, z: 0 }),
            scale: p.scale !== undefined ? p.scale : { x: 0.02, y: 0.02, z: 0.02 },
            aircraft: p.aircraft,
        };
    }
    throw new Error(`unknown object type: ${type}`);
}

/**
 * @param {unknown} v
 * @param {{ x: number, y: number, z: number }} [fallback]
 */
export function normalizeVec3(v, fallback = { x: 0, y: 0, z: 0 }) {
    if (!v || typeof v !== 'object') return { ...fallback };
    const o = /** @type {Record<string, unknown>} */ (v);
    return {
        x: Number(o.x ?? fallback.x),
        y: Number(o.y ?? fallback.y),
        z: Number(o.z ?? fallback.z),
    };
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @param {number} [epsilon]
 */
export function vec3Near(a, b, epsilon = 0.001) {
    const va = normalizeVec3(a);
    const vb = normalizeVec3(b);
    return (
        Math.abs(va.x - vb.x) <= epsilon &&
        Math.abs(va.y - vb.y) <= epsilon &&
        Math.abs(va.z - vb.z) <= epsilon
    );
}