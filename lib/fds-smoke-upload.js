// lib/fds-smoke-upload.js — FDS smoke simulation ZIP extract, validate, and save
import fs from 'node:fs';
import path from 'node:path';
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import { isPathInsideTenantRoot } from './tenant-storage-paths.js';

const MAX_ZIP_ENTRIES = 500;
/** fugaku-prod01 等の大容量 multipart は ZIP ~600MB / 展開 ~2GB 規模 */
export const FDS_SMOKE_MAX_ZIP_BYTES = 1024 * 1024 * 1024;
export const FDS_SMOKE_MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = FDS_SMOKE_MAX_UNCOMPRESSED_BYTES;
const ALLOWED_ZIP_COMPRESSION = new Set([0, 8]);
const SIM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const ALLOWED_EXT = new Set(['.json', '.bin']);

/**
 * @param {Uint8Array[]} chunks
 * @returns {Uint8Array}
 */
function concatUint8Arrays(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}

/**
 * Streaming ZIP extract with entry/uncompressed size caps (avoids unzipSync memory spikes).
 * @param {Uint8Array} zipBytes
 * @param {{ maxZipBytes: number, maxUncompressedBytes: number, maxEntries: number }} limits
 * @returns {Record<string, Uint8Array>}
 */
function unzipFdsSmokeWithLimits(zipBytes, limits) {
    if (zipBytes.byteLength > limits.maxZipBytes) {
        throw new FdsSmokeUploadError('too_large', 'ZIP exceeds size limit');
    }

    /** @type {Record<string, Uint8Array>} */
    const rawEntries = {};
    let entryCount = 0;
    let totalUncompressed = 0;
    /** @type {FdsSmokeUploadError|null} */
    let abortError = null;

    const unzipper = new Unzip();
    unzipper.register(UnzipInflate);
    unzipper.register(UnzipPassThrough);

    const fail = (err) => {
        if (!abortError) abortError = err;
    };

    unzipper.onfile = (file) => {
        if (abortError) {
            file.terminate();
            return;
        }

        entryCount += 1;
        if (entryCount > limits.maxEntries) {
            file.terminate();
            fail(new FdsSmokeUploadError('too_many_entries', `ZIP has too many entries (max ${limits.maxEntries})`));
            return;
        }

        const rel = safeZipEntryRelativePath(file.name);
        if (!rel) {
            file.terminate();
            fail(new FdsSmokeUploadError('invalid_path', `Invalid ZIP entry path: ${file.name}`));
            return;
        }

        if (!ALLOWED_ZIP_COMPRESSION.has(file.compression)) {
            file.terminate();
            fail(new FdsSmokeUploadError('unzip_failed', `Unsupported ZIP compression method: ${file.compression}`));
            return;
        }

        if (file.originalSize !== undefined) {
            if (file.originalSize > limits.maxUncompressedBytes) {
                file.terminate();
                fail(new FdsSmokeUploadError('too_large', 'Uncompressed content exceeds size limit'));
                return;
            }
            if (totalUncompressed + file.originalSize > limits.maxUncompressedBytes) {
                file.terminate();
                fail(new FdsSmokeUploadError('too_large', 'Uncompressed content exceeds size limit'));
                return;
            }
        }

        /** @type {Uint8Array[]} */
        const chunks = [];
        let entryBytes = 0;

        file.ondata = (err, data, final) => {
            if (abortError) return;
            if (err) {
                fail(new FdsSmokeUploadError('unzip_failed', 'Failed to unzip file'));
                file.terminate();
                return;
            }

            entryBytes += data.byteLength;
            totalUncompressed += data.byteLength;
            if (entryBytes > limits.maxUncompressedBytes || totalUncompressed > limits.maxUncompressedBytes) {
                fail(new FdsSmokeUploadError('too_large', 'Uncompressed content exceeds size limit'));
                file.terminate();
                return;
            }

            chunks.push(data);
            if (final) {
                rawEntries[rel] = concatUint8Arrays(chunks);
            }
        };

        file.start();
    };

    try {
        unzipper.push(zipBytes, true);
    } catch {
        throw new FdsSmokeUploadError('unzip_failed', 'Failed to unzip file');
    }

    if (abortError) throw abortError;

    return rawEntries;
}

/**
 * @param {string} name
 * @returns {string|null}
 */
function safeZipEntryRelativePath(name) {
    const n = String(name || '').replace(/\\/g, '/');
    if (!n || n.includes('\0') || n.startsWith('/')) return null;
    const parts = n.split('/').filter((p) => p && p !== '.');
    if (parts.length === 0) return null;
    if (parts.some((p) => p === '..')) return null;
    return parts.join('/');
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function isAllowedFdsSmokePath(relPath) {
    const ext = path.extname(relPath).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return false;
    const base = path.basename(relPath);
    if (base === 'manifest.json') return true;
    if (ext === '.bin') return true;
    return false;
}

/**
 * @param {string} zipName
 * @returns {string}
 */
export function simIdFromZipFilename(zipName) {
    const base = path.basename(String(zipName || ''), path.extname(String(zipName || '')));
    const s = base.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '') || 'simulation';
    return s.slice(0, 64);
}

/**
 * @param {string} simId
 * @returns {boolean}
 */
export function isValidSimId(simId) {
    return SIM_ID_PATTERN.test(String(simId || ''));
}

/**
 * @param {Record<string, Uint8Array>} entries relPath -> data
 * @returns {string|null} prefix like "" or "lite"
 */
function detectManifestPrefix(entries) {
    const keys = Object.keys(entries);
    if (keys.includes('manifest.json')) return '';
    const withManifest = keys.filter((k) => k.endsWith('/manifest.json') || k === 'manifest.json');
    if (withManifest.length === 1) {
        const key = withManifest[0];
        if (key === 'manifest.json') return '';
        const prefix = key.slice(0, -'/manifest.json'.length);
        const prefixKeys = keys.filter((k) => k.startsWith(`${prefix}/`) || k === prefix);
        const allUnderPrefix = keys.every((k) => k.startsWith(`${prefix}/`));
        if (allUnderPrefix && prefixKeys.length > 0) return prefix;
    }
    return null;
}

/**
 * @param {unknown} manifest
 * @param {Set<string>} availablePaths relative to sim root
 * @returns {string|null} error message
 */
function validateManifest(manifest, availablePaths) {
    if (!manifest || typeof manifest !== 'object') {
        return 'manifest must be an object';
    }
    const m = /** @type {Record<string, unknown>} */ (manifest);
    if (typeof m.frameCount !== 'number' || m.frameCount < 1) {
        return 'manifest.frameCount must be a positive number';
    }
    if (!Array.isArray(m.dims) || m.dims.length !== 3) {
        return 'manifest.dims must be [nx, ny, nz]';
    }
    if (!m.bounds || typeof m.bounds !== 'object') {
        return 'manifest.bounds is required';
    }
    if (m.dataType !== 'uint8') {
        return 'manifest.dataType must be uint8';
    }

    if (m.multipart === true) {
        if (!Array.isArray(m.parts) || m.parts.length === 0) {
            return 'multipart manifest requires non-empty parts array';
        }
        for (const part of m.parts) {
            if (!part || typeof part !== 'object') {
                return 'invalid part entry in manifest.parts';
            }
            const p = /** @type {Record<string, unknown>} */ (part);
            if (typeof p.dataFile !== 'string' || !availablePaths.has(p.dataFile.replace(/\\/g, '/'))) {
                return `missing data file for part: ${String(p.dataFile)}`;
            }
            if (typeof p.frameStart !== 'number' || typeof p.frameCount !== 'number') {
                return 'part must have frameStart and frameCount';
            }
        }
        return null;
    }

    if (typeof m.dataFile !== 'string') {
        return 'manifest.dataFile is required for single-file export';
    }
    const dataFile = m.dataFile.replace(/\\/g, '/');
    if (!availablePaths.has(dataFile)) {
        return `missing data file: ${dataFile}`;
    }
    return null;
}

/**
 * @param {Buffer|Uint8Array} zipBuffer
 * @param {{ maxZipBytes?: number, maxUncompressedBytes?: number, maxEntries?: number }} [opts]
 * @returns {{ entries: Record<string, Buffer>, manifestPrefix: string, manifest: object }}
 */
export function extractFdsSmokeZip(zipBuffer, opts = {}) {
    const zipBytes = zipBuffer instanceof Uint8Array ? zipBuffer : new Uint8Array(zipBuffer);
    const limits = {
        maxZipBytes: opts.maxZipBytes ?? FDS_SMOKE_MAX_ZIP_BYTES,
        maxUncompressedBytes: opts.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES,
        maxEntries: opts.maxEntries ?? MAX_ZIP_ENTRIES,
    };

    const unz = unzipFdsSmokeWithLimits(zipBytes, limits);

    const rawKeys = Object.keys(unz);
    if (rawKeys.length === 0) {
        throw new FdsSmokeUploadError('empty_zip', 'ZIP archive is empty');
    }

    /** @type {Record<string, Buffer>} */
    const entries = {};
    for (const rawKey of rawKeys) {
        const data = unz[rawKey];
        if (!(data instanceof Uint8Array)) continue;
        entries[rawKey] = Buffer.from(data);
    }

    const manifestPrefix = detectManifestPrefix(entries);
    if (manifestPrefix === null) {
        throw new FdsSmokeUploadError('manifest_missing', 'manifest.json not found in ZIP');
    }

    /** @type {Record<string, Buffer>} */
    const normalized = {};
    const prefixWithSlash = manifestPrefix ? `${manifestPrefix}/` : '';

    for (const [rel, buf] of Object.entries(entries)) {
        if (manifestPrefix && !rel.startsWith(prefixWithSlash) && rel !== manifestPrefix) {
            continue;
        }
        const outRel = manifestPrefix ? rel.slice(prefixWithSlash.length) : rel;
        if (!outRel || outRel.endsWith('/')) continue;
        if (!isAllowedFdsSmokePath(outRel)) {
            throw new FdsSmokeUploadError('invalid_file_type', `Disallowed file in ZIP: ${outRel}`);
        }
        normalized[outRel] = buf;
    }

    if (!normalized['manifest.json']) {
        throw new FdsSmokeUploadError('manifest_missing', 'manifest.json not found after normalization');
    }

    let manifest;
    try {
        manifest = JSON.parse(normalized['manifest.json'].toString('utf8'));
    } catch {
        throw new FdsSmokeUploadError('invalid_manifest', 'manifest.json is not valid JSON');
    }

    const availablePaths = new Set(Object.keys(normalized));
    const manifestErr = validateManifest(manifest, availablePaths);
    if (manifestErr) {
        throw new FdsSmokeUploadError('invalid_manifest', manifestErr);
    }

    return { entries: normalized, manifestPrefix, manifest };
}

export class FdsSmokeUploadError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     */
    constructor(code, message) {
        super(message);
        this.name = 'FdsSmokeUploadError';
        this.code = code;
    }
}

/**
 * @param {string} simulationsDir
 * @param {string} simId
 * @returns {string}
 */
export function getSimulationDir(simulationsDir, simId) {
    return path.join(simulationsDir, simId);
}

/**
 * @param {string} simulationsDir
 * @returns {Array<{ id: string, quantity: string, frameCount: number, multipart: boolean, chunkIntervalSec: number|null, mtimeMs: number }>}
 */
export function listSimulations(simulationsDir) {
    if (!fs.existsSync(simulationsDir)) {
        return [];
    }
    const results = [];
    for (const name of fs.readdirSync(simulationsDir, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        const simDir = path.join(simulationsDir, name.name);
        const manifestPath = path.join(simDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) continue;
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const st = fs.statSync(simDir);
            results.push({
                id: name.name,
                quantity: String(manifest.quantity ?? ''),
                frameCount: Number(manifest.frameCount ?? 0),
                multipart: manifest.multipart === true,
                chunkIntervalSec: typeof manifest.chunkIntervalSec === 'number'
                    ? manifest.chunkIntervalSec
                    : null,
                mtimeMs: st.mtimeMs,
            });
        } catch {
            /* skip invalid */
        }
    }
    results.sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: 'base' }));
    return results;
}

/**
 * @param {string} tenantRoot
 * @param {string} simulationsDir
 * @param {string} simId
 * @param {Record<string, Buffer>} entries
 * @param {boolean} confirmOverwrite
 */
export function saveFdsSmokeSimulation(tenantRoot, simulationsDir, simId, entries, confirmOverwrite) {
    if (!isValidSimId(simId)) {
        throw new FdsSmokeUploadError('invalid_sim_id', 'simId must match [a-zA-Z0-9_-]{1,64}');
    }

    const destDir = getSimulationDir(simulationsDir, simId);
    if (!isPathInsideTenantRoot(tenantRoot, destDir)) {
        throw new FdsSmokeUploadError('invalid_path', 'simId resolves outside tenant root');
    }

    if (fs.existsSync(destDir)) {
        if (!confirmOverwrite) {
            throw new FdsSmokeUploadError('sim_exists', `Simulation "${simId}" already exists`);
        }
        fs.rmSync(destDir, { recursive: true, force: true });
    }

    fs.mkdirSync(destDir, { recursive: true });

    for (const [rel, buf] of Object.entries(entries)) {
        const destPath = path.join(destDir, rel);
        const parent = path.dirname(destPath);
        if (!isPathInsideTenantRoot(tenantRoot, destPath)) {
            throw new FdsSmokeUploadError('invalid_path', `Invalid destination path: ${rel}`);
        }
        if (!fs.existsSync(parent)) {
            fs.mkdirSync(parent, { recursive: true });
        }
        fs.writeFileSync(destPath, buf);
    }
}

/**
 * @param {string} tenantRoot
 * @param {string} simulationsDir
 * @param {string} simId
 */
export function deleteFdsSmokeSimulation(tenantRoot, simulationsDir, simId) {
    if (!isValidSimId(simId)) {
        throw new FdsSmokeUploadError('invalid_sim_id', 'Invalid simulation id');
    }
    const destDir = getSimulationDir(simulationsDir, simId);
    if (!isPathInsideTenantRoot(tenantRoot, destDir)) {
        throw new FdsSmokeUploadError('invalid_path', 'simId resolves outside tenant root');
    }
    if (!fs.existsSync(destDir)) {
        throw new FdsSmokeUploadError('not_found', 'Simulation not found');
    }
    fs.rmSync(destDir, { recursive: true, force: true });
}
