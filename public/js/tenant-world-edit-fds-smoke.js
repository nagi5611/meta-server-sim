// public/js/tenant-world-edit-fds-smoke.js — ワールド編集 3D プレビューで FDS 煙の最終フレームを表示
import * as THREE from 'three';
import {
    applyFdsSmokePartToAtlas,
    applyVolumePlacementToRenderer,
    computeFdsVolumePlacement,
    createFdsSmokeVolume,
    loadFdsSmokeManifestOnly,
} from './fds/fds-volume-loader.js';
import { FdsSmokeDepthPass } from './fds/fds-smoke-depth-pass.js';

/** パネル再生中は静止プレビューを隠す（煙 ID） */
const previewSuppressedSmokeIds = new Set();

/**
 * 静止プレビューの表示抑制（パネル再生と二重表示を防ぐ）
 * @param {string | null} smokeId — null で全解除
 * @param {boolean} suppress
 */
export function setWorldEditFdsSmokePreviewSuppressed(smokeId, suppress) {
    if (smokeId == null) {
        previewSuppressedSmokeIds.clear();
        return;
    }
    if (suppress) {
        previewSuppressedSmokeIds.add(smokeId);
    } else {
        previewSuppressedSmokeIds.delete(smokeId);
    }
}

/**
 * 再生が止まった煙は静止プレビューに戻す
 * @param {import('./tenant-fds-smoke-manager.js').TenantFdsSmokeManager} smokeManager
 */
export function syncWorldEditFdsSmokePreviewSuppression(smokeManager) {
    for (const smokeId of [...previewSuppressedSmokeIds]) {
        if (!smokeManager.isSmokePlaying(smokeId)) {
            previewSuppressedSmokeIds.delete(smokeId);
        }
    }
}

/**
 * ワールド編集プレビュー用 FDS 煙（静止：最終フレームまたは playback 設定の初期フレーム）
 */
export class TenantWorldEditFdsSmokePreview {
    constructor() {
        /** @type {Map<THREE.Object3D, { renderer?: import('./fds/VolumeRenderer.js').default, multipart?: import('./fds/fds-volume-loader.js').FdsMultipartSmokeController | null, manifest?: object, loading?: boolean, loadId?: number }>} */
        this._entries = new Map();
        this._depthPass = new FdsSmokeDepthPass();
        this._depthSize = new THREE.Vector2();
        this._loadSeq = 0;
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
     * フック解除と GPU リソース解放
     */
    dispose() {
        this._loadSeq++;
        for (const entry of this._entries.values()) {
            this._disposeEntry(entry);
        }
        this._entries.clear();
        this._depthPass.dispose();
    }

    /**
     * @param {{ scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, editGroup: THREE.Group }} ctx
     */
    _onFrame(ctx) {
        const { scene, camera, renderer, editGroup } = ctx;
        if (!editGroup || !scene) return;

        this._syncGroups(editGroup, scene);
        this._syncTransforms();

        if (this._entries.size === 0) return;

        renderer.getDrawingBufferSize(this._depthSize);
        this._depthPass.setSize(this._depthSize.x, this._depthSize.y);

        const volumeMeshes = [];
        for (const [group, entry] of this._entries) {
            const smokeId = group.userData?.fdsSmokeConfig?.id;
            const hidden =
                entry.renderer &&
                smokeId &&
                previewSuppressedSmokeIds.has(String(smokeId));
            if (entry.renderer) {
                entry.renderer.visible = !hidden;
                if (!hidden) volumeMeshes.push(entry.renderer);
            }
        }
        if (volumeMeshes.length === 0) return;

        this._depthPass.render(renderer, scene, camera, volumeMeshes);
        const depthTexture = this._depthPass.getDepthTexture();
        for (const entry of this._entries.values()) {
            if (entry.renderer) {
                entry.renderer.uniforms.depthTexture.value = depthTexture;
            }
        }
    }

    /**
     * editGroup 内の FDS 煙グループと VolumeRenderer を同期する
     * @param {THREE.Group} editGroup
     * @param {THREE.Scene} scene
     */
    _syncGroups(editGroup, scene) {
        const active = new Set();
        for (const child of editGroup.children) {
            if (!child.userData?.fdsSmokeConfig) continue;
            active.add(child);
            if (!this._entries.has(child)) {
                const loadId = ++this._loadSeq;
                this._entries.set(child, { loading: true, loadId });
                void this._loadVolume(child, scene, loadId);
            }
        }

        for (const [group, entry] of this._entries) {
            if (!active.has(group)) {
                this._disposeEntry(entry);
                this._entries.delete(group);
            }
        }
    }

    /**
     * ギズモ移動に合わせて volumeOrigin / voxelSize を更新する
     */
    _syncTransforms() {
        for (const [group, entry] of this._entries) {
            if (!entry.renderer || !entry.manifest) continue;
            const cfg = group.userData.fdsSmokeConfig;
            const scale =
                typeof cfg.scale === 'number' && cfg.scale > 0 ? cfg.scale : group.scale.x || 1;
            const placement = computeFdsVolumePlacement(entry.manifest, {
                position: { x: group.position.x, y: group.position.y, z: group.position.z },
                rotation: {
                    x: (group.rotation.x * 180) / Math.PI,
                    y: (group.rotation.y * 180) / Math.PI,
                    z: (group.rotation.z * 180) / Math.PI,
                },
                scale,
                mirror: cfg.mirror,
            });
            applyVolumePlacementToRenderer(entry.renderer, placement);
        }
    }

    /**
     * FDS 煙ボリュームを読み込み最終フレームを表示する
     * @param {THREE.Object3D} group
     * @param {THREE.Scene} scene
     * @param {number} loadId
     */
    async _loadVolume(group, scene, loadId) {
        const cfg = group.userData.fdsSmokeConfig;
        const manifestPath = String(cfg?.manifest || '').trim();
        if (!manifestPath) {
            this._entries.delete(group);
            return;
        }

        try {
            const manifest = await loadFdsSmokeManifestOnly(manifestPath);
            const current = this._entries.get(group);
            if (!current || current.loadId !== loadId) return;

            const lastFrame = Math.max(0, manifest.frameCount - 1);
            const pb = cfg.playback || {};
            const startAtEnd = pb.startAtEnd !== false;
            const initialFrame =
                typeof pb.initialFrame === 'number'
                    ? Math.max(0, Math.min(pb.initialFrame, lastFrame))
                    : startAtEnd
                      ? lastFrame
                      : 0;

            const scale =
                typeof cfg.scale === 'number' && cfg.scale > 0 ? cfg.scale : group.scale.x || 1;
            const transform = {
                position: { x: group.position.x, y: group.position.y, z: group.position.z },
                rotation: cfg.rotation ?? {
                    x: (group.rotation.x * 180) / Math.PI,
                    y: (group.rotation.y * 180) / Math.PI,
                    z: (group.rotation.z * 180) / Math.PI,
                },
                scale,
                mirror: cfg.mirror,
            };

            const { volumeRenderer, multipart } = await createFdsSmokeVolume(
                manifestPath,
                transform,
                cfg.render ?? {},
                { initialFrame },
            );

            if (!this._entries.get(group) || this._entries.get(group).loadId !== loadId) {
                this._disposeRenderer(volumeRenderer);
                return;
            }

            scene.add(volumeRenderer);
            this._applyFrame(volumeRenderer, multipart, initialFrame);

            const proxy = group.userData.fdsSmokeProxy;
            if (proxy?.mesh) proxy.mesh.visible = false;

            this._entries.set(group, {
                renderer: volumeRenderer,
                multipart,
                manifest,
                loadId,
            });
        } catch (err) {
            console.warn('[TenantWorldEditFdsSmokePreview] load failed:', manifestPath, err);
            if (this._entries.get(group)?.loadId === loadId) {
                this._entries.delete(group);
            }
        }
    }

    /**
     * @param {import('./fds/VolumeRenderer.js').default} renderer
     * @param {import('./fds/fds-volume-loader.js').FdsMultipartSmokeController | null} multipart
     * @param {number} frameIndex
     */
    _applyFrame(renderer, multipart, frameIndex) {
        if (multipart) {
            const part = multipart._findPartForFrame(frameIndex);
            if (part && multipart.isPartLoaded(part.id)) {
                if (multipart._activePartId !== part.id) {
                    const data = multipart._partDataCache.get(part.id);
                    if (data) {
                        applyFdsSmokePartToAtlas(renderer, multipart.manifest, part, data);
                        multipart._activePartId = part.id;
                    }
                }
                renderer.uniforms.time.value = multipart.toRendererTime(frameIndex);
            }
        } else {
            renderer.uniforms.time.value = frameIndex;
        }
        renderer.uniforms.random.value = Math.random();
    }

    /**
     * @param {{ renderer?: import('./fds/VolumeRenderer.js').default, multipart?: import('./fds/fds-volume-loader.js').FdsMultipartSmokeController | null }} entry
     */
    _disposeEntry(entry) {
        entry.multipart?.dispose();
        if (entry.renderer) {
            this._disposeRenderer(entry.renderer);
        }
    }

    /**
     * @param {import('./fds/VolumeRenderer.js').default} renderer
     */
    _disposeRenderer(renderer) {
        renderer.parent?.remove(renderer);
        renderer.uniforms?.volumeAtlas?.value?.dispose?.();
        renderer.material?.dispose?.();
        renderer.geometry?.dispose?.();
    }
}

/** @type {TenantWorldEditFdsSmokePreview | null} */
let previewInstance = null;

/**
 * ワールド編集 FDS 煙プレビューを有効化する
 * @returns {Promise<void>}
 */
export async function initTenantWorldEditFdsSmokePreview() {
    if (previewInstance) return;
    previewInstance = new TenantWorldEditFdsSmokePreview();
    await previewInstance.install();
}
