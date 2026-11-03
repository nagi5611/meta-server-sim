// _disposable/url-update-webhook/watch.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    buildDiscordWebhookPayload,
    buildFingerprint,
    normalizeHtmlBody,
} from './watch.mjs';

describe('buildDiscordWebhookPayload', () => {
    it('includes role mention when guild id is known', () => {
        const body = buildDiscordWebhookPayload('更新', 'https://example.com/', '2026-01-01T00:00:00.000Z', '999');
        assert.match(body.content, /<@&999>/);
        assert.deepEqual(body.allowed_mentions.roles, ['999']);
        assert.ok(body.allowed_mentions.parse?.includes('everyone'));
    });
});

describe('buildFingerprint', () => {
    it('prefers etag and last-modified over body hash', () => {
        const res = new Response('hello', {
            headers: { etag: '"abc"', 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' },
        });
        const fp = buildFingerprint(res, new TextEncoder().encode('hello'));
        assert.equal(fp, 'meta:"abc"|Wed, 01 Jan 2025 00:00:00 GMT');
    });

    it('hashes body when no cache headers', () => {
        const body = new TextEncoder().encode('same');
        const res1 = new Response(body);
        const res2 = new Response(new TextEncoder().encode('same'));
        const res3 = new Response(new TextEncoder().encode('other'));
        const fp1 = buildFingerprint(res1, body, { fingerprintMode: 'raw' });
        const fp2 = buildFingerprint(res2, new TextEncoder().encode('same'), { fingerprintMode: 'raw' });
        const fp3 = buildFingerprint(res3, new TextEncoder().encode('other'), { fingerprintMode: 'raw' });
        assert.equal(fp1, fp2);
        assert.notEqual(fp1, fp3);
    });

    it('html-text mode ignores volatile markup', () => {
        const a = new TextEncoder().encode(
            '<html><script>Math.random()</script><p>合格</p></html>'
        );
        const b = new TextEncoder().encode(
            '<html><script>other()</script><p>合格</p></html>'
        );
        const resA = new Response(a, { headers: { 'content-type': 'text/html' } });
        const resB = new Response(b, { headers: { 'content-type': 'text/html' } });
        assert.equal(
            buildFingerprint(resA, a, { fingerprintMode: 'html-text' }),
            buildFingerprint(resB, b, { fingerprintMode: 'html-text' })
        );
        assert.equal(normalizeHtmlBody(a), '合格');
    });
});
