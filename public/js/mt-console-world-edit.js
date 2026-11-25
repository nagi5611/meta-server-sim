// public/js/mt-console-world-edit.js — 既存ワールド編集 DOM を CONSOLE / wed-root レイアウトへ橋渡し
import { mtEsc } from './mt-console-ui.js';

/**
 * @param {{ tenantId?: string, tenantLabel?: string }} ctx
 */
export function mountWorldEditConsoleLayout(ctx = {}) {
    const panel = document.getElementById('panel-world-edit');
    if (!panel || panel.dataset.mtWedMounted === '1') return;

    const layout = panel.querySelector('.setting-layout');
    if (!layout) return;

    const root = document.createElement('div');
    root.className = 'wed-root';
    layout.parentElement?.insertBefore(root, layout);
    root.appendChild(layout);

    const vedTop = document.createElement('div');
    vedTop.className = 'ved-top vd-console-top';
    const tid = ctx.tenantId || '';
    const label = ctx.tenantLabel || tid;
    vedTop.innerHTML = `
      <a class="vd-brand" href="/admin.html" title="CONSOLE">
        <img src="/css/mt-console/assets/icon-192.png" width="19" height="19" alt="">
      </a>
      <nav class="vd-crumb" aria-label="パンくず">
        <a href="/admin.html">管理</a><span>/</span>
        <a href="${tid ? `/admin/tenant/${encodeURIComponent(tid)}` : '/admin.html'}">${mtEsc(label)}</a><span>/</span>
        <b>ワールド編集</b>
      </nav>
      <span class="vd-grow"></span>
      <div class="vd-actions" id="wed-topbar-actions"></div>
    `;
    root.insertBefore(vedTop, layout);

    const slot = document.getElementById('mt-topbar-actions');
    const wedSlot = document.getElementById('wed-topbar-actions');
    if (slot && wedSlot) {
        for (const child of [...slot.childNodes]) {
            const el = /** @type {HTMLElement} */ (child);
            if (el.tagName === 'A' && el.id === 'back-to-metaverse') {
                el.classList.remove('btn', 'btn-secondary');
                el.classList.add('vd-btn', 'primary');
                el.textContent = el.textContent?.trim() || 'メタバースへ';
            } else if (el.id === 'admin-theme-toggle' || el.id === 'admin-cache-hard-reload') {
                el.classList.remove('btn', 'btn-secondary', 'btn-icon');
                el.classList.add('vd-btn', 'ghost');
            }
            wedSlot.appendChild(child);
        }
    }

    document.querySelector('.topbar')?.setAttribute('hidden', '');
    layout.classList.add('wed-stage-bridge');

    const viewer = layout.querySelector('.viewer');
    if (viewer) {
        viewer.classList.add('ved-canvas');
        const stage = document.createElement('div');
        stage.className = 'ved-stage docked';
        viewer.parentElement?.insertBefore(stage, viewer);
        stage.appendChild(viewer);
    }

    panel.dataset.mtWedMounted = '1';
}