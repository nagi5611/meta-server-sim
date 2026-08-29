// public/js/hub.js — プラットフォーム hub（tenant 一覧）
import 'bootstrap-icons/font/bootstrap-icons.css';
import { renderMetaversePortalNav } from './metaverse-portal-nav.js';

const statusEl = document.getElementById('hub-status');
const listEl = document.getElementById('tenant-list');

/**
 * ステータス行の表示クラスを更新する
 * @param {string} kind
 */
function setHubStatus(kind, text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.remove('is-error', 'is-empty');
    if (kind === 'error') statusEl.classList.add('is-error');
    if (kind === 'empty') statusEl.classList.add('is-empty');
}

renderMetaversePortalNav(document.getElementById('metaverse-portal-links')).then(() => {
    const nav = document.getElementById('metaverse-portal-nav');
    if (nav?.querySelector('.portal-nav-links a')) {
        nav.removeAttribute('hidden');
    }
});

try {
    const res = await fetch('/api/tenants');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const tenants = Array.isArray(data.tenants) ? data.tenants : [];

    if (!tenants.length) {
        setHubStatus('empty', '0 件');
        if (listEl) {
            listEl.replaceChildren();
            const li = document.createElement('li');
            li.className = 'hub-empty';
            li.textContent = 'tenant がありません。tenants/ に tenant.json を追加してください。';
            listEl.appendChild(li);
        }
    } else {
        setHubStatus('ok', `${tenants.length} 件`);
        if (listEl) {
            listEl.replaceChildren();
            for (const tenant of tenants) {
                const id = String(tenant.id || '').trim();
                const displayName = String(tenant.displayName || id).trim() || id;
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.className = 'hub-tenant-link';
                a.href = tenant.url || `/${id}/`;
                a.innerHTML = `
                    <span class="hub-tenant-name">${escapeHtml(displayName)}</span>
                    <span class="hub-tenant-id">${escapeHtml(id)}</span>
                    <i class="bi bi-box-arrow-up-right hub-tenant-icon" aria-hidden="true"></i>
                `;
                li.appendChild(a);
                listEl.appendChild(li);
            }
        }
    }
} catch (e) {
    setHubStatus('error', `読み込み失敗: ${e instanceof Error ? e.message : String(e)}`);
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
