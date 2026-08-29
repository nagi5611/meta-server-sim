// public/js/tenant-mesh-bvh-worker-client.js — Vite 互換 BVH Worker（テナントアプリ用）
import { Box3, BufferAttribute } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import BvhWorker from 'three-mesh-bvh/src/workers/generateMeshBVH.worker.js?worker';

/** @type {Worker | null} */
let workerInstance = null;
/** Worker 生成・実行が一度でも失敗したらメインスレッドにフォールバック */
let workerDisabled = false;
/** @type {boolean} */
let workerRunning = false;

/** scene-manager と同一の BVH 構築オプション */
export const MESH_BVH_BUILD_OPTIONS = {
    strategy: 0,
    maxDepth: 40,
    maxLeafTris: 10,
    verbose: false,
};

/**
 * メインスレッドで boundsTree を構築する（フォールバック）
 * @param {import('three').BufferGeometry} geometry
 * @param {object} options
 * @returns {import('three-mesh-bvh').MeshBVH}
 */
function buildMeshBVHSync(geometry, options) {
    const bvh = new MeshBVH(geometry, options);
    geometry.boundsTree = bvh;
    return bvh;
}

/**
 * Vite ?worker で生成した Worker を返す
 * @returns {Worker | null}
 */
function getMeshBvhWorker() {
    if (workerDisabled) return null;
    if (!workerInstance) {
        try {
            workerInstance = new BvhWorker();
            workerInstance.onerror = (e) => {
                console.warn('[mesh-bvh-worker] Worker runtime error:', e.message || e);
                workerDisabled = true;
                try {
                    workerInstance?.terminate();
                } catch {
                    /* ignore */
                }
                workerInstance = null;
            };
        } catch (err) {
            workerDisabled = true;
            console.warn('[mesh-bvh-worker] Worker init failed, using main thread:', err);
            return null;
        }
    }
    return workerInstance;
}

/**
 * Worker で geometry に boundsTree を構築する（GenerateMeshBVHWorker.runTask 同等）
 * @param {Worker} worker
 * @param {import('three').BufferGeometry} geometry
 * @param {object} options
 * @returns {Promise<import('three-mesh-bvh').MeshBVH>}
 */
function runWorkerTask(worker, geometry, options = {}) {
    return new Promise((resolve, reject) => {
        if (
            geometry.getAttribute('position').isInterleavedBufferAttribute ||
            (geometry.index && geometry.index.isInterleavedBufferAttribute)
        ) {
            reject(
                new Error(
                    'GenerateMeshBVHWorker: InterleavedBufferAttribute are not supported for the geometry attributes.'
                )
            );
            return;
        }

        const onError = (e) => {
            cleanup();
            reject(new Error(`GenerateMeshBVHWorker: ${e?.message || 'worker failed'}`));
        };

        const onMessage = (e) => {
            const { data } = e;

            if (data?.error) {
                cleanup();
                const errMsg =
                    typeof data.error === 'string'
                        ? data.error
                        : data.error?.message || 'BVH worker reported an error';
                reject(new Error(`GenerateMeshBVHWorker: ${errMsg}`));
                return;
            }

            if (data?.serialized) {
                const { serialized, position } = data;
                const bvh = MeshBVH.deserialize(serialized, geometry, { setIndex: false });
                const boundsOptions = {
                    setBoundingBox: true,
                    ...options,
                };

                geometry.attributes.position.array = position;
                if (serialized.index) {
                    if (geometry.index) {
                        geometry.index.array = serialized.index;
                    } else {
                        geometry.setIndex(new BufferAttribute(serialized.index, 1, false));
                    }
                }

                if (boundsOptions.setBoundingBox) {
                    geometry.boundingBox = bvh.getBoundingBox(new Box3());
                }

                if (options.onProgress) {
                    options.onProgress(data.progress ?? 1);
                }

                cleanup();
                resolve(bvh);
                return;
            }

            if (options.onProgress && data?.progress != null) {
                options.onProgress(data.progress);
            }
        };

        const cleanup = () => {
            worker.removeEventListener('error', onError);
            worker.removeEventListener('message', onMessage);
        };

        worker.addEventListener('error', onError);
        worker.addEventListener('message', onMessage);

        const index = geometry.index ? geometry.index.array : null;
        const position = geometry.attributes.position.array;
        const transferable = [position];
        if (index) transferable.push(index);

        worker.postMessage(
            {
                index,
                position,
                options: {
                    ...options,
                    onProgress: null,
                    includedProgressCallback: Boolean(options.onProgress),
                    groups: [...geometry.groups],
                },
            },
            transferable
                .map((arr) => arr.buffer)
                .filter(
                    (v) =>
                        typeof SharedArrayBuffer === 'undefined' ||
                        !(v instanceof SharedArrayBuffer)
                )
        );
    });
}

/**
 * Worker で geometry に boundsTree を構築する
 * @param {import('three').BufferGeometry} geometry
 * @param {object} [options]
 * @returns {Promise<import('three-mesh-bvh').MeshBVH>}
 */
export async function buildMeshBVHAsync(geometry, options = MESH_BVH_BUILD_OPTIONS) {
    const worker = getMeshBvhWorker();
    if (!worker) {
        return buildMeshBVHSync(geometry, options);
    }

    if (workerRunning) {
        console.warn('[mesh-bvh-worker] Worker busy, using main thread for this build');
        return buildMeshBVHSync(geometry, options);
    }

    workerRunning = true;
    try {
        const bvh = await runWorkerTask(worker, geometry, options);
        if (!geometry.boundsTree) {
            geometry.boundsTree = bvh;
        }
        return bvh;
    } catch (err) {
        console.warn('[mesh-bvh-worker] Worker generate failed, using main thread:', err);
        workerDisabled = true;
        if (workerInstance) {
            try {
                workerInstance.terminate();
            } catch {
                /* ignore */
            }
            workerInstance = null;
        }
        return buildMeshBVHSync(geometry, options);
    } finally {
        workerRunning = false;
    }
}

/**
 * Worker が実行中か
 * @returns {boolean}
 */
export function isMeshBvhWorkerRunning() {
    return workerRunning;
}

/**
 * Worker を終了する
 */
export function disposeMeshBvhWorker() {
    if (workerInstance) {
        workerInstance.terminate();
        workerInstance = null;
    }
    workerRunning = false;
}
