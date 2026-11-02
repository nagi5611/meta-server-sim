// Serve selected node_modules as ESM for static AR pages (import maps).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..'
);

/** @type {Record<string, string>} */
const DEP_ROOTS = {
    three: path.join(projectRoot, 'node_modules', 'three'),
    webar: path.join(projectRoot, 'node_modules', '@web-ar-studio', 'webar-engine-sdk'),
};

/**
 * @param {import('express').Router} router
 * @param {string} mountPath e.g. `/deps`
 */
export function mountArxrNpmDeps(router, mountPath) {
    router.get(`${mountPath}/:pkg/*`, (req, res) => {
        const pkg = String(req.params.pkg || '').trim();
        const root = DEP_ROOTS[pkg];
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
