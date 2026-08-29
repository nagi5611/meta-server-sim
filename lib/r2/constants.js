// lib/r2/constants.js — R2 ストレージ定数（ScienceHUB storage/constants.ts 準拠）

/** このサイズ超でマルチパート */
export const MULTIPART_THRESHOLD = 30 * 1024 * 1024;
export const MULTIPART_LARGE_THRESHOLD = 300 * 1024 ** 2;

export const PART_SIZE_STANDARD = 32 * 1024 * 1024;
export const PART_SIZE_LARGE = 32 * 1024 * 1024;

export const PARALLEL_STANDARD = 8;
export const PARALLEL_LARGE = 10;

/** presigned URL の有効期限（秒） */
export const PRESIGN_EXPIRES_SEC = 3600;

/** アップロードセッション TTL（秒） */
export const SESSION_TTL_SEC = 3600;

export const R2_BUCKET_DEFAULT = 'metaverse-files';
export const R2_KEY_PREFIX_DEFAULT = 'metaverse';

/** テナントストア名 */
export const TENANT_STORES = new Set(['models', 'pdfs', 'images', 'env', 'avatars']);
