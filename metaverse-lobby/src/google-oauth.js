import { fetchSim } from './sim-client.js';
import { readCookie, setCookieHeader, signJwt, verifyJwt } from './jwt.js';

const PUBLIC_COOKIE = 'lobby_session';
const OAUTH_STATE_COOKIE = 'lobby_google_oauth_state';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const OAUTH_SCOPES = 'openid email profile';

/**
 * @param {Record<string, unknown>} env
 */
function googleOAuthClientId(env) {
    return String(
        env.GOOGLE_CLIENT_ID
            || env.LOBBY_GOOGLE_CLIENT_ID
            || env.GOOGLE_OAUTH_CLIENT_ID
            || '',
    ).trim();
}

/**
 * @param {Record<string, unknown>} env
 */
function googleOAuthClientSecret(env) {
    return String(
        env.GOOGLE_CLIENT_SECRET
            || env.LOBBY_GOOGLE_CLIENT_SECRET
            || env.GOOGLE_OAUTH_CLIENT_SECRET
            || '',
    ).trim();
}

/**
 * @param {Record<string, unknown>} env
 */
export function isGoogleOAuthConfigured(env) {
    return Boolean(googleOAuthClientId(env) && googleOAuthClientSecret(env));
}

/**
 * @param {Record<string, unknown>} env
 * @param {string} [requestOrigin]
 */
export function googleOAuthCallbackUrl(env, requestOrigin) {
    const override = String(
        env.LOBBY_GOOGLE_REDIRECT_URI || env.GOOGLE_OAUTH_REDIRECT_URI || '',
    ).trim();
    if (override) return override;
    const fromEnv = String(env.LOBBY_PUBLIC_ORIGIN || env.LOBBY_PUBLIC_URL || '').trim().replace(/\/$/, '');
    const base = String(requestOrigin || fromEnv || 'https://m.mmh-virtual.jp').trim().replace(/\/$/, '');
    return `${base}/api/auth/google/callback`;
}

/**
 * @param {Record<string, unknown>} env
 */
function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
    });
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 */
export async function handleGoogleOAuthApi(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/auth/google/status' && request.method === 'GET') {
        return json({
            enabled: isGoogleOAuthConfigured(env),
            scopes: OAUTH_SCOPES.split(' '),
        });
    }

    const isGoogleStart =
        request.method === 'GET' &&
        (url.pathname === '/api/auth/google/start' || url.pathname === '/api/auth/google');
    if (isGoogleStart) {
        if (!isGoogleOAuthConfigured(env)) {
            return redirectWithAuthError(url.origin, 'not_configured', env);
        }
        const secret = String(env.LOBBY_JWT_SECRET || '').trim();
        if (!secret) return redirectWithAuthError(url.origin, 'jwt_not_configured', env);
        const redirectUri = googleOAuthCallbackUrl(env, url.origin);

        const state = await signJwt(
            { flow: 'google_oauth', nonce: crypto.randomUUID() },
            secret,
            10 * 60,
        );
        const params = new URLSearchParams({
            client_id: googleOAuthClientId(env),
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: OAUTH_SCOPES,
            state,
            access_type: 'online',
            prompt: 'select_account',
        });
        const headers = new Headers({ Location: `${GOOGLE_AUTH_URL}?${params}` });
        headers.append('set-cookie', setCookieHeader(OAUTH_STATE_COOKIE, state, 10 * 60, '/'));
        return new Response(null, { status: 302, headers });
    }

    if (url.pathname === '/api/auth/google/callback' && request.method === 'GET') {
        if (!isGoogleOAuthConfigured(env)) {
            return redirectWithAuthError(url.origin, 'not_configured', env);
        }
        const secret = String(env.LOBBY_JWT_SECRET || '').trim();
        if (!secret) return redirectWithAuthError(url.origin, 'jwt_not_configured', env);

        const err = url.searchParams.get('error');
        if (err) return redirectWithAuthError(url.origin, err, env);

        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const cookieState = readCookie(request, OAUTH_STATE_COOKIE);
        if (!code || !state || !cookieState || state !== cookieState) {
            return redirectWithAuthError(url.origin, 'invalid_state', env);
        }
        const statePayload = await verifyJwt(state, secret);
        if (!statePayload || statePayload.flow !== 'google_oauth') {
            return redirectWithAuthError(url.origin, 'invalid_state', env);
        }

        const redirectUri = googleOAuthCallbackUrl(env, url.origin);
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: googleOAuthClientId(env),
                client_secret: googleOAuthClientSecret(env),
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        });
        const tokenJson = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenJson.access_token) {
            return redirectWithAuthError(url.origin, 'token_exchange_failed', env);
        }

        const profileRes = await fetch(GOOGLE_USERINFO_URL, {
            headers: { authorization: `Bearer ${tokenJson.access_token}` },
        });
        const profile = await profileRes.json().catch(() => ({}));
        if (!profileRes.ok || !profile.sub) {
            return redirectWithAuthError(url.origin, 'profile_failed', env);
        }

        const sim = await fetchSim(env, '/service/lobby/auth/google', {
            method: 'POST',
            body: {
                googleSub: String(profile.sub),
                email: String(profile.email || '').trim(),
                emailVerified: profile.email_verified === true,
                displayName: String(profile.name || profile.given_name || '').trim(),
                picture: String(profile.picture || '').trim(),
            },
        });

        const clearStateCookie = setCookieHeader(OAUTH_STATE_COOKIE, '', 0, '/');
        if (!sim.ok) {
            const codeKey = String(sim.data?.error || 'google_auth_failed');
            return redirectWithAuthError(url.origin, codeKey, env, [clearStateCookie]);
        }

        const user = sim.data?.user;
        if (!user) {
            return redirectWithAuthError(url.origin, 'google_auth_failed', env, [clearStateCookie]);
        }

        const avatarUrl = String(user.avatarUrl || profile.picture || '').trim();
        const sessionToken = await signJwt(
            {
                sub: user.userId,
                username: user.username,
                displayName: user.displayName,
                role: user.role,
                banned: user.banned,
                ...(avatarUrl ? { avatarUrl } : {}),
            },
            secret,
            60 * 60 * 24 * 7,
        );
        const sessionCookie = setCookieHeader(PUBLIC_COOKIE, sessionToken, 60 * 60 * 24 * 7, '/');
        const publicBase = googleOAuthCallbackUrl(env, url.origin).replace(/\/api\/auth\/google\/callback$/, '');
        const dest = new URL('/', publicBase || url.origin);
        dest.searchParams.set('google_auth', 'ok');
        const headers = new Headers({ Location: dest.pathname + dest.search });
        headers.append('Set-Cookie', clearStateCookie);
        headers.append('Set-Cookie', sessionCookie);
        return new Response(null, { status: 302, headers });
    }

    return null;
}

/**
 * @param {string} origin
 * @param {string} error
 * @param {Record<string, unknown>} env
 * @param {string[]} [extraCookies]
 */
function redirectWithAuthError(origin, error, env, extraCookies = []) {
    const publicBase = googleOAuthCallbackUrl(env, origin).replace(/\/api\/auth\/google\/callback$/, '');
    const dest = new URL('/', publicBase || origin || 'https://m.mmh-virtual.jp');
    dest.searchParams.set('google_auth', 'error');
    dest.searchParams.set('google_error', error);
    const headers = new Headers({ Location: dest.pathname + dest.search });
    const clear = setCookieHeader(OAUTH_STATE_COOKIE, '', 0, '/');
    headers.append('Set-Cookie', clear);
    for (const c of extraCookies) {
        if (c) headers.append('Set-Cookie', c);
    }
    return new Response(null, { status: 302, headers });
}