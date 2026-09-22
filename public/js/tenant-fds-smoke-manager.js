// public/js/tenant-fds-smoke-manager.js — ワールドごとの FDS 煙ボリューム管理

import {
    applyFdsSmokePartToAtlas,
    computeFdsVolumePlacement,
    createFdsSmokeVolume,
    loadFdsSmokeManifestOnly,
} from './fds/fds-volume-loader.js';
import {
    SMOKE_INSIDE_NORMALIZED_THRESHOLD,
    sampleNormalizedSootAtWorld as sampleSootInVolumeData,
} from './fds/fds-volume-sampler.js';
import { FdsSmokeDepthPass } from './fds/fds-smoke-depth-pass.js';
import * as THREE from 'three';

/** 同時にロードする FDS 煙ボリューム数（ワールド本体ロード後に実行） */
const FDS_SMOKE_LOAD_CONCURRENCY = 2;

/**
 * @param {number} concurrency
 * @param {Array<() => Promise<void>>} factories
 * @returns {Promise<void>}
 */
async function runWithConcurrency(concurrency, factories) {
    const n = factories.length;
    let cursor = 0;
    async function worker() {
        while (true) {
            const i = cursor++;
            if (i >= n) break;
            await factories[i]();
        }
    }
    const workers = Math.min(Math.max(1, concurrency), Math.max(1, n));
    await Promise.all(Array.from({ length: workers }, () => worker()));
}

/**
 * テナントメタバース内の FDS 煙ボリュームをロード・更新・破棄する
 */
export class TenantFdsSmokeManager {
    /**
     * @param {THREE.Scene} scene
     */
    constructor(scene) {
        this.scene = scene;
        /** @type {Array<{ id: string, renderer: import('./fds/VolumeRenderer.js').default, multipart: import('./fds/fds-volume-loader.js').FdsMultipartSmokeController | null, playback: object, manifest: import('./fds/fds-volume-loader.js').FdsSmokeManifest, placement: object, volumeData: Uint8Array | null }>} */
        this._entries = [];
        this._loadToken = 0;
        /** 再生ログ用（entry.id → 直前状態） */
        this._playbackLogState = new Map();
        this._depthPass = new FdsSmokeDepthPass();
        this._depthSize = new THREE.Vector2();
    }

    /**
     * 煙ボリュームが1つ以上ロード済みか
     * @returns {boolean}
     */
    hasEntries() {
        return this._entries.length > 0;
    }

    /**
     * 曝露量の物理量換算用 valueMax（先頭エントリ）
     * @returns {number}
     */
    getPrimaryManifestValueMax() {
        const max = Number(this._entries[0]?.manifest?.valueMax);
        return Number.isFinite(max) && max > 0 ? max : 1;
    }

    /**
     * 頭位置などワールド座標での正規化 soot 密度（複数煙は最大値）
     * @param {THREE.Vector3} worldPos
     * @returns {{ normalized: number, inSmoke: boolean, perVolume: Array<{ id: string, normalized: number | null }> }}
     */
    sampleNormalizedSootAtWorld(worldPos) {
        const perVolume = [];
        let normalized = 0;
        for (const entry of this._entries) {
            const frameIndex = entry.playback?.frameIndex ?? 0;
            let volumeSlice = null;
            let localFrame = frameIndex;
            if (entry.multipart) {
                const cached = entry.multipart.getCachedVolumeDataForFrame(frameIndex);
                if (cached) {
                    volumeSlice = cached.data;
                    localFrame = cached.localFrameIndex;
                }
            } else if (entry.volumeData) {
                volumeSlice = entry.volumeData;
            }
            let value = null;
            if (volumeSlice) {
                value = sampleSootInVolumeData(
                    entry.manifest,
                    entry.placement,
                    volumeSlice,
                    localFrame,
                    worldPos,
                );
            }
            perVolume.push({ id: entry.id, normalized: value });
            if (value != null && value > normalized) {
                normalized = value;
            }
        }
        return {
            normalized,
            inSmoke: normalized >= SMOKE_INSIDE_NORMALIZED_THRESHOLD,
            perVolume,
        };
    }

    /**
     * 描画直前にシーン深度を VolumeRenderer に渡す（手前のオブジェクトで煙をマスク）
     * @param {THREE.WebGLRenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     */
    prepareRender(renderer, scene, camera) {
        if (!this._entries.length || !renderer || !scene || !camera) {
            return;
        }

        renderer.getDrawingBufferSize(this._depthSize);
        this._depthPass.setSize(this._depthSize.x, this._depthSize.y);

        const volumeMeshes = this._entries.map((e) => e.renderer);
        this._depthPass.render(renderer, scene, camera, volumeMeshes);

        const depthTexture = this._depthPass.getDepthTexture();
        for (const entry of this._entries) {
            entry.renderer.uniforms.depthTexture.value = depthTexture;
        }
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

        const factories = configs.map((config) => async () => {
            if (!config?.manifest) {
                console.warn('[TenantFdsSmokeManager] fdsSmoke entry missing manifest:', config);
                return;
            }

            try {
                const manifest = await loadFdsSmokeManifestOnly(config.manifest);
                const lastFrame = Math.max(0, manifest.frameCount - 1);
                const startAtEnd = config.playback?.startAtEnd !== false;
                const initialFrame = config.playback?.initialFrame ?? (startAtEnd ? lastFrame : 0);
                const framesPerSecond = this._normalizeFramesPerSecond(
                    config.playback?.framesPerSecond ?? config.playback?.speed ?? 1,
                );
                const secondsPerFrame = Number(config.playback?.secondsPerFrame);

                const transform = {
                    position: config.position,
                    rotation: config.rotation,
                    scale: config.scale,
                    mirror: config.mirror,
                };

                const { volumeRenderer, multipart, volumeData } = await createFdsSmokeVolume(
                    config.manifest,
                    transform,
                    config.render ?? {},
                    { initialFrame },
                );
                const placement = computeFdsVolumePlacement(manifest, transform);
                if (token !== this._loadToken) {
                    multipart?.dispose();
                    this._disposeRenderer(volumeRenderer);
                    return;
                }

                this.scene.add(volumeRenderer);

                const autoplayOnLoad = startAtEnd
                    ? (config.playback?.autoplay === true)
                    : (config.playback?.autoplay !== false);

                const playback = {
                    autoplayOnLoad,
                    playing: autoplayOnLoad,
                    loop: config.playback?.loop !== false,
                    framesPerSecond,
                    secondsPerFrame:
                        Number.isFinite(secondsPerFrame) && secondsPerFrame > 0 ? secondsPerFrame : undefined,
                    frameIndex: initialFrame,
                    frameAccumulator: 0,
                    frameCount: manifest.frameCount,
                    times: manifest.times ?? [],
                };

                this._applyFrame({ renderer: volumeRenderer, multipart }, playback.frameIndex);

                this._entries.push({
                    id: config.id ?? config.manifest,
                    renderer: volumeRenderer,
                    multipart,
                    playback,
                    manifest,
                    placement,
                    volumeData: volumeData ?? null,
                });
            } catch (error) {
                console.warn(`[TenantFdsSmokeManager] failed to load ${config.manifest}:`, error);
            }
        });

        await runWithConcurrency(FDS_SMOKE_LOAD_CONCURRENCY, factories);
    }

    /**
     * 指定 ID の煙再生を開始する（ボタン連携用）
     * @param {string} smokeId
     * @param {{ fromFrame?: number, loop?: boolean, framesPerSecond?: number, secondsPerFrame?: number }} [options]
     * @returns {Promise<boolean>}
     */
    async startPlayback(smokeId, options = {}) {
        const entry = this._entries.find((e) => e.id === smokeId);
        if (!entry) {
            console.warn('[TenantFdsSmokeManager] startPlayback: smoke not found:', smokeId);
            return false;
        }

        const pb = entry.playback;
        const fromFrame = options.fromFrame ?? 0;
        pb.frameIndex = Math.max(0, Math.min(fromFrame, pb.frameCount - 1));
        pb.frameAccumulator = 0;
        pb.playing = true;
        if (options.loop !== undefined) {
            pb.loop = options.loop;
        }
        if (options.framesPerSecond !== undefined) {
            pb.framesPerSecond = this._normalizeFramesPerSecond(options.framesPerSecond);
        }
        if (options.secondsPerFrame !== undefined) {
            const sec = Number(options.secondsPerFrame);
            if (Number.isFinite(sec) && sec > 0) {
                pb.secondsPerFrame = sec;
            }
        }

        if (entry.multipart) {
            await entry.multipart.ensurePartForFrame(pb.frameIndex);
        }

        this._applyFrame(entry, pb.frameIndex);
        this._logPlaybackFrame(entry, pb.frameIndex, 'start');
        return true;
    }

    /**
     * 指定 ID の煙再生を停止する
     * @param {string} smokeId
     * @returns {boolean}
     */
    stopPlayback(smokeId) {
        const entry = this._entries.find((e) => e.id === smokeId);
        if (!entry) return false;
        entry.playback.playing = false;
        entry.playback.frameAccumulator = 0;
        return true;
    }

    /**
     * 指定 ID の煙が再生中か
     * @param {string} smokeId
     * @returns {boolean}
     */
    isSmokePlaying(smokeId) {
        const entry = this._entries.find((e) => e.id === smokeId);
        return Boolean(entry?.playback?.playing);
    }

    /**
     * フレーム更新（1秒ごとに次フレームへステップ）
     * @param {number} deltaTime
     */
    update(deltaTime) {
        for (const entry of this._entries) {
            const pb = entry.playback;
            if (!pb.playing || pb.framesPerSecond <= 0 || pb.frameCount <= 0) {
                continue;
            }

            pb.frameAccumulator += deltaTime;
            const interval = pb.secondsPerFrame ?? (1 / (pb.framesPerSecond || 1));

            while (pb.frameAccumulator >= interval && pb.playing) {
                pb.frameAccumulator -= interval;
                const next = pb.frameIndex + 1;

                if (next >= pb.frameCount) {
                    if (pb.loop) {
                        if (!this._canShowFrame(entry, 0)) {
                            void entry.multipart?.ensurePartForFrame(0);
                            this._logPlaybackFrame(entry, pb.frameIndex, 'waiting-part', { targetFrame: 0 });
                            break;
                        }
                        pb.frameIndex = 0;
                    } else {
                        pb.frameIndex = pb.frameCount - 1;
                        pb.playing = false;
                        break;
                    }
                } else {
                    if (!this._canShowFrame(entry, next)) {
                        void entry.multipart?.ensurePartForFrame(next);
                        this._logPlaybackFrame(entry, pb.frameIndex, 'waiting-part', { targetFrame: next });
                        break;
                    }
                    pb.frameIndex = next;
                }
            }

            this._applyFrame(entry, pb.frameIndex);
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
        this._playbackLogState.clear();
        this._depthPass.dispose();
    }

    /**
     * 指定フレームのパートが表示可能か（バイナリキャッシュ済み）
     * @param {{ multipart: import('./fds/fds-volume-loader.js').FdsMultipartSmokeController | null }} entry
     * @param {number} frameIndex
     * @returns {boolean}
     */
    _canShowFrame(entry, frameIndex) {
        if (!entry.multipart) return true;
        const part = entry.multipart._findPartForFrame(frameIndex);
        return part ? entry.multipart.isPartLoaded(part.id) : false;
    }

    /**
     * @param {{ renderer: import('./fds/VolumeRenderer.js').default, multipart: import('./fds/fds-volume-loader.js').FdsMultipartSmokeController | null, id?: string, playback?: object }} entry
     * @param {number} frameIndex
     */
    _applyFrame(entry, frameIndex) {
        const { renderer, multipart } = entry;

        if (multipart) {
            const part = multipart._findPartForFrame(frameIndex);
            // 現在フレームのパートだけアトラスに載せる（次パートのプリフェッチ上書きを防ぐ）
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
            multipart.tick(frameIndex);
        } else {
            renderer.uniforms.time.value = frameIndex;
        }
        // 元リポ App.js と同様、毎フレーム random を更新してエッジの fuzz を維持
        renderer.uniforms.random.value = Math.random();

        if (entry.playback?.playing) {
            this._logPlaybackFrame(entry, frameIndex, 'apply');
        }
    }

    /**
     * 再生中のフレーム状態をコンソールに出力（ロールバック調査用）
     * @param {{ id: string, renderer: import('./fds/VolumeRenderer.js').default, multipart: import('./fds/fds-volume-loader.js').FdsMultipartSmokeController | null, playback: object }} entry
     * @param {number} frameIndex
     * @param {string} [reason]
     * @param {{ targetFrame?: number }} [extra]
     */
    _logPlaybackFrame(entry, frameIndex, reason = 'tick', extra = {}) {
        const pb = entry.playback;
        if (!pb?.playing) return;

        const rendererTime = entry.renderer.uniforms.time.value;
        const multipart = entry.multipart;
        let partId = null;
        let partLoaded = false;
        let partFrameStart = null;
        if (multipart) {
            const part = multipart._findPartForFrame(frameIndex);
            if (part) {
                partId = part.id;
                partLoaded = multipart.isPartLoaded(part.id);
                partFrameStart = part.frameStart;
            }
        }

        const prev = this._playbackLogState.get(entry.id);
        const now = performance.now();
        const frameChanged = !prev || prev.frameIndex !== frameIndex;
        const rendererTimeChanged = !prev || prev.rendererTime !== rendererTime;
        const heartbeat = !prev || now - prev.logMs >= 1000;
        const rollback = prev && frameIndex < prev.frameIndex && frameIndex !== 0;
        const activePartId = multipart?._activePartId ?? null;

        if (rollback) {
            console.warn(
                `[TenantFdsSmokeManager] playback ROLLBACK ${entry.id}: frame ${prev.frameIndex} → ${frameIndex}`,
                { rendererTime, prevRendererTime: prev.rendererTime, partId, activePartId, partLoaded, reason },
            );
        }

        if (frameChanged || rendererTimeChanged || heartbeat || (reason !== 'tick' && reason !== 'apply')) {
            const simTime = pb.times?.[frameIndex];
            const msg = `[TenantFdsSmokeManager] playback ${entry.id} frame=${frameIndex}/${pb.frameCount - 1} rendererTime=${rendererTime.toFixed(3)}${simTime != null ? ` simT=${simTime.toFixed(2)}s` : ''}${partId ? ` part=${partId}@${partFrameStart} cached=${partLoaded} active=${activePartId}` : ''}${extra.targetFrame != null ? ` waiting→${extra.targetFrame}` : ''} [${reason}]`;
            console.log(msg);
            this._playbackLogState.set(entry.id, {
                frameIndex,
                rendererTime,
                logMs: now,
            });
        }
    }

    /**
     * @param {number} value
     * @returns {number}
     */
    _normalizeFramesPerSecond(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return 1;
        return n;
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
