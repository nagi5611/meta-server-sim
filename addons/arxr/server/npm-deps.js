// Delegate npm ESM to SIM core; arxr adds webar-engine-sdk only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountTenantEsmDeps } from '../../../lib/tenant-esm-deps.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * @param {import('express').Router} router
 * @param {string} mountPath e.g. `/deps`
 */
export function mountArxrNpmDeps(router, mountPath) {
    mountTenantEsmDeps(router, mountPath, {
        webar: path.join(projectRoot, 'node_modules', '@web-ar-studio', 'webar-engine-sdk'),
    });
}