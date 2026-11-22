// test/tenant-auth-guest.test.js — テナント meta-server 向けゲスト/Jev 設定（WS-5、metaverse-simple 非依存）
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getChatModerationPipelineConfig } from '../lib/chat-moderation-config.js';
import { moderateDisplayNameForJoin } from '../lib/display-name-moderation-policy.js';

const envBackup = { ...process.env };

afterEach(() => {
    process.env = { ...envBackup };
});

describe('tenant auth guest env (WS-5)', () => {
    it('getChatModerationPipelineConfig accepts meta-style JEV_API_KEY alias', () => {
        process.env.CHAT_MOD_PIPELINE = 'jev-gemini';
        process.env.CHAT_MOD_JEV_ENABLED = '1';
        process.env.CHAT_MOD_JEV_REJECT_THRESHOLD = '0.65';
        delete process.env.TYPESAFE_API_KEY;
        process.env.JEV_API_KEY = 'jev-only-key';
        const cfg = getChatModerationPipelineConfig();
        assert.equal(cfg.jev.apiKey, 'jev-only-key');
        assert.equal(cfg.jev.enabled, true);
    });

    it('display name moderation shares CHAT_MOD_JEV_* with tenant guest entry', async () => {
        process.env.CHAT_MOD_PIPELINE = 'jev-gemini';
        process.env.CHAT_MOD_JEV_ENABLED = '1';
        process.env.TYPESAFE_API_KEY = 'test-key';
        process.env.CHAT_MOD_JEV_REJECT_THRESHOLD = '0.7';
        process.env.GEMINI_API_KEY = 'gemini-test-key';
        const fetchJev = async () =>
            new Response(JSON.stringify({ answers: { should_reject: { noul: 0.1 } } }), {
                status: 200,
            });
        const result = await moderateDisplayNameForJoin({ displayName: 'MetaGuest', fetchJev });
        assert.equal(result.allowed, true);
    });

    it('gemini-only pipeline skips Jev gate (meta-server 互換の簡易モード)', () => {
        process.env.CHAT_MOD_PIPELINE = 'gemini-only';
        process.env.JEV_API_KEY = 'should-not-enable-jev';
        const cfg = getChatModerationPipelineConfig();
        assert.equal(cfg.pipeline, 'gemini-only');
        assert.equal(cfg.jev.enabled, false);
    });
});