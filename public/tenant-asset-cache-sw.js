// public/tenant-asset-cache-sw.js — GLB / FDS パート等の cache-first（同一オリジン tenant 配下）
'use strict';

const CACHE_NAME = 'tenant-glb-v3';

/**
 * @param {URL} url
 */
function isGlbCacheTarget(url) {
    if (url.origin !== self.location.origin) return false;
    const p = url.pathname.toLowerCase();
    if (!p.endsWith('.glb')) return false;
    return (
        p.includes('/models/') ||
        p.includes('/avatars/') ||
        p.includes('/images/') ||
        p.includes('/env/')
    );
}

/**
 * @param {URL} url
 */
function isFdsSimulationBinaryTarget(url) {
    if (url.origin !== self.location.origin) return false;
    const p = url.pathname.toLowerCase();
    if (!p.includes('/simulations/')) return false;
    return p.endsWith('.uint8.bin') || p.endsWith('.bin');
}

/**
 * @param {URL} url
 */
function isTenantAssetCacheTarget(url) {
    return isGlbCacheTarget(url) || isFdsSimulationBinaryTarget(url);
}

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys.filter((k) => k.startsWith('tenant-glb-') && k !== CACHE_NAME).map((k) => caches.delete(k)),
            );
            await self.clients.claim();
        })(),
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (!isTenantAssetCacheTarget(url)) return;

    event.respondWith(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(event.request);
            if (cached) return cached;

            const response = await fetch(event.request);
            if (response.ok && response.type === 'basic') {
                try {
                    await cache.put(event.request, response.clone());
                } catch {
                    /* quota */
                }
            }
            return response;
        })(),
    );
});

self.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'INVALIDATE' || !Array.isArray(data.urls)) return;
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            for (const raw of data.urls) {
                if (typeof raw !== 'string' || !raw) continue;
                try {
                    const abs = new URL(raw, self.location.origin).href;
                    await cache.delete(abs);
                    await cache.delete(raw);
                } catch {
                    await cache.delete(raw);
                }
            }
        })(),
    );
});