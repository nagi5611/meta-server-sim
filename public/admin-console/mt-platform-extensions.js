/* mt-platform-extensions.js — プロトタイプにないプラットフォーム機能（設定・Tenant 追加） */
(function () {
    'use strict';

    const V = window.MTV;
    const U = window.MUI;
    if (!V || !U || !window.MT) return;
    const { esc, icon } = U;

    async function adminFetch(path, opts = {}) {
        const res = await fetch(path, { credentials: 'include', ...opts });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    V.platformSettings = function platformSettings() {
        const tab = (window.location.hash || '#settings/env').split('/')[1] || 'env';
        const tabs = [
            { id: 'env', label: '環境変数' },
            { id: 'network', label: 'ネットワーク' },
            { id: 'fleet', label: 'Fleet' },
        ];
        return `<article class="sheet">
          <div class="head"><div>
            <div class="kicker">プラットフォーム</div>
            <h1>設定</h1>
            <p class="sub">環境・ネットワーク・Fleet（既存 /admin API）</p>
          </div>
            <a class="btn btn-line btn-sm" href="/admin-legacy.html#settings">旧 UI で開く</a>
          </div>
          <div class="seg" data-ps-tabs>
            ${tabs
                .map(
                    (t) =>
                        `<button type="button" data-ps-tab="${t.id}" class="${tab === t.id ? 'on' : ''}">${esc(
                            t.label
                        )}</button>`
                )
                .join('')}
          </div>
          <div class="block" id="platformSettingsBody"><p class="hint">読込中…</p></div>
        </article>`;
    };

    async function renderPlatformTab() {
        const body = document.getElementById('platformSettingsBody');
        if (!body) return;
        const tab = (window.location.hash || '#settings/env').split('/')[1] || 'env';
        try {
            if (tab === 'env') {
                const j = await adminFetch('/admin/env-config');
                const rows = (j.entries || j.vars || []).slice(0, 80);
                body.innerHTML =
                    rows.length > 0
                        ? `<table class="tbl"><thead><tr><th>キー</th><th>値</th></tr></thead><tbody>${rows
                              .map(
                                  (r) =>
                                      `<tr><td><code>${esc(r.key || r.name || '—')}</code></td><td>${esc(
                                          r.masked != null ? r.masked : r.value ?? '—'
                                      )}</td></tr>`
                              )
                              .join('')}</tbody></table>`
                        : '<p class="hint">未接続（環境変数一覧が空です）</p>';
            } else if (tab === 'network') {
                const j = await adminFetch('/admin/network-config');
                const tenants = j.tenants || j.entries || [];
                body.innerHTML =
                    tenants.length > 0
                        ? `<table class="tbl"><thead><tr><th>Tenant</th><th>公開 URL</th></tr></thead><tbody>${tenants
                              .map(
                                  (r) =>
                                      `<tr><td>${esc(r.id || r.tenantId || '—')}</td><td>${esc(
                                          r.publicUrl || r.url || '—'
                                      )}</td></tr>`
                              )
                              .join('')}</tbody></table>`
                        : '<p class="hint">未接続</p>';
            } else if (tab === 'fleet') {
                let fleetHtml = '<p class="hint">未接続</p>';
                try {
                    const j = await adminFetch('/admin/fleet');
                    fleetHtml = `<pre class="code">${esc(JSON.stringify(j, null, 2))}</pre>`;
                } catch {
                    fleetHtml = '<p class="hint">未接続（/admin/fleet/status）</p>';
                }
                body.innerHTML = fleetHtml;
            } else {
                body.innerHTML = '<p class="hint">未接続</p>';
            }
        } catch {
            body.innerHTML = '<p class="hint">未接続</p>';
        }
    }

    function injectPlatformNav() {
        const side = document.querySelector('.side:not(.rail) .nav-group:last-of-type');
        if (!side || side.querySelector('[data-go="platform-settings"]')) return;
        const link = document.createElement('a');
        link.className = 'nav';
        link.href = '#';
        link.dataset.go = 'platform-settings';
        link.innerHTML = `${icon('server')}プラットフォーム設定`;
        if (window.MT.state.view === 'platform-settings') link.classList.add('on');
        side.appendChild(link);
    }

    function injectTenantAdd() {
        const head = document.querySelector('#main .head .acts');
        if (!head || head.querySelector('[data-act="tenant-add"]')) return;
        if (window.MT.state.view !== 'dash' && !window.MT.state.tenant) return;
        if (window.MT.state.tenant) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-primary btn-sm';
        btn.dataset.act = 'tenant-add';
        btn.textContent = 'Tenant 追加';
        head.appendChild(btn);
    }

    const origRender = window.MT.render;
    window.MT.render = function patchedRender() {
        const st = window.MT.state;
        const platformMode = st.view === 'platform-settings';
        if (platformMode) st.view = 'dash';
        origRender.call(window.MT);
        if (platformMode) {
            st.view = 'platform-settings';
            const page = document.getElementById('main');
            if (page) page.innerHTML = V.platformSettings();
            void renderPlatformTab();
        }
        injectPlatformNav();
        injectTenantAdd();
    };

    document.addEventListener(
        'click',
        (e) => {
            const tab = e.target.closest('[data-ps-tab]');
            if (tab) {
                e.preventDefault();
                window.location.hash = `settings/${tab.dataset.psTab}`;
                document.querySelectorAll('[data-ps-tabs] button').forEach((b) => b.classList.toggle('on', b === tab));
                void renderPlatformTab();
                return;
            }
            const go = e.target.closest('[data-go="platform-settings"]');
            if (go) {
                e.preventDefault();
                window.MT.state.tenant = null;
                window.MT.state.view = 'platform-settings';
                window.location.hash = 'settings/env';
                window.MT.render();
                return;
            }
            const add = e.target.closest('[data-act="tenant-add"]');
            if (add) {
                e.preventDefault();
                const id = window.prompt('新しい Tenant ID（例: P-03）');
                if (!id) return;
                const displayName = window.prompt('表示名', id) || id;
                void (async () => {
                    try {
                        const csrf = await adminFetch('/admin/csrf-token');
                        await adminFetch('/admin/tenants', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-CSRF-Token': csrf.token,
                            },
                            body: JSON.stringify({ id: id.trim(), displayName: displayName.trim() }),
                        });
                        await window.MTD.loadLive();
                        window.MT.toast('Tenant を追加しました');
                        window.MT.render();
                    } catch (err) {
                        window.MT.toast(`追加に失敗: ${err.message || err}`);
                    }
                })();
            }
        },
        true
    );
})();