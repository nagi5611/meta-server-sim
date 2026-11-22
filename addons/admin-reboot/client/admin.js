// addons/admin-reboot/client/admin.js — テナントプラグイン再読込（ホスト再起動なし）
import { adminFetch } from '/js/admin-api-fetch.js';

/**
 * @returns {string}
 */
function resolveTenantIdFromLocation() {
    const m = window.location.pathname.match(/^\/admin\/tenants\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : '';
}

const TENANT_ID = resolveTenantIdFromLocation();
const API_BASE = TENANT_ID
    ? `/admin/tenants/${encodeURIComponent(TENANT_ID)}/addons/admin-reboot`
    : '/admin/addons/admin-reboot';

function mountAdminRebootPanel() {
    if (document.getElementById('addon-admin-reboot-panel')) return;
    const statusPanel = document.getElementById('panel-status');
    if (!statusPanel) return;

    const section = document.createElement('section');
    section.id = 'addon-admin-reboot-panel';
    section.className = 'stats-section addon-admin-reboot-section';
    section.innerHTML = `
        <h2>テナント再起動（プラグイン）</h2>
        <p class="hint-text">このテナントの有効プラグインのみ再読込します。ホスト全体の systemctl 再起動はできません。</p>
        <div class="addon-admin-reboot-pin-row" id="addon-admin-reboot-pin-row" hidden>
            <label for="addon-admin-reboot-pin">PIN</label>
            <input type="password" id="addon-admin-reboot-pin" autocomplete="off" />
        </div>
        <button type="button" class="btn btn-primary" id="addon-admin-reboot-reload-btn">プラグイン再読込</button>
        <p class="status-text" id="addon-admin-reboot-status" role="status"></p>
    `;
    statusPanel.appendChild(section);

    const btn = document.getElementById('addon-admin-reboot-reload-btn');
    const statusEl = document.getElementById('addon-admin-reboot-status');
    const pinRow = document.getElementById('addon-admin-reboot-pin-row');
    const pinInput = document.getElementById('addon-admin-reboot-pin');
    if (!btn || !statusEl) return;

    const setStatus = (text, isError = false) => {
        statusEl.textContent = text;
        statusEl.classList.toggle('error', isError);
    };

    void adminFetch(`${API_BASE}/capabilities`, { credentials: 'include' })
        .then((r) => r.json())
        .then((cap) => {
            if (cap?.pinRequired && pinRow) pinRow.hidden = false;
        })
        .catch(() => {});

    btn.addEventListener('click', async () => {
        setStatus('再読込中…');
        btn.disabled = true;
        try {
            const body = pinInput?.value ? { pin: pinInput.value } : {};
            const res = await adminFetch(`${API_BASE}/reload-tenant-plugins`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus(json.error || json.message || '失敗', true);
                return;
            }
            setStatus('プラグインを再読込しました。');
        } catch (e) {
            setStatus(e instanceof Error ? e.message : '失敗', true);
        } finally {
            btn.disabled = false;
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAdminRebootPanel);
} else {
    mountAdminRebootPanel();
}