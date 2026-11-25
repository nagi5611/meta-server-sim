/* マルチテナント管理パネル — アドオン管理ビュー */
(function () {
  "use strict";
  const D = window.MTD, U = window.MUI, V = window.MTV;
  const { esc, icon } = U;
  const state = () => window.MT.state;

  /* テナントごとの導入状態をセッション中保持 */
  function cache(t) {
    const c = window.MT.addonCache || (window.MT.addonCache = {});
    return c[t.id] || (c[t.id] = D.addonsOf(t));
  }
  V._addonCache = cache;

  function nameOf(id) {
    const a = D.ADDON_BY_ID[id];
    return a ? a.name : id;
  }

  /* ============ 有効 / 無効 の切り替え ============ */
  V.toggleAddon = function (id) {
    const st = state();
    const t = D.TENANTS.find((x) => x.id === st.tenant) || D.TENANTS[0];
    if (!t) return;
    const map = cache(t);
    const def = D.ADDON_BY_ID[id];
    const row = map[id];
    if (!def || !row) return;

    if (!row.on) {
      const missing = def.dep.filter((d) => !map[d] || !map[d].on);
      if (missing.length) {
        window.MT.toast(`${missing.map(nameOf).join("・")} が無効のため有効にできません`);
        return;
      }
      if (t.status === "offline") {
        window.MT.toast("停止中のサーバーではアドオンを有効にできません");
        return;
      }
      row.on = true;
      row.updated = "たった今";
      row.by = "nagi";
      window.MT.toast(`${def.name} を有効にしました（${t.name}）`);
    } else {
      row.on = false;
      row.updated = "たった今";
      row.by = "nagi";
      const dependents = D.ADDONS.filter((x) => x.dep.includes(id) && map[x.id] && map[x.id].on);
      dependents.forEach((x) => { map[x.id].on = false; });
      window.MT.toast(
        dependents.length
          ? `${def.name} を無効化しました。依存する ${dependents.length} 件も停止しました`
          : `${def.name} を無効にしました（${t.name}）`
      );
    }
    window.MT.render();
  };

  /* ============ 画面 ============ */
  function head(kicker, title, sub, acts) {
    return `<div class="head"><div>
      ${kicker ? `<div class="kicker">${kicker}</div>` : ""}
      <h1>${title}</h1>
      ${sub ? `<p class="sub">${sub}</p>` : ""}
    </div>${acts ? `<div class="acts">${acts}</div>` : ""}</div>`;
  }

  function rowHtml(t, map, a, open) {
    const r = map[a.id];
    const depMissing = a.dep.filter((d) => !map[d] || !map[d].on);
    const outdated = r.ver !== a.ver;
    const locked = !r.on && depMissing.length > 0;
    const worlds = r.worlds.map((w) => t.worlds.find((x) => x.id === w)).filter(Boolean);

    return `<div class="ad-row ${r.on ? "is-on" : "is-off"} ${open ? "is-open" : ""}">
      <button class="ad-sw ${r.on ? "on" : ""}" data-addon="${esc(a.id)}" role="switch"
        aria-checked="${r.on}" ${locked ? `disabled aria-disabled="true" title="${esc(depMissing.map(nameOf).join("・"))} が必要です"` : ""}>
        <i></i><small>${r.on ? "有効" : "無効"}</small>
      </button>
      <span class="ad-ic">${icon(a.icon)}</span>
      <button class="ad-main" data-addon-exp="${esc(a.id)}" aria-expanded="${open}">
        <span class="nm">${esc(a.name)}
          ${outdated ? `<em class="ad-up">更新あり</em>` : ""}
          ${locked ? `<em class="ad-lk">${esc(depMissing.map(nameOf).join("・"))} が必要</em>` : ""}
        </span>
        <span class="ds">${esc(a.desc)}</span>
      </button>
      <span class="ad-meta">
        <span><b>${worlds.length}</b> ワールド</span>
        <span>${D.num(r.calls)} 回/分</span>
      </span>
      <button class="ad-more ${open ? "on" : ""}" data-addon-exp="${esc(a.id)}" aria-label="詳細">
        ${icon("chev")}
      </button>
      ${open ? `<div class="ad-det">
        <div><div class="ad-k">バージョン</div>
          <div class="ad-v mono">${esc(r.ver)}${outdated ? ` <span class="tag warn">最新 ${esc(a.ver)}</span>` : ""}</div></div>
        <div><div class="ad-k">提供</div><div class="ad-v">${esc(a.vendor)}</div></div>
        <div><div class="ad-k">最終変更</div><div class="ad-v">${esc(r.updated)} ・ ${esc(r.by)}</div></div>
        <div><div class="ad-k">権限</div>
          <div class="ad-tags">${a.perms.map((p) => `<span class="tag">${esc(p)}</span>`).join("")}</div></div>
        <div><div class="ad-k">依存</div>
          <div class="ad-v">${a.dep.length
            ? a.dep.map((d) => `<span class="ad-dep ${map[d] && map[d].on ? "ok" : "ng"}">${esc(nameOf(d))}</span>`).join("")
            : `<span style="color:var(--faint)">なし</span>`}</div></div>
        <div><div class="ad-k">適用中のワールド</div>
          <div class="ad-tags">${r.on && worlds.length
            ? worlds.map((w) => `<span class="tag primary">${esc(w.name)}</span>`).join("")
            : `<span style="color:var(--faint)">未適用（無効）</span>`}</div></div>
      </div>` : ""}
    </div>`;
  }

  V.addons = function () {
    const st = state();
    const t = D.TENANTS.find((x) => x.id === st.tenant) || D.TENANTS[0];
    if (!t) return "";
    const map = cache(t);
    const q = (st.addonQ || "").toLowerCase();
    const only = st.addonState || "all";
    const cat = st.addonCat || "all";

    const match = (a) => {
      const r = map[a.id];
      if (cat !== "all" && a.cat !== cat) return false;
      if (only === "on" && !r.on) return false;
      if (only === "off" && r.on) return false;
      if (q && !(a.name + a.desc + a.vendor).toLowerCase().includes(q)) return false;
      return true;
    };

    const enabled = D.ADDONS.filter((a) => map[a.id].on);
    const shown = D.ADDONS.filter(match);

    const groups = D.ADDON_CATS.map((c) => {
      const list = shown.filter((a) => a.cat === c.id);
      if (!list.length) return "";
      const onN = list.filter((a) => map[a.id].on).length;
      return `<section class="ad-cat">
        <div class="ad-cat-h">
          <b>${esc(c.label)}</b><span class="en">${esc(c.en)}</span>
          <span class="cnt"><b>${onN}</b> / ${list.length} 有効</span>
        </div>
        <div class="sheet">${list.map((a) => rowHtml(t, map, a, st.addonOpen === a.id)).join("")}</div>
      </section>`;
    }).join("");

    return `<div class="wrap">
      ${head(`アドオン · ${esc(t.org)}`, "アドオン管理",
        `メタバースサーバー <b style="font-weight:600;color:var(--ink)">${esc(t.name)}</b> に導入するアドオンを選びます。有効にした機能は、そのサーバーの全ワールドに反映されます。`,
        `<button class="btn btn-line btn-sm" data-act="addon-export">${icon("dl")}構成を書き出す</button>
         <button class="btn btn-primary btn-sm" data-act="addon-add">${icon("plus")}アドオンを追加</button>`)}

      <div class="ad-tools">
        <div class="seg">
          <button data-addon-cat="all" class="${cat === "all" ? "on" : ""}">すべて</button>
          ${D.ADDON_CATS.map((c) => `<button data-addon-cat="${c.id}" class="${cat === c.id ? "on" : ""}">${esc(c.label)}</button>`).join("")}
        </div>
        <div class="seg" style="margin-left:8px">
          <button data-addon-state="all" class="${only === "all" ? "on" : ""}">全件</button>
          <button data-addon-state="on" class="${only === "on" ? "on" : ""}">有効</button>
          <button data-addon-state="off" class="${only === "off" ? "on" : ""}">無効</button>
        </div>
        <div class="search ad-search">${icon("search")}
          <input class="inp" data-addon-q value="${esc(st.addonQ || "")}" placeholder="アドオン名・提供元で検索">
        </div>
      </div>

      ${shown.length ? groups : `<div class="sheet"><div class="empty">条件に一致するアドオンはありません</div></div>`}

      <div class="wfoot">
        <span>変更はすぐに反映され、監査ログに記録されます</span>
        <span class="sp"></span>
        <span>サーバー <b>${esc(t.name)}</b></span>
        <span>最終更新 <b>${esc(D.mdhm(new Date()))}</b></span>
      </div>
    </div>`;
  };
})();
