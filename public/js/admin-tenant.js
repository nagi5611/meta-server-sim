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

const TRAFFIC_CATEGORY_LABELS = {
    fds_smoke_main: '煙メイン',
    fds_smoke_bulk: '煙バルク',
    tenant_r2: 'R2',
};

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatTrafficBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(n) / Math.log(k)));
    return `${Math.round((n / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

/**
 * 通信トラフィック UI を更新する
 * @param {object | undefined} traffic
 */
function renderTenantTraffic(traffic) {
    const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    if (!traffic) {
        set('tenant-traffic-rate', '-');
        set('tenant-traffic-window', '-');
        set('tenant-traffic-total', '-');
        set('tenant-traffic-categories', 'トラフィックデータがありません');
        return;
    }

    set('tenant-traffic-rate', traffic.bytesPerSecondHuman || '-');
    set('tenant-traffic-window', traffic.bytesSentLastWindowHuman || '-');
    set('tenant-traffic-total', traffic.bytesSentTotalHuman || '-');

    const catParts = Object.entries(traffic.byCategory || {})
        .filter(([, bytes]) => bytes > 0)
        .map(([key, bytes]) => `${TRAFFIC_CATEGORY_LABELS[key] || key}: ${formatTrafficBytes(bytes)}`);
    set(
        'tenant-traffic-categories',
        catParts.length ? `カテゴリ別累計 — ${catParts.join(' / ')}` : 'まだ送信トラフィックは記録されていません',
    );

    const tbody = document.getElementById('tenant-traffic-top-body');
    if (!tbody) return;
    const rows = Array.isArray(traffic.topPaths) ? traffic.topPaths : [];
    tbody.replaceChildren();
    if (rows.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="2">データなし</td>';
        tbody.appendChild(tr);
        return;
    }
    for (const row of rows) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${escapeHtml(row.key)}</code></td>
            <td>${escapeHtml(row.bytesHuman || formatTrafficBytes(row.bytes))}</td>
        `;
        tbody.appendChild(tr);
    }
}

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
 * ヘッダーに tenant 情報を反映する
 * @param {{ tenantId: string, displayName: string, url: string }} data
 */
function applyTenantHeader(data) {
    const idEl = document.getElementById('header-tenant-id');
    const nameEl = document.getElementById('header-tenant-name');
    const linkEl = document.getElementById('tenant-metaverse-link');
    if (idEl) idEl.textContent = data.tenantId;
    if (nameEl) nameEl.textContent = data.displayName || data.tenantId;
    if (linkEl) {
        linkEl.href = data.url || `/${data.tenantId}/`;
        linkEl.addEventListener('click', async (e) => {
            e.preventDefault();
            const targetUrl = linkEl.href;
            try {
                const res = await adminFetch('/admin/enter-metaverse', { credentials: 'include' });
                if (!res.ok) {
                    /* ignore — ゲストとして入室 */
                }
            } catch {
                /* ignore — ゲストとして入室 */
            }
            window.open(targetUrl, '_blank', 'noopener');
        });
    }
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
        const worldEditCta = document.getElementById('tenant-world-edit-cta');
        const worldEditUrl = `/admin/tenant/${encodeURIComponent(data.tenantId)}/world-edit`;
        if (worldEditNav) {
            worldEditNav.href = worldEditUrl;
        }
        if (worldEditCta) {
            worldEditCta.href = worldEditUrl;
        }

        const set = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        set('tenant-players', String(data.players ?? 0));
        set('tenant-rooms', String(data.rooms ?? 0));
        set('tenant-world-count', String(data.worldCount ?? 0));
        set('tenant-url', data.url || `/${tenantId}/`);

        renderTenantTraffic(data.traffic);

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
