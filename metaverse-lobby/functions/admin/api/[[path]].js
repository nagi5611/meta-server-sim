// Pages: /admin/api/* → Worker /api/admin/*
const WORKER_ORIGIN = 'https://metaverse-lobby.harumacci94.workers.dev';

/** @type {import('@cloudflare/workers-types').PagesFunction} */
export async function onRequest(context) {
    const req = context.request;
    const url = new URL(req.url);
    const suffix = url.pathname.replace(/^\/admin\/api/, '');
    const target = `${WORKER_ORIGIN}/api/admin${suffix}${url.search}`;
    const headers = new Headers(req.headers);
    headers.delete('host');
    const init = {
        method: req.method,
        headers,
        redirect: 'manual',
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        init.body = req.body;
    }
    const res = await fetch(target, init);
    return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
    });
}