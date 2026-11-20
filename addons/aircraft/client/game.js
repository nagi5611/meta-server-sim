// addons/aircraft/client/game.js — テナントメタバース用飛行機サブシステム
import { registerClientInit, registerFrameUpdate } from './metaverse-registry-shim.js';
import { initAircraftSubsystem } from './init.js';

export async function initTenantPlugin() {
    globalThis.__tenantAircraftPluginLoaded = true;
}

registerClientInit(async (app) => {
    if (app._aircraftSubsystemReady) return;
    await initAircraftSubsystem(app);
    app._aircraftSubsystemReady = true;
});

registerFrameUpdate(
    (app, deltaTime) => {
        if (app.aircraftManager?.isPiloting) {
            app.syncMobileAircraftControls?.();
        } else if (app.aircraftManager && app.characterController) {
            const feet = app.characterController.getPosition?.();
            if (feet) {
                app.aircraftManager.updateProximity(feet);
            }
        }
    },
    { order: 20 }
);

console.info('[addon:aircraft] client registered');