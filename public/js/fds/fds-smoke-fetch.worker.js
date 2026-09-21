// public/js/fds/fds-smoke-fetch.worker.js — FDS 煙バイナリ fetch（メインスレッドと分離）

self.addEventListener('message', async (event) => {
    const { type, id, url } = event.data || {};
    if (type !== 'fetch' || !id || !url) {
        return;
    }

    try {
        const response = await fetch(url);
        if (!response.ok) {
            self.postMessage({ id, ok: false, error: `HTTP ${response.status}` });
            return;
        }
        const buffer = await response.arrayBuffer();
        self.postMessage({ id, ok: true, buffer }, [buffer]);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'fetch failed';
        self.postMessage({ id, ok: false, error: message });
    }
});
