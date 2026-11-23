// test/tenant-esm-deps.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildTenantEsmImportMapImports,
    TENANT_ESM_DEPS_MOUNT,
} from '../lib/tenant-esm-deps.js';

test('buildTenantEsmImportMapImports uses SIM core tenant-esm-deps mount', () => {
    const imports = buildTenantEsmImportMapImports('P-01');
    const base = `/P-01${TENANT_ESM_DEPS_MOUNT}`;
    assert.equal(imports.three, `${base}/three/build/three.module.js`);
    assert.equal(imports['three/addons/'], `${base}/three/examples/jsm/`);
    assert.equal(imports['three-mesh-ui'], `${base}/three-mesh-ui/build/three-mesh-ui.module.js`);
});