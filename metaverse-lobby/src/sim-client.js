/**
 * @param {Record<string, unknown>} env
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [opts]
 */
export async function fetchSim(env, path, opts = {}) {
    const base = String(env.LOBBY_SIM_ORIGIN || '').trim().replace(/\/$/, '');
    const token = String(env.LOBBY_SIM_SERVICE_TOKEN || '').trim();
    if (!base || !token) {
        return { ok: false, status: 503, data: { error: 'sim_not_configured' } };
    }
    const method = opts.method || 'GET';
    const headers = {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
    };
    /** @type {RequestInit} */
    const init = { method, headers };
    if (opts.body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
    }
    try {
        const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(25_000) });
        const text = await res.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = { raw: text };
        }
        return { ok: res.ok, status: res.status, data };
    } catch (err) {
        return { ok: false, status: 502, data: { error: 'sim_unreachable', message: String(err?.message || err) } };
    }
}