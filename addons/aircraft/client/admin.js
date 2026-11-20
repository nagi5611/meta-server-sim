// addons/aircraft/client/admin.js — テナント管理「飛行機」タブ（meta-server admin-panel 読み込み）
const PANEL_ID = 'panel-addon-aircraft';

async function initAircraftAdminPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const nav = document.querySelector('.admin-nav') || document.querySelector('.admin-sidebar');
    if (!nav) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'admin-nav-btn';
    btn.dataset.tenantPanel = PANEL_ID;
    btn.textContent = '飛行機';
    nav.appendChild(btn);

    const panels = document.querySelector('.admin-panels');
    if (!panels) return;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'admin-panel';
    panel.innerHTML =
        '<h2>飛行機アドオン</h2><p>機体タグ（B787 / A320 等）のパラメータ編集はワールド編集画面の「飛行機」カテゴリ、または下記パネルから行えます。</p><div id="aircraft-admin-mount"></div>';
    panels.appendChild(panel);

    panel.querySelector('#aircraft-admin-mount').innerHTML =
        '<p class="hint">機体タグの作成・編集は<strong>ワールド編集</strong> → カテゴリ「飛行機」、またはオブジェクトの種類「飛行機」から行えます。API: <code>/admin/tenants/&lt;id&gt;/addons/aircraft/airframes</code></p>';
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void initAircraftAdminPanel());
} else {
    void initAircraftAdminPanel();
}