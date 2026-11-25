// public/js/mt-design-world-edit-host.js — デザイン CONSOLE 内で本番 setting.js エディタを起動
import { bootstrapAdminApi } from './admin-api-fetch-init.js';
import { initTenantSettingEditor } from './tenant-setting-editor.js';
import { initTenantWorldEditShell } from './tenant-world-edit-shell.js';
import { installTenantWorldEditXhrShim } from './tenant-world-edit-xhr.js';
import { installTenantR2FetchShim, installTenantR2UploadShim } from './tenant-r2-upload-shim.js';
import { mountWorldEditConsoleLayout } from './mt-console-world-edit.js';

/** @type {string | null} */
let mountedTenant = null;

/** @type {Promise<void> | null} */
let mountPromise = null;

const STYLE_HREFS = [
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
    '/metaverse-simple-static/css/setting.css',
    '/css/admin-tenant-world-edit.css',
    '/css/mt-console/world-edit-console-bridge.css',
];

/**
 * 本番ワールド編集用スタイルを一度だけ差し込む
 */
function ensureWorldEditStyles() {
    for (const href of STYLE_HREFS) {
        if (document.querySelector(`link[data-mt-prod-style="${href}"]`)) continue;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.mtProdStyle = href;
        document.head.appendChild(link);
    }
}

/**
 * デザイン #main に本番エディタ DOM を構築する
 * @param {string} tenantId
 */
async function injectWorldEditDom(tenantId) {
    const main = document.getElementById('main');
    if (!main) throw new Error('#main missing');

    const frag = await fetch('/admin-tenant-world-edit-body.html', { credentials: 'include' }).then((r) => {
        if (!r.ok) throw new Error(`body.html HTTP ${r.status}`);
        return r.text();
    });

    main.innerHTML = `<div class="hint" id="wed-loading">ワールド編集を読み込み中…</div>
      <div class="wed-design-host" data-tenant="${tenantId}" hidden>
        <div class="header-actions" id="world-edit-topbar-actions">
          <button type="button" class="btn btn-icon" id="admin-theme-toggle" title="ダークモードに切替"><i class="bi bi-moon-fill" id="admin-theme-icon"></i></button>
          <button type="button" class="btn btn-icon" id="admin-cache-hard-reload" title="キャッシュを削除して再読み込み" aria-label="キャッシュ再読み込み"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i></button>
          <a class="btn btn-secondary" id="back-to-metaverse" href="#">メタバースへ入る</a>
        </div>
        <div class="admin-panels wed-design-panels">
          ${frag}
        </div>
      </div>`;

    document.body.classList.add('mt-prod-world-edit', 'wed-design-active');
}

/**
 * @param {{ tenant?: string | null, tenantLabel?: string }} state
 */
export async function mountDesignProductionWorldEdit(state) {
    const tenantId = state?.tenant;
    if (!tenantId) {
        window.MT?.toast?.('テナントを選んでからワールド編集を開いてください');
        return;
    }
    if (mountedTenant === tenantId && mountPromise) return mountPromise;

    mountedTenant = tenantId;
    mountPromise = (async () => {
        ensureWorldEditStyles();
        await injectWorldEditDom(tenantId);

        const label =
            window.MTD?.TENANTS?.find((t) => t.id === tenantId)?.name || tenantId;
        initTenantWorldEditShell(tenantId);
        mountWorldEditConsoleLayout({ tenantId, tenantLabel: label });

        await bootstrapAdminApi();
        installTenantR2FetchShim();
        installTenantR2UploadShim();
        installTenantWorldEditXhrShim();
        await initTenantSettingEditor(tenantId);

        const main = document.getElementById('main');
        if (main) main.dataset.prodWorldMounted = tenantId;
        main.querySelector('.wed-design-host')?.removeAttribute('hidden');
        main.querySelector('#wed-loading')?.remove();
    })().catch((e) => {
        console.error('[mt-design-world-edit-host]', e);
        mountedTenant = null;
        mountPromise = null;
        window.MT?.toast?.('ワールド編集の初期化に失敗しました');
        throw e;
    });

    return mountPromise;
}

/**
 * プロトタイプエディタをアンロードする
 */
export function teardownDesignProductionWorldEdit() {
    if (window.ME?.isMounted) window.ME.unmount();
    const main = document.getElementById('main');
    if (main) {
        delete main.dataset.prodWorldMounted;
        main.innerHTML = '';
    }
    document.body.classList.remove('mt-prod-world-edit', 'wed-design-active');
    mountedTenant = null;
    mountPromise = null;
}

window.MTDesignWorldEdit = {
    mount: mountDesignProductionWorldEdit,
    teardown: teardownDesignProductionWorldEdit,
};