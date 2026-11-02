// Re-exports metaverse-simple client addon registry (bridge set by tenant-plugin-client-loader.js)
const bridge = () => {
    const b = globalThis.__tenantPluginClientBridge;
    if (!b) {
        throw new Error('tenant plugin client bridge not initialized');
    }
    return b;
};

export function registerClientInit(fn) {
    return bridge().registerClientInit(fn);
}

export function registerFrameUpdate(fn, opts) {
    return bridge().registerFrameUpdate(fn, opts);
}

export function registerMovementDelegate(delegate) {
    return bridge().registerMovementDelegate(delegate);
}

export function registerInputGuard(fn) {
    return bridge().registerInputGuard(fn);
}

export function registerImmersiveStateProvider(fn) {
    return bridge().registerImmersiveStateProvider(fn);
}

export function registerGraphicsTierOverride(fn) {
    return bridge().registerGraphicsTierOverride(fn);
}

export function registerPixelRatioOverride(fn) {
    return bridge().registerPixelRatioOverride(fn);
}
