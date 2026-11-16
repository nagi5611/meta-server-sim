// public/js/fds/fds-smoke-atlas-client.js — アトラス Worker ジョブ（直列）
import FdsSmokeAtlasWorker from './fds-smoke-atlas.worker.js?worker';
import { FDS_SMOKE_ATLAS_FRAMES_PER_CHUNK } from './fds-smoke-transfer-policy.js';

/** @type {Worker | null} */
let worker = null;
let workerDisabled = false;
let nextJobId = 1;

/** @type {Promise<void>} */
let chain = Promise.resolve();

/** @type {Map<number, { resolve: Function, reject: Function }>} */
const pending = new Map();

function ensureWorker() {
    if (workerDisabled) return null;
    if (!worker) {
        try {
            worker = new FdsSmokeAtlasWorker();
            worker.onmessage = (event) => {
                const data = event.data || {};
                if (data.type !== 'buildChunkResult' || data.id == null) return;
                const job = pending.get(data.id);
                if (!job) return;
                pending.delete(data.id);
                if (data.ok) {
                    job.resolve({
                        indices: new Uint32Array(data.indices),
                        values: new Uint16Array(data.values),
                        timeStart: data.timeStart,
                        timeCount: data.timeCount,
                    });
                } else {
                    job.reject(new Error(data.error || 'atlas build failed'));
                }
            };
            worker.onerror = () => {
                workerDisabled = true;
            };
        } catch {
            workerDisabled = true;
            return null;
        }
    }
    return worker;
}

/**
 * @param {object} params
 * @returns {Promise<{ indices: Uint32Array, values: Uint16Array, timeStart: number, timeCount: number }>}
 */
function runBuildChunk(params) {
    const w = ensureWorker();
    if (!w) {
        return Promise.reject(new Error('atlas worker unavailable'));
    }
    const id = nextJobId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({
            type: 'buildChunk',
            id,
            nx: params.nx,
            ny: params.ny,
            nz: params.nz,
            partFrameCount: params.partFrameCount,
            timeStart: params.timeStart,
            timeCount: params.timeCount,
            partData: params.partData,
        });
    });
}

/**
 * @param {import('./fds-volume-loader.js').FdsSmokeManifest} manifest
 * @param {import('./fds-volume-loader.js').FdsSmokePart} part
 * @param {Uint8Array} partData
 * @param {(chunk: { indices: Uint32Array, values: Uint16Array, timeStart: number, timeCount: number }) => void} onChunk
 * @param {{ framesPerChunk?: number, signal?: AbortSignal, timeStart?: number, maxChunks?: number }} [options]
 * @returns {Promise<void>}
 */
export async function buildPartAtlasInWorker(manifest, part, partData, onChunk, options = {}) {
    const framesPerChunk = options.framesPerChunk ?? FDS_SMOKE_ATLAS_FRAMES_PER_CHUNK;
    const [nx, ny, nz] = manifest.dims;
    const dataCopy = partData.slice();
    const rangeStart = Math.max(0, options.timeStart ?? 0);
    let chunksDone = 0;

    for (let timeStart = rangeStart; timeStart < part.frameCount; timeStart += framesPerChunk) {
        if (options.signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
        const timeCount = Math.min(framesPerChunk, part.frameCount - timeStart);
        const chunk = await new Promise((resolve, reject) => {
            chain = chain
                .then(() =>
                    runBuildChunk({
                        nx,
                        ny,
                        nz,
                        partFrameCount: part.frameCount,
                        timeStart,
                        timeCount,
                        partData: dataCopy,
                    }),
                )
                .then(resolve)
                .catch(reject);
        });
        onChunk(chunk);
        chunksDone += 1;
        if (options.maxChunks != null && chunksDone >= options.maxChunks) {
            return;
        }
    }
}

export function disposeFdsSmokeAtlasClient() {
    pending.clear();
    if (worker) {
        worker.terminate();
        worker = null;
    }
}