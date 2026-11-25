// public/js/mt-console-shell.js — CONSOLE シェル（サイドバー・トップバー）を既存 admin ページに適用
import { mtEsc, mtIcon } from './mt-console-ui.js';
import { wireTenantConsolePanelNav } from './mt-console-panel-nav.js';

/** @typedef {'platform' | 'tenant' | 'world-edit'} MtConsolePage */

/**
 * @typedef {object} MtConsoleConfig
 * @property {MtConsolePage} page
 * @property {string} [tenantId]
 * @property {string} [tenantLabel]
 * @property {string} [username]
 * @property {string} [roleLabel]
 */

const ICON_ASSET = '/css/mt-console/assets/icon-192.png';

/** @type {MtConsoleConfig | null} */
let runtimeConfig = null;

/**
 * テナント表示名を後から更新する
 * @param {{ tenantId?: string, tenantLabel?: string }} patch
 */
export function updateMtConsoleTenantContext(patch) {
    if (!runtimeConfig) return;
    if (patch.tenantId) runtimeConfig.tenantId = patch.tenantId;
    if (patch.tenantLabel) runtimeConfig.tenantLabel = patch.tenantLabel;
    const switchBtn = document.querySelector('.switch-btn .tx b');
    const switchId = document.querySelector('.switch-btn .tx span');
    if (switchBtn && patch.tenantLabel) switchBtn.textContent = patch.tenantLabel;
    if (switchId && patch.tenantId) switchId.textContent = patch.tenantId;
    const navLbl = document.querySelector('.nav-group[data-mt-tenant-nav] .nav-lbl em');
    if (navLbl && patch.tenantLabel) navLbl.textContent = patch.tenantLabel;
    refreshCrumbs();
}

/**
 * パンくずを更新する
 */
function refreshCrumbs() {
    const el = document.getElementById('mt-crumbs');
    if (!el || !runtimeConfig) return;
    const parts = [];
    parts.push('管理');
    if (runtimeConfig.page === 'platform') {
        parts.push('全テナント');
        const active = document.querySelector('.side .nav[data-admin-panel].on')?.getAttribute('data-admin-panel');
        if (active === 'settings') parts.push('設定');
        else if (active === 'audit') parts.push('監査ログ・権限');
        else parts.push('ダッシュボード');
    } else if (runtimeConfig.page === 'tenant') {
        parts.push(runtimeConfig.tenantLabel || runtimeConfig.tenantId || 'テナント');
        const active = document.querySelector('[data-tenant-panel].on')?.getAttribute('data-tenant-panel');
        const labels = {
            overview: 'ステータス',
            logs: '通信ログ',
            plugins: 'アドオン管理',
        };
        parts.push(labels[active || 'overview'] || 'ステータス');
    } else {
        parts.push(runtimeConfig.tenantLabel || runtimeConfig.tenantId || 'テナント');
        parts.push('ワールド編集');
    }
    el.innerHTML = parts
        .map((p, i) => {
            const isLast = i === parts.length - 1;
            const sep = i > 0 ? '<span class="sl">/</span>' : '';
            if (isLast) return `${sep}<b>${mtEsc(p)}</b>`;
            return `${sep}<span>${mtEsc(p)}</span>`;
        })
        .join('');
}

/**
 * テナント用: 通信ログを別パネルへ分割
 */
function splitTenantTrafficPanel() {
    const overview = document.querySelector('[data-tenant-panel-id="overview"]');
    if (!overview) return;
    const sections = [...overview.querySelectorAll('.stats-section')];
    const traffic = sections.find((s) => {
        const h = s.querySelector('h2');
        return h && /通信/.test(h.textContent || '');
    });
    if (!traffic) return;
    let logsPanel = document.querySelector('[data-tenant-panel-id="logs"]');
    if (!logsPanel) {
        logsPanel = document.createElement('div');
        logsPanel.id = 'panel-logs';
        logsPanel.className = 'admin-panel';
        logsPanel.dataset.tenantPanelId = 'logs';
        overview.parentElement?.appendChild(logsPanel);
    }
    if (traffic.parentElement === overview) {
        logsPanel.appendChild(traffic);
    }
}

/**
 * プラットフォーム用: 監査パネルを追加
 */
function ensurePlatformAuditPanel() {
    if (document.querySelector('[data-admin-panel-id="audit"]')) return;
    const panels = document.querySelector('.admin-panels');
    if (!panels) return;
    const panel = document.createElement('div');
    panel.className = 'admin-panel';
    panel.dataset.adminPanelId = 'audit';
    panel.innerHTML = `
      <header class="head block">
        <div>
          <p class="kicker">監査 · 権限</p>
          <h1>監査ログ・権限</h1>
          <p class="sub">登録ユーザー（教職員・生徒）の参照と、プラットフォームのユーザー DB 接続状態です。専用の行動監査ログ API は未接続の場合は下に表示されます。</p>
        </div>
      </header>
      <section class="sheet" style="padding:14px 16px;margin-bottom:16px">
        <div class="section-header-row">
          <h2 style="font-size:13px;margin:0">ユーザー DB</h2>
          <span id="mt-audit-users-status" class="tag">読み込み中…</span>
        </div>
        <p class="hint" id="mt-audit-users-hint"></p>
      </section>
      <section class="sheet" style="margin-bottom:16px">
        <p class="nav-lbl" style="padding:12px 14px 6px;margin:0">教職員</p>
        <div style="overflow:auto">
          <table class="worlds-table" id="mt-audit-teachers-table">
            <thead><tr><th>ID</th><th>ユーザー名</th><th>表示名</th></tr></thead>
            <tbody><tr><td colspan="3">読み込み中…</td></tr></tbody>
          </table>
        </div>
      </section>
      <section class="sheet" style="margin-bottom:16px">
        <p class="nav-lbl" style="padding:12px 14px 6px;margin:0">生徒</p>
        <div style="overflow:auto">
          <table class="worlds-table" id="mt-audit-students-table">
            <thead><tr><th>ID</th><th>ユーザー名</th><th>表示名</th></tr></thead>
            <tbody><tr><td colspan="3">読み込み中…</td></tr></tbody>
          </table>
        </div>
      </section>
      <section class="mt-disconnected" id="mt-audit-trail-disconnected">
        <strong>行動監査ログ（未接続）</strong><br>
        アドオン変更や管理操作の時系列監査は、現時点ではこのサーバーに専用ストアがありません。tenant ライフサイクル用の <code>tenant-audit.log</code> はファイルシステム上に記録されています。
      </section>
    `;
    panels.appendChild(panel);
}

/**
 * テナント: アドオン画面にデザイン見出しを付与
 */
/**
 * プラットフォーム各パネルに CONSOLE 見出しを付与
 */
function decoratePlatformPanels() {
    const overview = document.querySelector('[data-admin-panel-id="overview"]');
    if (overview && !overview.querySelector('.head')) {
        const head = document.createElement('header');
        head.className = 'head block';
        head.innerHTML = `
          <div>
            <p class="kicker">プラットフォーム</p>
            <h1>ダッシュボード</h1>
            <p class="sub">全テナントの稼働状況・接続数・HTTP トラフィックの概要です。</p>
          </div>
        `;
        overview.insertBefore(head, overview.firstChild);
    }
    const settings = document.querySelector('[data-admin-panel-id="settings"]');
    if (settings && !settings.querySelector('.head')) {
        const head = document.createElement('header');
        head.className = 'head block';
        head.innerHTML = `
          <div>
            <p class="kicker">プラットフォーム</p>
            <h1>設定</h1>
            <p class="sub">環境変数・ネットワーク・Lobby 同期などプラットフォーム全体の構成です。</p>
          </div>
        `;
        settings.insertBefore(head, settings.firstChild);
    }
}

function decorateTenantStatusPanels() {
    const overview = document.querySelector('[data-tenant-panel-id="overview"]');
    if (overview && !overview.querySelector('.head')) {
        const head = document.createElement('header');
        head.className = 'head block';
        head.innerHTML = `
          <div>
            <p class="kicker">テナント · <span>${mtEsc(runtimeConfig?.tenantLabel || runtimeConfig?.tenantId || '')}</span></p>
            <h1>ステータス</h1>
            <p class="sub">接続数・ワールド一覧と稼働サマリです。通信ログはサイドバーの「通信ログ」から開きます。</p>
          </div>
        `;
        overview.insertBefore(head, overview.firstChild);
        overview.querySelectorAll('.stats-section').forEach((s) => s.classList.add('sheet'));
    }
    const logs = document.querySelector('[data-tenant-panel-id="logs"]');
    if (logs && !logs.querySelector('.head')) {
        const head = document.createElement('header');
        head.className = 'head block';
        head.innerHTML = `
          <div>
            <p class="kicker">テナント · 通信</p>
            <h1>通信ログ</h1>
            <p class="sub">HTTP 送信トラフィックのレート・カテゴリ別内訳です。</p>
          </div>
        `;
        logs.insertBefore(head, logs.firstChild);
        logs.querySelectorAll('.stats-section').forEach((s) => s.classList.add('sheet'));
    }
}

function decorateTenantAddonsPanel() {
    const panel = document.querySelector('[data-tenant-panel-id="plugins"]');
    if (!panel || panel.querySelector('.head')) return;
    const section = panel.querySelector('.stats-section');
    if (!section) return;
    const head = document.createElement('header');
    head.className = 'head block';
    head.innerHTML = `
      <div>
        <p class="kicker">アドオン · <span id="mt-addon-kicker-tenant">${mtEsc(runtimeConfig?.tenantLabel || runtimeConfig?.tenantId || '')}</span></p>
        <h1>アドオン管理</h1>
        <p class="sub">メタバースサーバー <b>${mtEsc(runtimeConfig?.tenantLabel || runtimeConfig?.tenantId || '')}</b> のテナントプラグインを有効化・無効化します。依存チェック UI は API が返す情報のみ表示します（未対応フィールドは省略）。</p>
      </div>
    `;
    section.parentElement?.insertBefore(head, section);
    section.classList.add('sheet');
}

/**
 * @param {MtConsoleConfig} config
 */
export function initMtConsoleShell(config) {
    if (document.querySelector('.app.mt-console-app')) return;
    runtimeConfig = { ...config };

    const main = document.querySelector('.admin-main');
    if (!main) return;

    document.body.classList.add('mt-console');
    if (config.page === 'world-edit') {
        document.body.classList.add('in-editor');
    }

    const legacyAside = document.querySelector('.admin-sidebar');
    legacyAside?.remove();

    const legacyHeader = main.querySelector('header');
    if (legacyHeader) legacyHeader.classList.add('admin-legacy-header');

    const panels = main.querySelector('.admin-panels');
    const legacyActionsFragment = document.createDocumentFragment();
    const legacyActions = legacyHeader?.querySelector('.header-actions');
    if (legacyActions) {
        legacyActionsFragment.append(...legacyActions.childNodes);
    }

    if (config.page === 'tenant') {
        splitTenantTrafficPanel();
        decorateTenantStatusPanels();
    }
    if (config.page === 'platform') {
        ensurePlatformAuditPanel();
    }

    const app = document.createElement('div');
    app.className = 'app mt-console-app';

    const side = buildSidebar(config);
    const mainCol = document.createElement('div');
    mainCol.className = 'main';

    const topbar = buildTopbar(config);
    const page = document.createElement('div');
    page.className = 'page';
    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    if (panels) wrap.appendChild(panels);
    page.appendChild(wrap);
    mainCol.appendChild(topbar);
    mainCol.appendChild(page);
    app.appendChild(side);
    app.appendChild(mainCol);

    main.remove();
    document.body.insertBefore(app, document.body.firstChild);

    if (!document.getElementById('mt-toast')) {
        const toast = document.createElement('div');
        toast.id = 'mt-toast';
        toast.className = 'toast';
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
    }

    if (config.page === 'tenant') {
        decorateTenantAddonsPanel();
    }
    if (config.page === 'platform') {
        decoratePlatformPanels();
    }

    const actionSlot = document.getElementById('mt-topbar-actions');
    if (actionSlot && legacyActionsFragment.childNodes.length) {
        actionSlot.replaceChildren(...legacyActionsFragment.childNodes);
    }

    wireSidebarInteractions(config);
    if (config.page === 'tenant') {
        wireTenantConsolePanelNav();
        document.addEventListener('mt-console-tenant-panel', () => refreshCrumbs());
    }
    refreshCrumbs();
}

/**
 * @param {MtConsoleConfig} config
 */
function buildSidebar(config) {
    const side = document.createElement('aside');
    side.className = 'side';

    const brand = document.createElement('a');
    brand.className = 'brand';
    brand.href = '/admin.html';
    brand.innerHTML = `
      <img src="${ICON_ASSET}" width="26" height="26" alt="">
      <span class="brand-t"><b>みんなでメタ</b><span>CONSOLE</span></span>
    `;
    side.appendChild(brand);

    if (config.page !== 'platform') {
        side.appendChild(buildTenantSwitch(config));
    } else {
        const all = document.createElement('div');
        all.className = 'nav-group';
        all.innerHTML = `<p class="nav-lbl">プラットフォーム</p>`;
        const dash = navButton({
            attrs: { 'data-admin-panel': 'overview' },
            icon: 'grid',
            label: 'ダッシュボード',
            active: true,
        });
        all.appendChild(dash);
        side.appendChild(all);
    }

    if (config.page === 'tenant' || config.page === 'world-edit') {
        const tg = document.createElement('div');
        tg.className = 'nav-group';
        tg.dataset.mtTenantNav = '1';
        tg.innerHTML = `<p class="nav-lbl">テナント <em>${mtEsc(config.tenantLabel || config.tenantId || '')}</em></p>`;

        if (config.page === 'tenant') {
            tg.appendChild(
                navButton({
                    tag: 'button',
                    attrs: { 'data-tenant-panel': 'overview' },
                    icon: 'pulse',
                    label: 'ステータス',
                    active: true,
                })
            );
            tg.appendChild(
                navButton({
                    tag: 'button',
                    attrs: { 'data-tenant-panel': 'logs' },
                    icon: 'net',
                    label: '通信ログ',
                })
            );
            const worldHref = config.tenantId
                ? `/admin/tenant/${encodeURIComponent(config.tenantId)}/world-edit`
                : '#';
            tg.appendChild(
                navLink({
                    href: worldHref,
                    icon: 'cube',
                    label: 'ワールド編集',
                })
            );
            tg.appendChild(
                navButton({
                    tag: 'button',
                    attrs: { 'data-tenant-panel': 'plugins' },
                    icon: 'modules',
                    label: 'アドオン管理',
                })
            );
        } else {
            const tenantHref = config.tenantId
                ? `/admin/tenant/${encodeURIComponent(config.tenantId)}`
                : '/admin.html';
            tg.appendChild(navLink({ href: tenantHref, icon: 'pulse', label: 'ステータス' }));
            tg.appendChild(navLink({ href: tenantHref, icon: 'net', label: '通信ログ' }));
            tg.appendChild(
                navButton({ tag: 'span', attrs: {}, icon: 'cube', label: 'ワールド編集', active: true })
            );
            tg.appendChild(navLink({ href: tenantHref, icon: 'modules', label: 'アドオン管理' }));
        }
        side.appendChild(tg);
    }

    const mg = document.createElement('div');
    mg.className = 'nav-group';
    mg.innerHTML = `<p class="nav-lbl">管理</p>`;
    if (config.page === 'platform') {
        mg.appendChild(
            navButton({
                attrs: { 'data-admin-panel': 'settings' },
                icon: 'settings',
                label: '設定',
            })
        );
        mg.appendChild(
            navButton({
                attrs: { 'data-admin-panel': 'audit' },
                icon: 'shield',
                label: '監査ログ・権限',
            })
        );
    } else {
        const settings = navLink({ href: '/admin.html#settings', icon: 'settings', label: 'プラットフォーム設定' });
        mg.appendChild(settings);
    }
    side.appendChild(mg);

    const foot = document.createElement('div');
    foot.className = 'side-foot';
    const user = config.username || document.getElementById('header-username')?.textContent || 'admin';
    const role = config.roleLabel || '全体管理者';
    const initial = user.slice(0, 1).toUpperCase();
    foot.innerHTML = `
      <div class="side-user">
        <span class="av">${mtEsc(initial)}</span>
        <span class="who"><b>${mtEsc(user)}</b><span>${mtEsc(role)}</span></span>
        <button type="button" class="txt-btn" id="mt-console-auth-hint" title="HTTP 認証はブラウザが保持します">認証について</button>
      </div>
    `;
    side.appendChild(foot);

    return side;
}

/**
 * @param {MtConsoleConfig} config
 */
function buildTenantSwitch(config) {
    const wrap = document.createElement('div');
    wrap.className = 'switch';
    const label = config.tenantLabel || config.tenantId || 'テナント';
    const initial = label.slice(0, 1);
    wrap.innerHTML = `
      <button type="button" class="switch-btn" id="mt-tenant-switch-btn" aria-expanded="false">
        <span class="av">${mtEsc(initial)}</span>
        <span class="tx"><b>${mtEsc(label)}</b><span>${mtEsc(config.tenantId || '')}</span></span>
        ${mtIcon('chev', 'chev')}
      </button>
      <div class="popover" id="mt-tenant-popover" hidden>
        <p class="pop-head">テナントを切替</p>
        <a class="pop-item" href="/admin.html"><span class="tx"><b>全テナント一覧</b><span>プラットフォーム</span></span></a>
        <div class="pop-foot">
          <a class="txt-btn" href="/admin.html">ダッシュボードへ</a>
        </div>
      </div>
    `;
    return wrap;
}

/**
 * @param {MtConsoleConfig} config
 */
function buildTopbar(config) {
    const bar = document.createElement('header');
    bar.className = 'topbar';
    bar.innerHTML = `
      <button type="button" class="icon-btn menu-btn" id="mt-side-toggle" aria-label="メニュー">${mtIcon('grid')}</button>
      <nav class="crumbs" id="mt-crumbs" aria-label="パンくず"></nav>
      <span class="rule"></span>
      <span class="st live">稼働中</span>
      <span style="flex:1"></span>
      <div id="mt-topbar-actions" class="topbar-actions"></div>
      <a class="btn btn-line btn-sm" href="/" target="_blank" rel="noopener">参加者ページ ${mtIcon('open', '')}</a>
    `;
    return bar;
}

/**
 * @param {object} opts
 */
function navButton(opts) {
    const el = document.createElement(opts.tag || 'button');
    el.className = `nav${opts.active ? ' on' : ''}`;
    if (opts.attrs) {
        for (const [k, v] of Object.entries(opts.attrs)) {
            if (k === 'data-tenant-panel' || k === 'data-admin-panel') el.setAttribute(k, v);
        }
    }
    el.innerHTML = `${mtIcon(opts.icon)}<span>${mtEsc(opts.label)}</span>`;
    if (el.tagName === 'BUTTON') el.type = 'button';
    return el;
}

/**
 * @param {{ href: string, icon: string, label: string, active?: boolean }} opts
 */
function navLink(opts) {
    const a = document.createElement('a');
    a.className = `nav${opts.active ? ' on' : ''}`;
    a.href = opts.href;
    a.innerHTML = `${mtIcon(opts.icon)}<span>${mtEsc(opts.label)}</span>`;
    return a;
}

/**
 * @param {MtConsoleConfig} config
 */
function wireSidebarInteractions(config) {
    document.getElementById('mt-side-toggle')?.addEventListener('click', () => {
        document.body.classList.toggle('side-open');
    });

    const switchBtn = document.getElementById('mt-tenant-switch-btn');
    const pop = document.getElementById('mt-tenant-popover');
    switchBtn?.addEventListener('click', () => {
        const open = pop?.hasAttribute('hidden');
        pop?.toggleAttribute('hidden', !open);
        switchBtn.classList.toggle('open', !!open);
        switchBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('click', (ev) => {
        if (!(ev.target instanceof Node)) return;
        if (pop && switchBtn && !pop.contains(ev.target) && !switchBtn.contains(ev.target)) {
            pop.setAttribute('hidden', '');
            switchBtn.classList.remove('open');
            switchBtn.setAttribute('aria-expanded', 'false');
        }
    });

    document.getElementById('mt-console-auth-hint')?.addEventListener('click', () => {
        window.alert(
            '管理者ログインは HTTP Basic 認証です。ログアウトはブラウザのサイトデータ／認証情報の削除が必要です。プロトタイプの admin/admin1234 は使用しません。'
        );
    });

    document.querySelectorAll('.side .nav[data-admin-panel]').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.side .nav[data-admin-panel]').forEach((n) => n.classList.remove('on'));
            btn.classList.add('on');
            refreshCrumbs();
        });
    });
}