// lib/tenant-esm-deps.js — 全テナント共通の bare specifier 用 ESM (import map 向け)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** SIM 本体が配信する npm パッケージ（テナント横断） */
export const SIM_TENANT_ESM_PACKAGES = {
    three: path.join(projectRoot, 'node_modules', 'three'),
    'three-mesh-ui': path.join(projectRoot, 'node_modules', 'three-mesh-ui'),
};

/** HTTP マウントパス（/:tenantId 直下） */
export const TENANT_ESM_DEPS_MOUNT = '/api/tenant-esm-deps';

/**
 * @param {import('express').Router} router
 * @param {string} mountPath e.g. `/api/tenant-esm-deps`
 * @param {Record<string, string>} [extraPackageRoots]
 */
export function mountTenantEsmDeps(router, mountPath, extraPackageRoots = {}) {
    const depRoots = { ...SIM_TENANT_ESM_PACKAGES, ...extraPackageRoots };
    router.get(`${mountPath}/:pkg/*`, (req, res) => {
        const pkg = String(req.params.pkg || '').trim();
        const root = depRoots[pkg];
        if (!root || !fs.existsSync(root)) {
            return res.status(404).send('not_found');
        }
        const rel = String(req.params[0] || '').replace(/^\/+/, '');
        if (!rel || rel.includes('..')) {
            return res.status(400).send('bad_request');
        }
        const filePath = path.join(root, rel);
        if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            return res.status(404).send('not_found');
        }
        res.type(path.extname(filePath));
        return res.sendFile(filePath);
    });
}

/**
 * ブラウザ用 import map の `imports`（tenant.html bootstrap と同形）
 * @param {string} tenantId
 */
export function buildTenantEsmImportMapImports(tenantId) {
    const base = `/${encodeURIComponent(tenantId)}${TENANT_ESM_DEPS_MOUNT}`;
    return {
        three: `${base}/three/build/three.module.js`,
        'three/addons/': `${base}/three/examples/jsm/`,
        'three/examples/jsm/': `${base}/three/examples/jsm/`,
        'three-mesh-ui': `${base}/three-mesh-ui/build/three-mesh-ui.module.js`,
    };
}