// public/js/tenant-world-edit-fds-smoke-panel.js — ワールド編集 3D ビューで FDS 煙再生パネル表示・再生

import { TenantFdsSmokeManager } from './tenant-fds-smoke-manager.js';
import { TenantFdsSmokePanelManager } from './tenant-fds-smoke-panel-manager.js';
import { collectFdsWorldSnapshotFromEditGroup } from './tenant-world-edit-fds-snapshot.js';
import {
    setWorldEditFdsSmokePreviewSuppressed,
    syncWorldEditFdsSmokePreviewSuppression,
} from './tenant-world-edit-fds-smoke.js';

export { collectFdsWorldSnapshotFromEditGroup } from './tenant-world-edit-fds-snapshot.js';

/**
 * ワールド編集プレビューで in-world 煙再生パネルとクリック再生を有効化する
 */
export class TenantWorldEditFdsSmokePanelIntegration {
    constructor() {
        /** @type {TenantFdsSmokePanelManager | null} */
        this._panelManager = null;
        /** @type {TenantFdsSmokeManager | null} */
        this._smokeManager = null;
        this._lastButtonsKey = '';
        this._lastSmokesKey = '';
        this._lastFrameMs = performance.now();
        this._unregisterFrame = null;
        this._unregisterClear = null;
    }

    /**
     * setting.js のワールド編集ループに接続する
     * @returns {Promise<void>}
     */
    async install() {
        const { registerWorldEditFrameHook, registerWorldEditSceneClearHook } = await import(
            '@metaverse-simple/setting.js'
        );
        this._unregisterFrame = registerWorldEditFrameHook((ctx) => this._onFrame(ctx));
        this._unregisterClear = registerWorldEditSceneClearHook(() => this.dispose());
    }

    /**
     * @param {{ scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, editGroup: THREE.Group }} ctx
     */
    _onFrame(ctx) {
        const { scene, camera, renderer, editGroup } = ctx;
        const now = performance.now();
        let deltaTime = (now - this._lastFrameMs) / 1000;
        this._lastFrameMs = now;
        if (deltaTime > 0.1) deltaTime = 0.1;

        if (!this._panelManager) {
            this._smokeManager = new TenantFdsSmokeManager(scene);
            this._panelManager = new TenantFdsSmokePanelManager(scene, () => camera, (panelConfig) => {
                void this._handlePanelPlay(editGroup, panelConfig);
            });
        }

        const snapshot = collectFdsWorldSnapshotFromEditGroup(editGroup);
        const buttonsKey = JSON.stringify(snapshot.fdsSmokeButtons);
        if (buttonsKey !== this._lastButtonsKey) {
            this._lastButtonsKey = buttonsKey;
            this._panelManager.loadForWorld(snapshot);
        }

        this._smokeManager?.update(deltaTime);
        this._panelManager.update();

        if (this._smokeManager?.hasEntries()) {
            syncWorldEditFdsSmokePreviewSuppression(this._smokeManager);
            this._smokeManager.prepareRender(renderer, scene, camera);
        }
    }

    /**
     * パネル再生ボタン押下時に FDS 煙をアニメ再生する
     * @param {THREE.Group} editGroup
     * @param {object} panelConfig
     */
    async _handlePanelPlay(editGroup, panelConfig) {
        const smokeId = String(panelConfig?.fdsSmokeId || '').trim();
        if (!smokeId || !this._smokeManager) return;

        const snapshot = collectFdsWorldSnapshotFromEditGroup(editGroup);
        const smokesKey = JSON.stringify(snapshot.fdsSmokes);
        if (smokesKey !== this._lastSmokesKey) {
            this._lastSmokesKey = smokesKey;
            await this._smokeManager.loadForWorld(snapshot);
        }

        setWorldEditFdsSmokePreviewSuppressed(smokeId, true);
        await this._smokeManager.startPlayback(smokeId, {
            fromFrame: panelConfig.playback?.fromFrame ?? 0,
            loop: panelConfig.playback?.loop !== false,
            framesPerSecond: panelConfig.playback?.framesPerSecond ?? 1,
            secondsPerFrame: panelConfig.playback?.secondsPerFrame,
        });
    }

    dispose() {
        this._unregisterFrame?.();
        this._unregisterFrame = null;
        this._unregisterClear?.();
        this._unregisterClear = null;
        this._panelManager?.dispose();
        this._panelManager = null;
        this._smokeManager?.dispose();
        this._smokeManager = null;
        this._lastButtonsKey = '';
        this._lastSmokesKey = '';
        setWorldEditFdsSmokePreviewSuppressed(null, false);
    }
}

/** @type {TenantWorldEditFdsSmokePanelIntegration | null} */
let integrationInstance = null;

/**
 * ワールド編集の FDS 煙再生パネル統合を有効化する
 * @returns {Promise<void>}
 */
export async function initTenantWorldEditFdsSmokePanel() {
    if (integrationInstance) return;
    integrationInstance = new TenantWorldEditFdsSmokePanelIntegration();
    await integrationInstance.install();
}
