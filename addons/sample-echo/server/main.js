// addons/sample-echo/server/main.js
import { HOOKS } from '../../../lib/hook-registry.js';

export default {
    /**
     * @param {import('../../../lib/tenant-plugin-loader.js').PluginRegisterContext} ctx
     */
    async register(ctx) {
        ctx.logger.info('register', ctx.config);

        ctx.mountHttp((router) => {
            router.get('/hello', (_req, res) => {
                const greeting =
                    typeof ctx.config.greeting === 'string'
                        ? ctx.config.greeting
                        : 'hello';
                res.json({ ok: true, pluginId: ctx.pluginId, greeting });
            });
        });

        ctx.hooks.on(HOOKS.SOCKET_TENANT_CONNECT, (payload) => {
            if (payload.tenantId !== ctx.tenantId) return;
            const socket = payload.socket;
            if (socket?.emit) {
                socket.emit('tenant-plugin:sample-echo', { greeting: ctx.config.greeting || 'hello' });
            }
        });
    },
};
