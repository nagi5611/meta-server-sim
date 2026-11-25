/* mt-setting-live.js — setting.js API / アップロード shims を mt-editor に接続 */
(function () {
    'use strict';

    let bootPromise = null;

    async function ensureSettingModules(tenantId) {
        if (window.__MT_SETTING_LIVE__) return window.__MT_SETTING_LIVE__;
        if (!bootPromise) {
            bootPromise = (async () => {
                const { bootstrapAdminApi } = await import('/js/admin-api-fetch-init.js');
                await bootstrapAdminApi();
                const { installTenantR2FetchShim } = await import('/js/tenant-r2-upload-shim.js');
                const { installTenantR2UploadShim } = await import('/js/tenant-r2-upload-shim.js');
                const { installTenantWorldEditXhrShim } = await import('/js/tenant-world-edit-xhr.js');
                installTenantR2FetchShim();
                installTenantR2UploadShim();
                installTenantWorldEditXhrShim();
                const { installTenantWorldEditVdbShim } = await import('/js/tenant-world-edit-vdb-shim.js');
                await installTenantWorldEditVdbShim(tenantId);
                const svc = { tenantId, ready: true };
                window.__MT_SETTING_LIVE__ = svc;
                return svc;
            })().catch((e) => {
                console.error('[mt-setting-live] boot failed', e);
                bootPromise = null;
                return null;
            });
        }
        return bootPromise;
    }

    window.MTSettingLive = { ensureSettingModules };
})();