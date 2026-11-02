// lib/hook-registry.js — tenant plugin hooks (single process)

/** @typedef {Record<string, unknown>} HookPayload */

export class HookRegistry {
    constructor() {
        /** @type {Map<string, Array<(p: HookPayload) => void | Promise<void>>>} */
        this._handlers = new Map();
    }

    /**
     * @param {string} name
     * @param {(payload: HookPayload) => void | Promise<void>} fn
     */
    on(name, fn) {
        if (!this._handlers.has(name)) this._handlers.set(name, []);
        this._handlers.get(name).push(fn);
    }

    /**
     * @param {string} name
     * @param {HookPayload} payload
     */
    emitSync(name, payload) {
        const list = this._handlers.get(name);
        if (!list?.length) return;
        for (const fn of list) {
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
        for (const fn of list) {
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

/** Core + tenant plugin hook names */
export const HOOKS = Object.freeze({
    SERVER_TENANT_INIT: 'server:tenant:init',
    AFTER_TENANT_ROUTES_MOUNTED: 'server:tenant:routes_mounted',
    SOCKET_TENANT_CONNECT: 'socket:tenant:connect',
    SOCKET_TENANT_DISCONNECT: 'socket:tenant:disconnect',
    SHUTDOWN: 'shutdown',
});
