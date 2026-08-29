// lib/tenant-registry.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidTenantId, TENANT_REGISTRY_SKIP } from './tenant-id.js';
import {
    getTenantStoragePaths,
    ensureTenantDirectories,
} from './tenant-storage-paths.js';
import { TENANT_DEFAULT_WORLDS } from './tenant-metaverse-defaults.js';
import { seedTenantMetaverseAssets } from './seed-tenant-assets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TENANTS_DIR = path.join(PROJECT_ROOT, 'tenants');

/**
 * @typedef {{
 *   id: string,
 *   displayName: string,
 *   enabled: boolean,
 *   rootPath: string,
 *   paths: ReturnType<typeof getTenantStoragePaths>,
 * }} TenantRecord
 */

/** @type {Map<string, TenantRecord>} */
const tenantsById = new Map();

/**
 * tenants ディレクトリの絶対パス
 * @returns {string}
 */
export function getTenantsDir() {
    return TENANTS_DIR;
}

/**
 * 登録済み tenant 一覧
 * @returns {TenantRecord[]}
 */
export function listTenants() {
    return [...tenantsById.values()];
}

/**
 * @param {string} tenantId
 * @returns {TenantRecord | undefined}
 */
export function getTenant(tenantId) {
    return tenantsById.get(String(tenantId || '').trim());
}

/**
 * tenant.json を読み込み検証する
 * @param {string} dirPath
 * @returns {{ ok: true, record: TenantRecord } | { ok: false, error: string }}
 */
export function loadTenantFromDir(dirPath) {
    const dirName = path.basename(dirPath);
    if (TENANT_REGISTRY_SKIP.has(dirName)) {
        return { ok: false, error: 'skipped template directory' };
    }

    const configPath = path.join(dirPath, 'tenant.json');
    if (!fs.existsSync(configPath)) {
        return { ok: false, error: 'tenant.json missing' };
    }

    let raw;
    try {
        raw = fs.readFileSync(configPath, 'utf8');
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `read tenant.json failed: ${msg}` };
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false, error: 'tenant.json invalid JSON' };
    }

    const id = String(parsed?.id ?? dirName).trim();
    if (!isValidTenantId(id)) {
        return { ok: false, error: `invalid tenant id: ${id}` };
    }
    if (id !== dirName) {
        return { ok: false, error: `tenant.json id "${id}" does not match directory "${dirName}"` };
    }

    const enabled = parsed?.enabled !== false;
    if (!enabled) {
        return { ok: false, error: 'tenant disabled' };
    }

    const displayName = String(parsed?.displayName ?? id).trim() || id;
    const paths = getTenantStoragePaths(dirPath);

    try {
        ensureTenantDirectories(paths);
        if (!fs.existsSync(paths.WORLDS_PATH)) {
            fs.writeFileSync(
                paths.WORLDS_PATH,
                JSON.stringify(TENANT_DEFAULT_WORLDS, null, 2),
                'utf8'
            );
        }
        seedTenantMetaverseAssets(paths);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `prepare directories failed: ${msg}` };
    }

    return {
        ok: true,
        record: {
            id,
            displayName,
            enabled: true,
            rootPath: dirPath,
            paths,
        },
    };
}

/**
 * tenants/ をスキャンしてレジストリを構築する（壊れた tenant はスキップ）
 * @returns {{ loaded: TenantRecord[], skipped: Array<{ dir: string, error: string }> }}
 */
export function loadTenantRegistry() {
    tenantsById.clear();

    if (!fs.existsSync(TENANTS_DIR)) {
        fs.mkdirSync(TENANTS_DIR, { recursive: true });
    }

    const loaded = /** @type {TenantRecord[]} */ ([]);
    const skipped = /** @type {Array<{ dir: string, error: string }>} */ ([]);

    const entries = fs.readdirSync(TENANTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(TENANTS_DIR, entry.name);
        const result = loadTenantFromDir(dirPath);
        if (!result.ok) {
            if (result.error !== 'skipped template directory') {
                skipped.push({ dir: entry.name, error: result.error });
                console.warn(`[tenant-registry] skip "${entry.name}": ${result.error}`);
            }
            continue;
        }
        tenantsById.set(result.record.id, result.record);
        loaded.push(result.record);
        console.log(`[tenant-registry] loaded tenant: ${result.record.id}`);
    }

    return { loaded, skipped };
}

/**
 * レジストリへ tenant を登録する
 * @param {TenantRecord} record
 */
export function registerTenant(record) {
    tenantsById.set(record.id, record);
    console.log(`[tenant-registry] registered tenant: ${record.id}`);
}

/**
 * レジストリから tenant を解除する
 * @param {string} tenantId
 * @returns {boolean}
 */
export function unregisterTenant(tenantId) {
    const id = String(tenantId || '').trim();
    const removed = tenantsById.delete(id);
    if (removed) {
        console.log(`[tenant-registry] unregistered tenant: ${id}`);
    }
    return removed;
}

/**
 * ディスクから単体 tenant を再読込して登録する
 * @param {string} tenantId
 * @returns {{ ok: true, record: TenantRecord } | { ok: false, error: string, code: string }}
 */
export function reloadTenantFromDisk(tenantId) {
    const id = String(tenantId || '').trim();
    const dirPath = path.join(TENANTS_DIR, id);
    if (!fs.existsSync(dirPath)) {
        return { ok: false, error: 'tenant directory missing', code: 'tenant_not_found' };
    }
    const result = loadTenantFromDir(dirPath);
    if (!result.ok) {
        return { ok: false, error: result.error, code: 'load_failed' };
    }
    registerTenant(result.record);
    return { ok: true, record: result.record };
}
