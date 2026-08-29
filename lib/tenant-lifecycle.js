// lib/tenant-lifecycle.js — tenant 作成・アーカイブ
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    getTenantsDir,
    getTenant,
    loadTenantFromDir,
    registerTenant,
    unregisterTenant,
} from './tenant-registry.js';
import { validateTenantIdForCreate } from './tenant-id.js';
import {
    getPlatformHttpServer,
    getPlatformSocketOptions,
} from './platform-runtime.js';
import {
    registerTenantSocketServer,
    unregisterTenantSocketServer,
    getTenantPlayerCount,
} from './tenant-socket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLATFORM_DATA_DIR = path.join(PROJECT_ROOT, 'data', 'platform');
const TENANT_AUDIT_LOG = path.join(PLATFORM_DATA_DIR, 'tenant-audit.log');

/**
 * 監査ログを 1 行追記する
 * @param {string} action
 * @param {Record<string, unknown>} details
 */
function appendTenantAuditLog(action, details) {
    try {
        fs.mkdirSync(PLATFORM_DATA_DIR, { recursive: true });
        const line = JSON.stringify({
            ts: new Date().toISOString(),
            action,
            ...details,
        });
        fs.appendFileSync(TENANT_AUDIT_LOG, `${line}\n`, 'utf8');
    } catch (e) {
        console.warn('[tenant-lifecycle] audit log failed:', e);
    }
}

/**
 * アーカイブ先ディレクトリ名を生成する
 * @param {string} tenantId
 */
function buildArchiveDirName(tenantId) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    return `${tenantId}-${stamp}`;
}

/**
 * tenant を新規作成する
 * @param {{ id: string, displayName?: string }} input
 * @returns {Promise<{ ok: true, tenant: object } | { ok: false, error: string, code: string }>}
 */
export async function createTenant(input) {
    const idCheck = validateTenantIdForCreate(input?.id);
    if (!idCheck.ok) {
        return { ok: false, error: idCheck.error, code: idCheck.code };
    }

    const id = idCheck.id;
    const tenantsDir = getTenantsDir();
    const tenantDir = path.join(tenantsDir, id);
    const templateDir = path.join(tenantsDir, '_template');

    if (fs.existsSync(tenantDir)) {
        return { ok: false, error: 'tenant already exists', code: 'already_exists' };
    }

    if (!fs.existsSync(templateDir)) {
        return { ok: false, error: 'tenant template missing', code: 'template_missing' };
    }

    const displayName = String(input?.displayName ?? id).trim() || id;

    try {
        fs.cpSync(templateDir, tenantDir, { recursive: true });
        const tenantJson = {
            id,
            displayName,
            enabled: true,
        };
        fs.writeFileSync(
            path.join(tenantDir, 'tenant.json'),
            JSON.stringify(tenantJson, null, 2),
            'utf8'
        );
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try {
            fs.rmSync(tenantDir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
        return { ok: false, error: `create tenant directory failed: ${msg}`, code: 'create_failed' };
    }

    const loadResult = loadTenantFromDir(tenantDir);
    if (!loadResult.ok) {
        try {
            fs.rmSync(tenantDir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
        return { ok: false, error: loadResult.error, code: 'load_failed' };
    }

    registerTenant(loadResult.record);

    const httpServer = getPlatformHttpServer();
    if (httpServer) {
        registerTenantSocketServer(httpServer, loadResult.record, getPlatformSocketOptions());
    } else {
        console.warn('[tenant-lifecycle] httpServer not initialized; socket not registered');
    }

    appendTenantAuditLog('tenant_created', { tenantId: id, displayName });

    return {
        ok: true,
        tenant: {
            id: loadResult.record.id,
            displayName: loadResult.record.displayName,
            url: `/${loadResult.record.id}/`,
        },
    };
}

/**
 * tenant をアーカイブする（tenants/_archive へ移動）
 * @param {string} tenantId
 * @param {{ force?: boolean }} options
 * @returns {Promise<{ ok: true, archivedPath: string } | { ok: false, error: string, code: string, players?: number }>}
 */
export async function archiveTenant(tenantId, options = {}) {
    const id = String(tenantId || '').trim();
    const tenant = getTenant(id);
    if (!tenant) {
        return { ok: false, error: 'tenant not found', code: 'tenant_not_found' };
    }

    const players = getTenantPlayerCount(id);
    if (players > 0 && !options.force) {
        return {
            ok: false,
            error: 'players are connected to this tenant',
            code: 'players_connected',
            players,
        };
    }

    unregisterTenantSocketServer(id);
    unregisterTenant(id);

    const tenantsDir = getTenantsDir();
    const sourceDir = path.join(tenantsDir, id);
    const archiveRoot = path.join(tenantsDir, '_archive');
    const archiveName = buildArchiveDirName(id);
    const archivePath = path.join(archiveRoot, archiveName);

    try {
        fs.mkdirSync(archiveRoot, { recursive: true });
        if (!fs.existsSync(sourceDir)) {
            return { ok: false, error: 'tenant directory missing', code: 'tenant_not_found' };
        }
        fs.renameSync(sourceDir, archivePath);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const reload = loadTenantFromDir(sourceDir);
        if (reload.ok) {
            registerTenant(reload.record);
            const httpServer = getPlatformHttpServer();
            if (httpServer) {
                registerTenantSocketServer(httpServer, reload.record, getPlatformSocketOptions());
            }
        }
        return { ok: false, error: `archive failed: ${msg}`, code: 'archive_failed' };
    }

    appendTenantAuditLog('tenant_archived', {
        tenantId: id,
        archivedPath: archivePath,
        force: !!options.force,
        playersAtArchive: players,
    });

    return { ok: true, archivedPath: archivePath };
}
