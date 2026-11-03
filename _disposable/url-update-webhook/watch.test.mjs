// _disposable/url-update-webhook/watch.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFingerprint } from './watch.mjs';

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
        const fp1 = buildFingerprint(res1, body);
        const fp2 = buildFingerprint(res2, new TextEncoder().encode('same'));
        const fp3 = buildFingerprint(res3, new TextEncoder().encode('other'));
        assert.equal(fp1, fp2);
        assert.notEqual(fp1, fp3);
    });
});
