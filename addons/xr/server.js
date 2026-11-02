// addons/xr/server.js — WebXR VR (ported from meta webxr-vr)
import { HOOKS } from '../../lib/hook-registry.js';

/** @param {import('../../lib/tenant-plugin-loader.js').PluginRegisterContext} ctx */
async function register(ctx) {
    ctx.logger.info('xr (webxr-vr) tenant plugin registered');

    ctx.hooks.on(HOOKS.SOCKET_TENANT_CONNECT, (payload) => {
        if (payload.tenantId !== ctx.tenantId) return;
        ctx.logger.info('socket connect (xr active for tenant)');
    });
}

export default { register };
