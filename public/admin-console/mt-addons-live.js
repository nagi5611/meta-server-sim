/* mt-addons-live.js — アドオン ON/OFF を既存 Tenant Plugin API に接続 */
(function () {
    'use strict';

    const V = window.MTV;
    if (!V || !V.toggleAddon) return;

    async function csrfToken() {
        const r = await fetch('/admin/csrf-token', { credentials: 'include' });
        if (!r.ok) throw new Error(`csrf HTTP ${r.status}`);
        const j = await r.json();
        return j.token;
    }

    const protoToggle = V.toggleAddon;
    V.toggleAddon = function toggleAddonLive(id) {
        const st = window.MT.state;
        const t = window.MTD.TENANTS.find((x) => x.id === st.tenant);
        if (!t) {
            window.MT.toast('テナントが未選択です');
            return;
        }
        const map = V._addonCache(t);
        const row = map[id];
        if (!row) {
            window.MT.toast('未接続');
            return;
        }
        const enabling = !row.on;
        void (async () => {
            try {
                const token = await csrfToken();
                const path = enabling
                    ? `/admin/tenant/${encodeURIComponent(t.id)}/plugins/${encodeURIComponent(id)}/enable`
                    : `/admin/tenant/${encodeURIComponent(t.id)}/plugins/${encodeURIComponent(id)}/disable`;
                const res = await fetch(path, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': token,
                    },
                });
                const j = await res.json().catch(() => ({}));
                if (!res.ok || j.ok === false) {
                    throw new Error(j.message || `HTTP ${res.status}`);
                }
                protoToggle.call(V, id);
                if (j.restartRequired) {
                    window.MT.toast('反映にはプラグイン reload が必要な場合があります');
                }
                await window.MTD.loadLive();
                window.MT.render();
            } catch (e) {
                window.MT.toast(`アドオン更新失敗: ${e.message || e}`);
            }
        })();
    };
})();