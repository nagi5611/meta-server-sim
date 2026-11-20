// public/js/tenant-world-edit-aircraft.js — ワールド編集の飛行機 UI（sim 専用）
import { adminFetch } from './admin-api-fetch.js';

const BUILTIN_PREFAB = 'sim/builtin-aircraft';

/**
 * @param {string} tenantId
 * @returns {string}
 */
function adminAirframesBase(tenantId) {
    return `/admin/tenants/${encodeURIComponent(tenantId)}/addons/aircraft/airframes`;
}

/**
 * @param {string} tenantId
 */
function wireAutoAircraftId() {
    const typeSel = document.getElementById('obj-vehicle-type');
    const idEl = document.getElementById('obj-ac-id');
    if (!typeSel || !idEl || typeSel.dataset.simAircraftWired) return;
    typeSel.dataset.simAircraftWired = '1';
    typeSel.addEventListener('change', () => {
        if (typeSel.value !== 'airplane') return;
        if (!String(idEl.value || '').trim()) {
            idEl.value = `plane-${Date.now().toString(36)}`;
        }
        const lib = document.getElementById('obj-ac-library-id');
        if (lib && lib instanceof HTMLSelectElement && !lib.value && lib.options.length > 1) {
            lib.selectedIndex = 1;
        }
    });
}

/**
 * @param {string} tenantId
 */
function injectWorldEditCategoryNav() {
    const nav = document.querySelector('.we-category-nav');
    if (!nav || document.getElementById('we-cat-aircraft')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'we-category-btn';
    btn.dataset.weCategory = 'aircraft';
    btn.textContent = '飛行機';
    const fileBtn = nav.querySelector('[data-we-category="file"]');
    if (fileBtn) {
        nav.insertBefore(btn, fileBtn);
    } else {
        nav.appendChild(btn);
    }

    const left = document.querySelector('.we-left-content');
    if (!left) return;
    const pane = document.createElement('div');
    pane.id = 'we-cat-aircraft';
    pane.className = 'we-category-pane';
    pane.innerHTML = `
        <section class="section" id="sim-aircraft-tags-section">
            <h2 class="section-title">機体タグ（ライブラリ）</h2>
            <p class="hint">B787 / A320 などのタグと操縦パラメータを管理します。</p>
            <div class="btn-row" style="margin-bottom:8px;">
                <button type="button" id="sim-airframe-add" class="btn btn-sm btn-primary">タグを追加</button>
                <button type="button" id="sim-airframe-reload" class="btn btn-sm btn-secondary">再読み込み</button>
            </div>
            <div id="sim-airframe-list" class="model-list"></div>
            <details class="block" id="sim-airframe-editor" style="margin-top:12px;" open>
                <summary class="block-header">パラメータ編集</summary>
                <div class="block-content">
                    <div class="prop-row"><label class="prop-label" for="sim-af-id">タグ ID</label>
                    <input id="sim-af-id" class="prop-input" placeholder="B787" /></div>
                    <div class="prop-row"><label class="prop-label" for="sim-af-name">表示名</label>
                    <input id="sim-af-name" class="prop-input" /></div>
                    <div class="prop-row"><label class="prop-label" for="sim-af-mode">操縦モード</label>
                    <select id="sim-af-mode" class="prop-input"><option value="easy">easy</option><option value="hard">hard</option></select></div>
                    <div class="prop-row"><label class="prop-label" for="sim-af-max-spd">最大速度 (m/s, easy)</label>
                    <input id="sim-af-max-spd" type="number" class="prop-input num" step="1" /></div>
                    <div class="btn-row">
                        <button type="button" id="sim-airframe-save" class="btn btn-sm btn-primary">保存</button>
                        <button type="button" id="sim-airframe-delete" class="btn btn-sm btn-danger">削除</button>
                    </div>
                    <p id="sim-airframe-status" class="status-text" role="status"></p>
                </div>
            </details>
        </section>
        <section class="section" id="sim-aircraft-placed-section" style="margin-top:16px;">
            <h2 class="section-title">配置済み飛行機</h2>
            <p class="hint">選択中ワールドの <code>models[].aircraft</code> 一覧です。オブジェクトを選んで編集できます。</p>
            <div id="sim-placed-aircraft-list" class="model-list"></div>
        </section>
    `;
    left.appendChild(pane);

    nav.addEventListener('click', (e) => {
        const b = e.target.closest('.we-category-btn[data-we-category="aircraft"]');
        if (!b) return;
        document.querySelectorAll('.we-category-btn').forEach((el) => el.classList.remove('active'));
        document.querySelectorAll('.we-category-pane').forEach((el) => el.classList.remove('active'));
        b.classList.add('active');
        pane.classList.add('active');
    });
}

/**
 * @param {string} tenantId
 * @param {{ id: string, displayName?: string, controlMode?: string }[]} rows
 */
function renderAirframeList(rows) {
    const list = document.getElementById('sim-airframe-list');
    if (!list) return;
    list.innerHTML = '';
    for (const row of rows) {
        const div = document.createElement('div');
        div.className = 'model-list-item';
        div.innerHTML = `<strong>${row.id}</strong> — ${row.displayName || row.id} <span class="hint">(${row.controlMode || 'hard'})</span>`;
        div.style.cursor = 'pointer';
        div.addEventListener('click', () => selectAirframeEditor(row));
        list.appendChild(div);
    }
}

/**
 * @param {object} row
 */
function selectAirframeEditor(row) {
    const idEl = document.getElementById('sim-af-id');
    const nameEl = document.getElementById('sim-af-name');
    const modeEl = document.getElementById('sim-af-mode');
    if (idEl) idEl.value = row.id || '';
    if (nameEl) nameEl.value = row.displayName || '';
    if (modeEl) modeEl.value = row.controlMode === 'hard' ? 'hard' : 'easy';
}

/**
 * @param {string} tenantId
 * @param {() => Promise<void>|void} reloadPlaced
 */
async function loadAirframes(tenantId, reloadPlaced) {
    const res = await adminFetch(adminAirframesBase(tenantId));
    const data = await res.json().catch(() => ({}));
    const rows = (data.airframes || []).map((r) => ({
        id: r.id,
        displayName: r.displayName,
        controlMode: r.controlMode,
        prefabManifest: r.prefabManifest || BUILTIN_PREFAB,
    }));
    renderAirframeList(rows);
    if (reloadPlaced) await reloadPlaced();
}

/**
 * @param {string} tenantId
 */
function wireAirframeEditor(tenantId) {
    const status = document.getElementById('sim-airframe-status');
    const setStatus = (t) => {
        if (status) status.textContent = t;
    };

    document.getElementById('sim-airframe-reload')?.addEventListener('click', () => {
        void loadAirframes(tenantId, refreshPlacedAircraftList);
    });

    document.getElementById('sim-airframe-add')?.addEventListener('click', () => {
        const idEl = document.getElementById('sim-af-id');
        if (idEl) idEl.value = `TAG-${Date.now().toString(36)}`;
        const nameEl = document.getElementById('sim-af-name');
        if (nameEl) nameEl.value = '';
    });

    document.getElementById('sim-airframe-save')?.addEventListener('click', async () => {
        const id = String(document.getElementById('sim-af-id')?.value || '').trim();
        if (!id) {
            setStatus('タグ ID を入力してください');
            return;
        }
        const displayName = String(document.getElementById('sim-af-name')?.value || '').trim() || id;
        const controlMode = document.getElementById('sim-af-mode')?.value === 'hard' ? 'hard' : 'easy';
        const maxSpd = Number(document.getElementById('sim-af-max-spd')?.value);
        const body = {
            displayName,
            controlMode,
            prefabManifest: BUILTIN_PREFAB,
            flightPhysicsEasy: Number.isFinite(maxSpd) ? { maxThrustSpeed: maxSpd } : undefined,
        };
        const res = await adminFetch(`${adminAirframesBase(tenantId)}/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            setStatus(`保存失敗 (${res.status})`);
            return;
        }
        setStatus(`保存しました: ${id}`);
        await loadAirframes(tenantId, refreshPlacedAircraftList);
        const { refreshWorldsFromServer } = await import('@metaverse-simple/setting.js');
        await refreshWorldsFromServer();
    });

    document.getElementById('sim-airframe-delete')?.addEventListener('click', async () => {
        const id = String(document.getElementById('sim-af-id')?.value || '').trim();
        if (!id || !window.confirm(`タグ ${id} を削除しますか？`)) return;
        const res = await adminFetch(`${adminAirframesBase(tenantId)}/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
        setStatus(res.ok ? `削除: ${id}` : `削除失敗 (${res.status})`);
        await loadAirframes(tenantId, refreshPlacedAircraftList);
    });
}

/**
 * 配置済み機体一覧（setting.js の worlds キャッシュは直接触れないため DOM / 再 fetch）
 */
async function refreshPlacedAircraftList() {
    const list = document.getElementById('sim-placed-aircraft-list');
    if (!list) return;
    list.innerHTML = '<p class="hint">読み込み中…</p>';
    const tenantMatch = window.location.pathname.match(/\/admin\/tenant\/([^/]+)/);
    const tenantId = tenantMatch?.[1] ? decodeURIComponent(tenantMatch[1]) : '';
    if (!tenantId) return;
    const res = await adminFetch(`/admin/tenants/${encodeURIComponent(tenantId)}/worlds`);
    const worlds = await res.json();
    list.innerHTML = '';
    for (const [wid, w] of Object.entries(worlds || {})) {
        const models = Array.isArray(w?.models) ? w.models : [];
        models.forEach((m, idx) => {
            const ac = m?.aircraft;
            if (!ac?.id) return;
            const div = document.createElement('div');
            div.className = 'model-list-item';
            div.innerHTML = `<strong>${ac.id}</strong> @ ${wid} — タグ: ${ac.aircraftLibraryId || '—'} · idx ${idx}`;
            list.appendChild(div);
        });
    }
    if (!list.children.length) {
        list.innerHTML = '<p class="hint">飛行機はまだ配置されていません。</p>';
    }
}

/**
 * @param {string} tenantId
 */
export async function initTenantWorldEditAircraft(tenantId) {
    injectWorldEditCategoryNav();
    wireAutoAircraftId();
    wireAirframeEditor(tenantId);
    await loadAirframes(tenantId, refreshPlacedAircraftList);

    document.querySelector('.we-category-btn[data-we-category="aircraft"]')?.addEventListener('click', () => {
        void refreshPlacedAircraftList();
    });
}