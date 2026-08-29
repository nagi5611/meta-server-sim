// public/js/admin-tenant.js — Tenant 別管理パネル
import { adminFetch } from './admin-api-fetch.js';
import { bootstrapAdminApi } from './admin-api-fetch-init.js';
import { wirePlatformOpsButtons } from './admin-platform-ops.js';

const UPDATE_INTERVAL = 2000;

/**
 * URL から tenant ID を解決する（/admin/tenant/P-01 または ?tenant=P-01）
 * @returns {string|null}
 */
function resolveTenantIdFromLocation() {
    const pathMatch = window.location.pathname.match(/\/admin\/tenant\/([^/]+)\/?$/);
    if (pathMatch?.[1]) {
        return decodeURIComponent(pathMatch[1]);
    }
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('tenant');
    return fromQuery ? String(fromQuery).trim() : null;
}

const tenantId = resolveTenantIdFromLocation();

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
 * サイドナビのパネル切替
 */
function initAdminPanels() {
    const buttons = document.querySelectorAll('.admin-nav-item[data-panel]');
    for (const btn of buttons) {
        btn.addEventListener('click', () => {
            const panelId = btn.getAttribute('data-panel');
            if (!panelId) return;
            for (const b of buttons) b.classList.remove('active');
            btn.classList.add('active');
            for (const panel of document.querySelectorAll('.admin-panel')) {
                panel.classList.toggle('active', panel.id === panelId);
            }
        });
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
 * ヘッダーに tenant 情報を反映する
 * @param {{ tenantId: string, displayName: string, url: string }} data
 */
function applyTenantHeader(data) {
    const idEl = document.getElementById('header-tenant-id');
    const nameEl = document.getElementById('header-tenant-name');
    const linkEl = document.getElementById('tenant-metaverse-link');
    if (idEl) idEl.textContent = data.tenantId;
    if (nameEl) nameEl.textContent = data.displayName || data.tenantId;
    if (linkEl) linkEl.href = data.url || `/${data.tenantId}/`;
    document.title = `${data.displayName || data.tenantId} — 管理パネル`;
}

/**
 * tenant 統計を読み込む
 */
async function loadTenantStats() {
    if (!tenantId) return;
    try {
        const res = await adminFetch(`/admin/tenants/${encodeURIComponent(tenantId)}/stats`, {
            credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

            applyTenantHeader(data);

        const worldEditNav = document.getElementById('tenant-world-edit-nav');
        if (worldEditNav) {
            worldEditNav.href = `/admin/tenant/${encodeURIComponent(data.tenantId)}/world-edit`;
        }

        const set = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        set('tenant-players', String(data.players ?? 0));
        set('tenant-rooms', String(data.rooms ?? 0));
        set('tenant-world-count', String(data.worldCount ?? 0));
        set('tenant-url', data.url || `/${tenantId}/`);

        updateLastUpdateTime();
    } catch (e) {
        console.error('loadTenantStats failed:', e);
    }
}

/**
 * worlds.json をテーブルに描画する
 */
async function loadTenantWorlds() {
    const tbody = document.getElementById('worlds-table-body');
    const statusEl = document.getElementById('worlds-status');
    if (!tbody || !tenantId) return;

    try {
        const res = await adminFetch(`/admin/tenants/${encodeURIComponent(tenantId)}/worlds`, {
            credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const worlds = await res.json();
        const entries = Object.entries(worlds || {}).sort(([a], [b]) => a.localeCompare(b));

        tbody.replaceChildren();
        if (entries.length === 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td colspan="3">ワールドがありません</td>';
            tbody.appendChild(tr);
        } else {
            for (const [id, world] of entries) {
                const name = world && typeof world === 'object' && world.name != null
                    ? String(world.name)
                    : id;
                const models = world && typeof world === 'object' && Array.isArray(world.models)
                    ? world.models.length
                    : 0;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><code>${escapeHtml(id)}</code></td>
                    <td>${escapeHtml(name)}</td>
                    <td>${models}</td>
                `;
                tbody.appendChild(tr);
            }
        }

        if (statusEl) {
            statusEl.textContent = `${entries.length} 件のワールド`;
        }
    } catch (e) {
        console.error('loadTenantWorlds failed:', e);
        tbody.replaceChildren();
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="3">読み込み失敗</td>';
        tbody.appendChild(tr);
        if (statusEl) statusEl.textContent = 'ワールドの読み込みに失敗しました';
    }
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
 * Tenant をアーカイブして一覧へ戻る
 */
async function handleArchiveTenant() {
    if (!tenantId) return;

    const displayName = document.getElementById('header-tenant-name')?.textContent || tenantId;
    if (
        !confirm(
            `「${displayName}」をアーカイブしますか？\nデータは tenants/_archive へ移動されます。`
        )
    ) {
        return;
    }

    const doArchive = async (force) => {
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
        window.location.href = '/admin.html';
    };

    try {
        await doArchive(false);
    } catch (e) {
        if (e.code === 'players_connected') {
            const players = e.players ?? '?';
            if (
                confirm(
                    `${players} 人が接続中です。強制アーカイブすると接続が切断されます。続行しますか？`
                )
            ) {
                try {
                    await doArchive(true);
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
 * tenant ID 未指定時のエラー表示
 */
function showMissingTenantError() {
    const main = document.querySelector('.admin-main');
    if (!main) return;
    main.innerHTML = `
        <header>
            <div class="header-left">
                <h1>Tenant が指定されていません</h1>
            </div>
            <div class="header-actions">
                <a class="btn btn-secondary" href="/admin.html">Tenant 一覧へ</a>
            </div>
        </header>
        <div class="admin-panels">
            <section class="stats-section">
                <p class="hint">URL は <code>/admin/tenant/P-01</code> 形式でアクセスしてください。</p>
            </section>
        </div>
    `;
}

if (!tenantId) {
    showMissingTenantError();
} else {
    bootstrapAdminApi()
        .then(() => {
            initAdminPanels();
            initThemeToggle();
            wirePlatformOpsButtons({
                onReloadSuccess: async () => {
                    await loadTenantStats();
                    await loadTenantWorlds();
                },
            });
            const archiveBtn = document.getElementById('tenant-archive-btn');
            if (archiveBtn) {
                archiveBtn.addEventListener('click', () => handleArchiveTenant());
            }
            loadTenantStats();
            loadTenantWorlds();
            setInterval(() => {
                loadTenantStats();
            }, UPDATE_INTERVAL);
        })
        .catch((e) => {
            console.error('admin bootstrap failed:', e);
            alert('認証または CSRF 初期化に失敗しました。ページを再読み込みし、正しいパスワードを入力してください。');
        });
}
