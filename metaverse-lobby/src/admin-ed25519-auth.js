/** Ed25519 第2要素（静的 admin 用） */

import {
    countActiveAdminEd25519Keys,
    listAdminEd25519Keys,
    touchAdminEd25519KeyLastUsed,
} from './db-ops.js';

export const ADMIN_KEY_CHALLENGE_PREFIX = 'admin_key_challenge:';
export const ADMIN_KEY_REGISTER_REAUTH_PREFIX = 'admin_key_register_reauth:';
export const ADMIN_KEY_MESSAGE_PREFIX = 'lobby-admin-key-v1:';
export const ADMIN_KEY_REGISTER_MESSAGE_PREFIX = 'lobby-admin-key-register-v1:';
export const ADMIN_KEY_TTL_SEC = 300;
export const ADMIN_KEY_MAX_ATTEMPTS = 5;

export const ADMIN_KEY_REGISTER_NOTIFY_EMAIL = 'developer@mmh-virtual.jp';

/**
 * @param {string} publicKeyB64
 * @returns {Uint8Array | null}
 */
export function parseEd25519PublicKeyBytes(publicKeyB64) {
    const b64 = String(publicKeyB64 || '').trim();
    if (!b64) return null;
    try {
        const bytes = Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
        if (bytes.length !== 32) return null;
        return bytes;
    } catch {
        return null;
    }
}

/**
 * @param {string} publicKeyB64
 * @returns {Promise<string>}
 */
export async function fingerprintEd25519PublicKeyB64(publicKeyB64) {
    const bytes = parseEd25519PublicKeyBytes(publicKeyB64);
    if (!bytes) return '';
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * @param {string} publicKeyB64
 * @returns {Promise<CryptoKey | null>}
 */
export async function importEd25519PublicKeyB64(publicKeyB64) {
    const bytes = parseEd25519PublicKeyBytes(publicKeyB64);
    if (!bytes) return null;
    try {
        return await crypto.subtle.importKey('raw', bytes, { name: 'Ed25519' }, false, ['verify']);
    } catch {
        return null;
    }
}

/**
 * @param {Record<string, unknown>} env
 * @returns {Promise<CryptoKey | null>}
 */
export async function importAdminEd25519PublicKey(env) {
    return importEd25519PublicKeyB64(String(env.ADMIN_ED25519_PUBLIC_KEY || ''));
}

/**
 * @param {Record<string, unknown>} env
 * @param {D1Database | undefined} db
 * @returns {Promise<boolean>}
 */
export async function isAdminKeyAuthEnabled(env, db) {
    if (String(env.ADMIN_ED25519_PUBLIC_KEY || '').trim()) return true;
    const count = await countActiveAdminEd25519Keys(db);
    return count > 0;
}

/**
 * @typedef {{ id: string, publicKeyB64: string, source: 'env' | 'd1' }} AdminVerifyKey
 */

/**
 * @param {Record<string, unknown>} env
 * @param {D1Database | undefined} db
 * @returns {Promise<AdminVerifyKey[]>}
 */
export async function listActiveAdminVerifyKeys(env, db) {
    /** @type {AdminVerifyKey[]} */
    const out = [];
    const envB64 = String(env.ADMIN_ED25519_PUBLIC_KEY || '').trim();
    if (envB64 && parseEd25519PublicKeyBytes(envB64)) {
        out.push({ id: 'env-bootstrap', publicKeyB64: envB64, source: 'env' });
    }
    const rows = await listAdminEd25519Keys(db, true);
    for (const row of rows) {
        if (parseEd25519PublicKeyBytes(row.publicKeyB64)) {
            out.push({ id: row.id, publicKeyB64: row.publicKeyB64, source: 'd1' });
        }
    }
    return out;
}

/**
 * @param {string} challengeId
 * @param {string} nonce
 * @returns {Uint8Array}
 */
export function buildAdminKeySignPayload(challengeId, nonce) {
    const msg = `${ADMIN_KEY_MESSAGE_PREFIX}${challengeId}:${nonce}`;
    return new TextEncoder().encode(msg);
}

/**
 * @param {string} challengeId
 * @param {string} nonce
 * @returns {Uint8Array}
 */
export function buildAdminKeyRegisterSignPayload(challengeId, nonce) {
    const msg = `${ADMIN_KEY_REGISTER_MESSAGE_PREFIX}${challengeId}:${nonce}`;
    return new TextEncoder().encode(msg);
}

/**
 * @param {CryptoKey} publicKey
 * @param {Uint8Array} payload
 * @param {string} signatureB64
 * @returns {Promise<boolean>}
 */
export async function verifyEd25519Signature(publicKey, payload, signatureB64) {
    const sigStr = String(signatureB64 || '').trim();
    if (!sigStr) return false;
    let sig;
    try {
        sig = Uint8Array.from(atob(sigStr.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    } catch {
        return false;
    }
    if (sig.length !== 64) return false;
    return crypto.subtle.verify({ name: 'Ed25519' }, publicKey, sig, payload);
}

/**
 * @param {CryptoKey} publicKey
 * @param {string} challengeId
 * @param {string} nonce
 * @param {string} signatureB64
 * @returns {Promise<boolean>}
 */
export async function verifyAdminKeySignature(publicKey, challengeId, nonce, signatureB64) {
    const payload = buildAdminKeySignPayload(challengeId, nonce);
    return verifyEd25519Signature(publicKey, payload, signatureB64);
}

/**
 * @param {Record<string, unknown>} env
 * @param {D1Database | undefined} db
 * @param {{ challengeId: string, nonce: string, signatureB64: string, register?: boolean }} input
 * @returns {Promise<{ ok: true, matchedId: string } | { ok: false }>}
 */
export async function verifyAdminKeyAgainstAnyActive(env, db, input) {
    const keys = await listActiveAdminVerifyKeys(env, db);
    const payload = input.register
        ? buildAdminKeyRegisterSignPayload(input.challengeId, input.nonce)
        : buildAdminKeySignPayload(input.challengeId, input.nonce);
    for (const key of keys) {
        const pub = await importEd25519PublicKeyB64(key.publicKeyB64);
        if (!pub) continue;
        const valid = await verifyEd25519Signature(pub, payload, input.signatureB64);
        if (valid) {
            if (key.source === 'd1' && db) {
                await touchAdminEd25519KeyLastUsed(db, key.id, new Date().toISOString());
            }
            return { ok: true, matchedId: key.id };
        }
    }
    return { ok: false };
}

/**
 * @returns {string}
 */
export function generateKeyChallengeNonce() {
    const buf = crypto.getRandomValues(new Uint8Array(32));
    let b64 = btoa(String.fromCharCode(...buf));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}