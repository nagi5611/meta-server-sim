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
    registerLobbyStudentSqlite,
    registerTeacherSqlite,
    sqliteUsersDbExists,
    updateStudentSqlite,
    updateTeacherSqlite,
    patchLobbyUserFlagsSqlite,
    consumePasswordResetTokenSqlite,
    createPasswordResetTokenSqlite,
    getUserForPasswordResetSqlite,
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

const STUDENT_LOGIN_SELECT = `SELECT id, username, password_hash, display_name,
                        COALESCE(banned, 0) AS banned, COALESCE(lobby_role, 'user') AS lobby_role,
                        COALESCE(email, '') AS email, COALESCE(avatar_url, '') AS avatar_url FROM students`;

const TEACHER_LOGIN_SELECT = `SELECT id, username, password_hash, display_name,
                        COALESCE(banned, 0) AS banned, COALESCE(lobby_role, 'admin') AS lobby_role,
                        COALESCE(email, '') AS email, COALESCE(avatar_url, '') AS avatar_url FROM teachers`;

/**
 * @param {'student'|'teacher'} kind
 * @param {string} login
 */
async function findUserLoginRowD1(kind, login) {
    const key = String(login || '').trim();
    if (!key) return null;
    const table = kind === 'teacher' ? TEACHER_LOGIN_SELECT : STUDENT_LOGIN_SELECT;
    let row = await d1First(`${table} WHERE username = ?`, [key]);
    if (!row && key.includes('@')) {
        row = await d1First(`${table} WHERE email != '' AND lower(email) = lower(?)`, [key]);
    }
    return row;
}

function rowToVerifiedUser(row, kind) {
    return {
        id: Number(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        banned: Boolean(row.banned),
        lobbyRole: String(row.lobby_role || (kind === 'teacher' ? 'admin' : 'user')),
        email: String(row.email || ''),
        avatarUrl: String(row.avatar_url || ''),
        kind,
    };
}

export async function verifyStudent(username, password) {
    return withUsersBackend(
        async () => {
            const row = await findUserLoginRowD1('student', username);
            if (!row) return null;
            const bcrypt = await import('bcryptjs');
            if (!bcrypt.default.compareSync(password, String(row.password_hash))) return null;
            return rowToVerifiedUser(row, 'student');
        },
        () => verifyStudentSqlite(username, password)
    );
}

export async function verifyTeacher(username, password) {
    return withUsersBackend(
        async () => {
            const row = await findUserLoginRowD1('teacher', username);
            if (!row) return null;
            const bcrypt = await import('bcryptjs');
            if (!bcrypt.default.compareSync(password, String(row.password_hash))) return null;
            return rowToVerifiedUser(row, 'teacher');
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

/**
 * @param {string} email
 * @param {string} password
 * @param {string} displayName
 */
export async function registerLobbyStudent(email, password, displayName) {
    return withUsersBackend(
        () => registerLobbyStudentD1(email, password, displayName),
        () => registerLobbyStudentSqlite(email, password, displayName)
    );
}

async function lobbyLoginEmailTakenD1(email) {
    const e = email.trim();
    for (const table of ['students', 'teachers']) {
        const row = await d1First(
            `SELECT id FROM ${table} WHERE lower(username) = lower(?) OR (COALESCE(email,'') != '' AND lower(email) = lower(?)) LIMIT 1`,
            [e, e],
        );
        if (row) return true;
    }
    return false;
}

async function registerLobbyStudentD1(email, password, displayName) {
    const bcrypt = await import('bcryptjs');
    const { validateUserPassword } = await import('../lib/password-policy.js');
    const check = validateUserPassword(password);
    if (!check.ok) {
        const err = new Error(check.error);
        err.code = 'PASSWORD_POLICY';
        err.minLength = check.minLength;
        throw err;
    }
    const e = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        const err = new Error('invalid_email');
        err.code = 'INVALID_EMAIL';
        throw err;
    }
    const d = String(displayName || e).trim().slice(0, 64);
    if (!d) {
        const err = new Error('name_required');
        err.code = 'NAME_REQUIRED';
        throw err;
    }
    if (await lobbyLoginEmailTakenD1(e)) {
        const err = new Error('email_exists');
        err.code = 'EMAIL_EXISTS';
        throw err;
    }
    const hash = bcrypt.default.hashSync(password, 10);
    try {
        const result = await d1Run(
            'INSERT INTO students (username, password_hash, display_name, email, lobby_role) VALUES (?, ?, ?, ?, ?)',
            [e, hash, d, e, 'user'],
        );
        return { id: result.lastInsertRowid, username: e, displayName: d, email: e };
    } catch (insertErr) {
        if (String(insertErr.message).includes('UNIQUE')) {
            const err = new Error('email_exists');
            err.code = 'EMAIL_EXISTS';
            throw err;
        }
        throw insertErr;
    }
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

function mapStudentRow(row) {
    return {
        id: Number(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        createdAt: row.created_at,
        banned: Boolean(row.banned),
        lobbyRole: String(row.lobby_role || 'user'),
        email: String(row.email || ''),
        kind: 'student',
    };
}

function mapTeacherRow(row) {
    return {
        id: Number(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        createdAt: row.created_at,
        banned: Boolean(row.banned),
        lobbyRole: String(row.lobby_role || 'admin'),
        email: String(row.email || ''),
        kind: 'teacher',
    };
}

export async function listStudents() {
    return withUsersBackend(
        async () => {
            const rows = await d1All(
                `SELECT id, username, display_name, created_at,
                        COALESCE(banned,0) AS banned, COALESCE(lobby_role,'user') AS lobby_role,
                        COALESCE(email,'') AS email FROM students ORDER BY id`,
            );
            return rows.map(mapStudentRow);
        },
        () => listStudentsSqlite()
    );
}

export async function listTeachers() {
    return withUsersBackend(
        async () => {
            const rows = await d1All(
                `SELECT id, username, display_name, created_at,
                        COALESCE(banned,0) AS banned, COALESCE(lobby_role,'admin') AS lobby_role,
                        COALESCE(email,'') AS email FROM teachers ORDER BY id`,
            );
            return rows.map(mapTeacherRow);
        },
        () => listTeachersSqlite()
    );
}

/**
 * @param {'student'|'teacher'} kind
 * @param {number} id
 * @param {{ banned?: boolean, lobbyRole?: string, email?: string }} patch
 */
export async function patchLobbyUserFlags(kind, id, patch) {
    return withUsersBackend(
        async () => {
            const table = kind === 'teacher' ? 'teachers' : 'students';
            const sets = [];
            const params = [];
            if (patch.banned !== undefined) {
                sets.push('banned = ?');
                params.push(patch.banned ? 1 : 0);
            }
            if (patch.lobbyRole !== undefined) {
                sets.push('lobby_role = ?');
                params.push(String(patch.lobbyRole));
            }
            if (patch.email !== undefined) {
                sets.push('email = ?');
                params.push(String(patch.email));
            }
            if (!sets.length) return null;
            params.push(id);
            await d1Run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, params);
            const row = await d1First(
                `SELECT id, username, display_name, banned, lobby_role, email FROM ${table} WHERE id = ?`,
                [id],
            );
            if (!row) return null;
            return kind === 'teacher' ? mapTeacherRow({ ...row, created_at: null }) : mapStudentRow({ ...row, created_at: null });
        },
        () => patchLobbyUserFlagsSqlite(kind, id, patch),
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

async function updateStudentD1(id, { username, displayName, avatarUrl, password } = {}) {
    const bcrypt = await import('bcryptjs');
    const { validateUserPassword } = await import('../lib/password-policy.js');
    const row = await d1First('SELECT id, username, display_name, avatar_url FROM students WHERE id = ?', [id]);
    if (!row) return null;
    const u = username !== undefined ? String(username).trim() : String(row.username);
    const d = displayName !== undefined ? String(displayName).trim() : String(row.display_name);
    const av =
        avatarUrl !== undefined ? String(avatarUrl || '').trim() : String(row.avatar_url || '');
    if (password !== undefined && password !== null && String(password).length > 0) {
        const check = validateUserPassword(password);
        if (!check.ok) {
            const err = new Error(check.error);
            err.code = 'PASSWORD_POLICY';
            throw err;
        }
        const hash = bcrypt.default.hashSync(password, 10);
        await d1Run(
            'UPDATE students SET username = ?, display_name = ?, avatar_url = ?, password_hash = ? WHERE id = ?',
            [u, d, av, hash, id]
        );
    } else {
        await d1Run('UPDATE students SET username = ?, display_name = ?, avatar_url = ? WHERE id = ?', [
            u,
            d,
            av,
            id,
        ]);
    }
    return { id, username: u, displayName: d, avatarUrl: av };
}

async function updateTeacherD1(id, { username, displayName, avatarUrl, password } = {}) {
    const bcrypt = await import('bcryptjs');
    const { validateUserPassword } = await import('../lib/password-policy.js');
    const row = await d1First('SELECT id, username, display_name, avatar_url FROM teachers WHERE id = ?', [id]);
    if (!row) return null;
    const u = username !== undefined ? String(username).trim() : String(row.username);
    const d = displayName !== undefined ? String(displayName).trim() : String(row.display_name);
    const av =
        avatarUrl !== undefined ? String(avatarUrl || '').trim() : String(row.avatar_url || '');
    if (password !== undefined && password !== null && String(password).length > 0) {
        const check = validateUserPassword(password);
        if (!check.ok) {
            const err = new Error(check.error);
            err.code = 'PASSWORD_POLICY';
            throw err;
        }
        const hash = bcrypt.default.hashSync(password, 10);
        await d1Run(
            'UPDATE teachers SET username = ?, display_name = ?, avatar_url = ?, password_hash = ? WHERE id = ?',
            [u, d, av, hash, id]
        );
    } else {
        await d1Run('UPDATE teachers SET username = ?, display_name = ?, avatar_url = ? WHERE id = ?', [
            u,
            d,
            av,
            id,
        ]);
    }
    return { id, username: u, displayName: d, avatarUrl: av };
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

/**
 * @param {'student'|'teacher'} kind
 * @param {number} id
 */
export async function getUserForPasswordReset(kind, id) {
    return withUsersBackend(
        async () => {
            const table = kind === 'teacher' ? 'teachers' : 'students';
            const row = await d1First(
                `SELECT id, username, display_name, COALESCE(email,'') AS email FROM ${table} WHERE id = ?`,
                [id],
            );
            if (!row) return null;
            return {
                id: Number(row.id),
                username: String(row.username),
                displayName: String(row.display_name),
                email: String(row.email || ''),
                kind,
            };
        },
        () => getUserForPasswordResetSqlite(kind, id),
    );
}

/**
 * @param {'student'|'teacher'} kind
 * @param {number} id
 * @param {number} ttlMs
 */
export async function createPasswordResetToken(kind, id, ttlMs) {
    return withUsersBackend(
        () => createPasswordResetTokenD1(kind, id, ttlMs),
        () => createPasswordResetTokenSqlite(kind, id, ttlMs),
    );
}

/**
 * @param {string} token
 * @param {string} newPassword
 */
export async function consumePasswordResetToken(token, newPassword) {
    return withUsersBackend(
        () => consumePasswordResetTokenD1(token, newPassword),
        () => consumePasswordResetTokenSqlite(token, newPassword),
    );
}

async function createPasswordResetTokenD1(kind, id, ttlMs) {
    const crypto = await import('node:crypto');
    const token = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + ttlMs);
    await d1Run('DELETE FROM password_reset_tokens WHERE user_kind = ? AND user_id = ?', [kind, id]);
    await d1Run(
        'INSERT INTO password_reset_tokens (token_hash, user_kind, user_id, expires_at) VALUES (?, ?, ?, ?)',
        [hash, kind, id, expiresAt.toISOString()],
    );
    return { token, expiresAt };
}

async function consumePasswordResetTokenD1(token, newPassword) {
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const row = await d1First('SELECT * FROM password_reset_tokens WHERE token_hash = ?', [hash]);
    if (!row || row.used_at) {
        const err = new Error('invalid_or_used_token');
        err.code = 'INVALID_TOKEN';
        throw err;
    }
    if (new Date(String(row.expires_at)).getTime() < Date.now()) {
        const err = new Error('token_expired');
        err.code = 'TOKEN_EXPIRED';
        throw err;
    }
    const kind = row.user_kind === 'teacher' ? 'teacher' : 'student';
    const userId = Number(row.user_id);
    if (kind === 'teacher') {
        await updateTeacher(userId, { password: newPassword });
    } else {
        await updateStudent(userId, { password: newPassword });
    }
    await d1Run(`UPDATE password_reset_tokens SET used_at = datetime('now') WHERE token_hash = ?`, [hash]);
    return { ok: true, kind, userId };
}
