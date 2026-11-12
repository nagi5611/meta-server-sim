// public/js/prefab-glb-fetch-worker.js — Prefab GLB fetch（テナント相対 path を同一オリジン絶対 URL に）
'use strict';

/**
 * @param {string} url
 * @returns {string}
 */
function toAbsoluteFetchUrl(url) {
    const raw = String(url || '');
    if (!raw || raw.startsWith('http://') || raw.startsWith('https://')) {
        return raw;
    }
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    try {
        return new URL(path, self.location.origin).href;
    } catch {
        return raw;
    }
}

self.onmessage = async (event) => {
    const data = event.data;
    if (!data || typeof data.jobId !== 'number' || typeof data.url !== 'string') {
        return;
    }
    const { jobId, credentials } = data;
    const url = toAbsoluteFetchUrl(data.url);
    try {
        const res = await fetch(url, { credentials: credentials || 'omit' });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const buffer = await res.arrayBuffer();
        self.postMessage({ jobId, ok: true, buffer }, [buffer]);
    } catch (err) {
        const message = err && err.message ? String(err.message) : String(err);
        self.postMessage({ jobId, ok: false, error: message });
    }
};
