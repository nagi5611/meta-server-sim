// lib/fds-smoke-bulk-child.js — FDS 煙バイナリ専用 HTTP（メインプロセスと分離）

import 'dotenv/config';
import express from 'express';
import http from 'http';
import { loadTenantRegistry } from './tenant-registry.js';
import { tenantResolver } from './tenant-context.js';
import { createFdsSmokeStaticHandler } from './fds-smoke-delivery.js';
import { resolveServerBootConfig } from './platform-network-config.js';

if (process.env.FDS_SMOKE_BULK_CHILD !== '1') {
    console.error('[fds-smoke-bulk-child] FDS_SMOKE_BULK_CHILD=1 required');
    process.exit(1);
}

const port = parseInt(String(process.env.FDS_SMOKE_BULK_PORT || ''), 10);
if (!Number.isFinite(port) || port <= 0) {
    console.error('[fds-smoke-bulk-child] invalid FDS_SMOKE_BULK_PORT');
    process.exit(1);
}

const boot = resolveServerBootConfig();
const host = String(process.env.HOST || boot.host || '0.0.0.0');
/** メイン server の Socket.io と同じ許可オリジン（resolveServerBootConfig → socketCorsOrigins） */
const allowedOrigins = new Set(boot.socketCorsOrigins);

const { loaded: tenants } = loadTenantRegistry();

const app = express();

app.use((req, res, next) => {
    const origin = req.get('origin');
    const allowed = Boolean(origin && allowedOrigins.has(origin));
    if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    }
    if (req.method === 'OPTIONS') {
        return res.status(allowed ? 204 : 403).end();
    }
    next();
});

const simulationsRouter = express.Router();
simulationsRouter.use((req, res, next) => {
    const tenant = req.tenant;
    if (!tenant) {
        return res.status(404).json({ error: 'tenant_not_found' });
    }
    return createFdsSmokeStaticHandler(tenant, { trafficChannel: 'fds_smoke_bulk' })(req, res, next);
});

app.use('/:tenantId/simulations', tenantResolver, simulationsRouter);

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'fds-smoke-bulk' });
});

const httpServer = http.createServer(app);

httpServer.listen(port, host, () => {
    if (process.send) {
        process.send({ type: 'fds-smoke-bulk-ready', port });
    }
    const tenantIds = tenants.map((t) => t.id).join(', ') || '(none)';
    console.log(`[fds-smoke-bulk] http://${host}:${port} tenants=${tenantIds}`);
});

function shutdown() {
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
