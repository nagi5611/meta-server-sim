/* mt-setting-bridge.js — ライブ CONSOLE → 既存 tenant 管理 API（アップロード・競合） */
(function () {
    'use strict';

    /**
     * GLB/モデルをテナントにアップロードする
     * @param {string} tenantId
     * @param {File} file
     * @param {boolean} confirmOverwrite
     */
    async function uploadModelLive(tenantId, file, confirmOverwrite) {
        const fd = new FormData();
        fd.append('file', file);
        const q = confirmOverwrite ? '?confirm=1' : '';
        const fetchFn = window.__nativeAdminFetch || window.fetch;
        const res = await fetchFn(`/admin/tenants/${encodeURIComponent(tenantId)}/upload${q}`, {
            method: 'POST',
            credentials: 'include',
            body: fd,
        });
        if (res.status === 409) {
            const body = await res.json().catch(() => ({}));
            return { conflict: true, filename: body.filename || file.name };
        }
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`upload failed ${res.status} ${text.slice(0, 120)}`);
        }
        return res.json();
    }

    /**
     * デザインのモックアップロードを本番 API で差し替える（キャプチャフェーズ）
     */
    function installUploadBridge() {
        document.addEventListener(
            'change',
            (e) => {
                const inp = e.target.closest('[data-ex-upload]');
                if (!inp?.files?.length) return;
                const st = window.MT?.state;
                if (!st?.ed?._live || !st.tenant) return;
                e.stopImmediatePropagation();
                e.preventDefault();
                void (async () => {
                    for (const file of Array.from(inp.files)) {
                        try {
                            let result = await uploadModelLive(st.tenant, file, false);
                            if (result.conflict) {
                                const ok = window.confirm(
                                    `「${result.filename || file.name}」は既にあります。上書きしますか？`
                                );
                                if (!ok) continue;
                                result = await uploadModelLive(st.tenant, file, true);
                            }
                            if (window.MT?.toast) window.MT.toast(`${file.name} をアップロードしました`);
                        } catch (err) {
                            console.error('[mt-setting-bridge] upload', err);
                            if (window.MT?.toast) window.MT.toast('アップロードに失敗しました');
                        }
                    }
                    inp.value = '';
                })();
            },
            true
        );

        document.addEventListener(
            'drop',
            (e) => {
                const drop = e.target.closest('[data-canvas], [data-ex-drop]');
                if (!drop) return;
                const st = window.MT?.state;
                if (!st?.ed?._live || !st.tenant) return;
                const files = Array.from(e.dataTransfer?.files || []);
                if (!files.length) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                void (async () => {
                    for (const file of files) {
                        try {
                            let result = await uploadModelLive(st.tenant, file, false);
                            if (result.conflict) {
                                const ok = window.confirm(
                                    `「${result.filename || file.name}」は既にあります。上書きしますか？`
                                );
                                if (!ok) continue;
                                result = await uploadModelLive(st.tenant, file, true);
                            }
                            if (window.MT?.toast) window.MT.toast(`${file.name} をアップロードしました`);
                        } catch (err) {
                            console.error('[mt-setting-bridge] drop upload', err);
                            if (window.MT?.toast) window.MT.toast('アップロードに失敗しました');
                        }
                    }
                })();
            },
            true
        );
    }

    window.MTSettingBridge = { installUploadBridge, uploadModelLive };
    installUploadBridge();
})();