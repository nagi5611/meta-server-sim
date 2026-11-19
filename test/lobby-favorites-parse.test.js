import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLobbyWorldSlug, parseLobbyUserRef } from '../lib/lobby-favorites-parse.js';

test('parseLobbyUserRef accepts student and teacher refs', () => {
    assert.deepEqual(parseLobbyUserRef('student-42'), { kind: 'student', id: 42, userRef: 'student-42' });
    assert.deepEqual(parseLobbyUserRef('teacher-7'), { kind: 'teacher', id: 7, userRef: 'teacher-7' });
    assert.equal(parseLobbyUserRef('bad'), null);
});

test('normalizeLobbyWorldSlug trims and validates', () => {
    assert.equal(normalizeLobbyWorldSlug(' tenant-p-01 '), 'tenant-p-01');
    assert.equal(normalizeLobbyWorldSlug('ok.world_1'), 'ok.world_1');
    assert.equal(normalizeLobbyWorldSlug(''), null);
    assert.equal(normalizeLobbyWorldSlug('has space'), null);
});
