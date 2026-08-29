// public/js/admin-fds-smoke-panel.js — FDS煙 ZIP アップロード・一覧・ワールド紐付け

const SIM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** @type {string | null} */
let activeTenantId = null;

/** @type {string | null} */
let selectedSimId = null;

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
 * 選択中ワールド表示を更新する
 */
function refreshSelectedWorldLabel() {
    const label = document.getElementById('fds-smoke-selected-world');
    if (!label) return;
    const worldId = getSelectedWorldIdFromDom();
    label.textContent = worldId ?? '（未選択）';
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
    const assignBtn = document.getElementById('fds-smoke-assign-btn');
    if (!listEl) return;

    listEl.innerHTML = '';
    if (simulations.length === 0) {
        listEl.innerHTML = '<p class="hint">登録済みシミュレーションはありません。</p>';
        if (assignBtn) assignBtn.disabled = true;
        selectedSimId = null;
        return;
    }

    for (const sim of simulations) {
        const row = document.createElement('div');
        row.className = 'item fds-smoke-sim-item' + (sim.id === selectedSimId ? ' selected' : '');
        row.dataset.simId = sim.id;
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');

        const meta = document.createElement('span');
        meta.className = 'fds-smoke-sim-meta';
        const multipartLabel = sim.multipart
            ? `マルチパート${sim.chunkIntervalSec != null ? ` (${sim.chunkIntervalSec}s)` : ''}`
            : '単一ファイル';
        meta.textContent = `${sim.quantity || '—'} · ${sim.frameCount} frames · ${multipartLabel}`;

        const title = document.createElement('strong');
        title.textContent = sim.id;

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-sm btn-outline-danger fds-smoke-delete-btn';
        delBtn.textContent = '削除';
        delBtn.dataset.simId = sim.id;

        row.append(title, meta, delBtn);
        listEl.appendChild(row);
    }

    if (assignBtn) {
        assignBtn.disabled = !selectedSimId || !getSelectedWorldIdFromDom();
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
        const form = new FormData();
        form.append('zip', file);
        form.append('simId', simId);
        const qs = confirmOverwrite ? '?confirm=1' : '';
        const res = await fetch(
            `/admin/tenants/${encodeURIComponent(activeTenantId)}/upload-fds-smoke-zip${qs}`,
            {
                method: 'POST',
                credentials: 'include',
                body: form,
            },
        );
        if (res.status === 409) {
            const data = await res.json().catch(() => ({}));
            const msg = data.message || `シミュレーション "${simId}" は既に存在します。上書きしますか？`;
            if (confirm(msg)) {
                return doUpload(true);
            }
            throw new Error('アップロードをキャンセルしました。');
        }
        if (!res.ok) {
            const text = await res.text();
            throw new Error(text || `HTTP ${res.status}`);
        }
        return res.json();
    };

    if (statusEl) {
        statusEl.textContent = 'アップロード中…';
        statusEl.className = '';
    }

    try {
        const result = await doUpload(false);
        if (statusEl) {
            statusEl.textContent = `アップロード完了: ${result.simId}`;
            statusEl.className = '';
        }
        simIdInput.value = result.simId ?? simId;
        selectedSimId = result.simId ?? simId;
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
    if (!activeTenantId) return;
    if (!confirm(`シミュレーション "${simId}" を削除しますか？`)) return;

    const statusEl = document.getElementById('fds-smoke-list-status');
    if (statusEl) {
        statusEl.textContent = '削除中…';
        statusEl.className = '';
    }

    try {
        const res = await fetch(
            `/admin/tenants/${encodeURIComponent(activeTenantId)}/simulations/${encodeURIComponent(simId)}`,
            { method: 'DELETE', credentials: 'include' },
        );
        if (!res.ok) {
            throw new Error(await res.text());
        }
        if (selectedSimId === simId) {
            selectedSimId = null;
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
 * 選択中ワールドに fdsSmokes エントリを追加して保存する
 */
async function handleAssignToWorld() {
    const statusEl = document.getElementById('fds-smoke-assign-status');
    const assignBtn = document.getElementById('fds-smoke-assign-btn');
    if (!activeTenantId || !selectedSimId) return;

    const worldId = getSelectedWorldIdFromDom();
    if (!worldId) {
        if (statusEl) {
            statusEl.textContent = 'ワールドを選択してください。';
            statusEl.className = 'error';
        }
        return;
    }

    const posX = Number(/** @type {HTMLInputElement} */ (document.getElementById('fds-smoke-pos-x'))?.value ?? 0);
    const posY = Number(/** @type {HTMLInputElement} */ (document.getElementById('fds-smoke-pos-y'))?.value ?? 0);
    const posZ = Number(/** @type {HTMLInputElement} */ (document.getElementById('fds-smoke-pos-z'))?.value ?? 0);
    const scale = Number(/** @type {HTMLInputElement} */ (document.getElementById('fds-smoke-scale'))?.value ?? 1);

    if (statusEl) {
        statusEl.textContent = '紐付けを保存中…';
        statusEl.className = '';
    }
    if (assignBtn) assignBtn.disabled = true;

    try {
        const worldsRes = await fetch(`/admin/tenants/${encodeURIComponent(activeTenantId)}/worlds`, {
            credentials: 'include',
        });
        if (!worldsRes.ok) {
            throw new Error(await worldsRes.text());
        }
        const worlds = await worldsRes.json();
        if (!worlds[worldId]) {
            throw new Error(`ワールド "${worldId}" が見つかりません。`);
        }

        const world = worlds[worldId];
        if (!Array.isArray(world.fdsSmokes)) {
            world.fdsSmokes = [];
        }

        const manifestPath = `simulations/${selectedSimId}/manifest.json`;
        const entryId = `${selectedSimId}-smoke`;
        const existing = world.fdsSmokes.find((e) => e.manifest === manifestPath || e.id === entryId);
        const entry = {
            id: entryId,
            manifest: manifestPath,
            position: { x: posX, y: posY, z: posZ },
            rotation: { x: 0, y: 0, z: 0 },
            scale: scale > 0 ? scale : 1,
            playback: {
                autoplay: false,
                startAtEnd: true,
                loop: false,
            },
        };

        if (existing) {
            Object.assign(existing, entry);
        } else {
            world.fdsSmokes.push(entry);
        }

        const saveRes = await fetch(`/admin/tenants/${encodeURIComponent(activeTenantId)}/worlds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(worlds),
        });
        if (!saveRes.ok) {
            throw new Error(await saveRes.text());
        }

        if (statusEl) {
            statusEl.textContent = `ワールド "${worldId}" に紐付けました。エディタを反映するにはページを再読み込みしてください。`;
            statusEl.className = '';
        }
    } catch (err) {
        if (statusEl) {
            statusEl.textContent = `紐付け失敗: ${err instanceof Error ? err.message : String(err)}`;
            statusEl.className = 'error';
        }
    } finally {
        if (assignBtn) {
            assignBtn.disabled = !selectedSimId || !getSelectedWorldIdFromDom();
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

        const item = /** @type {HTMLElement} */ (e.target).closest('.fds-smoke-sim-item');
        if (!item?.dataset.simId) return;
        selectedSimId = item.dataset.simId;
        document.querySelectorAll('.fds-smoke-sim-item').forEach((el) => {
            el.classList.toggle('selected', el.dataset.simId === selectedSimId);
        });
        const assignBtn = document.getElementById('fds-smoke-assign-btn');
        if (assignBtn) {
            assignBtn.disabled = !getSelectedWorldIdFromDom();
        }
    });

    document.getElementById('fds-smoke-assign-btn')?.addEventListener('click', () => {
        void handleAssignToWorld();
    });

    document.getElementById('world-list')?.addEventListener('click', () => {
        refreshSelectedWorldLabel();
        const assignBtn = document.getElementById('fds-smoke-assign-btn');
        if (assignBtn) {
            assignBtn.disabled = !selectedSimId || !getSelectedWorldIdFromDom();
        }
    });

    document.querySelector('.we-category-btn[data-we-category="fds-smoke"]')?.addEventListener('click', () => {
        refreshSelectedWorldLabel();
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
    refreshSelectedWorldLabel();
    await reloadSimulationList();
}
