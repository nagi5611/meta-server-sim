import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLobbyUserRef, isLobbyUserRefBanned } from '../lib/lobby-user-ban.js';
import { initSqliteUsersDb, patchLobbyUserFlagsSqlite, registerLobbyStudentSqlite } from '../db/users-sqlite.js';
import { initUsersDb, resetUsersDbStateForTests } from '../db/users.js';

test('parseLobbyUserRef accepts student and teacher refs', () => {
    assert.deepEqual(parseLobbyUserRef('student-42'), { kind: 'student', id: 42 });
    assert.equal(parseLobbyUserRef(''), null);
});

test('isLobbyUserRefBanned reflects patchLobbyUserFlags', async () => {
    const tmp = path.join(os.tmpdir(), `lobby-user-ban-${process.pid}-${Date.now()}.db`);
    const prevDb = process.env.USERS_DB_PATH;
    try {
        process.env.USERS_DB_PATH = tmp;
        initSqliteUsersDb(tmp);
        await initUsersDb();
        const student = registerLobbyStudentSqlite('sockban@example.com', 'WelcomePass8', 'Sock');
        patchLobbyUserFlagsSqlite('student', student.id, { banned: true });
        assert.equal(await isLobbyUserRefBanned(`student-${student.id}`), true);
    } finally {
        resetUsersDbStateForTests();
        if (prevDb === undefined) delete process.env.USERS_DB_PATH;
        else process.env.USERS_DB_PATH = prevDb;
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
});
