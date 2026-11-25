/* mt-setting-bridge.js — ライブ CONSOLE → 既存 tenant 管理 API（アップロード・競合） */
(function () {
    'use strict';

    const V = window.MTV;

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
     * XHR でアップロード進捗を報告する
     * @param {string} tenantId
     * @param {File} file
     * @param {boolean} confirmOverwrite
     * @param {(pct: number) => void} onProgress 0–100、-1 は不明
     */
    function uploadModelXhr(tenantId, file, confirmOverwrite, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const fd = new FormData();
            fd.append('file', file);
            const url = `/admin/tenants/${encodeURIComponent(tenantId)}/upload${confirmOverwrite ? '?confirm=1' : ''}`;
            xhr.open('POST', url);
            xhr.withCredentials = true;
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable && e.total > 0) {
                    onProgress(Math.min(100, (e.loaded / e.total) * 100));
                } else {
                    onProgress(-1);
                }
            });
            xhr.addEventListener('load', () => {
                if (xhr.status === 409) {
                    let body = {};
                    try {
                        body = JSON.parse(xhr.responseText || '{}');
                    } catch (e) {
                        body = {};
                    }
                    resolve({ conflict: true, filename: body.filename || file.name });
                    return;
                }
                if (xhr.status >= 200 && xhr.status < 300) {
                    onProgress(100);
                    try {
                        resolve(JSON.parse(xhr.responseText || '{}'));
                    } catch (e) {
                        resolve({});
                    }
                    return;
                }
                reject(new Error(`upload failed ${xhr.status}`));
            });
            xhr.addEventListener('error', () => reject(new Error('upload network error')));
            xhr.send(fd);
        });
    }

    /**
     * ライブ用アップロード行を追加する
     * @param {object} st
     * @param {File} file
     */
    function enqueueLiveUpload(st, file) {
        const ed = st.ed;
        const kind = V?.kindOf ? V.kindOf(file.name) : 'model';
        const sizeMb = Math.max(0.1, file.size / (1024 * 1024));
        const row = {
            id: 'up-live-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
            name: file.name,
            kind,
            size: sizeMb,
            progress: 0,
            speed: 0,
            eta: 0,
            done: false,
            failed: false,
            startedAt: Date.now(),
            _live: true,
        };
        ed.uploads = [row].concat(ed.uploads || []).slice(0, 8);
        window.MTA?.paintUploads?.(st);
        window.MTA?.refreshTopBadge?.();
        return row;
    }

    /**
     * @param {object} st
     * @param {File[]} files
     */
    async function uploadFilesWithProgress(st, files) {
        const tenantId = st?.tenant;
        if (!tenantId || !st?.ed?._live) return;
        for (const file of files) {
            const row = enqueueLiveUpload(st, file);
            try {
                let result = await uploadModelXhr(tenantId, file, false, (pct) => {
                    if (pct < 0) return;
                    row.progress = pct;
                    window.MTA?.paintUploads?.(st);
                });
                if (result.conflict) {
                    const ok = window.confirm(`「${result.filename || file.name}」は既にあります。上書きしますか？`);
                    if (!ok) {
                        row.failed = true;
                        row.done = true;
                        window.MTA?.paintUploads?.(st);
                        continue;
                    }
                    result = await uploadModelXhr(tenantId, file, true, (pct) => {
                        if (pct < 0) return;
                        row.progress = pct;
                        window.MTA?.paintUploads?.(st);
                    });
                }
                row.progress = 100;
                row.done = true;
                row.speed = row.size / Math.max(0.3, (Date.now() - row.startedAt) / 1000);
                window.MTA?.paintUploads?.(st);
                if (window.MTWL?.fetchAllWorlds) {
                    try {
                        const worlds = await window.MTWL.fetchAllWorlds(tenantId);
                        st.ed.files = window.MTWL.listFilesFromWorlds
                            ? window.MTWL.listFilesFromWorlds(worlds)
                            : st.ed.files;
                        window.MTA?.paintExplorer?.();
                    } catch (e) {
                        /* ファイル一覧更新はベストエフォート */
                    }
                }
                if (window.MT?.toast) window.MT.toast(`${file.name} をアップロードしました`);
            } catch (err) {
                console.error('[mt-setting-bridge] upload', err);
                row.failed = true;
                row.done = true;
                window.MTA?.paintUploads?.(st);
                if (window.MT?.toast) window.MT.toast(`${file.name} のアップロードに失敗しました`);
            }
        }
        setTimeout(() => {
            const ed = window.MT?.state?.ed;
            if (!ed) return;
            ed.uploads = (ed.uploads || []).filter((u) => !u.done);
            window.MTA?.paintUploads?.(window.MT.state);
            window.MTA?.refreshTopBadge?.();
        }, 2600);
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
                void uploadFilesWithProgress(st, Array.from(inp.files));
                inp.value = '';
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
                void uploadFilesWithProgress(st, files);
            },
            true
        );
    }

    window.MTSettingBridge = {
        installUploadBridge,
        uploadModelLive,
        uploadFilesWithProgress,
        uploadModelXhr,
    };
    installUploadBridge();
})();