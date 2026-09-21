// lib/tenant-model-upload.js — テナントモデルアップロード（GLB リサイズ + ローカル / R2）

import fs from 'node:fs';
import path from 'node:path';
import {
    getModelUploadQueueStats,
    parseTextureMaxEdgeFromUploadBody,
    runGlbTextureResizeQueued,
} from '../../metaverse-simple/lib/glb-texture-resize.js';
import { guessContentType, sanitizeFilename, toR2Key } from './r2/r2-keys.js';
import { putObject } from './r2/r2-s3-client.js';
import { isR2Enabled } from './r2/storage-backend.js';

const MODEL_UPLOAD_EXTS = new Set(['.glb', '.obj', '.mtl', '.png', '.jpg', '.jpeg', '.webp']);

/**
 * @returns {{ waiting: number, processing: boolean }}
 */
export function getTenantModelUploadQueueStats() {
    return getModelUploadQueueStats();
}

/**
 * @param {import('express').Request} req
 * @param {string} fallback
 * @returns {string}
 */
function resolveUploadedFilename(req, fallback) {
    const b64 = req.body?.filename_b64;
    if (typeof b64 === 'string' && b64.trim()) {
        try {
            const decoded = Buffer.from(b64, 'base64').toString('utf8').trim();
            if (decoded) return sanitizeFilename(decoded);
        } catch {
            /* fall through */
        }
    }
    return sanitizeFilename(fallback);
}

/**
 * モデルをローカルと R2 に保存する（GLB はテクスチャリサイズキュー経由）
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {{ buffer: Buffer, originalname: string }} file
 * @param {{ allowOverwrite?: boolean, skipTextureResize?: boolean, textureMaxEdge?: unknown, requestBody?: Record<string, unknown> }} options
 */
export async function saveTenantModelUpload(tenant, file, options = {}) {
    const filename = resolveUploadedFilename(
        { body: options.requestBody ?? {} },
        file.originalname
    );
    const ext = path.extname(filename).toLowerCase();
    if (!MODEL_UPLOAD_EXTS.has(ext)) {
        throw Object.assign(new Error('File type not allowed for model upload'), { code: 'invalid_type' });
    }

    const destDir = tenant.paths.MODELS_DIR;
    const destPath = path.join(destDir, filename);
    if (fs.existsSync(destPath) && !options.allowOverwrite) {
        return { conflict: true, filename };
    }

    let outBuffer = file.buffer;
    /** @type {Record<string, unknown> | null} */
    let textureResize = null;
    const skipTextureResize = options.skipTextureResize === true;

    if (ext === '.glb') {
        if (skipTextureResize) {
            textureResize = {
                applied: false,
                skippedByClient: true,
                message: 'テクスチャのリサイズを行わず、オリジナルの GLB を保存しました。',
            };
        } else {
            const parsed = parseTextureMaxEdgeFromUploadBody(options.textureMaxEdge);
            if (!parsed.ok) {
                throw Object.assign(new Error(parsed.error), { code: 'invalid_texture_max_edge' });
            }
            const pipelineResult = await runGlbTextureResizeQueued(file.buffer, {
                maxEdgePx: parsed.value,
            });
            outBuffer = pipelineResult.buffer;
            textureResize = pipelineResult.textureResize;
        }
    }

    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    fs.writeFileSync(destPath, outBuffer);

    if (isR2Enabled()) {
        const r2Key = toR2Key(tenant.id, 'models', filename);
        await putObject(r2Key, outBuffer, guessContentType(filename));
    }

    return {
        success: true,
        filename,
        textureResize,
    };
}
