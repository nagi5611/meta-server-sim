// lib/tenant-vdb-upload.js — テナント VDB / NanoVDB アップロード検証・保存
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isPathInsideTenantRoot } from './tenant-storage-paths.js';

export const VDB_MAX_BYTES = 64 * 1024 * 1024;
const VDB_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;
const ALLOWED_EXT = new Set(['.vdb', '.nvdb']);
const NANO_MAGIC = 0x304244566f6e614en;
const OPENVDB_MAGIC = 0x56444220;

export class VdbUploadError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     */
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

/**
 * @param {Buffer|Uint8Array} buf
 */
export function isValidVdbOrNvdbBuffer(buf) {
    if (!buf || buf.length < 16) return false;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (view.getBigUint64(0, true) === NANO_MAGIC) return true;
    if (view.byteLength >= 4 && view.getUint32(0, false) === OPENVDB_MAGIC) return true;
    if (view.byteLength >= 4 && view.getUint32(0, true) === OPENVDB_MAGIC) return true;
    return false;
}

/**
 * @param {string} name
 */
export function sanitizeVdbFilename(name) {
    const base = path.basename(String(name || '').trim());
    const ext = path.extname(base).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
        throw new VdbUploadError('invalid_extension', 'Only .vdb and .nvdb are allowed');
    }
    const stem = base.slice(0, -ext.length).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 96);
    if (!stem) {
        throw new VdbUploadError('invalid_name', 'Invalid filename');
    }
    return `${stem}${ext}`;
}

/**
 * @param {string} vdbDir
 */
export function listTenantVdbFiles(vdbDir) {
    if (!fs.existsSync(vdbDir)) return [];
    const out = [];
    for (const name of fs.readdirSync(vdbDir)) {
        const ext = path.extname(name).toLowerCase();
        if (!ALLOWED_EXT.has(ext)) continue;
        const full = path.join(vdbDir, name);
        if (!fs.statSync(full).isFile()) continue;
        const st = fs.statSync(full);
        out.push({
            name,
            file: `vdbs/${name}`,
            bytes: st.size,
            mtimeMs: st.mtimeMs,
        });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {string} tenantRoot
 * @param {string} vdbDir
 * @param {string} filename
 * @param {Buffer} body
 * @param {boolean} [confirmOverwrite]
 */
export function saveTenantVdbFile(tenantRoot, vdbDir, filename, body, confirmOverwrite = false) {
    if (body.length > VDB_MAX_BYTES) {
        throw new VdbUploadError('too_large', `File exceeds ${Math.round(VDB_MAX_BYTES / (1024 * 1024))} MiB`);
    }
    if (!isValidVdbOrNvdbBuffer(body)) {
        throw new VdbUploadError('invalid_header', 'Unrecognized VDB / NanoVDB header');
    }
    const safeName = sanitizeVdbFilename(filename);
    const dest = path.join(vdbDir, safeName);
    if (!isPathInsideTenantRoot(tenantRoot, dest)) {
        throw new VdbUploadError('invalid_path', 'Path escapes tenant root');
    }
    fs.mkdirSync(vdbDir, { recursive: true });
    if (fs.existsSync(dest) && !confirmOverwrite) {
        throw new VdbUploadError('exists', 'File already exists');
    }
    const tmp = `${dest}.tmp.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, dest);
    return { name: safeName, file: `vdbs/${safeName}`, bytes: body.length };
}

/**
 * @param {string} tenantRoot
 * @param {string} vdbDir
 * @param {string} filename
 */
export function deleteTenantVdbFile(tenantRoot, vdbDir, filename) {
    const safeName = sanitizeVdbFilename(filename);
    const dest = path.join(vdbDir, safeName);
    if (!isPathInsideTenantRoot(tenantRoot, dest) || !fs.existsSync(dest)) {
        throw new VdbUploadError('not_found', 'File not found');
    }
    fs.unlinkSync(dest);
    return { name: safeName };
}