import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, '../public/admin-thumbnail.js'), 'utf8');

test('thumbnail resize max pixels match lobby 3-col card at 2x retina', () => {
    assert.match(src, /THUMBNAIL_LOBBY_CARD_MAX_DISPLAY_W = 355/);
    assert.match(src, /THUMBNAIL_RETINA_SCALE = 2/);
    assert.match(src, /THUMBNAIL_LOBBY_CARD_MAX_DISPLAY_W \* THUMBNAIL_RETINA_SCALE/);
    // 355px lobby card × 2 retina → 710×399 output
    assert.equal(355 * 2, 710);
    assert.equal(Math.round((710 * 9) / 16), 399);
    assert.match(src, /THUMBNAIL_MAX_HEIGHT_PX = Math\.round\(\(THUMBNAIL_MAX_WIDTH_PX \* 9\) \/ 16\)/);
    assert.match(src, /THUMBNAIL_WEBP_QUALITY = 0\.85/);
    assert.match(src, /THUMBNAIL_MAX_BYTES = 10 \* 1024 \* 1024/);
});

test('admin panel uploads resized blob via existing API', () => {
    const panel = readFileSync(join(dir, '../public/admin/panel.js'), 'utf8');
    assert.match(panel, /resizeThumbnailFile\(file\)/);
    assert.match(panel, /uploadThumbnail\(uploadFile/);
    assert.doesNotMatch(panel, /size > THUMB_MAX_BYTES/);
});

test('admin index loads admin-thumbnail module', () => {
    const html = readFileSync(join(dir, '../public/admin/index.html'), 'utf8');
    assert.match(html, /import '\/admin-thumbnail\.js'/);
});