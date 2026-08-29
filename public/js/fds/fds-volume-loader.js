// public/js/fds/fds-volume-loader.js — FDS smoke manifest/binary loader for VolumeRenderer



import * as THREE from 'three';

import VolumeRenderer from './VolumeRenderer.js';

import { toTenantUrl } from '../tenant-runtime-shim.js';



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

 */



/**

 * @typedef {object} FdsSmokeRenderOptions

 * @property {number} [raySteps]

 * @property {number} [extinctionCoefficient]

 * @property {number} [minCutoff]

 * @property {number} [maxCutoff]

 */



/**

 * manifest のみ読み込む

 * @param {string} manifestPath tenant 相対パス

 * @returns {Promise<FdsSmokeManifest>}

 */

export async function loadFdsSmokeManifestOnly(manifestPath) {

    const manifestUrl = toTenantUrl(`/${manifestPath.replace(/^\/+/, '')}`);

    const manifestResponse = await fetch(manifestUrl);

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

    const dataUrl = toTenantUrl(`/${dataDir}${manifest.dataFile}`);

    const dataResponse = await fetch(dataUrl);

    if (!dataResponse.ok) {

        throw new Error(`Failed to load volume data (${dataResponse.status}): ${dataUrl}`);

    }

    const buffer = await dataResponse.arrayBuffer();

    return new Uint8Array(buffer);

}



/**

 * パートバイナリを読み込む

 * @param {string} manifestPath

 * @param {FdsSmokePart} part

 * @returns {Promise<Uint8Array>}

 */

export async function loadFdsSmokePart(manifestPath, part) {

    const dataDir = getManifestDataDir(manifestPath);

    const dataUrl = toTenantUrl(`/${dataDir}${part.dataFile}`);

    const dataResponse = await fetch(dataUrl);

    if (!dataResponse.ok) {

        throw new Error(`Failed to load part data (${dataResponse.status}): ${dataUrl}`);

    }

    const buffer = await dataResponse.arrayBuffer();

    return new Uint8Array(buffer);

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

 * FDS bounds + transform からワールド座標の volumeOrigin / voxelSize を算出する

 * @param {FdsSmokeManifest} manifest

 * @param {FdsSmokeTransform} transform

 * @returns {{ volumeOrigin: THREE.Vector3, voxelSize: THREE.Vector3, volumeResolution: THREE.Vector3 }}

 */

export function computeFdsVolumePlacement(manifest, transform = {}) {

    const [nx, ny, nz] = manifest.dims;

    const bounds = manifest.bounds;

    const scale = transform.scale ?? 1;

    const position = transform.position ?? { x: 0, y: 0, z: 0 };



    const dx = bounds.x[1] - bounds.x[0];

    const dy = bounds.y[1] - bounds.y[0];

    const dz = bounds.z[1] - bounds.z[0];



    const volumeOrigin = new THREE.Vector3(

        position.x,

        position.y,

        position.z,

    );



    const voxelSize = new THREE.Vector3(

        (dx / Math.max(nx - 1, 1)) * scale,

        (dz / Math.max(nz - 1, 1)) * scale,

        (dy / Math.max(ny - 1, 1)) * scale,

    );



    const volumeResolution = new THREE.Vector3(nx, nz, ny);



    return { volumeOrigin, voxelSize, volumeResolution };

}



/**

 * palette テクスチャを読み込む

 * @param {string} [palettePath]

 * @returns {Promise<THREE.Texture>}

 */

export function loadSmokePalette(palettePath = DEFAULT_PALETTE_PATH) {

    const url = toTenantUrl(palettePath);

    return new Promise((resolve) => {

        new THREE.TextureLoader().load(

            url,

            (texture) => resolve(texture),

            undefined,

            () => {

                resolve(createDefaultSmokePalette());

            },

        );

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

    const uniforms = volumeRenderer.uniforms;

    uniforms.valueAdded.value = 0;

    uniforms.minCutoffValue.value = renderOptions.minCutoff ?? 0.02;

    uniforms.maxCutoffValue.value = renderOptions.maxCutoff ?? 1.0;

    uniforms.extinctionCoefficient.value = renderOptions.extinctionCoefficient ?? 2.5;

    uniforms.alphaMultiplier.value = 1.2;



    try {

        uniforms.palette.value = await loadSmokePalette();

    } catch (e) {

        console.warn('[fds-volume-loader] palette load failed:', e);

        uniforms.palette.value = createDefaultSmokePalette();

    }



    volumeRenderer.updateMaterial({

        useExtinctionCoefficient: true,

        useRandomStart: true,

        raySteps: renderOptions.raySteps ?? 48,

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

    const frameStart = part.frameStart;



    volumeRenderer.updateAtlasTexture((xi, yi, zi, _x, _y, _z, t) => {

        const localFrame = Math.floor(t) - frameStart;

        const index = localFrame * voxelsPerFrame + xi + zi * nx + yi * nx * ny;

        return partData[index] / 255.0;

    }, part.frameStart, part.frameCount);

}



/**

 * VolumeRenderer の空アトラスを用意する

 * @param {FdsSmokeManifest} manifest

 * @param {FdsSmokeTransform} transform

 * @returns {VolumeRenderer}

 */

function createEmptyFdsVolumeRenderer(manifest, transform = {}) {

    const { volumeOrigin, voxelSize, volumeResolution } = computeFdsVolumePlacement(manifest, transform);

    const volumeRenderer = new VolumeRenderer();

    volumeRenderer.createAtlasTexture(

        volumeResolution,

        volumeOrigin,

        voxelSize,

        manifest.frameCount,

    );

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

        /** @type {Set<string>} */

        this._loadedPartIds = new Set();

        /** @type {Map<string, Promise<void>>} */

        this._loadingParts = new Map();

        this._disposed = false;

    }



    /**

     * 指定パートを読み込んでアトラスに反映する

     * @param {FdsSmokePart} part

     */

    async loadPart(part) {

        if (this._disposed || this._loadedPartIds.has(part.id)) {

            return;

        }



        const existing = this._loadingParts.get(part.id);

        if (existing) {

            await existing;

            return;

        }



        const loadPromise = (async () => {

            const partData = await loadFdsSmokePart(this.manifestPath, part);

            if (this._disposed) return;

            applyFdsSmokePartToAtlas(this.volumeRenderer, this.manifest, part, partData);

            this._loadedPartIds.add(part.id);

        })();



        this._loadingParts.set(part.id, loadPromise);

        try {

            await loadPromise;

        } finally {

            this._loadingParts.delete(part.id);

        }

    }



    /**

     * 先頭パートを読み込む

     */

    async loadInitialPart() {

        if (this.parts.length === 0) {

            throw new Error('Multipart manifest has no parts');

        }

        await this.loadPart(this.parts[0]);

    }



    /**

     * 指定フレームを含むパートを読み込む

     * @param {number} frameIndex

     */

    async loadPartForFrame(frameIndex) {

        const part = this._findPartForFrame(frameIndex);

        if (!part) {

            throw new Error(`No part found for frame ${frameIndex}`);

        }

        await this.loadPart(part);

    }



    /**

     * 再生位置に応じて現在パートと次パートをプリフェッチする

     * @param {number} playbackTime フレームインデックス（小数可）

     */

    tick(playbackTime) {

        if (this._disposed || this.parts.length === 0) return;



        const frameIndex = Math.floor(playbackTime);

        const currentPart = this._findPartForFrame(frameIndex);

        if (!currentPart) return;



        void this.loadPart(currentPart);



        const currentPartIndex = this.parts.indexOf(currentPart);

        const progressInPart = frameIndex - currentPart.frameStart;

        const prefetchThreshold = Math.max(1, Math.floor(currentPart.frameCount * 0.25));



        if (progressInPart >= currentPart.frameCount - prefetchThreshold) {

            const nextPart = this.parts[currentPartIndex + 1];

            if (nextPart) {

                void this.loadPart(nextPart);

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



    dispose() {

        this._disposed = true;

        this._loadingParts.clear();

        this._loadedPartIds.clear();

    }

}



/**

 * manifest 形式に応じて VolumeRenderer を生成する（単一 / マルチパート）

 * @param {string} manifestPath

 * @param {FdsSmokeTransform} [transform]

 * @param {FdsSmokeRenderOptions} [renderOptions]

 * @param {{ initialFrame?: number }} [loadOptions]

 * @returns {Promise<{ volumeRenderer: VolumeRenderer, multipart: FdsMultipartSmokeController | null, manifest: FdsSmokeManifest }>}

 */

export async function createFdsSmokeVolume(manifestPath, transform = {}, renderOptions = {}, loadOptions = {}) {

    const manifest = await loadFdsSmokeManifestOnly(manifestPath);

    const initialFrame = typeof loadOptions.initialFrame === 'number' ? loadOptions.initialFrame : null;



    if (manifest.multipart && Array.isArray(manifest.parts) && manifest.parts.length > 0) {

        const volumeRenderer = createEmptyFdsVolumeRenderer(manifest, transform);

        await applyFdsVolumeRenderOptions(volumeRenderer, renderOptions);



        const multipart = new FdsMultipartSmokeController(volumeRenderer, manifest, manifestPath);

        if (initialFrame !== null) {

            await multipart.loadPartForFrame(initialFrame);

        } else {

            await multipart.loadInitialPart();

        }



        return { volumeRenderer, multipart, manifest };

    }



    const volumeData = await loadFdsSmokeBinary(manifestPath, manifest);

    const volumeRenderer = await createFdsVolumeRenderer(

        manifest,

        volumeData,

        transform,

        renderOptions,

    );

    return { volumeRenderer, multipart: null, manifest };

}


