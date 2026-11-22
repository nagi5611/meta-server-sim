/** @type {import('@cloudflare/workers-types').PagesFunction} */
export async function onRequest(context) {
    const { request, env } = context;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405 });
    }
    const assetReq = new URL('/share-join.html', request.url);
    const asset = env.ASSETS ? await env.ASSETS.fetch(assetReq) : await fetch(assetReq);
    if (!asset.ok) {
        return asset;
    }
  const headers = new Headers(asset.headers);
    headers.set('cache-control', 'no-store');
  return new Response(request.method === 'HEAD' ? null : asset.body, { status: asset.status, headers });
}