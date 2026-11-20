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