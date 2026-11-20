// addons/matsuyama-flights/client/init.js — 本番ワールドへの発着板配置
import {
    createFlightBoardMesh,
    repaintFlightBoardsForLocale,
    startFlightBoardPolling,
} from './flight-board-mesh.js';
import {
    canvasHasLedContent,
    findFirstFlightBoardMesh,
    frameFlightBoardForView,
    sampleViewportCenterPixel,
    viewportCenterHasLedYellow,
    countViewportLedYellowPixels,
    measureViewportLedYellow,
    captureFramedViewportPng,
} from './flight-board-view.js';

/** @type {(() => void)|null} */
let stopPolling = null;

/**
 * ワールドの flightBoards をシーンに載せる
 * @param {object} app MetaverseApp
 * @param {object} world
 */
async function loadWorldFlightBoards(app, world) {
    if (stopPolling) {
        stopPolling();
        stopPolling = null;
    }

    const boards = Array.isArray(world?.flightBoards) ? world.flightBoards : [];
    const group = app.sceneManager?.environmentGroup;
    if (!group) return;

    for (const child of [...group.children]) {
        if (child.userData?.flightBoardConfig) {
            group.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                const m = child.material;
                if (m.map) m.map.dispose();
                m.dispose();
            }
        }
    }

    const meshes = [];
    for (const cfg of boards) {
        const mesh = createFlightBoardMesh(cfg);
        mesh.name = mesh.name || `flight-board-${cfg.id || meshes.length}`;
        group.add(mesh);
        meshes.push(mesh);
    }

    if (typeof document !== 'undefined') {
        const canvas = document.getElementById('canvas');
        if (canvas) canvas.__flightBoardMeshesReady = meshes.length > 0;
    }

    if (meshes.length) {
        stopPolling = startFlightBoardPolling(meshes, () => publishMatsuyamaDebugState(app, meshes));
    }

    publishMatsuyamaDebugState(app, meshes);
}

/**
 * @param {object} app
 * @param {object[]} meshes
 */
function publishMatsuyamaDebugState(app, meshes) {
    globalThis.__tenantMatsuyamaFlights = {
        meshCount: meshes.length,
        hasCanvasLed: meshes.some((m) => canvasHasLedContent(m.userData?.flightBoardCanvas)),
        frameBoard: () => frameFlightBoardForView(app),
        sampleCenterPixel: () => sampleViewportCenterPixel(app),
        viewportHasLedYellow: () => viewportCenterHasLedYellow(app),
        countViewportLedYellow: () => countViewportLedYellowPixels(app),
        measureViewportLedYellow: () => measureViewportLedYellow(app),
        captureFramedPng: () => captureFramedViewportPng(app),
        findBoard: () => findFirstFlightBoardMesh(app),
    };
}

/**
 * @param {object} app MetaverseApp
 */
export async function initMatsuyamaFlightsSubsystem(app) {
    if (typeof globalThis !== 'undefined') {
        globalThis.__tenantMatsuyamaFlightsAppRef = app;
    }
    if (typeof window !== 'undefined') {
        window.addEventListener('metaverse-locale-changed', () => {
            repaintFlightBoardsForLocale();
        });
    }

    if (app.worldManager) {
        app.worldManager._loadWorldFlightBoards = (world) => loadWorldFlightBoards(app, world);
    }

    const current = app.worldManager?.getCurrentWorld?.();
    if (current) {
        await loadWorldFlightBoards(app, current);
    }

    const prev = app.worldManager?.onWorldChangeCallback;
    app.worldManager.onWorldChangeCallback = (world) => {
        if (typeof prev === 'function') prev(world);
        loadWorldFlightBoards(app, world).catch((e) => {
            console.warn('[matsuyama-flights] load boards failed', e);
        });
    };
}
