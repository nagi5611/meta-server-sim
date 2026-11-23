// lib/world-edit-mcp-admin-http.js — 管理 API（Basic + CSRF）HTTP クライアント

import { ADMIN_CSRF_HEADER } from './admin-csrf.js';

/**
 * @param {string | null | undefined} setCookieHeader
 * @param {Record<string, string>} jar
 */
function mergeSetCookie(setCookieHeader, jar) {
    if (!setCookieHeader) return;
    const parts = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const line of parts) {
        const seg = String(line).split(';')[0];
        const eq = seg.indexOf('=');
        if (eq <= 0) continue;
        const name = seg.slice(0, eq).trim();
        const value = seg.slice(eq + 1).trim();
        jar[name] = value;
    }
}

/**
 * @param {Record<string, string>} jar
 * @returns {string}
 */
function cookieHeader(jar) {
    return Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
}

/**
 * ワールド編集 MCP 向け Admin HTTP クライアント
 */
export class WorldEditAdminHttpClient {
    /**
     * @param {{ baseUrl: string, username: string, password: string, tenantId: string }} opts
     */
    constructor(opts) {
        this.baseUrl = opts.baseUrl.replace(/\/$/, '');
        this.username = opts.username;
        this.password = opts.password;
        this.tenantId = opts.tenantId;
        /** @type {Record<string, string>} */
        this.cookies = {};
        this.csrfToken = '';
        this.basic = Buffer.from(`${this.username}:${this.password}`, 'utf8').toString('base64');
    }

    tenantPath(suffix) {
        const s = suffix.startsWith('/') ? suffix : `/${suffix}`;
        return `/admin/tenants/${encodeURIComponent(this.tenantId)}${s}`;
    }

    /**
     * @param {string} method
     * @param {string} path
     * @param {{ json?: unknown, body?: import('node:stream').Readable | Buffer | string, headers?: Record<string, string>, skipCsrf?: boolean }} [opts]
     */
    async request(method, path, opts = {}) {
        const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
        /** @type {Record<string, string>} */
        const headers = {
            Authorization: `Basic ${this.basic}`,
            ...(opts.headers || {}),
        };
        const cookie = cookieHeader(this.cookies);
        if (cookie) headers.Cookie = cookie;

        const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
        if (mutating && !opts.skipCsrf) {
            if (!this.csrfToken) await this.refreshCsrf();
            headers[ADMIN_CSRF_HEADER] = this.csrfToken;
        }

        let body = opts.body;
        if (opts.json !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(opts.json);
        }

        const res = await fetch(url, { method, headers, body });
        mergeSetCookie(res.headers.getSetCookie?.() ?? res.headers.get('set-cookie'), this.cookies);

        const text = await res.text();
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }
        }
        return { ok: res.ok, status: res.status, data, raw: text };
    }

    async refreshCsrf() {
        const res = await this.request('GET', '/admin/csrf-token', { skipCsrf: true });
        if (!res.ok) {
            throw new Error(`CSRF token fetch failed: HTTP ${res.status} ${res.raw}`);
        }
        const token = res.data?.token;
        if (typeof token !== 'string' || !token) {
            throw new Error('CSRF response missing token');
        }
        this.csrfToken = token;
        return token;
    }

    async getWorlds() {
        const res = await this.request('GET', this.tenantPath('/worlds'), { skipCsrf: true });
        if (!res.ok) throw new Error(`GET worlds failed: ${res.status} ${res.raw}`);
        return res.data;
    }

    /**
     * @param {Record<string, unknown>} worlds
     */
    async saveWorlds(worlds) {
        const res = await this.request('POST', this.tenantPath('/worlds'), { json: worlds });
        if (!res.ok) throw new Error(`POST worlds failed: ${res.status} ${res.raw}`);
        return res.data;
    }

    /**
     * @param {string} worldId
     * @param {Record<string, unknown>} patch
     */
    async patchWorld(worldId, patch) {
        const res = await this.request('POST', this.tenantPath('/worlds/patch'), {
            json: { worldId, patch },
        });
        if (!res.ok) throw new Error(`POST worlds/patch failed: ${res.status} ${res.raw}`);
        return res.data;
    }

    async listModels() {
        const res = await this.request('GET', this.tenantPath('/models'), { skipCsrf: true });
        if (!res.ok) throw new Error(`GET models failed: ${res.status}`);
        return res.data;
    }

    /**
     * @param {Buffer} buffer
     * @param {string} filename
     * @param {{ confirm?: boolean }} [opts]
     */
    async uploadModel(buffer, filename, opts = {}) {
        const form = new FormData();
        form.append('model', new Blob([buffer]), filename);
        const q = opts.confirm ? '?confirm=1' : '';
        const url = `${this.baseUrl}${this.tenantPath(`/upload${q}`)}`;
        if (!this.csrfToken) await this.refreshCsrf();
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${this.basic}`,
                Cookie: cookieHeader(this.cookies),
                [ADMIN_CSRF_HEADER]: this.csrfToken,
            },
            body: form,
        });
        mergeSetCookie(res.headers.getSetCookie?.() ?? res.headers.get('set-cookie'), this.cookies);
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error(`POST upload failed: ${res.status} ${text}`);
        return data;
    }

    /**
     * @param {string} airframeId
     */
    async getAirframe(airframeId) {
        const res = await this.request('GET', this.tenantPath(`/addons/aircraft/airframes/${encodeURIComponent(airframeId)}`), {
            skipCsrf: true,
        });
        if (!res.ok) throw new Error(`GET airframe failed: ${res.status}`);
        return res.data;
    }

    async listAirframes() {
        const res = await this.request('GET', this.tenantPath('/addons/aircraft/airframes'), { skipCsrf: true });
        if (!res.ok) throw new Error(`GET airframes failed: ${res.status}`);
        return res.data;
    }

    /**
     * @param {string} airframeId
     * @param {Record<string, unknown>} body
     */
    async putAirframe(airframeId, body) {
        const res = await this.request('PUT', this.tenantPath(`/addons/aircraft/airframes/${encodeURIComponent(airframeId)}`), {
            json: body,
        });
        if (!res.ok) throw new Error(`PUT airframe failed: ${res.status} ${res.raw}`);
        return res.data;
    }
}