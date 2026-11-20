// Bridge to metaverse-simple client addon registry (set by tenant-plugin-client-loader.js)
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

export function getMovementDelegate() {
    return bridge().getMovementDelegate?.();
}