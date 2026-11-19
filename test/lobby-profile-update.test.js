import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    initSqliteUsersDb,
    registerLobbyStudentSqlite,
    updateStudentSqlite,
    verifyStudentSqlite,
} from '../db/users-sqlite.js';

test('lobby user profile updates display_name in sqlite', () => {
    const tmp = path.join(os.tmpdir(), `lobby-profile-${process.pid}.db`);
    try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        initSqliteUsersDb(tmp);
        const created = registerLobbyStudentSqlite('player@example.com', 'WelcomePass8', 'Old Name');
        updateStudentSqlite(created.id, { displayName: 'Renamed Player' });
        assert.equal(verifyStudentSqlite('player@example.com', 'WelcomePass8')?.displayName, 'Renamed Player');
    } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
});