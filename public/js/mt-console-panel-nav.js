// public/js/mt-console-panel-nav.js — サイドバーからパネルを直接切替（非表示ナビへの転送なし）

/**
 * テナント管理: 表示中パネルを切替
 * @param {string} panelId
 */
export function activateTenantPanel(panelId) {
    const navItems = document.querySelectorAll('.side .nav[data-tenant-panel]');
    const panels = document.querySelectorAll('[data-tenant-panel-id]');
    navItems.forEach((btn) => {
        btn.classList.toggle('on', btn.getAttribute('data-tenant-panel') === panelId);
    });
    panels.forEach((p) => {
        p.classList.toggle('active', p.getAttribute('data-tenant-panel-id') === panelId);
    });
    document.dispatchEvent(new CustomEvent('mt-console-tenant-panel', { detail: { panelId } }));
}

/**
 * テナントサイドバーのパネル切替を配線
 */
export function wireTenantConsolePanelNav() {
    document.querySelectorAll('.side .nav[data-tenant-panel]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const panelId = btn.getAttribute('data-tenant-panel');
            if (!panelId) return;
            activateTenantPanel(panelId);
        });
    });
    const initial = document.querySelector('.side .nav[data-tenant-panel].on');
    if (initial) {
        activateTenantPanel(initial.getAttribute('data-tenant-panel') || 'overview');
        return;
    }
    activateTenantPanel('overview');
}