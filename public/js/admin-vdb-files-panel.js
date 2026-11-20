// public/js/admin-vdb-files-panel.js — VDB / NanoVDB アップロードとワールドへの追加

/** @type {string | null} */
let activeTenantId = null;

/**
 * @returns {string | null}
 */
function getSelectedWorldIdFromDom() {
    const sel = document.querySelector('#world-list .item.selected');
    return sel?.dataset?.id ?? null;
}

/**
 * @returns {Promise<{ files: Array<{ name: string, file: string, bytes: number }>, samples: Array<{ name: string, file: string }> }>}
 */
async function fetchVdbLibrary() {
    const res = await fetch(`/admin/tenants/${encodeURIComponent(activeTenantId)}/vdb-files`, {
        credentials: 'include',
    });
    if (!res.ok) {
        throw new Error(await res.text());
    }
    return res.json();
}

/**
 * @param {Awaited<ReturnType<typeof fetchVdbLibrary>>} data
 */
function renderVdbLibrary(data) {
    const listEl = document.getElementById('vdb-file-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const worldSelected = !!getSelectedWorldIdFromDom();
    const rows = [
        ...(Array.isArray(data.samples) ? data.samples : []),
        ...(Array.isArray(data.files) ? data.files : []),
    ];
    if (!rows.length) {
        listEl.innerHTML = '<p class="hint">登録済み VDB はありません。</p>';
        return;
    }
    for (const row of rows) {
        const item = document.createElement('div');
        item.className = 'item vdb-file-item';
        item.dataset.file = row.file;

        const title = document.createElement('strong');
        title.textContent = row.name || row.file;

        const meta = document.createElement('span');
        meta.className = 'hint';
        meta.textContent = row.bytes != null ? `${Math.round(row.bytes / 1024)} KiB` : 'サンプル';

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn btn-sm btn-secondary vdb-add-to-world-btn';
        addBtn.textContent = 'ワールドに追加';
        addBtn.dataset.file = row.file;
        addBtn.disabled = !worldSelected;

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-sm btn-outline-danger vdb-delete-btn';
        delBtn.textContent = '削除';
        delBtn.dataset.filename = row.name;
        delBtn.style.display = row.file?.startsWith('vdbs/') ? '' : 'none';

        item.append(title, meta, addBtn);
        if (row.file?.startsWith('vdbs/')) item.append(delBtn);
        listEl.appendChild(item);
    }
}

async function reloadVdbLibrary() {
    const statusEl = document.getElementById('vdb-list-status');
    if (statusEl) {
        statusEl.textContent = '読み込み中…';
        statusEl.className = '';
    }
    try {
        const data = await fetchVdbLibrary();
        renderVdbLibrary(data);
        if (statusEl) statusEl.textContent = '';
    } catch (err) {
        if (statusEl) {
            statusEl.textContent = err instanceof Error ? err.message : String(err);
            statusEl.className = 'status-error';
        }
    }
}

/**
 * @param {FormData} form
 * @param {boolean} [confirmOverwrite]
 */
async function uploadVdbForm(form, confirmOverwrite = false) {
    const url = new URL(`/admin/tenants/${encodeURIComponent(activeTenantId)}/upload-vdb`, globalThis.location.origin);
    if (confirmOverwrite) url.searchParams.set('confirm', '1');
    const res = await fetch(url, {
        method: 'POST',
        body: form,
        credentials: 'include',
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && !confirmOverwrite) {
        if (globalThis.confirm('同名の VDB が既にあります。上書きしますか？')) {
            return uploadVdbForm(form, true);
        }
        return { ok: false, conflict: true };
    }
    if (!res.ok) {
        throw new Error(body.message || body.error || res.statusText);
    }
    return { ok: true, ...body };
}

/**
 * @param {string} tenantId
 * @returns {Promise<void>}
 */
export async function initVdbFilesPanel(tenantId) {
    activeTenantId = tenantId;
    const uploadBtn = document.getElementById('vdb-upload-btn');
    const fileInput = document.getElementById('vdb-upload-file');
    const uploadStatus = document.getElementById('vdb-upload-status');
    const addStatus = document.getElementById('vdb-add-status');
    const listEl = document.getElementById('vdb-file-list');

    await reloadVdbLibrary();

    uploadBtn?.addEventListener('click', async () => {
        const file = fileInput?.files?.[0];
        if (!file) {
            if (uploadStatus) uploadStatus.textContent = 'ファイルを選択してください。';
            return;
        }
        const form = new FormData();
        form.append('vdb', file);
        if (uploadStatus) uploadStatus.textContent = 'アップロード中…';
        try {
            await uploadVdbForm(form);
            if (uploadStatus) uploadStatus.textContent = 'アップロードしました。';
            if (fileInput) fileInput.value = '';
            await reloadVdbLibrary();
        } catch (err) {
            if (uploadStatus) uploadStatus.textContent = err instanceof Error ? err.message : String(err);
        }
    });

    listEl?.addEventListener('click', async (ev) => {
        const t = ev.target;
        if (!(t instanceof HTMLElement)) return;
        const file = t.dataset.file;
        if (t.classList.contains('vdb-add-to-world-btn') && file) {
            if (addStatus) addStatus.textContent = '追加中…';
            try {
                const { addVdbVolumeFromLibrary } = await import('@metaverse-simple/setting.js');
                const result = addVdbVolumeFromLibrary(file);
                if (addStatus) {
                    addStatus.textContent = result.duplicate
                        ? '既にワールド内にあります（選択しました）。'
                        : 'ワールドに追加しました。保存するまでディスクには書き込まれません。';
                }
            } catch (err) {
                if (addStatus) addStatus.textContent = err instanceof Error ? err.message : String(err);
            }
            return;
        }
        const filename = t.dataset.filename;
        if (t.classList.contains('vdb-delete-btn') && filename) {
            if (!globalThis.confirm(`「${filename}」を削除しますか？`)) return;
            const res = await fetch(
                `/admin/tenants/${encodeURIComponent(activeTenantId)}/vdb-files/${encodeURIComponent(filename)}`,
                { method: 'DELETE', credentials: 'include' },
            );
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                if (addStatus) addStatus.textContent = j.message || j.error || '削除に失敗しました';
                return;
            }
            await reloadVdbLibrary();
        }
    });

    document.getElementById('world-list')?.addEventListener('click', () => {
        void reloadVdbLibrary();
    });
}