// public/js/tenant-fds-smoke-panel-manager.js — FDS 煙 in-world パネルと照準クリック

import * as THREE from 'three';
import {
    createFdsSmokeControlPanelMesh,
    fdsSmokePanelUvHitsButton,
    isFdsSmokePanelButton,
    normalizeFdsSmokePanelEntry,
    updateFdsSmokeControlPanelPaint,
} from './fds/fds-smoke-control-panel.js';

/**
 * ワールド内 FDS 煙コントロールパネル（画面中心レイ + 照準）
 */
export class TenantFdsSmokePanelManager {
    /**
     * @param {THREE.Scene} scene
     * @param {() => import('three').Camera} getCamera
     * @param {(config: object) => void} onPlayRequest
     */
    constructor(scene, getCamera, onPlayRequest) {
        this.scene = scene;
        this.getCamera = getCamera;
        this.onPlayRequest = onPlayRequest;
        this.root = new THREE.Group();
        this.root.name = 'fds-smoke-panels-root';
        this.scene.add(this.root);

        /** @type {THREE.Mesh[]} */
        this.panels = [];
        this._raycaster = new THREE.Raycaster();
        this._ndcCenter = new THREE.Vector2(0, 0);
        /** @type {{ mesh: THREE.Mesh, onButton: boolean, distance: number } | null} */
        this._aimState = null;
        this._pressedThisFrame = false;

        this._crosshairEl = document.getElementById('fds-smoke-panel-crosshair');

        this._onPointerDown = (e) => {
            if (e.button !== 0) return;
            if (!this._aimState?.onButton) return;
            const cfg = this._aimState.mesh.userData.fdsSmokePanelConfig;
            if (!cfg) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            updateFdsSmokeControlPanelPaint(this._aimState.mesh, { buttonHovered: true, buttonPressed: true });
            this._pressedThisFrame = true;
            this.onPlayRequest(cfg);
            window.setTimeout(() => {
                if (this._aimState?.mesh) {
                    updateFdsSmokeControlPanelPaint(this._aimState.mesh, {
                        buttonHovered: this._aimState.onButton,
                        buttonPressed: false,
                    });
                }
            }, 120);
        };
        document.addEventListener('mousedown', this._onPointerDown, true);
    }

    /**
     * ワールドの fdsSmokeButtons からパネルを構築する
     * @param {object} world
     */
    loadForWorld(world) {
        this.disposePanels();
        const buttons = Array.isArray(world?.fdsSmokeButtons) ? world.fdsSmokeButtons : [];
        for (const btn of buttons) {
            if (!isFdsSmokePanelButton(btn)) continue;
            const config = normalizeFdsSmokePanelEntry(btn);
            if (!config) continue;
            const mesh = createFdsSmokeControlPanelMesh(config);
            this.root.add(mesh);
            this.panels.push(mesh);
        }
    }

    /**
     * 照準がパネル再生ボタン上にあるか
     * @returns {boolean}
     */
    isAimingAtPlayButton() {
        return Boolean(this._aimState?.onButton);
    }

    /**
     * 画面中心にパネルが見えている（照準表示用）
     * @returns {boolean}
     */
    shouldShowCrosshair() {
        return Boolean(this._aimState);
    }

    /**
     * 毎フレーム: 中心レイキャストと照準 UI
     */
    update() {
        const camera = this.getCamera();
        if (!camera || !this.panels.length) {
            this._setAimState(null);
            return;
        }

        this._raycaster.setFromCamera(this._ndcCenter, camera);
        const hits = this._raycaster.intersectObjects(this.panels, false);
        let next = null;
        for (const hit of hits) {
            const mesh = hit.object;
            const cfg = mesh.userData.fdsSmokePanelConfig;
            if (!cfg) continue;
            if (hit.distance > cfg.maxDistance) continue;
            const onButton = fdsSmokePanelUvHitsButton(hit.uv, mesh.userData.fdsSmokePanelButtonRect);
            next = { mesh, onButton, distance: hit.distance };
            break;
        }

        const prevMesh = this._aimState?.mesh;
        const prevOnButton = this._aimState?.onButton;
        this._setAimState(next);

        if (prevMesh && prevMesh !== next?.mesh) {
            updateFdsSmokeControlPanelPaint(prevMesh, { buttonHovered: false, buttonPressed: false });
        }
        if (next?.mesh && (prevMesh !== next.mesh || prevOnButton !== next.onButton)) {
            updateFdsSmokeControlPanelPaint(next.mesh, {
                buttonHovered: next.onButton,
                buttonPressed: false,
            });
        }
    }

    /**
     * @param {{ mesh: THREE.Mesh, onButton: boolean, distance: number } | null} state
     */
    _setAimState(state) {
        this._aimState = state;
        if (!this._crosshairEl) return;
        if (!state) {
            this._crosshairEl.hidden = true;
            this._crosshairEl.classList.remove('fds-smoke-panel-crosshair--on-button');
            return;
        }
        this._crosshairEl.hidden = false;
        this._crosshairEl.classList.toggle('fds-smoke-panel-crosshair--on-button', state.onButton);
    }

    disposePanels() {
        for (const mesh of this.panels) {
            mesh.geometry?.dispose();
            const mat = mesh.material;
            if (mat?.map) mat.map.dispose();
            mat?.dispose();
            this.root.remove(mesh);
        }
        this.panels = [];
        this._setAimState(null);
    }

    dispose() {
        document.removeEventListener('mousedown', this._onPointerDown, true);
        this.disposePanels();
        this.scene.remove(this.root);
    }
}
