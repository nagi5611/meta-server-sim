// lib/r2/r2-connection-test.js — 管理パネル向け R2 接続テスト

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { isR2PresignConfigured } from './r2-presign.js';
import {
    deleteObject,
    getBucket,
    getObject,
    headObject,
    putObject,
} from './r2-s3-client.js';
import { getBucketName, getKeyPrefix, getR2Env, isR2Enabled } from './storage-backend.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATUS_PATH = path.join(__dirname, '..', '..', 'data', 'platform', 'r2-connection-status.json');

const TEST_PAYLOAD = 'metaverse-r2-connection-test-v1';
const TEST_CONTENT_TYPE = 'text/plain; charset=utf-8';

/**
 * 認証情報・バケット変更検知用フィンガープリント
 * @returns {string}
 */
export function computeR2ConfigFingerprint() {
    const env = getR2Env();
    const raw = [
        env.R2_ACCOUNT_ID?.trim() ?? '',
        env.R2_ACCESS_KEY_ID?.trim() ?? '',
        getBucketName(env),
        getKeyPrefix(env),
    ].join('\0');
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * @returns {{ connected: boolean, testedAt?: number, message?: string, bucket?: string, configFingerprint?: string, error?: string } | null}
 */
function loadStatusFromDisk() {
    try {
        if (!fs.existsSync(STATUS_PATH)) return null;
        const raw = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
        if (!raw || typeof raw !== 'object') return null;
        return raw;
    } catch {
        return null;
    }
}

/**
 * @param {Record<string, unknown>} status
 */
function saveStatusToDisk(status) {
    fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
    fs.writeFileSync(STATUS_PATH, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
}

/**
 * @param {import('stream').Readable} stream
 * @returns {Promise<Buffer>}
 */
async function readStreamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

/**
 * @returns {string}
 */
function buildTestObjectKey() {
    return `${getKeyPrefix()}/.platform-admin/connection-test.txt`;
}

/**
 * 管理 API 用ステータス
 */
export function getR2ConnectionStatusForAdmin() {
    const backend = isR2Enabled() ? 'r2' : 'local';
    const env = getR2Env();
    const configured = isR2PresignConfigured(env);
    const fingerprint = computeR2ConfigFingerprint();
    const saved = loadStatusFromDisk();

    if (backend !== 'r2') {
        return {
            backend,
            configured: false,
            connected: false,
            stale: false,
            message: 'STORAGE_BACKEND が r2 ではありません',
            statusPath: STATUS_PATH,
        };
    }

    if (!configured) {
        return {
            backend,
            configured: false,
            connected: false,
            stale: false,
            message: 'R2 認証情報が未設定です',
            missing: getMissingR2CredentialKeys(env),
            statusPath: STATUS_PATH,
        };
    }

    const stale = Boolean(
        saved?.connected &&
            saved.configFingerprint &&
            saved.configFingerprint !== fingerprint
    );

    const connected = Boolean(saved?.connected && !stale);

    return {
        backend,
        configured: true,
        connected,
        stale,
        testedAt: typeof saved?.testedAt === 'number' ? saved.testedAt : null,
        message: connected
            ? saved?.message || 'R2 接続完了'
            : stale
              ? '設定が変更されました。再接続テストを実行してください'
              : '未確認',
        bucket: getBucketName(env),
        configFingerprint: fingerprint,
        lastError: stale ? null : saved?.error ?? null,
        statusPath: STATUS_PATH,
    };
}

/**
 * @param {ReturnType<typeof getR2Env>} env
 * @returns {string[]}
 */
function getMissingR2CredentialKeys(env) {
    const missing = [];
    if (!env.R2_ACCOUNT_ID?.trim()) missing.push('R2_ACCOUNT_ID');
    if (!env.R2_ACCESS_KEY_ID?.trim()) missing.push('R2_ACCESS_KEY_ID');
    if (!env.R2_SECRET_ACCESS_KEY?.trim()) missing.push('R2_SECRET_ACCESS_KEY');
    return missing;
}

/**
 * R2 へ put → head → get → delete を実行する
 * @returns {Promise<{ ok: true, status: ReturnType<typeof getR2ConnectionStatusForAdmin> } | { ok: false, error: string, status: ReturnType<typeof getR2ConnectionStatusForAdmin> }>}
 */
export async function runR2ConnectionTest() {
    const baseStatus = getR2ConnectionStatusForAdmin();

    if (baseStatus.backend !== 'r2') {
        return {
            ok: false,
            error: 'STORAGE_BACKEND=r2 に設定してください',
            status: baseStatus,
        };
    }

    if (!baseStatus.configured) {
        const missing = baseStatus.missing?.join(', ') || 'R2 認証情報';
        return {
            ok: false,
            error: `${missing} が未設定です`,
            status: baseStatus,
        };
    }

    const key = buildTestObjectKey();
    const bucket = getBucket();

    try {
        await putObject(key, Buffer.from(TEST_PAYLOAD, 'utf8'), TEST_CONTENT_TYPE);

        const head = await headObject(key);
        if (!head || head.size !== Buffer.byteLength(TEST_PAYLOAD, 'utf8')) {
            throw new Error('アップロード後のオブジェクト検証に失敗しました');
        }

        const got = await getObject(key);
        if (!got?.body) {
            throw new Error('ダウンロードに失敗しました');
        }
        const body = await readStreamToBuffer(got.body);
        if (body.toString('utf8') !== TEST_PAYLOAD) {
            throw new Error('ダウンロード内容が一致しません');
        }

        await deleteObject(key);

        const testedAt = Date.now();
        saveStatusToDisk({
            connected: true,
            testedAt,
            message: 'R2 接続完了',
            bucket,
            configFingerprint: computeR2ConfigFingerprint(),
            testKey: key,
        });

        return {
            ok: true,
            status: getR2ConnectionStatusForAdmin(),
        };
    } catch (e) {
        const error = e instanceof Error ? e.message : 'R2 接続テストに失敗しました';
        try {
            await deleteObject(key);
        } catch {
            /* ignore cleanup errors */
        }

        saveStatusToDisk({
            connected: false,
            testedAt: Date.now(),
            message: '接続失敗',
            error,
            bucket,
            configFingerprint: computeR2ConfigFingerprint(),
        });

        return {
            ok: false,
            error,
            status: getR2ConnectionStatusForAdmin(),
        };
    }
}

/**
 * テスト用
 */
export function _resetR2ConnectionStatusForTests() {
    if (fs.existsSync(STATUS_PATH)) {
        fs.unlinkSync(STATUS_PATH);
    }
}
