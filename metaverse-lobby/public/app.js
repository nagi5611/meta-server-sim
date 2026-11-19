import { formatLobbyDate, formatLobbyLocalTime, parseLobbyInstant } from './lobby-time.js';

const POLL_MS = 10_000;
const $ = (s) => document.querySelector(s);
const t = (key, vars) => window.LobbyI18n?.t(key, vars) ?? key;
await window.LobbyI18n?.ready;

const grid = $('#world-grid');
const hint = $('#refresh-hint');
const annPanel = $('#announcements-panel');
const annList = $('#announcement-list');
const annEmpty = $('#announcement-empty');
/** @type {Array<{ id: string, title: string, body: string, createdAt?: string, updatedAt?: string }>} */
let announcements = [];
/** @type {Date | null} */
let lastListUpdatedAt = null;
const joinScrim = $('#join-scrim');
const authScrim = $('#auth-scrim');
const profileScrim = $('#profile-scrim');
const profileInput = $('#pName');
const displayInput = $('#display-name');
const joinCodeInput = $('#join-code');
const codeCount = $('#codeCount');

/** @type {Array<Record<string, unknown>>} */
let worlds = [];
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

function render() {
    if (!grid) return;
    grid.replaceChildren();
    for (const w of worlds) {
        const status = String(w.status || 'online');
        const off = status === 'maint';
        const st = statusInfo(status);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `card${off ? ' off' : ''}`;
        btn.setAttribute('role', 'listitem');
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.dataset.id = String(w.id);
        const thumb = w.thumbnailUrl
            ? `<img src="${escapeHtml(String(w.thumbnailUrl))}" alt="">`
            : `<span>${t('lobby.thumbPlaceholder')}</span>`;
        btn.innerHTML = `
        <div class="ph">
          <span class="badge ${st.cls}"><i></i>${st.txt}</span>
          ${thumb}
        </div>
        <div class="card-body">
          <div class="cb-txt">
            <div class="nm">${mqHTML(String(w.name || ''))}</div>
            <div class="meta">${off ? t('lobby.offlineMaint') : `<b class="num">${fmtNum(w.players)}</b>${t('admin.onlineSuffix')}`}</div>
          </div>
          <div class="cb-spark">
            ${sparkSVG(w, 56, 24, false, off)}
            <span class="lbl">24h</span>
          </div>
        </div>`;
        btn.addEventListener('click', () => {
            if (off) {
                showToast(t('toast.maintServer'));
                return;
            }
            openJoin(w);
        });
        grid.appendChild(btn);
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

function navigateToWorld(world, displayName) {
    const base = String(world.entryUrl || '/');
    const url = new URL(base, window.location.href);
    url.searchParams.set('displayName', displayName);
    localStorage.setItem('mnm.name', displayName);
    localStorage.setItem('lobbyDisplayName', displayName);
    void fetch('/api/join-events', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId: world.id, displayName, ok: true }),
    }).catch(() => {});
    window.location.href = url.toString();
}

function canViewWorld(world) {
    const audience = String(world?.audience || 'all');
    if (audience === 'all') return true;
    if (!authState.user) return false;
    if (audience === 'signed') return true;
    return authState.user.role === 'admin';
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

function renderAnnouncements() {
    if (!annPanel || !annList) return;
    const items = announcements.filter((a) => a.title);
    if (!items.length) {
        annPanel.hidden = true;
        if (annEmpty) annEmpty.hidden = true;
        annList.replaceChildren();
        return;
    }
    annPanel.hidden = false;
    if (annEmpty) annEmpty.hidden = true;
    annList.replaceChildren();
    for (const a of items) {
        const li = document.createElement('li');
        li.className = 'ann-item';

        const head = document.createElement('div');
        head.className = 'ann-head';
        const title = document.createElement('h3');
        title.className = 'ann-title';
        title.textContent = a.title;
        head.appendChild(title);
        const dateStr = announcementDateLabel(a);
        if (dateStr) {
            const timeEl = document.createElement('time');
            timeEl.className = 'ann-date';
            timeEl.dateTime = String(a.createdAt || a.updatedAt || '');
            timeEl.textContent = dateStr;
            head.appendChild(timeEl);
        }
        li.appendChild(head);
        annList.appendChild(li);
    }
}

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
        worlds = Array.isArray(data.metaverses) ? data.metaverses : [];
        if (annRes.ok) {
            const annData = await annRes.json();
            announcements = Array.isArray(annData.announcements) ? annData.announcements : [];
        } else {
            announcements = [];
        }
        render();
        renderAnnouncements();
        lastListUpdatedAt = parseLobbyInstant(data.updatedAt);
        paintRefreshHint(lastListUpdatedAt);
    } catch {
        if (hint) hint.textContent = t('common.refreshFailed');
        showToast(t('toast.listRefreshFail'));
    }
}

/* ---------- auth UI ---------- */
let authTab = authState.mode || 'login';

function syncAuthModal() {
    const signup = authTab === 'signup';
    $('#modalTitle').textContent = signup ? t('auth.signup') : t('auth.login');
    $('#fldName').hidden = !signup;
    $('#authSubmit').textContent = signup ? t('auth.submitSignup') : t('auth.submitLogin');
    $('#switchLead').textContent = signup ? t('auth.switchToLoginLead') : t('auth.switchToSignupLead');
    $('#switchTab').textContent = signup ? t('auth.switchToLogin') : t('auth.switchToSignup');
    $('#mPass').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
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
    saveDraft();
    authState.mode = authTab;
    saveAuthState();
    authScrim.classList.remove('on');
    authScrim.hidden = true;
}

function openProfileModal() {
    if (!authState.user?.name) return;
    const err = $('#profileErr');
    if (err) {
        err.textContent = '';
        err.classList.remove('on');
    }
    const dn = (localStorage.getItem('lobbyDisplayName') || authState.user.name).slice(0, 16);
    if (profileInput) {
        profileInput.value = dn;
        profileInput.classList.remove('bad');
    }
    const pc = $('#pCount');
    if (pc) pc.textContent = `${dn.length}/16`;
    profileScrim.hidden = false;
    profileScrim.classList.add('on');
    setTimeout(() => profileInput?.focus(), 60);
}

function hideProfileModal() {
    profileScrim.classList.remove('on');
    profileScrim.hidden = true;
}

function mapProfileApiError(data) {
    const code = data?.error;
    if (code === 'name_required') return t('auth.errNameRequired');
    if (code === 'invalid_name_chars') return t('join.errDisplayChars');
    if (code === 'name_too_long') return t('join.errDisplayRequired');
    if (code === 'unauthorized') return t('auth.errInvalid');
    return t('profile.errFailed');
}

function applyDisplayNameLocally(name) {
    const dn = name.slice(0, 16);
    localStorage.setItem('mnm.name', dn);
    localStorage.setItem('lobbyDisplayName', dn);
    if (authState.user) {
        authState.user = { ...authState.user, name: name.slice(0, 32) };
        saveAuthState();
        renderAuthHeader();
    }
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

function renderAuthHeader() {
    const guest = $('#hdrGuest');
    const userHdr = $('#hdrUser');
    if (authState.user?.name) {
        guest.style.display = 'none';
        userHdr.classList.add('on');
        $('#acctName').textContent = authState.user.name;
        $('#acctId').textContent = authState.user.handle;
        $('#avInitial').textContent = authState.user.name.slice(0, 1).toUpperCase();
    } else {
        userHdr.classList.remove('on');
        guest.style.display = 'flex';
    }
}

function signIn(user, opts = {}) {
    const name = String(user?.name || user?.displayName || '').trim().slice(0, 32);
    if (!name) return;
    const handle = user?.handle || handleTo(user?.username || name);
    authState.user = { name, handle, role: user?.role || 'member' };
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
    renderAuthHeader();
    refresh();
    showToast(t('toast.logoutOk'));
}

/* ---------- wire events ---------- */
$('#join-cancel')?.addEventListener('click', closeJoin);
joinScrim?.addEventListener('click', (ev) => {
    if (ev.target === joinScrim) closeJoin();
});

$('#join-go')?.addEventListener('click', () => {
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
    const btn = $('#join-go');
    btn.disabled = true;
    btn.textContent = t('join.connecting');
    setTimeout(() => {
        btn.disabled = false;
        btn.textContent = t('common.join');
        navigateToWorld(selected, v.value);
    }, 600);
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

$('#join-code-btn')?.addEventListener('click', () => {
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
    btn.textContent = t('join.lookingUp');
    setTimeout(() => {
        btn.disabled = false;
        btn.textContent = t('common.join');
        const hit = worlds.find((w) => String(w.joinCode || '').toUpperCase() === code);
        if (hit && hit.status === 'maint') {
            showToast(t('toast.maintByCode'));
            return;
        }
        if (hit) {
            openJoin(hit);
            return;
        }
        showToast(t('toast.codeNotFound', { code }));
    }, 500);
});

joinCodeInput?.addEventListener('input', () => {
    const v = joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
    joinCodeInput.value = v;
    if (codeCount) codeCount.textContent = `${v.length}/12`;
    joinCodeInput.classList.remove('bad');
    localStorage.setItem('mnm.code', v);
});

joinCodeInput?.addEventListener('keydown', (e) => {
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
    const signup = authTab === 'signup';
    const email = $('#mEmail').value.trim();
    const pass = $('#mPass').value;
    let displayName = '';
    if (signup) {
        displayName = $('#mName').value.trim();
        if (!displayName) return showErr(t('auth.errNameRequired'));
        if (!email) return showErr(t('auth.errEmailRequired'));
        if (pass.length < 4) return showErr(t('auth.errPassShort'));
    } else {
        if (!email) return showErr(t('auth.errUserRequired'));
        if (pass.length < 4) return showErr(t('auth.errPassShort'));
    }

    btn.disabled = true;
    btn.textContent = signup ? t('auth.signingUp') : t('auth.authenticating');
    try {
        const res = await fetch(signup ? '/api/auth/signup' : '/api/auth/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
                signup
                    ? { name: displayName, displayName, email, password: pass }
                    : { username: email, password: pass },
            ),
        });
        const data = await res.json();
        if (!res.ok) {
            return showErr(mapAuthApiError(data));
        }
        signIn(data.user);
        clearDraft();
        hideAuthModal();
        refresh();
    } catch {
        showErr(t('auth.errFailed'));
    } finally {
        btn.disabled = false;
        btn.textContent = signup ? t('auth.submitSignup') : t('auth.submitLogin');
    }
});

$('#logoutBtn')?.addEventListener('click', signOut);

$('#openProfile')?.addEventListener('click', openProfileModal);
$('#closeProfile')?.addEventListener('click', hideProfileModal);

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
        hideProfileModal();
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
    if (joinScrim?.classList.contains('on')) closeJoin();
    if (authScrim?.classList.contains('on')) hideAuthModal();
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

async function bootstrapAuth() {
    try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        const data = await res.json();
        if (data.user) signIn(data.user);
    } catch {
        /* guest */
    }
    renderAuthHeader();
}

window.addEventListener('lobby:locale-change', () => {
    window.LobbyI18n?.applyDom();
    syncAuthModal();
    refresh();
});

bootstrapAuth();
refresh();
setInterval(refresh, POLL_MS);
if (document.fonts) document.fonts.ready.then(() => initMarquees(document));