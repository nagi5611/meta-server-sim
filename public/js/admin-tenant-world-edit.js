// public/js/admin-tenant-world-edit.js — Tenant ワールド編集ページ
import '../css/mt-console/colors_and_type.css';
import '../css/mt-console/mt.css';
import '../css/mt-console/mt-editor.css';
import '../css/mt-console/world-edit-console-bridge.css';
import '../css/mt-console/admin-console-compat.css';
import { bootstrapAdminApi } from './admin-api-fetch-init.js';
import { initMtConsoleShell } from './mt-console-shell.js';
import { mountWorldEditConsoleLayout } from './mt-console-world-edit.js';
import { initTenantSettingEditor } from './tenant-setting-editor.js';
import { initTenantWorldEditShell } from './tenant-world-edit-shell.js';
import { installTenantWorldEditXhrShim } from './tenant-world-edit-xhr.js';
import { installTenantR2FetchShim, installTenantR2UploadShim } from './tenant-r2-upload-shim.js';

/**
 * URL から tenant ID を解決する
 * @returns {string|null}
 */
function resolveTenantIdFromLocation() {
    const pathMatch = window.location.pathname.match(/\/admin\/tenant\/([^/]+)/);
    if (pathMatch?.[1]) {
        return decodeURIComponent(pathMatch[1]);
    }
    return null;
}

const tenantId = resolveTenantIdFromLocation();

function showError(message) {
    const main = document.querySelector('.admin-main') || document.body;
    main.innerHTML = `
        <header class="world-edit-page-header">
            <a class="btn btn-secondary btn-sm" href="/admin.html">Tenant 一覧</a>
            <p class="hint">${message}</p>
        </header>
    `;
}

if (!tenantId) {
    showError('Tenant ID が URL にありません。');
} else {
    initTenantWorldEditShell(tenantId);
    initMtConsoleShell({
        page: 'world-edit',
        tenantId,
        tenantLabel: tenantId,
        username: 'admin',
    });
    mountWorldEditConsoleLayout({ tenantId, tenantLabel: tenantId });

    bootstrapAdminApi()
        .then(() => {
            installTenantR2FetchShim();
            installTenantR2UploadShim();
            installTenantWorldEditXhrShim();
            return initTenantSettingEditor(tenantId);
        })
        .catch((e) => {
            console.error('[admin-tenant-world-edit] init failed:', e);
            showError(
                e instanceof Error ? e.message : 'ワールド編集の初期化に失敗しました。'
            );
        });
}
