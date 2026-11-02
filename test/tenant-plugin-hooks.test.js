import test from 'node:test';
import assert from 'node:assert/strict';
import { getHookRegistry, clearTenantPluginHooks, HOOKS } from '../lib/hook-registry.js';

test('clearTenantPluginHooks removes only matching tenant plugin handlers', async () => {
    const hooks = getHookRegistry();
    let countA = 0;
    let countB = 0;
    hooks.on(
        HOOKS.SOCKET_TENANT_CONNECT,
        () => {
            countA += 1;
        },
        { tenantId: 'P-01', source: 'tenant-plugin', pluginId: 'a' }
    );
    hooks.on(
        HOOKS.SOCKET_TENANT_CONNECT,
        () => {
            countB += 1;
        },
        { tenantId: 'P-02', source: 'tenant-plugin', pluginId: 'b' }
    );
    hooks.on(HOOKS.SOCKET_TENANT_CONNECT, () => {
        countB += 10;
    });

    clearTenantPluginHooks('P-01');
    await hooks.emitAsync(HOOKS.SOCKET_TENANT_CONNECT, { tenantId: 'P-01' });

    assert.equal(countA, 0);
    assert.equal(countB, 11);
});
