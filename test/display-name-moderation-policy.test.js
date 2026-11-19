import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { moderateDisplayNameForJoin } from '../lib/display-name-moderation-policy.js';

const envBackup = { ...process.env };

describe('display-name-moderation-policy (Jev)', () => {
    beforeEach(() => {
        process.env.CHAT_MOD_PIPELINE = 'jev-gemini';
        process.env.CHAT_MOD_JEV_ENABLED = '1';
        process.env.TYPESAFE_API_KEY = 'test-key';
        process.env.CHAT_MOD_JEV_REJECT_THRESHOLD = '0.7';
        delete process.env.GEMINI_API_KEY;
    });

    afterEach(() => {
        process.env = { ...envBackup };
    });

    it('allows when noul below threshold', async () => {
        const fetchJev = async () =>
            new Response(JSON.stringify({ answers: { should_reject: { noul: 0.1 } } }), { status: 200 });
        const result = await moderateDisplayNameForJoin({ displayName: 'Player1', fetchJev });
        assert.equal(result.allowed, true);
    });

    it('rejects when noul at threshold', async () => {
        const fetchJev = async () =>
            new Response(JSON.stringify({ answers: { should_reject: { noul: 0.85 } } }), { status: 200 });
        const result = await moderateDisplayNameForJoin({ displayName: 'BadName', fetchJev });
        assert.equal(result.allowed, false);
        assert.equal(result.inappropriate, true);
    });

    it('skips when Jev key missing', async () => {
        delete process.env.TYPESAFE_API_KEY;
        delete process.env.JEV_API_KEY;
        const result = await moderateDisplayNameForJoin({ displayName: 'Any' });
        assert.equal(result.allowed, true);
        assert.equal(result.skipped, true);
    });
});