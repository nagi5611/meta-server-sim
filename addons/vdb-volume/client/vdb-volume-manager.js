// addons/vdb-volume/client/vdb-volume-manager.js — ワールド vdbs[] をシーンに配置
import * as THREE from 'three';
import { UnsignedByteType } from 'three';
import { VDBLoader } from './vendor/three-vdb-loader/VDBLoader.js';
import { createVdbRaymarchMesh, getVdbMeshWorldBox } from './vdb-raymarch-mesh.js';

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
 * @param {THREE.Object3D} root
 * @param {THREE.Mesh} mesh
 */
function mountMeshWithWorldOffset(root, mesh, transform = {}) {
    const anchor = new THREE.Group();
    anchor.name = 'vdb-volume-anchor';
    if (transform.position) {
        anchor.position.set(
            transform.position.x ?? 0,
            transform.position.y ?? 0,
            transform.position.z ?? 0,
        );
    }
    if (transform.rotation) {
        anchor.rotation.set(
            ((transform.rotation.x ?? 0) * Math.PI) / 180,
            ((transform.rotation.y ?? 0) * Math.PI) / 180,
            ((transform.rotation.z ?? 0) * Math.PI) / 180,
            'XYZ',
        );
    }
    const ws = typeof transform.worldScale === 'number' ? transform.worldScale : 1;
    if (ws !== 1) {
        anchor.scale.setScalar(ws);
    }
    anchor.add(mesh);
    anchor.updateMatrixWorld(true);
    root.add(anchor);
    return anchor;
}

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
        /** @type {Array<{ id: string, mesh: THREE.Mesh, anchor: THREE.Group }>} */
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
                const anchor = mountMeshWithWorldOffset(this.root, mesh, cfg);
                mesh.updateMatrixWorld(true);
                const worldBox = getVdbMeshWorldBox(mesh);
                anchor.userData.vdbWorldBox = {
                    min: worldBox.min.toArray(),
                    max: worldBox.max.toArray(),
                    center: worldBox.getCenter(new THREE.Vector3()).toArray(),
                };
                this.entries.push({ id: cfg.id || gridName, mesh, anchor });
            } catch (e) {
                console.warn('[addon:vdb-volume] load failed', cfg, e);
            }
        }
        this._loading = false;
        this._publishState();
    }

    disposeMeshes() {
        for (const { mesh, anchor } of this.entries) {
            anchor.removeFromParent();
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

    /**
     * @param {string} [id]
     */
    getEntryWorldBox(id = 'smoke-demo') {
        const entry = this.entries.find((e) => e.id === id) ?? this.entries[0];
        if (!entry?.mesh) return null;
        entry.mesh.updateMatrixWorld(true);
        const box = getVdbMeshWorldBox(entry.mesh);
        return {
            min: box.min.toArray(),
            max: box.max.toArray(),
            center: box.getCenter(new THREE.Vector3()).toArray(),
            size: box.getSize(new THREE.Vector3()).toArray(),
        };
    }

    /**
     * スクリーンショット用: プレイヤーとカメラをボリュームの手前へ
     * @param {string} [id]
     */
    frameVolumeForView(id = 'smoke-demo') {
        const box = this.getEntryWorldBox(id);
        if (!box || !this.app) return null;
        const center = new THREE.Vector3().fromArray(box.center);
        const size = Math.max(...box.size, 2);
        const cam = this.app.sceneManager?.getCamera?.();
        const eye = center
            .clone()
            .add(new THREE.Vector3(size * 0.9, size * 0.35, size * 1.15));
        if (this.app.characterController?.setPosition) {
            this.app.characterController.setPosition(eye.x, eye.y, eye.z);
            this.app.characterController.resetVelocity?.();
        }
        if (cam) {
            cam.position.copy(eye);
            cam.lookAt(center);
        }
        this.app.playerManager?.updateLocalPlayer?.(eye, this.app.characterController?.getRotation?.());
        return { eye: eye.toArray(), target: center.toArray(), box };
    }

    /**
     * 画面中央ピクセル RGBA（WebGL readPixels）
     */
    sampleCenterPixel() {
        const renderer = this.app?.sceneManager?.getRenderer?.();
        if (!renderer) return null;
        const canvas = renderer.domElement;
        const gl = renderer.getContext();
        const w = canvas.width;
        const h = canvas.height;
        if (!w || !h) return null;
        const buf = new Uint8Array(4);
        gl.readPixels(Math.floor(w / 2), Math.floor(h / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        return { r: buf[0], g: buf[1], b: buf[2], a: buf[3] };
    }

    _publishState() {
        const boxes = {};
        for (const { id, mesh } of this.entries) {
            mesh.updateMatrixWorld(true);
            const box = getVdbMeshWorldBox(mesh);
            boxes[id] = {
                center: box.getCenter(new THREE.Vector3()).toArray(),
                size: box.getSize(new THREE.Vector3()).toArray(),
            };
        }
        globalThis.__tenantVdbVolume = {
            meshCount: this.entries.length,
            ids: this.entries.map((e) => e.id),
            loading: this._loading,
            boxes,
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
        const current = wm.getCurrentWorld?.();
        if (current) {
            void this.loadForWorld(current);
        }
    }
}