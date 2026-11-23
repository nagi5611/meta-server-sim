import { setCookieHeader, signJwt } from './jwt.js';
import { isStaticLobbyAdminLogin } from './lobby-super-admin.js';
import {
    insertSuperAdminLoginEvent,
    listSuperAdminLoginEvents,
} from './db-ops.js';
import { resolveAdminOtpSecret, resolveAdminSessionSecret } from './admin-secrets.js';
import {
    ADMIN_KEY_CHALLENGE_PREFIX,
    ADMIN_KEY_MAX_ATTEMPTS,
    ADMIN_KEY_REGISTER_NOTIFY_EMAIL,
    ADMIN_KEY_TTL_SEC,
    generateKeyChallengeNonce,
    isAdminKeyAuthEnabled,
    verifyAdminKeyAgainstAnyActive,
} from './admin-ed25519-auth.js';
import { countRegisteredActiveAdminKeys, maybeNotifyZeroAdminKeys } from './admin-key-zero-warning.js';

const ADMIN_COOKIE = 'lobby_admin_session';
const OTP_KV_PREFIX = 'super_admin_otp:';
const OTP_RESEND_KV_PREFIX = 'admin_otp_resend:';
const OTP_TTL_SEC = 600;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SEC = 45;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * @param {Request} request
 * @returns {string}
 */
export function getRequestClientIp(request) {
    const cf = String(request.headers.get('cf-connecting-ip') || '').trim();
    if (cf) return cf;
    const xff = String(request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || '';
    return xff;
}

/**
 * @param {Date} [now]
 * @returns {string}
 */
export function formatJstTimestamp(now = new Date()) {
    const parts = new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(now);
    const get = (t) => parts.find((p) => p.type === t)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+09:00`;
}

/**
 * メール OTP（admin 以外）。Resend 設定またはテスト用 sink。
 * @param {Record<string, unknown>} env
 * @returns {boolean}
 */
export function isAdminOtpEnabled(env) {
    if (Array.isArray(env.__test_mail_sink)) return true;
    return Boolean(String(env.RESEND_API_KEY || '').trim());
}

/** @deprecated 互換用 — メール OTP 有効と同義 */
export function isSuperAdminOtpEnabled(env) {
    return isAdminOtpEnabled(env);
}

/**
 * @param {{ email?: string } | null | undefined} simUser
 * @returns {{ ok: true, email: string } | { ok: false, error: 'otp_mail_no_recipient' }}
 */
export function resolveAdminOtpRecipient(simUser) {
    const email = String(simUser?.email || '').trim();
    if (!email || email.endsWith('@mmh.local') || !EMAIL_RE.test(email)) {
        return { ok: false, error: 'otp_mail_no_recipient' };
    }
    return { ok: true, email };
}

/**
 * @param {Record<string, unknown>} env
 * @returns {string}
 */
function otpSecretMaterial(env) {
    return resolveAdminOtpSecret(env);
}

/**
 * @param {Record<string, unknown>} env
 * @param {string} code
 */
async function hashOtpCode(env, code) {
    const material = otpSecretMaterial(env);
    if (!material) throw new Error('otp_secret_missing');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(material),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(code).trim()));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function timingSafeEqual(a, b) {
    const sa = String(a);
    const sb = String(b);
    if (sa.length !== sb.length) return false;
    let out = 0;
    for (let i = 0; i < sa.length; i++) out |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
    return out === 0;
}

function generateOtpCode() {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
    return String(n).padStart(6, '0');
}

export function maskAdminEmail(email) {
    const e = String(email || '').trim();
    const at = e.indexOf('@');
    if (at <= 1) return '***';
    return `${e.slice(0, 2)}***${e.slice(at)}`;
}

/**
 * @param {KVNamespace} kv
 * @param {string} adminSub
 * @returns {Promise<number>}
 */
export async function getOtpResendCooldownRemaining(kv, adminSub) {
    const raw = await kv.get(`${OTP_RESEND_KV_PREFIX}${adminSub}`);
    if (!raw) return 0;
    const lastSent = Number(raw);
    if (!Number.isFinite(lastSent)) return 0;
    const elapsed = Math.floor(Date.now() / 1000) - lastSent;
    const remaining = OTP_RESEND_COOLDOWN_SEC - elapsed;
    return remaining > 0 ? remaining : 0;
}

/**
 * @param {KVNamespace} kv
 * @param {string} adminSub
 */
async function recordOtpResendSent(kv, adminSub) {
    const now = Math.floor(Date.now() / 1000);
    await kv.put(`${OTP_RESEND_KV_PREFIX}${adminSub}`, String(now), {
        expirationTtl: OTP_RESEND_COOLDOWN_SEC + 120,
    });
}

/**
 * @param {Record<string, unknown>} env
 * @param {{ to: string, subject: string, html: string, text: string }} opts
 */
export async function sendAdminOtpEmail(env, opts) {
    /** @type {Array<Record<string, unknown>> | undefined} */
    const sink = env.__test_mail_sink;
    if (Array.isArray(sink)) {
        sink.push({ ...opts });
        return { ok: true, id: 'test-mail' };
    }
    const apiKey = String(env.RESEND_API_KEY || '').trim();
    if (!apiKey) {
        const err = new Error('RESEND_API_KEY not configured');
        err.code = 'RESEND_NOT_CONFIGURED';
        throw err;
    }
    const from = String(env.RESEND_FROM_EMAIL || 'みんなでメタ <noreply@mmh-virtual.jp>').trim();
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: [opts.to],
            subject: opts.subject,
            html: opts.html,
            text: opts.text,
        }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data?.message || data?.error || `Resend HTTP ${res.status}`);
        err.code = 'RESEND_SEND_FAILED';
        throw err;
    }
    return { ok: true, id: data.id };
}

/**
 * @param {D1Database | undefined} db
 * @param {{ clientIp: string, outcome: string, detail?: Record<string, unknown> }} row
 */
async function logSuperAdminAttempt(db, row) {
    const atUtc = new Date().toISOString();
    const atJst = formatJstTimestamp();
    await insertSuperAdminLoginEvent(db, {
        id: crypto.randomUUID(),
        client_ip: row.clientIp || null,
        event_at_jst: atJst,
        event_at_utc: atUtc,
        outcome: row.outcome,
        detail: row.detail || null,
    });
    return { atJst, atUtc };
}

/**
 * @param {Record<string, unknown>} env
 * @param {string} sessionUser
 * @param {boolean} superAdmin
 */
async function issueAdminSession(env, sessionUser, superAdmin) {
    const secret = resolveAdminSessionSecret(env);
    if (!secret) return { error: 'session_not_configured', status: 503 };
    const token = await signJwt(
        { sub: sessionUser, role: 'admin', admin: true, superAdmin },
        secret,
        60 * 60 * 12,
    );
    const cookie = setCookieHeader(ADMIN_COOKIE, token, 60 * 60 * 12, '/');
    return {
        status: 200,
        body: { ok: true, user: { username: sessionUser, role: 'admin', superAdmin } },
        headers: { 'set-cookie': cookie },
    };
}

/**
 * @param {Record<string, unknown>} env
 * @param {KVNamespace} kv
 * @param {D1Database | undefined} db
 * @param {{ sessionUser: string, superAdmin: boolean, clientIp: string, simUser?: Record<string, unknown> }} ctx
 */
async function beginEmailOtpChallenge(env, kv, db, ctx) {
    const recipient = resolveAdminOtpRecipient(ctx.simUser);
    if (!recipient.ok) {
        return { status: 503, body: { error: recipient.error } };
    }
    const code = generateOtpCode();
    const challengeId = crypto.randomUUID();
    const hash = await hashOtpCode(env, code);
    await kv.put(
        `${OTP_KV_PREFIX}${challengeId}`,
        JSON.stringify({
            hash,
            sub: ctx.sessionUser,
            superAdmin: ctx.superAdmin,
            attempts: 0,
            ip: ctx.clientIp,
            otpEmail: recipient.email,
        }),
        { expirationTtl: OTP_TTL_SEC },
    );
    await recordOtpResendSent(kv, ctx.sessionUser);
    const atJst = formatJstTimestamp();
    try {
        await sendAdminOtpEmail(env, {
            to: recipient.email,
            subject: 'みんなでメタ 管理ログイン確認コード',
            text: `管理者ログインの確認コード: ${code}\n有効期限: 10分\nIP: ${ctx.clientIp}\n時刻(JST): ${atJst}`,
            html: `<p>管理者ログインの確認コード:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>有効期限: 10分</p><p>IP: ${ctx.clientIp}<br>時刻 (JST): ${atJst}</p>`,
        });
    } catch (err) {
        await kv.delete(`${OTP_KV_PREFIX}${challengeId}`);
        const codeName = /** @type {{ code?: string }} */ (err).code;
        if (codeName === 'RESEND_NOT_CONFIGURED') {
            return { status: 503, body: { error: 'otp_mail_not_configured' } };
        }
        return { status: 502, body: { error: 'otp_email_send_failed' } };
    }
    if (db && ctx.superAdmin) {
        await logSuperAdminAttempt(db, { clientIp: ctx.clientIp, outcome: 'password_ok' });
    }
    return {
        status: 200,
        body: {
            ok: true,
            otpRequired: true,
            challengeId,
            otpChannel: 'email',
            otpSentTo: maskAdminEmail(recipient.email),
            clientIp: ctx.clientIp,
            attemptedAtJst: atJst,
            resendCooldownSec: OTP_RESEND_COOLDOWN_SEC,
        },
    };
}

/**
 * @param {Record<string, unknown>} env
 * @param {KVNamespace} kv
 * @param {D1Database | undefined} db
 * @param {{ sessionUser: string, clientIp: string }} ctx
 */
async function beginAdminKeyChallenge(env, kv, db, ctx) {
    if (!(await isAdminKeyAuthEnabled(env, db))) {
        return { status: 503, body: { error: 'admin_key_not_configured' } };
    }
    const challengeId = crypto.randomUUID();
    const nonce = generateKeyChallengeNonce();
    await kv.put(
        `${ADMIN_KEY_CHALLENGE_PREFIX}${challengeId}`,
        JSON.stringify({ nonce, sub: ctx.sessionUser, attempts: 0, ip: ctx.clientIp }),
        { expirationTtl: ADMIN_KEY_TTL_SEC },
    );
    await logSuperAdminAttempt(db, { clientIp: ctx.clientIp, outcome: 'password_ok' });
    const atJst = formatJstTimestamp();
    return {
        status: 200,
        body: {
            ok: true,
            keyChallengeRequired: true,
            challengeId,
            nonce,
            clientIp: ctx.clientIp,
            attemptedAtJst: atJst,
            keyChallengeExpiresSec: ADMIN_KEY_TTL_SEC,
        },
    };
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {KVNamespace} kv
 */
export async function handleAdminLoginSuper(request, env, kv) {
    const url = new URL(request.url);
    if (request.method !== 'POST') return null;

    const db = /** @type {D1Database | undefined} */ (env.LOBBY_DB);
    const clientIp = getRequestClientIp(request);

    if (url.pathname === '/api/admin/login/verify-key') {
        const body = await request.json();
        const challengeId = String(body.challengeId || '').trim();
        const signature = String(body.signature || '').trim();
        if (!challengeId || !signature) {
            return { status: 400, body: { error: 'key_invalid' } };
        }
        const raw = await kv.get(`${ADMIN_KEY_CHALLENGE_PREFIX}${challengeId}`, 'json');
        if (!raw || typeof raw !== 'object') {
            await logSuperAdminAttempt(db, { clientIp, outcome: 'key_failed', detail: { reason: 'expired' } });
            return { status: 401, body: { error: 'key_challenge_expired' } };
        }
        const attempts = Number(raw.attempts) || 0;
        if (attempts >= ADMIN_KEY_MAX_ATTEMPTS) {
            await kv.delete(`${ADMIN_KEY_CHALLENGE_PREFIX}${challengeId}`);
            return { status: 401, body: { error: 'key_locked' } };
        }
        const nonce = String(raw.nonce || '');
        const verified = await verifyAdminKeyAgainstAnyActive(env, db, {
            challengeId,
            nonce,
            signatureB64: signature,
            register: false,
        });
        if (!verified.ok) {
            await kv.put(
                `${ADMIN_KEY_CHALLENGE_PREFIX}${challengeId}`,
                JSON.stringify({ ...raw, attempts: attempts + 1 }),
                { expirationTtl: ADMIN_KEY_TTL_SEC },
            );
            await logSuperAdminAttempt(db, { clientIp, outcome: 'key_failed' });
            return { status: 401, body: { error: 'key_invalid' } };
        }
        await kv.delete(`${ADMIN_KEY_CHALLENGE_PREFIX}${challengeId}`);
        const sessionUser = String(raw.sub || 'admin');
        await logSuperAdminAttempt(db, { clientIp, outcome: 'session_ok' });
        return issueAdminSession(env, sessionUser, true);
    }

    if (url.pathname === '/api/admin/login/resend-otp') {
        const body = await request.json();
        const challengeId = String(body.challengeId || '').trim();
        if (!challengeId) {
            return { status: 400, body: { error: 'otp_invalid' } };
        }
        const raw = await kv.get(`${OTP_KV_PREFIX}${challengeId}`, 'json');
        if (!raw || typeof raw !== 'object') {
            return { status: 401, body: { error: 'otp_expired' } };
        }
        const sub = String(raw.sub || '');
        const retryAfterSec = await getOtpResendCooldownRemaining(kv, sub);
        if (retryAfterSec > 0) {
            return { status: 429, body: { error: 'otp_resend_cooldown', retryAfterSec } };
        }
        await kv.delete(`${OTP_KV_PREFIX}${challengeId}`);
        const email = String(raw.otpEmail || '').trim();
        return beginEmailOtpChallenge(env, kv, db, {
            sessionUser: sub,
            superAdmin: Boolean(raw.superAdmin),
            clientIp,
            simUser: { email },
        });
    }

    if (url.pathname === '/api/admin/login/verify-otp') {
        const body = await request.json();
        const challengeId = String(body.challengeId || '').trim();
        const code = String(body.code || body.otp || '').trim();
        if (!challengeId || !/^\d{6}$/.test(code)) {
            return { status: 400, body: { error: 'otp_invalid' } };
        }
        const raw = await kv.get(`${OTP_KV_PREFIX}${challengeId}`, 'json');
        if (!raw || typeof raw !== 'object') {
            return { status: 401, body: { error: 'otp_expired' } };
        }
        const attempts = Number(raw.attempts) || 0;
        if (attempts >= OTP_MAX_ATTEMPTS) {
            await kv.delete(`${OTP_KV_PREFIX}${challengeId}`);
            return { status: 401, body: { error: 'otp_locked' } };
        }
        const expectHash = String(raw.hash || '');
        const gotHash = await hashOtpCode(env, code);
        if (!timingSafeEqual(expectHash, gotHash)) {
            await kv.put(
                `${OTP_KV_PREFIX}${challengeId}`,
                JSON.stringify({ ...raw, attempts: attempts + 1 }),
                { expirationTtl: OTP_TTL_SEC },
            );
            if (Boolean(raw.superAdmin)) {
                await logSuperAdminAttempt(db, { clientIp, outcome: 'otp_failed' });
            }
            return { status: 401, body: { error: 'otp_invalid' } };
        }
        await kv.delete(`${OTP_KV_PREFIX}${challengeId}`);
        const sessionUser = String(raw.sub || 'admin');
        const superAdmin = Boolean(raw.superAdmin);
        if (superAdmin) {
            await logSuperAdminAttempt(db, { clientIp, outcome: 'session_ok' });
        }
        return issueAdminSession(env, sessionUser, superAdmin);
    }

    if (url.pathname !== '/api/admin/login') return null;

    const body = await request.json();
    const login = String(body.login || body.username || body.email || '').trim();
    const pass = String(body.password || '');
    const staticAdminUser = String(env.LOBBY_ADMIN_USER || 'admin').trim();
    const staticUserAttempt = login === staticAdminUser;

    /** @type {string} */
    let sessionUser = login;
    let authenticated = false;
    /** @type {boolean} */
    let superAdmin = false;
    /** @type {Record<string, unknown> | null} */
    let simUser = null;
    /** @type {{ ok: boolean, status: number, data: Record<string, unknown> | null }} | null */
    let simResult = null;

    if (isStaticLobbyAdminLogin(env, login, pass)) {
        authenticated = true;
        sessionUser = staticAdminUser;
        superAdmin = true;
    } else {
        if (staticUserAttempt) {
            await logSuperAdminAttempt(db, { clientIp, outcome: 'password_failed' });
        }
        simResult = await fetchSimProxy(env, login, pass);
        if (simResult.ok && simResult.data?.user) {
            authenticated = true;
            simUser = /** @type {Record<string, unknown>} */ (simResult.data.user);
            sessionUser = String(simUser.username || login);
            superAdmin = false;
        }
    }

    if (!authenticated) {
        const simError = String(simResult?.data?.error || '').trim();
        if (simError === 'banned') return { status: 403, body: { error: 'banned' } };
        if (simError === 'admin_required') return { status: 403, body: { error: 'admin_required' } };
        if (simError === 'login_and_password_required') {
            return { status: 400, body: { error: 'login_and_password_required' } };
        }
        const status = simResult && !simResult.ok && simResult.status >= 400 ? simResult.status : 401;
        return { status: status === 403 ? 403 : 401, body: { error: simError || 'invalid_credentials' } };
    }

    if (superAdmin) {
        const registeredKeys = await countRegisteredActiveAdminKeys(db);
        if (registeredKeys > 0) {
            if (!(await isAdminKeyAuthEnabled(env, db))) {
                return { status: 503, body: { error: 'admin_key_not_configured' } };
            }
            return beginAdminKeyChallenge(env, kv, db, { sessionUser, clientIp });
        }
        if (!isAdminOtpEnabled(env)) {
            await maybeNotifyZeroAdminKeys(env, kv, { reason: 'login_attempt', clientIp });
            return { status: 503, body: { error: 'otp_mail_not_configured' } };
        }
        return beginEmailOtpChallenge(env, kv, db, {
            sessionUser,
            superAdmin: true,
            clientIp,
            simUser: { email: ADMIN_KEY_REGISTER_NOTIFY_EMAIL },
        });
    }

    if (isAdminOtpEnabled(env)) {
        return beginEmailOtpChallenge(env, kv, db, {
            sessionUser,
            superAdmin: false,
            clientIp,
            simUser: simUser || undefined,
        });
    }

    return issueAdminSession(env, sessionUser, superAdmin);
}

/**
 * @param {Record<string, unknown>} env
 * @param {string} login
 * @param {string} pass
 */
async function fetchSimProxy(env, login, pass) {
    const { fetchSim } = await import('./sim-client.js');
    return fetchSim(env, '/service/lobby/admin-login', {
        method: 'POST',
        body: { login, password: pass },
    });
}

/**
 * @param {D1Database | undefined} db
 * @param {number} [limit]
 */
export async function getSuperAdminLoginAudit(db, limit = 20) {
    const rows = await listSuperAdminLoginEvents(db, limit);
    const lastSuccess = rows.find((r) => r.outcome === 'session_ok') || null;
    return { events: rows, lastSuccess };
}

export { OTP_RESEND_COOLDOWN_SEC };