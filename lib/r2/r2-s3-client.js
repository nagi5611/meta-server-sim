// lib/r2/r2-s3-client.js — R2 S3 互換クライアント

import {
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
    UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getBucketName, getR2Env } from './storage-backend.js';

/** @type {S3Client | null} */
let clientInstance = null;

/**
 * S3 クライアントキャッシュを破棄する（env reload 時）
 */
export function resetS3Client() {
    clientInstance = null;
}

/**
 * S3 クライアントを取得する
 * @returns {S3Client}
 */
export function getS3Client() {
    if (clientInstance) return clientInstance;
    const env = getR2Env();
    const accountId = env.R2_ACCOUNT_ID?.trim();
    if (!accountId || !env.R2_ACCESS_KEY_ID?.trim() || !env.R2_SECRET_ACCESS_KEY?.trim()) {
        throw new Error('R2 credentials are not configured');
    }
    clientInstance = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: env.R2_ACCESS_KEY_ID.trim(),
            secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim(),
        },
    });
    return clientInstance;
}

/**
 * @returns {string}
 */
export function getBucket() {
    return getBucketName();
}

/**
 * @param {string} key
 * @param {Buffer | Uint8Array} body
 * @param {string} [contentType]
 */
export async function putObject(key, body, contentType = 'application/octet-stream') {
    const client = getS3Client();
    await client.send(
        new PutObjectCommand({
            Bucket: getBucket(),
            Key: key,
            Body: body,
            ContentType: contentType,
        })
    );
}

/**
 * @param {string} key
 * @returns {Promise<{ body: import('stream').Readable, contentType?: string, contentLength?: number } | null>}
 */
export async function getObject(key) {
    const client = getS3Client();
    try {
        const result = await client.send(
            new GetObjectCommand({
                Bucket: getBucket(),
                Key: key,
            })
        );
        if (!result.Body) return null;
        return {
            body: /** @type {import('stream').Readable} */ (result.Body),
            contentType: result.ContentType,
            contentLength: result.ContentLength,
        };
    } catch (err) {
        if (err && typeof err === 'object' && 'name' in err && err.name === 'NoSuchKey') {
            return null;
        }
        throw err;
    }
}

/**
 * @param {string} key
 * @returns {Promise<{ size: number, contentType?: string } | null>}
 */
export async function headObject(key) {
    const client = getS3Client();
    try {
        const result = await client.send(
            new HeadObjectCommand({
                Bucket: getBucket(),
                Key: key,
            })
        );
        return {
            size: result.ContentLength ?? 0,
            contentType: result.ContentType,
        };
    } catch (err) {
        if (err && typeof err === 'object' && 'name' in err && err.name === 'NotFound') {
            return null;
        }
        throw err;
    }
}

/**
 * @param {string} key
 */
export async function deleteObject(key) {
    const client = getS3Client();
    await client.send(
        new DeleteObjectCommand({
            Bucket: getBucket(),
            Key: key,
        })
    );
}

/**
 * @param {string} prefix
 * @param {string} [delimiter]
 * @returns {Promise<{ objects: Array<{ key: string, size: number, lastModified?: Date }>, prefixes: string[] }>}
 */
export async function listObjects(prefix, delimiter = '/') {
    const client = getS3Client();
    const objects = [];
    const prefixes = [];
    let continuationToken;

    do {
        const result = await client.send(
            new ListObjectsV2Command({
                Bucket: getBucket(),
                Prefix: prefix,
                Delimiter: delimiter,
                ContinuationToken: continuationToken,
            })
        );
        for (const obj of result.Contents ?? []) {
            if (obj.Key) {
                objects.push({
                    key: obj.Key,
                    size: obj.Size ?? 0,
                    lastModified: obj.LastModified,
                });
            }
        }
        for (const p of result.CommonPrefixes ?? []) {
            if (p.Prefix) prefixes.push(p.Prefix);
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);

    return { objects, prefixes };
}

/**
 * @param {string} key
 * @param {string} contentType
 * @returns {Promise<string>}
 */
export async function createMultipartUpload(key, contentType) {
    const client = getS3Client();
    const result = await client.send(
        new CreateMultipartUploadCommand({
            Bucket: getBucket(),
            Key: key,
            ContentType: contentType,
        })
    );
    if (!result.UploadId) throw new Error('Failed to create multipart upload');
    return result.UploadId;
}

/**
 * @param {string} key
 * @param {string} uploadId
 * @param {number} partNumber
 * @param {Buffer | Uint8Array} body
 * @returns {Promise<string>}
 */
export async function uploadPart(key, uploadId, partNumber, body) {
    const client = getS3Client();
    const result = await client.send(
        new UploadPartCommand({
            Bucket: getBucket(),
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: body,
        })
    );
    if (!result.ETag) throw new Error('ETag missing from upload part response');
    return result.ETag;
}

/**
 * @param {string} key
 * @param {string} uploadId
 * @param {Array<{ partNumber: number, etag: string }>} parts
 */
export async function completeMultipartUpload(key, uploadId, parts) {
    const client = getS3Client();
    await client.send(
        new CompleteMultipartUploadCommand({
            Bucket: getBucket(),
            Key: key,
            UploadId: uploadId,
            MultipartUpload: {
                Parts: [...parts]
                    .sort((a, b) => a.partNumber - b.partNumber)
                    .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
            },
        })
    );
}
