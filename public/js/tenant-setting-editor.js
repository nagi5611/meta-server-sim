// public/js/tenant-setting-editor.js — metaverse-simple setting.js を Tenant 管理で起動

import { initFdsSmokePanel } from './admin-fds-smoke-panel.js';

/**
 * ワールド編集 UI を初期化する
 * @param {string} tenantId
 * @returns {Promise<void>}
 */
export async function initTenantSettingEditor(tenantId) {
    const { initSettingEditor } = await import('@metaverse-simple/setting.js');
    await initSettingEditor();
    await initFdsSmokePanel(tenantId);
}
