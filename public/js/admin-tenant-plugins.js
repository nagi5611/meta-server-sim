// public/js/admin-tenant-plugins.js — Tenant アドオン管理（mt-addons デザイン）
import { adminFetch } from './admin-api-fetch.js';
import { mtEsc, mtIcon, mtToast } from './mt-console-ui.js';

const ADDON_CATS = [
    { id: 'platform', label: 'プラットフォーム', en: 'PLATFORM' },
    { id: 'tenant', label: 'テナント', en: 'TENANT' },
    { id: 'both', label: '共通', en: 'SHARED' },
];

/**
 * @typedef {object} TenantPluginRow
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} version
 * @property {string} scope
 * @property {string} category
 * @property {string[]} dependsOn
 * @property {string} source
 * @property {boolean} enabled
 */

/**
 * @param {string} tenantId
 */
export async function initTenantPluginsPanel(tenantId) {
    const panel = document.querySelector('[data-tenant-panel-id="plugins"]');
    if (!panel) return;

    let mount = document.getElementById('tenant-plugins-mount');
    if (!mount) {
        mount = document.createElement('div');
        mount.id = 'tenant-plugins-mount';
        mount.className = 'tenant-plugins-mount';
        const legacy = panel.querySelector('.stats-section');
        legacy?.remove();
        panel.appendChild(mount);
    }

    /** @type {TenantPluginRow[]} */
    let plugins = [];
    let serverOnline = true;
    let addonCat = 'all';
    let addonState = 'all';
    let addonQ = '';
    /** @type {string | null} */
    let addonOpen = null;
    /** @type {string | null} */
    let configPluginId = null;

    const pluginById = () => Object.fromEntries(plugins.map((p) => [p.id, p]));

    async function loadPlugins() {
        const res = await adminFetch(`/admin/tenant/${encodeURIComponent(tenantId)}/plugins`, {
            credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }
        serverOnline = data.serverOnline !== false;
        return /** @type {TenantPluginRow[]} */ (data.plugins || []);
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

    /**
     * @param {string} id
     */
    function nameOf(id) {
        const p = plugins.find((x) => x.id === id);
        return p?.name || id;
    }

    /**
     * @param {TenantPluginRow} plugin
     */
    function missingDeps(plugin) {
        const map = pluginById();
        return (plugin.dependsOn || []).filter((d) => !map[d]?.enabled);
    }

    /**
     * @param {TenantPluginRow[]} list
     */
    function dependentsOf(id, list) {
        return list.filter(
            (p) => p.enabled && Array.isArray(p.dependsOn) && p.dependsOn.includes(id)
        );
    }

    /**
     * @param {TenantPluginRow} plugin
     */
    function rowHtml(plugin) {
        const open = addonOpen === plugin.id;
        const depMissing = missingDeps(plugin);
        const locked = !plugin.enabled && depMissing.length > 0;
        const depBadge =
            locked && depMissing.length
                ? `<em class="ad-lk">${mtEsc(depMissing.map(nameOf).join('・'))} が必要</em>`
                : '';

        const det = open
            ? `<div class="ad-det">
        <div><div class="ad-k">バージョン</div><div class="ad-v mono">${mtEsc(plugin.version)}</div></div>
        <div><div class="ad-k">由来</div><div class="ad-v">${mtEsc(plugin.source)}</div></div>
        <div><div class="ad-k">スコープ</div><div class="ad-v">${mtEsc(plugin.scope)}</div></div>
        <div><div class="ad-k">依存</div>
          <div class="ad-v">${
              plugin.dependsOn?.length
                  ? plugin.dependsOn
                        .map((d) => {
                            const on = pluginById()[d]?.enabled;
                            return `<span class="ad-dep ${on ? 'ok' : 'ng'}">${mtEsc(nameOf(d))}</span>`;
                        })
                        .join('')
                  : `<span style="color:var(--faint)">なし（manifest に dependsOn が無い場合は未接続扱い）</span>`
          }</div></div>
        <div id="tenant-plugin-config-slot" data-config-for="${mtEsc(plugin.id)}"></div>
      </div>`
            : '';

        return `<div class="ad-row ${plugin.enabled ? 'is-on' : 'is-off'} ${open ? 'is-open' : ''}">
      <button type="button" class="ad-sw ${plugin.enabled ? 'on' : ''}" data-addon-toggle="${mtEsc(plugin.id)}" role="switch"
        aria-checked="${plugin.enabled ? 'true' : 'false'}" ${locked ? 'disabled aria-disabled="true"' : ''}
        title="${locked ? `${mtEsc(depMissing.map(nameOf).join('・'))} が必要です` : ''}">
        <i></i><small>${plugin.enabled ? '有効' : '無効'}</small>
      </button>
      <span class="ad-ic">${mtIcon('modules')}</span>
      <button type="button" class="ad-main" data-addon-exp="${mtEsc(plugin.id)}" aria-expanded="${open ? 'true' : 'false'}">
        <span class="nm">${mtEsc(plugin.name)}${depBadge}</span>
        <span class="ds">${mtEsc(plugin.description || plugin.id)}</span>
      </button>
      <span class="ad-meta"><span><code>${mtEsc(plugin.id)}</code></span></span>
      <button type="button" class="ad-more ${open ? 'on' : ''}" data-addon-exp="${mtEsc(plugin.id)}" aria-label="詳細">
        ${mtIcon('chev', 'chev')}
      </button>
      ${det}
    </div>`;
    }

    function render() {
        const q = addonQ.toLowerCase();
        const match = (p) => {
            if (addonCat !== 'all' && p.category !== addonCat) return false;
            if (addonState === 'on' && !p.enabled) return false;
            if (addonState === 'off' && p.enabled) return false;
            if (q && !(p.name + p.description + p.id + p.source).toLowerCase().includes(q)) return false;
            return true;
        };
        const shown = plugins.filter(match);

        const groups = ADDON_CATS.map((c) => {
            const list = shown.filter((p) => p.category === c.id);
            if (!list.length) return '';
            const onN = list.filter((p) => p.enabled).length;
            return `<section class="ad-cat">
        <div class="ad-cat-h">
          <b>${mtEsc(c.label)}</b><span class="en">${mtEsc(c.en)}</span>
          <span class="cnt"><b>${onN}</b> / ${list.length} 有効</span>
        </div>
        <div class="sheet">${list.map((p) => rowHtml(p)).join('')}</div>
      </section>`;
        })
            .filter(Boolean)
            .join('');

        const offlineNote = serverOnline
            ? ''
            : `<p class="hint" style="margin-bottom:12px">テナントの Socket ワーカーが未接続のため、有効化はブロックされます（API: serverOnline=false）。</p>`;

        mount.innerHTML = `
      ${offlineNote}
      <div class="ad-tools">
        <div class="seg">
          <button type="button" data-addon-cat="all" class="${addonCat === 'all' ? 'on' : ''}">すべて</button>
          ${ADDON_CATS.map(
              (c) =>
                  `<button type="button" data-addon-cat="${mtEsc(c.id)}" class="${addonCat === c.id ? 'on' : ''}">${mtEsc(c.label)}</button>`
          ).join('')}
        </div>
        <div class="seg" style="margin-left:8px">
          <button type="button" data-addon-state="all" class="${addonState === 'all' ? 'on' : ''}">全件</button>
          <button type="button" data-addon-state="on" class="${addonState === 'on' ? 'on' : ''}">有効</button>
          <button type="button" data-addon-state="off" class="${addonState === 'off' ? 'on' : ''}">無効</button>
        </div>
        <div class="search ad-search">${mtIcon('net')}
          <input class="inp" data-addon-q value="${mtEsc(addonQ)}" placeholder="アドオン名・IDで検索">
        </div>
        <button type="button" class="btn btn-warning btn-sm" id="tenant-plugins-reload-btn">Reload</button>
      </div>
      ${shown.length ? groups : `<div class="sheet"><div class="empty">条件に一致するアドオンはありません</div></div>`}
      <h2 class="visually-hidden" id="tenant-plugins-status" role="status">${plugins.length} 件</h2>
    `;

        wireMountEvents();
        if (configPluginId && addonOpen === configPluginId) {
            void renderConfigForm(configPluginId);
        }
    }

    async function renderConfigForm(pluginId) {
        const slot = mount.querySelector('#tenant-plugin-config-slot');
        if (!slot) return;
        slot.innerHTML = '<p class="hint">設定を読み込み中…</p>';
        try {
            const res = await adminFetch(
                `/admin/tenant/${encodeURIComponent(tenantId)}/plugins/${encodeURIComponent(pluginId)}/config`,
                { credentials: 'include' }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
            const values = data.values || {};
            const keys = Object.keys(values);
            if (!keys.length) {
                slot.innerHTML =
                    '<div><div class="ad-k">設定</div><div class="ad-v" style="color:var(--faint)">未接続（設定キーなし）</div></div>';
                return;
            }
            const fields = keys
                .map(
                    (key) =>
                        `<label class="admin-form-field"><span>${mtEsc(key)}</span>
              <input type="text" class="prop-input full" data-config-key="${mtEsc(key)}" value="${mtEsc(String(values[key] ?? ''))}"></label>`
                )
                .join('');
            slot.innerHTML = `<div><div class="ad-k">設定</div>
        <form id="tenant-plugin-config-form">${fields}</form>
        <button type="button" class="btn btn-primary btn-sm" id="tenant-plugin-config-save-btn">保存</button></div>`;
            slot.querySelector('#tenant-plugin-config-save-btn')?.addEventListener('click', async () => {
                const form = slot.querySelector('#tenant-plugin-config-form');
                if (!form) return;
                /** @type {Record<string, string>} */
                const updates = {};
                form.querySelectorAll('input[data-config-key]').forEach((input) => {
                    if (!(input instanceof HTMLInputElement)) return;
                    updates[input.dataset.configKey || ''] = input.value;
                });
                try {
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
                    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
                    mtToast('設定を保存しました。Reload を実行してください。');
                } catch (e) {
                    alert(e instanceof Error ? e.message : '保存に失敗しました');
                }
            });
        } catch {
            slot.innerHTML =
                '<div><div class="ad-k">設定</div><div class="ad-v" style="color:var(--faint)">未接続</div></div>';
        }
    }

    function wireMountEvents() {
        mount.querySelectorAll('[data-addon-cat]').forEach((btn) => {
            btn.addEventListener('click', () => {
                addonCat = btn.getAttribute('data-addon-cat') || 'all';
                render();
            });
        });
        mount.querySelectorAll('[data-addon-state]').forEach((btn) => {
            btn.addEventListener('click', () => {
                addonState = btn.getAttribute('data-addon-state') || 'all';
                render();
            });
        });
        const qInput = mount.querySelector('[data-addon-q]');
        qInput?.addEventListener('input', () => {
            if (!(qInput instanceof HTMLInputElement)) return;
            addonQ = qInput.value;
            render();
        });

        mount.querySelectorAll('[data-addon-exp]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-addon-exp');
                if (!id) return;
                addonOpen = addonOpen === id ? null : id;
                configPluginId = addonOpen;
                render();
            });
        });

        mount.querySelectorAll('[data-addon-toggle]').forEach((btn) => {
            btn.addEventListener('click', () => void toggleAddon(btn.getAttribute('data-addon-toggle')));
        });

        mount.querySelector('#tenant-plugins-reload-btn')?.addEventListener('click', async () => {
            try {
                mtToast('Reload 中…');
                await reloadPlugins();
                plugins = await loadPlugins();
                render();
                mtToast('Reload 完了');
            } catch (e) {
                alert(e instanceof Error ? e.message : 'Reload に失敗しました');
            }
        });
    }

    /**
     * @param {string | null} id
     */
    async function toggleAddon(id) {
        if (!id) return;
        const plugin = plugins.find((p) => p.id === id);
        if (!plugin) return;

        if (!plugin.enabled) {
            const missing = missingDeps(plugin);
            if (missing.length) {
                mtToast(`${missing.map(nameOf).join('・')} が無効のため有効にできません`);
                return;
            }
            if (!serverOnline) {
                mtToast('停止中のサーバーではアドオンを有効にできません');
                return;
            }
            try {
                await setEnabled(id, true);
                plugin.enabled = true;
                mtToast(`${plugin.name} を有効にしました`);
            } catch (e) {
                alert(e instanceof Error ? e.message : '有効化に失敗しました');
                return;
            }
        } else {
            try {
                await setEnabled(id, false);
                plugin.enabled = false;
                const dependents = dependentsOf(id, plugins);
                for (const child of dependents) {
                    await setEnabled(child.id, false);
                    child.enabled = false;
                }
                mtToast(
                    dependents.length
                        ? `${plugin.name} を無効化しました。依存する ${dependents.length} 件も停止しました`
                        : `${plugin.name} を無効にしました`
                );
            } catch (e) {
                alert(e instanceof Error ? e.message : '無効化に失敗しました');
                return;
            }
        }
        render();
    }

    try {
        plugins = await loadPlugins();
        render();
    } catch (e) {
        mount.innerHTML = `<div class="mt-disconnected">アドオン一覧の取得に失敗しました: ${mtEsc(e instanceof Error ? e.message : String(e))}</div>`;
        console.error(e);
    }
}