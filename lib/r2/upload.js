// lib/r2/upload.js — テナント R2 アップロード

import {
    MULTIPART_LARGE_THRESHOLD,
    MULTIPART_THRESHOLD,
    PART_SIZE_LARGE,
    PART_SIZE_STANDARD,
    PARALLEL_LARGE,
    PARALLEL_STANDARD,
    PRESIGN_EXPIRES_SEC,
} from './constants.js';
import {
    buildAutoRenameName,
    guessContentType,
    listPrefix,
    sanitizeFilename,
    toR2Key,
} from './r2-keys.js';
import {
    completeMultipartUploadViaS3,
    isR2PresignConfigured,
    presignPutObject,
} from './r2-presign.js';
import {
    completeMultipartUpload,
    createMultipartUpload,
    headObject,
    putObject,
    uploadPart,
} from './r2-s3-client.js';
import {
    createSessionId,
    createUploadSession,
    deleteUploadSession,
    getUploadSession,
    updateUploadSession,
} from './upload-sessions.js';
import { listObjects } from './r2-s3-client.js';

/**
 * @typedef {{ partNumber: number, etag: string }} UploadedPart
 */

/**
 * @param {number} size
 * @returns {{ partSize: number, parallel: number, totalParts: number, mode: 'simple' | 'multipart', directUpload: boolean }}
 */
export function getUploadPlan(size) {
    const directUpload = isR2PresignConfigured();

    if (size <= MULTIPART_THRESHOLD) {
        return {
            partSize: size,
            parallel: 1,
            totalParts: 1,
            mode: 'simple',
            directUpload,
        };
    }

    if (size <= MULTIPART_LARGE_THRESHOLD) {
        const partSize = PART_SIZE_STANDARD;
        return {
            partSize,
            parallel: PARALLEL_STANDARD,
            totalParts: Math.ceil(size / partSize),
            mode: 'multipart',
            directUpload,
        };
    }

    const partSize = PART_SIZE_LARGE;
    return {
        partSize,
        parallel: PARALLEL_LARGE,
        totalParts: Math.ceil(size / partSize),
        mode: 'multipart',
        directUpload,
    };
}

/**
 * ディレクトリ内の既存ファイル名一覧
 * @param {string} tenantId
 * @param {string} store
 * @param {string} relativeDir
 * @returns {Promise<Set<string>>}
 */
export async function listExistingFilenames(tenantId, store, relativeDir) {
    const prefix = listPrefix(tenantId, store, relativeDir);
    const { objects } = await listObjects(prefix);
    const baseLen = prefix.length;
    const names = new Set();
    for (const obj of objects) {
        const suffix = obj.key.slice(baseLen);
        if (!suffix || suffix.includes('/')) continue;
        names.add(suffix);
    }
    return names;
}

/**
 * 一意ファイル名を決定する
 * @param {string} tenantId
 * @param {string} store
 * @param {string} relativeDir
 * @param {string} filename
 * @param {boolean} [allowOverwrite]
 * @returns {Promise<string>}
 */
export async function resolveUniqueFilename(tenantId, store, relativeDir, filename, allowOverwrite = false) {
    const safe = sanitizeFilename(filename);
    if (allowOverwrite) return safe;

    const existing = await listExistingFilenames(tenantId, store, relativeDir);
    if (!existing.has(safe)) return safe;

    let index = 1;
    while (index < 10000) {
        const candidate = buildAutoRenameName(safe, index);
        if (!existing.has(candidate)) return candidate;
        index++;
    }
    throw new Error('同名ファイルが多すぎます');
}

/**
 * アップロードを初期化する
 * @param {string} tenantId
 * @param {string} store
 * @param {string} relativeDir
 * @param {string} filename
 * @param {number} size
 * @param {{ allowOverwrite?: boolean, forceFilename?: string }} [options]
 */
export async function initiateUpload(tenantId, store, relativeDir, filename, size, options = {}) {
    if (size <= 0) throw new Error('ファイルサイズが不正です');

    const allowOverwrite = Boolean(options.allowOverwrite);
    const resolvedFilename = options.forceFilename
        ? sanitizeFilename(options.forceFilename)
        : await resolveUniqueFilename(tenantId, store, relativeDir, filename, allowOverwrite);

    const relativeFilePath = relativeDir
        ? `${relativeDir.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')}/${resolvedFilename}`
        : resolvedFilename;
    const r2Key = toR2Key(tenantId, store, relativeFilePath);
    const plan = getUploadPlan(size);
    const sessionId = createSessionId();
    const contentType = guessContentType(resolvedFilename);

    if (plan.mode === 'simple') {
        createUploadSession({
            id: sessionId,
            tenantId,
            store,
            r2Key,
            uploadId: null,
            filename,
            resolvedFilename,
            relativeDir: relativeDir || '',
            totalSize: size,
            partSize: null,
            partsJson: '[]',
            status: 'in_progress',
            createdAt: Date.now(),
        });

        return {
            mode: 'simple',
            sessionId,
            resolvedFilename,
            r2Key,
            directUpload: plan.directUpload,
        };
    }

    const uploadId = await createMultipartUpload(r2Key, contentType);
    createUploadSession({
        id: sessionId,
        tenantId,
        store,
        r2Key,
        uploadId,
        filename,
        resolvedFilename,
        relativeDir: relativeDir || '',
        totalSize: size,
        partSize: plan.partSize,
        partsJson: '[]',
        status: 'in_progress',
        createdAt: Date.now(),
    });

    return {
        mode: 'multipart',
        sessionId,
        resolvedFilename,
        r2Key,
        partSize: plan.partSize,
        totalParts: plan.totalParts,
        parallel: plan.parallel,
        directUpload: plan.directUpload,
    };
}

/**
 * 単発アップロード用 presigned URL
 * @param {string} tenantId
 * @param {string} sessionId
 */
export async function getSimpleUploadPresignedUrl(tenantId, sessionId) {
    const session = getUploadSession(sessionId);
    if (!session || session.status !== 'in_progress') {
        throw new Error('アップロードセッションが見つかりません');
    }
    if (session.tenantId !== tenantId) {
        throw new Error('アップロードセッションが見つかりません');
    }
    if (session.uploadId) {
        throw new Error('このセッションはマルチパート用です');
    }

    const url = await presignPutObject(session.r2Key, {
        query: { 'Content-Type': guessContentType(session.resolvedFilename) },
    });
    return { url, expiresIn: PRESIGN_EXPIRES_SEC };
}

/**
 * マルチパート用 presigned URL
 * @param {string} tenantId
 * @param {string} sessionId
 * @param {number} partNumber
 */
export async function getPartUploadPresignedUrl(tenantId, sessionId, partNumber) {
    const session = getUploadSession(sessionId);
    if (!session || session.status !== 'in_progress') {
        throw new Error('アップロードセッションが見つかりません');
    }
    if (session.tenantId !== tenantId) {
        throw new Error('アップロードセッションが見つかりません');
    }
    if (!session.uploadId || !session.partSize) {
        throw new Error('このセッションはマルチパートではありません');
    }

    const expectedParts = Math.ceil(session.totalSize / session.partSize);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > expectedParts) {
        throw new Error('partNumber が不正です');
    }

    const url = await presignPutObject(session.r2Key, {
        query: {
            partNumber: String(partNumber),
            uploadId: session.uploadId,
        },
    });
    return { url, expiresIn: PRESIGN_EXPIRES_SEC };
}

/**
 * Worker/Express プロキシ経由の単発アップロード
 * @param {string} tenantId
 * @param {string} sessionId
 * @param {Buffer} body
 */
export async function proxySimpleUpload(tenantId, sessionId, body) {
    const session = getUploadSession(sessionId);
    if (!session || session.status !== 'in_progress') {
        throw new Error('アップロードセッションが見つかりません');
    }
    if (session.tenantId !== tenantId) {
        throw new Error('アップロードセッションが見つかりません');
    }
    if (session.uploadId) {
        throw new Error('このセッションはマルチパート用です');
    }
    if (body.length !== session.totalSize) {
        throw new Error('ファイルサイズが一致しません');
    }

    await putObject(session.r2Key, body, guessContentType(session.resolvedFilename));
    return finalizeUpload(session);
}

/**
 * プロキシ経由のパートアップロード
 * @param {string} tenantId
 * @param {string} sessionId
 * @param {number} partNumber
 * @param {Buffer} body
 * @returns {Promise<UploadedPart>}
 */
export async function proxyUploadPart(tenantId, sessionId, partNumber, body) {
    const session = getUploadSession(sessionId);
    if (!session || session.status !== 'in_progress') {
        throw new Error('アップロードセッションが見つかりません');
    }
    if (session.tenantId !== tenantId || !session.uploadId) {
        throw new Error('アップロードセッションが見つかりません');
    }

    const etag = await uploadPart(session.r2Key, session.uploadId, partNumber, body);
    const parts = /** @type {UploadedPart[]} */ (JSON.parse(session.partsJson));
    const filtered = parts.filter((p) => p.partNumber !== partNumber);
    filtered.push({ partNumber, etag });
    filtered.sort((a, b) => a.partNumber - b.partNumber);
    updateUploadSession(sessionId, { partsJson: JSON.stringify(filtered) });

    return { partNumber, etag };
}

/**
 * アップロード完了
 * @param {string} tenantId
 * @param {string} sessionId
 * @param {UploadedPart[]} [partsFromClient]
 * @param {boolean} [directUpload]
 */
export async function completeUpload(tenantId, sessionId, partsFromClient, directUpload = false) {
    const session = getUploadSession(sessionId);
    if (!session || session.status !== 'in_progress') {
        throw new Error('アップロードセッションが見つかりません');
    }
    if (session.tenantId !== tenantId) {
        throw new Error('アップロードセッションが見つかりません');
    }

    if (!session.uploadId || !session.partSize) {
        const head = await headObject(session.r2Key);
        if (!head) {
            throw new Error('アップロードされたファイルが見つかりません');
        }
        if (head.size !== session.totalSize) {
            throw new Error('ファイルサイズが一致しません');
        }
        return finalizeUpload(session);
    }

    const expectedParts = Math.ceil(session.totalSize / session.partSize);
    let parts;
    if (partsFromClient && partsFromClient.length > 0) {
        parts = [...partsFromClient].sort((a, b) => a.partNumber - b.partNumber);
    } else {
        parts = /** @type {UploadedPart[]} */ (JSON.parse(session.partsJson));
        parts.sort((a, b) => a.partNumber - b.partNumber);
    }

    if (parts.length !== expectedParts) {
        throw new Error(`パート数が不足しています（${parts.length}/${expectedParts}）`);
    }

    if (directUpload && isR2PresignConfigured()) {
        await completeMultipartUploadViaS3(session.r2Key, session.uploadId, parts);
    } else {
        await completeMultipartUpload(session.r2Key, session.uploadId, parts);
    }

    return finalizeUpload(session, parts);
}

/**
 * アップロード中止
 * @param {string} tenantId
 * @param {string} sessionId
 */
export async function abortUpload(tenantId, sessionId) {
    const session = getUploadSession(sessionId);
    if (!session || session.status !== 'in_progress') return;
    if (session.tenantId !== tenantId) return;

    updateUploadSession(sessionId, { status: 'aborted' });
    deleteUploadSession(sessionId);
}

/**
 * @param {import('./upload-sessions.js').UploadSession} session
 * @param {UploadedPart[]} [parts]
 */
function finalizeUpload(session, parts) {
    updateUploadSession(session.id, {
        status: 'completed',
        partsJson: parts ? JSON.stringify(parts) : session.partsJson,
    });
    deleteUploadSession(session.id);

    const relativePath = session.relativeDir
        ? `${session.relativeDir}/${session.resolvedFilename}`
        : session.resolvedFilename;

    return {
        success: true,
        filename: session.resolvedFilename,
        store: session.store,
        relativePath,
        size: session.totalSize,
    };
}

/**
 * ファイル存在確認
 * @param {string} tenantId
 * @param {string} store
 * @param {string} relativePath
 */
export async function objectExists(tenantId, store, relativePath) {
    const r2Key = toR2Key(tenantId, store, relativePath);
    const head = await headObject(r2Key);
    return Boolean(head);
}
