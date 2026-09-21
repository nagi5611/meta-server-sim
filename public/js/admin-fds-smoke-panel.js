// public/js/admin-fds-smoke-panel.js — FDS煙 ZIP アップロード・ライブラリ（ワールド追加は setting.js）

const SIM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** @type {string | null} */
let activeTenantId = null;

/**
 * ZIP ファイル名から simId を推測する
 * @param {string} filename
 * @returns {string}
 */
function simIdFromZipFilename(filename) {
    const base = filename.replace(/\.zip$/i, '');
    const s = base.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '') || 'simulation';
    return s.slice(0, 64);
}

/**
 * 左パネルで選択中のワールド ID を DOM から取得する
 * @returns {string | null}
 */
function getSelectedWorldIdFromDom() {
    const sel = document.querySelector('#world-list .item.selected');
    return sel?.dataset?.id ?? null;
}

/**
 * シミュレーション一覧を取得する
 * @returns {Promise<Array<{ id: string, quantity: string, frameCount: number, multipart: boolean, chunkIntervalSec: number | null }>>}
 */
async function fetchSimulations() {
    const res = await fetch(`/admin/tenants/${encodeURIComponent(activeTenantId)}/simulations`, {
        credentials: 'include',
    });
    if (!res.ok) {
        throw new Error(await res.text());
    }
    const data = await res.json();
    return Array.isArray(data.simulations) ? data.simulations : [];
}

/**
 * シミュレーション一覧 UI を描画する
 * @param {Awaited<ReturnType<typeof fetchSimulations>>} simulations
 */
function renderSimulationList(simulations) {
    const listEl = document.getElementById('fds-smoke-sim-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    if (simulations.length === 0) {
        listEl.innerHTML = '<p class="hint">登録済みシミュレーションはありません。</p>';
        return;
    }

    const worldSelected = !!getSelectedWorldIdFromDom();

    for (const sim of simulations) {
        const row = document.createElement('div');
        row.className = 'item fds-smoke-sim-item';
        row.dataset.simId = sim.id;

        const title = document.createElement('strong');
        title.textContent = sim.id;

        const meta = document.createElement('span');
        meta.className = 'fds-smoke-sim-meta';
        const multipartLabel = sim.multipart
            ? `マルチパート${sim.chunkIntervalSec != null ? ` (${sim.chunkIntervalSec}s)` : ''}`
            : '単一ファイル';
        meta.textContent = `${sim.quantity || '—'} · ${sim.frameCount} frames · ${multipartLabel}`;

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn btn-sm btn-secondary fds-smoke-add-to-world-btn';
        addBtn.textContent = 'ワールドに追加';
        addBtn.dataset.simId = sim.id;
        addBtn.disabled = !worldSelected;

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-sm btn-outline-danger fds-smoke-delete-btn';
        delBtn.textContent = '削除';
        delBtn.dataset.simId = sim.id;

        row.append(title, meta, addBtn, delBtn);
        listEl.appendChild(row);
    }
}

/**
 * 一覧を再読み込みする
 */
async function reloadSimulationList() {
    const statusEl = document.getElementById('fds-smoke-list-status');
    if (statusEl) {
        statusEl.textContent = '読み込み中…';
        statusEl.className = '';
    }
    try {
        const simulations = await fetchSimulations();
        renderSimulationList(simulations);
        if (statusEl) statusEl.textContent = '';
    } catch (err) {
        if (statusEl) {
            statusEl.textContent = `一覧の取得に失敗: ${err instanceof Error ? err.message : String(err)}`;
            statusEl.className = 'error';
        }
    }
}

/**
 * ZIP をアップロードする
 */
async function handleUpload() {
    const statusEl = document.getElementById('fds-smoke-upload-status');
    const simIdInput = /** @type {HTMLInputElement | null} */ (document.getElementById('fds-smoke-sim-id'));
    const fileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('fds-smoke-zip-file'));
    if (!simIdInput || !fileInput || !activeTenantId) return;

    const file = fileInput.files?.[0];
    if (!file) {
        if (statusEl) {
            statusEl.textContent = 'ZIP ファイルを選択してください。';
            statusEl.className = 'error';
        }
        return;
    }

    let simId = simIdInput.value.trim() || simIdFromZipFilename(file.name);
    if (!SIM_ID_PATTERN.test(simId)) {
        if (statusEl) {
            statusEl.textContent = 'シミュレーション ID は英数字・_- のみ（1〜64文字）です。';
            statusEl.className = 'error';
        }
        return;
    }

    const doUpload = async (confirmOverwrite) => {
        const csrfRes = await fetch('/admin/csrf-token', { credentials: 'include' });
        if (!csrfRes.ok) throw new Error(await csrfRes.text());
        const { token } = await csrfRes.json();

        const qs = confirmOverwrite ? '?confirm=1' : '';
        const uploadRes = await fetch(
            `/admin/tenants/${encodeURIComponent(activeTenantId)}/upload-fds-smoke-zip${qs}`,
            {
                method: 'POST',
                headers: { 'X-Admin-CSRF': token },
                credentials: 'include',
                body: (() => {
                    const fd = new FormData();
                    fd.append('zip', file);
                    fd.append('simId', simId);
                    return fd;
                })(),
            },
        );
        if (uploadRes.status === 409) {
            const data = await uploadRes.json().catch(() => ({}));
            const msg = data.message || `シミュレーション "${simId}" は既に存在します。上書きしますか？`;
            if (window.confirm(msg)) {
                return doUpload(true);
            }
            throw new Error('アップロードをキャンセルしました。');
        }
        if (!uploadRes.ok) {
            throw new Error(await uploadRes.text());
        }
        return uploadRes.json();
    };

    if (statusEl) {
        statusEl.textContent = 'アップロード中…（大容量は数分かかります）';
        statusEl.className = '';
    }

    try {
        const result = await doUpload(false);
        if (statusEl) {
            statusEl.textContent = `アップロード完了: ${result.simId ?? simId}`;
            statusEl.className = '';
        }
        if (result.simId) simIdInput.value = result.simId;
        fileInput.value = '';
        await reloadSimulationList();
    } catch (err) {
        if (statusEl) {
            statusEl.textContent = `アップロード失敗: ${err instanceof Error ? err.message : String(err)}`;
            statusEl.className = 'error';
        }
    }
}

/**
 * シミュレーションを削除する
 * @param {string} simId
 */
async function handleDeleteSimulation(simId) {
    const statusEl = document.getElementById('fds-smoke-list-status');
    if (!activeTenantId || !simId) return;
    if (!window.confirm(`シミュレーション "${simId}" を削除しますか？`)) return;

    if (statusEl) {
        statusEl.textContent = '削除中…';
        statusEl.className = '';
    }

    try {
        const csrfRes = await fetch('/admin/csrf-token', { credentials: 'include' });
        if (!csrfRes.ok) throw new Error(await csrfRes.text());
        const { token } = await csrfRes.json();

        const delRes = await fetch(
            `/admin/tenants/${encodeURIComponent(activeTenantId)}/simulations/${encodeURIComponent(simId)}`,
            {
                method: 'DELETE',
                headers: { 'X-Admin-CSRF': token },
                credentials: 'include',
            },
        );
        if (!delRes.ok) {
            throw new Error(await delRes.text());
        }
        await reloadSimulationList();
        if (statusEl) statusEl.textContent = '削除しました。';
    } catch (err) {
        if (statusEl) {
            statusEl.textContent = `削除失敗: ${err instanceof Error ? err.message : String(err)}`;
            statusEl.className = 'error';
        }
    }
}

/**
 * シミュレーションを選択中ワールドのエディタに追加する
 * @param {string} simId
 */
async function handleAddToWorld(simId) {
    const statusEl = document.getElementById('fds-smoke-add-status');
    if (!getSelectedWorldIdFromDom()) {
        if (statusEl) {
            statusEl.textContent = 'ワールドを選択してください。';
            statusEl.className = 'error';
        }
        return;
    }

    try {
        const { addFdsSmokeFromSimulation } = await import('@metaverse-simple/setting.js');
        const result = addFdsSmokeFromSimulation(simId);
        if (!result.ok) {
            if (statusEl) {
                statusEl.textContent = result.error || '追加に失敗しました。';
                statusEl.className = 'error';
            }
            return;
        }
        if (statusEl) {
            statusEl.textContent = result.duplicate
                ? '既にワールドに追加済みです。オブジェクト一覧で選択できます。'
                : 'ワールドに追加しました。位置を調整して「保存・管理」で保存してください。';
            statusEl.className = '';
        }
    } catch (err) {
        if (statusEl) {
            statusEl.textContent = `追加失敗: ${err instanceof Error ? err.message : String(err)}`;
            statusEl.className = 'error';
        }
    }
}

/**
 * イベントリスナーを登録する
 */
function bindPanelEvents() {
    document.getElementById('fds-smoke-upload-btn')?.addEventListener('click', () => {
        void handleUpload();
    });

    document.getElementById('fds-smoke-zip-file')?.addEventListener('change', (e) => {
        const input = /** @type {HTMLInputElement} */ (e.target);
        const simIdInput = /** @type {HTMLInputElement | null} */ (document.getElementById('fds-smoke-sim-id'));
        const file = input.files?.[0];
        if (file && simIdInput && !simIdInput.value.trim()) {
            simIdInput.value = simIdFromZipFilename(file.name);
        }
    });

    document.getElementById('fds-smoke-sim-list')?.addEventListener('click', (e) => {
        const delBtn = /** @type {HTMLElement} */ (e.target).closest('.fds-smoke-delete-btn');
        if (delBtn?.dataset.simId) {
            e.stopPropagation();
            void handleDeleteSimulation(delBtn.dataset.simId);
            return;
        }

        const addBtn = /** @type {HTMLElement} */ (e.target).closest('.fds-smoke-add-to-world-btn');
        if (addBtn?.dataset.simId) {
            e.stopPropagation();
            void handleAddToWorld(addBtn.dataset.simId);
        }
    });

    document.getElementById('world-list')?.addEventListener('click', () => {
        void reloadSimulationList();
    });

    document.querySelector('.we-category-btn[data-we-category="fds-smoke"]')?.addEventListener('click', () => {
        void reloadSimulationList();
    });
}

/**
 * FDS煙管理パネルを初期化する
 * @param {string} tenantId
 * @returns {Promise<void>}
 */
export async function initFdsSmokePanel(tenantId) {
    activeTenantId = tenantId;
    bindPanelEvents();
    await reloadSimulationList();
}
