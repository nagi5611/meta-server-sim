// lib/hook-registry.js — tenant plugin hooks (single process)

/** @typedef {Record<string, unknown>} HookPayload */

/**
 * @typedef {object} HookHandlerEntry
 * @property {(payload: HookPayload) => void | Promise<void>} fn
 * @property {{ tenantId?: string, pluginId?: string, source?: string }} [meta]
 */

export class HookRegistry {
    constructor() {
        /** @type {Map<string, HookHandlerEntry[]>} */
        this._handlers = new Map();
    }

    /**
     * @param {string} name
     * @param {(payload: HookPayload) => void | Promise<void>} fn
     * @param {{ tenantId?: string, pluginId?: string, source?: string }} [meta]
     */
    on(name, fn, meta) {
        if (!this._handlers.has(name)) this._handlers.set(name, []);
        this._handlers.get(name).push({ fn, meta: meta || {} });
    }

    /**
     * @param {(entry: HookHandlerEntry) => boolean} predicate
     */
    removeMatching(predicate) {
        for (const [name, list] of this._handlers.entries()) {
            this._handlers.set(
                name,
                list.filter((entry) => !predicate(entry))
            );
        }
    }

    /**
     * @param {string} name
     * @param {HookPayload} payload
     */
    emitSync(name, payload) {
        const list = this._handlers.get(name);
        if (!list?.length) return;
        for (const { fn } of list) {
            try {
                fn(payload);
            } catch (e) {
                console.error(`[hooks] emitSync(${name}) error:`, e);
            }
        }
    }

    /**
     * @param {string} name
     * @param {HookPayload} payload
     */
    async emitAsync(name, payload) {
        const list = this._handlers.get(name);
        if (!list?.length) return;
        for (const { fn } of list) {
            try {
                await fn(payload);
            } catch (e) {
                console.error(`[hooks] emitAsync(${name}) error:`, e);
            }
        }
    }
}

/** @type {HookRegistry | null} */
let singleton = null;

export function getHookRegistry() {
    if (!singleton) singleton = new HookRegistry();
    return singleton;
}

/**
 * @param {string} tenantId
 */
export function clearTenantPluginHooks(tenantId) {
    const id = String(tenantId || '').trim();
    if (!id) return;
    getHookRegistry().removeMatching(
        (entry) => entry.meta?.source === 'tenant-plugin' && entry.meta?.tenantId === id
    );
}

/**
 * @param {import('./hook-registry.js').HookRegistry} rootHooks
 * @param {string} tenantId
 * @param {string} pluginId
 */
export function createTenantPluginHookScope(rootHooks, tenantId, pluginId) {
    return {
        on(name, fn) {
            rootHooks.on(name, fn, {
                tenantId,
                pluginId,
                source: 'tenant-plugin',
            });
        },
    };
}

/** Core + tenant plugin hook names */
export const HOOKS = Object.freeze({
    SERVER_TENANT_INIT: 'server:tenant:init',
    AFTER_TENANT_ROUTES_MOUNTED: 'server:tenant:routes_mounted',
    SOCKET_TENANT_CONNECT: 'socket:tenant:connect',
    SOCKET_TENANT_DISCONNECT: 'socket:tenant:disconnect',
    PLATFORM_ADMIN_SETUP: 'platform:admin:setup',
    SHUTDOWN: 'shutdown',
});
