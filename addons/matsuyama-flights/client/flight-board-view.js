// addons/matsuyama-flights/client/flight-board-view.js — 発着板のカメラ合わせ・ピクセル検証
import { getSharedThree } from './three-shared.js';

/**
 * @param {object} app
 * @returns {import('three').Mesh|null}
 */
export function findFirstFlightBoardMesh(app) {
    const scene = app?.sceneManager?.getScene?.();
    if (!scene) return null;
    /** @type {import('three').Mesh|null} */
    let board = null;
    scene.traverse((obj) => {
        if (board || !obj?.userData?.flightBoardConfig || !obj.isMesh) return;
        board = obj;
    });
    return board;
}

/**
 * 発着板が画面中央付近に入るようカメラを置く
 * @param {object} app
 * @returns {boolean}
 */
export function frameFlightBoardForView(app) {
    const THREE = getSharedThree();
    const board = findFirstFlightBoardMesh(app);
    const camera = app?.sceneManager?.getCamera?.();
    const renderer = app?.sceneManager?.getRenderer?.();
    const scene = app?.sceneManager?.getScene?.();
    if (!board || !camera || !renderer || !scene) return false;

    board.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(board);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const vFov = ((camera.fov ?? 75) * Math.PI) / 180;
    const aspect = camera.aspect > 0 ? camera.aspect : 1;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const distV = size.y > 0 ? (size.y / 2) / Math.tan(vFov / 2) : 5;
    const distH = size.x > 0 ? (size.x / 2) / Math.tan(hFov / 2) : 5;
    const distance = Math.max(distV, distH) * 1.08;
    const faceNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(board.quaternion).normalize();
    camera.position.copy(center).add(faceNormal.multiplyScalar(distance));
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return true;
}

/**
 * キャンバス中央の RGBA を読む（フレーム後に呼ぶ）
 * @param {object} app
 * @returns {{ r: number, g: number, b: number, a: number } | null}
 */
/**
 * WebGL キャンバスを 2D に落として RGBA を読む（preserveDrawingBuffer 不要）
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<CanvasRenderingContext2D|null>}
 */
/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{ ctx: CanvasRenderingContext2D, png: string|null }|null>}
 */
async function readRendererFrame2d(canvas) {
    let blob = null;
    if (typeof canvas.toBlob === 'function') {
        blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    } else {
        const dataUrl = canvas.toDataURL('image/png');
        blob = await (await fetch(dataUrl)).blob();
    }
    if (!blob) return null;
    const png = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
    });
    const bmp = await createImageBitmap(blob);
    const scratch =
        globalThis.__matsuyamaFlightsViewportScratch ||
        (globalThis.__matsuyamaFlightsViewportScratch = document.createElement('canvas'));
    scratch.width = bmp.width;
    scratch.height = bmp.height;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        bmp.close();
        return null;
    }
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return { ctx, png };
}

/**
 * @param {object} app
 * @returns {Promise<{ r: number, g: number, b: number, a: number } | null>}
 */
export async function sampleViewportCenterPixel(app) {
    const renderer = app?.sceneManager?.getRenderer?.();
    if (!renderer?.domElement) return null;
    const frame = await readRendererFrame2d(renderer.domElement);
    if (!frame?.ctx) return null;
    const ctx = frame.ctx;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const x = Math.floor(w / 2);
    const y = Math.floor(h / 2);
    const d = ctx.getImageData(x, y, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
}

/**
 * 画面中央付近に LED 黄系ピクセルがあるか（発着板フルスクリーン想定）
 * @param {object} app
 * @returns {Promise<boolean>}
 */
function countLedYellowInCtx(ctx, x0, y0, x1, y1) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const left = Math.max(0, x0);
    const top = Math.max(0, y0);
    const right = Math.min(w, x1);
    const bottom = Math.min(h, y1);
    if (right <= left || bottom <= top) return 0;
    const data = ctx.getImageData(left, top, right - left, bottom - top).data;
    let hits = 0;
    for (let i = 0; i < data.length; i += 16) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r > 140 && g > 110 && b < 130) hits += 1;
    }
    return hits;
}

/**
 * @param {object} app
 * @returns {Promise<boolean>}
 */
export async function viewportCenterHasLedYellow(app) {
    const renderer = app?.sceneManager?.getRenderer?.();
    if (!renderer?.domElement) return false;
    const frame = await readRendererFrame2d(renderer.domElement);
    if (!frame?.ctx) return false;
    const ctx = frame.ctx;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const hits = countLedYellowInCtx(ctx, w * 0.25, h * 0.2, w * 0.75, h * 0.85);
    return hits > 8;
}

/**
 * @param {object} app
 * @returns {Promise<number>}
 */
export async function countViewportLedYellowPixels(app) {
    const renderer = app?.sceneManager?.getRenderer?.();
    if (!renderer?.domElement) return 0;
    const frame = await readRendererFrame2d(renderer.domElement);
    if (!frame?.ctx) return 0;
    const ctx = frame.ctx;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    return countLedYellowInCtx(ctx, w * 0.25, h * 0.2, w * 0.75, h * 0.85);
}

/**
 * @param {object} app
 * @returns {Promise<{ hits: number, hasLed: boolean }>}
 */
export async function measureViewportLedYellow(app) {
    const renderer = app?.sceneManager?.getRenderer?.();
    if (!renderer?.domElement) return { hits: 0, hasLed: false, png: null };
    const frame = await readRendererFrame2d(renderer.domElement);
    if (!frame?.ctx) return { hits: 0, hasLed: false, png: null };
    const w = frame.ctx.canvas.width;
    const h = frame.ctx.canvas.height;
    const hits = countLedYellowInCtx(frame.ctx, w * 0.25, h * 0.2, w * 0.75, h * 0.85);
    return { hits, hasLed: hits > 8, png: frame.png };
}

/**
 * フレーム後の PNG data URL（E2E 証跡用）
 * @param {object} app
 * @returns {string|null}
 */
export function captureFramedViewportPng(app) {
    const canvas = app?.sceneManager?.getRenderer?.()?.domElement;
    if (!canvas) return null;
    try {
        return canvas.toDataURL('image/png');
    } catch {
        return null;
    }
}

/**
 * 2D キャンバス上に LED 色（黄系）が描かれているか
 * @param {HTMLCanvasElement} canvas
 * @returns {boolean}
 */
export function canvasHasLedContent(canvas) {
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const { width, height } = canvas;
    const stepX = Math.max(8, Math.floor(width / 48));
    const stepY = Math.max(8, Math.floor(height / 32));
    for (let y = stepY; y < height - stepY; y += stepY) {
        for (let x = stepX; x < width - stepX; x += stepX) {
            const d = ctx.getImageData(x, y, 1, 1).data;
            if (d[0] > 140 && d[1] > 100 && d[2] < 120) return true;
        }
    }
    return false;
}