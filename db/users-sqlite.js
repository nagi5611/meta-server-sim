// db/users-sqlite.js — ローカル SQLite users.db（D1 フォールバック）

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import { validateUserPassword } from '../lib/password-policy.js';
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
    }
}

function requireDb() {
    if (!db) throw new Error('SQLite users DB not initialized');
    return db;
}

function rowToLobbyUser(row, kind) {
    return {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        banned: Boolean(row.banned),
        lobbyRole: String(row.lobby_role || (kind === 'teacher' ? 'admin' : 'user')),
        email: String(row.email || ''),
        kind,
    };
}

export function verifyStudentSqlite(username, password) {
    const row = requireDb()
        .prepare(
            'SELECT id, username, password_hash, display_name, banned, lobby_role, email FROM students WHERE username = ?',
        )
        .get(username.trim());
    if (!row) return null;
    if (!bcrypt.compareSync(password, row.password_hash)) return null;
    return rowToLobbyUser(row, 'student');
}

export function verifyTeacherSqlite(username, password) {
    const row = requireDb()
        .prepare(
            'SELECT id, username, password_hash, display_name, banned, lobby_role, email FROM teachers WHERE username = ?',
        )
        .get(username.trim());
    if (!row) return null;
    if (!bcrypt.compareSync(password, row.password_hash)) return null;
    return rowToLobbyUser(row, 'teacher');
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
            'SELECT id, username, display_name, created_at, banned, lobby_role, email FROM students ORDER BY id',
        )
        .all()
        .map((row) => ({
            id: row.id,
            username: row.username,
            displayName: row.display_name,
            createdAt: row.created_at,
            banned: Boolean(row.banned),
            lobbyRole: String(row.lobby_role || 'user'),
            email: String(row.email || ''),
            kind: 'student',
        }));
}

export function listTeachersSqlite() {
    return requireDb()
        .prepare(
            'SELECT id, username, display_name, created_at, banned, lobby_role, email FROM teachers ORDER BY id',
        )
        .all()
        .map((row) => ({
            id: row.id,
            username: row.username,
            displayName: row.display_name,
            createdAt: row.created_at,
            banned: Boolean(row.banned),
            lobbyRole: String(row.lobby_role || 'admin'),
            email: String(row.email || ''),
            kind: 'teacher',
        }));
}

/**
 * @param {'student'|'teacher'} kind
 * @param {number} id
 * @param {{ banned?: boolean, lobbyRole?: string, email?: string }} patch
 */
export function patchLobbyUserFlagsSqlite(kind, id, patch) {
    const table = kind === 'teacher' ? 'teachers' : 'students';
    const row = requireDb().prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
    if (!row) return null;
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
    requireDb()
        .prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`)
        .run(...params);
    const out = requireDb()
        .prepare(
            `SELECT id, username, display_name, banned, lobby_role, email FROM ${table} WHERE id = ?`,
        )
        .get(id);
    return rowToLobbyUser(out, kind);
}

export function updateStudentSqlite(id, { username, displayName, password } = {}) {
    const row = requireDb()
        .prepare('SELECT id, username, display_name FROM students WHERE id = ?')
        .get(id);
    if (!row) return null;
    const u = username !== undefined ? String(username).trim() : row.username;
    const d = displayName !== undefined ? String(displayName).trim() : row.display_name;
    if (password !== undefined && password !== null && String(password).length > 0) {
        assertPasswordPolicy(password);
        const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
        requireDb()
            .prepare(
                'UPDATE students SET username = ?, display_name = ?, password_hash = ? WHERE id = ?'
            )
            .run(u, d, hash, id);
    } else {
        requireDb()
            .prepare('UPDATE students SET username = ?, display_name = ? WHERE id = ?')
            .run(u, d, id);
    }
    return { id, username: u, displayName: d };
}

export function updateTeacherSqlite(id, { username, displayName, password } = {}) {
    const row = requireDb()
        .prepare('SELECT id, username, display_name FROM teachers WHERE id = ?')
        .get(id);
    if (!row) return null;
    const u = username !== undefined ? String(username).trim() : row.username;
    const d = displayName !== undefined ? String(displayName).trim() : row.display_name;
    if (password !== undefined && password !== null && String(password).length > 0) {
        assertPasswordPolicy(password);
        const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
        requireDb()
            .prepare(
                'UPDATE teachers SET username = ?, display_name = ?, password_hash = ? WHERE id = ?'
            )
            .run(u, d, hash, id);
    } else {
        requireDb()
            .prepare('UPDATE teachers SET username = ?, display_name = ? WHERE id = ?')
            .run(u, d, id);
    }
    return { id, username: u, displayName: d };
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
