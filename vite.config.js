import path from 'node:path';
import fs from 'node:fs';
import { defineConfig } from 'vite';
import {
    isFdsSmokeBulkDisabled,
    resolveFdsSmokeBulkPort,
} from './lib/fds-smoke-bulk-process.js';

const projectRoot = path.resolve(process.cwd());
const simpleRoot = path.resolve(projectRoot, '..', 'metaverse-simple');
const threeMeshUiEntry = path.join(simpleRoot, 'node_modules/three-mesh-ui/build/three-mesh-ui.module.js');
const socketIoOriginal = path.join(projectRoot, 'node_modules/socket.io-client/build/esm/index.js');
const simpleAssetResolve = path.join(simpleRoot, 'public/js/asset-resolve.js');
const tenantAssetResolve = path.join(projectRoot, 'public/js/tenant-asset-resolve.js');
const simpleMeshBvhClient = path.join(simpleRoot, 'public/js/mesh-bvh-worker-client.js');
const tenantMeshBvhClient = path.join(projectRoot, 'public/js/tenant-mesh-bvh-worker-client.js');
const simpleMetaverseI18n = path.join(simpleRoot, 'public/js/metaverse-i18n.js');
const simpleServiceWorkerRegister = path.join(simpleRoot, 'public/js/service-worker-register.js');
const tenantServiceWorkerRegister = path.join(projectRoot, 'public/js/tenant-service-worker-register-shim.js');

/** tenant パスと API / Socket / HTML を Node (3002) へプロキシ */
const devPort = parseInt(String(process.env.VITE_DEV_PORT || '3003'), 10) || 3003;
const nodeDevPort = parseInt(String(process.env.PORT || '3002'), 10) || 3002;
const fdsSmokeBulkPort = resolveFdsSmokeBulkPort(nodeDevPort);
const simulationsProxyTarget =
    fdsSmokeBulkPort && !isFdsSmokeBulkDisabled()
        ? `http://127.0.0.1:${fdsSmokeBulkPort}`
        : `http://127.0.0.1:${nodeDevPort}`;

const tenantProxy = {
    target: 'http://localhost:3002',
    changeOrigin: true,
    ws: true,
    configure(proxy) {
        proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('X-Forwarded-Proto', 'https');
            proxyReq.setHeader('X-Forwarded-Host', `localhost:${devPort}`);
        });
    },
};
/** tenant ID 1 セグメント */
const TENANT_SEGMENT = '[A-Za-z0-9][A-Za-z0-9-]*';

export default defineConfig({
    root: 'public',
    envDir: projectRoot,
    resolve: {
        dedupe: ['three'],
        alias: [
            {
                find: /^three$/,
                replacement: path.join(projectRoot, 'node_modules/three/build/three.module.js'),
            },
            {
                find: /^three\/addons\/(.*)$/,
                replacement: `${path.join(projectRoot, 'node_modules/three/examples/jsm')}/$1`,
            },
            {
                find: 'socket.io-client-original',
                replacement: socketIoOriginal,
            },
            {
                find: 'socket.io-client',
                replacement: path.join(projectRoot, 'public/js/tenant-socket-io-shim.js'),
            },
            {
                find: '@metaverse-simple/asset-resolve-original',
                replacement: simpleAssetResolve,
            },
            {
                find: simpleAssetResolve,
                replacement: tenantAssetResolve,
            },
            {
                find: simpleMeshBvhClient,
                replacement: tenantMeshBvhClient,
            },
            {
                find: simpleServiceWorkerRegister,
                replacement: tenantServiceWorkerRegister,
            },
            {
                find: '@metaverse-simple/setting.js',
                replacement: path.join(simpleRoot, 'public/js/setting.js'),
            },
            {
                find: /^@metaverse-simple\/addons\/(.*)$/,
                replacement: `${path.join(simpleRoot, 'addons')}/$1`,
            },
            {
                find: '/js/metaverse-i18n.js',
                replacement: simpleMetaverseI18n,
            },
            {
                find: 'mediasoup-client',
                replacement: path.join(simpleRoot, 'node_modules/mediasoup-client/lib/index.js'),
            },
        ],
    },
    optimizeDeps: {
        exclude: ['three-mesh-bvh'],
    },
    worker: {
        format: 'es',
    },
    server: {
        port: devPort,
        strictPort: true,
        host: true,
        open: devPort === 3003 ? '/' : false,
        fs: {
            allow: [projectRoot, simpleRoot],
        },
        proxy: {
            '/api': tenantProxy,
            '/admin': tenantProxy,
            '/admin.html': tenantProxy,
            '/admin-tenant.html': tenantProxy,
            '/metaverse-simple-static': tenantProxy,
            '/js/metaverse-i18n.js': tenantProxy,
            '/api/addons': tenantProxy,
            [`^/${TENANT_SEGMENT}/api`]: tenantProxy,
            [`^/${TENANT_SEGMENT}/socket.io`]: tenantProxy,
            [`^/${TENANT_SEGMENT}/models`]: tenantProxy,
            [`^/${TENANT_SEGMENT}/avatars`]: tenantProxy,
            [`^/${TENANT_SEGMENT}/images`]: tenantProxy,
            [`^/${TENANT_SEGMENT}/pdfs`]: tenantProxy,
            [`^/${TENANT_SEGMENT}/env`]: tenantProxy,
            [`^/${TENANT_SEGMENT}/simulations`]: {
                target: simulationsProxyTarget,
                changeOrigin: true,
                configure(proxy) {
                    proxy.on('proxyReq', (proxyReq) => {
                        proxyReq.setHeader('X-Forwarded-Proto', 'https');
                        proxyReq.setHeader('X-Forwarded-Host', `localhost:${devPort}`);
                    });
                },
            },
            [`^/${TENANT_SEGMENT}/?$`]: tenantProxy,
        },
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: path.join(projectRoot, 'public/index.html'),
                tenant: path.join(projectRoot, 'public/tenant.html'),
                admin: path.join(projectRoot, 'public/admin.html'),
                adminTenant: path.join(projectRoot, 'public/admin-tenant.html'),
                adminTenantWorldEdit: path.join(projectRoot, 'public/admin-tenant-world-edit.html'),
            },
        },
    },
});
