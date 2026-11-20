// addons/vdb-volume/client/admin.js — テナント管理画面の簡易説明
const PANEL_ID = 'panel-addon-vdb-volume';
const NAV_DATA_PANEL = 'panel-addon-vdb-volume';

function initVdbVolumeAdmin() {
    const nav = document.querySelector('.admin-nav') || document.querySelector('.admin-sidebar');
    if (!nav || document.getElementById(PANEL_ID)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'admin-nav-btn';
    btn.dataset.tenantPanel = NAV_DATA_PANEL;
    btn.textContent = 'VDB Volume';
    nav.appendChild(btn);

    const panels = document.querySelector('.admin-panels');
    if (!panels) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'admin-panel';
    panel.innerHTML = `
        <h2>VDB Volume アドオン</h2>
        <p>ワールド JSON の <code>vdbs[]</code> に NanoVDB（<code>.nvdb</code>）または OpenVDB（<code>.vdb</code>）を指定すると、メタバース内でレイマーチ表示されます。</p>
        <pre style="white-space:pre-wrap;font-size:0.85rem;">"vdbs": [
  {
    "id": "cloud-demo",
    "file": "samples/cloud-cumulus.nvdb",
    "gridName": "density",
    "position": { "x": 30, "y": 6, "z": 22 },
    "worldScale": 4
  }
]</pre>
        <p>ファイルは <code>addons/vdb-volume/</code> 配下を <code>addons-client/vdb-volume/…</code> から配信します。</p>
    `;
    panels.appendChild(panel);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVdbVolumeAdmin);
} else {
    initVdbVolumeAdmin();
}