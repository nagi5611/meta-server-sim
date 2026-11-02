// public/js/admin-fleet-ops.js — 系列コア Fleet 統合 ops UI
import { adminFetch } from './admin-api-fetch.js';

/** @typedef {{ id: string, label: string, systemdUnit: string, envFile: string, publicHost?: string, nginxPort?: number, envFileExists?: boolean }} FleetCoreRow */

let fleetMeta = null;
/** @type {string | null} */
let selectedCoreId = null;

/**
 * @param {string} msg
 */
function setFleetStatus(msg) {
    const el = document.getElementById('fleet-ops-status');
    if (el) el.textContent = msg;
}

async function loadFleetMeta() {
    const res = await adminFetch('/admin/fleet', { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
    }
    fleetMeta = data;
    return data;
}

/**
 * @param {FleetCoreRow} core
 */
function renderCoreRow(core) {
    const tr = document.createElement('tr');
    tr.dataset.coreId = core.id;
    tr.innerHTML = `
      <td>${escapeHtml(core.label)}<br><code>${escapeHtml(core.id)}</code></td>
      <td><code>${escapeHtml(core.systemdUnit)}</code></td>
      <td>${core.publicHost ? escapeHtml(core.publicHost) : '—'}${core.nginxPort ? `<br>:${core.nginxPort}` : ''}</td>
      <td class="fleet-active-cell" data-core-id="${escapeHtml(core.id)}">—</td>
      <td>
        <button type="button" class="btn btn-secondary btn-sm fleet-edit-btn" data-core-id="${escapeHtml(core.id)}">編集</button>
        <button type="button" class="btn btn-secondary btn-sm fleet-status-btn" data-core-id="${escapeHtml(core.id)}">状態</button>
      </td>
      <td class="fleet-service-actions">
        <button type="button" class="btn btn-secondary btn-sm fleet-svc-btn" data-action="start" data-core-id="${escapeHtml(core.id)}">起動</button>
        <button type="button" class="btn btn-secondary btn-sm fleet-svc-btn" data-action="stop" data-core-id="${escapeHtml(core.id)}">停止</button>
        <button type="button" class="btn btn-warning btn-sm fleet-svc-btn" data-action="restart" data-core-id="${escapeHtml(core.id)}">再起動</button>
      </td>
    `;
    return tr;
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function refreshCoreActiveStates() {
    if (!fleetMeta?.cores) return;
    await Promise.all(
        fleetMeta.cores.map(async (core) => {
            const cell = document.querySelector(`.fleet-active-cell[data-core-id="${core.id}"]`);
            if (!cell) return;
            try {
                const res = await adminFetch(`/admin/fleet/cores/${encodeURIComponent(core.id)}/status`, {
                    credentials: 'include',
                });
                const data = await res.json().catch(() => ({}));
                cell.textContent = res.ok ? data.active || 'unknown' : 'err';
                cell.classList.toggle('fleet-active-ok', data.active === 'active');
            } catch {
                cell.textContent = 'err';
            }
        }),
    );
}

/**
 * @param {string} coreId
 */
async function openFleetEnvEditor(coreId) {
    selectedCoreId = coreId;
    const panel = document.getElementById('fleet-env-editor');
    const fields = document.getElementById('fleet-env-fields');
    const title = document.getElementById('fleet-env-editor-title');
    if (!panel || !fields) return;

    const res = await adminFetch(`/admin/fleet/cores/${encodeURIComponent(coreId)}/env`, {
        credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
    }

    if (title) {
        title.textContent = `環境変数: ${coreId} (${data.envFile || ''})`;
    }
    fields.innerHTML = '';
    const keys = fleetMeta?.editableKeys || Object.keys(data.values || {});
    for (const key of keys) {
        const wrap = document.createElement('label');
        wrap.className = 'fleet-env-field';
        wrap.innerHTML = `<span>${escapeHtml(key)}</span>`;
        const input = document.createElement('input');
        input.type = 'text';
        input.name = key;
        input.value = data.values?.[key] ?? '';
        input.className = 'form-control';
        wrap.appendChild(input);
        fields.appendChild(wrap);
    }
    panel.hidden = false;
}

async function saveFleetEnvEditor() {
    if (!selectedCoreId) return;
    const fields = document.getElementById('fleet-env-fields');
    if (!fields) return;
    /** @type {Record<string, string>} */
    const updates = {};
    fields.querySelectorAll('input[name]').forEach((input) => {
        if (input instanceof HTMLInputElement && input.name) {
            updates[input.name] = input.value;
        }
    });
    setFleetStatus('保存中…');
    const res = await adminFetch(`/admin/fleet/cores/${encodeURIComponent(selectedCoreId)}/env`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
    }
    setFleetStatus(
        data.changed?.length
            ? `保存しました（${data.changed.join(', ')}）。再起動が必要な場合があります。`
            : '変更なし',
    );
}

/**
 * @param {string} coreId
 * @param {string} action
 */
async function runFleetServiceControl(coreId, action) {
    if (
        (action === 'stop' || action === 'restart') &&
        !confirm(`${coreId} を ${action} します。よろしいですか？`)
    ) {
        return;
    }
    setFleetStatus(`${coreId} ${action}…`);
    const res = await adminFetch(`/admin/fleet/cores/${encodeURIComponent(coreId)}/service`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
    }
    setFleetStatus(`${coreId} ${action} 完了`);
    await refreshCoreActiveStates();
}

export async function initFleetOpsPanel() {
    const tbody = document.getElementById('fleet-cores-body');
    const banner = document.getElementById('fleet-ops-disabled-banner');
    if (!tbody) return;

    try {
        const meta = await loadFleetMeta();
        if (banner) banner.hidden = meta.enabled !== false;
        tbody.innerHTML = '';
        for (const core of meta.cores || []) {
            tbody.appendChild(renderCoreRow(core));
        }
        await refreshCoreActiveStates();
    } catch (e) {
        if (banner) {
            banner.hidden = false;
            banner.textContent =
                e instanceof Error ? e.message : 'Fleet ops を読み込めません（本番ホスト / sudo 設定を確認）';
        }
        setFleetStatus('');
        return;
    }

    tbody.addEventListener('click', (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        const editBtn = target.closest('.fleet-edit-btn');
        if (editBtn instanceof HTMLElement && editBtn.dataset.coreId) {
            void openFleetEnvEditor(editBtn.dataset.coreId).catch((err) => {
                alert(err instanceof Error ? err.message : String(err));
            });
            return;
        }
        const statusBtn = target.closest('.fleet-status-btn');
        if (statusBtn instanceof HTMLElement && statusBtn.dataset.coreId) {
            void (async () => {
                const id = statusBtn.dataset.coreId;
                const res = await adminFetch(`/admin/fleet/cores/${encodeURIComponent(id)}/status`, {
                    credentials: 'include',
                });
                const data = await res.json().catch(() => ({}));
                alert(data.statusText || data.message || JSON.stringify(data));
            })();
            return;
        }
        const svcBtn = target.closest('.fleet-svc-btn');
        if (svcBtn instanceof HTMLElement && svcBtn.dataset.coreId && svcBtn.dataset.action) {
            void runFleetServiceControl(svcBtn.dataset.coreId, svcBtn.dataset.action).catch((err) => {
                alert(err instanceof Error ? err.message : String(err));
            });
        }
    });

    document.getElementById('fleet-env-save-btn')?.addEventListener('click', () => {
        void saveFleetEnvEditor().catch((err) => {
            alert(err instanceof Error ? err.message : String(err));
        });
    });
    document.getElementById('fleet-env-cancel-btn')?.addEventListener('click', () => {
        const panel = document.getElementById('fleet-env-editor');
        if (panel) panel.hidden = true;
        selectedCoreId = null;
    });
    document.getElementById('fleet-refresh-btn')?.addEventListener('click', () => {
        void refreshCoreActiveStates();
    });
}
