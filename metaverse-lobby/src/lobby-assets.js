/** @typedef {import('@cloudflare/workers-types').R2Bucket} R2Bucket */

export const THUMBNAIL_MAX_BYTES = 10 * 1024 * 1024;
const MAX_BYTES = THUMBNAIL_MAX_BYTES;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT_BY_TYPE = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

const SAFE_THUMB_NAME = /^[a-f0-9-]+\.(jpe?g|png|webp|gif)$/i;

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
    });
}

/**
 * @param {Request} request
 */
export function publicAssetUrl(request, filename) {
    const base = String(new URL(request.url).origin || '').replace(/\/$/, '');
    return `${base}/api/assets/thumbnails/${filename}`;
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 */
export async function handleThumbnailUpload(request, env) {
    if (request.method !== 'POST') return null;
    const url = new URL(request.url);
    if (url.pathname !== '/api/admin/upload/thumbnail') return null;

    const bucket = /** @type {R2Bucket | undefined} */ (env.LOBBY_ASSETS);
    if (!bucket) {
        return json({ error: 'assets_not_configured', message: 'LOBBY_ASSETS R2 binding is required' }, 503);
    }

    const contentLength = request.headers.get('content-length');
    if (contentLength) {
        const n = Number(contentLength);
        // Allow small multipart framing overhead above the file cap.
        if (Number.isFinite(n) && n > MAX_BYTES + 64 * 1024) {
            return json({ error: 'file_too_large', maxBytes: MAX_BYTES }, 413);
        }
    }

    let form;
    try {
        form = await request.formData();
    } catch {
        return json({ error: 'invalid_form' }, 400);
    }
    const raw = form.get('file');
    if (!raw || typeof raw === 'string') {
        return json({ error: 'file_required' }, 400);
    }
    /** @type {File} */
    const file = raw;
    const type = String(file.type || '').toLowerCase();
    if (!ALLOWED_TYPES.has(type)) {
        return json({ error: 'invalid_type', allowed: [...ALLOWED_TYPES] }, 400);
    }
    const size = Number(file.size) || 0;
    if (size <= 0) return json({ error: 'empty_file' }, 400);
    if (size > MAX_BYTES) {
        return json({ error: 'file_too_large', maxBytes: MAX_BYTES }, 413);
    }

    const ext = EXT_BY_TYPE[type] || 'bin';
    const id = crypto.randomUUID();
    const key = `thumbnails/${id}.${ext}`;
    const body = await file.arrayBuffer();

    await bucket.put(key, body, {
        httpMetadata: { contentType: type, cacheControl: 'public, max-age=86400' },
    });

    const filename = `${id}.${ext}`;
    const urlOut = publicAssetUrl(request, filename);
    return json({ ok: true, url: urlOut, key, contentType: type, bytes: size });
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 */
export async function handleAssetGet(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/assets\/thumbnails\/([^/]+)$/);
    if (!match) return null;

    const filename = decodeURIComponent(match[1]);
    if (!SAFE_THUMB_NAME.test(filename)) {
        return new Response('Not Found', { status: 404 });
    }

    const bucket = /** @type {R2Bucket | undefined} */ (env.LOBBY_ASSETS);
    if (!bucket) {
        return new Response('Not Found', { status: 404 });
    }

    const key = `thumbnails/${filename}`;
    const obj = await bucket.get(key);
    if (!obj) {
        return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('cache-control', headers.get('cache-control') || 'public, max-age=86400');

    if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers });
    }
    return new Response(obj.body, { status: 200, headers });
}