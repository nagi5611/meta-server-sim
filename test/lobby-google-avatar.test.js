import assert from 'node:assert/strict';
import test from 'node:test';
import {
    googleAvatarUrlToStore,
    isLobbyHostedAvatarUrl,
    normalizeGooglePictureUrl,
    shouldSyncGoogleAvatar,
} from '../lib/lobby-google-avatar.js';

const GOOGLE_PIC = 'https://lh3.googleusercontent.com/a-/AOh14GjExample=s96-c';
const GOOGLE_PIC2 = 'https://lh3.googleusercontent.com/a-/AOh14GjOther=s96-c';
const HOSTED = 'https://m.example.test/api/assets/profile-avatars/student-7.webp';

test('normalizeGooglePictureUrl accepts googleusercontent https URLs', () => {
    assert.equal(normalizeGooglePictureUrl(GOOGLE_PIC), GOOGLE_PIC);
    assert.equal(normalizeGooglePictureUrl('http://evil.test/x'), '');
    assert.equal(normalizeGooglePictureUrl('https://evil.test/x'), '');
});

test('isLobbyHostedAvatarUrl detects R2 profile paths', () => {
    assert.equal(isLobbyHostedAvatarUrl(HOSTED), true);
    assert.equal(isLobbyHostedAvatarUrl(GOOGLE_PIC), false);
});

test('shouldSyncGoogleAvatar fills empty or stale Google URLs but not custom uploads', () => {
    assert.equal(shouldSyncGoogleAvatar('', GOOGLE_PIC), true);
    assert.equal(shouldSyncGoogleAvatar(GOOGLE_PIC, GOOGLE_PIC2), true);
    assert.equal(shouldSyncGoogleAvatar(GOOGLE_PIC, GOOGLE_PIC), false);
    assert.equal(shouldSyncGoogleAvatar(HOSTED, GOOGLE_PIC2), false);
});

test('googleAvatarUrlToStore returns normalized URL when appropriate', () => {
    assert.equal(googleAvatarUrlToStore('', GOOGLE_PIC), GOOGLE_PIC);
    assert.equal(googleAvatarUrlToStore(HOSTED, GOOGLE_PIC2), null);
});