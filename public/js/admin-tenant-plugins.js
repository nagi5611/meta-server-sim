// public/js/admin-tenant-plugins.js — Tenant プラグイン管理 UI
import { adminFetch } from './admin-api-fetch.js';

/**
 * @param {string} tenantId
 */
export function initTenantPluginsPanel(tenantId) {
    const statusEl = document.getElementById('tenant-plugins-status');
    const tbody = document.getElementById('tenant-plugins-table-body');
    const reloadBtn = document.getElementById('tenant-plugins-reload-btn');
    const configPanel = document.getElementById('tenant-plugin-config-panel');
    const configPluginIdEl = document.getElementById('tenant-plugin-config-plugin-id');
    const configForm = document.getElementById('tenant-plugin-config-form');
    const configSaveBtn = document.getElementById('tenant-plugin-config-save-btn');

    /** @type {string | null} */
    let selectedPluginId = null;

    const setStatus = (msg) => {
        if (statusEl) statusEl.textContent = msg;
    };

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

    async function loadPlugins() {
        const res = await adminFetch(`/admin/tenant/${encodeURIComponent(tenantId)}/plugins`, {
            credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }
        return data.plugins || [];
    }

    /**
     * @param {Array<{ id: string, version: string, enabled: boolean, source: string }>} plugins
     */
    function renderTable(plugins) {
        if (!tbody) return;
        tbody.replaceChildren();
        if (!plugins.length) {
            tbody.innerHTML = '<tr><td colspan="5">プラグインがありません</td></tr>';
            return;
        }
        for (const p of plugins) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code>${escapeHtml(p.id)}</code><br><span class="hint">${escapeHtml(p.version || '')}</span></td>
                <td>${escapeHtml(p.source || '')}</td>
                <td>${p.enabled ? '有効' : '無効'}</td>
                <td>
                    <button type="button" class="btn btn-secondary btn-sm tenant-plugin-enable-btn" data-id="${escapeHtml(p.id)}" ${p.enabled ? 'disabled' : ''}>有効化</button>
                    <button type="button" class="btn btn-secondary btn-sm tenant-plugin-disable-btn" data-id="${escapeHtml(p.id)}" ${p.enabled ? '' : 'disabled'}>無効化</button>
                </td>
                <td>
                    <button type="button" class="btn btn-secondary btn-sm tenant-plugin-config-btn" data-id="${escapeHtml(p.id)}">設定</button>
                </td>
            `;
            tbody.appendChild(tr);
        }
    }

    async function refresh() {
        setStatus('読み込み中…');
        const plugins = await loadPlugins();
        renderTable(plugins);
        setStatus(`${plugins.length} 件`);
    }

    async function setEnabled(pluginId, enabled) {
        const action = enabled ? 'enable' : 'disable';
        const res = await adminFetch(
            `/admin/tenant/${encodeURIComponent(tenantId)}/plugins/${encodeURIComponent(pluginId)}/${action}`,
            { method: 'POST', credentials: 'include' }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }
    }

    async function reloadPlugins() {
        const res = await adminFetch(`/admin/tenant/${encodeURIComponent(tenantId)}/plugins/reload`, {
            method: 'POST',
            credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }
        return data.report || [];
    }

    async function loadConfig(pluginId) {
        const res = await adminFetch(
            `/admin/tenant/${encodeURIComponent(tenantId)}/plugins/${encodeURIComponent(pluginId)}/config`,
            { credentials: 'include' }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }
        return data.values || {};
    }

    async function saveConfig(pluginId, updates) {
        const res = await adminFetch(
            `/admin/tenant/${encodeURIComponent(tenantId)}/plugins/${encodeURIComponent(pluginId)}/config`,
            {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates }),
            }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }
    }

    function showConfigForm(pluginId, values) {
        selectedPluginId = pluginId;
        if (configPanel) configPanel.hidden = false;
        if (configPluginIdEl) configPluginIdEl.textContent = pluginId;
        if (!configForm) return;
        configForm.replaceChildren();
        const keys = Object.keys(values);
        if (keys.length === 0) {
            keys.push('greeting');
            values.greeting = '';
        }
        for (const key of keys) {
            const label = document.createElement('label');
            label.className = 'admin-form-field';
            label.innerHTML = `<span>${escapeHtml(key)}</span>`;
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'prop-input full';
            input.dataset.configKey = key;
            input.value = String(values[key] ?? '');
            label.appendChild(input);
            configForm.appendChild(label);
        }
    }

    tbody?.addEventListener('click', async (ev) => {
        const t = ev.target;
        if (!(t instanceof HTMLElement)) return;
        const pluginId = t.dataset.id;
        if (!pluginId) return;
        try {
            if (t.classList.contains('tenant-plugin-enable-btn')) {
                await setEnabled(pluginId, true);
                setStatus(`${pluginId} を有効化しました。Reload を実行してください。`);
                await refresh();
            } else if (t.classList.contains('tenant-plugin-disable-btn')) {
                await setEnabled(pluginId, false);
                setStatus(`${pluginId} を無効化しました。`);
                await refresh();
            } else if (t.classList.contains('tenant-plugin-config-btn')) {
                const values = await loadConfig(pluginId);
                showConfigForm(pluginId, values);
            }
        } catch (e) {
            alert(e instanceof Error ? e.message : '操作に失敗しました');
        }
    });

    reloadBtn?.addEventListener('click', async () => {
        try {
            setStatus('Reload 中…');
            const report = await reloadPlugins();
            const loaded = report.filter((r) => r.loaded).length;
            await refresh();
            setStatus(`Reload 完了 (${loaded} loaded)`);
        } catch (e) {
            alert(e instanceof Error ? e.message : 'Reload に失敗しました');
        }
    });

    configSaveBtn?.addEventListener('click', async () => {
        if (!selectedPluginId || !configForm) return;
        /** @type {Record<string, string>} */
        const updates = {};
        configForm.querySelectorAll('input[data-config-key]').forEach((input) => {
            if (!(input instanceof HTMLInputElement)) return;
            updates[input.dataset.configKey || ''] = input.value;
        });
        try {
            await saveConfig(selectedPluginId, updates);
            setStatus('設定を保存しました。Reload を実行してください。');
        } catch (e) {
            alert(e instanceof Error ? e.message : '保存に失敗しました');
        }
    });

    return refresh();
}

/**
 * 概要 / プラグイン パネル切替
 */
export function wireTenantAdminPanelNav() {
    const navItems = document.querySelectorAll('[data-tenant-panel]');
    const panels = document.querySelectorAll('[data-tenant-panel-id]');
    navItems.forEach((btn) => {
        btn.addEventListener('click', () => {
            const panelId = btn.getAttribute('data-tenant-panel');
            if (!panelId) return;
            navItems.forEach((n) => n.classList.remove('active'));
            btn.classList.add('active');
            panels.forEach((p) => {
                const id = p.getAttribute('data-tenant-panel-id');
                p.classList.toggle('active', id === panelId);
            });
        });
    });
    const overviewBtn = document.querySelector('[data-tenant-panel="overview"]');
    if (overviewBtn instanceof HTMLElement) {
        overviewBtn.classList.add('active');
    }
}
