// public/js/tenant-fds-smoke-exposure.js — 頭位置の煙濃度・曝露量・デバッグ表示

import * as THREE from 'three';
import { isDeveloperModeEnabled } from '../../../metaverse-simple/public/js/metaverse-client-settings.js';
import {
    normalizedSootToPhysical,
    SMOKE_INSIDE_NORMALIZED_THRESHOLD,
} from './fds/fds-volume-sampler.js';

const SAMPLE_INTERVAL_SEC = 0.1;
const SMOKE_INCREASE_EPS = 1e-4;

/**
 * FDS 煙の頭位置サンプリング・曝露量近似・開発者モードの頭マーカー
 */
export class TenantFdsSmokeExposureMonitor {
    /**
     * @param {THREE.Scene} scene
     * @param {import('./tenant-fds-smoke-manager.js').TenantFdsSmokeManager} fdsSmokeManager
     * @param {import('../../../metaverse-simple/public/js/player-manager.js').default} playerManager
     */
    constructor(scene, fdsSmokeManager, playerManager) {
        this.scene = scene;
        this.fdsSmokeManager = fdsSmokeManager;
        this.playerManager = playerManager;
        this._accumulator = 0;
        this._headWorld = new THREE.Vector3();
        this._lastNormalized = 0;
        this._exposureNormalized = 0;
        this._exposurePhysical = 0;
        this._smokeIncreasing = false;
        this._inSmoke = false;
        this._lastSample = null;

        this._headDebugMesh = this._createHeadDebugMesh();
        this.scene.add(this._headDebugMesh);

        this._hudEl = document.getElementById('fds-smoke-exposure-hud');
    }

    /**
     * @returns {THREE.Mesh}
     */
    _createHeadDebugMesh() {
        const geometry = new THREE.SphereGeometry(0.12, 16, 12);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff66cc,
            transparent: true,
            opacity: 0.85,
            depthTest: true,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'fds-smoke-head-debug';
        mesh.renderOrder = 9999;
        mesh.visible = false;
        return mesh;
    }

    /**
     * @param {number} deltaTime
     */
    update(deltaTime) {
        if (!this.fdsSmokeManager?.hasEntries()) {
            this._headDebugMesh.visible = false;
            if (this._hudEl) this._hudEl.hidden = true;
            return;
        }

        const devMode = isDeveloperModeEnabled();
        const hasHead = this.playerManager?.getLocalHeadWorldPosition(this._headWorld);

        if (devMode && hasHead) {
            this._headDebugMesh.position.copy(this._headWorld);
            this._headDebugMesh.visible = true;
        } else {
            this._headDebugMesh.visible = false;
        }

        if (!hasHead) {
            return;
        }

        this._accumulator += deltaTime;
        if (this._accumulator < SAMPLE_INTERVAL_SEC) {
            return;
        }
        const dt = this._accumulator;
        this._accumulator = 0;

        const sample = this.fdsSmokeManager.sampleNormalizedSootAtWorld(this._headWorld);
        const normalized = sample.normalized;
        this._inSmoke = sample.inSmoke;
        this._smokeIncreasing = normalized > this._lastNormalized + SMOKE_INCREASE_EPS;
        this._lastNormalized = normalized;

        this._exposureNormalized += normalized * dt;

        const valueMax = this.fdsSmokeManager.getPrimaryManifestValueMax?.() ?? 1;
        const physical = normalizedSootToPhysical(normalized, { valueMax });
        if (physical != null) {
            this._exposurePhysical += physical * dt;
        }

        this._lastSample = {
            normalized,
            inSmoke: sample.inSmoke,
            smokeIncreasing: this._smokeIncreasing,
            exposureNormalized: this._exposureNormalized,
            exposurePhysical: this._exposurePhysical,
            valueMax,
            perVolume: sample.perVolume,
            head: { x: this._headWorld.x, y: this._headWorld.y, z: this._headWorld.z },
        };

        if (devMode) {
            this._updateHud(this._lastSample);
            console.log(
                `[FdsSmokeExposure] norm=${normalized.toFixed(4)} inSmoke=${sample.inSmoke} increasing=${this._smokeIncreasing} ∫norm≈${this._exposureNormalized.toFixed(4)} head=(${this._headWorld.x.toFixed(2)},${this._headWorld.y.toFixed(2)},${this._headWorld.z.toFixed(2)})`,
            );
        } else if (this._hudEl) {
            this._hudEl.hidden = true;
        }
    }

    /**
     * ワールド切替時に曝露量をリセット
     */
    reset() {
        this._accumulator = 0;
        this._lastNormalized = 0;
        this._exposureNormalized = 0;
        this._exposurePhysical = 0;
        this._smokeIncreasing = false;
        this._inSmoke = false;
        this._lastSample = null;
    }

    /**
     * @param {object} sample
     */
    _updateHud(sample) {
        if (!this._hudEl) return;
        this._hudEl.hidden = false;
        const phys = sample.exposurePhysical;
        const physLine =
            sample.valueMax > 0
                ? `曝露(物理近似): ${phys.toFixed(4)} (valueMax=${sample.valueMax})`
                : `曝露(物理近似): —`;
        this._hudEl.innerHTML = [
            '<strong>FDS 煙（頭位置）</strong>',
            `正規化密度: ${sample.normalized.toFixed(4)} (閾値 ${SMOKE_INSIDE_NORMALIZED_THRESHOLD})`,
            `煙内: ${sample.inSmoke ? 'はい' : 'いいえ'}`,
            `濃度増加: ${sample.smokeIncreasing ? 'はい' : 'いいえ'}`,
            `曝露 ∫ρ·dt (正規化): ${sample.exposureNormalized.toFixed(4)}`,
            physLine,
            `頭: ${sample.head.x.toFixed(2)}, ${sample.head.y.toFixed(2)}, ${sample.head.z.toFixed(2)}`,
        ].join('<br>');
    }

    /**
     * 直近サンプル（UI・テスト用）
     */
    getLastSample() {
        return this._lastSample;
    }

    dispose() {
        if (this._headDebugMesh) {
            this.scene.remove(this._headDebugMesh);
            this._headDebugMesh.geometry?.dispose();
            this._headDebugMesh.material?.dispose();
        }
        if (this._hudEl) this._hudEl.hidden = true;
    }
}
