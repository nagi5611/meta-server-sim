import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { handleAssetGet, handleThumbnailUpload, publicAssetUrl, THUMBNAIL_MAX_BYTES } from '../src/lobby-assets.js';

const SAFE_THUMB_NAME = /^[a-f0-9-]+\.(jpe?g|png|webp|gif)$/i;

function mockBucket() {
    /** @type {Map<string, { body: Uint8Array, contentType: string }>} */
    const objects = new Map();
    return {
        objects,
        async put(key, body, opts) {
            const buf = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body);
            objects.set(key, {
                body: buf,
                contentType: opts?.httpMetadata?.contentType || 'application/octet-stream',
            });
        },
        async get(key) {
            const hit = objects.get(key);
            if (!hit) return null;
            return {
                body: hit.body,
                httpEtag: '"mock"',
                writeHttpMetadata(headers) {
                    headers.set('content-type', hit.contentType);
                },
            };
        },
    };
}

test('thumbnail max upload size is 10 MiB', () => {
    assert.equal(THUMBNAIL_MAX_BYTES, 10 * 1024 * 1024);
});

test('thumbnail object keys use safe public filenames', () => {
    assert.equal(SAFE_THUMB_NAME.test('550e8400-e29b-41d4-a716-446655440000.jpg'), true);
    assert.equal(SAFE_THUMB_NAME.test('550e8400-e29b-41d4-a716-446655440000.JPEG'), true);
    assert.equal(SAFE_THUMB_NAME.test('../etc/passwd'), false);
    assert.equal(SAFE_THUMB_NAME.test('thumb;DROP TABLE.jpg'), false);
});

test('upload stores to R2 and asset GET returns bytes', async () => {
    const bucket = mockBucket();
    const env = { LOBBY_ASSETS: bucket };
    const pngPath = '/tmp/tiny.png';
    let png;
    try {
        png = readFileSync(pngPath);
    } catch {
        const { execSync } = await import('node:child_process');
        execSync(
            `python3 -c "import struct,zlib; w,h=2,2; raw=bytes([255,0,0,255,0,255,0,255,0,0,255,255]); ihdr=struct.pack('>IIBBBBB',w,h,8,2,0,0,0); chunk=lambda t,d: struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff); open('${pngPath}','wb').write(b'\\\\x89PNG\\\\r\\\\n\\\\x1a\\\\n'+chunk(b'IHDR',ihdr)+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))"`,
        );
        png = readFileSync(pngPath);
    }

    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'tiny.png');
    const uploadReq = new Request('http://lobby.test/api/admin/upload/thumbnail', { method: 'POST', body: fd });
    const uploadRes = await handleThumbnailUpload(uploadReq, env);
    assert.equal(uploadRes?.status, 200);
    const uploadJson = await uploadRes.json();
    assert.equal(uploadJson.ok, true);
    assert.match(uploadJson.url, /\/api\/assets\/thumbnails\//);
    assert.equal(bucket.objects.size, 1);

    const filename = uploadJson.url.split('/').pop();
    const getReq = new Request(publicAssetUrl(uploadReq, filename));
    const getRes = await handleAssetGet(getReq, env);
    assert.equal(getRes?.status, 200);
    const got = new Uint8Array(await getRes.arrayBuffer());
    assert.equal(got.length, png.length);
});