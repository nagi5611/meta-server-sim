// addons/arxr/server/main.js — QR / image AR (ported from meta public/qr-ar)
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { HOOKS } from '../../../lib/hook-registry.js';
import { mountArxrNpmDeps } from './npm-deps.js';

/** @param {import('../../../lib/tenant-plugin-loader.js').PluginRegisterContext} ctx */
async function register(ctx) {
    const staticRoot = path.join(ctx.paths.addonRoot, 'static');
    const vendorRoot = path.join(ctx.paths.addonRoot, 'vendor');

    ctx.mountHttp((router) => {
        mountArxrNpmDeps(router, '/deps');

        router.get('/', (_req, res) => {
            res.sendFile(path.join(staticRoot, 'index.html'));
        });
        router.get('/index.html', (_req, res) => {
            res.sendFile(path.join(staticRoot, 'index.html'));
        });
        router.use(
            '/vendor',
            express.static(vendorRoot, {
                index: false,
                fallthrough: false,
            })
        );
        router.use(
            express.static(staticRoot, {
                index: false,
            })
        );
    });

    ctx.hooks.on(HOOKS.AFTER_TENANT_ROUTES_MOUNTED, (payload) => {
        if (payload.tenantId !== ctx.tenantId) return;
        ctx.logger.info('arxr static routes mounted under', ctx.paths.httpBasePath);
    });

    ctx.logger.info('arxr (qr-ar) tenant plugin registered');
}

export default { register };
