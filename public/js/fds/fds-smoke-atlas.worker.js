// public/js/fds/fds-smoke-atlas.worker.js — パート断片のアトラス half-float 構築
import {
    atlasVoxelIndex,
    computeAtlasResolution,
    computeAtlasTextureSize,
    floatToHalf,
} from './fds-atlas-layout.js';

/**
 * @param {object} msg
 */
function buildAtlasChunk(msg) {
    const {
        nx,
        ny,
        nz,
        partFrameCount,
        timeStart,
        timeCount,
        partData,
    } = msg;

    const volumeResolution = { x: nx, y: ny, z: nz };
    const atlasResolution = computeAtlasResolution(partFrameCount);
    const textureSize = computeAtlasTextureSize(volumeResolution, atlasResolution);
    const voxelsPerFrame = nx * ny * nz;
    const data = new Uint8Array(partData);

    const endTime = Math.min(timeStart + timeCount, partFrameCount);
    const count = Math.max(0, endTime - timeStart);
    const indices = [];
    const values = [];

    for (let t = timeStart; t < endTime; t++) {
        for (let xi = 0; xi < nx; xi++) {
            for (let yi = 0; yi < ny; yi++) {
                for (let zi = 0; zi < nz; zi++) {
                    const localFrame = Math.floor(t);
                    const sampleIndex = localFrame * voxelsPerFrame + xi + zi * nx + yi * nx * ny;
                    const value = data[sampleIndex] / 255.0;
                    const i = atlasVoxelIndex(
                        xi,
                        yi,
                        zi,
                        t,
                        volumeResolution,
                        atlasResolution,
                        textureSize,
                    );
                    indices.push(i);
                    values.push(floatToHalf(value));
                }
            }
        }
    }

    return {
        indices: new Uint32Array(indices),
        values: new Uint16Array(values),
        timeStart,
        timeCount: count,
    };
}

self.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== 'buildChunk' || data.id == null) {
        return;
    }
    try {
        const result = buildAtlasChunk(data);
        self.postMessage(
            {
                type: 'buildChunkResult',
                id: data.id,
                ok: true,
                indices: result.indices,
                values: result.values,
                timeStart: result.timeStart,
                timeCount: result.timeCount,
            },
            [result.indices.buffer, result.values.buffer],
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        self.postMessage({ type: 'buildChunkResult', id: data.id, ok: false, error: message });
    }
});