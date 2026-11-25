/* mt-app-boot.js — Basic 認証済み起動・URL ルート・ライブデータ読込 */
(function () {
    'use strict';

    const boot = window.__MT_BOOT__ || {};
    const pathMatch = window.location.pathname.match(/\/admin\/tenant\/([^/]+)(?:\/(world-edit))?\/?$/);
    if (pathMatch) {
        boot.tenantId = decodeURIComponent(pathMatch[1]);
        if (pathMatch[2] === 'world-edit') boot.view = 'world';
    }

    const gateFoot = document.querySelector('.gate-foot');
    if (gateFoot) {
        gateFoot.innerHTML =
            '<span>認証はブラウザの HTTP Basic です</span><span>プロトタイプの試用アカウントは無効です</span>';
    }

    async function start() {
        if (!window.__nativeAdminFetch) {
            window.__nativeAdminFetch = window.fetch.bind(window);
        }
        const gate = document.getElementById('gate');
        const app = document.getElementById('app');
        const err = document.getElementById('gateErr');
        try {
            if (window.MTD?.loadLive) await window.MTD.loadLive();
        } catch (e) {
            console.error('[mt-app-boot] loadLive failed', e);
            if (err) err.textContent = '管理 API の読み込みに失敗しました。ページを再読み込みしてください。';
            return;
        }

        if (!window.MT) return;

        sessionStorage.setItem('mt.authed', '1');
        const gateForm = document.getElementById('gateForm');
        if (gateForm) {
            gateForm.addEventListener('submit', (e) => e.preventDefault());
        }

        if (boot.tenantId) {
            const exists = window.MTD.TENANTS.some((t) => t.id === boot.tenantId);
            window.MT.state.tenant = exists ? boot.tenantId : boot.tenantId;
            if (boot.view) window.MT.state.view = boot.view;
            else if (pathMatch) window.MT.state.view = 'tenant';
            if (boot.view === 'world') {
                const t = window.MTD.TENANTS.find((x) => x.id === boot.tenantId);
                const lobby = t?.worlds?.find((w) => w.id === 'lobby');
                window.MT.state.worldId = lobby?.id || t?.worlds?.[0]?.id || null;
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash.startsWith('settings')) {
            window.MT.state.tenant = null;
            window.MT.state.view = 'platform-settings';
        } else if (hash === 'dash' || hash === '') {
            /* default */
        }
        if (typeof window.MT.enter === 'function') {
            window.MT.enter();
        } else {
            if (gate) gate.hidden = true;
            if (app) app.hidden = false;
            window.MT.state.authed = true;
            if (typeof window.MT.render === 'function') window.MT.render();
        }
        if (typeof window.MT.toast === 'function' && window.MTD.flags?.trafficDisconnected) {
            /* 通信ログ未接続は views 側で表示 */
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => void start());
    } else {
        void start();
    }
})();