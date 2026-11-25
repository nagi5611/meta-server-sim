/* mt-production-editor-bridge.js — デザインエディタ ↔ 本番 setting.js 移植の拡張点 */
(function () {
    'use strict';

    /**
     * 移植対応表は docs/admin-console-migration-map.md を参照。
     * 現段階: ワールド一覧は MTD（API）由来。保存・モデル読込は mt-editor（プロトタイプ）＋今後 setting.js API へ接続。
     */
    if (!window.MTA || !window.MTD) return;

    const origInit = window.MTA.initEd || window.MTES?.initEd;
    if (origInit && window.MT) {
        const wrapInit = (st) => {
            const t = window.MTD.TENANTS.find((x) => x.id === st.tenant);
            if (t && (!st.worldId || st.worldId === 'lobby')) {
                const first = t.worlds?.[0];
                if (first) st.worldId = first.id;
            }
            return origInit(st);
        };
        if (window.MTES) window.MTES.initEd = wrapInit;
    }

    document.addEventListener(
        'click',
        (e) => {
            const pub = e.target.closest('[data-ed-act="publish"], [data-ed-act="draft"]');
            if (!pub || !window.MT?.state?.tenant) return;
            e.preventDefault();
            e.stopPropagation();
            const tid = encodeURIComponent(window.MT.state.tenant);
            window.MT.toast('本番保存 API は未接続です。旧エディタを開きます。');
            window.location.href = `/admin-legacy/tenant/${tid}/world-edit`;
        },
        true
    );
})();