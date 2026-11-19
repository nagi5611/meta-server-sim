import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAvatarSlot, avatarInitialFromName } from '../public/lobby-header-avatar.js';

test('avatarInitialFromName', () => {
    assert.equal(avatarInitialFromName('Alice'), 'A');
    assert.equal(avatarInitialFromName(''), '?');
});

test('applyAvatarSlot shows only image when url is set', () => {
    const initialEl = { textContent: '', hidden: false };
    const imgEl = /** @type {HTMLImageElement} */ ({
        hidden: true,
        src: '',
        complete: true,
        naturalWidth: 64,
        referrerPolicy: '',
        getAttribute: () => '',
        setAttribute() {},
        removeAttribute() {},
        onerror: null,
        onload: null,
    });
    Object.defineProperty(imgEl, 'src', {
        get() {
            return this._src || '';
        },
        set(v) {
            this._src = v;
        },
    });
    applyAvatarSlot({
        url: 'https://example.com/p.png',
        name: 'Bob',
        initialEl,
        imgEl,
    });
    assert.equal(imgEl.referrerPolicy, 'no-referrer');
    assert.equal(initialEl.hidden, false);
    assert.equal(imgEl.hidden, false);
    assert.equal(imgEl.src, 'https://example.com/p.png');
    assert.equal(initialEl.textContent, 'B');
    imgEl.onload?.();
    assert.equal(initialEl.hidden, true);
});

test('applyAvatarSlot falls back to initial when image errors', () => {
    const initialEl = { textContent: '', hidden: false };
    const imgEl = /** @type {HTMLImageElement} */ ({
        hidden: false,
        _src: '',
        complete: false,
        naturalWidth: 0,
        referrerPolicy: '',
        getAttribute: () => '',
        setAttribute() {},
        removeAttribute(attr) {
            if (attr === 'src') this._src = '';
        },
        onerror: null,
        onload: null,
    });
    Object.defineProperty(imgEl, 'src', {
        get() {
            return this._src || '';
        },
        set(v) {
            this._src = v;
        },
    });
    applyAvatarSlot({
        url: 'https://example.com/bad.png',
        name: 'Dan',
        initialEl,
        imgEl,
    });
    imgEl.onerror?.();
    assert.equal(initialEl.hidden, false);
    assert.equal(imgEl.hidden, true);
    assert.equal(imgEl.src, '');
});

test('applyAvatarSlot shows only initial without url', () => {
    const initialEl = { textContent: '', hidden: true };
    const imgEl = /** @type {HTMLImageElement} */ ({
        hidden: false,
        _src: 'x',
        complete: false,
        naturalWidth: 0,
        referrerPolicy: '',
        getAttribute: () => 'x',
        setAttribute() {},
        removeAttribute(attr) {
            if (attr === 'src') this._src = '';
        },
        onerror: null,
        onload: null,
    });
    Object.defineProperty(imgEl, 'src', {
        get() {
            return this._src || '';
        },
        set(v) {
            this._src = v;
        },
    });
    applyAvatarSlot({ url: '', name: 'Carol', initialEl, imgEl });
    assert.equal(initialEl.hidden, false);
    assert.equal(imgEl.hidden, true);
    assert.equal(imgEl.src, '');
});