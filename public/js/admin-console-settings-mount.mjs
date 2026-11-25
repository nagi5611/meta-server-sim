// public/js/admin-console-settings-mount.mjs — CONSOLE デザイン内プラットフォーム設定（既存 API）
import { adminFetch } from './admin-api-fetch.js';
import { bootstrapAdminApi } from './admin-api-fetch-init.js';

/** @type {Record<string, string>} */
let envEdits = {};
/** @type {unknown} */
let envView = null;
/** @type {unknown} */
let networkView = null;

await bootstrapAdminApi();

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * @param {HTMLElement} body
 * @param {'env'|'network'|'fleet'} tab
 */
export async function renderPlatformSettingsTab(body, tab) {
    body.innerHTML = '<p class="hint">読込中…</p>';
    try {
        if (tab === 'env') {
            const res = await adminFetch('/admin/env-config');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            envView = await res.json();
            envEdits = {};
            const groups = envView.groups || [];
            body.innerHTML = `
              <div class="block">
                <div class="acts" style="margin-bottom:12px">
                  <button type="button" class="btn btn-primary btn-sm" data-ps-save-env>保存</button>
                </div>
                <p id="ps-env-status" class="hint"></p>
                ${groups
                    .map(
                        (g) => `<h3 style="margin:16px 0 8px;font-size:13px;color:var(--faint)">${esc(g.label || g.id)}</h3>
                    ${(g.items || [])
                        .map((item) => {
                            if (item.locked) {
                                return `<div class="field"><label>${esc(item.key)}</label><input class="inp" disabled value="${esc(item.masked ? '••••' : item.value)}" title="ロック済み"></div>`;
                            }
                            const v = envEdits[item.key] ?? (item.masked ? '' : item.value ?? '');
                            return `<div class="field"><label><code>${esc(item.key)}</code></label>
                              <input class="inp" data-env-key="${esc(item.key)}" value="${esc(v)}" ${item.masked ? 'placeholder="変更時のみ入力"' : ''}></div>`;
                        })
                        .join('')}`
                    )
                    .join('')}</div>`;
            body.querySelector('[data-ps-save-env]')?.addEventListener('click', () => void saveEnv(body));
            body.querySelectorAll('[data-env-key]').forEach((inp) => {
                inp.addEventListener('input', () => {
                    envEdits[inp.dataset.envKey] = inp.value;
                });
            });
            return;
        }
        if (tab === 'network') {
            const res = await adminFetch('/admin/network-config');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            networkView = await res.json();
            const json = JSON.stringify(networkView, null, 2);
            body.innerHTML = `
              <div class="block">
                <div class="acts" style="margin-bottom:12px">
                  <button type="button" class="btn btn-primary btn-sm" data-ps-save-net>保存</button>
                </div>
                <p class="hint"><code>network-config.json</code> を編集して保存します。</p>
                <textarea class="inp" id="ps-network-json" rows="22" style="width:100%;font-family:var(--mono,monospace);font-size:12px">${esc(json)}</textarea>
                <p id="ps-net-status" class="hint"></p>
              </div>`;
            body.querySelector('[data-ps-save-net]')?.addEventListener('click', () => void saveNetwork(body));
            return;
        }
        if (tab === 'fleet') {
            const res = await adminFetch('/admin/fleet');
            if (!res.ok) {
                body.innerHTML = '<p class="hint">未接続（Fleet ops 無効またはレジストリ空）</p>';
                return;
            }
            const j = await res.json();
            body.innerHTML = `<pre class="code" style="white-space:pre-wrap">${esc(JSON.stringify(j, null, 2))}</pre>`;
            return;
        }
        body.innerHTML = '<p class="hint">未接続</p>';
    } catch (e) {
        body.innerHTML = `<p class="hint">未接続（${esc(e instanceof Error ? e.message : e)}）</p>`;
    }
}

/**
 * @param {HTMLElement} body
 */
async function saveEnv(body) {
    const status = body.querySelector('#ps-env-status');
    const values = { ...envEdits };
    for (const group of envView?.groups || []) {
        for (const item of group.items || []) {
            if (item.locked || values[item.key] !== undefined) continue;
            if (!item.masked && item.value != null) values[item.key] = String(item.value);
        }
    }
    try {
        const res = await adminFetch('/admin/env-config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.errors?.join?.('\n') || `HTTP ${res.status}`);
        if (status) status.textContent = data.message || '保存しました';
        window.MT?.toast?.('環境設定を保存しました');
        await renderPlatformSettingsTab(body, 'env');
    } catch (e) {
        if (status) status.textContent = e instanceof Error ? e.message : String(e);
        window.MT?.toast?.('環境設定の保存に失敗しました');
    }
}

/**
 * @param {HTMLElement} body
 */
async function saveNetwork(body) {
    const status = body.querySelector('#ps-net-status');
    const ta = body.querySelector('#ps-network-json');
    if (!ta) return;
    try {
        const parsed = JSON.parse(ta.value);
        const res = await adminFetch('/admin/network-config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
        if (status) status.textContent = data.message || '保存しました';
        window.MT?.toast?.('ネットワーク設定を保存しました');
    } catch (e) {
        if (status) status.textContent = e instanceof Error ? e.message : String(e);
        window.MT?.toast?.('ネットワーク設定の保存に失敗しました');
    }
}

window.MTPlatformSettings = { renderPlatformSettingsTab };