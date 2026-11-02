// db/users.js — D1 優先、接続失敗時 data/users.db SQLite フォールバック

import { isD1UsersConfigured } from '../lib/d1/d1-config.js';
import { d1All, d1First, d1Run } from '../lib/d1/d1-http-client.js';
import {
    countStudentsSqlite,
    countTeachersSqlite,
    deleteStudentSqlite,
    deleteTeacherSqlite,
    initSqliteUsersDb,
    listStudentsSqlite,
    listTeachersSqlite,
    registerStudentSqlite,
    registerTeacherSqlite,
    sqliteUsersDbExists,
    updateStudentSqlite,
    updateTeacherSqlite,
    verifyStudentSqlite,
    verifyTeacherSqlite,
} from './users-sqlite.js';
import { getPlatformUsersDbPath } from './users-path.js';

/** @type {'d1' | 'sqlite' | null} */
let primaryBackend = null;
let initialized = false;
let sqliteReady = false;

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isD1TransportError(err) {
    const msg = String(err?.message || err || '');
    if (/fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network/i.test(msg)) return true;
    if (/Authentication error|Invalid access token|401|403/i.test(msg)) return true;
    if (/D1 query failed/i.test(msg)) return true;
    return false;
}

function ensureSqliteFallback() {
    if (!sqliteReady) {
        initSqliteUsersDb(getPlatformUsersDbPath());
        sqliteReady = true;
    }
}

/**
 * @template T
 * @param {() => Promise<T>} d1Fn
 * @param {() => T | Promise<T>} sqliteFn
 * @returns {Promise<T>}
 */
async function withUsersBackend(d1Fn, sqliteFn) {
    if (!initialized) throw new Error('Users DB not initialized; call initUsersDb() first');

    if (primaryBackend === 'd1') {
        try {
            return await d1Fn();
        } catch (err) {
            if (!isD1TransportError(err)) throw err;
            console.warn('[users] D1 unavailable, using local sqlite for this operation:', err.message);
            ensureSqliteFallback();
            return sqliteFn();
        }
    }

    ensureSqliteFallback();
    return sqliteFn();
}

export async function initUsersDb() {
    ensureSqliteFallback();

    if (isD1UsersConfigured()) {
        try {
            const students = await d1First('SELECT COUNT(*) AS c FROM students');
            const teachers = await d1First('SELECT COUNT(*) AS c FROM teachers');
            primaryBackend = 'd1';
            initialized = true;
            console.log(
                `[users] primary=D1 metaverse-sim (students=${students?.c ?? 0}, teachers=${teachers?.c ?? 0})`
            );
            console.log(`[users] fallback sqlite: ${getPlatformUsersDbPath()}`);
            return { backend: 'd1', students: Number(students?.c ?? 0), teachers: Number(teachers?.c ?? 0) };
        } catch (err) {
            console.warn('[users] D1 init failed, primary=local sqlite:', err.message);
        }
    } else {
        console.warn('[users] D1 not configured; using local sqlite only');
    }

    primaryBackend = 'sqlite';
    initialized = true;
    const students = countStudentsSqlite();
    const teachers = countTeachersSqlite();
    console.log(
        `[users] primary=sqlite ${getPlatformUsersDbPath()} (students=${students}, teachers=${teachers})`
    );
    return { backend: 'sqlite', students, teachers };
}

/**
 * @returns {{ backend: string | null, sqlitePath: string, sqliteExists: boolean }}
 */
export function getUsersDbStatus() {
    return {
        backend: primaryBackend,
        sqlitePath: getPlatformUsersDbPath(),
        sqliteExists: sqliteUsersDbExists(),
    };
}

export async function verifyStudent(username, password) {
    return withUsersBackend(
        async () => {
            const row = await d1First(
                'SELECT id, username, password_hash, display_name FROM students WHERE username = ?',
                [username.trim()]
            );
            if (!row) return null;
            const bcrypt = await import('bcryptjs');
            if (!bcrypt.default.compareSync(password, String(row.password_hash))) return null;
            return {
                id: Number(row.id),
                username: String(row.username),
                displayName: String(row.display_name),
            };
        },
        () => verifyStudentSqlite(username, password)
    );
}

export async function verifyTeacher(username, password) {
    return withUsersBackend(
        async () => {
            const row = await d1First(
                'SELECT id, username, password_hash, display_name FROM teachers WHERE username = ?',
                [username.trim()]
            );
            if (!row) return null;
            const bcrypt = await import('bcryptjs');
            if (!bcrypt.default.compareSync(password, String(row.password_hash))) return null;
            return {
                id: Number(row.id),
                username: String(row.username),
                displayName: String(row.display_name),
            };
        },
        () => verifyTeacherSqlite(username, password)
    );
}

export async function registerStudent(username, password, displayName) {
    return withUsersBackend(
        () => registerStudentD1(username, password, displayName),
        () => registerStudentSqlite(username, password, displayName)
    );
}

export async function registerTeacher(username, password, displayName) {
    return withUsersBackend(
        () => registerTeacherD1(username, password, displayName),
        () => registerTeacherSqlite(username, password, displayName)
    );
}

async function registerStudentD1(username, password, displayName) {
    const bcrypt = await import('bcryptjs');
    const { validateUserPassword } = await import('../lib/password-policy.js');
    const check = validateUserPassword(password);
    if (!check.ok) {
        const err = new Error(check.error);
        err.code = 'PASSWORD_POLICY';
        err.minLength = check.minLength;
        throw err;
    }
    const hash = bcrypt.default.hashSync(password, 10);
    const u = username.trim();
    const d = (displayName || u).trim();
    try {
        const result = await d1Run(
            'INSERT INTO students (username, password_hash, display_name) VALUES (?, ?, ?)',
            [u, hash, d]
        );
        return { id: result.lastInsertRowid, username: u, displayName: d };
    } catch (e) {
        if (String(e.message).includes('UNIQUE')) {
            const err = new Error('username_exists');
            err.code = 'SQLITE_CONSTRAINT_UNIQUE';
            throw err;
        }
        throw e;
    }
}

async function registerTeacherD1(username, password, displayName) {
    const bcrypt = await import('bcryptjs');
    const { validateUserPassword } = await import('../lib/password-policy.js');
    const check = validateUserPassword(password);
    if (!check.ok) {
        const err = new Error(check.error);
        err.code = 'PASSWORD_POLICY';
        err.minLength = check.minLength;
        throw err;
    }
    const hash = bcrypt.default.hashSync(password, 10);
    const u = username.trim();
    const d = (displayName || u).trim();
    try {
        const result = await d1Run(
            'INSERT INTO teachers (username, password_hash, display_name) VALUES (?, ?, ?)',
            [u, hash, d]
        );
        return { id: result.lastInsertRowid, username: u, displayName: d };
    } catch (e) {
        if (String(e.message).includes('UNIQUE')) {
            const err = new Error('username_exists');
            err.code = 'SQLITE_CONSTRAINT_UNIQUE';
            throw err;
        }
        throw e;
    }
}

export async function listStudents() {
    return withUsersBackend(
        () => d1All('SELECT id, username, display_name, created_at FROM students ORDER BY id'),
        () => listStudentsSqlite()
    );
}

export async function listTeachers() {
    return withUsersBackend(
        () => d1All('SELECT id, username, display_name, created_at FROM teachers ORDER BY id'),
        () => listTeachersSqlite()
    );
}

export async function updateStudent(id, fields) {
    return withUsersBackend(
        () => updateStudentD1(id, fields),
        () => updateStudentSqlite(id, fields)
    );
}

export async function updateTeacher(id, fields) {
    return withUsersBackend(
        () => updateTeacherD1(id, fields),
        () => updateTeacherSqlite(id, fields)
    );
}

async function updateStudentD1(id, { username, displayName, password } = {}) {
    const bcrypt = await import('bcryptjs');
    const { validateUserPassword } = await import('../lib/password-policy.js');
    const row = await d1First('SELECT id, username, display_name FROM students WHERE id = ?', [id]);
    if (!row) return null;
    const u = username !== undefined ? String(username).trim() : String(row.username);
    const d = displayName !== undefined ? String(displayName).trim() : String(row.display_name);
    if (password !== undefined && password !== null && String(password).length > 0) {
        const check = validateUserPassword(password);
        if (!check.ok) {
            const err = new Error(check.error);
            err.code = 'PASSWORD_POLICY';
            throw err;
        }
        const hash = bcrypt.default.hashSync(password, 10);
        await d1Run(
            'UPDATE students SET username = ?, display_name = ?, password_hash = ? WHERE id = ?',
            [u, d, hash, id]
        );
    } else {
        await d1Run('UPDATE students SET username = ?, display_name = ? WHERE id = ?', [u, d, id]);
    }
    return { id, username: u, displayName: d };
}

async function updateTeacherD1(id, { username, displayName, password } = {}) {
    const bcrypt = await import('bcryptjs');
    const { validateUserPassword } = await import('../lib/password-policy.js');
    const row = await d1First('SELECT id, username, display_name FROM teachers WHERE id = ?', [id]);
    if (!row) return null;
    const u = username !== undefined ? String(username).trim() : String(row.username);
    const d = displayName !== undefined ? String(displayName).trim() : String(row.display_name);
    if (password !== undefined && password !== null && String(password).length > 0) {
        const check = validateUserPassword(password);
        if (!check.ok) {
            const err = new Error(check.error);
            err.code = 'PASSWORD_POLICY';
            throw err;
        }
        const hash = bcrypt.default.hashSync(password, 10);
        await d1Run(
            'UPDATE teachers SET username = ?, display_name = ?, password_hash = ? WHERE id = ?',
            [u, d, hash, id]
        );
    } else {
        await d1Run('UPDATE teachers SET username = ?, display_name = ? WHERE id = ?', [u, d, id]);
    }
    return { id, username: u, displayName: d };
}

export async function deleteStudent(id) {
    return withUsersBackend(
        async () => (await d1Run('DELETE FROM students WHERE id = ?', [id])).changes > 0,
        () => deleteStudentSqlite(id)
    );
}

export async function deleteTeacher(id) {
    return withUsersBackend(
        async () => (await d1Run('DELETE FROM teachers WHERE id = ?', [id])).changes > 0,
        () => deleteTeacherSqlite(id)
    );
}

export async function createBenchUsers(_runId, _count) {
    throw new Error('bench_users is not available on D1 yet');
}

export async function deleteBenchUsers(_runId) {
    throw new Error('bench_users is not available on D1 yet');
}

export async function countBenchUsers() {
    return 0;
}
