import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    initSqliteUsersDb,
    registerLobbyStudentSqlite,
    registerStudentSqlite,
    verifyStudentSqlite,
} from '../db/users-sqlite.js';

test('lobby signup registers student with email login', () => {
    const tmp = path.join(os.tmpdir(), `lobby-signup-${process.pid}.db`);
    try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        initSqliteUsersDb(tmp);
        const created = registerLobbyStudentSqlite('newbie@example.com', 'WelcomePass8', 'New Player');
        assert.equal(created.username, 'newbie@example.com');
        assert.equal(verifyStudentSqlite('newbie@example.com', 'WelcomePass8')?.displayName, 'New Player');
        assert.throws(
            () => registerLobbyStudentSqlite('newbie@example.com', 'WelcomePass8', 'Dup'),
            (err) => err.code === 'EMAIL_EXISTS',
        );
        registerStudentSqlite('clash@example.com', 'LegacyPass8!', 'Legacy');
        assert.throws(
            () => registerLobbyStudentSqlite('clash@example.com', 'WelcomePass8', 'Clash'),
            (err) => err.code === 'EMAIL_EXISTS',
        );
    } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
});