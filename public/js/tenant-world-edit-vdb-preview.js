// public/js/tenant-world-edit-vdb-preview.js — ワールド編集で VDB 雲をライブプレビュー

/**
 * @param {THREE.Group} editGroup
 * @returns {{ vdbs: object[] }}
 */
export function collectVdbSnapshotFromEditGroup(editGroup) {
    const vdbs = [];
    if (!editGroup) return { vdbs };
    editGroup.children.forEach((child) => {
        const cfg = child.userData?.vdbVolumeConfig;
        if (!cfg) return;
        const entry = JSON.parse(JSON.stringify(cfg));
        entry.position = { x: child.position.x, y: child.position.y, z: child.position.z };
        entry.rotation = {
            x: (child.rotation.x * 180) / Math.PI,
            y: (child.rotation.y * 180) / Math.PI,
            z: (child.rotation.z * 180) / Math.PI,
        };
        const ws = typeof entry.worldScale === 'number' ? entry.worldScale : child.scale.x;
        entry.worldScale = ws;
        vdbs.push(entry);
    });
    return { vdbs };
}

let previewManager = null;
let previewTenantId = '';
let lastKey = '';

/**
 * @param {string} tenantId
 * @returns {Promise<void>}
 */
export async function initTenantWorldEditVdbPreview(tenantId) {
    previewTenantId = tenantId;
    const { registerWorldEditFrameHook, registerWorldEditSceneClearHook } = await import(
        '@metaverse-simple/setting.js'
    );
    registerWorldEditFrameHook((ctx) => {
        void onWorldEditFrame(ctx);
    });
    registerWorldEditSceneClearHook(() => {
        previewManager?.dispose?.();
        previewManager = null;
        lastKey = '';
    });
}

/**
 * @param {{ scene: THREE.Scene, editGroup: THREE.Group }} ctx
 */
async function onWorldEditFrame(ctx) {
    const { scene, editGroup } = ctx;
    const snapshot = collectVdbSnapshotFromEditGroup(editGroup);
    const key = JSON.stringify(snapshot.vdbs);
    if (key === lastKey && previewManager) return;
    lastKey = key;

    if (!previewManager) {
        try {
            const mod = await import(
                `/${encodeURIComponent(previewTenantId)}/addons-client/vdb-volume/client/vdb-volume-manager.js`
            );
            const fakeApp = { tenantId: previewTenantId, sceneManager: { getScene: () => scene } };
            previewManager = new mod.VdbVolumeManager(fakeApp, { defaultGridName: 'density' });
            previewManager.attachScene(scene);
        } catch (err) {
            console.warn('[tenant-world-edit-vdb-preview] load failed', err);
            return;
        }
    }
    await previewManager.loadForWorld(snapshot);
}