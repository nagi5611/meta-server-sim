// public/js/fds/fds-atlas-layout.js — VolumeRenderer アトラスレイアウト（Worker とメインで共有）

/**
 * @param {number} timeCount
 * @returns {{ x: number, y: number, z: number }}
 */
export function computeAtlasResolution(timeCount) {
    const tcx = Math.ceil(Math.pow(timeCount, 1 / 3));
    const tcy = tcx;
    const tcz = Math.ceil(timeCount / (tcx * tcy));
    return { x: tcx, y: tcy, z: tcz };
}

/**
 * @param {{ x: number, y: number, z: number }} volumeResolution
 * @param {{ x: number, y: number, z: number }} atlasResolution
 * @returns {{ textureSizeX: number, textureSizeY: number, textureSizeZ: number }}
 */
export function computeAtlasTextureSize(volumeResolution, atlasResolution) {
    return {
        textureSizeX: volumeResolution.x * atlasResolution.x,
        textureSizeY: volumeResolution.y * atlasResolution.y,
        textureSizeZ: volumeResolution.z * atlasResolution.z,
    };
}

/**
 * @param {number} xi
 * @param {number} yi
 * @param {number} zi
 * @param {number} t
 * @param {{ x: number, y: number, z: number }} volumeResolution
 * @param {{ x: number, y: number, z: number }} atlasResolution
 * @param {{ textureSizeX: number, textureSizeY: number }} textureSize
 * @returns {number}
 */
export function atlasVoxelIndex(xi, yi, zi, t, volumeResolution, atlasResolution, textureSize) {
    const volumeIndexX = t % atlasResolution.x;
    const volumeIndexY = Math.floor(t / atlasResolution.x) % atlasResolution.y;
    const volumeIndexZ = Math.floor(t / (atlasResolution.x * atlasResolution.y));
    const xai = volumeIndexX * volumeResolution.x + xi;
    const yai = volumeIndexY * volumeResolution.y + yi;
    const zai = volumeIndexZ * volumeResolution.z + zi;
    return xai + yai * textureSize.textureSizeX + zai * textureSize.textureSizeX * textureSize.textureSizeY;
}

/**
 * float32 → half float (THREE HalfFloatType Data3DTexture と同形式)
 * @param {number} val
 * @returns {number}
 */
export function floatToHalf(val) {
    const f = Number(val);
    if (!Number.isFinite(f)) return 0;
    const floatView = new Float32Array(1);
    const int32View = new Int32Array(floatView.buffer);
    floatView[0] = f;
    const x = int32View[0];
    let bits = (x >> 16) & 0x8000;
    let m = (x >> 12) & 0x07ff;
    const e = (x >> 23) & 0xff;
    if (e < 103) return bits;
    if (e > 142) {
        bits |= 0x7c00;
        bits |= e === 255 && (x & 0x007fffff) ? 0x0200 : 0;
        return bits;
    }
    if (e < 113) {
        m |= 0x0800;
        bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
        return bits;
    }
    bits |= ((e - 112) << 10) | (m >> 1);
    bits += m & 1;
    return bits;
}