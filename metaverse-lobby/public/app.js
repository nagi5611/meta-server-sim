import { formatLobbyDate, formatLobbyLocalTime, parseLobbyInstant } from './lobby-time.js';
import { cropProfileImageFile } from './profile-avatar.js';
import {
    ANN_PAGE_SIZE,
    announcementPageSlice,
    clampAnnouncementPage,
} from './lobby-announcements.js';

const POLL_MS = 10_000;
const $ = (s) => document.querySelector(s);
const t = (key, vars) => window.LobbyI18n?.t(key, vars) ?? key;
await window.LobbyI18n?.ready;

const grid = $('#world-grid');
const hint = $('#refresh-hint');
const annPanel = $('#announcements-panel');
const annList = $('#announcement-list');
const annEmpty = $('#announcement-empty');
const annPager = $('#announcement-pager');
const annPagerPrev = $('#ann-pager-prev');
const annPagerNext = $('#ann-pager-next');
const annPagerPages = $('#ann-pager-pages');
/** @type {Array<{ id: string, title: string, createdAt?: string, updatedAt?: string }>} */
let announcements = [];
let annPage = 0;
/** @type {Date | null} */
let lastListUpdatedAt = null;
const joinScrim = $('#join-scrim');
const authScrim = $('#auth-scrim');
const bannedScrim = $('#banned-scrim');
const profileMenu = $('#profileMenu');
const profileDrop = $('#profileDrop');
const profileInput = $('#pName');
const profileAvatarFile = $('#profileAvatarFile');
const profileAvatarPick = $('#profileAvatarPick');
const profileAvatarPreview = $('#profileAvatarPreview');
const profileAvatarPlaceholder = $('#profileAvatarPlaceholder');
let pendingAvatarBlob = null;
let pendingAvatarPreviewUrl = null;
const displayInput = $('#display-name');
const joinCodeInput = $('#join-code');
const codeCount = $('#codeCount');
const JOIN_CODE_MAX = 12;
/** @type {ReturnType<typeof setTimeout> | null} */
let joinCodeLimitHitTimer = null;

function getJoinCodeFields() {
    return joinCodeInput?.closest('.join-fields') ?? null;
}

function pulseJoinCodeLimitHit() {
    const fields = getJoinCodeFields();
    if (!fields) return;
    fields.classList.add('is-limit-hit');
    if (joinCodeLimitHitTimer != null) clearTimeout(joinCodeLimitHitTimer);
    joinCodeLimitHitTimer = setTimeout(() => {
        fields.classList.remove('is-limit-hit');
        joinCodeLimitHitTimer = null;
    }, 320);
}

function sanitizeJoinCodeRaw(raw) {
    return String(raw).toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

/** @param {KeyboardEvent} e */
function joinCodeRejectedKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const nav = new Set([
        'Backspace',
        'Delete',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'Tab',
        'Escape',
    ]);
    if (nav.has(e.key)) return false;
    if (e.key === 'Enter') return false;
    if (e.key.length !== 1) return false;
    const el = joinCodeInput;
    if (!el) return false;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const selected = Math.max(0, end - start);
    return el.value.length - selected + 1 > JOIN_CODE_MAX;
}

/** @type {Array<Record<string, unknown>>} */
let worlds = [];
/** @type {Set<string>} */
let favoriteWorldIds = new Set();
/** @type {string | null} */
let openCardMenuId = null;
const FAVORITES_LS_KEY = 'mnm.favorites';
let catalogBanned = false;
/** @type {Record<string, unknown> | null} */
let selected = null;
let toastTimer = null;

/** @type {{ mode: 'login'|'signup', draft: Record<string, Record<string, string>>, user: { name: string, handle: string } | null }} */
const authState = loadAuthState();

function loadAuthState() {
    try {
        const raw = JSON.parse(localStorage.getItem('mnm.auth') || 'null');
        if (raw?.user?.name) return raw;
    } catch {
        /* ignore */
    }
    return {
        mode: 'login',
        draft: {
            login: { email: '', pass: '' },
            signup: { name: '', email: '', pass: '' },
        },
        user: null,
    };
}

function saveAuthState() {
    localStorage.setItem('mnm.auth', JSON.stringify(authState));
}

function statusInfo(status) {
    const s = String(status || 'online');
    if (s === 'maint') return { txt: t('status.maint'), cls: 'maint' };
    if (s === 'live') return { txt: t('status.live'), cls: 'live' };
    if (s === 'degraded') return { txt: t('status.degraded'), cls: 'maint' };
    return { txt: t('status.online'), cls: '' };
}

function fmtNum(n) {
    return new Intl.NumberFormat('ja-JP').format(Number(n) || 0);
}

function showToast(msg) {
    const el = $('#toast');
    const txt = $('#toastTxt');
    if (!el || !txt) return;
    txt.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 2400);
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function mqHTML(text) {
    const t = escapeHtml(text);
    return `<span class="mq"><span class="mq-inner"><span class="mq-t">${t}</span></span></span>`;
}

function seriesOf(world) {
    const series = world?.series;
    return Array.isArray(series) && series.length ? series.slice(-24) : new Array(24).fill(0);
}

function sparkPath(data, w, h, pad = 1.5) {
    const max = Math.max(...data, 1);
    const step = (w - pad * 2) / (data.length - 1);
    const pts = data.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)]);
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const cx = (a[0] + b[0]) / 2;
        d += ` Q${cx.toFixed(1)},${a[1].toFixed(1)} ${cx.toFixed(1)},${((a[1] + b[1]) / 2).toFixed(1)}`;
        d += ` Q${cx.toFixed(1)},${b[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`;
    }
    const area = `${d} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;
    return { line: d, area, last: pts[pts.length - 1] };
}

function sparkSVG(series, w, h, dot, off) {
    const data = seriesOf({ series });
    if (data.every((v) => v === 0) || off) {
        return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><line x1="0" y1="${h - 1}" x2="${w}" y2="${h - 1}" stroke="#c9ced6" stroke-width="1" stroke-dasharray="3 3"/></svg>`;
    }
    const s = sparkPath(data, w, h);
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <path d="${s.area}" fill="rgba(31,157,85,.13)" stroke="none"/>
      <path d="${s.line}" fill="none" stroke="#1f9d55" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      ${dot ? `<circle cx="${s.last[0].toFixed(1)}" cy="${s.last[1].toFixed(1)}" r="2.2" fill="#1f9d55"/>` : ''}
    </svg>`;
}

let mqRaf = 0;
function initMarquees(root) {
    const scope = root || document;
    cancelAnimationFrame(mqRaf);
    mqRaf = requestAnimationFrame(() => {
        scope.querySelectorAll('.mq').forEach((mq) => {
            const inner = mq.querySelector('.mq-inner');
            const txt = inner?.querySelector('.mq-t');
            if (!inner || !txt) return;

            while (inner.children.length > 1) inner.lastElementChild.remove();
            if (mq._timer) {
                cancelAnimationFrame(mq._timer);
                mq._timer = 0;
            }

            const overflow = txt.scrollWidth - mq.clientWidth;
            const scrollable = overflow > 2 && mq.clientWidth > 0;
            mq.classList.toggle('is-scroll', scrollable);
            inner.style.transform = 'translateX(0px)';

            if (scrollable && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                const clone = txt.cloneNode(true);
                clone.setAttribute('aria-hidden', 'true');
                inner.appendChild(clone);
                const travel = txt.scrollWidth + 40;
                const speed = 34;
                const pause = 900;
                const t0 = performance.now();
                const step = (now) => {
                    const t = now - t0;
                    const move = (travel / speed) * 1000;
                    const cycle = move + pause * 2;
                    const p = t % cycle;
                    let x = 0;
                    if (p > pause) {
                        const m = Math.min(move, p - pause);
                        x = -(m / move) * travel;
                    }
                    inner.style.transform = `translateX(${x}px)`;
                    mq._timer = requestAnimationFrame(step);
                };
                mq._timer = requestAnimationFrame(step);
            }
        });
    });
}

function applyBannedCatalogState(showModal = false) {
    catalogBanned = true;
    worlds = [];
    if (authState.user) {
        authState.user = null;
        saveAuthState();
        renderAuthHeader();
    }
    render();
    if (showModal) showBannedModal();
}

function showBannedModal() {
    if (!bannedScrim) return;
    bannedScrim.hidden = false;
    bannedScrim.classList.add('on');
    setTimeout(() => $('#bannedOk')?.focus(), 60);
}

function closeBannedModal() {
    if (!bannedScrim) return;
    bannedScrim.classList.remove('on');
    bannedScrim.hidden = true;
}

function guardBannedJoin() {
    if (!catalogBanned) return false;
    showBannedModal();
    return true;
}

function favoritesMirrorKey() {
    return authState.user?.handle ? String(authState.user.handle) : '';
}

function mirrorFavoritesToLocalStorage(worldIds) {
    const handle = favoritesMirrorKey();
    if (!handle) return;
    try {
        localStorage.setItem(
            FAVORITES_LS_KEY,
            JSON.stringify({ handle, worldIds: [...worldIds], updatedAt: Date.now() }),
        );
    } catch {
        /* ignore */
    }
}

function loadFavoritesFromLocalStorageMirror() {
    const handle = favoritesMirrorKey();
    if (!handle) return;
    try {
        const raw = JSON.parse(localStorage.getItem(FAVORITES_LS_KEY) || 'null');
        if (!raw || raw.handle !== handle || !Array.isArray(raw.worldIds)) return;
        favoriteWorldIds = new Set(raw.worldIds.map((id) => String(id)));
    } catch {
        /* ignore */
    }
}

function applyFavoriteWorldIds(worldIds) {
    favoriteWorldIds = new Set((worldIds || []).map((id) => String(id)));
    mirrorFavoritesToLocalStorage(favoriteWorldIds);
}

function sortWorldsForGrid(list) {
    return list
        .map((w, index) => ({ w, index }))
        .sort((a, b) => {
            const af = favoriteWorldIds.has(String(a.w.id));
            const bf = favoriteWorldIds.has(String(b.w.id));
            if (af !== bf) return af ? -1 : 1;
            return a.index - b.index;
        })
        .map((row) => row.w);
}

function closeCardMenu() {
    openCardMenuId = null;
    grid?.querySelectorAll('.card-menu-wrap.is-open').forEach((el) => {
        el.classList.remove('is-open');
        const btn = el.querySelector('.card-menu-btn');
        const menu = el.querySelector('.card-menu');
        if (btn) btn.setAttribute('aria-expanded', 'false');
        if (menu) menu.hidden = true;
    });
}

function toggleCardMenu(worldId, wrap) {
    const id = String(worldId);
    if (openCardMenuId === id) {
        closeCardMenu();
        return;
    }
    closeCardMenu();
    openCardMenuId = id;
    wrap.classList.add('is-open');
    const btn = wrap.querySelector('.card-menu-btn');
    const menu = wrap.querySelector('.card-menu');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (menu) menu.hidden = false;
}

function isWorldFavorited(worldId) {
    return favoriteWorldIds.has(String(worldId));
}

async function syncFavoritesFromServer() {
    if (!authState.user?.name) {
        favoriteWorldIds = new Set();
        return;
    }
    loadFavoritesFromLocalStorageMirror();
    try {
        const res = await fetch('/api/favorites', { credentials: 'include', cache: 'no-store' });
        if (res.status === 401) {
            favoriteWorldIds = new Set();
            return;
        }
        if (!res.ok) return;
        const data = await res.json();
        applyFavoriteWorldIds(Array.isArray(data.worldIds) ? data.worldIds : []);
    } catch {
        /* keep mirror */
    }
}

async function toggleWorldFavorite(worldId) {
    if (!authState.user?.name) {
        closeCardMenu();
        openAuthModal();
        showToast(t('toast.favoriteLogin'));
        return false;
    }
    const id = String(worldId);
    try {
        const res = await fetch('/api/favorites/toggle', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ worldId: id }),
        });
        const data = await res.json();
        if (res.status === 401) {
            openAuthModal();
            showToast(t('toast.favoriteLogin'));
            return false;
        }
        if (!res.ok) {
            showToast(t('toast.favoriteFail'));
            return false;
        }
        applyFavoriteWorldIds(Array.isArray(data.worldIds) ? data.worldIds : []);
        showToast(data.favorite ? t('toast.favoriteAdded') : t('toast.favoriteRemoved'));
        return true;
    } catch {
        showToast(t('toast.favoriteFail'));
        return false;
    }
}

function render() {
    if (!grid) return;
    grid.replaceChildren();
    if (catalogBanned) return;
    closeCardMenu();
    for (const w of sortWorldsForGrid(worlds)) {
        const status = String(w.status || 'online');
        const off = status === 'maint';
        const st = statusInfo(status);
        const card = document.createElement('div');
        card.className = `card${off ? ' off' : ''}`;
        card.setAttribute('role', 'listitem');
        card.tabIndex = off ? -1 : 0;
        card.setAttribute('aria-haspopup', 'dialog');
        card.dataset.id = String(w.id);
        const thumb = w.thumbnailUrl
            ? `<img src="${escapeHtml(String(w.thumbnailUrl))}" alt="">`
            : `<div class="thumb-ph"><span>${t('lobby.thumbPlaceholder')}</span></div>`;
        const fav = isWorldFavorited(w.id);
        card.innerHTML = `
        <div class="ph">
          <span class="badge ${st.cls}"><i></i>${st.txt}</span>
          ${thumb}
        </div>
        <div class="card-body">
          <div class="cb-txt">
            <div class="nm">${mqHTML(String(w.name || ''))}</div>
            <div class="meta">${off ? t('lobby.offlineMaint') : `<b class="num">${fmtNum(w.players)}</b>${t('admin.onlineSuffix')}`}</div>
          </div>
          <div class="card-body-trail">
            <div class="cb-spark">
              ${sparkSVG(w, 56, 24, false, off)}
              <span class="lbl">24h</span>
            </div>
            <div class="card-menu-wrap">
              <button type="button" class="card-menu-btn" aria-label="${escapeHtml(t('favorites.menu'))}" aria-haspopup="menu" aria-expanded="false">⋯</button>
              <div class="card-menu" role="menu" hidden>
                <button type="button" role="menuitem" class="card-menu-item" data-favorite-action="toggle">${escapeHtml(fav ? t('favorites.remove') : t('favorites.add'))}</button>
              </div>
            </div>
          </div>
        </div>`;
        const openFromCard = () => {
            if (off) {
                showToast(t('toast.maintServer'));
                return;
            }
            openJoin(w);
        };
        card.addEventListener('click', (ev) => {
            if (ev.target.closest('.card-menu-wrap')) return;
            openFromCard();
        });
        card.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                if (ev.target.closest('.card-menu-wrap')) return;
                ev.preventDefault();
                openFromCard();
            }
        });
        const menuWrap = card.querySelector('.card-menu-wrap');
        const menuItem = card.querySelector('[data-favorite-action="toggle"]');
        card.querySelector('.card-menu-btn')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            toggleCardMenu(w.id, menuWrap);
        });
        menuItem?.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const changed = await toggleWorldFavorite(w.id);
            closeCardMenu();
            if (changed) render();
        });
        grid.appendChild(card);
    }
    initMarquees(grid);
}

function setJoinMsg(text) {
    const el = $('#jMsg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('on', Boolean(text));
}

function openJoin(world) {
    if (guardBannedJoin()) return;
    selected = world;
    const status = String(world.status || 'online');
    const st = statusInfo(status);
    const badge = $('#jStatus');
    if (badge) {
        badge.className = `badge ${st.cls}`;
        badge.innerHTML = `<i></i>${st.txt}`;
    }
    const jName = $('#jName');
    if (jName) {
        jName.innerHTML = mqHTML(String(world.name || ''));
        jName.title = String(world.name || '');
    }
    requestAnimationFrame(() => initMarquees($('#jName')));
    $('#jPlayers').textContent = fmtNum(world.players);
    $('#jDesc').textContent = String(world.description || '（説明は準備中です）');
    const jPh = $('#jPh');
    if (jPh) {
        if (world.thumbnailUrl) {
            jPh.innerHTML = `<img src="${escapeHtml(String(world.thumbnailUrl))}" alt="">`;
        } else {
            jPh.innerHTML = '<span>サムネ画像</span>';
        }
    }
    const sparkEl = $('#jSpark');
    if (sparkEl) {
        sparkEl.outerHTML = sparkSVG(world, 104, 34, true, status === 'maint')
            .replace('class="spark"', 'class="spark" id="jSpark"');
    }

    const saved =
        localStorage.getItem('mnm.name') ||
        localStorage.getItem('lobbyDisplayName') ||
        authState.user?.name?.slice(0, 16) ||
        '';
    displayInput.value = saved;
    $('#jCount').textContent = `${displayInput.value.length}/16`;
    displayInput.classList.remove('bad');
    setJoinMsg('');

    joinScrim.hidden = false;
    joinScrim.classList.add('on');
    setTimeout(() => displayInput.focus(), 80);
}

function closeJoin() {
    joinScrim.classList.remove('on');
    joinScrim.hidden = true;
    selected = null;
}

function validateName(name) {
    const n = String(name || '').trim();
    if (!n) return { ok: false, error: t('join.errDisplayRequired') };
    if (n.length > 16) return { ok: false, error: '16文字以内で入力してください' };
    if (!/^[\p{L}\p{N}_\- ]+$/u.test(n)) return { ok: false, error: t('join.errDisplayChars') };
    return { ok: true, value: n };
}

function mapJoinApiError(data) {
    const code = data?.error;
    if (code === 'display_name_rejected') {
        return data?.reason_ja || t('join.errDisplayRejected');
    }
    if (code === 'invalid_name_chars') return t('join.errDisplayChars');
    if (code === 'name_too_long') return t('join.errDisplayRequired');
    if (code === 'maintenance') return t('toast.maintServer');
    return null;
}

function setJoinGoPending(pending) {
    const btn = $('#join-go');
    if (!btn) return;
    btn.disabled = pending;
    btn.classList.toggle('is-join-pending', pending);
    btn.setAttribute('aria-busy', pending ? 'true' : 'false');
}

async function navigateToWorld(world, displayName) {
    let data;
    try {
        const res = await fetch('/api/join-world', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ worldId: world.id, displayName }),
        });
        data = await res.json().catch(() => ({}));
        if (res.status === 403 && data.error === 'banned') {
            applyBannedCatalogState(true);
            return;
        }
        if (!res.ok) {
            const joinMsg = mapJoinApiError(data);
            if (joinMsg) {
                setJoinMsg(joinMsg);
                displayInput?.classList.add('bad');
                displayInput?.focus();
                return;
            }
            showToast(t('toast.listRefreshFail'));
            return;
        }
    } catch {
        showToast(t('toast.listRefreshFail'));
        return;
    }

    const target = data?.entryUrl || world.entryUrl;
    const base = String(target || '/');
    const url = new URL(base, window.location.href);
    url.searchParams.set('displayName', displayName);
    localStorage.setItem('mnm.name', displayName);
    localStorage.setItem('lobbyDisplayName', displayName);
    window.location.href = url.toString();
}

function canViewWorld(world) {
    const audience = String(world?.audience || 'all');
    if (audience === 'all') return true;
    if (!authState.user) return false;
    if (audience === 'signed') return true;
    return isLobbyAdminUser();
}

function paintRefreshHint(at = lastListUpdatedAt) {
    if (!hint) return;
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) return;
    hint.textContent = `${t('common.updatePrefix')}${formatLobbyLocalTime(at)}`;
}

function announcementDateLabel(a) {
    const raw = a.createdAt || a.updatedAt;
    return raw ? formatLobbyDate(raw) : '';
}

function appendAnnouncementRow(a) {
    const li = document.createElement('li');
    li.className = 'ann-item';

    const head = document.createElement('div');
    head.className = 'ann-head';
    const dateStr = announcementDateLabel(a);
    if (dateStr) {
        const timeEl = document.createElement('time');
        timeEl.className = 'ann-date';
        timeEl.dateTime = String(a.createdAt || a.updatedAt || '');
        timeEl.textContent = dateStr;
        head.appendChild(timeEl);
    }
    const title = document.createElement('h3');
    title.className = 'ann-title';
    title.textContent = a.title;
    head.appendChild(title);
    li.appendChild(head);
    annList.appendChild(li);
}

/** @param {number} pageCount */
function buildAnnPagerTokens(pageCount) {
    if (pageCount <= 7) {
        return Array.from({ length: pageCount }, (_, i) => ({ type: 'page', index: i }));
    }
    const tokens = [{ type: 'page', index: 0 }];
    const left = Math.max(1, annPage - 1);
    const right = Math.min(pageCount - 2, annPage + 1);
    if (left > 1) tokens.push({ type: 'ellipsis' });
    for (let i = left; i <= right; i += 1) tokens.push({ type: 'page', index: i });
    if (right < pageCount - 2) tokens.push({ type: 'ellipsis' });
    tokens.push({ type: 'page', index: pageCount - 1 });
    return tokens;
}

function renderAnnouncementPager(pageCount) {
    if (!annPager || !annPagerPages || !annPagerPrev || !annPagerNext) return;
    if (pageCount <= 1) {
        annPager.hidden = true;
        annPagerPages.replaceChildren();
        return;
    }
    annPager.hidden = false;
    annPagerPrev.disabled = annPage <= 0;
    annPagerNext.disabled = annPage >= pageCount - 1;

    annPagerPages.replaceChildren();
    const useDots = pageCount > 7;
    for (const token of buildAnnPagerTokens(pageCount)) {
        if (token.type === 'ellipsis') {
            const span = document.createElement('span');
            span.className = 'ann-pager-ellipsis';
            span.setAttribute('aria-hidden', 'true');
            span.textContent = '…';
            annPagerPages.appendChild(span);
            continue;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        const current = token.index === annPage;
        btn.className = useDots ? 'ann-pager-dot' : 'ann-pager-num';
        btn.dataset.annPage = String(token.index);
        btn.setAttribute('aria-label', t('lobby.announcementsPageGoto', { page: token.index + 1 }));
        if (!useDots) btn.textContent = String(token.index + 1);
        if (current) btn.setAttribute('aria-current', 'page');
        annPagerPages.appendChild(btn);
    }
}

function renderAnnouncements() {
    if (!annPanel || !annList) return;
    const items = announcements.filter((a) => a.title);
    if (!items.length) {
        annPanel.hidden = true;
        if (annEmpty) annEmpty.hidden = true;
        if (annPager) annPager.hidden = true;
        annList.replaceChildren();
        annPage = 0;
        return;
    }
    const { pageIndex, pageCount, slice } = announcementPageSlice(items, annPage, ANN_PAGE_SIZE);
    annPage = pageIndex;

    annPanel.hidden = false;
    if (annEmpty) annEmpty.hidden = true;
    annList.replaceChildren();
    for (const a of slice) appendAnnouncementRow(a);
    renderAnnouncementPager(pageCount);
}

function setAnnouncementPage(nextPage) {
    const items = announcements.filter((a) => a.title);
    const pageCount = Math.ceil(items.length / ANN_PAGE_SIZE) || 0;
    annPage = clampAnnouncementPage(nextPage, pageCount);
    renderAnnouncements();
}

annPagerPrev?.addEventListener('click', () => setAnnouncementPage(annPage - 1));
annPagerNext?.addEventListener('click', () => setAnnouncementPage(annPage + 1));
annPagerPages?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ann-page]');
    if (!btn || !annPagerPages.contains(btn)) return;
    const page = Number(btn.dataset.annPage);
    if (!Number.isFinite(page)) return;
    setAnnouncementPage(page);
});

async function refresh() {
    try {
        const [metaRes, annRes] = await Promise.all([
            fetch('/api/metaverses', { cache: 'no-store', credentials: 'include' }),
            fetch(
                `/api/announcements?locale=${encodeURIComponent(window.LobbyI18n?.getLocale?.() || 'ja')}`,
                { cache: 'no-store' },
            ),
        ]);
        if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
        const data = await metaRes.json();
        if (data.banned) {
            applyBannedCatalogState(false);
        } else {
            catalogBanned = false;
            worlds = Array.isArray(data.metaverses) ? data.metaverses : [];
            render();
            lastListUpdatedAt = parseLobbyInstant(data.updatedAt);
            paintRefreshHint(lastListUpdatedAt);
        }
        if (annRes.ok) {
            const annData = await annRes.json();
            announcements = Array.isArray(annData.announcements) ? annData.announcements : [];
        } else {
            announcements = [];
        }
        renderAnnouncements();
    } catch {
        if (hint) hint.textContent = t('common.refreshFailed');
        showToast(t('toast.listRefreshFail'));
    }
}

/* ---------- auth UI ---------- */
let authTab = authState.mode || 'login';
let googleOAuthEnabled = false;

function syncAuthModal() {
    const googleComplete = authTab === 'google-complete';
    const signup = !googleComplete && authTab === 'signup';
    const lead = $('#authGoogleCompleteLead');
    const switchRow = $('#authSwitchRow');
    const emailFld = $('#mEmail')?.closest('.fld');
    const passFld = $('#mPass')?.closest('.fld');
    if (googleComplete) {
        $('#modalTitle').textContent = t('auth.googleCompleteTitle');
        if (lead) lead.hidden = false;
        $('#fldName').hidden = false;
        if (emailFld) emailFld.hidden = true;
        if (passFld) passFld.hidden = true;
        if (switchRow) switchRow.hidden = true;
        $('#authSubmit').textContent = t('auth.submitGoogleComplete');
    } else {
        $('#modalTitle').textContent = signup ? t('auth.signup') : t('auth.login');
        if (lead) lead.hidden = true;
        $('#fldName').hidden = !signup;
        if (emailFld) emailFld.hidden = false;
        if (passFld) passFld.hidden = false;
        if (switchRow) switchRow.hidden = false;
        $('#authSubmit').textContent = signup ? t('auth.submitSignup') : t('auth.submitLogin');
        $('#switchLead').textContent = signup ? t('auth.switchToLoginLead') : t('auth.switchToSignupLead');
        $('#switchTab').textContent = signup ? t('auth.switchToLogin') : t('auth.switchToSignup');
        $('#mPass').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
    }
    const block = $('#authGoogleBlock');
    const loginLink = $('#authGoogleLoginLink');
    if (block) block.hidden = googleComplete || !googleOAuthEnabled || !signup;
    if (loginLink) loginLink.hidden = googleComplete || !googleOAuthEnabled || signup;
}

function saveDraft() {
    const d = authState.draft[authTab];
    d.email = $('#mEmail').value;
    d.pass = $('#mPass').value;
    if (authTab === 'signup') d.name = $('#mName').value;
    saveAuthState();
}

function restoreDraft() {
    const d = authState.draft[authTab];
    $('#mEmail').value = d.email || '';
    $('#mPass').value = d.pass || '';
    $('#mName').value = d.name || '';
}

function clearDraft() {
    authState.draft[authTab] =
        authTab === 'signup' ? { name: '', email: '', pass: '' } : { email: '', pass: '' };
    saveAuthState();
}

function openAuthModal() {
    $('#authErr').textContent = '';
    $('#authErr').classList.remove('on');
    authTab = authState.mode || 'login';
    syncAuthModal();
    restoreDraft();
    authScrim.hidden = false;
    authScrim.classList.add('on');
    setTimeout(() => (authTab === 'signup' ? $('#mName') : $('#mEmail')).focus(), 60);
}

function hideAuthModal() {
    if (authTab !== 'google-complete') saveDraft();
    if (authTab !== 'google-complete') authState.mode = authTab;
    else authTab = authState.mode || 'login';
    saveAuthState();
    authScrim.classList.remove('on');
    authScrim.hidden = true;
    syncAuthModal();
}

async function openGoogleCompleteModal() {
    try {
        const res = await fetch('/api/auth/google/pending', { credentials: 'include' });
        const data = await res.json();
        if (!data?.pending) {
            showToast(t('auth.errGooglePending'));
            return;
        }
        authTab = 'google-complete';
        $('#authErr').textContent = '';
        $('#authErr').classList.remove('on');
        $('#mName').value = String(data.suggestedName || '').trim();
        $('#mEmail').value = '';
        $('#mPass').value = '';
        syncAuthModal();
        authScrim.hidden = false;
        authScrim.classList.add('on');
        setTimeout(() => $('#mName')?.focus(), 60);
    } catch {
        showToast(t('auth.errGoogle'));
    }
}

function clearPendingAvatar() {
    if (pendingAvatarPreviewUrl) {
        URL.revokeObjectURL(pendingAvatarPreviewUrl);
        pendingAvatarPreviewUrl = null;
    }
    pendingAvatarBlob = null;
}

function syncProfileAvatarPreview() {
    const url =
        pendingAvatarPreviewUrl ||
        (authState.user?.avatarUrl ? String(authState.user.avatarUrl) : '');
  const initial = authState.user?.name?.slice(0, 1).toUpperCase() || '?';
  if (profileAvatarPlaceholder) {
    profileAvatarPlaceholder.textContent = initial;
    profileAvatarPlaceholder.hidden = Boolean(url);
  }
  if (profileAvatarPreview) {
    if (url) {
      profileAvatarPreview.src = url;
      profileAvatarPreview.hidden = false;
    } else {
      profileAvatarPreview.removeAttribute('src');
      profileAvatarPreview.hidden = true;
    }
  }
}

function syncHeaderAvatar() {
  const url = authState.user?.avatarUrl ? String(authState.user.avatarUrl) : '';
  const initialEl = $('#avInitial');
  const imgEl = $('#avImg');
  const initial = authState.user?.name?.slice(0, 1).toUpperCase() || '?';
  if (initialEl) {
    initialEl.textContent = initial;
    initialEl.hidden = Boolean(url);
  }
  if (imgEl) {
    if (url) {
      imgEl.src = url;
      imgEl.hidden = false;
    } else {
      imgEl.removeAttribute('src');
      imgEl.hidden = true;
    }
  }
}

function populateProfileForm() {
  if (!authState.user?.name) return;
  const err = $('#profileErr');
  if (err) {
    err.textContent = '';
    err.classList.remove('on');
  }
  clearPendingAvatar();
  const dn = (localStorage.getItem('lobbyDisplayName') || authState.user.name).slice(0, 16);
  if (profileInput) {
    profileInput.value = dn;
    profileInput.classList.remove('bad');
  }
  const pc = $('#pCount');
  if (pc) pc.textContent = `${dn.length}/16`;
  syncProfileAvatarPreview();
}

function closeProfileDrop() {
  if (!profileDrop) return;
  profileDrop.hidden = true;
  profileMenu?.classList.remove('is-open');
  const trigger = $('#openProfile');
  trigger?.setAttribute('aria-expanded', 'false');
}

function toggleProfileDrop() {
  if (!authState.user?.name || !profileDrop) return;
  const isOpen = !profileDrop.hidden;
  if (isOpen) {
    closeProfileDrop();
    return;
  }
  populateProfileForm();
  profileDrop.hidden = false;
  profileMenu?.classList.add('is-open');
  const trigger = $('#openProfile');
  trigger?.setAttribute('aria-expanded', 'true');
  setTimeout(() => profileInput?.focus(), 40);
}

function mapProfileApiError(data) {
    const code = data?.error;
    if (code === 'name_required') return t('auth.errNameRequired');
    if (code === 'display_name_rejected') {
        return data?.reason_ja || t('join.errDisplayRejected');
    }
    if (code === 'invalid_name_chars') return t('join.errDisplayChars');
    if (code === 'name_too_long') return t('join.errDisplayRequired');
    if (code === 'unauthorized') return t('auth.errInvalid');
    if (code === 'invalid_type') return t('profile.errAvatarType');
    if (code === 'file_too_large' || code === 'empty_file') return t('profile.errAvatarLarge');
    if (code === 'file_required') return t('profile.errAvatar');
    return t('profile.errFailed');
}

function applyUserLocally(patch) {
    if (!authState.user) return;
    const next = { ...authState.user, ...patch };
    if (patch.name) {
        const dn = String(patch.name).slice(0, 16);
        localStorage.setItem('mnm.name', dn);
        localStorage.setItem('lobbyDisplayName', dn);
        next.name = String(patch.name).slice(0, 32);
    }
    authState.user = next;
    saveAuthState();
    renderAuthHeader();
}

function applyDisplayNameLocally(name) {
    applyUserLocally({ name });
    const dn = name.slice(0, 16);
    if (joinScrim.classList.contains('on') && displayInput) {
        displayInput.value = dn;
        const jc = $('#jCount');
        if (jc) jc.textContent = `${dn.length}/16`;
    }
}

function handleTo(name) {
    return `@${String(name)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, 16)}`;
}

function isLobbyAdminUser() {
    return authState.user?.role === 'admin';
}

function renderAuthHeader() {
    const guest = $('#hdrGuest');
    const userHdr = $('#hdrUser');
    const adminLink = $('#hdrAdminLink');
    if (authState.user?.name) {
        guest.style.display = 'none';
        userHdr.classList.add('on');
        $('#acctName').textContent = authState.user.name;
        $('#acctId').textContent = authState.user.handle;
        syncHeaderAvatar();
        if (adminLink) adminLink.hidden = !isLobbyAdminUser();
    } else {
        userHdr.classList.remove('on');
        guest.style.display = 'flex';
        if (adminLink) adminLink.hidden = true;
    }
}

function signIn(user, opts = {}) {
    const name = String(user?.name || user?.displayName || '').trim().slice(0, 32);
    if (!name) return;
    const handle = user?.handle || handleTo(user?.username || name);
    const avatarUrl =
        user?.avatarUrl !== undefined
            ? String(user.avatarUrl || '')
            : authState.user?.avatarUrl || '';
    authState.user = {
        name,
        handle,
        role: user?.role || 'member',
        ...(avatarUrl ? { avatarUrl } : {}),
    };
    saveAuthState();
    renderAuthHeader();
    const dn = name.slice(0, 16);
    const syncName = opts.syncDisplayName || !localStorage.getItem('mnm.name');
    if (syncName) {
        localStorage.setItem('mnm.name', dn);
        localStorage.setItem('lobbyDisplayName', dn);
        if (joinScrim.classList.contains('on') && displayInput) {
            displayInput.value = dn;
            $('#jCount').textContent = `${dn.length}/16`;
        }
    }
    if (!opts.quiet) showToast(t('toast.loginOk'));
}

async function signOut() {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
        /* ignore */
    }
    authState.user = null;
    saveAuthState();
    favoriteWorldIds = new Set();
    renderAuthHeader();
    await refresh();
    showToast(t('toast.logoutOk'));
}

/* ---------- wire events ---------- */
$('#join-cancel')?.addEventListener('click', closeJoin);
joinScrim?.addEventListener('click', (ev) => {
    if (ev.target === joinScrim) closeJoin();
});
$('#bannedClose')?.addEventListener('click', closeBannedModal);
$('#bannedOk')?.addEventListener('click', closeBannedModal);
bannedScrim?.addEventListener('click', (ev) => {
    if (ev.target === bannedScrim) closeBannedModal();
});

$('#join-go')?.addEventListener('click', async () => {
    if (guardBannedJoin()) return;
    if (!selected) return;
    const v = validateName(displayInput.value);
    if (!v.ok) {
        displayInput.classList.add('bad');
        setJoinMsg(v.error);
        displayInput.focus();
        return;
    }
    displayInput.classList.remove('bad');
    setJoinMsg('');
    setJoinGoPending(true);
    try {
        await navigateToWorld(selected, v.value);
    } finally {
        setJoinGoPending(false);
    }
});

displayInput?.addEventListener('input', () => {
    displayInput.classList.remove('bad');
    setJoinMsg('');
    $('#jCount').textContent = `${displayInput.value.length}/16`;
    localStorage.setItem('mnm.name', displayInput.value);
});

displayInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#join-go')?.click();
});

$('#join-code-btn')?.addEventListener('click', async () => {
    if (guardBannedJoin()) return;
    const code = String(joinCodeInput?.value || '')
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '')
        .slice(0, 12);
    if (code.length < 6) {
        joinCodeInput?.classList.add('bad');
        showToast(t('toast.codeShort'));
        joinCodeInput?.focus();
        return;
    }
    joinCodeInput?.classList.remove('bad');
    const btn = $('#join-code-btn');
    btn.disabled = true;
    const prevLabel = btn.textContent;
    btn.textContent = t('join.lookingUp');
    try {
        const res = await fetch('/api/join-by-code', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (res.status === 403 && data.error === 'banned') {
            applyBannedCatalogState(true);
            return;
        }
        if (!res.ok) {
            showToast(t('toast.codeNotFound', { code }));
            return;
        }
        const hit = data.world;
        if (!hit) {
            showToast(t('toast.codeNotFound', { code }));
            return;
        }
        if (hit.status === 'maint') {
            showToast(t('toast.maintByCode'));
            return;
        }
        openJoin(hit);
    } catch {
        showToast(t('toast.listRefreshFail'));
    } finally {
        btn.disabled = false;
        btn.textContent = prevLabel || t('common.join');
    }
});

joinCodeInput?.addEventListener('input', () => {
    const sanitized = sanitizeJoinCodeRaw(joinCodeInput.value);
    if (sanitized.length > JOIN_CODE_MAX) pulseJoinCodeLimitHit();
    const v = sanitized.slice(0, JOIN_CODE_MAX);
    joinCodeInput.value = v;
    if (codeCount) codeCount.textContent = `${v.length}/${JOIN_CODE_MAX}`;
    joinCodeInput.classList.remove('bad');
    localStorage.setItem('mnm.code', v);
});

joinCodeInput?.addEventListener('paste', (e) => {
    const paste = e.clipboardData?.getData('text') ?? '';
    const el = joinCodeInput;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const merged = sanitizeJoinCodeRaw(el.value.slice(0, start) + paste + el.value.slice(end));
    if (merged.length > JOIN_CODE_MAX) pulseJoinCodeLimitHit();
});

joinCodeInput?.addEventListener('keydown', (e) => {
    if (joinCodeRejectedKey(e)) {
        e.preventDefault();
        pulseJoinCodeLimitHit();
        return;
    }
    if (e.key === 'Enter') $('#join-code-btn')?.click();
});

$('#openLogin')?.addEventListener('click', openAuthModal);
$('#closeModal')?.addEventListener('click', hideAuthModal);
['#mName', '#mEmail', '#mPass'].forEach((sel) => {
    $(sel)?.addEventListener('input', saveDraft);
});

$('#switchTab')?.addEventListener('click', () => {
    saveDraft();
    authTab = authTab === 'login' ? 'signup' : 'login';
    authState.mode = authTab;
    $('#authErr').classList.remove('on');
    syncAuthModal();
    restoreDraft();
    setTimeout(() => (authTab === 'signup' ? $('#mName') : $('#mEmail')).focus(), 40);
});

function mapAuthApiError(data) {
    const code = data?.error;
    if (code === 'banned') return t('auth.errBanned');
    if (code === 'invalid_email') return t('auth.errEmailInvalid');
    if (code === 'email_exists') return t('auth.errEmailExists');
    if (code === 'name_required') return t('auth.errNameRequired');
    if (code === 'google_pending_missing' || code === 'google_pending_invalid') {
        return t('auth.errGooglePending');
    }
    if (code === 'google_pending_stale') return t('auth.errGooglePendingStale');
    if (code === 'display_name_rejected') {
        return data?.reason_ja || t('join.errDisplayRejected');
    }
    if (code === 'password_too_short' || code === 'password_invalid') {
        return t('auth.errPassMin', { min: data.minLength || 8 });
    }
    if (code === 'invalid_credentials') return t('auth.errInvalid');
    return t('auth.errFailed');
}

$('#authForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#authErr');
    const showErr = (msg) => {
        err.textContent = msg;
        err.classList.add('on');
    };
    const btn = $('#authSubmit');
    const googleComplete = authTab === 'google-complete';
    const signup = authTab === 'signup';
    const email = $('#mEmail').value.trim();
    const pass = $('#mPass').value;
    let displayName = '';
    if (googleComplete) {
        displayName = $('#mName').value.trim();
        if (!displayName) return showErr(t('auth.errNameRequired'));
    } else if (signup) {
        displayName = $('#mName').value.trim();
        if (!displayName) return showErr(t('auth.errNameRequired'));
        if (!email) return showErr(t('auth.errEmailRequired'));
        if (pass.length < 4) return showErr(t('auth.errPassShort'));
    } else {
        if (!email) return showErr(t('auth.errUserRequired'));
        if (pass.length < 4) return showErr(t('auth.errPassShort'));
    }

    btn.disabled = true;
    btn.textContent = googleComplete
        ? t('auth.completingGoogle')
        : signup
          ? t('auth.signingUp')
          : t('auth.authenticating');
    try {
        const res = await fetch(
            googleComplete
                ? '/api/auth/google/complete'
                : signup
                  ? '/api/auth/signup'
                  : '/api/auth/login',
            {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(
                    googleComplete
                        ? { name: displayName, displayName }
                        : signup
                          ? { name: displayName, displayName, email, password: pass }
                          : { username: email, password: pass },
                ),
            },
        );
        const data = await res.json();
        if (!res.ok) {
            return showErr(mapAuthApiError(data));
        }
        signIn(data.user);
        if (!googleComplete) clearDraft();
        authTab = 'login';
        authState.mode = 'login';
        hideAuthModal();
        await syncFavoritesFromServer();
        refresh();
    } catch {
        showErr(t('auth.errFailed'));
    } finally {
        btn.disabled = false;
        syncAuthModal();
    }
});

$('#logoutBtn')?.addEventListener('click', signOut);
$('#hdrAdminLink')?.addEventListener('click', async (ev) => {
    if (!isLobbyAdminUser()) return;
    ev.preventDefault();
    try {
        await fetch('/api/admin/bootstrap-from-lobby', { method: 'POST', credentials: 'include' });
    } catch {
        /* admin login gate still available */
    }
    window.location.assign('/admin/');
});

$('#openProfile')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleProfileDrop();
});

document.addEventListener('click', (ev) => {
    const target = /** @type {HTMLElement} */ (ev.target);
    if (profileDrop && !profileDrop.hidden) {
        if (!target.closest?.('#profileMenu')) closeProfileDrop();
    }
    if (openCardMenuId && !target.closest?.('.card-menu-wrap')) closeCardMenu();
});

profileAvatarPick?.addEventListener('click', () => profileAvatarFile?.click());

profileAvatarFile?.addEventListener('change', async () => {
    const file = profileAvatarFile.files?.[0];
    profileAvatarFile.value = '';
    if (!file) return;
    const err = $('#profileErr');
    const showErr = (msg) => {
        if (!err) return;
        err.textContent = msg;
        err.classList.add('on');
    };
    try {
        if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
            return showErr(t('profile.errAvatarType'));
        }
        if (file.size > 8 * 1024 * 1024) {
            return showErr(t('profile.errAvatarLarge'));
        }
        err?.classList.remove('on');
        if (err) err.textContent = '';
        const blob = await cropProfileImageFile(file);
        clearPendingAvatar();
        pendingAvatarBlob = blob;
        pendingAvatarPreviewUrl = URL.createObjectURL(blob);
        syncProfileAvatarPreview();
    } catch {
        showErr(t('profile.errAvatar'));
    }
});

profileInput?.addEventListener('input', () => {
    profileInput.classList.remove('bad');
    const err = $('#profileErr');
    if (err) {
        err.textContent = '';
        err.classList.remove('on');
    }
    const pc = $('#pCount');
    if (pc) pc.textContent = `${profileInput.value.length}/16`;
});

$('#profileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#profileErr');
    const showErr = (msg) => {
        if (!err) return;
        err.textContent = msg;
        err.classList.add('on');
    };
    const v = validateName(profileInput?.value || '');
    if (!v.ok) {
        profileInput?.classList.add('bad');
        return showErr(v.error);
    }
    profileInput?.classList.remove('bad');
    const btn = $('#profileSubmit');
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = t('profile.saving');
    try {
        if (pendingAvatarBlob) {
            const fd = new FormData();
            fd.append('file', pendingAvatarBlob, 'avatar.webp');
            const up = await fetch('/api/auth/profile/avatar', {
                method: 'POST',
                credentials: 'include',
                body: fd,
            });
            const upData = await up.json();
            if (!up.ok) return showErr(mapProfileApiError(upData));
            if (upData.user) {
                signIn(upData.user, { quiet: true, syncDisplayName: false });
            } else if (upData.avatarUrl) {
                applyUserLocally({ avatarUrl: upData.avatarUrl });
            }
            clearPendingAvatar();
        }
        const res = await fetch('/api/auth/profile', {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ displayName: v.value }),
        });
        const data = await res.json();
        if (!res.ok) return showErr(mapProfileApiError(data));
        if (data.user) signIn(data.user, { quiet: true, syncDisplayName: true });
        else applyDisplayNameLocally(v.value);
        closeProfileDrop();
        showToast(t('toast.profileOk'));
    } catch {
        showErr(t('profile.errFailed'));
    } finally {
        btn.disabled = false;
        btn.textContent = prev;
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (bannedScrim?.classList.contains('on')) closeBannedModal();
    if (joinScrim?.classList.contains('on')) closeJoin();
    if (authScrim?.classList.contains('on')) hideAuthModal();
    if (profileDrop && !profileDrop.hidden) closeProfileDrop();
    if (openCardMenuId) closeCardMenu();
});

let mqTimer;
window.addEventListener('resize', () => {
    clearTimeout(mqTimer);
    mqTimer = setTimeout(() => initMarquees(document), 150);
});

const savedCode = localStorage.getItem('mnm.code') || '';
if (joinCodeInput) {
    joinCodeInput.value = savedCode;
    if (codeCount) codeCount.textContent = `${savedCode.length}/12`;
}

function mapGoogleAuthQueryError(code) {
    const c = String(code || '');
    if (c === 'banned') return t('auth.errBanned');
    if (c === 'email_exists' || c === 'google_sub_mismatch') return t('auth.errEmailExists');
    if (c === 'display_name_rejected') return t('join.errDisplayRejected');
    if (c === 'email_not_verified') return t('auth.errGoogleEmailUnverified');
    return t('auth.errGoogle');
}

async function handleGoogleAuthReturn() {
    const params = new URLSearchParams(window.location.search);
    const complete = params.get('google_complete');
    const mode = params.get('google_auth');
    if (!mode && !complete) return;
    const clean = new URL(window.location.href);
    clean.searchParams.delete('google_auth');
    clean.searchParams.delete('google_error');
    clean.searchParams.delete('google_complete');
    window.history.replaceState({}, '', clean.pathname + clean.search + clean.hash);
    if (complete === '1') {
        await openGoogleCompleteModal();
        return;
    }
    if (mode === 'ok') {
        try {
            const res = await fetch('/api/auth/me', { credentials: 'include' });
            const data = await res.json();
            if (data.banned) {
                applyBannedCatalogState(true);
                return;
            }
            if (data.user) {
                signIn(data.user);
                await syncFavoritesFromServer();
                refresh();
            }
        } catch {
            showToast(t('auth.errGoogle'));
        }
        return;
    }
    if (mode === 'error') {
        showToast(mapGoogleAuthQueryError(params.get('google_error')));
    }
}

async function loadGoogleOAuthStatus() {
    try {
        const res = await fetch('/api/auth/google/status');
        const data = await res.json();
        googleOAuthEnabled = Boolean(data?.enabled);
    } catch {
        googleOAuthEnabled = false;
    }
    syncAuthModal();
}

async function bootstrapAuth() {
    await loadGoogleOAuthStatus();
    await handleGoogleAuthReturn();
    try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        const data = await res.json();
        if (data.banned) {
            applyBannedCatalogState(true);
            return;
        }
        catalogBanned = false;
        if (data.user) {
            signIn(data.user, { quiet: true });
            await syncFavoritesFromServer();
        }
    } catch {
        /* guest */
    }
    renderAuthHeader();
}

window.addEventListener('lobby:locale-change', () => {
    window.LobbyI18n?.applyDom();
    syncAuthModal();
    refresh();
    if (profileDrop && !profileDrop.hidden) populateProfileForm();
});

bootstrapAuth().then(() => refresh());
setInterval(refresh, POLL_MS);
if (document.fonts) document.fonts.ready.then(() => initMarquees(document));