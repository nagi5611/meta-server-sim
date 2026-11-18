const POLL_MS = 10_000;
const $ = (s) => document.querySelector(s);

const grid = $('#world-grid');
const hint = $('#refresh-hint');
const joinScrim = $('#join-scrim');
const authScrim = $('#auth-scrim');
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
    if (s === 'maint') return { txt: 'メンテナンス', cls: 'maint' };
    if (s === 'live') return { txt: 'イベント中', cls: 'live' };
    if (s === 'degraded') return { txt: '診断中', cls: 'maint' };
    return { txt: '稼働中', cls: '' };
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
            : '<span>サムネ画像</span>';
        btn.innerHTML = `
        <div class="ph">
          <span class="badge ${st.cls}"><i></i>${st.txt}</span>
          ${thumb}
        </div>
        <div class="card-body">
          <div class="cb-txt">
            <div class="nm">${mqHTML(String(w.name || ''))}</div>
            <div class="meta">${off ? '接続停止中' : `<b class="num">${fmtNum(w.players)}</b> 人オンライン`}</div>
          </div>
          <div class="cb-spark">
            ${sparkSVG(w, 56, 24, false, off)}
            <span class="lbl">24h</span>
          </div>
        </div>`;
        btn.addEventListener('click', () => {
            if (off) {
                showToast('このサーバーはメンテナンス中です');
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
            jPh.innerHTML = `<img src="${escapeHtml(String(world.thumbnailUrl))}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`;
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
    if (!n) return { ok: false, error: '表示名を入力してください' };
    if (n.length > 16) return { ok: false, error: '16文字以内で入力してください' };
    if (!/^[\p{L}\p{N}_\- ]+$/u.test(n)) return { ok: false, error: '使用できない文字が含まれています' };
    return { ok: true, value: n };
}

function navigateToWorld(world, displayName) {
    const base = String(world.entryUrl || '/');
    const url = new URL(base, window.location.href);
    url.searchParams.set('displayName', displayName);
    localStorage.setItem('mnm.name', displayName);
    localStorage.setItem('lobbyDisplayName', displayName);
    window.location.href = url.toString();
}

async function refresh() {
    try {
        const res = await fetch('/api/metaverses', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        worlds = Array.isArray(data.metaverses) ? data.metaverses : [];
        render();
        if (hint) {
            const t = data.updatedAt ? new Date(data.updatedAt) : new Date();
            hint.textContent = `更新 ${t.toLocaleTimeString('ja-JP')}`;
        }
    } catch {
        if (hint) hint.textContent = '取得失敗';
        showToast('一覧の更新に失敗しました');
    }
}

/* ---------- auth UI ---------- */
let authTab = authState.mode || 'login';

function syncAuthModal() {
    const signup = authTab === 'signup';
    $('#modalTitle').textContent = signup ? '新規登録' : 'ログイン';
    $('#fldName').hidden = !signup;
    $('#authSubmit').textContent = signup ? '登録してはじめる' : 'ログイン';
    $('#switchLead').textContent = signup ? 'アカウントをお持ちの方は' : 'アカウントをお持ちでない方は';
    $('#switchTab').textContent = signup ? 'ログインへ' : '新規登録';
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

function signIn(displayName) {
    const name = String(displayName || '').trim().slice(0, 32);
    if (!name) return;
    authState.user = { name, handle: handleTo(name) };
    saveAuthState();
    renderAuthHeader();
    const dn = name.slice(0, 16);
    if (!localStorage.getItem('mnm.name')) {
        localStorage.setItem('mnm.name', dn);
        localStorage.setItem('lobbyDisplayName', dn);
        if (joinScrim.classList.contains('on') && displayInput) {
            displayInput.value = dn;
            $('#jCount').textContent = `${dn.length}/16`;
        }
    }
    showToast('ログインしました。表示名を同期しました');
}

function signOut() {
    authState.user = null;
    saveAuthState();
    renderAuthHeader();
    showToast('ログアウトしました');
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
    btn.textContent = '接続中…';
    setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '参加';
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
        showToast('参加コードは6文字以上で入力してください');
        joinCodeInput?.focus();
        return;
    }
    joinCodeInput?.classList.remove('bad');
    const btn = $('#join-code-btn');
    btn.disabled = true;
    btn.textContent = '照合中…';
    setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '参加';
        const hit = worlds.find((w) => String(w.joinCode || '').toUpperCase() === code);
        if (hit && hit.status === 'maint') {
            showToast('このコードのサーバーはメンテナンス中です');
            return;
        }
        if (hit) {
            openJoin(hit);
            return;
        }
        openJoin({
            id: `code-${code}`,
            name: `参加コード ${code}`,
            players: 0,
            capacity: 800,
            status: 'online',
            description:
                '招待コードで接続するプライベートワールド。主催者が設定した定員と公開範囲に従います。',
            joinCode: code,
            entryUrl: `https://sim.mmh-virtual.jp/${code.replace(/[^A-Z0-9]/g, '').replace(/^P/, 'P-')}/`,
        });
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
authScrim?.addEventListener('click', (e) => {
    if (e.target === authScrim) hideAuthModal();
});
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

$('#authForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const uname = $('#mName').value.trim();
    const email = $('#mEmail').value.trim();
    const pass = $('#mPass').value;
    const err = $('#authErr');
    const showErr = (t) => {
        err.textContent = t;
        err.classList.add('on');
    };

    if (authTab === 'signup' && uname.length < 2) return showErr('ユーザー名は2文字以上で入力してください');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showErr('メールアドレスの形式が正しくありません');
    if (pass.length < 4) return showErr('パスワードは4文字以上で入力してください');

    const btn = $('#authSubmit');
    btn.disabled = true;
    btn.textContent = authTab === 'signup' ? '作成中…' : '認証中…';
    setTimeout(() => {
        const name = authTab === 'signup' ? uname : email.split('@')[0] || 'user';
        signIn(name);
        clearDraft();
        btn.disabled = false;
        syncAuthModal();
        hideAuthModal();
    }, 600);
});

$('#logoutBtn')?.addEventListener('click', signOut);

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (joinScrim?.classList.contains('on')) closeJoin();
    else if (authScrim?.classList.contains('on')) hideAuthModal();
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

renderAuthHeader();
refresh();
setInterval(refresh, POLL_MS);
if (document.fonts) document.fonts.ready.then(() => initMarquees(document));