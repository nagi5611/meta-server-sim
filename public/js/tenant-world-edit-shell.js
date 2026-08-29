// public/js/tenant-world-edit-shell.js — ワールド編集ページのヘッダー・テーマ（metaverse-simple admin.js 相当の最小実装）
const ADMIN_THEME_STORAGE_KEY = 'adminTheme';

/**
 * ダーク / ライトテーマを適用する
 * @param {boolean} isDark
 */
function applyAdminTheme(isDark) {
    const icon = document.getElementById('admin-theme-icon');
    const toggle = document.getElementById('admin-theme-toggle');
    if (isDark) {
        document.body.classList.add('admin-dark');
        if (icon) {
            icon.className = 'bi bi-sun-fill';
        }
        if (toggle) {
            toggle.setAttribute('title', 'ライトモードに切替');
        }
    } else {
        document.body.classList.remove('admin-dark');
        if (icon) {
            icon.className = 'bi bi-moon-fill';
        }
        if (toggle) {
            toggle.setAttribute('title', 'ダークモードに切替');
        }
    }
}

/**
 * ワールド編集ローカルキャッシュを削除して再読み込みする
 */
async function hardReloadAdminCaches() {
    try {
        localStorage.removeItem('metaverse-admin-world-edit-cache-v1');
    } catch {
        /* ignore */
    }
    try {
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
        }
    } catch {
        /* ignore */
    }
    window.location.reload();
}

/**
 * Tenant ワールド編集ページのシェル UI を初期化する
 * @param {string} tenantId
 */
export function initTenantWorldEditShell(tenantId) {
    const tenantAdminLink = document.getElementById('world-edit-tenant-admin-link');
    const backToMetaverse = document.getElementById('back-to-metaverse');
    const titleEl = document.getElementById('world-edit-tenant-title');
    const usernameEl = document.getElementById('header-username');

    if (tenantAdminLink) {
        tenantAdminLink.href = `/admin/tenant/${encodeURIComponent(tenantId)}`;
    }
    if (backToMetaverse) {
        backToMetaverse.href = `/${encodeURIComponent(tenantId)}/`;
    }
    if (titleEl) {
        titleEl.textContent = `${tenantId} — ワールド編集`;
    }
    if (usernameEl) {
        usernameEl.textContent = 'admin';
    }

    const storedTheme = localStorage.getItem(ADMIN_THEME_STORAGE_KEY);
    applyAdminTheme(storedTheme === 'dark');

    document.getElementById('admin-theme-toggle')?.addEventListener('click', () => {
        const isDark = !document.body.classList.contains('admin-dark');
        applyAdminTheme(isDark);
        localStorage.setItem(ADMIN_THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
    });

    document.getElementById('admin-cache-hard-reload')?.addEventListener('click', () => {
        hardReloadAdminCaches();
    });
}
