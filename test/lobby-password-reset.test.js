import assert from 'node:assert/strict';
import test from 'node:test';
import {
    initSqliteUsersDb,
    registerStudentSqlite,
    createPasswordResetTokenSqlite,
    consumePasswordResetTokenSqlite,
    verifyStudentSqlite,
} from '../db/users-sqlite.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

test('password reset token updates password once', async () => {
    const tmp = path.join(os.tmpdir(), `lobby-pw-reset-${process.pid}.db`);
    try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        initSqliteUsersDb(tmp);
        registerStudentSqlite('resetuser', 'OldPassw0rd!', 'Reset User');
        const { token } = createPasswordResetTokenSqlite('student', 1, 60_000);
        consumePasswordResetTokenSqlite(token, 'NewPassw0rd!');
        assert.equal(verifyStudentSqlite('resetuser', 'NewPassw0rd!')?.username, 'resetuser');
        assert.throws(() => consumePasswordResetTokenSqlite(token, 'AnotherPass1!'));
    } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
});