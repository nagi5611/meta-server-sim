// public/share-join-page.js — 共有 URL 参加ページ（/join/<tenantId>）
import { isLobbyEntryUrlAllowed } from './lobby-entry-url-policy.js';

const $ = (s) => document.querySelector(s);
const t = (key) => window.LobbyI18n?.t(key) ?? key;
if (window.LobbyI18n?.ready) {
    await window.LobbyI18n.ready;
} else if (document.readyState === 'loading') {
    await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
}

/**
 * @returns {string}
 */
function tenantIdFromPath() {
    const parts = window.location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const idx = parts.indexOf('join');
    if (idx < 0 || !parts[idx + 1]) return '';
    try {
        return decodeURIComponent(parts[idx + 1]).trim();
    } catch {
        return String(parts[idx + 1]).trim();
    }
}

function setMsg(text) {
    const el = $('#shareJoinMsg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('on', Boolean(text));
}

function setPending(pending) {
    const btn = $('#share-join-go');
    if (!btn) return;
    btn.disabled = pending;
    btn.classList.toggle('is-join-pending', pending);
    btn.setAttribute('aria-busy', pending ? 'true' : 'false');
}

function mapJoinError(data) {
    const code = String(data?.error || '');
    if (code === 'display_name_rejected') return data?.reason_ja || t('join.errDisplayRejected');
    if (code === 'invalid_name_chars') return t('join.errDisplayChars');
    if (code === 'name_too_long') return t('join.errDisplayRequired');
    if (code === 'maintenance') return t('toast.maintServer');
    return null;
}

/**
 * @param {string} tenantId
 */
async function loadWorld(tenantId) {
    const loading = $('#joinLoading');
    const card = $('#joinCard');
    const notFound = $('#joinNotFound');
    const maint = $('#joinMaint');
    try {
        const res = await fetch(`/api/share-join/${encodeURIComponent(tenantId)}`, {
            cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        loading.hidden = true;
        if (!res.ok || data.error === 'not_found') {
            notFound.hidden = false;
            return;
        }
        if (res.status === 503 || data.maintenance) {
            maint.hidden = false;
            return;
        }
        const title = $('#joinWorldName');
        if (title) title.textContent = String(data.worldName || tenantId);
        card.hidden = false;
        const input = $('#share-display-name');
        input?.focus();
    } catch {
        loading.hidden = true;
        notFound.hidden = false;
    }
}

async function submitJoin(tenantId) {
    const input = $('#share-display-name');
    const name = String(input?.value || '').trim();
    if (!name) {
        setMsg(t('join.errDisplayRequired'));
        input?.classList.add('bad');
        return;
    }
    if (name.length > 64) {
        setMsg(t('join.errDisplayRequired'));
        input?.classList.add('bad');
        return;
    }
    if (!/^[\p{L}\p{N}_\- ]+$/u.test(name)) {
        setMsg(t('join.errDisplayChars'));
        input?.classList.add('bad');
        return;
    }
    setMsg('');
    input?.classList.remove('bad');
    setPending(true);
    try {
        const res = await fetch(`/api/share-join/${encodeURIComponent(tenantId)}/join`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ displayName: name }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = mapJoinError(data);
            if (msg) {
                setMsg(msg);
                input?.classList.add('bad');
                return;
            }
            setMsg(t('common.refreshFailed'));
            return;
        }
        const target = data?.entryUrl;
        if (!target) {
            setMsg(t('common.refreshFailed'));
            return;
        }
        if (!isLobbyEntryUrlAllowed(String(target))) {
            setMsg(t('common.refreshFailed'));
            return;
        }
        const url = new URL(target, window.location.href);
        const ljdn = data?.displayJoinToken;
        if (ljdn) url.searchParams.set('ljdn', String(ljdn));
        const socketJoin = data?.socketJoinToken;
        if (socketJoin) url.searchParams.set('join', String(socketJoin));
        localStorage.setItem('mnm.name', name);
        localStorage.setItem('lobbyDisplayName', name);
        window.location.href = url.toString();
    } catch {
        setMsg(t('common.refreshFailed'));
    } finally {
        setPending(false);
    }
}

const tenantId = tenantIdFromPath();
if (!tenantId) {
    $('#joinLoading').hidden = true;
    $('#joinNotFound').hidden = false;
} else {
    void loadWorld(tenantId);
}

$('#share-display-name')?.addEventListener('input', (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    const n = el.value.length;
    const cnt = $('#shareNameCount');
    if (cnt) cnt.textContent = `${n}/64`;
});

$('#share-join-go')?.addEventListener('click', () => {
    if (tenantId) void submitJoin(tenantId);
});

$('#share-display-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#share-join-go')?.click();
});