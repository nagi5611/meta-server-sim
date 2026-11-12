// test/chat-moderation-jev-pipeline.test.js — 短いチャット向け Jev ゲート + Gemini 詳細のユニットテスト
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildJevModerationState,
    extractPendingChatText,
    parseJevNoulAnswer,
    scoreJevChatReject,
    shouldRejectFromJevNoul,
} from '../lib/chat-moderation-jev.js';
import { moderateChatMessage } from '../lib/chat-moderation.js';

const envBackup = { ...process.env };

describe('chat moderation Jev pipeline', () => {
    beforeEach(() => {
        process.env.CHAT_MOD_PIPELINE = 'jev-gemini';
        process.env.CHAT_MOD_JEV_ENABLED = '1';
        process.env.TYPESAFE_API_KEY = 'test-key';
        process.env.CHAT_MOD_JEV_REJECT_THRESHOLD = '0.7';
        process.env.CHAT_MOD_JEV_MODEL = 'jev-latest';
    });

    afterEach(() => {
        process.env = { ...envBackup };
    });

    it('extractPendingChatText keeps only the chat body from pending line', () => {
        assert.equal(
            extractPendingChatText('2026-01-01T00:00:00.000Z | socket-abc | こんにちは'),
            'こんにちは',
        );
        assert.equal(extractPendingChatText('短文だけ'), '短文だけ');
    });

    it('buildJevModerationState holds a single message (no history array)', () => {
        const state = buildJevModerationState('はい', 'policy');
        assert.equal(state.pending_message, 'はい');
        assert.equal(state.policy, 'policy');
        assert.deepEqual(Object.keys(state).sort(), ['pending_message', 'policy']);
    });

    it('shouldRejectFromJevNoul respects configured threshold', () => {
        assert.equal(shouldRejectFromJevNoul(0.69, 0.7), false);
        assert.equal(shouldRejectFromJevNoul(0.7, 0.7), true);
    });

    it('parseJevNoulAnswer reads answers.should_reject.noul', () => {
        assert.equal(
            parseJevNoulAnswer({ answers: { should_reject: { noul: 0.42 } } }),
            0.42,
        );
    });

    it('moderateChatMessage skips Gemini when Jev noul is below threshold', async () => {
        const fetchJev = async () =>
            new Response(JSON.stringify({ answers: { should_reject: { noul: 0.2 } } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });

        const result = await moderateChatMessage({
            apiKey: 'gemini-should-not-run',
            historyTableText: 'ignored',
            pendingLine: '2026-01-01 | u1 | 今日の実験うまくいった',
            fetchJev,
        });

        assert.equal(result.inappropriate, false);
        assert.equal(result.moderation_stage, 'jev_pass');
        assert.equal(result.jev_noul, 0.2);
    });

    it('scoreJevChatReject sends only pending_message in state (fixture)', async () => {
        /** @type {unknown} */
        let capturedBody = null;
        const fetchJev = async (_url, init) => {
            capturedBody = JSON.parse(String(init?.body));
            return new Response(JSON.stringify({ answers: { should_reject: { noul: 0.55 } } }), {
                status: 200,
            });
        };

        await scoreJevChatReject({
            messageText: '短いチャット',
            fetchImpl: fetchJev,
        });

        assert.ok(capturedBody && typeof capturedBody === 'object');
        const body = /** @type {{ state: { pending_message: string } }} */ (capturedBody);
        assert.equal(body.state.pending_message, '短いチャット');
        assert.equal(body.state.pending_message.includes('|'), false);
    });
});
