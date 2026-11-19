import assert from 'node:assert/strict';
import { test } from 'node:test';
import { THUMBNAIL_MAX_BYTES } from '../src/lobby-assets.js';

const SAFE_THUMB_NAME = /^[a-f0-9-]+\.(jpe?g|png|webp|gif)$/i;

test('thumbnail max upload size is 10 MiB', () => {
    assert.equal(THUMBNAIL_MAX_BYTES, 10 * 1024 * 1024);
});

test('thumbnail object keys use safe public filenames', () => {
    assert.equal(SAFE_THUMB_NAME.test('550e8400-e29b-41d4-a716-446655440000.jpg'), true);
    assert.equal(SAFE_THUMB_NAME.test('550e8400-e29b-41d4-a716-446655440000.JPEG'), true);
    assert.equal(SAFE_THUMB_NAME.test('../etc/passwd'), false);
    assert.equal(SAFE_THUMB_NAME.test('thumb;DROP TABLE.jpg'), false);
});