// public/js/tenant-world-edit-vdb-preview.js — ワールド編集で VDB 雲をライブプレビュー

import { collectVdbSnapshotFromEditGroup } from './tenant-world-edit-vdb-snapshot.js';

export { collectVdbSnapshotFromEditGroup };

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