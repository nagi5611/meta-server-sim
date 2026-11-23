import { isLobbySuperAdmin } from './lobby-super-admin.js';
import {
    countActiveAdminEd25519Keys,
    deleteRevokedAdminEd25519Key,
    disableAdminEd25519Key,
    insertAdminEd25519Key,
    listAdminEd25519Keys,
} from './db-ops.js';
import {
    ADMIN_KEY_REGISTER_MESSAGE_PREFIX,
    ADMIN_KEY_REGISTER_REAUTH_PREFIX,
    ADMIN_KEY_REGISTER_NOTIFY_EMAIL,
    ADMIN_KEY_TTL_SEC,
    fingerprintEd25519PublicKeyB64,
    generateKeyChallengeNonce,
    listActiveAdminVerifyKeys,
    parseEd25519PublicKeyBytes,
    verifyAdminKeyAgainstAnyActive,
} from './admin-ed25519-auth.js';
import { getRequestClientIp, sendAdminOtpEmail, formatJstTimestamp } from './admin-super-login.js';

/**
 * @param {Record<string, unknown>} env
 * @param {string} sessionSub
 * @returns {boolean}
 */
function isStaticAdminOperator(env, sessionSub) {
    const staticUser = String(env.LOBBY_ADMIN_USER || 'admin').trim() || 'admin';
    return String(sessionSub || '').trim() === staticUser;
}

/**
 * @param {{ status: number, body: Record<string, unknown> }} result
 */
function jsonResult(result) {
    return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
}

/**
 * @param {Record<string, unknown>} env
 * @param {{ to: string, name: string, fingerprint: string, atJst: string, clientIp: string, ua: string, activeCount: number }} row
 */
async function sendAdminKeyRegisteredNotification(env, row) {
    const fpShort = row.fingerprint.slice(0, 16);
    const subject = '【みんなでメタ】管理者 Ed25519 公開鍵が登録されました';
    const text = [
        'スーパー管理者の Ed25519 公開鍵が新規登録されました。',
        '',
        `鍵名: ${row.name}`,
        `フィンガープリント (SHA-256): ${row.fingerprint}`,
        `表示用: ${fpShort}…`,
        `登録日時 (JST): ${row.atJst}`,
        `登録元 IP: ${row.clientIp}`,
        `User-Agent: ${row.ua}`,
        `有効な登録鍵の本数: ${row.activeCount}`,
        '',
        '心当たりがない場合は、直ちに鍵の無効化とパスワードの見直しを行ってください。',
    ].join('\n');
    const html = `<p>スーパー管理者の Ed25519 公開鍵が新規登録されました。</p>
<ul>
<li>鍵名: ${escapeHtml(row.name)}</li>
<li>フィンガープリント (SHA-256): <code>${escapeHtml(row.fingerprint)}</code></li>
<li>登録日時 (JST): ${escapeHtml(row.atJst)}</li>
<li>登録元 IP: ${escapeHtml(row.clientIp)}</li>
<li>User-Agent: ${escapeHtml(row.ua)}</li>
<li>有効な登録鍵の本数: ${row.activeCount}</li>
</ul>
<p>心当たりがない場合は、直ちに鍵の無効化とパスワードの見直しを行ってください。</p>`;
    return sendAdminOtpEmail(env, {
        to: row.to,
        subject,
        html,
        text,
    });
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {KVNamespace} kv
 * @param {Record<string, unknown> | null} session
 */
export async function handleAdminKeysApi(request, env, kv, session) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/admin/admin-keys')) return null;

    if (!isLobbySuperAdmin(session) || !isStaticAdminOperator(env, String(session?.sub || ''))) {
        return jsonResult({ status: 403, body: { error: 'super_admin_operator_required' } });
    }

    const db = /** @type {D1Database | undefined} */ (env.LOBBY_DB);
    const clientIp = getRequestClientIp(request);
    const ua = String(request.headers.get('user-agent') || '').slice(0, 500);

    if (url.pathname === '/api/admin/admin-keys/reauth-challenge' && request.method === 'POST') {
        const verifyKeys = await listActiveAdminVerifyKeys(env, db);
        if (!verifyKeys.length) {
            return jsonResult({ status: 503, body: { error: 'admin_key_not_configured' } });
        }
        const challengeId = crypto.randomUUID();
        const nonce = generateKeyChallengeNonce();
        await kv.put(
            `${ADMIN_KEY_REGISTER_REAUTH_PREFIX}${challengeId}`,
            JSON.stringify({ nonce, sub: session?.sub, attempts: 0 }),
            { expirationTtl: ADMIN_KEY_TTL_SEC },
        );
        return jsonResult({
            status: 200,
            body: {
                ok: true,
                challengeId,
                nonce,
                signMessagePrefix: ADMIN_KEY_REGISTER_MESSAGE_PREFIX,
            },
        });
    }

    if (url.pathname === '/api/admin/admin-keys' && request.method === 'GET') {
        const rows = await listAdminEd25519Keys(db, false);
        const envBootstrap = String(env.ADMIN_ED25519_PUBLIC_KEY || '').trim();
        /** @type {Array<Record<string, unknown>>} */
        const keys = [...rows];
        if (envBootstrap) {
            const fp = await fingerprintEd25519PublicKeyB64(envBootstrap);
            keys.unshift({
                id: 'env-bootstrap',
                name: '(環境変数 bootstrap)',
                publicKeyB64: envBootstrap,
                fingerprint: fp,
                createdAt: null,
                lastUsedAt: null,
                disabledAt: null,
                source: 'env',
                revocable: false,
            });
        }
        const activeDb = await countActiveAdminEd25519Keys(db);
        const bootstrapActive = envBootstrap ? 1 : 0;
        return jsonResult({
            status: 200,
            body: {
                ok: true,
                keys: keys.map((k) => ({
                    id: k.id,
                    name: k.name,
                    fingerprint: k.fingerprint,
                    fingerprintShort: String(k.fingerprint || '').slice(0, 16),
                    createdAt: k.createdAt,
                    lastUsedAt: k.lastUsedAt,
                    disabledAt: k.disabledAt,
                    source: k.source || 'd1',
                    revocable: k.revocable !== false && k.id !== 'env-bootstrap' && !k.disabledAt,
                })),
                activeCount: activeDb + bootstrapActive,
            },
        });
    }

    if (url.pathname === '/api/admin/admin-keys' && request.method === 'POST') {
        const body = await request.json();
        const name = String(body.name || '').trim().slice(0, 120);
        const publicKeyB64 = String(body.publicKeyB64 || '').trim();
        const challengeId = String(body.challengeId || '').trim();
        const signature = String(body.signature || '').trim();
        if (!name || !publicKeyB64) {
            return jsonResult({ status: 400, body: { error: 'invalid_key_payload' } });
        }
        if (!parseEd25519PublicKeyBytes(publicKeyB64)) {
            return jsonResult({ status: 400, body: { error: 'invalid_public_key' } });
        }
        const registeredActive = await countActiveAdminEd25519Keys(db);
        const verifyKeys = await listActiveAdminVerifyKeys(env, db);
        if (registeredActive > 0 && verifyKeys.length > 0) {
            if (!challengeId || !signature) {
                return jsonResult({ status: 400, body: { error: 'reauth_required' } });
            }
            const raw = await kv.get(`${ADMIN_KEY_REGISTER_REAUTH_PREFIX}${challengeId}`, 'json');
            if (!raw || typeof raw !== 'object') {
                return jsonResult({ status: 401, body: { error: 'reauth_expired' } });
            }
            const nonce = String(raw.nonce || '');
            const verified = await verifyAdminKeyAgainstAnyActive(env, db, {
                challengeId,
                nonce,
                signatureB64: signature,
                register: true,
            });
            if (!verified.ok) {
                return jsonResult({ status: 401, body: { error: 'reauth_invalid' } });
            }
            await kv.delete(`${ADMIN_KEY_REGISTER_REAUTH_PREFIX}${challengeId}`);
        }
        const fingerprint = await fingerprintEd25519PublicKeyB64(publicKeyB64);
        const existing = await listAdminEd25519Keys(db, false);
        if (existing.some((k) => k.fingerprint === fingerprint && !k.disabledAt)) {
            return jsonResult({ status: 409, body: { error: 'key_already_registered' } });
        }
        const id = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        if (!db) {
            return jsonResult({ status: 503, body: { error: 'db_required' } });
        }
        await insertAdminEd25519Key(db, {
            id,
            name,
            public_key_b64: publicKeyB64,
            fingerprint,
            created_at: createdAt,
            created_ip: clientIp,
            created_ua: ua,
        });
        const activeCount = (await countActiveAdminEd25519Keys(db)) + (env.ADMIN_ED25519_PUBLIC_KEY ? 1 : 0);
        const atJst = formatJstTimestamp();
        let mailId = null;
        try {
            const mail = await sendAdminKeyRegisteredNotification(env, {
                to: ADMIN_KEY_REGISTER_NOTIFY_EMAIL,
                name,
                fingerprint,
                atJst,
                clientIp,
                ua,
                activeCount,
            });
            mailId = mail?.id || null;
        } catch (err) {
            const code = /** @type {{ code?: string }} */ (err).code;
            if (code === 'RESEND_NOT_CONFIGURED') {
                return jsonResult({ status: 503, body: { error: 'otp_mail_not_configured' } });
            }
            return jsonResult({ status: 502, body: { error: 'key_notify_failed' } });
        }
        return jsonResult({
            status: 201,
            body: {
                ok: true,
                key: {
                    id,
                    name,
                    fingerprint,
                    fingerprintShort: fingerprint.slice(0, 16),
                    createdAt,
                },
                activeCount,
                notification: { queued: true, resendMessageId: mailId },
            },
        });
    }

    const revokeMatch = /^\/api\/admin\/admin-keys\/([^/]+)\/revoke$/.exec(url.pathname);
    if (revokeMatch && request.method === 'POST') {
        const keyId = decodeURIComponent(revokeMatch[1]);
        if (keyId === 'env-bootstrap') {
            return jsonResult({ status: 400, body: { error: 'key_not_revocable' } });
        }
        const activeDb = await countActiveAdminEd25519Keys(db);
        const bootstrapActive = String(env.ADMIN_ED25519_PUBLIC_KEY || '').trim() ? 1 : 0;
        const totalActive = activeDb + bootstrapActive;
        if (totalActive <= 1) {
            return jsonResult({ status: 400, body: { error: 'last_active_key' } });
        }
        const rows = await listAdminEd25519Keys(db, true);
        if (!rows.some((r) => r.id === keyId)) {
            return jsonResult({ status: 404, body: { error: 'key_not_found' } });
        }
        const remainingAfter = totalActive - 1;
        if (remainingAfter < 1) {
            return jsonResult({ status: 400, body: { error: 'last_active_key' } });
        }
        await disableAdminEd25519Key(db, keyId);
        return jsonResult({ status: 200, body: { ok: true, id: keyId, activeCount: remainingAfter } });
    }

    const deleteMatch = /^\/api\/admin\/admin-keys\/([^/]+)$/.exec(url.pathname);
    if (deleteMatch && request.method === 'DELETE') {
        const keyId = decodeURIComponent(deleteMatch[1]);
        if (keyId === 'env-bootstrap') {
            return jsonResult({ status: 400, body: { error: 'key_not_deletable' } });
        }
        if (!db) {
            return jsonResult({ status: 503, body: { error: 'db_required' } });
        }
        const rows = await listAdminEd25519Keys(db, false);
        const row = rows.find((r) => r.id === keyId);
        if (!row) {
            return jsonResult({ status: 404, body: { error: 'key_not_found' } });
        }
        if (!row.disabledAt) {
            return jsonResult({ status: 409, body: { error: 'key_still_active' } });
        }
        const deleted = await deleteRevokedAdminEd25519Key(db, keyId);
        if (!deleted) {
            return jsonResult({ status: 404, body: { error: 'key_not_found' } });
        }
        return jsonResult({ status: 200, body: { ok: true, id: keyId } });
    }

    return null;
}