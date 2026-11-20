// public/js/tenant-world-edit-vdb-shim.js — setting.js 無改変で vdbs[] を載せる（sim 専用）
import * as THREE from 'three';
import { collectVdbSnapshotFromEditGroup } from './tenant-world-edit-vdb-snapshot.js';

/** @type {string | null} */
let activeTenantId = null;
/** @type {THREE.Group | null} */
let editGroupRef = null;
/** @type {string} */
let lastInjectedWorldId = '';
/** @type {Promise<void> | null} */
let injectInFlight = null;

const DEFAULT_VDB_ENTRY = {
    gridName: 'density',
    worldScale: 3.2,
    densityScale: 0.78,
    raySteps: 44,
    lightSteps: 5,
    extinction: 1.4,
    scattering: 0.85,
    ambient: 0.22,
    anisotropy: 0.55,
    tint: [0.93, 0.96, 1.0],
    sun: { yaw: 40, pitch: 58 },
};

/**
 * @returns {string | null}
 */
function getSelectedWorldIdFromDom() {
    const sel = document.querySelector('#world-list .item.selected');
    return sel?.dataset?.id ?? null;
}

/**
 * @param {object} config
 * @param {THREE.Group} editGroup
 * @returns {THREE.Group}
 */
function createVdbProxyInEditor(config, editGroup) {
    const pos = config.position || { x: 0, y: 20, z: 0 };
    const rot = config.rotation || { x: 0, y: 0, z: 0 };
    const ws = typeof config.worldScale === 'number' && config.worldScale > 0 ? config.worldScale : 3;

    const group = new THREE.Group();
    group.userData.vdbVolumeConfig = JSON.parse(JSON.stringify(config));

    const defaultSize = 12;
    const geom = new THREE.BoxGeometry(defaultSize, defaultSize, defaultSize);
    const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        new THREE.LineBasicMaterial({ color: 0xaaccff }),
    );
    const mat = new THREE.MeshBasicMaterial({
        color: 0xc8e8ff,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.vdbVolumeConfig = group.userData.vdbVolumeConfig;
    mesh.position.set(defaultSize / 2, defaultSize / 2, defaultSize / 2);
    edges.position.set(defaultSize / 2, defaultSize / 2, defaultSize / 2);
    group.add(edges);
    group.add(mesh);

    group.position.set(pos.x, pos.y, pos.z);
    group.rotation.set(
        (rot.x * Math.PI) / 180,
        (rot.y * Math.PI) / 180,
        (rot.z * Math.PI) / 180,
    );
    group.scale.set(ws, ws, ws);
    editGroup.add(group);
    return group;
}

/**
 * @param {string} worldId
 * @param {THREE.Group} editGroup
 */
async function injectVdbsForWorld(worldId, editGroup) {
    if (!activeTenantId || !worldId || !editGroup) return;
    const res = await fetch(`/admin/tenants/${encodeURIComponent(activeTenantId)}/worlds`, {
        credentials: 'include',
    });
    if (!res.ok) return;
    const worlds = await res.json();
    const world = worlds?.[worldId];
    const configs = Array.isArray(world?.vdbs) ? world.vdbs : [];
    const existingIds = new Set();
    for (const child of editGroup.children) {
        const id = child.userData?.vdbVolumeConfig?.id;
        if (id) existingIds.add(id);
    }
    for (const cfg of configs) {
        if (!cfg?.file) continue;
        const id = cfg.id || cfg.file;
        if (existingIds.has(id)) continue;
        createVdbProxyInEditor(cfg, editGroup);
        existingIds.add(id);
    }
}

/**
 * worlds/patch 送信時に vdbs[] を注入する
 */
function installWorldsPatchFetchShim() {
    if (globalThis.__tenantWorldEditVdbPatchShimInstalled) return;
    globalThis.__tenantWorldEditVdbPatchShimInstalled = true;
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
        const url =
            typeof input === 'string'
                ? input
                : input instanceof URL
                  ? `${input.pathname}${input.search}`
                  : input instanceof Request
                    ? input.url
                    : String(input);
        const isPatch =
            (url.includes('/admin/worlds/patch') || url.includes('/worlds/patch'))
            && (!init?.method || init.method.toUpperCase() === 'POST');
        if (isPatch && editGroupRef && init?.body && typeof init.body === 'string') {
            try {
                const data = JSON.parse(init.body);
                if (data && typeof data === 'object' && data.patch && typeof data.patch === 'object') {
                    data.patch.vdbs = collectVdbSnapshotFromEditGroup(editGroupRef).vdbs;
                    init = { ...init, body: JSON.stringify(data) };
                }
            } catch {
                /* leave body unchanged */
            }
        }
        return nativeFetch(input, init);
    };
}

/**
 * VDB プロパティ UI（sim 専用）
 */
function wireVdbPropertyInputs() {
    const block = document.getElementById('object-props-vdb-volume');
    if (!block || block.dataset.vdbShimWired) return;
    block.dataset.vdbShimWired = '1';

    const syncFromPanel = () => {
        const obj = editGroupRef?.children.find(
            (c) => c.userData?.vdbVolumeConfig && c === globalThis.__tenantVdbEditSelection,
        );
        if (!obj?.userData?.vdbVolumeConfig) return;
        const c = obj.userData.vdbVolumeConfig;
        obj.position.set(
            parseFloat(document.getElementById('obj-pos-x')?.value) || 0,
            parseFloat(document.getElementById('obj-pos-y')?.value) || 0,
            parseFloat(document.getElementById('obj-pos-z')?.value) || 0,
        );
        obj.rotation.set(
            ((parseFloat(document.getElementById('obj-rot-x')?.value) || 0) * Math.PI) / 180,
            ((parseFloat(document.getElementById('obj-rot-y')?.value) || 0) * Math.PI) / 180,
            ((parseFloat(document.getElementById('obj-rot-z')?.value) || 0) * Math.PI) / 180,
        );
        const ws = parseFloat(document.getElementById('obj-vdb-world-scale')?.value) || 3;
        obj.scale.setScalar(ws);
        c.position = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
        c.rotation = {
            x: (obj.rotation.x * 180) / Math.PI,
            y: (obj.rotation.y * 180) / Math.PI,
            z: (obj.rotation.z * 180) / Math.PI,
        };
        c.worldScale = ws;
        c.gridName = String(document.getElementById('obj-vdb-grid')?.value || 'density').trim();
        const num = (id, fb) => {
            const v = parseFloat(document.getElementById(id)?.value);
            return Number.isFinite(v) ? v : fb;
        };
        c.densityScale = num('obj-vdb-density', 0.78);
        c.raySteps = Math.round(num('obj-vdb-ray-steps', 44));
        c.lightSteps = Math.round(num('obj-vdb-light-steps', 5));
        c.extinction = num('obj-vdb-extinction', 1.4);
        c.scattering = num('obj-vdb-scattering', 0.85);
        c.ambient = num('obj-vdb-ambient', 0.22);
        c.anisotropy = num('obj-vdb-anisotropy', 0.55);
        const hex = String(document.getElementById('obj-vdb-tint')?.value || 'eef6ff').replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
            c.tint = [
                parseInt(hex.slice(0, 2), 16) / 255,
                parseInt(hex.slice(2, 4), 16) / 255,
                parseInt(hex.slice(4, 6), 16) / 255,
            ];
        }
        c.sun = { yaw: num('obj-vdb-sun-yaw', 40), pitch: num('obj-vdb-sun-pitch', 58) };
    };

    block.addEventListener('change', syncFromPanel);
    block.addEventListener('input', syncFromPanel);

    document.getElementById('canvas')?.addEventListener('pointerup', () => {
        let hit = null;
        for (const child of editGroupRef?.children || []) {
            if (child.userData?.vdbVolumeConfig) {
                hit = child;
                break;
            }
        }
        globalThis.__tenantVdbEditSelection = hit;
        if (hit) {
            const det = document.getElementById('object-props-vdb-volume');
            const props = document.getElementById('object-props');
            const hint = document.getElementById('object-hint');
            if (det) det.style.display = '';
            if (props) props.style.display = 'block';
            if (hint) hint.style.display = 'none';
            const c = hit.userData.vdbVolumeConfig;
            const set = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.value = val;
            };
            set('obj-path', c.id || c.file || 'VDB雲');
            set('obj-pos-x', hit.position.x);
            set('obj-pos-y', hit.position.y);
            set('obj-pos-z', hit.position.z);
            set('obj-vdb-id', c.id || '');
            set('obj-vdb-file', c.file || '');
            set('obj-vdb-grid', c.gridName || 'density');
            set('obj-vdb-world-scale', c.worldScale ?? hit.scale.x);
            set('obj-vdb-density', c.densityScale ?? 0.78);
            set('obj-vdb-ray-steps', c.raySteps ?? 44);
            set('obj-vdb-light-steps', c.lightSteps ?? 5);
            set('obj-vdb-extinction', c.extinction ?? 1.4);
            set('obj-vdb-scattering', c.scattering ?? 0.85);
            set('obj-vdb-ambient', c.ambient ?? 0.22);
            set('obj-vdb-anisotropy', c.anisotropy ?? 0.55);
            if (Array.isArray(c.tint)) {
                const hex = c.tint
                    .map((n) => Math.round((n ?? 0) * 255).toString(16).padStart(2, '0'))
                    .join('');
                set('obj-vdb-tint', hex);
            }
            set('obj-vdb-sun-yaw', c.sun?.yaw ?? 40);
            set('obj-vdb-sun-pitch', c.sun?.pitch ?? 58);
        }
    });
}

/**
 * @param {string} file
 * @returns {{ ok: boolean, duplicate?: boolean, error?: string }}
 */
export function addVdbVolumeFromLibrary(file) {
    const rel = String(file || '').trim().replace(/^\/+/, '');
    const worldId = getSelectedWorldIdFromDom();
    if (!rel || !worldId) {
        return { ok: false, error: 'ワールドまたはファイルが未選択です。' };
    }
    if (!editGroupRef) {
        return { ok: false, error: 'エディタシーンがまだ準備できていません。' };
    }
    const baseName = rel.split('/').pop() || 'vdb';
    const entryId = `vdb-${baseName.replace(/\.(vdb|nvdb)$/i, '')}`;

    const exists = editGroupRef.children.some((child) => {
        const cfg = child.userData?.vdbVolumeConfig;
        return cfg && (cfg.file === rel || cfg.id === entryId);
    });
    if (exists) {
        return { ok: true, duplicate: true };
    }

    const entry = {
        id: entryId,
        file: rel,
        ...DEFAULT_VDB_ENTRY,
        position: { x: 0, y: 22, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
    };
    createVdbProxyInEditor(entry, editGroupRef);
    return { ok: true };
}

/**
 * @param {string} tenantId
 * @returns {Promise<void>}
 */
export async function installTenantWorldEditVdbShim(tenantId) {
    activeTenantId = tenantId;
    installWorldsPatchFetchShim();
    wireVdbPropertyInputs();

    const { registerWorldEditFrameHook, registerWorldEditSceneClearHook } = await import(
        '@metaverse-simple/setting.js'
    );

    registerWorldEditSceneClearHook(() => {
        editGroupRef = null;
        lastInjectedWorldId = '';
    });

    registerWorldEditFrameHook(({ editGroup }) => {
        editGroupRef = editGroup;
        const worldId = getSelectedWorldIdFromDom();
        if (!worldId || worldId === lastInjectedWorldId) return;
        if (injectInFlight) return;
        injectInFlight = injectVdbsForWorld(worldId, editGroup)
            .then(() => {
                lastInjectedWorldId = worldId;
            })
            .finally(() => {
                injectInFlight = null;
            });
    });
}