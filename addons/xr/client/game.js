// addons/xr/client/game.js — tenant WebXR VR client module
import { registerClientInit, registerFrameUpdate } from './metaverse-registry-shim.js';

function ensureWebXrStyles() {
    if (document.querySelector('link[data-webxr-vr-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./webxr-vr.css', import.meta.url).href;
    link.dataset.webxrVrCss = '1';
    document.head.appendChild(link);
}
import { initWebXrVrSubsystem } from './init.js';
import { ThreeMeshUI } from './vr-quick-menu.js';
import { resolveTenantAddonsEnabledUrl } from './tenant-paths.js';

/** @type {boolean|null} */
let enabledCache = null;

/**
 * @returns {Promise<boolean>}
 */
async function isXrEnabled() {
    if (enabledCache !== null) return enabledCache;
    try {
        const res = await fetch(resolveTenantAddonsEnabledUrl(), { credentials: 'same-origin' });
        if (!res.ok) {
            enabledCache = false;
            return false;
        }
        const data = await res.json();
        if (data?.xr === true || data?.['webxr-vr'] === true) {
            enabledCache = true;
            return true;
        }
        if (Array.isArray(data.plugins)) {
            enabledCache = data.plugins.some((p) => p?.id === 'xr');
            return enabledCache;
        }
        enabledCache = false;
        return false;
    } catch (e) {
        console.warn('[addon:xr] enabled check failed, skipping XR init:', e);
        enabledCache = false;
        return false;
    }
}

export async function initTenantPlugin() {
    ensureWebXrStyles();
    window.__tenantXrPluginLoaded = true;
}

registerClientInit(async (app) => {
    const enabled = await isXrEnabled();
    if (!enabled) {
        console.info('[addon:xr] disabled or unavailable, skipping init');
        return;
    }
    initWebXrVrSubsystem(app);
});

registerFrameUpdate((app, deltaTime) => {
    if (app._webxrVrLocomotion) {
        app._webxrVrLocomotion.update(deltaTime);
    }
    if (app._webxrVrRig?.isAttached?.() && app.sceneManager?.getRenderer?.()?.xr?.isPresenting) {
        app._webxrVrRig.sync(app.characterController);
    }
}, { order: 10 });

registerFrameUpdate((app, deltaTime) => {
    if (app._vrQuickMenu && app.sceneManager?.getRenderer?.()?.xr?.isPresenting) {
        app._vrQuickMenu.update(deltaTime);
        ThreeMeshUI.update();
        app._vrQuickMenu.updateRaycast();
    }
}, { order: 15 });

console.info('[addon:xr] client registered');
