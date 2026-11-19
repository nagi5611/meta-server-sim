import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    googleOAuthCallbackUrl,
    handleGoogleOAuthApi,
    isGoogleOAuthConfigured,
} from '../src/google-oauth.js';
import { signJwt } from '../src/jwt.js';

const SECRET = '0123456789abcdef0123456789abcdef';

test('isGoogleOAuthConfigured requires client id and secret', () => {
    assert.equal(isGoogleOAuthConfigured({}), false);
    assert.equal(
        isGoogleOAuthConfigured({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec' }),
        true,
    );
    assert.equal(
        isGoogleOAuthConfigured({ GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'sec' }),
        true,
    );
    assert.equal(
        isGoogleOAuthConfigured({
            GOOGLE_CLIENT_ID: 'primary',
            LOBBY_GOOGLE_CLIENT_ID: 'lobby',
            GOOGLE_OAUTH_CLIENT_ID: 'legacy',
            GOOGLE_CLIENT_SECRET: 'sec',
        }),
        true,
    );
});

test('googleOAuthCallbackUrl uses request origin by default', () => {
    const env = {};
    assert.equal(googleOAuthCallbackUrl(env, 'https://m.example.test'), 'https://m.example.test/api/auth/google/callback');
    env.GOOGLE_OAUTH_REDIRECT_URI = 'https://custom/callback';
    assert.equal(googleOAuthCallbackUrl(env, 'https://m.example.test'), 'https://custom/callback');
});

test('GET /api/auth/google/status returns enabled flag', async () => {
    const req = new Request('https://lobby.test/api/auth/google/status');
    const res = await handleGoogleOAuthApi(req, {
        GOOGLE_OAUTH_CLIENT_ID: 'cid',
        GOOGLE_OAUTH_CLIENT_SECRET: 'csec',
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.enabled, true);
    assert.deepEqual(data.scopes, ['openid', 'email', 'profile']);
});

test('GET /api/auth/google/start redirects to Google when configured', async () => {
    const req = new Request('https://lobby.test/api/auth/google/start');
    const res = await handleGoogleOAuthApi(req, {
        GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'csec',
        LOBBY_JWT_SECRET: SECRET,
    });
    assert.equal(res.status, 302);
    const loc = res.headers.get('Location') || '';
    assert.match(loc, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    assert.ok(loc.includes('client_id=cid.apps.googleusercontent.com'));
    assert.ok(loc.includes('scope=openid+email+profile'));
    assert.ok(res.headers.get('Set-Cookie')?.includes('lobby_google_oauth_state'));
});

test('GET /api/auth/google/pending without cookie returns not pending', async () => {
    const req = new Request('https://lobby.test/api/auth/google/pending');
    const res = await handleGoogleOAuthApi(req, { LOBBY_JWT_SECRET: SECRET });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.pending, false);
});

test('callback rejects invalid oauth state', async () => {
    const state = await signJwt({ flow: 'google_oauth', nonce: 'n' }, SECRET, 600);
    const req = new Request(`https://lobby.test/api/auth/google/callback?code=abc&state=${state}`, {
        headers: { cookie: 'lobby_google_oauth_state=other' },
    });
    const res = await handleGoogleOAuthApi(req, {
        GOOGLE_OAUTH_CLIENT_ID: 'cid',
        GOOGLE_OAUTH_CLIENT_SECRET: 'csec',
        LOBBY_JWT_SECRET: SECRET,
    });
    assert.equal(res.status, 302);
    assert.ok(res.headers.get('Location')?.includes('google_auth=error'));
});