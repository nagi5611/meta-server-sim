// lib/r2/upload-sessions.js — アップロードセッション永続化

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SESSION_TTL_SEC } from './constants.js';

const SESSIONS_PATH = path.resolve('data/platform/r2-upload-sessions.json');

/** @typedef {{
 *   id: string,
 *   tenantId: string,
 *   store: string,
 *   r2Key: string,
 *   uploadId: string | null,
 *   filename: string,
 *   resolvedFilename: string,
 *   relativeDir: string,
 *   totalSize: number,
 *   partSize: number | null,
 *   partsJson: string,
 *   status: string,
 *   createdAt: number,
 * }} UploadSession */

/** @type {Map<string, UploadSession>} */
let sessionsCache = null;

/**
 * セッションファイルを読み込む
 */
function loadSessions() {
    if (sessionsCache) return sessionsCache;
    sessionsCache = new Map();
    try {
        if (fs.existsSync(SESSIONS_PATH)) {
            const raw = fs.readFileSync(SESSIONS_PATH, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data.sessions)) {
                for (const s of data.sessions) {
                    if (s && s.id) sessionsCache.set(s.id, s);
                }
            }
        }
    } catch (err) {
        console.error('[r2-upload-sessions] load failed:', err);
        sessionsCache = new Map();
    }
    purgeExpiredSessions();
    return sessionsCache;
}

/**
 * セッションを保存する
 */
function saveSessions() {
    const sessions = loadSessions();
    const dir = path.dirname(SESSIONS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${SESSIONS_PATH}.tmp.${Date.now()}`;
    fs.writeFileSync(
        tmp,
        JSON.stringify({ sessions: [...sessions.values()] }, null, 2),
        'utf8'
    );
    fs.renameSync(tmp, SESSIONS_PATH);
}

/**
 * 期限切れセッションを削除する
 */
function purgeExpiredSessions() {
    const sessions = loadSessions();
    const now = Date.now();
    const ttlMs = SESSION_TTL_SEC * 1000;
    let changed = false;
    for (const [id, s] of sessions) {
        if (now - s.createdAt > ttlMs) {
            sessions.delete(id);
            changed = true;
        }
    }
    if (changed) saveSessions();
}

/**
 * 新規セッション ID を生成する
 * @returns {string}
 */
export function createSessionId() {
    return `r2up_${crypto.randomUUID()}`;
}

/**
 * @param {UploadSession} session
 */
export function createUploadSession(session) {
    const sessions = loadSessions();
    sessions.set(session.id, session);
    saveSessions();
}

/**
 * @param {string} sessionId
 * @returns {UploadSession | null}
 */
export function getUploadSession(sessionId) {
    purgeExpiredSessions();
    return loadSessions().get(sessionId) ?? null;
}

/**
 * @param {string} sessionId
 * @param {Partial<UploadSession>} updates
 */
export function updateUploadSession(sessionId, updates) {
    const sessions = loadSessions();
    const existing = sessions.get(sessionId);
    if (!existing) return;
    sessions.set(sessionId, { ...existing, ...updates });
    saveSessions();
}

/**
 * @param {string} sessionId
 */
export function deleteUploadSession(sessionId) {
    const sessions = loadSessions();
    if (sessions.delete(sessionId)) {
        saveSessions();
    }
}
