// public/js/fds/fds-volume-loader.js — FDS smoke manifest/binary loader for VolumeRenderer



import * as THREE from 'three';

import VolumeRenderer from './VolumeRenderer.js';
import {
    applyVolumePlacementToRenderer,
    buildFdsVolumeMirrorSign,
    buildFdsVolumeRotationMatrices,
    computeFdsVolumePlacement,
    normalizeFdsVolumeMirror,
} from './fds-volume-placement.js';
import { toTenantUrl } from '../tenant-runtime-shim.js';
import {
    ensureFdsSmokeBulkConfig,
    fetchFdsSmokeBinary,
    withFdsSmokeHttpAuth,
} from './fds-smoke-fetch-client.js';

export {
    applyVolumePlacementToRenderer,
    buildFdsVolumeMirrorSign,
    buildFdsVolumeRotationMatrices,
    computeFdsVolumePlacement,
    normalizeFdsVolumeMirror,
};



const DEFAULT_PALETTE_PATH = '/images/palettes/smoke.png';



/**

 * @typedef {object} FdsSmokePart

 * @property {string} id

 * @property {string} dataFile

 * @property {number} frameStart

 * @property {number} frameCount

 * @property {number} startTime

 * @property {number} endTime

 */



/**

 * @typedef {object} FdsSmokeManifest

 * @property {string} quantity

 * @property {number} frameCount

 * @property {number[]} dims

 * @property {number[]} times

 * @property {number} valueMax

 * @property {{ x: number[], y: number[], z: number[] }} bounds

 * @property {string} [dataFile]

 * @property {boolean} [multipart]

 * @property {number} [chunkIntervalSec]

 * @property {FdsSmokePart[]} [parts]

 */



/**

 * @typedef {object} FdsSmokeTransform

 * @property {{ x?: number, y?: number, z?: number }} position

 * @property {{ x?: number, y?: number, z?: number }} rotation

 * @property {number} [scale]
 * @property {{ x?: boolean, y?: boolean, z?: boolean }} [mirror]
 */

/**

 * @typedef {object} FdsSmokeRenderOptions

 * @property {number} [raySteps]

 * @property {number} [extinctionCoefficient]

 * @property {number} [minCutoff]

 * @property {number} [maxCutoff]
 * @property {number} [cutoffFadeRange]
 * @property {number} [valueAdded]
 * @property {number} [valueMultiplier]
 * @property {number} [alphaMultiplier]
 * @property {number} [paletteMin]
 * @property {number} [paletteMax]
 * @property {boolean} [useRandomStart]
 * @property {boolean} [useExtinctionCoefficient]
 * @property {boolean} [useValueAsExtinctionCoefficient]
 */

/**
 * Donitzo/three.js-volume-renderer App.js 参考値（NIfTI デモは valueAdded 0.3 を維持するが、
 * 当該 NIfTI の値域は 0〜1 に正規化済みでピークが 1 未満の場合が多い）
 * @see https://github.com/Donitzo/three.js-volume-renderer/blob/main/App.js
 */
export const ORIGINAL_VOLUME_RENDER_DEFAULTS = {
    valueAdded: 0.3,
    valueMultiplier: 1.0,
    minCutoff: 1e-3,
    maxCutoff: 1.0 - 1e-3,
    cutoffFadeRange: 0.0,
    extinctionCoefficient: 1.0,
    extinctionMultiplier: 1.0,
    alphaMultiplier: 1.0,
    paletteMin: 0,
    paletteMax: 1,
    raySteps: 64,
    useRandomStart: true,
    useExtinctionCoefficient: true,
    useValueAsExtinctionCoefficient: false,
    useVolumetricDepthTest: true,
};

/**
 * export-fds-smoke.py の uint8（0〜1 正規化）向け既定値。
 * valueAdded 0.3 だと濃い煙が scaledValue > maxCutoff で捨てられ、薄い煙だけ不透明になる。
 */
export const FDS_SMOKE_RENDER_DEFAULTS = {
    ...ORIGINAL_VOLUME_RENDER_DEFAULTS,
    valueAdded: 0,
    useValueAsExtinctionCoefficient: true,
};



/**

 * manifest のみ読み込む

 * @param {string} manifestPath tenant 相対パス

 * @returns {Promise<FdsSmokeManifest>}

 */

export async function loadFdsSmokeManifestOnly(manifestPath) {

    await ensureFdsSmokeBulkConfig();
    const manifestUrl = withFdsSmokeHttpAuth(
        toTenantUrl(`/${manifestPath.replace(/^\/+/, '')}`),
    );

    const manifestResponse = await fetch(manifestUrl, { credentials: 'include' });

    if (!manifestResponse.ok) {

        throw new Error(`Failed to load manifest (${manifestResponse.status}): ${manifestUrl}`);

    }

    return manifestResponse.json();

}



/**

 * manifest 配下の dataDir を取得する

 * @param {string} manifestPath

 * @returns {string}

 */

function getManifestDataDir(manifestPath) {

    return manifestPath.replace(/[^/]+$/, '');

}



/**

 * 単一バイナリを読み込む

 * @param {string} manifestPath

 * @param {FdsSmokeManifest} manifest

 * @returns {Promise<Uint8Array>}

 */

async function loadFdsSmokeBinary(manifestPath, manifest) {

    const dataDir = getManifestDataDir(manifestPath);

    return fetchFdsSmokeBinary(`${dataDir}${manifest.dataFile}`);

}



/**

 * パートバイナリを読み込む

 * @param {string} manifestPath

 * @param {FdsSmokePart} part

 * @returns {Promise<Uint8Array>}

 */

export async function loadFdsSmokePart(manifestPath, part) {

    const dataDir = getManifestDataDir(manifestPath);

    return fetchFdsSmokeBinary(`${dataDir}${part.dataFile}`);

}



/**

 * manifest + binary を読み込む（単一ファイル形式・後方互換）

 * @param {string} manifestPath tenant 相対パス (e.g. simulations/lite/manifest.json)

 * @returns {Promise<{ manifest: FdsSmokeManifest, volumeData: Uint8Array }>}

 */

export async function loadFdsSmokeManifest(manifestPath) {

    const manifest = await loadFdsSmokeManifestOnly(manifestPath);

    if (manifest.multipart && Array.isArray(manifest.parts) && manifest.parts.length > 0) {

        throw new Error(

            'Multipart manifest: use createFdsSmokeVolume() instead of loadFdsSmokeManifest()',

        );

    }

    const volumeData = await loadFdsSmokeBinary(manifestPath, manifest);

    return { manifest, volumeData };

}



/**

 * palette テクスチャを読み込む

 * @param {string} [palettePath]

 * @returns {Promise<THREE.Texture>}

 */

export function loadSmokePalette(palettePath = DEFAULT_PALETTE_PATH) {
    const fallbackUrl = palettePath.startsWith('/') ? palettePath : `/${palettePath}`;
    // 共有パレットは public/ 直下。テナント配下に無い場合が多いので先に試す
    const tenantUrl = toTenantUrl(palettePath);

    return new Promise((resolve) => {
        const loader = new THREE.TextureLoader();
        const finalize = (texture) => {
            if (texture.colorSpace !== undefined) {
                texture.colorSpace = THREE.SRGBColorSpace;
            }
            texture.needsUpdate = true;
            resolve(texture);
        };
        const tryLoad = (urls) => {
            if (urls.length === 0) {
                finalize(createDefaultSmokePalette());
                return;
            }
            const [url, ...rest] = urls;
            loader.load(
                url,
                finalize,
                undefined,
                () => tryLoad(rest),
            );
        };
        const urls = fallbackUrl === tenantUrl
            ? [fallbackUrl]
            : [fallbackUrl, tenantUrl];
        tryLoad(urls);
    });
}



/**

 * パレット画像が無い場合のグレースケールフォールバック

 * @returns {THREE.DataTexture}

 */

function createDefaultSmokePalette() {

    const data = new Uint8Array(256 * 4);

    for (let i = 0; i < 256; i++) {

        data[i * 4] = i;

        data[i * 4 + 1] = i;

        data[i * 4 + 2] = i;

        data[i * 4 + 3] = 255;

    }

    const texture = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);

    texture.needsUpdate = true;

    return texture;

}



/**

 * VolumeRenderer にパレットとマテリアルを適用する

 * @param {VolumeRenderer} volumeRenderer

 * @param {FdsSmokeRenderOptions} [renderOptions]

 */

async function applyFdsVolumeRenderOptions(volumeRenderer, renderOptions = {}) {
    const defaults = FDS_SMOKE_RENDER_DEFAULTS;
    const opts = { ...defaults, ...renderOptions };

    const uniforms = volumeRenderer.uniforms;
    const minCutoff = opts.minCutoff;
    const maxCutoff = opts.maxCutoff;

    uniforms.valueAdded.value = opts.valueAdded;
    uniforms.valueMultiplier.value = opts.valueMultiplier;
    uniforms.minCutoffValue.value = minCutoff;
    uniforms.maxCutoffValue.value = maxCutoff;
    uniforms.cutoffFadeRange.value = opts.cutoffFadeRange;
    uniforms.extinctionCoefficient.value = opts.extinctionCoefficient;
    uniforms.extinctionMultiplier.value = opts.extinctionMultiplier;
    uniforms.alphaMultiplier.value = opts.alphaMultiplier;
    uniforms.minPaletteValue.value = minCutoff + (maxCutoff - minCutoff) * opts.paletteMin;
    uniforms.maxPaletteValue.value = minCutoff + (maxCutoff - minCutoff) * opts.paletteMax;

    try {
        uniforms.palette.value = await loadSmokePalette();
    } catch (e) {
        console.warn('[fds-volume-loader] palette load failed:', e);
        uniforms.palette.value = createDefaultSmokePalette();
    }

    volumeRenderer.updateMaterial({
        useExtinctionCoefficient: opts.useExtinctionCoefficient,
        useValueAsExtinctionCoefficient: opts.useValueAsExtinctionCoefficient,
        useRandomStart: opts.useRandomStart,
        useVolumetricDepthTest: opts.useVolumetricDepthTest,
        raySteps: opts.raySteps,
    });
}



/**

 * パートデータを VolumeRenderer のアトラスに書き込む

 * @param {VolumeRenderer} volumeRenderer

 * @param {FdsSmokeManifest} manifest

 * @param {FdsSmokePart} part

 * @param {Uint8Array} partData

 */

export function applyFdsSmokePartToAtlas(volumeRenderer, manifest, part, partData) {

    const [nx, ny, nz] = manifest.dims;

    const voxelsPerFrame = nx * ny * nz;

    // マルチパートはパート内ローカルフレーム (0..frameCount-1) だけをアトラスに書き込む
    volumeRenderer.updateAtlasTexture((xi, yi, zi, _x, _y, _z, t) => {

        const localFrame = Math.floor(t);

        const index = localFrame * voxelsPerFrame + xi + zi * nx + yi * nx * ny;

        return partData[index] / 255.0;

    }, 0, part.frameCount);

    // シェーダの timeCount はアクティブパートのフレーム数に合わせる（maxPartFrames のままだと
    // 未使用アトラススロットの古いデータをサンプルする）
    volumeRenderer.uniforms.timeCount.value = part.frameCount;

}



/**

 * VolumeRenderer の空アトラスを用意する

 * @param {FdsSmokeManifest} manifest

 * @param {FdsSmokeTransform} transform

 * @returns {VolumeRenderer}

 */

function createEmptyFdsVolumeRenderer(manifest, transform = {}, atlasTimeCount = manifest.frameCount) {
    const placement = computeFdsVolumePlacement(manifest, transform);
    const volumeRenderer = new VolumeRenderer();
    volumeRenderer.createAtlasTexture(
        placement.volumeResolution,
        placement.volumeOrigin,
        placement.voxelSize,
        atlasTimeCount,
    );
    applyVolumePlacementToRenderer(volumeRenderer, placement);
    return volumeRenderer;
}



/**

 * VolumeRenderer インスタンスを生成して FDS データを適用する（単一ファイル）

 * @param {FdsSmokeManifest} manifest

 * @param {Uint8Array} volumeData

 * @param {FdsSmokeTransform} transform

 * @param {FdsSmokeRenderOptions} [renderOptions]

 * @returns {Promise<VolumeRenderer>}

 */

export async function createFdsVolumeRenderer(manifest, volumeData, transform = {}, renderOptions = {}) {

    const [nx, ny, nz] = manifest.dims;

    const voxelsPerFrame = nx * ny * nz;



    const volumeRenderer = createEmptyFdsVolumeRenderer(manifest, transform);



    volumeRenderer.updateAtlasTexture((xi, yi, zi, _x, _y, _z, t) => {

        const frame = Math.floor(t);

        const index = frame * voxelsPerFrame + xi + zi * nx + yi * nx * ny;

        return volumeData[index] / 255.0;

    });



    await applyFdsVolumeRenderOptions(volumeRenderer, renderOptions);

    return volumeRenderer;

}



/**

 * マルチパート manifest のパートをオンデマンドで読み込み・アトラス更新する

 */

export class FdsMultipartSmokeController {
    /**
     * @param {VolumeRenderer} volumeRenderer
     * @param {FdsSmokeManifest} manifest
     * @param {string} manifestPath
     */
    constructor(volumeRenderer, manifest, manifestPath) {
        this.volumeRenderer = volumeRenderer;
        this.manifest = manifest;
        this.manifestPath = manifestPath;
        /** @type {FdsSmokePart[]} */
        this.parts = [...(manifest.parts ?? [])].sort((a, b) => a.frameStart - b.frameStart);
        /** @type {Map<string, Uint8Array>} ダウンロード済みバイナリ（アトラス未反映でも可） */
        this._partDataCache = new Map();
        /** @type {Map<string, Promise<Uint8Array>>} */
        this._fetchingParts = new Map();
        /** 現在アトラスに載っているパート ID */
        this._activePartId = null;
        this._disposed = false;
        /** VolumeRenderer.uniforms.time 用の直近有効ローカル時刻 */
        this._lastRendererTime = 0;
    }

    /**
     * パートのバイナリがキャッシュ済みか（表示切替可能）
     * @param {string} partId
     * @returns {boolean}
     */
    isPartLoaded(partId) {
        return this._partDataCache.has(partId);
    }

    /**
     * 指定パートのバイナリを取得してキャッシュする（アトラスは触らない）
     * @param {FdsSmokePart} part
     * @returns {Promise<Uint8Array | null>}
     */
    async prefetchPart(part) {
        if (this._disposed) return null;
        const cached = this._partDataCache.get(part.id);
        if (cached) return cached;

        const existing = this._fetchingParts.get(part.id);
        if (existing) return existing;

        const fetchPromise = (async () => {
            const partData = await loadFdsSmokePart(this.manifestPath, part);
            if (this._disposed) return partData;
            this._partDataCache.set(part.id, partData);
            return partData;
        })();

        this._fetchingParts.set(part.id, fetchPromise);
        try {
            return await fetchPromise;
        } finally {
            this._fetchingParts.delete(part.id);
        }
    }

    /**
     * 指定パートをアトラスに載せる（現在再生中パート以外で呼ぶと見た目が壊れる）
     * @param {FdsSmokePart} part
     * @returns {Promise<boolean>}
     */
    async activatePart(part) {
        if (this._disposed) return false;
        if (this._activePartId === part.id) return true;

        const partData = await this.prefetchPart(part);
        if (this._disposed || !partData) return false;

        applyFdsSmokePartToAtlas(this.volumeRenderer, this.manifest, part, partData);
        this._activePartId = part.id;
        return true;
    }

    /**
     * 指定パートを読み込み、アトラスに反映する（表示用）
     * @param {FdsSmokePart} part
     */
    async loadPart(part) {
        await this.activatePart(part);
    }

    /**
     * 先頭パートを読み込む
     */
    async loadInitialPart() {
        if (this.parts.length === 0) {
            throw new Error('Multipart manifest has no parts');
        }
        await this.activatePart(this.parts[0]);
    }

    /**
     * 指定フレームを含むパートを読み込み、アトラスに反映する
     * @param {number} frameIndex
     */
    async loadPartForFrame(frameIndex) {
        const part = this._findPartForFrame(frameIndex);
        if (!part) {
            throw new Error(`No part found for frame ${frameIndex}`);
        }
        await this.activatePart(part);
        this._lastRendererTime = Math.max(0, frameIndex - part.frameStart);
    }

    /**
     * 指定フレームのパートがキャッシュ済みになるまで待ち、アトラスへ反映する
     * @param {number} frameIndex
     * @returns {Promise<boolean>}
     */
    async ensurePartForFrame(frameIndex) {
        const part = this._findPartForFrame(frameIndex);
        if (!part) return false;
        await this.activatePart(part);
        this._lastRendererTime = Math.max(0, frameIndex - part.frameStart);
        return true;
    }

    /**
     * 現在フレームのパートをアトラスに載せ、次パートはバイナリのみプリフェッチする
     * @param {number} playbackTime フレームインデックス（小数可）
     */
    tick(playbackTime) {
        if (this._disposed || this.parts.length === 0) return;

        const frameIndex = Math.floor(playbackTime);
        const currentPart = this._findPartForFrame(frameIndex);
        if (!currentPart) return;

        // 表示中パートのみアトラス反映（次パートの上書きを禁止）
        if (this._activePartId !== currentPart.id && this._partDataCache.has(currentPart.id)) {
            applyFdsSmokePartToAtlas(
                this.volumeRenderer,
                this.manifest,
                currentPart,
                this._partDataCache.get(currentPart.id),
            );
            this._activePartId = currentPart.id;
        } else if (!this._partDataCache.has(currentPart.id)) {
            void this.prefetchPart(currentPart);
        }

        const currentPartIndex = this.parts.indexOf(currentPart);
        const progressInPart = frameIndex - currentPart.frameStart;
        const prefetchThreshold = Math.max(1, Math.floor(currentPart.frameCount * 0.5));

        if (progressInPart >= currentPart.frameCount - prefetchThreshold) {
            const nextPart = this.parts[currentPartIndex + 1];
            if (nextPart) {
                // 次パートはキャッシュのみ。アトラスには載せない
                void this.prefetchPart(nextPart);
            }
        }
    }

    /**
     * @param {number} frameIndex
     * @returns {FdsSmokePart | null}
     */
    _findPartForFrame(frameIndex) {
        for (const part of this.parts) {
            if (frameIndex >= part.frameStart && frameIndex < part.frameStart + part.frameCount) {
                return part;
            }
        }
        return this.parts[this.parts.length - 1] ?? null;
    }

    /**
     * グローバルフレームインデックスを VolumeRenderer のローカル time に変換する
     * @param {number} globalPlaybackTime
     * @returns {number}
     */
    toRendererTime(globalPlaybackTime) {
        const frameIndex = Math.floor(globalPlaybackTime);
        const part = this._findPartForFrame(frameIndex);
        if (!part || this._activePartId !== part.id) {
            return this._lastRendererTime;
        }
        const localTime = globalPlaybackTime - part.frameStart;
        this._lastRendererTime = localTime;
        return localTime;
    }

    /**
     * 指定グローバルフレームのボクセルデータ（キャッシュ済みパートのみ）
     * @param {number} frameIndex
     * @returns {{ data: Uint8Array, localFrameIndex: number } | null}
     */
    getCachedVolumeDataForFrame(frameIndex) {
        const part = this._findPartForFrame(frameIndex);
        if (!part) return null;
        const data = this._partDataCache.get(part.id);
        if (!data) return null;
        return {
            data,
            localFrameIndex: Math.max(0, frameIndex - part.frameStart),
        };
    }

    dispose() {
        this._disposed = true;
        this._fetchingParts.clear();
        this._partDataCache.clear();
        this._activePartId = null;
    }
}



/**

 * manifest 形式に応じて VolumeRenderer を生成する（単一 / マルチパート）

 * @param {string} manifestPath

 * @param {FdsSmokeTransform} [transform]

 * @param {FdsSmokeRenderOptions} [renderOptions]

 * @param {{ initialFrame?: number }} [loadOptions]

 * @returns {Promise<{ volumeRenderer: VolumeRenderer, multipart: FdsMultipartSmokeController | null, manifest: FdsSmokeManifest, volumeData: Uint8Array | null }>}

 */

export async function createFdsSmokeVolume(manifestPath, transform = {}, renderOptions = {}, loadOptions = {}) {

    const manifest = await loadFdsSmokeManifestOnly(manifestPath);

    const initialFrame = typeof loadOptions.initialFrame === 'number' ? loadOptions.initialFrame : null;



    if (manifest.multipart && Array.isArray(manifest.parts) && manifest.parts.length > 0) {

        const maxPartFrames = Math.max(...manifest.parts.map((part) => part.frameCount));

        const volumeRenderer = createEmptyFdsVolumeRenderer(manifest, transform, maxPartFrames);

        await applyFdsVolumeRenderOptions(volumeRenderer, renderOptions);



        const multipart = new FdsMultipartSmokeController(volumeRenderer, manifest, manifestPath);

        if (initialFrame !== null) {

            await multipart.loadPartForFrame(initialFrame);

        } else {

            await multipart.loadInitialPart();

        }



        return { volumeRenderer, multipart, manifest, volumeData: null };

    }



    const volumeData = await loadFdsSmokeBinary(manifestPath, manifest);

    const volumeRenderer = await createFdsVolumeRenderer(

        manifest,

        volumeData,

        transform,

        renderOptions,

    );

    return { volumeRenderer, multipart: null, manifest, volumeData };

}


