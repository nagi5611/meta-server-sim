// public/js/tenant-setting-editor.js — metaverse-simple setting.js を Tenant 管理で起動

import { initFdsSmokePanel } from './admin-fds-smoke-panel.js';
import { initTenantWorldEditFdsSmokePreview } from './tenant-world-edit-fds-smoke.js';

/**
 * アセットタブ表示時にアバター／HDR 情報を更新する
 * @param {string} tenantId
 */
function wireAssetsTabRefresh(tenantId) {
    const tid = encodeURIComponent(tenantId);
    document.querySelector('.we-category-btn[data-we-category="assets"]')?.addEventListener('click', async () => {
        const avatarFn = document.getElementById('we-avatar-current-filename');
        const hdrFn = document.getElementById('we-hdr-current-filename');
        if (avatarFn) {
            try {
                const r = await fetch(`/${tid}/api/active-avatar`, { credentials: 'include' });
                const j = await r.json();
                avatarFn.textContent = typeof j.path === 'string' && j.path.length > 0 ? j.path : '(未設定)';
            } catch {
                avatarFn.textContent = '(取得に失敗しました)';
            }
        }
        if (hdrFn) {
            try {
                const r = await fetch(`/${tid}/api/env-ibl-hdr`, { credentials: 'include' });
                const j = await r.json().catch(() => ({}));
                if (typeof j.present === 'boolean' && typeof j.path === 'string') {
                    hdrFn.textContent = j.present ? j.path : '(未設定)';
                } else {
                    hdrFn.textContent = '(取得に失敗しました)';
                }
            } catch {
                hdrFn.textContent = '(取得に失敗しました)';
            }
        }
    });
}

/**
 * ワールド編集 UI を初期化する
 * @param {string} tenantId
 * @returns {Promise<void>}
 */
export async function initTenantSettingEditor(tenantId) {
    const { initSettingEditor } = await import('@metaverse-simple/setting.js');
    await initSettingEditor();
    wireAssetsTabRefresh(tenantId);
    await initFdsSmokePanel(tenantId);
    await initTenantWorldEditFdsSmokePreview();
}
