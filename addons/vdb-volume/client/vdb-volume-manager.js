// addons/vdb-volume/client/vdb-volume-manager.js — ワールド vdbs[] をシーンに配置
import * as THREE from 'three';
import { UnsignedByteType } from 'three';
import { VDBLoader } from './vendor/three-vdb-loader/VDBLoader.js';
import {
    createVdbRaymarchMesh,
    getVdbMeshWorldBox,
    resolveRaymarchRenderOpts,
    updateSunDirectionUniform,
    applyPerformanceUniforms,
} from './vdb-raymarch-mesh.js';

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
/**
 * @param {string} tenantId
 * @param {string} relPath
 */
export function resolveVdbVolumeFileUrl(tenantId, relPath) {
    const tid = encodeURIComponent(tenantIdFromPath(tenantId));
    const clean = String(relPath || '').replace(/^\/+/, '');
    if (clean.startsWith('vdbs/')) {
        return `/${tid}/${clean}`;
    }
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
        this._worldsPollHooked = false;
        this._worldsPollDispose = null;
        this._loading = false;
        /** @type {{ eye: THREE.Vector3, target: THREE.Vector3, until: number } | null} */
        this._cameraLock = null;
        this._halfResRt = null;
        this._halfResScene = null;
        this._halfResCam = null;
        this._composerHooked = false;
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
                const url = resolveVdbVolumeFileUrl(this.tenantId, cfg.file);
                const grids = await loader.setGridNames([gridName]).loadAsync(url);
                const grid = grids[0];
                if (!grid) {
                    console.warn('[addon:vdb-volume] grid not found', gridName, url);
                    continue;
                }
                const renderOpts = resolveRaymarchRenderOpts(cfg, this.pluginConfig);
                const mesh = createVdbRaymarchMesh(grid, renderOpts);
                mesh.userData.vdbVolumeId = cfg.id || gridName;
                const anchor = mountMeshWithWorldOffset(this.root, mesh, cfg);
                anchor.updateMatrixWorld(true);
                mesh.updateMatrixWorld(true);
                updateSunDirectionUniform(mesh, renderOpts.sunWorld, mesh.material);
                mesh.frustumCulled = false;
                const worldBox = getVdbMeshWorldBox(mesh);
                const sphere = worldBox.getBoundingSphere(new THREE.Sphere());
                mesh.userData.vdbWorldSphere = {
                    center: sphere.center.toArray(),
                    radius: sphere.radius,
                };
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
        this._worldsPollDispose?.();
        this._worldsPollDispose = null;
        this.disposeMeshes();
        this.root.removeFromParent();
        this.scene = null;
        this._halfResRt?.dispose?.();
        this._halfResRt = null;
    }

    hasEntries() {
        return this.entries.length > 0;
    }

    /**
     * @param {string} [id]
     */
    getEntryWorldBox(id = 'cloud-demo') {
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
     * CharacterController のピッチ制限を迂回し雲を直視するカメラ拘束
     * @param {{ eye: THREE.Vector3, target: THREE.Vector3, ms?: number }} opts
     */
    setCameraLock(opts) {
        const until = performance.now() + (opts.ms ?? 12_000);
        this._cameraLock = {
            eye: opts.eye.clone(),
            target: opts.target.clone(),
            until,
        };
    }

    clearCameraLock() {
        this._cameraLock = null;
    }

    /**
     * フレーム更新用: カメラロックと距離別ステップ
     */
    applyPerFrameTuning() {
        this.applyCameraLock();
        const cam = this.app?.sceneManager?.getCamera?.();
        if (!cam || !this.entries.length) return;

        const camPos = cam.position;
        for (const { mesh } of this.entries) {
            const center = mesh.userData.vdbWorldSphere?.center;
            const radius = mesh.userData.vdbWorldSphere?.radius ?? 8;
            if (!center) continue;
            const dist = camPos.distanceTo(new THREE.Vector3().fromArray(center));
            applyPerformanceUniforms(mesh.material, dist, radius);
        }
    }

    applyCameraLock() {
        if (!this._cameraLock || performance.now() > this._cameraLock.until) {
            this._cameraLock = null;
            return;
        }
        const cam = this.app?.sceneManager?.getCamera?.();
        if (!cam) return;
        cam.position.copy(this._cameraLock.eye);
        cam.lookAt(this._cameraLock.target);
        cam.updateMatrixWorld();
    }

    /**
     * 雲の bbox が画面内か（簡易）
     */
    isCloudOnScreen(id = 'cloud-demo') {
        const box = this.getEntryWorldBox(id);
        const cam = this.app?.sceneManager?.getCamera?.();
        if (!box || !cam) return false;
        const corners = [
            new THREE.Vector3().fromArray(box.min),
            new THREE.Vector3().fromArray(box.max),
        ];
        const ndcMin = new THREE.Vector3(Infinity, Infinity, 1);
        const ndcMax = new THREE.Vector3(-Infinity, -Infinity, -1);
        for (const ox of [0, 1]) {
            for (const oy of [0, 1]) {
                for (const oz of [0, 1]) {
                    const p = new THREE.Vector3(
                        ox ? corners[1].x : corners[0].x,
                        oy ? corners[1].y : corners[0].y,
                        oz ? corners[1].z : corners[0].z,
                    );
                    p.project(cam);
                    ndcMin.min(p);
                    ndcMax.max(p);
                }
            }
        }
        return ndcMax.x > -1.05 && ndcMin.x < 1.05 && ndcMax.y > -1.05 && ndcMin.y < 1.05 && ndcMax.z < 1;
    }

    /**
     * スクリーンショット用: カメラを雲ボリュームの中心へ（三人称の pitch 制限を回避）
     * @param {string} [id]
     */
    frameVolumeForView(id = 'cloud-demo', view = 'front') {
        const box = this.getEntryWorldBox(id);
        if (!box || !this.app) return null;
        const center = new THREE.Vector3().fromArray(box.center);
        const sx = Math.max(...box.size, 4);
        const offsets = {
            front: new THREE.Vector3(sx * 0.15, sx * 0.08, sx * 1.35),
            oblique: new THREE.Vector3(sx * 1.05, sx * 0.45, sx * 0.55),
            backlit: new THREE.Vector3(sx * -0.95, sx * 0.2, sx * -1.2),
        };
        const eye = center.clone().add(offsets[view] ?? offsets.front);

        const cc = this.app.characterController;
        if (cc?.setFlyMode) cc.setFlyMode(true);
        if (cc?.setViewMode) cc.setViewMode('first');
        if (cc?.setSuspendPhysicsUntilGameplayInput) cc.setSuspendPhysicsUntilGameplayInput(true);

        this.setCameraLock({ eye, target: center, ms: 30_000 });

        const cam = this.app.sceneManager?.getCamera?.();
        if (cam) {
            cam.position.copy(eye);
            cam.lookAt(center);
            cam.updateMatrixWorld();
        }
        const localRoot = this.app?.playerManager?.localPlayer?.model
            || this.app?.playerManager?.localPlayer?.object;
        if (localRoot) {
            localRoot.visible = false;
            this._hideLocalPlayerForShot = () => {
                localRoot.visible = true;
            };
        }

        return {
            eye: eye.toArray(),
            target: center.toArray(),
            box,
            view,
        };
    }

    /**
     * 雲領域のピクセルが白っぽいかをグリッドサンプル（0〜1）
     * @param {string} [id]
     */
    sampleCloudRegion(id = 'cloud-demo') {
        const renderer = this.app?.sceneManager?.getRenderer?.();
        const cam = this.app?.sceneManager?.getCamera?.();
        const box = this.getEntryWorldBox(id);
        if (!renderer || !cam || !box) return null;

        const canvas = renderer.domElement;
        const gl = renderer.getContext();
        const w = canvas.width;
        const h = canvas.height;
        if (!w || !h) return null;

        const worldMin = new THREE.Vector3().fromArray(box.min);
        const worldMax = new THREE.Vector3().fromArray(box.max);
        let pxMinX = w;
        let pxMinY = h;
        let pxMaxX = 0;
        let pxMaxY = 0;
        let anyInFront = false;

        for (const ox of [0, 1]) {
            for (const oy of [0, 1]) {
                for (const oz of [0, 1]) {
                    const p = new THREE.Vector3(
                        ox ? worldMax.x : worldMin.x,
                        oy ? worldMax.y : worldMin.y,
                        oz ? worldMax.z : worldMin.z,
                    );
                    p.project(cam);
                    if (p.z < 1) anyInFront = true;
                    const sx = Math.round(((p.x + 1) * 0.5) * (w - 1));
                    const sy = Math.round(((1 - p.y) * 0.5) * (h - 1));
                    pxMinX = Math.min(pxMinX, sx);
                    pxMinY = Math.min(pxMinY, sy);
                    pxMaxX = Math.max(pxMaxX, sx);
                    pxMaxY = Math.max(pxMaxY, sy);
                }
            }
        }
        if (!anyInFront) {
            return { cloudPixelRatio: 0, brightRatio: 0, samples: 0, rect: null };
        }

        const pad = 4;
        pxMinX = Math.max(0, pxMinX - pad);
        pxMinY = Math.max(0, pxMinY - pad);
        pxMaxX = Math.min(w - 1, pxMaxX + pad);
        pxMaxY = Math.min(h - 1, pxMaxY + pad);

        const grid = 7;
        let bright = 0;
        let total = 0;
        const buf = new Uint8Array(4);
        for (let gy = 0; gy < grid; gy++) {
            for (let gx = 0; gx < grid; gx++) {
                const sx = Math.round(pxMinX + ((pxMaxX - pxMinX) * gx) / Math.max(grid - 1, 1));
                const sy = Math.round(pxMinY + ((pxMaxY - pxMinY) * gy) / Math.max(grid - 1, 1));
                gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
                const lum = buf[0] + buf[1] + buf[2];
                const whiteish = buf[0] > 175 && buf[1] > 175 && buf[2] > 185 && lum > 520;
                if (whiteish) bright += 1;
                total += 1;
            }
        }

        return {
            cloudPixelRatio: bright / total,
            brightRatio: bright / total,
            samples: total,
            rect: [pxMinX, pxMinY, pxMaxX, pxMaxY],
        };
    }

    /**
     * @param {number} [ms]
     * @param {{ volumesVisible?: boolean }} [opts]
     */
    async measureFps(ms = 1500, opts = {}) {
        const volumesVisible = opts.volumesVisible !== false;
        for (const { mesh } of this.entries) {
            mesh.visible = volumesVisible;
        }
        const renderer = this.app?.sceneManager?.getRenderer?.();
        const scene = this.app?.sceneManager?.getScene?.();
        const camera = this.app?.sceneManager?.getCamera?.();
        const t0 = performance.now();
        let frames = 0;
        await new Promise((resolve) => {
            const tick = () => {
                this.applyCameraLock();
                if (renderer && scene && camera) {
                    renderer.render(scene, camera);
                }
                frames += 1;
                if (performance.now() - t0 >= ms) {
                    resolve(undefined);
                    return;
                }
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
        for (const { mesh } of this.entries) {
            mesh.visible = true;
        }
        const elapsed = Math.max(performance.now() - t0, 1);
        return (frames * 1000) / elapsed;
    }

    /**
     * @param {number} [ms]
     */
    async measureFpsWithAndWithoutVolume(ms = 1200) {
        const withVolume = await this.measureFps(ms, { volumesVisible: true });
        const withoutVolume = await this.measureFps(ms, { volumesVisible: false });
        const result = { withVolume, withoutVolume, measuredMs: ms };
        globalThis.__tenantVdbVolume = { ...(globalThis.__tenantVdbVolume || {}), lastFps: result };
        return result;
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
                min: box.min.toArray(),
                max: box.max.toArray(),
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
        this.hookWorldsJsonPolling();
    }

    hookWorldsJsonPolling() {
        if (this._worldsPollHooked) return;
        this._worldsPollHooked = true;
        const wm = this.app?.worldManager;
        const tid = this.tenantId || tenantIdFromPath();
        const pollMs = 8000;
        let lastKey = '';
        const tick = async () => {
            const worldId = wm?.getCurrentWorldId?.() || this.app?.currentWorldId;
            if (!worldId || !tid) return;
            try {
                const res = await fetch(`/${encodeURIComponent(tid)}/api/worlds`, {
                    credentials: 'same-origin',
                });
                if (!res.ok) return;
                const data = await res.json();
                const world = data?.[worldId] || data?.worlds?.[worldId];
                if (!world) return;
                const vdbs = Array.isArray(world.vdbs) ? world.vdbs : [];
                const key = JSON.stringify(vdbs);
                if (key !== lastKey) {
                    lastKey = key;
                    if (wm?.worlds && typeof wm.worlds === 'object') {
                        wm.worlds[worldId] = { ...wm.worlds[worldId], ...world, vdbs };
                    }
                    void this.loadForWorld({ ...world, vdbs });
                }
            } catch {
                /* ignore transient network errors */
            }
        };
        const intervalId = setInterval(tick, pollMs);
        globalThis.addEventListener('visibilitychange', () => {
            if (globalThis.document?.visibilityState === 'visible') {
                void tick();
            }
        });
        this._worldsPollDispose = () => clearInterval(intervalId);
        void tick();
    }
}