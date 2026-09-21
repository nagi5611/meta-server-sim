// test/fds-smoke-upload.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import {
    extractFdsSmokeZip,
    FdsSmokeUploadError,
    isValidSimId,
    simIdFromZipFilename,
} from '../lib/fds-smoke-upload.js';

/**
 * @returns {Buffer}
 */
function buildMinimalFdsSmokeZip() {
    const manifest = {
        quantity: 'TEST',
        frameCount: 2,
        dims: [2, 2, 2],
        times: [0, 1],
        valueMax: 1,
        bounds: { x: [0, 1], y: [0, 1], z: [0, 1] },
        dataFile: 'smoke.uint8.bin',
        dataType: 'uint8',
        layout: 'xi+zi*nx+yi*nx*ny (volumeResolution: nx,nz,ny)',
    };
    const zipped = zipSync({
        'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
        'smoke.uint8.bin': new Uint8Array(2 * 2 * 2 * 2),
    });
    return Buffer.from(zipped);
}

describe('fds-smoke-upload', () => {
    it('extractFdsSmokeZip accepts a minimal valid export', () => {
        const { entries, manifest } = extractFdsSmokeZip(buildMinimalFdsSmokeZip());
        assert.ok(entries['manifest.json']);
        assert.ok(entries['smoke.uint8.bin']);
        assert.equal(manifest.frameCount, 2);
    });

    it('simIdFromZipFilename and isValidSimId', () => {
        assert.equal(simIdFromZipFilename('my-run_v2.zip'), 'my-run_v2');
        assert.equal(isValidSimId('abc-01'), true);
        assert.equal(isValidSimId('../bad'), false);
    });

    it('rejects empty ZIP', () => {
        const empty = zipSync({});
        assert.throws(
            () => extractFdsSmokeZip(Buffer.from(empty)),
            (err) => err instanceof FdsSmokeUploadError && err.code === 'empty_zip',
        );
    });

    it('rejects ZIP larger than maxZipBytes', () => {
        const zip = buildMinimalFdsSmokeZip();
        assert.throws(
            () => extractFdsSmokeZip(zip, { maxZipBytes: 8 }),
            (err) => err instanceof FdsSmokeUploadError && err.code === 'too_large',
        );
    });

    it('rejects when uncompressed total exceeds limit', () => {
        const zip = buildMinimalFdsSmokeZip();
        assert.throws(
            () => extractFdsSmokeZip(zip, { maxUncompressedBytes: 32 }),
            (err) => err instanceof FdsSmokeUploadError && err.code === 'too_large',
        );
    });

    it('rejects too many ZIP entries', () => {
        /** @type {Record<string, Uint8Array>} */
        const files = {};
        for (let i = 0; i < 3; i += 1) {
            files[`f${i}.txt`] = new Uint8Array([i]);
        }
        const zip = Buffer.from(zipSync(files));
        assert.throws(
            () => extractFdsSmokeZip(zip, { maxEntries: 2 }),
            (err) => err instanceof FdsSmokeUploadError && err.code === 'too_many_entries',
        );
    });

    it('rejects path traversal in entry names', () => {
        const zip = Buffer.from(zipSync({
            '../evil.json': new TextEncoder().encode('{}'),
        }));
        assert.throws(
            () => extractFdsSmokeZip(zip),
            (err) => err instanceof FdsSmokeUploadError && err.code === 'invalid_path',
        );
    });

    it('rejects ZIP without manifest.json', () => {
        const zip = Buffer.from(zipSync({
            'readme.txt': new TextEncoder().encode('nope'),
        }));
        assert.throws(
            () => extractFdsSmokeZip(zip),
            (err) => err instanceof FdsSmokeUploadError && err.code === 'manifest_missing',
        );
    });
});
