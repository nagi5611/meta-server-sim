/** @typedef {import('@cloudflare/workers-types').R2Bucket} R2Bucket */

export const PROFILE_AVATAR_MAX_BYTES = 256 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT_BY_TYPE = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

/** @param {string} userRef */
export function profileAvatarFilename(userRef, contentType) {
    const ref = String(userRef || '').trim();
    if (!/^(student|teacher)-\d+$/.test(ref)) return null;
    const ext = EXT_BY_TYPE[String(contentType || '').toLowerCase()] || 'webp';
    return `${ref}.${ext}`;
}

export const SAFE_PROFILE_AVATAR_NAME = /^(student|teacher)-\d+\.(jpe?g|png|webp)$/i;

/**
 * @param {Request} request
 * @param {string} filename
 */
export function publicProfileAvatarUrl(request, filename) {
    const base = String(new URL(request.url).origin || '').replace(/\/$/, '');
    return `${base}/api/assets/profile-avatars/${filename}`;
}

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
    });
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {string} userRef
 */
export async function handleProfileAvatarUpload(request, env, userRef) {
    if (request.method !== 'POST') return null;
    const url = new URL(request.url);
    if (url.pathname !== '/api/auth/profile/avatar') return null;

    const bucket = /** @type {R2Bucket | undefined} */ (env.LOBBY_ASSETS);
    if (!bucket) {
        return json({ error: 'assets_not_configured', message: 'LOBBY_ASSETS R2 binding is required' }, 503);
    }

    const contentLength = request.headers.get('content-length');
    if (contentLength) {
        const n = Number(contentLength);
        if (Number.isFinite(n) && n > PROFILE_AVATAR_MAX_BYTES + 32 * 1024) {
            return json({ error: 'file_too_large', maxBytes: PROFILE_AVATAR_MAX_BYTES }, 413);
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
    if (size > PROFILE_AVATAR_MAX_BYTES) {
        return json({ error: 'file_too_large', maxBytes: PROFILE_AVATAR_MAX_BYTES }, 413);
    }

    const filename = profileAvatarFilename(userRef, type);
    if (!filename) return json({ error: 'invalid_user_ref' }, 400);

    const key = `profile-avatars/${filename}`;
    const body = await file.arrayBuffer();

    await bucket.put(key, body, {
        httpMetadata: { contentType: type, cacheControl: 'public, max-age=3600' },
    });

    const urlOut = publicProfileAvatarUrl(request, filename);
    return json({ ok: true, avatarUrl: urlOut, filename, contentType: type, bytes: size });
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 */
export async function handleProfileAvatarGet(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/assets\/profile-avatars\/([^/]+)$/);
    if (!match) return null;

    const filename = decodeURIComponent(match[1]);
    if (!SAFE_PROFILE_AVATAR_NAME.test(filename)) {
        return new Response('Not Found', { status: 404 });
    }

    const bucket = /** @type {R2Bucket | undefined} */ (env.LOBBY_ASSETS);
    if (!bucket) {
        return new Response('Not Found', { status: 404 });
    }

    const key = `profile-avatars/${filename}`;
    const obj = await bucket.get(key);
    if (!obj) {
        return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('cache-control', headers.get('cache-control') || 'public, max-age=3600');

    if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers });
    }
    return new Response(obj.body, { status: 200, headers });
}