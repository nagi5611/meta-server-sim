import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
    handleProfileAvatarGet,
    handleProfileAvatarUpload,
    profileAvatarFilename,
    publicProfileAvatarUrl,
    SAFE_PROFILE_AVATAR_NAME,
} from '../src/lobby-profile-assets.js';

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

test('profile avatar filename is scoped to user ref', () => {
    assert.equal(profileAvatarFilename('student-12', 'image/webp'), 'student-12.webp');
    assert.equal(profileAvatarFilename('teacher-3', 'image/jpeg'), 'teacher-3.jpg');
    assert.equal(profileAvatarFilename('evil/../x', 'image/png'), null);
});

test('profile avatar safe name rejects path tricks', () => {
    assert.equal(SAFE_PROFILE_AVATAR_NAME.test('student-1.webp'), true);
    assert.equal(SAFE_PROFILE_AVATAR_NAME.test('../student-1.webp'), false);
});

test('upload and GET profile avatar round-trip', async () => {
    const bucket = mockBucket();
    const env = { LOBBY_ASSETS: bucket };
    const pngPath = '/tmp/tiny-profile.png';
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
    fd.append('file', new Blob([png], { type: 'image/png' }), 'avatar.png');
    const uploadReq = new Request('http://lobby.test/api/auth/profile/avatar', { method: 'POST', body: fd });
    const uploadRes = await handleProfileAvatarUpload(uploadReq, env, 'student-99');
    assert.equal(uploadRes?.status, 200);
    const uploadJson = await uploadRes.json();
    assert.equal(uploadJson.ok, true);
    assert.match(uploadJson.avatarUrl, /student-99\.png$/);
    assert.equal(bucket.objects.size, 1);

    const filename = uploadJson.avatarUrl.split('/').pop();
    const getReq = new Request(publicProfileAvatarUrl(uploadReq, filename));
    const getRes = await handleProfileAvatarGet(getReq, env);
    assert.equal(getRes?.status, 200);
    const got = new Uint8Array(await getRes.arrayBuffer());
    assert.equal(got.length, png.length);
});