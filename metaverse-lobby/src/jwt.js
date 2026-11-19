const te = new TextEncoder();

/**
 * @param {string} secret
 */
async function importKey(secret) {
    return crypto.subtle.importKey(
        'raw',
        te.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
    );
}

function b64url(bytes) {
    const bin = String.fromCharCode(...new Uint8Array(bytes));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
    const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : '';
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} secret
 * @param {number} [ttlSec]
 */
export async function signJwt(payload, secret, ttlSec = 86400) {
    if (!secret) throw new Error('jwt secret missing');
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const body = { ...payload, iat: now, exp: now + ttlSec };
    const h = b64url(te.encode(JSON.stringify(header)));
    const p = b64url(te.encode(JSON.stringify(body)));
    const data = `${h}.${p}`;
    const key = await importKey(secret);
    const sig = await crypto.subtle.sign('HMAC', key, te.encode(data));
    return `${data}.${b64url(sig)}`;
}

/**
 * @param {string} token
 * @param {string} secret
 */
export async function verifyJwt(token, secret) {
    if (!token || !secret) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const data = `${h}.${p}`;
    const key = await importKey(secret);
    const sig = b64urlDecode(s);
    const ok = await crypto.subtle.verify('HMAC', key, sig, te.encode(data));
    if (!ok) return null;
    try {
        const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) return null;
        return payload;
    } catch {
        return null;
    }
}

/**
 * @param {Request} request
 * @param {string} cookieName
 */
export function readCookie(request, cookieName) {
    const raw = request.headers.get('cookie') || '';
    for (const part of raw.split(';')) {
        const [k, ...rest] = part.trim().split('=');
        if (k === cookieName) return decodeURIComponent(rest.join('='));
    }
    return null;
}

/**
 * @param {string} name
 * @param {string} value
 * @param {number} maxAgeSec
 * @param {string} [path]
 */
export function setCookieHeader(name, value, maxAgeSec, path = '/') {
    return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}