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
    getLobbyUserByIdSqlite,
    listBanHistorySqlite,
    consumePasswordResetTokenSqlite,
    createPasswordResetTokenSqlite,
    getUserForPasswordResetSqlite,
    verifyStudentSqlite,
    verifyTeacherSqlite,
    completeLobbyGoogleAuthSqlite,
    peekLobbyGoogleAuthSqlite,
    closeSqliteUsersDb,
    listLobbyWorldFavoritesSqlite,
    setLobbyWorldFavoriteSqlite,
    toggleLobbyWorldFavoriteSqlite,
} from './users-sqlite.js';
import { getPlatformUsersDbPath } from './users-path.js';
import { banLifecycleState, isBanActive, normalizeBanExpiresAt } from '../lib/lobby-ban.js';
import crypto from 'node:crypto';

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

/** @internal test isolation */
export function resetUsersDbStateForTests() {
    initialized = false;
    primaryBackend = null;
    sqliteReady = false;
    closeSqliteUsersDb();
}

const STUDENT_LOGIN_SELECT = `SELECT id, username, password_hash, display_name,
                        COALESCE(banned, 0) AS banned, ban_expires_at,
                        COALESCE(lobby_role, 'user') AS lobby_role,
                        COALESCE(email, '') AS email, COALESCE(avatar_url, '') AS avatar_url,
                        COALESCE(google_sub, '') AS google_sub FROM students`;

const TEACHER_LOGIN_SELECT = `SELECT id, username, password_hash, display_name,
                        COALESCE(banned, 0) AS banned, ban_expires_at,
                        COALESCE(lobby_role, 'admin') AS lobby_role,
                        COALESCE(email, '') AS email, COALESCE(avatar_url, '') AS avatar_url,
                        COALESCE(google_sub, '') AS google_sub FROM teachers`;

function mapVerifiedUserRow(row, kind, overrides = {}) {
    const banned =
        overrides.banned !== undefined ? Boolean(overrides.banned) : Boolean(row.banned);
    const banExpiresAt =
        overrides.banExpiresAt !== undefined
            ? overrides.banExpiresAt
            : row.ban_expires_at != null && String(row.ban_expires_at).trim() !== ''
              ? String(row.ban_expires_at)
              : null;
    return {
        id: Number(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        banned,
        banExpiresAt: banned ? banExpiresAt : null,
        lobbyRole: String(row.lobby_role || (kind === 'teacher' ? 'admin' : 'user')),
        email: String(row.email || ''),
        avatarUrl: String(row.avatar_url || ''),
        kind,
    };
}

async function insertBanHistoryD1(entry) {
    await d1Run(
        `INSERT INTO lobby_ban_history (id, user_kind, user_id, actor, action, started_at, ends_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            crypto.randomUUID(),
            String(entry.userKind),
            Number(entry.userId),
            entry.actor != null ? String(entry.actor) : null,
            String(entry.action),
            String(entry.startedAt),
            entry.endsAt != null && String(entry.endsAt).trim() !== '' ? String(entry.endsAt) : null,
        ],
    );
}

async function liftExpiredBanD1(kind, id, prevExpires) {
    const table = kind === 'teacher' ? 'teachers' : 'students';
    await d1Run(`UPDATE ${table} SET banned = 0, ban_expires_at = NULL WHERE id = ?`, [id]);
    await insertBanHistoryD1({
        userKind: kind,
        userId: id,
        actor: 'system',
        action: 'expire',
        startedAt: new Date().toISOString(),
        endsAt: prevExpires || null,
    });
}

async function materializeUserBanD1(kind, row) {
    const state = banLifecycleState(row.banned, row.ban_expires_at);
    if (state === 'expired') {
        await liftExpiredBanD1(kind, Number(row.id), String(row.ban_expires_at || ''));
        return mapVerifiedUserRow({ ...row, banned: 0, ban_expires_at: null }, kind, {
            banned: false,
            banExpiresAt: null,
        });
    }
    const banned = isBanActive(row.banned, row.ban_expires_at);
    return mapVerifiedUserRow(row, kind, { banned, banExpiresAt: row.ban_expires_at || null });
}

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
    return mapVerifiedUserRow(row, kind);
}

export async function verifyStudent(username, password) {
    return withUsersBackend(
        async () => {
            const row = await findUserLoginRowD1('student', username);
            if (!row) return null;
            const bcrypt = await import('bcryptjs');
            if (!bcrypt.default.compareSync(password, String(row.password_hash))) return null;
            return materializeUserBanD1('student', row);
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
            return materializeUserBanD1('teacher', row);
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

/**
 * @param {string} googleSub
 * @param {string} email
 */
async function peekLobbyGoogleAuthD1(googleSub, email) {
    const sub = String(googleSub || '').trim();
    const e = String(email || '').trim();
    if (!sub || !e) return { action: 'create' };
    for (const kind of ['student', 'teacher']) {
        const table = kind === 'teacher' ? 'teachers' : 'students';
        const row = await d1First(`SELECT id FROM ${table} WHERE google_sub = ?`, [sub]);
        if (row) return { action: 'login', kind };
    }
    if (await findUserLoginRowD1('student', e)) return { action: 'link', kind: 'student' };
    if (await findUserLoginRowD1('teacher', e)) return { action: 'link', kind: 'teacher' };
    return { action: 'create' };
}

export async function peekLobbyGoogleAuth(googleSub, email) {
    return withUsersBackend(
        () => peekLobbyGoogleAuthD1(googleSub, email),
        () => peekLobbyGoogleAuthSqlite(googleSub, email),
    );
}

/**
 * @param {{ googleSub: string, email: string, displayName?: string, emailVerified?: boolean }} input
 */
async function completeLobbyGoogleAuthD1(input) {
    const sub = String(input.googleSub || '').trim();
    const e = String(input.email || '').trim();
    if (!sub) {
        const err = new Error('google_sub_required');
        err.code = 'GOOGLE_SUB_REQUIRED';
        throw err;
    }
    if (!input.emailVerified) {
        const err = new Error('email_not_verified');
        err.code = 'EMAIL_NOT_VERIFIED';
        throw err;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        const err = new Error('invalid_email');
        err.code = 'INVALID_EMAIL';
        throw err;
    }

    for (const kind of ['student', 'teacher']) {
        const table = kind === 'teacher' ? TEACHER_LOGIN_SELECT : STUDENT_LOGIN_SELECT;
        const row = await d1First(`${table} WHERE google_sub = ?`, [sub]);
        if (row) {
            const user = await materializeUserBanD1(kind, row);
            if (user.banned) {
                const err = new Error('banned');
                err.code = 'BANNED';
                throw err;
            }
            return { kind, user, created: false };
        }
    }

    let kind = null;
    let row = await findUserLoginRowD1('student', e);
    if (row) kind = 'student';
    else {
        row = await findUserLoginRowD1('teacher', e);
        if (row) kind = 'teacher';
    }

    if (row && kind) {
        const existingSub = String(row.google_sub || '').trim();
        if (existingSub && existingSub !== sub) {
            const err = new Error('google_sub_mismatch');
            err.code = 'GOOGLE_SUB_MISMATCH';
            throw err;
        }
        const tableName = kind === 'teacher' ? 'teachers' : 'students';
        await d1Run(`UPDATE ${tableName} SET google_sub = ? WHERE id = ?`, [sub, row.id]);
        if (!String(row.email || '').trim()) {
            await d1Run(`UPDATE ${tableName} SET email = ? WHERE id = ?`, [e, row.id]);
        }
        const fresh = await d1First(
            `${kind === 'teacher' ? TEACHER_LOGIN_SELECT : STUDENT_LOGIN_SELECT} WHERE id = ?`,
            [row.id],
        );
        const user = await materializeUserBanD1(kind, fresh);
        if (user.banned) {
            const err = new Error('banned');
            err.code = 'BANNED';
            throw err;
        }
        return { kind, user, created: false };
    }

    const d = String(input.displayName || e).trim().slice(0, 64);
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
    const bcrypt = await import('bcryptjs');
    const placeholder = crypto.randomBytes(32).toString('base64url');
    const hash = bcrypt.default.hashSync(placeholder, 10);
    try {
        const result = await d1Run(
            'INSERT INTO students (username, password_hash, display_name, email, lobby_role, google_sub) VALUES (?, ?, ?, ?, ?, ?)',
            [e, hash, d, e, 'user', sub],
        );
        const newRow = await d1First(`${STUDENT_LOGIN_SELECT} WHERE id = ?`, [result.lastInsertRowid]);
        return { kind: 'student', user: await materializeUserBanD1('student', newRow), created: true };
    } catch (insertErr) {
        if (String(insertErr.message).includes('UNIQUE')) {
            const err = new Error('email_exists');
            err.code = 'EMAIL_EXISTS';
            throw err;
        }
        throw insertErr;
    }
}

/**
 * @param {{ googleSub: string, email: string, displayName?: string, emailVerified?: boolean }} input
 */
export async function completeLobbyGoogleAuth(input) {
    return withUsersBackend(
        () => completeLobbyGoogleAuthD1(input),
        () => completeLobbyGoogleAuthSqlite(input),
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

async function mapStudentRow(row) {
    const u = await materializeUserBanD1('student', row);
    return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        createdAt: row.created_at,
        banned: u.banned,
        banExpiresAt: u.banExpiresAt,
        lobbyRole: u.lobbyRole,
        email: u.email,
        kind: 'student',
    };
}

async function mapTeacherRow(row) {
    const u = await materializeUserBanD1('teacher', row);
    return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        createdAt: row.created_at,
        banned: u.banned,
        banExpiresAt: u.banExpiresAt,
        lobbyRole: u.lobbyRole,
        email: u.email,
        kind: 'teacher',
    };
}

export async function listStudents() {
    return withUsersBackend(
        async () => {
            const rows = await d1All(
                `SELECT id, username, display_name, created_at,
                        COALESCE(banned,0) AS banned, ban_expires_at,
                        COALESCE(lobby_role,'user') AS lobby_role,
                        COALESCE(email,'') AS email FROM students ORDER BY id`,
            );
            const out = [];
            for (const row of rows) out.push(await mapStudentRow(row));
            return out;
        },
        () => listStudentsSqlite()
    );
}

export async function listTeachers() {
    return withUsersBackend(
        async () => {
            const rows = await d1All(
                `SELECT id, username, display_name, created_at,
                        COALESCE(banned,0) AS banned, ban_expires_at,
                        COALESCE(lobby_role,'admin') AS lobby_role,
                        COALESCE(email,'') AS email FROM teachers ORDER BY id`,
            );
            const out = [];
            for (const row of rows) out.push(await mapTeacherRow(row));
            return out;
        },
        () => listTeachersSqlite()
    );
}

export async function getLobbyUserByKindId(kind, id) {
    return withUsersBackend(
        async () => {
            const table = kind === 'teacher' ? 'teachers' : 'students';
            const row = await d1First(
                `SELECT id, username, display_name, banned, ban_expires_at, lobby_role, email, avatar_url
                 FROM ${table} WHERE id = ?`,
                [id],
            );
            if (!row) return null;
            return materializeUserBanD1(kind, row);
        },
        () => getLobbyUserByIdSqlite(kind, id),
    );
}

export async function patchLobbyUserFlags(kind, id, patch) {
    return withUsersBackend(
        async () => {
            const table = kind === 'teacher' ? 'teachers' : 'students';
            const full = await d1First(
                `SELECT id, username, display_name, banned, ban_expires_at, lobby_role, email FROM ${table} WHERE id = ?`,
                [id],
            );
            if (!full) return null;
            const sets = [];
            const params = [];
            const nowIso = new Date().toISOString();
            if (patch.banned !== undefined) {
                const ban = Boolean(patch.banned);
                sets.push('banned = ?');
                params.push(ban ? 1 : 0);
                if (ban) {
                    const normalized =
                        patch.banExpiresAt !== undefined
                            ? normalizeBanExpiresAt(patch.banExpiresAt)
                            : undefined;
                    const expires =
                        normalized === undefined ? full.ban_expires_at || null : normalized;
                    sets.push('ban_expires_at = ?');
                    params.push(expires);
                    await insertBanHistoryD1({
                        userKind: kind,
                        userId: id,
                        actor: patch.actor,
                        action: 'ban',
                        startedAt: nowIso,
                        endsAt: expires,
                    });
                } else {
                    sets.push('ban_expires_at = NULL');
                    await insertBanHistoryD1({
                        userKind: kind,
                        userId: id,
                        actor: patch.actor,
                        action: 'unban',
                        startedAt: nowIso,
                        endsAt: null,
                    });
                }
            } else if (patch.banExpiresAt !== undefined) {
                sets.push('ban_expires_at = ?');
                params.push(normalizeBanExpiresAt(patch.banExpiresAt));
            }
            if (patch.lobbyRole !== undefined) {
                sets.push('lobby_role = ?');
                params.push(String(patch.lobbyRole));
            }
            if (patch.email !== undefined) {
                sets.push('email = ?');
                params.push(String(patch.email));
            }
            if (!sets.length) return materializeUserBanD1(kind, full);
            params.push(id);
            await d1Run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, params);
            const row = await d1First(
                `SELECT id, username, display_name, banned, ban_expires_at, lobby_role, email, avatar_url FROM ${table} WHERE id = ?`,
                [id],
            );
            if (!row) return null;
            return materializeUserBanD1(kind, row);
        },
        () => patchLobbyUserFlagsSqlite(kind, id, patch),
    );
}

export async function listLobbyBanHistory(kind, id, limit = 50) {
    return withUsersBackend(
        async () => {
            const rows = await d1All(
                `SELECT id, user_kind AS userKind, user_id AS userId, actor, action,
                        started_at AS startedAt, ends_at AS endsAt, created_at AS createdAt
                 FROM lobby_ban_history
                 WHERE user_kind = ? AND user_id = ?
                 ORDER BY created_at DESC
                 LIMIT ?`,
                [kind, id, limit],
            );
            return rows.map((r) => ({
                id: String(r.id),
                userKind: String(r.userKind),
                userId: Number(r.userId),
                actor: r.actor != null ? String(r.actor) : null,
                action: String(r.action),
                startedAt: String(r.startedAt),
                endsAt: r.endsAt != null ? String(r.endsAt) : null,
                createdAt: String(r.createdAt),
            }));
        },
        () => listBanHistorySqlite(kind, id, limit),
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

/**
 * @param {string} userRef
 */
export async function listLobbyWorldFavorites(userRef) {
    const key = String(userRef || '').trim();
    if (!key) return [];
    return withUsersBackend(
        async () => {
            const rows = await d1All(
                `SELECT world_slug FROM lobby_world_favorites WHERE user_ref = ?
                 ORDER BY datetime(created_at) DESC`,
                [key],
            );
            return (rows || []).map((r) => String(r.world_slug));
        },
        () => listLobbyWorldFavoritesSqlite(key),
    );
}

/**
 * @param {string} userRef
 * @param {string} worldSlug
 * @param {boolean} favorite
 */
export async function setLobbyWorldFavorite(userRef, worldSlug, favorite) {
    const key = String(userRef || '').trim();
    const slug = String(worldSlug || '').trim();
    if (!key || !slug) return false;
    return withUsersBackend(
        async () => {
            if (favorite) {
                await d1Run(
                    `INSERT INTO lobby_world_favorites (user_ref, world_slug) VALUES (?, ?)
                     ON CONFLICT(user_ref, world_slug) DO UPDATE SET created_at = datetime('now')`,
                    [key, slug],
                );
                return true;
            }
            const result = await d1Run(
                'DELETE FROM lobby_world_favorites WHERE user_ref = ? AND world_slug = ?',
                [key, slug],
            );
            return (result?.changes ?? 0) > 0;
        },
        () => setLobbyWorldFavoriteSqlite(key, slug, favorite),
    );
}

/**
 * @param {string} userRef
 * @param {string} worldSlug
 */
export async function toggleLobbyWorldFavorite(userRef, worldSlug) {
    const key = String(userRef || '').trim();
    const slug = String(worldSlug || '').trim();
    if (!key || !slug) return { favorite: false, toggled: false };
    return withUsersBackend(
        async () => {
            const existing = await d1First(
                'SELECT 1 AS ok FROM lobby_world_favorites WHERE user_ref = ? AND world_slug = ?',
                [key, slug],
            );
            if (existing) {
                await d1Run('DELETE FROM lobby_world_favorites WHERE user_ref = ? AND world_slug = ?', [key, slug]);
                return { favorite: false, toggled: true };
            }
            await d1Run('INSERT INTO lobby_world_favorites (user_ref, world_slug) VALUES (?, ?)', [key, slug]);
            return { favorite: true, toggled: true };
        },
        () => toggleLobbyWorldFavoriteSqlite(key, slug),
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
