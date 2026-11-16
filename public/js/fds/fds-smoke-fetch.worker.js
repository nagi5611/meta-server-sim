// public/js/fds/fds-smoke-fetch.worker.js — FDS 煙バイナリ fetch（メインスレッドと分離 + スロットル）

/** @type {number | null} */
let configuredBytesPerSecond = null;

/**
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {number} totalBytes
 * @param {number} maxBytesPerSecond
 * @returns {Promise<ArrayBuffer>}
 */
async function readThrottledBody(reader, totalBytes, maxBytesPerSecond) {
    const chunks = [];
    let received = 0;
    let carryDebtMs = 0;
    const t0 = performance.now();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) {
            chunks.push(value);
            received += value.byteLength;
            const elapsedMs = performance.now() - t0 + carryDebtMs;
            const minElapsedMs = (received / maxBytesPerSecond) * 1000;
            const waitMs = minElapsedMs - elapsedMs;
            if (waitMs > 1) {
                await new Promise((r) => setTimeout(r, waitMs));
                carryDebtMs += waitMs;
            }
        }
    }
    const out = new Uint8Array(received || totalBytes || 0);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
    }
    return out.buffer;
}

self.addEventListener('message', async (event) => {
    const data = event.data || {};
    const { type, id, url } = data;

    if (type === 'config') {
        const bps = Number(data.bytesPerSecond);
        configuredBytesPerSecond = Number.isFinite(bps) && bps > 0 ? bps : null;
        return;
    }

    if (type !== 'fetch' || !id || !url) {
        return;
    }

    const maxBps = Number(data.bytesPerSecond) || configuredBytesPerSecond || 0;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            self.postMessage({ id, ok: false, error: `HTTP ${response.status}` });
            return;
        }
        const len = Number(response.headers.get('content-length') || 0);
        let buffer;
        if (maxBps > 0 && response.body) {
            buffer = await readThrottledBody(response.body.getReader(), len, maxBps);
        } else {
            buffer = await response.arrayBuffer();
        }
        self.postMessage({ id, ok: true, buffer }, [buffer]);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'fetch failed';
        self.postMessage({ id, ok: false, error: message });
    }
});