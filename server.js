// server.js — metaverse-simulation プラットフォームコア

import 'dotenv/config';

import express from 'express';

import http from 'http';

import path from 'path';

import fs from 'fs';

import { fileURLToPath } from 'url';

import {

    getPortalLinksForRequest,

    getTenantPublicUrl,

    resolveServerBootConfig,

} from './lib/platform-network-config.js';

import { loadTenantRegistry, listTenants } from './lib/tenant-registry.js';
import { reconcileAllTenantsAssetsToR2 } from './lib/tenant-r2-sync.js';

import { tenantResolver } from './lib/tenant-context.js';

import { createTenantRouter } from './lib/tenant-api.js';

import { registerTenantSocketServers } from './lib/tenant-socket.js';

import { isValidTenantId } from './lib/tenant-id.js';

import { registerPlatformAdmin } from './lib/platform-admin.js';

import { initPlatformRuntime } from './lib/platform-runtime.js';
import { ensureTenantMediasoupWorkers } from './lib/tenant-socket-features.js';
import { startFdsSmokeBulkServer, stopFdsSmokeBulkServer } from './lib/fds-smoke-bulk-process.js';



const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);



const boot = resolveServerBootConfig();

for (const w of boot.warnings) {

    console.warn(`[metaverse-simulation] ${w}`);

}



const isNodeProduction = process.env.NODE_ENV === 'production';

const isProductionBuild =

    isNodeProduction && fs.existsSync(path.join(__dirname, 'dist', 'index.html'));

const STATIC_DIR = path.join(__dirname, isProductionBuild ? 'dist' : 'public');

const SIMPLE_PUBLIC_DIR = path.resolve(__dirname, '..', 'metaverse-simple', 'public');



const {

    port: PORT,

    host: HOST,

    useReverseProxy,

    requireSecureHttp,

    trustProxy,

    proxyDomainPortMap,

    proxyServiceDomain: PROXY_SERVICE_DOMAIN,

    socketCorsOrigins,

} = boot;



const { loaded: tenants, skipped } = loadTenantRegistry();



const app = express();

const httpServer = http.createServer(app);



app.use(express.json({ limit: '10mb' }));



if (useReverseProxy && trustProxy) {

    app.set('trust proxy', trustProxy);

}



if (requireSecureHttp && useReverseProxy && !app.get('trust proxy')) {

    console.warn(

        '[security] REQUIRE_SECURE_HTTP=1 with USE_REVERSE_PROXY=1 but trust proxy is off; set TRUST_PROXY=1.'

    );

}



if (requireSecureHttp) {
    app.use((req, res, next) => {
        if (req.secure) return next();
        // ローカル wait-on・監視用（REQUIRE_SECURE_HTTP 時も HTTP で生存確認可能）
        if (req.path === '/api/health') return next();
        return res.status(403).send('HTTPS required');
    });
}



registerPlatformAdmin(app, { staticDir: STATIC_DIR });

if (fs.existsSync(SIMPLE_PUBLIC_DIR)) {
    app.use('/metaverse-simple-static', express.static(SIMPLE_PUBLIC_DIR, { index: false }));
    app.get('/js/metaverse-i18n.js', (_req, res) => {
        res.sendFile(path.join(SIMPLE_PUBLIC_DIR, 'js', 'metaverse-i18n.js'));
    });
    app.get('/api/addons/matsuyama-flights/board', (_req, res) => {
        res.json({
            departures: [],
            arrivals: [],
            dataSource: 'stub',
            layoutAlert: null,
        });
    });
}



initPlatformRuntime(httpServer, { corsOrigins: socketCorsOrigins });



app.get('/api/health', (_req, res) => {

    res.json({ ok: true, service: 'metaverse-simulation-platform' });

});



app.get('/api/tenants', (_req, res) => {

    res.json({

        tenants: listTenants().map((t) => ({

            id: t.id,

            displayName: t.displayName,

            url: getTenantPublicUrl(t.id) || `/${t.id}/`,

        })),

        skipped,

    });

});



app.get('/api/client-config', (req, res) => {

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');

    res.json({

        service: 'metaverse-simulation-platform',

        proxyServiceDomain: PROXY_SERVICE_DOMAIN || null,

        portalLinks: getPortalLinksForRequest(req),

    });

});



app.use(express.static(STATIC_DIR, { index: false }));



app.get('/', (_req, res) => {

    res.sendFile(path.join(STATIC_DIR, 'index.html'));

});



app.get('/:tenantId', (req, res, next) => {

    const tenantId = String(req.params.tenantId || '').trim();

    if (!isValidTenantId(tenantId)) return next();

    if (req.path !== `/${tenantId}`) return next();

    return res.redirect(301, `/${tenantId}/`);

});



const tenantRouter = createTenantRouter(STATIC_DIR);

app.use('/:tenantId', tenantResolver, tenantRouter);



registerTenantSocketServers(httpServer, tenants, { corsOrigins: socketCorsOrigins });



/**

 * listen 失敗（EADDRINUSE 等）を握りつぶさず、nodemon が無限クラッシュループに入らないようにする

 * @param {NodeJS.ErrnoException} err

 */

function handleHttpServerError(err) {

    if (err.code === 'EADDRINUSE') {

        console.error(

            `[metaverse-simulation] Port ${PORT} is already in use on ${HOST}. ` +

                'Another dev server may still be running.'

        );

        console.error('[metaverse-simulation] Run: npm run dev:free-ports');

        process.exit(1);

        return;

    }

    console.error('[metaverse-simulation] HTTP server error:', err);

    process.exit(1);

}



/** nodemon 再起動時にポートを確実に解放する */

function shutdownHttpServer(signal) {

    console.log(`[metaverse-simulation] ${signal} received, closing HTTP server...`);

    stopFdsSmokeBulkServer();

    try {
        if (typeof httpServer.closeAllConnections === 'function') {
            httpServer.closeAllConnections();
        }
    } catch {
        /* ignore */
    }

    httpServer.close(() => {

        process.exit(0);

    });

    setTimeout(() => {

        console.error('[metaverse-simulation] forced shutdown after timeout');

        process.exit(1);

    }, 5000).unref();

}



httpServer.on('error', handleHttpServerError);

process.once('SIGTERM', () => shutdownHttpServer('SIGTERM'));

process.once('SIGINT', () => shutdownHttpServer('SIGINT'));



async function bootHttpServer() {
    try {
        await startFdsSmokeBulkServer({ host: HOST, mainPort: PORT });
    } catch (err) {
        console.error('[fds-smoke-bulk] startup failed:', err);
    }

    httpServer.listen(PORT, HOST, () => {

    void ensureTenantMediasoupWorkers().catch((err) => {
        console.error('[metaverse-simulation] mediasoup worker init failed:', err);
    });

    void reconcileAllTenantsAssetsToR2(tenants)
        .then((report) => {
            if (report.skipped) return;
            for (const t of report.tenants) {
                if (t.skipped) continue;
                console.log(
                    `[tenant-r2-sync] ${t.tenantId}: uploaded=${t.uploaded}, skipped=${t.skippedCount}, errors=${t.errors}`
                );
            }
        })
        .catch((err) => {
            console.error('[tenant-r2-sync] startup reconcile failed:', err);
        });

    console.log(`[metaverse-simulation] platform http://localhost:${PORT}`);

    console.log(`[metaverse-simulation] tenants loaded: ${tenants.map((t) => t.id).join(', ') || '(none)'}`);

    if (skipped.length > 0) {

        console.log(`[metaverse-simulation] tenants skipped: ${skipped.length}`);

    }

    if (boot.configSource !== 'env') {

        console.log(`[metaverse-simulation] network config: ${boot.configPath} (${boot.configSource})`);

    }

    if (useReverseProxy) {

        console.log('USE_REVERSE_PROXY: TLS terminates at nginx/Caddy etc.');

        if (proxyDomainPortMap.size > 0) {

            const lines = [...proxyDomainPortMap.entries()]

                .map(([h, p]) => `  ${h} -> ${p}`)

                .join('\n');

            console.log(`PROXY_DOMAIN_PORT_MAP:\n${lines}`);

        }

        if (PROXY_SERVICE_DOMAIN) {

            console.log(`PROXY_SERVICE_DOMAIN (this process): ${PROXY_SERVICE_DOMAIN}`);

        }

    }

    });
}

void bootHttpServer();

