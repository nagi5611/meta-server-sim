// addons/vdb-volume/client/vdb-volume-manager.js — ワールド vdbVolumes[] をシーンに配置
import * as THREE from 'three';
import { UnsignedByteType } from 'three';
import { VDBLoader } from './vendor/three-vdb-loader/VDBLoader.js';
import { createVdbRaymarchMesh } from './vdb-raymarch-mesh.js';

/**
 * @param {string} tenantId
 */
function tenantIdFromPath(tenantId) {
    if (tenantId) return tenantId;
    const parts = String(globalThis.location?.pathname || '')
        .split('/')
        .filter(Boolean);
    if (!parts.length) return '';
    const first = parts[0];
    if (first === 'admin' || first === 'api') return '';
    return first;
}

/**
 * @param {string} tenantId
 * @param {string} relPath
 */
function resolveAddonAssetUrl(tenantId, relPath) {
    const tid = encodeURIComponent(tenantIdFromPath(tenantId));
    const clean = String(relPath || '').replace(/^\/+/, '');
    return `/${tid}/addons-client/vdb-volume/${clean}`;
}

/**
 * @typedef {object} VdbVolumeConfig
 * @property {string} id
 * @property {string} file
 * @property {string} [gridName]
 * @property {{ x?: number, y?: number, z?: number }} [position]
 * @property {{ x?: number, y?: number, z?: number }} [rotation]
 * @property {number} [worldScale]
 * @property {number} [raySteps]
 * @property {number} [densityScale]
 */

export class VdbVolumeManager {
    /**
     * @param {object} app tenant metaverse app
     * @param {object} [pluginConfig]
     */
    constructor(app, pluginConfig = {}) {
        this.app = app;
        this.pluginConfig = pluginConfig;
        this.tenantId = app?.tenantId ?? tenantIdFromPath();
        /** @type {THREE.Scene | null} */
        this.scene = null;
        /** @type {THREE.Group} */
        this.root = new THREE.Group();
        this.root.name = 'vdb-volume-root';
        /** @type {Array<{ id: string, mesh: THREE.Mesh }>} */
        this.entries = [];
        this._worldHooked = false;
        this._loading = false;
    }

    /**
     * @param {THREE.Scene} scene
     */
    attachScene(scene) {
        this.scene = scene;
        if (!this.root.parent) {
            scene.add(this.root);
        }
    }

    /**
     * @param {object} [world]
     */
    async loadForWorld(world) {
        this.disposeMeshes();
        const configs = Array.isArray(world?.vdbs) ? world.vdbs : [];
        if (!configs.length) {
            this._publishState();
            return;
        }
        if (!this.scene) {
            const scene = this.app?.sceneManager?.getScene?.();
            if (scene) this.attachScene(scene);
        }
        if (!this.scene) return;

        this._loading = true;
        const loader = new VDBLoader();
        loader.textureType = UnsignedByteType;

        for (const cfg of configs) {
            if (!cfg?.file) continue;
            const gridName =
                typeof cfg.gridName === 'string' && cfg.gridName
                    ? cfg.gridName
                    : this.pluginConfig.defaultGridName || 'density';
            try {
                const url = resolveAddonAssetUrl(this.tenantId, cfg.file);
                const grids = await loader.setGridNames([gridName]).loadAsync(url);
                const grid = grids[0];
                if (!grid) {
                    console.warn('[addon:vdb-volume] grid not found', gridName, url);
                    continue;
                }
                const mesh = createVdbRaymarchMesh(grid, {
                    raySteps: cfg.raySteps ?? this.pluginConfig.raySteps,
                    densityScale: cfg.densityScale ?? this.pluginConfig.densityScale,
                });
                mesh.userData.vdbVolumeId = cfg.id || gridName;

                if (cfg.position) {
                    const pos = new THREE.Vector3(
                        cfg.position.x ?? 0,
                        cfg.position.y ?? 0,
                        cfg.position.z ?? 0,
                    );
                    mesh.matrix.premultiply(new THREE.Matrix4().makeTranslation(pos));
                    mesh.updateMatrixWorld(true);
                }
                if (cfg.rotation) {
                    const euler = new THREE.Euler(
                        ((cfg.rotation.x ?? 0) * Math.PI) / 180,
                        ((cfg.rotation.y ?? 0) * Math.PI) / 180,
                        ((cfg.rotation.z ?? 0) * Math.PI) / 180,
                        'XYZ',
                    );
                    mesh.matrix.premultiply(new THREE.Matrix4().makeRotationFromEuler(euler));
                    mesh.updateMatrixWorld(true);
                }
                const ws = typeof cfg.worldScale === 'number' ? cfg.worldScale : 1;
                if (ws !== 1) {
                    mesh.matrix.premultiply(new THREE.Matrix4().makeScale(ws, ws, ws));
                    mesh.updateMatrixWorld(true);
                }

                this.root.add(mesh);
                this.entries.push({ id: cfg.id || gridName, mesh });
            } catch (e) {
                console.warn('[addon:vdb-volume] load failed', cfg, e);
            }
        }
        this._loading = false;
        this._publishState();
    }

    disposeMeshes() {
        for (const { mesh } of this.entries) {
            this.root.remove(mesh);
            mesh.geometry?.dispose?.();
            if (mesh.material) {
                const mat = mesh.material;
                mat.uniforms?.map?.value?.dispose?.();
                mat.dispose?.();
            }
        }
        this.entries = [];
        this._publishState();
    }

    dispose() {
        this.disposeMeshes();
        this.root.removeFromParent();
        this.scene = null;
    }

    hasEntries() {
        return this.entries.length > 0;
    }

    _publishState() {
        globalThis.__tenantVdbVolume = {
            meshCount: this.entries.length,
            ids: this.entries.map((e) => e.id),
            loading: this._loading,
        };
    }

    hookWorldChanges() {
        if (this._worldHooked) return;
        const wm = this.app?.worldManager;
        if (!wm || typeof wm.onWorldChange !== 'function') return;
        this._worldHooked = true;
        wm.onWorldChange((world) => {
            void this.loadForWorld(world);
        });
        const current = wm.getCurrentWorld?.() ?? wm.currentWorld;
        if (current) {
            void this.loadForWorld(current);
        }
    }
}