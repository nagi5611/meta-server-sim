// addons/aircraft/client/init.js — MetaverseApp へのエアークラフト結線（main から呼び出し）

import AircraftController from './aircraft-controller.js';
import AircraftManager from './aircraft-manager.js';
import { ensureAircraftSlotVisuals } from './aircraft-slot-visual.js';
import { viewpointIndexFromLegacyMode } from '/metaverse-simple-static/js/aircraft/camera-viewpoints.js';
import { resolveSlotCameraViewpoints } from './camera-viewpoint-runtime.js';

/** @type {Promise<{ MobileAircraftControls: object, MobileJoystickManager: object }> | null} */
let mobileModulesPromise = null;

/**
 * モバイル操縦 UI（nipplejs）— デスクトップでは読み込まない
 * @returns {Promise<{ MobileAircraftControls: object, MobileJoystickManager: object }>}
 */
async function loadMobileAircraftModules() {
    if (!mobileModulesPromise) {
        mobileModulesPromise = Promise.all([
            import('/metaverse-simple-static/js/mobile-aircraft-controls.js'),
            import('/metaverse-simple-static/js/mobile-joystick-manager.js'),
        ]).then(([controlsMod, joystickMod]) => ({
            MobileAircraftControls: controlsMod.default,
            MobileJoystickManager: joystickMod.default,
        }));
    }
    return mobileModulesPromise;
}

/**
 * テナント URL 上で SceneManager のライブラリ fetch を /{tenant}/api/addons/aircraft に向ける
 * @param {object} sceneManager
 */
function ensureTenantAircraftLibraryHydrate(sceneManager) {
    if (!sceneManager || sceneManager._tenantAircraftHydratePatched) return;
    sceneManager._tenantAircraftHydratePatched = true;
    const original = sceneManager.hydrateAircraftSlotsFromLibrary.bind(sceneManager);
    sceneManager.hydrateAircraftSlotsFromLibrary = async () => {
        const parts = String(globalThis.location?.pathname || '').split('/').filter(Boolean);
        const tenantId = parts[0];
        const base =
            tenantId && tenantId !== 'admin' && tenantId !== 'api'
                ? `/${encodeURIComponent(tenantId)}/api/addons/aircraft`
                : '/api/addons/aircraft';
        const nativeFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = (input, init) => {
            const url = typeof input === 'string' ? input : input?.url;
            if (typeof url === 'string' && url.startsWith('/api/addons/aircraft/')) {
                const next = base + url.slice('/api/addons/aircraft'.length);
                return nativeFetch(next, init);
            }
            return nativeFetch(input, init);
        };
        try {
            await original();
        } finally {
            globalThis.fetch = nativeFetch;
        }
    };
}

/**
 * エアークラフトのコントローラ・マネージャを生成し UI / ネットワークと結線する。
 * @param {object} app MetaverseApp インスタンス（init 内で this）
 * @returns {Promise<void>}
 */
export async function initAircraftSubsystem(app) {
    ensureTenantAircraftLibraryHydrate(app.sceneManager);
    app.aircraftController = new AircraftController(
        app.sceneManager.getCamera(),
        app.physicsManager
    );
    const initialWorldForAircraft = app.worldManager.getCurrentWorld();
    if (initialWorldForAircraft) {
        app.aircraftController.applyWorldPhysics(initialWorldForAircraft.aircraftPhysics);
    }
    app.aircraftManager = new AircraftManager(
        app.sceneManager,
        app.aircraftController,
        app.characterController,
        app.networkManager,
        app.uiManager
    );
    app.aircraftManager.setMobileMode(app.isMobileMode);
    app.aircraftManager.minimap.bindSceneManager(app.sceneManager);
    app.aircraftManager.setWorldIdProvider(() => app.worldManager?.getCurrentWorldId?.() || null);
    app.worldManager?.onWorldChange?.((world) => {
        if (app.aircraftManager?.isPiloting) {
            void app.aircraftManager.loadFlightMapForWorld(world?.id);
        }
        void app.sceneManager?.hydrateAircraftSlotsFromLibrary?.().then(() => {
            app.aircraftManager?.refreshSlotsFromScene?.();
            ensureAircraftSlotVisuals(app.sceneManager);
        });
    });
    try {
        await app.sceneManager.hydrateAircraftSlotsFromLibrary();
    } catch (e) {
        console.warn('[Aircraft] hydrateAircraftSlotsFromLibrary failed', e);
    }
    app.aircraftManager.refreshSlotsFromScene();
    ensureAircraftSlotVisuals(app.sceneManager);

    const tryBoardFromUi = () => app.aircraftManager?.tryBoardNearest();
    app.uiManager.setAircraftBoardHandler(() => {
        void tryBoardFromUi();
    });
    app.teleportManager.setAircraftBoardHandler(async () => {
        if (app.characterController.isInputActive()) return false;
        if (!app.aircraftManager?.nearestSlot || !app.aircraftManager.canBoard()) return false;
        return app.aircraftManager.tryBoardNearest();
    });
    app.uiManager.setAircraftHudHandlers({
        onExit: () => {
            if (app.aircraftManager?.isPassenger) {
                app.aircraftManager.exitPassenger();
                return;
            }
            void app.aircraftManager.exitPiloting();
        },
        onToggleCamera: () => app.aircraftManager.toggleCameraMode()
    });

    if (!app._aircraftScenarioRunner) {
        import('./aircraft-scenario-runner.js').then((mod) => {
            app._aircraftScenarioRunner = new mod.default(app);
        }).catch((err) => {
            console.warn('[addon:aircraft] scenario runner load failed', err);
        });
    }
    app.runAircraftScenario = async (rawScenario) => {
        if (!app._aircraftScenarioRunner) {
            const mod = await import('./aircraft-scenario-runner.js');
            app._aircraftScenarioRunner = new mod.default(app);
        }
        return app._aircraftScenarioRunner.run(rawScenario);
    };
    app.getAircraftDebugState = () => {
        const mgr = app.aircraftManager;
        const ctrl = app.aircraftController?._active;
        const root = mgr?.activeSlot?.root;
        if (!root) {
            return { piloting: Boolean(mgr?.isPiloting), slotId: mgr?.activeSlot?.id ?? null };
        }
        root.updateMatrixWorld(true);
        const THREE = globalThis.__metaverseSharedThree;
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler(0, 0, 0, 'YXZ');
        root.getWorldPosition(p);
        root.getWorldQuaternion(q);
        e.setFromQuaternion(q);
        const vel = ctrl?.velocity;
        return {
            piloting: Boolean(mgr?.isPiloting),
            slotId: mgr?.activeSlot?.id ?? null,
            controlMode: mgr?.activeSlot?.controlMode ?? null,
            position: { x: p.x, y: p.y, z: p.z },
            quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
            headingDeg: (e.y * 180) / Math.PI,
            velocity: vel
                ? { x: vel.x, y: vel.y, z: vel.z }
                : null,
        };
    };

    app.networkManager.setAircraftNetworkBridge({
        getPose: () => app.aircraftManager.getAircraftPoseForNetwork(),
        getPilotCameraWorldPose: () =>
            app.aircraftManager?.isPiloting && app.aircraftController
                ? app.aircraftController.getNetworkCameraPose()
                : null,
        getPassengeringAircraftId: () => {
            const m = app.aircraftManager;
            if (!m?.isPassenger || !m.passengerSlot?.id) return null;
            return String(m.passengerSlot.id);
        },
        onSnapshot: (list) => app.aircraftManager.applyNetworkAircraftSnapshot(
            list,
            app.networkManager.myPlayerId
        ),
        onReleased: (slotId) => app.aircraftManager.onAircraftReleased(slotId)
    });

    /**
     * Easy 操縦中のモバイル UI と歩行ジョイスティックの切り替え
     */
    app.syncMobileAircraftControls = () => {
        if (!app.aircraftManager) return;
        const mgr = app.aircraftManager;

        if (!app.isMobileMode) {
            return;
        }

        void (async () => {
            let MobileAircraftControls;
            let MobileJoystickManager;
            try {
                ({ MobileAircraftControls, MobileJoystickManager } = await loadMobileAircraftModules());
            } catch (e) {
                console.warn('[Aircraft] mobile controls unavailable', e);
                return;
            }

            const isEasyPilot = mgr.isPiloting && mgr.activeSlot?.controlMode === 'easy';

            if (isEasyPilot) {
                MobileJoystickManager.destroy();
                MobileAircraftControls.show();
                MobileAircraftControls.init(app.aircraftController);
                return;
            }

            MobileAircraftControls.hide();
            MobileAircraftControls.destroy();
            if (!mgr.isPiloting && !mgr.isPassenger) {
                MobileJoystickManager.init(app.characterController);
            }
        })();
    };
}
