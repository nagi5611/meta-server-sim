// lib/platform-reload.js — 管理パネルからの設定再読み込み・再起動
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { reloadNetworkConfig, getPortalLinks } from './platform-network-config.js';
import { reloadEnvConfig } from './platform-env-config.js';
import { resetS3Client } from './r2/r2-s3-client.js';
import { loadTenantRegistry, listTenants } from './tenant-registry.js';
import { reconcileAllTenantsAssetsToR2 } from './tenant-r2-sync.js';
import { getPlatformHttpServer, getPlatformSocketOptions } from './platform-runtime.js';
import {
    listRegisteredTenantSocketIds,
    registerTenantSocketServer,
    unregisterTenantSocketServer,
} from './tenant-socket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESTART_SIGNAL_PATH = path.join(__dirname, '..', 'data', 'platform', '.restart-signal');

/** nodemon が exit 0 を再起動しない環境向けフォールバック */
const PLATFORM_INTENTIONAL_RESTART_EXIT_CODE = 1;

/**
 * nodemon 向け再起動シグナル（watch 対象ファイルを更新して SIGTERM 再起動を促す）
 */
function touchRestartSignalFile() {
    fs.mkdirSync(path.dirname(RESTART_SIGNAL_PATH), { recursive: true });
    fs.writeFileSync(RESTART_SIGNAL_PATH, `${Date.now()}\n`, 'utf8');
}

/**
 * HTTP サーバーを閉じてプロセスを終了する
 */
function shutdownAndExitProcess(exitCode = PLATFORM_INTENTIONAL_RESTART_EXIT_CODE) {
    const httpServer = getPlatformHttpServer();
    const finish = () => {
        setTimeout(() => process.exit(exitCode), 150).unref();
    };

    if (!httpServer) {
        finish();
        return;
    }

    try {
        if (typeof httpServer.closeAllConnections === 'function') {
            httpServer.closeAllConnections();
        }
    } catch {
        /* ignore */
    }

    httpServer.close(() => {
        finish();
    });
    setTimeout(() => {
        console.error('[platform-reload] forced exit after shutdown timeout');
        process.exit(exitCode);
    }, 5000).unref();
}

/**
 * ネットワーク設定と tenant レジストリをディスクから再読み込みする
 * @returns {{
 *   ok: true,
 *   reloadedAt: number,
 *   network: { portalLinks: number, proxyServiceDomain: string },
 *   tenants: {
 *     loaded: string[],
 *     skipped: number,
 *     socketsRegistered: string[],
 *     socketsRemoved: string[],
 *   },
 * }}
 */
export function reloadPlatformSettings() {
    reloadEnvConfig();
    const networkCfg = reloadNetworkConfig();
    resetS3Client();
    const { loaded, skipped } = loadTenantRegistry();
    const loadedIds = new Set(loaded.map((t) => t.id));
    const registeredIds = listRegisteredTenantSocketIds();

    const socketsRemoved = [];
    const socketsRegistered = [];

    for (const tenantId of registeredIds) {
        if (!loadedIds.has(tenantId)) {
            unregisterTenantSocketServer(tenantId);
            socketsRemoved.push(tenantId);
        }
    }

    const httpServer = getPlatformHttpServer();
    const socketOptions = getPlatformSocketOptions();
    if (httpServer) {
        const stillRegistered = new Set(listRegisteredTenantSocketIds());
        for (const tenant of loaded) {
            if (!stillRegistered.has(tenant.id)) {
                registerTenantSocketServer(httpServer, tenant, socketOptions);
                socketsRegistered.push(tenant.id);
            }
        }
    }

    console.log(
        `[platform-reload] settings reloaded: tenants=${loaded.length}, portalLinks=${getPortalLinks().length}, sockets+${socketsRegistered.length}/-${socketsRemoved.length}`
    );

    void reconcileAllTenantsAssetsToR2(loaded)
        .then((report) => {
            if (report.skipped) return;
            for (const t of report.tenants) {
                if (t.skipped) continue;
                console.log(
                    `[tenant-r2-sync] reload ${t.tenantId}: uploaded=${t.uploaded}, skipped=${t.skippedCount}, errors=${t.errors}`
                );
            }
        })
        .catch((err) => {
            console.error('[tenant-r2-sync] reload reconcile failed:', err);
        });

    return {
        ok: true,
        reloadedAt: Date.now(),
        network: {
            portalLinks: getPortalLinks().length,
            proxyServiceDomain: networkCfg.proxyServiceDomain || '',
        },
        tenants: {
            loaded: listTenants().map((t) => t.id),
            skipped: skipped.length,
            socketsRegistered,
            socketsRemoved,
        },
    };
}

/**
 * HTTP サーバーを再起動する（dev: nodemon シグナルファイル、本番: プロセス終了）
 */
export function requestPlatformRestart() {
    console.log('[platform-reload] full restart requested from admin');

    let signalWritten = false;
    try {
        touchRestartSignalFile();
        signalWritten = true;
        console.log('[platform-reload] restart signal written');
    } catch (e) {
        console.warn('[platform-reload] restart signal file failed:', e);
    }

    // dev (nodemon): シグナルファイルの変更で SIGTERM → 再起動。process.exit は競合するので使わない
    if (process.env.METAVERSE_DEV_NODEMON === '1' && signalWritten) {
        console.log('[platform-reload] nodemon will restart the server');
        return;
    }

    console.log('[platform-reload] shutting down process for restart');
    shutdownAndExitProcess();
}
