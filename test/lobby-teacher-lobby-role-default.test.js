import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    initSqliteUsersDb,
    patchLobbyUserFlagsSqlite,
    registerTeacherSqlite,
    verifyTeacherSqlite,
} from '../db/users-sqlite.js';
import { initUsersDb, resetUsersDbStateForTests } from '../db/users.js';
import { buildLobbyAuthUser } from '../lib/platform-lobby-auth-user.js';

function withTmpUsersDb(fn) {
    const tmp = path.join(os.tmpdir(), `lobby-teacher-role-${process.pid}-${Date.now()}.db`);
    const prevDb = process.env.USERS_DB_PATH;
    return (async () => {
        try {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
            process.env.USERS_DB_PATH = tmp;
            const db = initSqliteUsersDb(tmp);
            await initUsersDb();
            await fn(db);
        } finally {
            resetUsersDbStateForTests();
            if (prevDb === undefined) delete process.env.USERS_DB_PATH;
            else process.env.USERS_DB_PATH = prevDb;
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        }
    })();
}

test('verifyTeacherSqlite: NULL lobby_role is user not admin', async () => {
    await withTmpUsersDb(async (db) => {
        const teacher = registerTeacherSqlite('nullrole', 'TeacherPass9!', 'NullRole');
        db.prepare('UPDATE teachers SET lobby_role = NULL WHERE id = ?').run(teacher.id);
        const user = verifyTeacherSqlite('nullrole', 'TeacherPass9!');
        assert.ok(user);
        assert.equal(user.lobbyRole, 'user');
        const auth = buildLobbyAuthUser('teacher', user);
        assert.equal(auth.role, 'member');
        assert.equal(auth.lobbyRole, 'user');
    });
});

test('verifyTeacherSqlite: empty lobby_role is user; explicit admin unchanged', async () => {
    await withTmpUsersDb(async (db) => {
        const plain = registerTeacherSqlite('emptyrole', 'TeacherPass9!', 'Empty');
        db.prepare(`UPDATE teachers SET lobby_role = '' WHERE id = ?`).run(plain.id);
        const plainUser = verifyTeacherSqlite('emptyrole', 'TeacherPass9!');
        assert.equal(plainUser.lobbyRole, 'user');

        const admin = registerTeacherSqlite('realadmin', 'TeacherPass9!', 'Admin');
        patchLobbyUserFlagsSqlite('teacher', admin.id, { lobbyRole: 'admin' });
        const adminUser = verifyTeacherSqlite('realadmin', 'TeacherPass9!');
        assert.equal(adminUser.lobbyRole, 'admin');
        assert.equal(buildLobbyAuthUser('teacher', adminUser).role, 'admin');
    });
});