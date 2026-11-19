import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    buildJevDisplayNameState,
    parseJevNoulAnswer,
    shouldRejectFromJevNoul,
    scoreJevDisplayNameReject,
} from '../src/display-name-moderation-jev.js';
import { getLobbyDisplayNameModerationConfig } from '../src/display-name-moderation-config.js';
import { moderateLobbyDisplayName } from '../src/display-name-moderator.js';

test('getLobbyDisplayNameModerationConfig resolves API key aliases', () => {
    const a = getLobbyDisplayNameModerationConfig({ LOBBY_JEV_API_KEY: 'k1' });
    assert.equal(a.enabled, true);
    assert.equal(a.apiKey, 'k1');

    const b = getLobbyDisplayNameModerationConfig({ JEV_API_KEY: 'k2' });
    assert.equal(b.apiKey, 'k2');

    const c = getLobbyDisplayNameModerationConfig({ LOBBY_DISPLAY_NAME_MOD_ENABLED: '0', LOBBY_JEV_API_KEY: 'k' });
    assert.equal(c.enabled, false);
});

test('shouldRejectFromJevNoul uses threshold', () => {
    assert.equal(shouldRejectFromJevNoul(0.69, 0.7), false);
    assert.equal(shouldRejectFromJevNoul(0.7, 0.7), true);
});

test('scoreJevDisplayNameReject sends display name in pending_message', async () => {
    /** @type {unknown} */
    let body = null;
    const fetchMock = async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ answers: { should_reject: { noul: 0.91 } } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };
    const cfg = getLobbyDisplayNameModerationConfig({ LOBBY_JEV_API_KEY: 'test' });
    const { noul } = await scoreJevDisplayNameReject({
        displayName: '太郎',
        cfg,
        fetchImpl: fetchMock,
    });
    assert.equal(noul, 0.91);
    assert.deepEqual(
        buildJevDisplayNameState('太郎', cfg.policyText),
        /** @type {{ state: { pending_message: string } }} */ (body).state,
    );
});

test('moderateLobbyDisplayName rejects high noul', async () => {
    const fetchMock = async () =>
        new Response(JSON.stringify({ answers: { should_reject: { noul: 0.95 } } }), { status: 200 });
    const result = await moderateLobbyDisplayName({
        env: { LOBBY_JEV_API_KEY: 'k' },
        displayName: 'bad',
        fetchImpl: fetchMock,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.moderation_stage, 'jev_reject');
});

test('moderateLobbyDisplayName skips without API key', async () => {
    const result = await moderateLobbyDisplayName({
        env: {},
        displayName: 'Guest',
    });
    assert.equal(result.allowed, true);
    assert.equal(result.skipped, true);
    assert.equal(result.moderation_stage, 'disabled');
});

test('moderateLobbyDisplayName fails open on Jev HTTP error', async () => {
    const fetchMock = async () => new Response('nope', { status: 500 });
    const result = await moderateLobbyDisplayName({
        env: { LOBBY_JEV_API_KEY: 'k' },
        displayName: 'x',
        fetchImpl: fetchMock,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.moderationError, true);
});

test('parseJevNoulAnswer reads should_reject', () => {
    assert.equal(parseJevNoulAnswer({ answers: { should_reject: { noul: 0.3 } } }), 0.3);
});

test('moderateLobbyDisplayName uses Gemini when only GEMINI_TRANSLATION_API_KEY is set', async () => {
    const fetchMock = async (url) => {
        if (String(url).includes('generativelanguage.googleapis.com')) {
            return new Response(
                JSON.stringify({
                    candidates: [
                        {
                            content: {
                                parts: [
                                    {
                                        text: JSON.stringify({
                                            inappropriate: true,
                                            absolute_broadcast_block: false,
                                            reason_ja: 'NG',
                                        }),
                                    },
                                ],
                            },
                        },
                    ],
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        }
        return new Response('unexpected', { status: 500 });
    };
    const result = await moderateLobbyDisplayName({
        env: { GEMINI_TRANSLATION_API_KEY: 'g-key' },
        displayName: 'Bad',
        fetchImpl: fetchMock,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.moderation_stage, 'gemini_reject');
});

test('moderateLobbyDisplayName Gemini-only skips without API key', async () => {
    const result = await moderateLobbyDisplayName({
        env: {},
        displayName: 'Player',
    });
    assert.equal(result.allowed, true);
    assert.equal(result.skipped, true);
});