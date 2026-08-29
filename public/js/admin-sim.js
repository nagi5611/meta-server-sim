// public/js/admin-sim.js — プラットフォーム管理ランディング（Tenant 一覧）
import { adminFetch } from './admin-api-fetch.js';
import { bootstrapAdminApi } from './admin-api-fetch-init.js';
import { wirePlatformOpsButtons } from './admin-platform-ops.js';

const UPDATE_INTERVAL = 2000;

/** tenant ID パターン（サーバーと同等） */
const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * 最終更新時刻を表示する
 */
function updateLastUpdateTime() {
    const el = document.getElementById('last-update');
    if (el) {
        el.textContent = new Date().toLocaleTimeString('ja-JP');
    }
}

/**
 * ダークモード切替
 */
function initThemeToggle() {
    const btn = document.getElementById('admin-theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
        document.body.classList.toggle('admin-dark');
        const icon = document.getElementById('admin-theme-icon');
        if (icon) {
            icon.className = document.body.classList.contains('admin-dark')
                ? 'bi bi-sun-fill'
                : 'bi bi-moon-fill';
        }
    });
}

/**
 * /admin/stats を読み込む
 */
async function loadStats() {
    try {
        const res = await adminFetch('/admin/stats', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const set = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        set('total-players', String(data.totalPlayers ?? 0));
        set('total-rooms', String(data.totalRooms ?? 0));
        set('tenant-count', String(data.tenantCount ?? 0));

        set(
            'cpu-usage',
            data.cpuUsagePercent != null ? `${Number(data.cpuUsagePercent).toFixed(1)}%` : '-'
        );
        set(
            'ram-usage',
            data.ramUsagePercent != null ? `${Number(data.ramUsagePercent).toFixed(1)}%` : '-'
        );

        updateLastUpdateTime();
    } catch (e) {
        console.error('loadStats failed:', e);
    }
}

/**
 * Tenant 管理パネル URL を生成する
 * @param {string} tenantId
 */
function tenantAdminUrl(tenantId) {
    return `/admin/tenant/${encodeURIComponent(tenantId)}`;
}

/**
 * Tenant をアーカイブする
 * @param {string} tenantId
 * @param {boolean} force
 */
async function archiveTenantById(tenantId, force = false) {
    const res = await adminFetch(`/admin/tenants/${encodeURIComponent(tenantId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.message || `HTTP ${res.status}`);
        err.code = data.error;
        err.players = data.players;
        throw err;
    }
    return data;
}

/**
 * Tenant 削除（アーカイブ）の確認と実行
 * @param {string} tenantId
 * @param {string} displayName
 */
async function handleDeleteTenant(tenantId, displayName) {
    const label = displayName || tenantId;
    if (!confirm(`「${label}」をアーカイブしますか？\nデータは tenants/_archive へ移動されます。`)) {
        return;
    }

    try {
        await archiveTenantById(tenantId, false);
        await loadTenants();
        await loadStats();
    } catch (e) {
        if (e.code === 'players_connected') {
            const players = e.players ?? '?';
            if (
                confirm(
                    `${players} 人が接続中です。強制アーカイブすると接続が切断されます。続行しますか？`
                )
            ) {
                try {
                    await archiveTenantById(tenantId, true);
                    await loadTenants();
                    await loadStats();
                } catch (e2) {
                    alert(e2.message || 'アーカイブに失敗しました');
                }
            }
        } else {
            alert(e.message || 'アーカイブに失敗しました');
        }
    }
}

/**
 * /admin/tenants をテーブルに描画
 */
async function loadTenants() {
    const tbody = document.getElementById('tenants-table-body');
    if (!tbody) return;
    try {
        const res = await adminFetch('/admin/tenants', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const tenants = Array.isArray(data.tenants) ? data.tenants : [];
        tbody.replaceChildren();
        for (const t of tenants) {
            const tr = document.createElement('tr');
            tr.className = 'tenant-row';
            tr.tabIndex = 0;
            tr.setAttribute('role', 'link');
            tr.setAttribute('aria-label', `${t.displayName || t.id} の管理パネルを開く`);

            const adminUrl = tenantAdminUrl(t.id);
            const metaverseUrl = t.url || `/${t.id}/`;

            tr.innerHTML = `
                <td><code>${escapeHtml(t.id)}</code></td>
                <td>${escapeHtml(t.displayName || t.id)}</td>
                <td>${t.players ?? 0}</td>
                <td>${t.rooms ?? 0}</td>
                <td>${t.worldCount ?? 0}</td>
                <td class="tenant-actions">
                    <a class="btn btn-secondary btn-sm" href="${adminUrl}">管理</a>
                    <a class="btn btn-secondary btn-sm" href="${metaverseUrl}" target="_blank" rel="noopener">開く</a>
                    <button type="button" class="btn btn-danger btn-sm tenant-delete-btn" data-tenant-id="${escapeHtml(t.id)}" data-tenant-name="${escapeHtml(t.displayName || t.id)}">削除</button>
                </td>
            `;

            const navigate = () => {
                window.location.href = adminUrl;
            };
            tr.addEventListener('click', (e) => {
                if (e.target instanceof Element && e.target.closest('a, button')) return;
                navigate();
            });
            tr.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    if (e.target instanceof Element && e.target.closest('button')) return;
                    e.preventDefault();
                    navigate();
                }
            });

            const deleteBtn = tr.querySelector('.tenant-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleDeleteTenant(t.id, t.displayName || t.id);
                });
            }

            tbody.appendChild(tr);
        }
    } catch (e) {
        console.error('loadTenants failed:', e);
        tbody.replaceChildren();
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="6">読み込み失敗</td>';
        tbody.appendChild(tr);
    }
}

/**
 * Tenant 追加モーダル
 */
function initTenantAddModal() {
    const modal = document.getElementById('tenant-add-modal');
    const form = document.getElementById('tenant-add-form');
    const openBtn = document.getElementById('tenant-add-btn');
    const openBtnHeader = document.getElementById('tenant-add-btn-header');
    const errorEl = document.getElementById('tenant-add-error');
    const idInput = document.getElementById('tenant-add-id');
    const nameInput = document.getElementById('tenant-add-display-name');
    const networkSection = document.getElementById('tenant-add-network-section');
    const submitBtn = document.getElementById('tenant-add-submit');

    if (!modal || !form || !openBtn) return;

    const openModal = () => {
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        if (errorEl) {
            errorEl.hidden = true;
            errorEl.textContent = '';
        }
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';
        if (networkSection) {
            networkSection.hidden = true;
            delete networkSection.dataset.initialized;
        }
        const portConflictEl = document.getElementById('tenant-add-port-conflict');
        if (portConflictEl) {
            portConflictEl.hidden = true;
            portConflictEl.textContent = '';
        }
        if (idInput) idInput.focus();
    };

    const closeModal = () => {
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
    };

    openBtn.addEventListener('click', openModal);
    if (openBtnHeader) openBtnHeader.addEventListener('click', openModal);

    for (const el of modal.querySelectorAll('[data-modal-close]')) {
        el.addEventListener('click', closeModal);
    }

    if (idInput) {
        idInput.addEventListener('input', () => syncTenantAddNetworkPreview());
    }
    if (nameInput) {
        nameInput.addEventListener('input', () => syncTenantAddNetworkPreview());
    }

    const serverFieldIds = [
        'tenant-add-server-host',
        'tenant-add-server-port',
        'tenant-add-server-secure',
        'tenant-add-server-path',
    ];
    for (const fieldId of serverFieldIds) {
        const el = document.getElementById(fieldId);
        if (!el) continue;
        el.addEventListener('input', () => {
            syncTenantAddUrlsFromServerFields();
            updateTenantAddPortConflictWarning();
        });
        el.addEventListener('change', () => {
            syncTenantAddUrlsFromServerFields();
            updateTenantAddPortConflictWarning();
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = String(idInput?.value ?? '').trim();
        const displayName = String(nameInput?.value ?? '').trim();
        if (!id) return;

        if (!TENANT_ID_PATTERN.test(id)) {
            if (errorEl) {
                errorEl.textContent =
                    'Tenant ID は英数字で始まり、英数字とハイフンのみ使用できます';
                errorEl.hidden = false;
            }
            return;
        }

        if (submitBtn) submitBtn.disabled = true;
        if (errorEl) {
            errorEl.hidden = true;
            errorEl.textContent = '';
        }

        try {
            const networkEntries = readTenantAddNetworkFromForm(id);
            const res = await adminFetch('/admin/tenants', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id,
                    displayName: displayName || undefined,
                    network: networkEntries,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const msg = data.message || `作成に失敗しました (${res.status})`;
                if (errorEl) {
                    errorEl.textContent = msg;
                    errorEl.hidden = false;
                }
                return;
            }

            applyTenantNetworkToDraft(id, networkEntries);
            renderNetworkConfigDraft();

            closeModal();
            await loadTenants();
            await loadStats();

            const createdId = data.tenant?.id || id;
            const saveHint =
                'ネットワーク設定は下の「ネットワーク / 系列リンク」に反映済みです。「保存」ボタンで network-config.json に書き込んでください。';
            if (confirm(`Tenant「${createdId}」を追加しました。\n${saveHint}\n\n管理パネルを開きますか？`)) {
                window.location.href = tenantAdminUrl(createdId);
            }
        } catch (err) {
            if (errorEl) {
                errorEl.textContent = err instanceof Error ? err.message : '作成に失敗しました';
                errorEl.hidden = false;
            }
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
}

/**
 * HTML エスケープ
 * @param {string} s
 */
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * サーバー行から公開 URL を組み立てる
 * @param {{ host?: string, port?: number, secure?: boolean, path?: string }} s
 */
function buildServerUrl(s) {
    const host = String(s.host || '').trim().toLowerCase();
    const port = parseInt(String(s.port ?? ''), 10);
    const secure = !!s.secure;
    if (!host || !Number.isFinite(port)) return '';
    const scheme = secure ? 'https' : 'http';
    const defaultPort = secure ? 443 : 80;
    const portPart = port !== defaultPort ? `:${port}` : '';
    const path = String(s.path || '').trim();
    const pathPart = path && path !== '/' ? (path.startsWith('/') ? path : `/${path}`) : '';
    return `${scheme}://${host}${portPart}${pathPart}`;
}

/**
 * 系列サーバー一覧の host:port 競合を検出する
 * @param {{ label?: string, host?: string, port?: number, bindService?: boolean }[]} servers
 * @returns {string[]}
 */
function detectServerPortConflicts(servers) {
    const messages = /** @type {string[]} */ ([]);
    const hostPortGroups = new Map();

    for (const s of servers) {
        const host = String(s.host || '').trim().toLowerCase();
        const port = parseInt(String(s.port ?? ''), 10);
        if (!host || !Number.isFinite(port)) continue;
        const key = `${host}:${port}`;
        if (!hostPortGroups.has(key)) hostPortGroups.set(key, []);
        hostPortGroups.get(key).push(String(s.label || host));
    }

    for (const [key, labels] of hostPortGroups) {
        if (labels.length > 1) {
            messages.push(`${key} が複数の系列サーバーで重複しています（${labels.join('、')}）`);
        }
    }

    const bindByHost = new Map();
    for (const s of servers) {
        if (!s.bindService) continue;
        const host = String(s.host || '').trim().toLowerCase();
        const port = parseInt(String(s.port ?? ''), 10);
        if (!host || !Number.isFinite(port)) continue;
        const prev = bindByHost.get(host);
        if (prev != null && prev !== port) {
            messages.push(
                `bindService の ${host} でポートが競合しています（${prev} と ${port}）`
            );
        }
        bindByHost.set(host, port);
    }

    return messages;
}

/**
 * モーダル内の host/port が既存系列サーバーと重なるか
 * @param {string} host
 * @param {number} port
 * @returns {string[]}
 */
function getTenantAddPortConflictMessages(host, port) {
    if (!networkConfigDraft) return [];
    const h = String(host || '').trim().toLowerCase();
    const p = parseInt(String(port ?? ''), 10);
    if (!h || !Number.isFinite(p)) return [];

    const matches = networkConfigDraft.servers.filter((s) => s.host === h && s.port === p);
    if (matches.length === 0) return [];

    const labels = matches.map((s) => s.label || s.host).join('、');
    return [`${h}:${p} は既に系列サーバーで使用中です（${labels}）`];
}

/**
 * 公開 URL 用の系列サーバーテンプレートを返す
 */
function getPublicServerTemplate() {
    if (!networkConfigDraft || networkConfigDraft.servers.length === 0) {
        return { host: 'localhost', port: 3003, secure: true, path: '' };
    }
    const domain = networkConfigDraft.proxyServiceDomain;
    const servers = networkConfigDraft.servers;
    const pick =
        servers.find((x) => /vite|公開/i.test(x.label) && !x.bindService) ||
        servers.find((x) => !x.bindService && x.secure && x.port === 3003) ||
        servers.find((x) => x.host === domain && !x.bindService) ||
        servers.find((x) => !x.bindService) ||
        servers[servers.length - 1];
    return {
        host: pick.host,
        port: pick.port,
        secure: pick.secure,
        path: pick.path || '',
    };
}

/**
 * Tenant 追加モーダル用のネットワーク設定例を組み立てる
 * @param {string} id
 * @param {string} displayName
 */
function buildTenantNetworkDefaults(id, displayName) {
    const label = String(displayName || id).trim() || id;
    const template = getPublicServerTemplate();
    const path = `/${id}/`;
    const server = {
        label,
        host: template.host,
        port: template.port,
        secure: template.secure,
        path,
        bindService: false,
    };
    let tenantUrl = buildServerUrl(server);
    if (tenantUrl && !tenantUrl.endsWith('/')) tenantUrl += '/';
    return {
        tenantAccessUrl: { tenantId: id, url: tenantUrl },
        portalLink: { label, url: tenantUrl },
        server,
    };
}

/**
 * モーダルの系列サーバー欄から Tenant 公開 URL / ナビ URL を同期する
 */
function syncTenantAddUrlsFromServerFields() {
    const hostEl = document.getElementById('tenant-add-server-host');
    const portEl = document.getElementById('tenant-add-server-port');
    const secureEl = document.getElementById('tenant-add-server-secure');
    const pathEl = document.getElementById('tenant-add-server-path');
    const accessUrlEl = document.getElementById('tenant-add-access-url');
    const portalUrlEl = document.getElementById('tenant-add-portal-url');

    const host = String(hostEl?.value ?? '').trim().toLowerCase();
    const port = parseInt(String(portEl?.value ?? ''), 10);
    const path = String(pathEl?.value ?? '').trim();
    if (!host || !Number.isFinite(port)) return;

    let url = buildServerUrl({
        host,
        port,
        secure: secureEl?.checked ?? false,
        path,
    });
    if (url && !url.endsWith('/')) url += '/';

    if (accessUrlEl) accessUrlEl.value = url;
    if (portalUrlEl) portalUrlEl.value = url;
}

/**
 * モーダル内のポート競合警告を更新する
 */
function updateTenantAddPortConflictWarning() {
    const el = document.getElementById('tenant-add-port-conflict');
    const hostEl = document.getElementById('tenant-add-server-host');
    const portEl = document.getElementById('tenant-add-server-port');
    if (!el) return;

    const host = String(hostEl?.value ?? '').trim().toLowerCase();
    const port = parseInt(String(portEl?.value ?? ''), 10);
    const messages = getTenantAddPortConflictMessages(host, port);

    if (messages.length === 0) {
        el.hidden = true;
        el.textContent = '';
        return;
    }

    el.hidden = false;
    el.textContent = messages.join(' ');
}

/**
 * 系列サーバー表のポート競合警告を描画する
 */
function renderNetworkServersPortWarnings() {
    const el = document.getElementById('network-servers-port-warnings');
    if (!el || !networkConfigDraft) return;

    const messages = detectServerPortConflicts(networkConfigDraft.servers);
    if (messages.length === 0) {
        el.hidden = true;
        el.replaceChildren();
        return;
    }

    el.hidden = false;
    el.replaceChildren();
    for (const msg of messages) {
        const p = document.createElement('p');
        p.className = 'network-port-warning-line';
        p.textContent = msg;
        el.appendChild(p);
    }
}

/**
 * Tenant ID 入力に応じてモーダル内のネットワーク例を更新する
 */
function syncTenantAddNetworkPreview() {
    const section = document.getElementById('tenant-add-network-section');
    const idInput = document.getElementById('tenant-add-id');
    const nameInput = document.getElementById('tenant-add-display-name');
    if (!section || !idInput) return;

    const id = String(idInput.value ?? '').trim();
    if (!TENANT_ID_PATTERN.test(id)) {
        section.hidden = true;
        return;
    }

    section.hidden = false;
    const displayName = String(nameInput?.value ?? '').trim();
    const defaults = buildTenantNetworkDefaults(id, displayName);

    const accessUrl = document.getElementById('tenant-add-access-url');
    const portalLabel = document.getElementById('tenant-add-portal-label');
    const portalUrl = document.getElementById('tenant-add-portal-url');
    const serverLabel = document.getElementById('tenant-add-server-label');
    const serverHost = document.getElementById('tenant-add-server-host');
    const serverPort = document.getElementById('tenant-add-server-port');
    const serverSecure = document.getElementById('tenant-add-server-secure');
    const serverPath = document.getElementById('tenant-add-server-path');

    if (!section.dataset.initialized) {
        if (accessUrl) accessUrl.value = defaults.tenantAccessUrl.url;
        if (portalLabel) portalLabel.value = defaults.portalLink.label;
        if (portalUrl) portalUrl.value = defaults.portalLink.url;
        if (serverLabel) serverLabel.value = defaults.server.label;
        if (serverHost) serverHost.value = defaults.server.host;
        if (serverPort) serverPort.value = String(defaults.server.port);
        if (serverSecure) serverSecure.checked = defaults.server.secure;
        if (serverPath) serverPath.value = defaults.server.path;
        section.dataset.initialized = '1';
    } else {
        if (serverLabel) serverLabel.value = displayName || id;
        if (portalLabel) portalLabel.value = displayName || id;
        if (serverPath) serverPath.value = `/${id}/`;
    }

    syncTenantAddUrlsFromServerFields();
    updateTenantAddPortConflictWarning();
}

/**
 * モーダルからネットワーク設定を読み取る
 * @param {string} id
 */
function readTenantAddNetworkFromForm(id) {
    const portalLabel = document.getElementById('tenant-add-portal-label');
    const serverLabel = document.getElementById('tenant-add-server-label');
    const serverHost = document.getElementById('tenant-add-server-host');
    const serverPort = document.getElementById('tenant-add-server-port');
    const serverSecure = document.getElementById('tenant-add-server-secure');
    const serverPath = document.getElementById('tenant-add-server-path');

    const fallback = buildTenantNetworkDefaults(id, '');
    const port = parseInt(String(serverPort?.value ?? ''), 10);
    const path = String(serverPath?.value ?? '').trim() || fallback.server.path;

    const server = {
        label: String(serverLabel?.value ?? '').trim() || id,
        host: String(serverHost?.value ?? '').trim().toLowerCase() || fallback.server.host,
        port: Number.isFinite(port) ? port : fallback.server.port,
        secure: serverSecure?.checked ?? false,
        path,
        bindService: false,
    };

    let builtUrl = buildServerUrl(server);
    if (builtUrl && !builtUrl.endsWith('/')) builtUrl += '/';

    return {
        tenantAccessUrl: { tenantId: id, url: builtUrl },
        portalLink: {
            label: String(portalLabel?.value ?? '').trim() || id,
            url: builtUrl,
        },
        server,
    };
}

/**
 * ネットワーク設定ドラフトへ Tenant 行を追加する
 * @param {string} id
 * @param {{
 *   tenantAccessUrl: { tenantId: string, url: string },
 *   portalLink: { label: string, url: string },
 *   server: { label: string, host: string, port: number, secure?: boolean, path?: string, bindService?: boolean },
 * }} entries
 */
function applyTenantNetworkToDraft(id, entries) {
    if (!networkConfigDraft) {
        networkConfigDraft = {
            portalLinks: [],
            servers: [],
            tenantAccessUrls: [],
            proxyServiceDomain: '',
            useReverseProxy: false,
            trustProxy: false,
            requireSecureHttp: false,
        };
    }

    const { tenantAccessUrl, portalLink, server } = entries;

    const existingUrlIdx = networkConfigDraft.tenantAccessUrls.findIndex((u) => u.tenantId === id);
    if (existingUrlIdx >= 0) {
        networkConfigDraft.tenantAccessUrls[existingUrlIdx] = tenantAccessUrl;
    } else {
        networkConfigDraft.tenantAccessUrls.push(tenantAccessUrl);
    }

    const portalUrlNorm = portalLink.url.trim();
    if (!networkConfigDraft.portalLinks.some((l) => l.url === portalUrlNorm)) {
        networkConfigDraft.portalLinks.push(portalLink);
    }

    const serverPathNorm = String(server.path || '').trim();
    const serverDup = networkConfigDraft.servers.some(
        (s) =>
            s.host === server.host &&
            s.port === server.port &&
            String(s.path || '').trim() === serverPathNorm &&
            s.label === server.label
    );
    if (!serverDup) {
        networkConfigDraft.servers.push({
            label: server.label,
            host: server.host,
            port: server.port,
            secure: server.secure,
            path: server.path || undefined,
            bindService: false,
        });
    }
}

/** @type {{
 *   portalLinks: { label: string, url: string }[],
 *   servers: { label: string, host: string, port: number, secure?: boolean, path?: string }[],
 *   tenantAccessUrls: { tenantId: string, url: string }[],
 *   proxyServiceDomain: string,
 *   useReverseProxy: boolean,
 *   trustProxy: boolean,
 *   requireSecureHttp: boolean,
 * } | null} */
let networkConfigDraft = null;

function initNetworkConfigPanel() {
    const saveBtn = document.getElementById('network-config-save-btn');
    if (!saveBtn) return;

    document.getElementById('network-server-add-btn')?.addEventListener('click', () => {
        networkConfigDraft?.servers.push({
            label: '新規サーバー',
            host: 'localhost',
            port: 3002,
            secure: false,
            path: '',
            bindService: false,
        });
        renderNetworkConfigDraft();
    });

    document.getElementById('network-portal-add-btn')?.addEventListener('click', () => {
        networkConfigDraft?.portalLinks.push({ label: 'リンク', url: 'http://localhost:3000' });
        renderNetworkConfigDraft();
    });

    document.getElementById('network-tenant-url-add-btn')?.addEventListener('click', () => {
        networkConfigDraft?.tenantAccessUrls.push({ tenantId: 'P-01', url: 'http://localhost:3003/P-01/' });
        renderNetworkConfigDraft();
    });

    document.getElementById('network-tenant-url-autofill-btn')?.addEventListener('click', () => {
        void autofillTenantUrls();
    });

    saveBtn.addEventListener('click', () => {
        void saveNetworkConfig();
    });

    void loadNetworkConfig();
}

async function loadNetworkConfig() {
    const statusEl = document.getElementById('network-config-status');
    const warningsEl = document.getElementById('network-config-warnings');
    try {
        const res = await adminFetch('/admin/network-config', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        networkConfigDraft = {
            portalLinks: Array.isArray(data.portalLinks) ? data.portalLinks : [],
            servers: Array.isArray(data.servers)
                ? data.servers.map((s) => ({
                      label: s.label || '',
                      host: s.host || '',
                      port: s.port ?? 3002,
                      secure: !!s.secure,
                      path: s.path || '',
                      bindService: !!s.bindService,
                  }))
                : [],
            tenantAccessUrls: Array.isArray(data.tenantAccessUrls) ? data.tenantAccessUrls : [],
            proxyServiceDomain: data.proxyServiceDomain || '',
            useReverseProxy: !!data.useReverseProxy,
            trustProxy: !!data.trustProxy,
            requireSecureHttp: !!data.requireSecureHttp,
        };

        if (statusEl) {
            const parts = [
                data.configExists ? '保存済み設定を使用中' : '.env / デフォルトを使用中',
                data.effectivePort != null ? `起動ポート: ${data.effectivePort}` : '',
            ].filter(Boolean);
            statusEl.textContent = parts.join(' · ');
        }

        if (warningsEl) {
            const warnings = Array.isArray(data.bootWarnings) ? data.bootWarnings : [];
            if (warnings.length > 0) {
                warningsEl.hidden = false;
                warningsEl.innerHTML = `<strong>起動時の警告</strong><ul>${warnings
                    .map((w) => `<li>${escapeHtml(w)}</li>`)
                    .join('')}</ul>`;
            } else {
                warningsEl.hidden = true;
                warningsEl.replaceChildren();
            }
        }

        renderNetworkConfigDraft();
    } catch (e) {
        if (statusEl) statusEl.textContent = 'ネットワーク設定の読み込みに失敗しました';
        console.error('loadNetworkConfig failed:', e);
    }
}

async function autofillTenantUrls() {
    if (!networkConfigDraft) return;
    try {
        const res = await adminFetch('/admin/tenants', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const tenants = Array.isArray(data.tenants) ? data.tenants : [];
        const template = getPublicServerTemplate();
        const base = buildServerUrl(template).replace(/\/$/, '');

        for (const t of tenants) {
            const exists = networkConfigDraft.tenantAccessUrls.some((u) => u.tenantId === t.id);
            if (exists) continue;
            const url = base ? `${base}/${t.id}/` : `/${t.id}/`;
            networkConfigDraft.tenantAccessUrls.push({ tenantId: t.id, url });
        }
        renderNetworkConfigDraft();
    } catch (e) {
        alert(e instanceof Error ? e.message : 'Tenant 一覧の取得に失敗しました');
    }
}

function refreshProxyDomainSelect() {
    const select = document.getElementById('network-proxy-service-domain');
    if (!select || !networkConfigDraft) return;
    const current = networkConfigDraft.proxyServiceDomain || '';
    select.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '— 未選択 —';
    select.appendChild(empty);
    for (const s of networkConfigDraft.servers) {
        const opt = document.createElement('option');
        opt.value = s.host;
        opt.textContent = `${s.label} (${s.host})`;
        select.appendChild(opt);
    }
    select.value = current;
}

function renderNetworkConfigDraft() {
    if (!networkConfigDraft) return;

    const serversBody = document.getElementById('network-servers-body');
    const portalBody = document.getElementById('network-portal-links-body');
    const tenantBody = document.getElementById('network-tenant-urls-body');

    if (serversBody) {
        serversBody.replaceChildren();
        for (let i = 0; i < networkConfigDraft.servers.length; i++) {
            const s = networkConfigDraft.servers[i];
            const tr = document.createElement('tr');
            const preview = buildServerUrl(s);
            tr.innerHTML = `
                <td><input type="text" data-server-field="label" data-server-index="${i}" value="${escapeHtml(s.label)}"></td>
                <td><input type="text" data-server-field="host" data-server-index="${i}" value="${escapeHtml(s.host)}"></td>
                <td><input type="number" min="1" max="65535" data-server-field="port" data-server-index="${i}" value="${s.port}"></td>
                <td><input type="checkbox" data-server-field="secure" data-server-index="${i}" ${s.secure ? 'checked' : ''}></td>
                <td><input type="text" data-server-field="path" data-server-index="${i}" value="${escapeHtml(s.path || '')}" placeholder="/"></td>
                <td class="link-preview">${escapeHtml(preview)}</td>
                <td><button type="button" class="btn btn-danger btn-sm" data-server-remove="${i}">削除</button></td>
            `;
            serversBody.appendChild(tr);
        }
        for (const input of serversBody.querySelectorAll('input')) {
            input.addEventListener('change', handleServerFieldChange);
            input.addEventListener('input', handleServerFieldChange);
        }
        for (const btn of serversBody.querySelectorAll('[data-server-remove]')) {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-server-remove') || '', 10);
                networkConfigDraft?.servers.splice(idx, 1);
                renderNetworkConfigDraft();
            });
        }
        renderNetworkServersPortWarnings();
    }

    if (portalBody) {
        portalBody.replaceChildren();
        for (let i = 0; i < networkConfigDraft.portalLinks.length; i++) {
            const link = networkConfigDraft.portalLinks[i];
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="text" data-portal-field="label" data-portal-index="${i}" value="${escapeHtml(link.label)}"></td>
                <td><input type="url" data-portal-field="url" data-portal-index="${i}" value="${escapeHtml(link.url)}"></td>
                <td><button type="button" class="btn btn-danger btn-sm" data-portal-remove="${i}">削除</button></td>
            `;
            portalBody.appendChild(tr);
        }
        for (const input of portalBody.querySelectorAll('input')) {
            input.addEventListener('change', handlePortalFieldChange);
            input.addEventListener('input', handlePortalFieldChange);
        }
        for (const btn of portalBody.querySelectorAll('[data-portal-remove]')) {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-portal-remove') || '', 10);
                networkConfigDraft?.portalLinks.splice(idx, 1);
                renderNetworkConfigDraft();
            });
        }
    }

    if (tenantBody) {
        tenantBody.replaceChildren();
        for (let i = 0; i < networkConfigDraft.tenantAccessUrls.length; i++) {
            const row = networkConfigDraft.tenantAccessUrls[i];
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="text" data-tenant-field="tenantId" data-tenant-index="${i}" value="${escapeHtml(row.tenantId)}"></td>
                <td><input type="url" data-tenant-field="url" data-tenant-index="${i}" value="${escapeHtml(row.url)}"></td>
                <td><button type="button" class="btn btn-danger btn-sm" data-tenant-remove="${i}">削除</button></td>
            `;
            tenantBody.appendChild(tr);
        }
        for (const input of tenantBody.querySelectorAll('input')) {
            input.addEventListener('change', handleTenantUrlFieldChange);
            input.addEventListener('input', handleTenantUrlFieldChange);
        }
        for (const btn of tenantBody.querySelectorAll('[data-tenant-remove]')) {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-tenant-remove') || '', 10);
                networkConfigDraft?.tenantAccessUrls.splice(idx, 1);
                renderNetworkConfigDraft();
            });
        }
    }

    const useRp = document.getElementById('network-use-reverse-proxy');
    const trust = document.getElementById('network-trust-proxy');
    const secure = document.getElementById('network-require-secure-http');
    if (useRp) useRp.checked = networkConfigDraft.useReverseProxy;
    if (trust) trust.checked = networkConfigDraft.trustProxy;
    if (secure) secure.checked = networkConfigDraft.requireSecureHttp;

    if (useRp) {
        useRp.onchange = () => {
            if (networkConfigDraft) networkConfigDraft.useReverseProxy = useRp.checked;
        };
    }
    if (trust) {
        trust.onchange = () => {
            if (networkConfigDraft) networkConfigDraft.trustProxy = trust.checked;
        };
    }
    if (secure) {
        secure.onchange = () => {
            if (networkConfigDraft) networkConfigDraft.requireSecureHttp = secure.checked;
        };
    }

    refreshProxyDomainSelect();
    const domainSelect = document.getElementById('network-proxy-service-domain');
    if (domainSelect) {
        domainSelect.onchange = () => {
            if (networkConfigDraft) {
                networkConfigDraft.proxyServiceDomain = domainSelect.value;
            }
        };
    }
}

function handleServerFieldChange(e) {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || !networkConfigDraft) return;
    const idx = parseInt(target.getAttribute('data-server-index') || '', 10);
    const field = target.getAttribute('data-server-field');
    if (!Number.isFinite(idx) || !field || !networkConfigDraft.servers[idx]) return;
    const row = networkConfigDraft.servers[idx];
    if (field === 'secure') row.secure = target.checked;
    else if (field === 'port') row.port = parseInt(target.value, 10) || 3002;
    else if (field === 'label') row.label = target.value;
    else if (field === 'host') row.host = target.value.trim().toLowerCase();
    else if (field === 'path') row.path = target.value;
    const previewCell = target.closest('tr')?.querySelector('.link-preview');
    if (previewCell) previewCell.textContent = buildServerUrl(row);
    if (field === 'host' || field === 'port') renderNetworkServersPortWarnings();
    if (field === 'host') refreshProxyDomainSelect();
}

function handlePortalFieldChange(e) {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || !networkConfigDraft) return;
    const idx = parseInt(target.getAttribute('data-portal-index') || '', 10);
    const field = target.getAttribute('data-portal-field');
    if (!Number.isFinite(idx) || !field || !networkConfigDraft.portalLinks[idx]) return;
    if (field === 'label') networkConfigDraft.portalLinks[idx].label = target.value;
    else if (field === 'url') networkConfigDraft.portalLinks[idx].url = target.value;
}

function handleTenantUrlFieldChange(e) {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || !networkConfigDraft) return;
    const idx = parseInt(target.getAttribute('data-tenant-index') || '', 10);
    const field = target.getAttribute('data-tenant-field');
    if (!Number.isFinite(idx) || !field || !networkConfigDraft.tenantAccessUrls[idx]) return;
    if (field === 'tenantId') networkConfigDraft.tenantAccessUrls[idx].tenantId = target.value.trim();
    else if (field === 'url') networkConfigDraft.tenantAccessUrls[idx].url = target.value.trim();
}

async function saveNetworkConfig() {
    const errorEl = document.getElementById('network-config-error');
    const saveBtn = document.getElementById('network-config-save-btn');
    if (!networkConfigDraft) return;

    if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
    }
    if (saveBtn) saveBtn.disabled = true;

    try {
        const res = await adminFetch('/admin/network-config', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(networkConfigDraft),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const errors = Array.isArray(data.errors) ? data.errors.join('\n') : data.message;
            throw new Error(errors || `HTTP ${res.status}`);
        }
        alert(data.message || '保存しました');
        await loadNetworkConfig();
    } catch (e) {
        const msg = e instanceof Error ? e.message : '保存に失敗しました';
        if (errorEl) {
            errorEl.textContent = msg;
            errorEl.hidden = false;
        } else {
            alert(msg);
        }
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function bootstrapAdminSim() {
    try {
        await bootstrapAdminApi();
    } catch (e) {
        console.error('admin bootstrap failed:', e);
        const tbody = document.getElementById('tenants-table-body');
        if (tbody) {
            tbody.replaceChildren();
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="6">認証または CSRF 初期化に失敗しました。ページを再読み込みし、正しいパスワードを入力してください。</td>`;
            tbody.appendChild(tr);
        }
        return;
    }

    initThemeToggle();
    initTenantAddModal();
    initNetworkConfigPanel();
    wirePlatformOpsButtons({
        onReloadSuccess: async () => {
            await loadNetworkConfig();
            await loadTenants();
            await loadStats();
        },
    });
    loadStats();
    loadTenants();
    setInterval(() => {
        loadStats();
        loadTenants();
    }, UPDATE_INTERVAL);
}

bootstrapAdminSim();
