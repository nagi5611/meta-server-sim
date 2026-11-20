// addons/matsuyama-flights/client/game.js — テナントプラグイン登録
import { registerClientInit } from './metaverse-registry-shim.js';
import { initMatsuyamaFlightsSubsystem } from './init.js';

export async function initTenantPlugin() {
    globalThis.__tenantMatsuyamaFlightsPluginLoaded = true;
}

registerClientInit(async (app) => {
    try {
        await initMatsuyamaFlightsSubsystem(app);
    } catch (e) {
        console.warn('[matsuyama-flights] init failed', e);
    }
});