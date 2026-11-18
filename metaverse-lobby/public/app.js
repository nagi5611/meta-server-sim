const POLL_MS = 10_000;
const grid = document.getElementById('world-grid');
const hint = document.getElementById('refresh-hint');
const scrim = document.getElementById('join-scrim');
const displayInput = document.getElementById('display-name');
const joinTitle = document.getElementById('join-world-name');
const joinCodeInput = document.getElementById('join-code');
const toastEl = document.getElementById('toast');

/** @type {Array<Record<string, unknown>>} */
let worlds = [];
/** @type {Record<string, unknown> | null} */
let selected = null;
let toastTimer = null;

function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2400);
}

function sparkSvg(series, off) {
    const pts = (series?.length ? series : new Array(24).fill(0)).slice(-24);
    const max = Math.max(1, ...pts);
    const w = 56;
    const h = 24;
    const coords = pts.map((v, i) => {
        const x = (i / (pts.length - 1 || 1)) * w;
        const y = h - (v / max) * (h - 2) - 1;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const stroke = off ? '#c9ced6' : '#1f9d55';
    const fill = off ? '#eef0f4' : 'rgba(31,157,85,.13)';
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polygon points="0,${h} ${coords.join(' ')} ${w},${h}" fill="${fill}"/><polyline points="${coords.join(' ')}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
}

function badgeFor(status) {
    if (status === 'maint') return { cls: 'maint', label: 'メンテナンス' };
    if (status === 'live') return { cls: 'live', label: 'イベント中' };
    if (status === 'degraded') return { cls: 'maint', label: '不安定' };
    return { cls: '', label: '稼働中' };
}

function render() {
    if (!grid) return;
    grid.replaceChildren();
    for (const w of worlds) {
        const status = String(w.status || 'online');
        const off = status === 'maint';
        const b = badgeFor(status);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `card${off ? ' off' : ''}`;
        btn.setAttribute('role', 'listitem');
        btn.innerHTML = `
          <div class="ph">
            ${w.thumbnailUrl ? `<img src="${escapeAttr(w.thumbnailUrl)}" alt="">` : ''}
            <span class="badge ${b.cls}"><i></i>${b.label}</span>
          </div>
          <div class="card-body">
            <div>
              <div class="nm">${escapeHtml(w.name)}</div>
              <div class="meta num">${off ? '接続停止中' : `参加中 <b>${formatNum(w.players)}</b> 人`}</div>
            </div>
            <div class="spark-wrap">${sparkSvg(w.series, off)}<span class="lbl">24h</span></div>
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
}

function formatNum(n) {
    return new Intl.NumberFormat('ja-JP').format(Number(n) || 0);
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
}

function openJoin(world) {
    selected = world;
    joinTitle.textContent = String(world.name || '');
    const saved = localStorage.getItem('lobbyDisplayName') || '';
    displayInput.value = saved;
    scrim.hidden = false;
    scrim.classList.add('on');
    displayInput.focus();
}

function closeJoin() {
    scrim.classList.remove('on');
    scrim.hidden = true;
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
    const url = new URL(base, window.location.origin);
    url.searchParams.set('displayName', displayName);
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
    } catch (e) {
        if (hint) hint.textContent = '取得失敗';
        showToast('一覧の更新に失敗しました');
    }
}

document.getElementById('join-cancel')?.addEventListener('click', closeJoin);
scrim?.addEventListener('click', (ev) => {
    if (ev.target === scrim) closeJoin();
});
document.getElementById('join-go')?.addEventListener('click', () => {
    if (!selected) return;
    const v = validateName(displayInput.value);
    if (!v.ok) {
        showToast(v.error);
        displayInput.style.borderColor = '#dc2626';
        return;
    }
    displayInput.style.borderColor = '';
    navigateToWorld(selected, v.value);
});

document.getElementById('join-code-btn')?.addEventListener('click', () => {
    const code = String(joinCodeInput?.value || '')
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '')
        .slice(0, 12);
    if (code.length < 4) {
        showToast('参加コードを入力してください');
        return;
    }
    const hit = worlds.find((w) => String(w.joinCode || '').toUpperCase() === code);
    if (hit) openJoin(hit);
    else showToast(`参加コード ${code} に一致するワールドがありません`);
});

joinCodeInput?.addEventListener('input', () => {
    const v = joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
    joinCodeInput.value = v;
});

refresh();
setInterval(refresh, POLL_MS);