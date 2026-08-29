// lib/tenant-metaverse-defaults.js — metaverse-simple 由来のテナント初期ワールド定義

/** @type {Record<string, object>} */
export const TENANT_DEFAULT_WORLDS = {
    lobby: {
        id: 'lobby',
        name: 'Lobby',
        models: [
            {
                path: 'models/lobby.glb',
                position: { x: 0, y: 1, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 2, y: 2, z: 2 },
            },
            {
                path: 'models/monument.glb',
                position: { x: 0, y: 3.5, z: -10 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1.5, y: 1.5, z: 1.5 },
                animate: { rotation: { x: 0, y: 0.1, z: 0 } },
            },
            {
                path: 'models/teleporter_s2.glb',
                position: { x: 6, y: 1.35, z: -10 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 0.05, y: 0.05, z: 0.05 },
                animate: { rotation: { x: 0, y: 0.1, z: 0 } },
                teleporter: {
                    id: 's1',
                    destinationWorld: 'school',
                    radius: 3,
                    label: '新校舎',
                },
            },
            {
                path: 'models/teleporter_l2.glb',
                position: { x: 6, y: 3.9, z: -10 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 0.3, y: 0.3, z: 0.3 },
            },
        ],
        spawnPoint: { x: 0, y: 10, z: 0 },
        lights: [
            { type: 'ambient', intensity: 0.5, color: 0xffffff },
            {
                type: 'directional',
                position: { x: 50, y: 100, z: 50 },
                intensity: 0.8,
                color: 0xffffff,
                castShadow: true,
            },
            {
                type: 'point',
                position: { x: 6, y: 2, z: -10 },
                intensity: 5,
                color: 0xffeedd,
                distance: 50,
            },
            {
                type: 'point',
                position: { x: 6, y: 4.5, z: -10 },
                intensity: 5,
                color: 0xffeedd,
                distance: 50,
            },
        ],
    },
    school: {
        id: 'school',
        name: '新校舎',
        models: [
            {
                path: 'models/school_base.glb',
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
            },
        ],
        spawnPoint: { x: 0, y: 10, z: 0 },
        lights: [
            { type: 'ambient', intensity: 0.4, color: 0xffffff },
            {
                type: 'directional',
                position: { x: 30, y: 80, z: 20 },
                intensity: 0.9,
                color: 0xffffcc,
                castShadow: true,
            },
            {
                type: 'point',
                position: { x: 5, y: 5, z: 5 },
                intensity: 0.6,
                color: 0xffffff,
                distance: 30,
            },
        ],
    },
};
