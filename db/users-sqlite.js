// db/users-sqlite.js — ローカル SQLite users.db（D1 フォールバック）

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { validateUserPassword } from '../lib/password-policy.js';
import { banLifecycleState, isBanActive, normalizeBanExpiresAt } from '../lib/lobby-ban.js';
import { googleAvatarUrlToStore } from '../lib/lobby-google-avatar.js';
import { ensurePlatformUsersDbDir, getPlatformUsersDbPath } from './users-path.js';

const BCRYPT_ROUNDS = 10;

/** @type {import('better-sqlite3').Database | null} */
let db = null;

/**
 * @param {unknown} password
 */
function assertPasswordPolicy(password) {
    const check = validateUserPassword(password);
    if (!check.ok) {
        const err = new Error(check.error);
        err.code = 'PASSWORD_POLICY';
        err.minLength = check.minLength;
        throw err;
    }
}

/**
 * @param {string} [dbPath]
 */
export function initSqliteUsersDb(dbPath = getPlatformUsersDbPath()) {
    if (db) return db;
    ensurePlatformUsersDbDir(dbPath);
    db = new Database(dbPath);
    db.exec(`
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS teachers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
    `);
    ensureLobbyUserColumns(db);
    ensureBanHistoryTable(db);
    db.exec(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            token_hash TEXT PRIMARY KEY,
            user_kind TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            used_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens (user_kind, user_id);
        CREATE TABLE IF NOT EXISTS lobby_world_favorites (
            user_ref TEXT NOT NULL,
            world_slug TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (user_ref, world_slug)
        );
        CREATE INDEX IF NOT EXISTS idx_lobby_world_favorites_user
            ON lobby_world_favorites (user_ref, created_at DESC);
    `);
    return db;
}

/**
 * @param {import('better-sqlite3').Database} database
 */
function ensureLobbyUserColumns(database) {
    const addCol = (table, sql) => {
        try {
            database.exec(sql);
        } catch {
            /* column exists */
        }
    };
    for (const table of ['students', 'teachers']) {
        addCol(table, `ALTER TABLE ${table} ADD COLUMN banned INTEGER DEFAULT 0`);
        addCol(table, `ALTER TABLE ${table} ADD COLUMN lobby_role TEXT DEFAULT 'user'`);
        addCol(table, `ALTER TABLE ${table} ADD COLUMN email TEXT DEFAULT ''`);
        addCol(table, `ALTER TABLE ${table} ADD COLUMN avatar_url TEXT DEFAULT ''`);
        addCol(table, `ALTER TABLE ${table} ADD COLUMN ban_expires_at TEXT`);
        addCol(table, `ALTER TABLE ${table} ADD COLUMN google_sub TEXT DEFAULT ''`);
    }
    try {
        database.exec(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_students_google_sub ON students (google_sub)
                WHERE google_sub IS NOT NULL AND google_sub != '';
            CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_google_sub ON teachers (google_sub)
                WHERE google_sub IS NOT NULL AND google_sub != '';
        `);
    } catch {
        /* index exists */
    }
}

function ensureBanHistoryTable(database) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS lobby_ban_history (
            id TEXT PRIMARY KEY,
            user_kind TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            actor TEXT,
            action TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ends_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_lobby_ban_history_user
            ON lobby_ban_history (user_kind, user_id, created_at DESC);
    `);
}

function requireDb() {
    if (!db) throw new Error('SQLite users DB not initialized');
    return db;
}

/** @internal test isolation */
export function closeSqliteUsersDb() {
    if (db) {
        try {
            db.close();
        } catch {
            /* already closed */
        }
        db = null;
    }
}

function rowToLobbyUser(row, kind, overrides = {}) {
    const banned =
        overrides.banned !== undefined ? Boolean(overrides.banned) : Boolean(row.banned);
    const banExpiresAt =
        overrides.banExpiresAt !== undefined
            ? overrides.banExpiresAt
            : row.ban_expires_at != null && String(row.ban_expires_at).trim() !== ''
              ? String(row.ban_expires_at)
              : null;
    return {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        banned,
        banExpiresAt: banned ? banExpiresAt : null,
        lobbyRole: String(row.lobby_role || 'user'),
        email: String(row.email || ''),
        avatarUrl: String(row.avatar_url || ''),
        kind,
    };
}

function insertBanHistorySqlite(entry) {
    requireDb()
        .prepare(
            `INSERT INTO lobby_ban_history (id, user_kind, user_id, actor, action, started_at, ends_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
            crypto.randomUUID(),
            String(entry.userKind),
            Number(entry.userId),
            entry.actor != null ? String(entry.actor) : null,
            String(entry.action),
            String(entry.startedAt),
            entry.endsAt != null && String(entry.endsAt).trim() !== '' ? String(entry.endsAt) : null,
        );
}

function liftExpiredBanSqlite(kind, id, prevExpires) {
    const table = kind === 'teacher' ? 'teachers' : 'students';
    requireDb()
        .prepare(`UPDATE ${table} SET banned = 0, ban_expires_at = NULL WHERE id = ?`)
        .run(id);
    insertBanHistorySqlite({
        userKind: kind,
        userId: id,
        actor: 'system',
        action: 'expire',
        startedAt: new Date().toISOString(),
        endsAt: prevExpires || null,
    });
}

function materializeUserBanSqlite(kind, row) {
    const state = banLifecycleState(row.banned, row.ban_expires_at);
    if (state === 'expired') {
        liftExpiredBanSqlite(kind, Number(row.id), String(row.ban_expires_at || ''));
        return rowToLobbyUser({ ...row, banned: 0, ban_expires_at: null }, kind, {
            banned: false,
            banExpiresAt: null,
        });
    }
    const banned = isBanActive(row.banned, row.ban_expires_at);
    return rowToLobbyUser(row, kind, { banned, banExpiresAt: row.ban_expires_at || null });
}

function findStudentLoginRowSqlite(login) {
    const key = String(login || '').trim();
    if (!key) return null;
    const byUser = requireDb()
        .prepare(
            'SELECT id, username, password_hash, display_name, banned, ban_expires_at, lobby_role, email, avatar_url, google_sub FROM students WHERE username = ?',
        )
        .get(key);
    if (byUser) return byUser;
    if (!key.includes('@')) return null;
    return requireDb()
        .prepare(
            `SELECT id, username, password_hash, display_name, banned, ban_expires_at, lobby_role, email, avatar_url, google_sub
             FROM students WHERE email != '' AND lower(email) = lower(?)`,
        )
        .get(key);
}

function findTeacherLoginRowSqlite(login) {
    const key = String(login || '').trim();
    if (!key) return null;
    const byUser = requireDb()
        .prepare(
            'SELECT id, username, password_hash, display_name, banned, ban_expires_at, lobby_role, email, avatar_url, google_sub FROM teachers WHERE username = ?',
        )
        .get(key);
    if (byUser) return byUser;
    if (!key.includes('@')) return null;
    return requireDb()
        .prepare(
            `SELECT id, username, password_hash, display_name, banned, ban_expires_at, lobby_role, email, avatar_url, google_sub
             FROM teachers WHERE email != '' AND lower(email) = lower(?)`,
        )
        .get(key);
}

export function verifyStudentSqlite(username, password) {
    const row = findStudentLoginRowSqlite(username);
    if (!row) return null;
    if (!bcrypt.compareSync(password, row.password_hash)) return null;
    return materializeUserBanSqlite('student', row);
}

export function verifyTeacherSqlite(username, password) {
    const row = findTeacherLoginRowSqlite(username);
    if (!row) return null;
    if (!bcrypt.compareSync(password, row.password_hash)) return null;
    return materializeUserBanSqlite('teacher', row);
}

export function registerStudentSqlite(username, password, displayName) {
    assertPasswordPolicy(password);
    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    const u = username.trim();
    const d = (displayName || u).trim();
    const result = requireDb()
        .prepare('INSERT INTO students (username, password_hash, display_name) VALUES (?, ?, ?)')
        .run(u, hash, d);
    return { id: Number(result.lastInsertRowid), username: u, displayName: d };
}

function lobbyLoginEmailTakenSqlite(email) {
    const e = email.trim();
    const sql = `SELECT id FROM %s WHERE lower(username) = lower(?) OR (email != '' AND lower(email) = lower(?)) LIMIT 1`;
    for (const table of ['students', 'teachers']) {
        const row = requireDb()
            .prepare(sql.replace('%s', table))
            .get(e, e);
        if (row) return true;
    }
    return false;
}

/**
 * Public lobby signup — email as username with dedicated email column for login lookup.
 * @param {string} email
 * @param {string} password
 * @param {string} displayName
 */
export function registerLobbyStudentSqlite(email, password, displayName) {
    assertPasswordPolicy(password);
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
    if (lobbyLoginEmailTakenSqlite(e)) {
        const err = new Error('email_exists');
        err.code = 'EMAIL_EXISTS';
        throw err;
    }
    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    try {
        const result = requireDb()
            .prepare(
                'INSERT INTO students (username, password_hash, display_name, email, lobby_role) VALUES (?, ?, ?, ?, ?)',
            )
            .run(e, hash, d, e, 'user');
        return { id: Number(result.lastInsertRowid), username: e, displayName: d, email: e };
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
 * @param {string} googleSub
 * @param {string} email
 * @returns {{ action: 'login' | 'link' | 'create', kind?: 'student' | 'teacher' }}
 */
export function peekLobbyGoogleAuthSqlite(googleSub, email) {
    const sub = String(googleSub || '').trim();
    const e = String(email || '').trim();
    if (!sub || !e) return { action: 'create' };
    for (const { table, kind } of [
        { table: 'students', kind: 'student' },
        { table: 'teachers', kind: 'teacher' },
    ]) {
        const row = requireDb()
            .prepare(`SELECT id FROM ${table} WHERE google_sub = ?`)
            .get(sub);
        if (row) return { action: 'login', kind };
    }
    if (findStudentLoginRowSqlite(e)) return { action: 'link', kind: 'student' };
    if (findTeacherLoginRowSqlite(e)) return { action: 'link', kind: 'teacher' };
    return { action: 'create' };
}

/**
 * @param {'students' | 'teachers'} table
 * @param {number} id
 * @param {string} existingAvatarUrl
 * @param {string | undefined} picture
 * @returns {string}
 */
function persistGoogleAvatarSqlite(table, id, existingAvatarUrl, picture) {
    const next = googleAvatarUrlToStore(existingAvatarUrl, picture || '');
    if (!next) return String(existingAvatarUrl || '');
    requireDb().prepare(`UPDATE ${table} SET avatar_url = ? WHERE id = ?`).run(next, id);
    return next;
}

/**
 * @param {{ googleSub: string, email: string, displayName?: string, emailVerified?: boolean, picture?: string }} input
 */
export function completeLobbyGoogleAuthSqlite(input) {
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

    for (const { table, kind } of [
        { table: 'students', kind: 'student' },
        { table: 'teachers', kind: 'teacher' },
    ]) {
        const row = requireDb()
            .prepare(
                `SELECT id, username, password_hash, display_name, banned, ban_expires_at, lobby_role, email, avatar_url, google_sub
                 FROM ${table} WHERE google_sub = ?`,
            )
            .get(sub);
        if (row) {
            const user = materializeUserBanSqlite(kind, row);
            if (user.banned) {
                const err = new Error('banned');
                err.code = 'BANNED';
                throw err;
            }
            const av = persistGoogleAvatarSqlite(table, user.id, user.avatarUrl, input.picture);
            if (av) user.avatarUrl = av;
            return { kind, user, created: false };
        }
    }

    let kind = null;
    let row = findStudentLoginRowSqlite(e);
    if (row) kind = 'student';
    else {
        row = findTeacherLoginRowSqlite(e);
        if (row) kind = 'teacher';
    }

    if (row && kind) {
        const existingSub = String(row.google_sub || '').trim();
        if (existingSub && existingSub !== sub) {
            const err = new Error('google_sub_mismatch');
            err.code = 'GOOGLE_SUB_MISMATCH';
            throw err;
        }
        const table = kind === 'teacher' ? 'teachers' : 'students';
        requireDb().prepare(`UPDATE ${table} SET google_sub = ? WHERE id = ?`).run(sub, row.id);
        if (!String(row.email || '').trim()) {
            requireDb().prepare(`UPDATE ${table} SET email = ? WHERE id = ?`).run(e, row.id);
        }
        const fresh = requireDb()
            .prepare(
                `SELECT id, username, password_hash, display_name, banned, ban_expires_at, lobby_role, email, avatar_url, google_sub
                 FROM ${table} WHERE id = ?`,
            )
            .get(row.id);
        const user = materializeUserBanSqlite(kind, fresh);
        if (user.banned) {
            const err = new Error('banned');
            err.code = 'BANNED';
            throw err;
        }
        const av = persistGoogleAvatarSqlite(table, user.id, user.avatarUrl, input.picture);
        if (av) user.avatarUrl = av;
        return { kind, user, created: false };
    }

    const d = String(input.displayName || e).trim().slice(0, 64);
    if (!d) {
        const err = new Error('name_required');
        err.code = 'NAME_REQUIRED';
        throw err;
    }
    if (lobbyLoginEmailTakenSqlite(e)) {
        const err = new Error('email_exists');
        err.code = 'EMAIL_EXISTS';
        throw err;
    }
    const placeholder = crypto.randomBytes(32).toString('base64url');
    const hash = bcrypt.hashSync(placeholder, BCRYPT_ROUNDS);
    const createAvatar = googleAvatarUrlToStore('', input.picture || '') || '';
    const result = requireDb()
        .prepare(
            'INSERT INTO students (username, password_hash, display_name, email, lobby_role, google_sub, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(e, hash, d, e, 'user', sub, createAvatar);
    const id = Number(result.lastInsertRowid);
    const newRow = requireDb()
        .prepare(
            `SELECT id, username, password_hash, display_name, banned, ban_expires_at, lobby_role, email, avatar_url, google_sub
             FROM students WHERE id = ?`,
        )
        .get(id);
    return { kind: 'student', user: materializeUserBanSqlite('student', newRow), created: true };
}

export function registerTeacherSqlite(username, password, displayName) {
    assertPasswordPolicy(password);
    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    const u = username.trim();
    const d = (displayName || u).trim();
    const result = requireDb()
        .prepare('INSERT INTO teachers (username, password_hash, display_name) VALUES (?, ?, ?)')
        .run(u, hash, d);
    return { id: Number(result.lastInsertRowid), username: u, displayName: d };
}

export function listStudentsSqlite() {
    return requireDb()
        .prepare(
            'SELECT id, username, display_name, created_at, banned, ban_expires_at, lobby_role, email FROM students ORDER BY id',
        )
        .all()
        .map((row) => {
            const u = materializeUserBanSqlite('student', row);
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
        });
}

export function listTeachersSqlite() {
    return requireDb()
        .prepare(
            'SELECT id, username, display_name, created_at, banned, ban_expires_at, lobby_role, email FROM teachers ORDER BY id',
        )
        .all()
        .map((row) => {
            const u = materializeUserBanSqlite('teacher', row);
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
        });
}

/**
 * @param {'student'|'teacher'} kind
 * @param {number} id
 * @param {{ banned?: boolean, banExpiresAt?: string | null, lobbyRole?: string, email?: string, actor?: string }} patch
 */
export function patchLobbyUserFlagsSqlite(kind, id, patch) {
    const table = kind === 'teacher' ? 'teachers' : 'students';
    const full = requireDb()
        .prepare(
            `SELECT id, username, display_name, banned, ban_expires_at, lobby_role, email, avatar_url FROM ${table} WHERE id = ?`,
        )
        .get(id);
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
                patch.banExpiresAt !== undefined ? normalizeBanExpiresAt(patch.banExpiresAt) : undefined;
            const expires =
                normalized === undefined ? full.ban_expires_at || null : normalized;
            sets.push('ban_expires_at = ?');
            params.push(expires);
            insertBanHistorySqlite({
                userKind: kind,
                userId: id,
                actor: patch.actor,
                action: 'ban',
                startedAt: nowIso,
                endsAt: expires,
            });
        } else {
            sets.push('ban_expires_at = NULL');
            insertBanHistorySqlite({
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
    if (!sets.length) return materializeUserBanSqlite(kind, full);
    params.push(id);
    requireDb()
        .prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`)
        .run(...params);
    const out = requireDb()
        .prepare(
            `SELECT id, username, display_name, banned, ban_expires_at, lobby_role, email, avatar_url FROM ${table} WHERE id = ?`,
        )
        .get(id);
    return materializeUserBanSqlite(kind, out);
}

/**
 * @param {'student'|'teacher'} kind
 * @param {number} id
 */
export function getLobbyUserByIdSqlite(kind, id) {
    const table = kind === 'teacher' ? 'teachers' : 'students';
    const row = requireDb()
        .prepare(
            `SELECT id, username, display_name, banned, ban_expires_at, lobby_role, email, avatar_url FROM ${table} WHERE id = ?`,
        )
        .get(id);
    if (!row) return null;
    return materializeUserBanSqlite(kind, row);
}

/**
 * @param {'student'|'teacher'} kind
 * @param {number} id
 * @param {number} [limit]
 */
export function listBanHistorySqlite(kind, id, limit = 50) {
    return requireDb()
        .prepare(
            `SELECT id, user_kind AS userKind, user_id AS userId, actor, action,
                    started_at AS startedAt, ends_at AS endsAt, created_at AS createdAt
             FROM lobby_ban_history
             WHERE user_kind = ? AND user_id = ?
             ORDER BY created_at DESC
             LIMIT ?`,
        )
        .all(kind, id, limit)
        .map((r) => ({
            id: r.id,
            userKind: r.userKind,
            userId: r.userId,
            actor: r.actor,
            action: r.action,
            startedAt: r.startedAt,
            endsAt: r.endsAt,
            createdAt: r.createdAt,
        }));
}

export function updateStudentSqlite(id, { username, displayName, avatarUrl, password } = {}) {
    const row = requireDb()
        .prepare('SELECT id, username, display_name, avatar_url FROM students WHERE id = ?')
        .get(id);
    if (!row) return null;
    const u = username !== undefined ? String(username).trim() : row.username;
    const d = displayName !== undefined ? String(displayName).trim() : row.display_name;
    const av = avatarUrl !== undefined ? String(avatarUrl || '').trim() : String(row.avatar_url || '');
    if (password !== undefined && password !== null && String(password).length > 0) {
        assertPasswordPolicy(password);
        const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
        requireDb()
            .prepare(
                'UPDATE students SET username = ?, display_name = ?, avatar_url = ?, password_hash = ? WHERE id = ?',
            )
            .run(u, d, av, hash, id);
    } else {
        requireDb()
            .prepare('UPDATE students SET username = ?, display_name = ?, avatar_url = ? WHERE id = ?')
            .run(u, d, av, id);
    }
    return { id, username: u, displayName: d, avatarUrl: av };
}

export function updateTeacherSqlite(id, { username, displayName, avatarUrl, password } = {}) {
    const row = requireDb()
        .prepare('SELECT id, username, display_name, avatar_url FROM teachers WHERE id = ?')
        .get(id);
    if (!row) return null;
    const u = username !== undefined ? String(username).trim() : row.username;
    const d = displayName !== undefined ? String(displayName).trim() : row.display_name;
    const av = avatarUrl !== undefined ? String(avatarUrl || '').trim() : String(row.avatar_url || '');
    if (password !== undefined && password !== null && String(password).length > 0) {
        assertPasswordPolicy(password);
        const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
        requireDb()
            .prepare(
                'UPDATE teachers SET username = ?, display_name = ?, avatar_url = ?, password_hash = ? WHERE id = ?',
            )
            .run(u, d, av, hash, id);
    } else {
        requireDb()
            .prepare('UPDATE teachers SET username = ?, display_name = ?, avatar_url = ? WHERE id = ?')
            .run(u, d, av, id);
    }
    return { id, username: u, displayName: d, avatarUrl: av };
}

export function deleteStudentSqlite(id) {
    const result = requireDb().prepare('DELETE FROM students WHERE id = ?').run(id);
    return result.changes > 0;
}

export function deleteTeacherSqlite(id) {
    const result = requireDb().prepare('DELETE FROM teachers WHERE id = ?').run(id);
    return result.changes > 0;
}

export function countStudentsSqlite() {
    const row = requireDb().prepare('SELECT COUNT(*) AS c FROM students').get();
    return row?.c ?? 0;
}

export function countTeachersSqlite() {
    const row = requireDb().prepare('SELECT COUNT(*) AS c FROM teachers').get();
    return row?.c ?? 0;
}

export function sqliteUsersDbExists() {
    return fs.existsSync(getPlatformUsersDbPath());
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * @param {'student'|'teacher'} kind
 * @param {number} id
 */
export function getUserForPasswordResetSqlite(kind, id) {
    const table = kind === 'teacher' ? 'teachers' : 'students';
    const row = requireDb()
        .prepare(`SELECT id, username, display_name, email FROM ${table} WHERE id = ?`)
        .get(id);
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        email: String(row.email || ''),
        kind,
    };
}

/**
 * @param {'student'|'teacher'} kind
 * @param {number} id
 * @param {number} ttlMs
 */
export function createPasswordResetTokenSqlite(kind, id, ttlMs) {
    const token = crypto.randomBytes(32).toString('base64url');
    const hash = hashToken(token);
    const expiresAt = new Date(Date.now() + ttlMs);
    requireDb().prepare('DELETE FROM password_reset_tokens WHERE user_kind = ? AND user_id = ?').run(kind, id);
    requireDb()
        .prepare(
            'INSERT INTO password_reset_tokens (token_hash, user_kind, user_id, expires_at) VALUES (?, ?, ?, ?)',
        )
        .run(hash, kind, id, expiresAt.toISOString());
    return { token, expiresAt };
}

/**
 * @param {string} token
 * @param {string} newPassword
 */
export function consumePasswordResetTokenSqlite(token, newPassword) {
    const hash = hashToken(token);
    const row = requireDb()
        .prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?')
        .get(hash);
    if (!row || row.used_at) {
        const err = new Error('invalid_or_used_token');
        err.code = 'INVALID_TOKEN';
        throw err;
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
        const err = new Error('token_expired');
        err.code = 'TOKEN_EXPIRED';
        throw err;
    }
    const kind = row.user_kind === 'teacher' ? 'teacher' : 'student';
    if (kind === 'teacher') {
        updateTeacherSqlite(row.user_id, { password: newPassword });
    } else {
        updateStudentSqlite(row.user_id, { password: newPassword });
    }
    requireDb()
        .prepare('UPDATE password_reset_tokens SET used_at = datetime(\'now\') WHERE token_hash = ?')
        .run(hash);
    return { ok: true, kind, userId: row.user_id };
}

/**
 * @param {string} userRef
 */
export function listLobbyWorldFavoritesSqlite(userRef) {
    const key = String(userRef || '').trim();
    if (!key) return [];
    const rows = requireDb()
        .prepare(
            'SELECT world_slug FROM lobby_world_favorites WHERE user_ref = ? ORDER BY datetime(created_at) DESC',
        )
        .all(key);
    return rows.map((r) => String(r.world_slug));
}

/**
 * @param {string} userRef
 * @param {string} worldSlug
 * @param {boolean} favorite
 */
export function setLobbyWorldFavoriteSqlite(userRef, worldSlug, favorite) {
    const key = String(userRef || '').trim();
    const slug = String(worldSlug || '').trim();
    if (!key || !slug) return false;
    const database = requireDb();
    if (favorite) {
        database
            .prepare(
                `INSERT INTO lobby_world_favorites (user_ref, world_slug) VALUES (?, ?)
                 ON CONFLICT(user_ref, world_slug) DO UPDATE SET created_at = datetime('now')`,
            )
            .run(key, slug);
        return true;
    }
    const result = database
        .prepare('DELETE FROM lobby_world_favorites WHERE user_ref = ? AND world_slug = ?')
        .run(key, slug);
    return result.changes > 0;
}

/**
 * @param {string} userRef
 * @param {string} worldSlug
 */
export function toggleLobbyWorldFavoriteSqlite(userRef, worldSlug) {
    const key = String(userRef || '').trim();
    const slug = String(worldSlug || '').trim();
    if (!key || !slug) return { favorite: false, toggled: false };
    const database = requireDb();
    const existing = database
        .prepare('SELECT 1 FROM lobby_world_favorites WHERE user_ref = ? AND world_slug = ?')
        .get(key, slug);
    if (existing) {
        database
            .prepare('DELETE FROM lobby_world_favorites WHERE user_ref = ? AND world_slug = ?')
            .run(key, slug);
        return { favorite: false, toggled: true };
    }
    database
        .prepare('INSERT INTO lobby_world_favorites (user_ref, world_slug) VALUES (?, ?)')
        .run(key, slug);
    return { favorite: true, toggled: true };
}
