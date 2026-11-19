import { setCookieHeader, signJwt } from './jwt.js';
import { isStaticLobbyAdminLogin } from './lobby-super-admin.js';
import {
    insertSuperAdminLoginEvent,
    listSuperAdminLoginEvents,
} from './db-ops.js';
import {
    buildOtpSmsMessage,
    maskAdminPhone,
    normalizeJapanPhoneE164,
    sendAdminOtpSms,
} from './aws-sns-sms.js';
import { resolveAdminOtpSecret, resolveAdminSessionSecret } from './admin-secrets.js';

const ADMIN_COOKIE = 'lobby_admin_session';
const OTP_KV_PREFIX = 'super_admin_otp:';
const OTP_TTL_SEC = 600;
const OTP_MAX_ATTEMPTS = 5;

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
 * @param {Record<string, unknown>} env
 * @returns {boolean}
 */
export function isSuperAdminOtpEnabled(env) {
    return Boolean(
        String(env.ADMIN_PHONE || '').trim() || String(env.ADMIN_EMAIL || '').trim(),
    );
}

/**
 * @param {Record<string, unknown>} env
 * @returns {'sms' | 'email' | null}
 */
export function resolveSuperAdminOtpChannel(env) {
    if (String(env.ADMIN_PHONE || '').trim()) return 'sms';
    if (String(env.ADMIN_EMAIL || '').trim()) return 'email';
    return null;
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

function maskAdminEmail(email) {
    const e = String(email || '').trim();
    const at = e.indexOf('@');
    if (at <= 1) return '***';
    return `${e.slice(0, 2)}***${e.slice(at)}`;
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
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {KVNamespace} kv
 */
export async function handleAdminLoginSuper(request, env, kv) {
    const url = new URL(request.url);
    if (request.method !== 'POST') return null;

    const db = /** @type {D1Database | undefined} */ (env.LOBBY_DB);

    if (url.pathname === '/api/admin/login/verify-otp') {
        const body = await request.json();
        const challengeId = String(body.challengeId || '').trim();
        const code = String(body.code || body.otp || '').trim();
        const clientIp = getRequestClientIp(request);
        if (!challengeId || !/^\d{6}$/.test(code)) {
            return { status: 400, body: { error: 'otp_invalid' } };
        }
        const raw = await kv.get(`${OTP_KV_PREFIX}${challengeId}`, 'json');
        if (!raw || typeof raw !== 'object') {
            await logSuperAdminAttempt(db, { clientIp, outcome: 'otp_failed', detail: { reason: 'expired' } });
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
            await logSuperAdminAttempt(db, { clientIp, outcome: 'otp_failed' });
            return { status: 401, body: { error: 'otp_invalid' } };
        }
        await kv.delete(`${OTP_KV_PREFIX}${challengeId}`);
        const sessionUser = String(raw.sub || 'admin');
        await logSuperAdminAttempt(db, { clientIp, outcome: 'session_ok' });
        return issueAdminSession(env, sessionUser, true);
    }

    if (url.pathname !== '/api/admin/login') return null;

    const body = await request.json();
    const login = String(body.login || body.username || body.email || '').trim();
    const pass = String(body.password || '');
    const staticAdminUser = String(env.LOBBY_ADMIN_USER || 'admin').trim();
    const clientIp = getRequestClientIp(request);
    const staticUserAttempt = login === staticAdminUser;

    /** @type {string} */
    let sessionUser = login;
    let authenticated = false;
    /** @type {boolean} */
    let superAdmin = false;
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
            sessionUser = String(simResult.data.user.username || login);
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

    if (superAdmin && isSuperAdminOtpEnabled(env)) {
        await logSuperAdminAttempt(db, { clientIp, outcome: 'password_ok' });
        const channel = resolveSuperAdminOtpChannel(env);
        const adminPhone = String(env.ADMIN_PHONE || '').trim();
        const adminEmail = String(env.ADMIN_EMAIL || '').trim();
        const code = generateOtpCode();
        const challengeId = crypto.randomUUID();
        const hash = await hashOtpCode(env, code);
        await kv.put(
            `${OTP_KV_PREFIX}${challengeId}`,
            JSON.stringify({ hash, sub: sessionUser, attempts: 0, ip: clientIp }),
            { expirationTtl: OTP_TTL_SEC },
        );
        const atJst = formatJstTimestamp();
        /** @type {string} */
        let otpSentTo = '';
        try {
            if (channel === 'sms') {
                const smsBody = buildOtpSmsMessage({ code, clientIp, atJst });
                await sendAdminOtpSms(env, { phone: adminPhone, message: smsBody });
                const e164 = normalizeJapanPhoneE164(adminPhone) || adminPhone;
                otpSentTo = maskAdminPhone(e164);
            } else {
                await sendAdminOtpEmail(env, {
                    to: adminEmail,
                    subject: 'みんなでメタ 管理ログイン確認コード',
                    text: `スーパー管理者ログインの確認コード: ${code}\n有効期限: 10分\nIP: ${clientIp}\n時刻(JST): ${atJst}`,
                    html: `<p>スーパー管理者ログインの確認コード:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>有効期限: 10分</p><p>IP: ${clientIp}<br>時刻 (JST): ${atJst}</p>`,
                });
                otpSentTo = maskAdminEmail(adminEmail);
            }
        } catch (err) {
            await kv.delete(`${OTP_KV_PREFIX}${challengeId}`);
            const codeName = /** @type {{ code?: string }} */ (err).code;
            if (codeName === 'ADMIN_PHONE_INVALID') {
                return { status: 503, body: { error: 'admin_phone_invalid' } };
            }
            if (codeName === 'SNS_NOT_CONFIGURED') {
                return { status: 503, body: { error: 'otp_sms_not_configured' } };
            }
            if (codeName === 'SNS_SEND_FAILED') {
                return { status: 502, body: { error: 'otp_sms_send_failed' } };
            }
            if (codeName === 'RESEND_NOT_CONFIGURED') {
                return { status: 503, body: { error: 'otp_mail_not_configured' } };
            }
            if (codeName === 'RESEND_SEND_FAILED') {
                return { status: 502, body: { error: 'otp_email_send_failed' } };
            }
            return {
                status: 502,
                body: { error: channel === 'sms' ? 'otp_sms_send_failed' : 'otp_email_send_failed' },
            };
        }
        return {
            status: 200,
            body: {
                ok: true,
                otpRequired: true,
                challengeId,
                otpChannel: channel,
                otpSentTo,
                clientIp,
                attemptedAtJst: atJst,
            },
        };
    }

    if (superAdmin) {
        await logSuperAdminAttempt(db, { clientIp, outcome: 'session_ok', detail: { otpSkipped: true } });
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