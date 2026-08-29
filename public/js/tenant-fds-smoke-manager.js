// public/js/tenant-fds-smoke-manager.js — ワールドごとの FDS 煙ボリューム管理

import { createFdsSmokeVolume, loadFdsSmokeManifestOnly } from './fds/fds-volume-loader.js';

/**
 * テナントメタバース内の FDS 煙ボリュームをロード・更新・破棄する
 */
export class TenantFdsSmokeManager {
    /**
     * @param {THREE.Scene} scene
     */
    constructor(scene) {
        this.scene = scene;
        /** @type {Array<{ id: string, renderer: import('./fds/VolumeRenderer.js').default, multipart: import('./fds/fds-volume-loader.js').FdsMultipartSmokeController | null, playback: object }>} */
        this._entries = [];
        this._loadToken = 0;
    }

    /**
     * ワールド定義から fdsSmokes を読み込む
     * @param {object | null | undefined} world
     */
    async loadForWorld(world) {
        this.dispose();
        const configs = Array.isArray(world?.fdsSmokes) ? world.fdsSmokes : [];
        if (configs.length === 0) {
            return;
        }

        const token = ++this._loadToken;

        for (const config of configs) {
            if (!config?.manifest) {
                console.warn('[TenantFdsSmokeManager] fdsSmoke entry missing manifest:', config);
                continue;
            }

            try {
                const manifest = await loadFdsSmokeManifestOnly(config.manifest);
                const lastFrame = Math.max(0, manifest.frameCount - 1);
                const startAtEnd = config.playback?.startAtEnd !== false;
                const initialFrame = config.playback?.initialFrame ?? (startAtEnd ? lastFrame : 0);

                const { volumeRenderer, multipart } = await createFdsSmokeVolume(
                    config.manifest,
                    {
                        position: config.position,
                        scale: config.scale,
                    },
                    config.render ?? {},
                    { initialFrame },
                );
                if (token !== this._loadToken) {
                    multipart?.dispose();
                    this._disposeRenderer(volumeRenderer);
                    return;
                }

                this.scene.add(volumeRenderer);

                const playback = {
                    autoplay: startAtEnd
                        ? (config.playback?.autoplay === true)
                        : (config.playback?.autoplay !== false),
                    speed: config.playback?.speed ?? 1,
                    loop: config.playback?.loop !== false,
                    time: initialFrame,
                    frameCount: manifest.frameCount,
                    times: manifest.times ?? [],
                };

                volumeRenderer.uniforms.time.value = initialFrame;
                multipart?.tick(initialFrame);

                this._entries.push({
                    id: config.id ?? config.manifest,
                    renderer: volumeRenderer,
                    multipart,
                    playback,
                });
            } catch (error) {
                console.warn(`[TenantFdsSmokeManager] failed to load ${config.manifest}:`, error);
            }
        }
    }

    /**
     * フレーム更新（煙アニメーション）
     * @param {number} deltaTime
     */
    update(deltaTime) {
        for (const entry of this._entries) {
            const { renderer, multipart, playback } = entry;
            if (!playback.autoplay || playback.speed <= 0) {
                continue;
            }

            playback.time += deltaTime * playback.speed;
            if (playback.loop && playback.frameCount > 0) {
                playback.time %= playback.frameCount;
            } else if (playback.time >= playback.frameCount) {
                playback.time = playback.frameCount - 1;
            }

            multipart?.tick(playback.time);

            renderer.uniforms.time.value = playback.time;
            renderer.uniforms.random.value = Math.random();
        }
    }

    /**
     * 全煙ボリュームをシーンから除去する
     */
    dispose() {
        this._loadToken++;
        for (const entry of this._entries) {
            entry.multipart?.dispose();
            this._disposeRenderer(entry.renderer);
        }
        this._entries = [];
    }

    /**
     * VolumeRenderer の GPU リソースを解放する
     * @param {import('./fds/VolumeRenderer.js').default} renderer
     */
    _disposeRenderer(renderer) {
        if (!renderer) return;
        this.scene.remove(renderer);
        renderer.uniforms?.volumeAtlas?.value?.dispose?.();
        renderer.material?.dispose?.();
        renderer.geometry?.dispose?.();
    }
}
