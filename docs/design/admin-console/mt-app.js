/* マルチテナント管理パネル — シェル / ルーティング / ライブ更新 */
(function () {
  "use strict";
  const D = window.MTD, U = window.MUI, V = window.MTV;
  const { esc, icon } = U;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const NAV = [
    { id: "dash", label: "ダッシュボード", icon: "grid" },
    { id: "tenant", label: "ステータス", icon: "pulse" },
    { id: "logs", label: "通信ログ", icon: "net" },
    { id: "world", label: "ワールド編集", icon: "cube" },
    { id: "addons", label: "アドオン管理", icon: "modules" },
    { id: "audit", label: "監査ログ・権限", icon: "shield" }
  ];

  let timers = [];
  const state = {
    view: "dash",
    tenant: null,
    range: "24h",
    focus: null,
    dashMode: "sheet",
    logTab: "live",
    logs: [],
    playing: true,
    rate: 0,
    filter: { q: "", status: "", method: "", slow: false },
    logSel: null,
    worldId: null,
    ed: null,
    authed: false,
    navBlocked: null,
    addonCache: {},
    addonCat: "all",
    addonState: "all",
    addonQ: "",
    addonOpen: null
  };
  window.MT = {
    state, liveN: {}, width: 0,
    render, toast, applyTweaks: () => {}
  };

  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("on"), 2200);
  }
  window.MT.toast = toast;

  /* ================= 認証 ================= */
  const gate = $("#gate"), app = $("#app");
  function enter() {
    state.authed = true;
    gate.hidden = true;
    app.hidden = false;
    if (!state.logs.length) resetLogs();
    render();
    startLive();
    hookEditorEvents();
  }
  $("#gateForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const u = $("#gUser").value.trim(), p = $("#gPass").value;
    if (u === "admin" && p === "admin1234") {
      $("#gateErr").textContent = "";
      sessionStorage.setItem("mt.authed", "1");
      enter();
    } else {
      $("#gateErr").textContent = "ユーザー名またはパスワードが違います。";
      $("#gPass").select();
    }
  });
  if (sessionStorage.getItem("mt.authed") === "1") enter();
  else setTimeout(() => $("#gUser").focus(), 60);

  function resetLogs() {
    const t = D.TENANTS.find((x) => x.id === (state.tenant || "mmh"));
    state.logs = D.seedLogs(t, 90);
  }

  /* ================= シェル ================= */
  function statusOf(t) {
    const s = D.STATUS[t.status];
    return `<span class="st ${s.tone === "ok" ? "live" : s.tone}">${s.label}</span>`;
  }

  function sidebar() {
    const t = state.tenant ? D.TENANTS.find((x) => x.id === state.tenant) : null;
    return `
      <a class="brand" href="#" data-go="dash">
        <img src="assets/icon-192.png" alt="">
        <span class="brand-t"><b>みんなでメタ</b><span>Console</span></span>
      </a>
      <div class="switch">
        <button class="switch-btn ${state.pickerOpen ? "open" : ""}" data-act="picker">
          <span class="av">${t ? esc(t.org.slice(0, 1)) : "全"}</span>
          <span class="tx">
            <b>${t ? esc(t.name) : "全テナント"}</b>
            <span>${t ? esc(t.host) : D.TENANTS.length + " テナントを横断"}</span>
          </span>
          ${icon("chev", "chev")}
        </button>
        ${state.pickerOpen ? `<div class="popover" data-picker>
          <div class="pop-head">テナントを切り替え</div>
          <button class="pop-item" data-tenant="">
            <span class="tx"><b>全テナント</b><span>横断ビュー</span></span>
          </button>
          ${D.TENANTS.map((x) => `<button class="pop-item ${state.tenant === x.id ? "on" : ""}" data-tenant="${esc(x.id)}">
            ${statusOf(x)}
            <span class="tx"><b>${esc(x.name)}</b><span>${esc(x.org)}</span></span>
          </button>`).join("")}
        </div>` : ""}
      </div>
      <div class="nav-group" style="margin-top:6px">
        <a class="nav ${state.view === "dash" ? "on" : ""}" href="#" data-go="dash">${icon("grid")}ダッシュボード</a>
      </div>
      <div class="nav-group">
        <div class="nav-lbl">テナント <em>${t ? esc(t.name) : "未選択"}</em></div>
        ${["tenant", "logs", "world", "addons"].map((id) => {
          const n = NAV.find((x) => x.id === id);
          return `<a class="nav ${state.view === id ? "on" : ""} ${t ? "" : "ghost"}" href="#" data-go="${id}">
            ${icon(n.icon)}${n.label}
            ${id === "logs" && t && t.status === "degraded" ? `<span class="dot"></span>` : ""}
          </a>`;
        }).join("")}
      </div>
      <div class="nav-group">
        <div class="nav-lbl">管理</div>
        <a class="nav ${state.view === "audit" ? "on" : ""}" href="#" data-go="audit">${icon("shield")}監査ログ・権限</a>
      </div>
      <div class="side-foot">
        <div class="side-user">
          <span class="av">N</span>
          <span class="who"><b>nagi</b><span>全体管理者</span></span>
          <button class="txt-btn" id="logoutBtn">ログアウト</button>
        </div>
      </div>`;
  }

  function topbar() {
    const t = state.tenant ? D.TENANTS.find((x) => x.id === state.tenant) : null;
    const v = NAV.find((n) => n.id === state.view);
    const pillCls = t ? (t.status === "online" || t.status === "event" ? "" : t.status === "degraded" ? "warn" : "off") : "";
    return `<div class="crumbs">
        <span>管理</span><span class="sep">/</span>
        ${t ? `<a href="#" data-tenant="" style="text-decoration:none;color:var(--faint)">全テナント</a><span class="sep">/</span><b>${esc(t.name)}</b><span class="sep">/</span>` : ""}
        <b style="color:var(--muted);font-weight:600">${esc(v ? v.label : "")}</b>
      </div>
      <span class="top-sep"></span>
      <span class="live-pill ${pillCls}">${t
        ? t.status === "online" ? "正常稼働" : t.status === "degraded" ? "劣化を検知" : t.status === "event" ? "イベント開催中" : "停止中"
        : "全システム正常"}</span>
      <a class="top-link" href="#" data-act="open-public">${icon("open")}参加者ページ</a>`;
  }

  /* エディタ用：アイコンのみのレール（ホバーで展開） */
  function rail() {
    const t = state.tenant ? D.TENANTS.find((x) => x.id === state.tenant) : null;
    const rn = (id, ic, label, on) => `<a class="rnav ${on ? "on" : ""}" href="#" data-go="${id}" title="${label}">
        ${icon(ic)}<span>${label}</span></a>`;
    return `<div class="rail-in">
      <a class="rbrand" href="#" data-go="dash">
        <img src="assets/icon-192.png" alt=""><b>みんなでメタ</b>
      </a>
      <a class="rtenant" href="#" data-act="picker" title="${t ? esc(t.name) : "全テナント"}">
        <span class="av">${t ? esc(t.org.slice(0, 1)) : "全"}</span>
        <b>${t ? esc(t.name) : "全テナント"}</b>
      </a>
      ${rn("dash", "grid", "ダッシュボード", false)}
      <div class="rsec">テナント</div>
      ${rn("tenant", "pulse", "ステータス", false)}
      ${rn("logs", "net", "通信ログ", false)}
      ${rn("world", "cube", "ワールド編集", true)}
      ${rn("addons", "modules", "アドオン管理", false)}
      <div class="rsec">管理</div>
      ${rn("audit", "shield", "監査ログ・権限", false)}
      <div class="rgap"></div>
      <div class="rfoot">
        <span class="av">N</span><b>nagi</b>
        <button class="txt-btn" id="logoutBtn" style="margin-left:auto;font-size:10.5px">ログアウト</button>
      </div>
    </div>`;
  }

  function render() {
    if (!state.authed) return;
    const isEd = state.view === "world";
    document.body.classList.toggle("in-editor", isEd);
    const side = $("#side");
    side.hidden = false;
    side.className = isEd ? "side rail" : "side";
    side.innerHTML = isEd ? rail() : sidebar();
    const tb = $("#topbar");
    tb.innerHTML = isEd ? "" : topbar();
    tb.hidden = isEd;

    const root = document.getElementById("main");
    root.style.height = isEd ? "100dvh" : "";
    if (isEd) {
      if (!state.tenant) { state.tenant = "mmh"; state.worldId = null; }
      if (!state.ed) window.MTA.initEd(state);
      root.innerHTML = V.world();
      window.MTA.mountScene(state);
      window.MTA.bindDropzones();
      window.MTA.bindSplitter();
      requestAnimationFrame(() => {
        if (!window.ME.isMounted) window.MTA.mountScene(state);
        window.MTA.bindDropzones();
        window.MTA.bindFileInput();
        window.MTA.bindSplitter();
        bindWorldDrag();
      });
      return;
    }

    window.ME.isMounted && window.ME.unmount();
    const page = $("#main");
    let html = "";
    if (state.view === "dash") html = V.dash();
    else if (state.view === "audit") html = V.audit();
    else if (state.view === "worldpick") html = V.pick();
    else html = state.tenant ? V[state.view]() : V.dash();
    page.innerHTML = html;
    requestAnimationFrame(() => { window.MT.width = $(".page").clientWidth; });
  }
  window.MT.render = render;
  window.MT.render = render;

  /* ================= エディタ ================= */
  const ed = () => state.ed;

  function undo() {
    const e = ed();
    if (!e.undo.length) return;
    e.redo.push(window.MTA.snapshot(e));
    window.MTA.applySnap(state, e.undo.pop());
    e.dirty = true;
    window.MTA.rerenderAll(state);
  }
  function redo() {
    const e = ed();
    if (!e.redo.length) return;
    e.undo.push(window.MTA.snapshot(e));
    window.MTA.applySnap(state, e.redo.pop());
    e.dirty = true;
    window.MTA.rerenderAll(state);
  }

  function save(publish) {
    const e = ed();
    e.dirty = false;
    const now = new Date();
    const at = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    e.history.unshift({
      at, who: "nagi",
      msg: publish ? `${e.objects.length} オブジェクトを公開` : "下書きを保存",
      published: !!publish
    });
    window.MTA.saveDraft(state, publish);
    window.MTA.paintStatus();
    toast(publish ? "公開しました。参加者に反映されます。" : "下書きを保存しました。");
  }

  function navigate(target) {
    if (target === "world" && state.view !== "world") {
      state.worldPick = true;
      state.view = "worldpick";
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (state.view === "world" && ed() && ed().dirty) {
      state.navBlocked = target;
      ed().dialog = "leave";
      render();
      return;
    }
    doNavigate(target);
  }
  function doNavigate(target) {
    let v = target;
    if (target.startsWith("tenant:")) { v = "tenant"; state.tenant = target.slice(7); }
    if (target.startsWith("server:")) {
      /* サーバー（テナント）を選んで、その中のワールドを編集 */
      state.tenant = target.slice(7);
      state.worldId = null;
      state.ed = null;
      state.worldPick = false;
      state.view = "world";
      resetLogs();
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (["tenant", "logs", "world", "addons"].includes(v) && !state.tenant) {
      state.tenant = "mmh";
      resetLogs();
    }
    if (state.view === "world" && v !== "world") { state.ed = null; window.MTA._mounted = null; }
    state.worldPick = false;
    state.view = v;
    state.pickerOpen = false;
    state.logSel = null;
    if (ed()) ed().dialog = null;
    render();
    window.scrollTo(0, 0);
  }

  const DEFAULT_OPTION = {
    teleporter: { on: false, to: "", radius: 2, mode: "manual", prompt: true, key: "E" },
    taiko: { on: false, sound: "taiko_01", volume: 0.8, radius: 2, prompt: true }
  };
  function defaultOption(grp) {
    return JSON.parse(JSON.stringify(DEFAULT_OPTION[grp] || {}));
  }

  /* ---------- ワールド切り替え ---------- */
  function switchWorld(wid) {
    state.navBlocked = null;
    if (ed() && ed().worldId === wid) return;
    window.MTA.switchWorld(state, wid);
  }

  /* ワールドタブの並べ替え */
  function reorderWorlds(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const t = D.TENANTS.find((x) => x.id === state.tenant);
    if (!t) return;
    const from = t.worlds.findIndex((w) => w.id === fromId);
    const to = t.worlds.findIndex((w) => w.id === toId);
    if (from < 0 || to < 0) return;
    const [m] = t.worlds.splice(from, 1);
    t.worlds.splice(to, 0, m);
    if (ed()) ed().worlds = t.worlds;
    render();
    requestAnimationFrame(() => {
      window.MTA.mountScene(state);
      window.MTA.bindDropzones();
      window.MTA.bindSplitter();
      bindWorldDrag();
    });
    toast("ワールドの並び順を変更しました");
  }

  /* タブのドラッグ並べ替え */
  function bindWorldDrag() {
    const host = $(".vd-worldtabs");
    if (!host || host.dataset.drag) return true;
    host.dataset.drag = "1";
    let dragId = null;
    host.querySelectorAll("[data-worldtab]").forEach((b) => {
      b.addEventListener("dragstart", (e) => {
        dragId = b.dataset.worldtab;
        b.classList.add("dragging");
        try { e.dataTransfer.setData("text/plain", dragId); } catch (err) {}
        e.dataTransfer.effectAllowed = "move";
      });
      b.addEventListener("dragend", () => {
        b.classList.remove("dragging");
        host.querySelectorAll("button").forEach((x) => x.classList.remove("drop-target"));
      });
      b.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (b.dataset.worldtab !== dragId) b.classList.add("drop-target");
      });
      b.addEventListener("dragleave", () => b.classList.remove("drop-target"));
      b.addEventListener("drop", (e) => {
        e.preventDefault();
        b.classList.remove("drop-target");
        const from = dragId || e.dataTransfer.getData("text/plain");
        reorderWorlds(from, b.dataset.worldtab);
      });
    });
    return true;
  }

  /* ---------- パネル操作 ---------- */
  function togglePanel(k) {
    const e = ed();
    e.panels[k] = !e.panels[k];
    window.MTA.refreshPanels();
  }

  /* ================= 右クリック ================= */
  document.addEventListener("contextmenu", (e) => {
    if (state.view !== "world" || !ed()) return;

    /* ワールドタブ：名前変更 */
    const wt = e.target.closest("[data-worldtab]");
    if (wt) {
      e.preventDefault();
      const t = D.TENANTS.find((x) => x.id === state.tenant);
      const w = t && t.worlds.find((x) => x.id === wt.dataset.worldtab);
      if (!w) return;
      ed().ctxWorld = { id: w.id, x: e.clientX, y: e.clientY, name: w.name };
      window.MTA.refreshTop();
      return;
    }

    const row = e.target.closest("[data-ex-file]");
    if (row) {
      e.preventDefault();
      ed().explorer.sel = row.dataset.exFile;
      const host = $("[data-ex]");
      const hr = host ? host.getBoundingClientRect() : null;
      const x = Math.min(e.clientX, (hr ? hr.right : window.innerWidth) - 204);
      const y = Math.min(e.clientY, (hr ? hr.bottom : window.innerHeight) - 216);
      ed().ctx = { id: row.dataset.exFile, x, y };
      window.MTA.paintExplorer();
      return;
    }
    const obj = e.target.closest("[data-ed-obj]");
    if (obj) {
      e.preventDefault();
      const id = obj.dataset.edObj;
      ed().selected = [id];
      ed().selKind = "obj";
      window.ME.select([id]);
      window.MTA.refreshInspector();
      window.MTA.refreshOutliner();
    }
  });

  /* ================= クリック委譲 ================= */
  document.addEventListener("click", (e) => {
    if (state.view !== "world" || !ed()) {
      return mainClicks(e);
    }
    return editClicks(e);
  });

  /* プレビューの閉じるは最優先（他のパネル再描画と競合させない） */
  document.addEventListener("click", (e) => {
    if (state.view !== "world" || !ed() || !ed().preview) return;
    const t = e.target.closest('[data-ed-act="pv-close"]');
    if (t) {
      e.preventDefault();
      e.stopPropagation();
      window.MTA.closePreview(state);
    }
  }, true);

  function mainClicks(e) {
    if (state.pickerOpen && !e.target.closest("[data-picker]") && !e.target.closest('[data-act="picker"]')) {
      state.pickerOpen = false;
      const p = $("[data-picker]");
      if (p) { p.remove(); $('[data-act="picker"]').classList.remove("open"); }
    }
    const go = e.target.closest("[data-go]");
    if (go) { e.preventDefault(); navigate(go.dataset.go); return; }
    const open = e.target.closest("[data-open]");
    if (open) { e.preventDefault(); navigate("tenant:" + open.dataset.open); return; }
    const ten = e.target.closest("[data-tenant]");
    if (ten) {
      e.preventDefault();
      state.tenant = ten.dataset.tenant || null;
      state.pickerOpen = false;
      state.ed = null;
      if (state.tenant) {
        resetLogs();
        if (state.view === "dash") state.view = "tenant";
      }
      render();
      window.scrollTo(0, 0);
      return;
    }
    const range = e.target.closest("[data-range]");
    if (range) { state.range = range.dataset.range; render(); return; }
    const focus = e.target.closest("[data-focus]");
    if (focus) {
      const id = focus.dataset.focus;
      state.focus = state.focus === id ? null : id;
      render();
      return;
    }
    const tab = e.target.closest("[data-tab]");
    if (tab) { state.logTab = tab.dataset.tab; state.logSel = null; render(); return; }
    const lr = e.target.closest("[data-log]");
    if (lr) { state.logSel = state.logSel === lr.dataset.log ? null : lr.dataset.log; if (state.logTab === "query") render(); return; }
    const world = e.target.closest("[data-world]");
    if (world) { state.worldId = world.dataset.world; navigate("world"); return; }

    const srv = e.target.closest("[data-server-card]");
    if (srv) {
      e.preventDefault();
      doNavigate("server:" + srv.dataset.serverCard);
      return;
    }

    /* --- アドオン管理 --- */
    const adSrv = e.target.closest("[data-addon-server]");
    if (adSrv) {
      e.preventDefault();
      doNavigate("tenant:" + adSrv.dataset.addonServer);
      state.view = "addons";
      state.addonOpen = null;
      render();
      window.scrollTo(0, 0);
      return;
    }
    const adSw = e.target.closest("[data-addon]");
    if (adSw) {
      e.preventDefault();
      if (adSw.disabled) return;
      window.MTV.toggleAddon(adSw.dataset.addon);
      return;
    }
    const adExp = e.target.closest("[data-addon-exp]");
    if (adExp) {
      e.preventDefault();
      const id = adExp.dataset.addonExp;
      state.addonOpen = state.addonOpen === id ? null : id;
      render();
      return;
    }
    const adCat = e.target.closest("[data-addon-cat]");
    if (adCat) { state.addonCat = adCat.dataset.addonCat; render(); return; }
    const adState = e.target.closest("[data-addon-state]");
    if (adState) { state.addonState = adState.dataset.addonState; render(); return; }

    const act = e.target.closest("[data-act]");
    if (!act) return;
    const a = act.dataset.act;
    if (a === "picker") { e.preventDefault(); state.pickerOpen = !state.pickerOpen; render(); return; }
    if (a === "focus-off") { e.preventDefault(); state.focus = null; render(); return; }
    if (a === "log-toggle") { state.playing = !state.playing; render(); return; }
    if (a === "log-export") { toast("ログを CSV として書き出しました（プロトタイプ）"); return; }
    if (a === "audit-export") { toast("監査ログを CSV として書き出しました（プロトタイプ）"); return; }
    if (a === "new-tenant") { toast("テナント作成は未実装です"); return; }
    if (a === "addon-add") { toast("アドオンの追加はカタログから行えます（プロトタイプ）"); return; }
    if (a === "addon-export") { toast("アドオン構成を JSON で書き出しました（プロトタイプ）"); return; }
    if (a === "settings") { toast("テナント設定は未実装です"); return; }
    if (a === "limits") { toast("アクセス制限は未実装です"); return; }
    if (a === "member-edit") { toast("メンバー編集は未実装です"); return; }
    if (a === "token-revoke") { toast("トークンを失効しました"); return; }
    if (a === "open-public") { e.preventDefault(); toast("参加者ページは別プロジェクトで公開されます"); return; }
  }

  function editClicks(e) {
    const stopEl = e.target.closest("[data-stop]");
    if (!stopEl && e.target.classList.contains("vm-scrim")) {
      ed().dialog = null; render(); return;
    }

    /* 他の画面への遷移（左レール / パンくず） */
    const go = e.target.closest("[data-go]");
    if (go) {
      e.preventDefault();
      navigate(go.dataset.go);
      return;
    }

    /* パネル開閉 */
    const pn = e.target.closest("[data-ed-panel]");
    if (pn) { e.preventDefault(); togglePanel(pn.dataset.edPanel); return; }

    /* 何かを選ぶとプロパティパネルを開く */
    const ensureProps = () => { if (!ed().panels.props) { ed().panels.props = true; window.MTA.refreshPanels(); } };

    /* 操作ボタン */
    const act = e.target.closest("[data-ed-act]");
    if (act) {
      // モーダル内のクリックがスパン等の祖先に誤って拾われないようにする
      if (stopEl && !stopEl.contains(act)) return;
      handleAct(e, act, ensureProps);
      return;
    }

    /* カテゴリの折りたたみ */
    const grp = e.target.closest("[data-ed-grp]");
    if (grp) {
      e.preventDefault();
      const k = grp.dataset.edGrp;
      const E = ed();
      E.collapsed = E.collapsed || {};
      E.collapsed[k] = !E.collapsed[k];
      window.MTA.refreshOutliner();
      return;
    }

    /* ワールドタブ */
    const wt = e.target.closest("[data-worldtab]");
    if (wt) {
      e.preventDefault();
      const id = wt.dataset.worldtab;
      if (id !== ed().worldId) {
        if (ed().dirty) {
          ed().dialog = "leave";
          state.navBlocked = "worldtab:" + id;
          render();
          return;
        }
        switchWorld(id);
      }
      return;
    }

    const mode = e.target.closest("[data-ed-mode]");
    if (mode) {
      ed().mode = mode.dataset.edMode;
      window.ME.setMode(ed().mode);
      $$("[data-ed-mode]").forEach((b) => b.classList.toggle("on", b.dataset.edMode === ed().mode));
      window.MTA.paintStatus();
      return;
    }

    const view = e.target.closest("[data-ed-view]");
    if (view) { window.ME.setView(view.dataset.edView); return; }

    const world = e.target.closest("[data-ed-sel-world]");
    if (world) {
      ed().selKind = "world";
      ed().selected = [];
      window.ME.select([]);
      ensureProps();
      window.MTA.refreshInspector();
      window.MTA.refreshOutliner();
      return;
    }

    const vis = e.target.closest("[data-ed-vis]");
    if (vis) {
      e.stopPropagation();
      const id = vis.dataset.edVis;
      const o = ed().objects.find((x) => x.id === id);
      if (o) {
        window.MTA.pushUndo(state);
        o.visible = o.visible === false;
        window.ME.setVisible(id, o.visible);
        ed().dirty = true;
        window.MTA.refreshOutliner();
        window.MTA.paintStatus();
      }
      return;
    }

    const obj = e.target.closest("[data-ed-obj]");
    if (obj) {
      const id = obj.dataset.edObj;
      if (e.shiftKey) {
        const cur = ed().selected.slice();
        const i = cur.indexOf(id);
        if (i >= 0) cur.splice(i, 1); else cur.push(id);
        ed().selected = cur;
        window.ME.select(cur);
      } else {
        ed().selected = [id];
        window.ME.select([id]);
      }
      ed().selKind = "obj";
      ensureProps();
      window.MTA.refreshInspector();
      window.MTA.refreshOutliner();
      window.MTA.paintStatus();
      return;
    }

    const page = e.target.closest("[data-ed-page]");
    if (page) {
      const o = ed().objects.find((x) => x.id === ed().selected[0]);
      if (!o) return;
      window.MTA.pushUndo(state);
      const max = o.props.pages || 4;
      o.props.page = Math.max(1, Math.min(max, (o.props.page || 1) + Number(page.dataset.edPage)));
      window.ME.updateObject(o);
      ed().dirty = true;
      window.MTA.refreshInspector();
      window.MTA.paintStatus();
      return;
    }

    /* セクション開閉 */
    const secBtn = e.target.closest("[data-ed-sec]");
    if (secBtn) {
      const k = secBtn.dataset.edSec;
      ed().sec[k] = ed().sec[k] === false;
      const c = secBtn.closest(".vsec-c");
      if (c) c.classList.toggle("open", ed().sec[k] !== false);
      return;
    }

    /* エクスプローラ */
    if (ed().explorer.open) {
      const crumb = e.target.closest("[data-ex-crumb]");
      if (crumb) {
        e.preventDefault();
        const i = Number(crumb.dataset.exCrumb);
        const folder = crumb.dataset.exFolder;
        const ex = ed().explorer;
        if (folder) ex.path = [folder];
        else ex.path = ex.path.slice(0, i);
        ex.sel = null; ex.q = "";
        window.MTA.paintExplorer();
        return;
      }
      const dir = e.target.closest("[data-ex-open]");
      if (dir) {
        e.preventDefault();
        const ex = ed().explorer;
        ex.path = ex.path.concat(dir.dataset.exOpen);
        ex.sel = null; ex.q = "";
        window.MTA.paintExplorer();
        return;
      }
      const row = e.target.closest("[data-ex-file]");
      if (row) {
        e.preventDefault();
        ed().explorer.sel = row.dataset.exFile;
        window.MTA.paintExplorer();
        return;
      }
      if (e.target.matches("[data-ex-scrim]")) {
        window.MTA.closeExplorer(state);
        return;
      }
    }

    /* 右クリックメニュー外側→閉じる */
    if (ed().ctx && !e.target.closest("[data-ctx]") && !e.target.closest("[data-ed-act^=\"ctx-\"]")) {
      ed().ctx = null;
      const m = $("[data-ctx]");
      if (m) m.remove();
    }
    if (ed().ctxWorld && !e.target.closest("[data-ctxw]") && !e.target.closest("[data-ed-act^=\"wt-\"]")) {
      ed().ctxWorld = null;
      const m = $("[data-ctxw]");
      if (m) m.remove();
    }

    /* プレビュー外側→閉じる */
    if (ed().preview && (e.target.closest("[data-ed-act='pv-close']") || e.target.matches(".vm-scrim"))) {
      e.preventDefault(); window.MTA.closePreview(state); return;
    }

    /* セグメント */
    const optSeg = e.target.closest(".vseg[data-ed-opt] button");
    if (optSeg) {
      const seg = optSeg.closest(".vseg");
      seg.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      optSeg.classList.add("on");
      const [grp, k] = seg.dataset.edOpt.split(".");
      const o = ed().objects.find((x) => x.id === ed().selected[0]);
      if (o) {
        o.options = o.options || {};
        o.options[grp] = o.options[grp] || defaultOption(grp);
        o.options[grp][k] = optSeg.dataset.v;
        ed().dirty = true;
        window.ME.updateObject(o);
        window.MTA.paintStatus();
        window.MTA.refreshInspector();
      }
      return;
    }

    const segBtn = e.target.closest(".vseg[data-ed-prop] button, .vseg[data-ed-lod] button");
    if (segBtn) {
      const seg = segBtn.closest(".vseg");
      seg.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      segBtn.classList.add("on");
      if (seg.dataset.edLod) {
        ed().settings[seg.dataset.edLod] = segBtn.dataset.v;
        ed().dirty = true;
        window.MTA.paintStatus();
      } else {
        const o = ed().objects.find((x) => x.id === ed().selected[0]);
        if (o) {
          o.props[seg.dataset.edProp] = segBtn.dataset.v;
          ed().dirty = true;
          window.ME.rebuild(o);
          window.MTA.paintStatus();
        }
      }
      return;
    }
  }

  function handleAct(e, el, ensureProps) {
    const a = el.dataset.edAct;
    const E = ed();
    e.preventDefault();

    if (a === "close-dialog") { E.dialog = null; render(); return; }
    if (a === "undo") { undo(); return; }
    if (a === "redo") { redo(); return; }
    if (a === "draft") { save(false); return; }
    if (a === "wt-rename") {
      const cw = E.ctxWorld;
      E.ctxWorld = null;
      if (!cw) { window.MTA.refreshTop(); return; }
      const t = D.TENANTS.find((x) => x.id === state.tenant);
      const w = t && t.worlds.find((x) => x.id === cw.id);
      if (!w) { window.MTA.refreshTop(); return; }
      const nm = window.prompt("ワールド名を変更", w.name);
      if (nm && nm.trim()) {
        w.name = nm.trim();
        if (cw.id === E.worldId) E.worldName = w.name;
        window.MT.toast("ワールド名を変更しました");
      }
      window.MT.render();
      requestAnimationFrame(() => {
        window.MTA.mountScene(state);
        window.MTA.bindSplitter();
        window.MTA.bindDropzones();
      });
      return;
    }
    if (a === "wt-delete") {
      const cw = E.ctxWorld;
      E.ctxWorld = null;
      const t = D.TENANTS.find((x) => x.id === state.tenant);
      if (!cw || !t || t.worlds.length <= 1) {
        window.MTA.refreshTop();
        window.MT.toast("最後の1つは削除できません");
        return;
      }
      const w = t.worlds.find((x) => x.id === cw.id);
      t.worlds = t.worlds.filter((x) => x.id !== cw.id);
      E.worlds = t.worlds;
      window.MT.toast((w ? w.name : "ワールド") + " を削除しました");
      if (cw.id === E.worldId) switchWorld(t.worlds[0].id);
      else { window.MT.render(); requestAnimationFrame(() => { window.MTA.mountScene(state); window.MTA.bindSplitter(); }); }
      return;
    }

    if (a === "world-add") {
      const t = D.TENANTS.find((x) => x.id === state.tenant);
      if (!t) return;
      const n = t.worlds.length + 1;
      const id = "w" + Date.now().toString(36).slice(-4);
      t.worlds.push({ id, name: `新しいワールド ${n}`, players: 0, cap: 200, status: "online", size: 12, version: "v1" });
      E.worldName = `新しいワールド ${n}`;
      switchWorld(id);
      window.MT.toast("ワールドを追加しました");
      return;
    }
    if (a === "explorer") { window.MTA.openExplorer(state); return; }

    /* --- 右クリックメニュー --- */
    if (a.startsWith("ctx-")) {
      const f = E.files.find((x) => x.id === (E.ctx && E.ctx.id));
      E.ctx = null;
      if (a === "ctx-close") { window.MTA.paintExplorer(); return; }
      if (!f) { window.MTA.paintExplorer(); return; }
      if (a === "ctx-preview") {
        E.preview = { id: f.id, page: 1, pages: 3 };
        E.ctx = null;
        window.MTA.paintCtx();
        window.MTA.paintPreview();
        return;
      }
      if (a === "ctx-rename") {
        const nm = window.prompt("新しいファイル名", f.name);
        if (nm && nm.trim()) f.name = nm.trim();
        window.MTA.paintExplorer();
        return;
      }
      if (a === "ctx-copy") {
        const ext = f.name.includes(".") ? "." + f.name.split(".").pop() : "";
        const base = ext ? f.name.slice(0, -ext.length) : f.name;
        const copy = Object.assign({}, f, {
          id: "f-" + Math.random().toString(36).slice(2, 7),
          name: `${base} のコピー${ext}`
        });
        E.files.unshift(copy);
        window.MTA.paintExplorer();
        window.MT.toast("ファイルをコピーしました");
        return;
      }
      if (a === "ctx-place") {
        window.MTA.placeFromFile(state, f);
        window.MTA.closeExplorer(state);
        window.MT.toast(f.name + " を配置しました");
        return;
      }
      if (a === "ctx-del") {
        E.files = E.files.filter((x) => x.id !== f.id);
        E.explorer.sel = null;
        window.MTA.paintExplorer();
        window.MT.toast(f.name + " を削除しました");
        return;
      }
      window.MTA.paintExplorer();
      return;
    }

    /* --- プレビュー --- */
    if (a === "pv-close") { window.MTA.closePreview(state); return; }
    if (a === "pv-rot") {
      const v = el.dataset.v;
      window.MTA.pvRotate(v);
      return;
    }
    if (a === "pv-page") {
      const d = Number(el.dataset.v);
      const p = E.preview;
      p.page = Math.max(1, Math.min(p.pages || 4, (p.page || 1) + d));
      const host = document.querySelector("[data-pvpdf]");
      if (host) {
        const wrap = document.createElement("div");
        wrap.innerHTML = V.previewHtml(E);
        const nb = wrap.querySelector("[data-pvpdf]");
        if (nb) host.replaceWith(nb);
      }
      const pg = document.querySelector(".pv3d-pg");
      if (pg) pg.textContent = `${p.page} / ${p.pages || 4}`;
      return;
    }
    if (a === "split-reset") { E.split = 46; window.MTA.refreshInspector(); return; }
    if (a === "ex-close") { window.MTA.closeExplorer(state); return; }
    if (a === "ex-up") {
      E.explorer.path = E.explorer.path.slice(0, -1);
      E.explorer.sel = null;
      window.MTA.paintExplorer();
      return;
    }
    if (a === "ex-view") {
      E.explorer.view = el.dataset.v;
      window.MTA.paintExplorer();
      return;
    }
    if (a === "ex-place") {
      const f = E.files.find((x) => x.id === E.explorer.sel);
      if (!f) return;
      window.MTA.placeFromFile(state, f);
      window.MTA.closeExplorer(state);
      window.MT.toast(f.name + " を配置しました");
      return;
    }
    if (a === "ex-del") {
      const id = E.explorer.sel;
      if (!id) return;
      const f = E.files.find((x) => x.id === id);
      E.files = E.files.filter((x) => x.id !== id);
      E.explorer.sel = null;
      window.MTA.paintExplorer();
      window.MT.toast((f ? f.name : "ファイル") + " を削除しました");
      return;
    }
    if (a === "reset-tf") {
      const o = E.objects.find((x) => x.id === E.selected[0]);
      if (!o) return;
      window.MTA.pushUndo(state);
      o.pos = [0, 0, 0]; o.rot = [0, 0, 0]; o.scale = [1, 1, 1];
      E.dirty = true;
      window.ME.updateObject(o);
      window.MTA.refreshInspector();
      window.MTA.paintStatus();
      return;
    }
    if (a === "publish") { save(true); return; }
    if (a === "preview") { E.dialog = "preview"; render(); return; }
    if (a === "preview-open") { E.dialog = null; render(); toast("プレビューは新規タブで開きます（プロトタイプ）"); return; }
    if (a === "history") { E.dialog = "history"; render(); return; }
    if (a === "restore") {
      const i = Number(el.dataset.i);
      window.MTA.pushUndo(state);
      const h = E.history[i];
      E.objects = V.seedObjects();
      E.dirty = true;
      E.dialog = null;
      E.selected = [];
      E.history.unshift({ at: "たった今", who: "nagi", msg: `「${h.msg}」に復元`, published: false });
      window.MTA.rerenderAll(state);
      toast("履歴から復元しました");
      return;
    }
    if (a === "json") {
      E.json = JSON.stringify({ world: E.worldName, settings: E.settings, objects: E.objects }, null, 2);
      E.jsonErr = "";
      E.dialog = "json";
      render();
      return;
    }
    if (a === "json-apply") {
      try {
        const o = JSON.parse($("[data-ed-json]").value);
        window.MTA.pushUndo(state);
        E.objects = o.objects;
        if (o.settings) E.settings = o.settings;
        if (o.world) E.worldName = o.world;
        E.dirty = true;
        E.dialog = null;
        E.selected = [];
        window.MTA.rerenderAll(state);
        toast("JSON を適用しました");
      } catch (err) {
        E.jsonErr = err.message;
        render();
      }
      return;
    }
    if (a === "json-copy") {
      const ta = $("[data-ed-json]");
      if (ta) { ta.select(); document.execCommand && document.execCommand("copy"); toast("JSON をコピーしました"); }
      return;
    }
    if (a === "json-replace") {
      const ta = $("[data-ed-json]");
      const f = $("[data-ed-jsonfind]");
      const r = $("[data-ed-jsonrep]");
      if (ta && f && f.value) { ta.value = ta.value.split(f.value).join(r.value || ""); toast("置換しました"); }
      return;
    }
    if (a === "snap") {
      E.snapOn = !E.snapOn;
      window.ME.setSnap(E.snapOn, E.snap);
      const b = $('[data-ed-act="snap"]');
      if (b) {
        b.classList.toggle("on", E.snapOn);
        const i = b.querySelector("i");
        if (i) i.textContent = E.snapOn ? E.snap : "—";
      }
      window.MTA.paintStatus();
      return;
    }
    if (a === "focus") { window.ME.focus(); return; }
    if (a === "theme") {
      E.theme = E.theme === "dark" ? "light" : "dark";
      window.ME.setTheme(E.theme);
      const root = $(".wed-root");
      if (root) root.dataset.sceneTheme = E.theme;
      return;
    }
    if (a === "clear-cache") {
      E.dirty = false;
      const l = $("[data-loading]");
      if (l) l.classList.add("on");
      window.MTA.rerenderAll(state);
      toast("キャッシュを消して再読み込みしました");
      return;
    }
    if (a === "assets-open") {
      if (!E.panels.assets) { E.panels.assets = true; window.MTA.refreshPanels(); }
      return;
    }
    if (a === "collapse-left") { E.panels.outliner = false; window.MTA.refreshPanels(); return; }
    if (a === "collapse-right") { E.panels.props = false; window.MTA.refreshPanels(); return; }
    if (a === "dupe") {
      const o = E.objects.find((x) => x.id === E.selected[0]);
      if (!o) return;
      window.MTA.pushUndo(state);
      const n = JSON.parse(JSON.stringify(o));
      n.id = "o-" + Math.random().toString(36).slice(2, 7);
      n.name = o.name + " (2)";
      n.pos = [o.pos[0] + 1, o.pos[1], o.pos[2] + 1];
      E.objects.push(n);
      E.selected = [n.id];
      E.dirty = true;
      window.MTA.rerenderAll(state);
      return;
    }
    if (a === "del") {
      const id = E.selected[0];
      if (!id) return;
      window.MTA.pushUndo(state);
      E.objects = E.objects.filter((x) => x.id !== id);
      E.selected = [];
      E.dirty = true;
      window.MTA.rerenderAll(state);
      toast("削除しました");
      return;
    }
    if (a === "del-multi") {
      window.MTA.pushUndo(state);
      E.objects = E.objects.filter((x) => !E.selected.includes(x.id));
      E.selected = [];
      E.dirty = true;
      window.MTA.rerenderAll(state);
      return;
    }
    if (a === "align-x" || a === "align-y") {
      window.MTA.pushUndo(state);
      const k = a === "align-x" ? 0 : 1;
      const first = E.objects.find((x) => x.id === E.selected[0]);
      if (!first) return;
      const v = first.pos[k];
      E.selected.forEach((id) => { const o = E.objects.find((x) => x.id === id); if (o) o.pos[k] = v; });
      E.dirty = true;
      window.MTA.rerenderAll(state);
      return;
    }
    if (a === "plane-tags") { toast("タグ編集は未実装です（プロトタイプ）"); return; }
    if (a === "file-del") { toast("ファイルを削除しました（プロトタイプ）"); return; }
    if (a === "leave-cancel") {
      E.dialog = null; state.navBlocked = null; render(); return;
    }
    if (a === "leave-save") {
      save(false);
      const t = state.navBlocked;
      state.navBlocked = null; E.dialog = null;
      if (t && t.startsWith("worldtab:")) switchWorld(t.slice(9));
      else if (t) doNavigate(t); else render();
      return;
    }
    if (a === "leave-discard") {
      E.dirty = false;
      const t = state.navBlocked;
      state.navBlocked = null; E.dialog = null;
      if (t && t.startsWith("worldtab:")) switchWorld(t.slice(9));
      else if (t) doNavigate(t); else render();
      return;
    }
  }

  /* ---------- 入力 ---------- */
  document.addEventListener("input", (e) => {
    if (state.view !== "world" || !ed()) {
      const aq = e.target.closest("[data-addon-q]");
      if (aq) {
        state.addonQ = aq.value;
        const pos = aq.selectionStart;
        render();
        const nf = $("[data-addon-q]");
        if (nf) { nf.focus(); nf.setSelectionRange(pos, pos); }
        return;
      }
      const f = e.target.closest("[data-filter]");
      if (f) {
        const k = f.dataset.filter;
        if (k === "q") {
          state.filter.q = f.value;
          const pos = f.selectionStart;
          render();
          const nf = $('[data-filter="q"]');
          if (nf) { nf.focus(); nf.setSelectionRange(pos, pos); }
        } else if (k === "audit") filterAudit(f.value, $('[data-filter="auditact"]').value);
      }
      return;
    }
    const E = ed();

    const exq = e.target.closest("[data-ex-q]");
    if (exq) {
      ed().explorer.q = exq.value;
      const pos = exq.selectionStart;
      window.MTA.paintExplorerBody();
      const nf = document.querySelector("[data-ex-q]");
      if (nf) { nf.focus(); nf.setSelectionRange(pos, pos); }
      return;
    }

    const f = e.target.closest("[data-ed-filter]");
    if (f) {
      E.q = f.value;
      const pos = f.selectionStart;
      window.MTA.refreshOutliner();
      const nf = document.querySelector("[data-ed-filter]");
      if (nf) { nf.focus(); nf.setSelectionRange(pos, pos); }
      return;
    }

    const nm = e.target.closest("[data-ed-name]");
    if (nm) {
      const o = E.objects.find((x) => x.id === E.selected[0]);
      if (o) {
        o.name = nm.value;
        E.dirty = true;
        const t = document.querySelector(".vpanel.right .vp-title");
        if (t) t.textContent = o.name;
        const orow = document.querySelector(`[data-ed-obj="${o.id}"] .nm`);
        if (orow) orow.textContent = o.name;
        window.MTA.paintStatus();
      }
      return;
    }

    const wf = e.target.closest("[data-ed-world]");
    if (wf) {
      if (wf.dataset.edWorld === "name") E.worldName = wf.value;
      else E.settings[wf.dataset.edWorld] = wf.value;
      E.dirty = true;
      window.MTA.paintStatus();
      return;
    }

    const lod = e.target.closest("[data-ed-lod]");
    if (lod && lod.tagName === "INPUT") {
      if (lod.type === "range") {
        E.settings[lod.dataset.edLod] = Number(lod.value);
        const lab = lod.parentElement.querySelector("[data-lodv]");
        if (lab) lab.textContent = lod.value + " m";
      } else {
        E.settings[lod.dataset.edLod] = lod.type === "number" ? Number(lod.value) : lod.value;
      }
      E.dirty = true;
      window.MTA.paintStatus();
      return;
    }

    /* オプションのスライダー（即時反映） */
    const orng = e.target.closest('input[type="range"][data-ed-opt]');
    if (orng) {
      const [grp, k] = orng.dataset.edOpt.split(".");
      const o = E.objects.find((x) => x.id === E.selected[0]);
      if (o) {
        o.options = o.options || {};
        o.options[grp] = o.options[grp] || defaultOption(grp);
        o.options[grp][k] = Number(orng.value);
        E.dirty = true;
        window.ME.updateObject(o);
        window.MTA.paintStatus();
        const lb = orng.parentElement.querySelector(".vlbl b");
        if (lb) lb.textContent = k === "radius" ? orng.value + " m" : orng.value;
      }
      return;
    }

    const pa = e.target.closest("[data-ed-prop]");
    if (pa && pa.tagName === "INPUT" && pa.type !== "checkbox") {
      const k = pa.dataset.edProp;
      const o = E.objects.find((x) => x.id === E.selected[0]);
      if (!o) return;
      let v = pa.value;
      if (pa.type === "range" || pa.type === "number") {
        v = Number(v);
        const rv = pa.parentElement.querySelector(".rv");
        if (rv) rv.textContent = v;
      }
      const map = { px: ["pos", 0], py: ["pos", 1], pz: ["pos", 2], sx: ["scale", 0], sy: ["scale", 1], sz: ["scale", 2] };
      const rot = { rx: 0, ry: 1, rz: 2 };
      if (map[k]) o[map[k][0]][map[k][1]] = k[0] === "s" ? Math.max(0.05, v) : v;
      else if (k in rot) o.rot[rot[k]] = (v * Math.PI) / 180;
      else o.props[k] = v;
      E.dirty = true;
      if (map[k] || k in rot) window.ME.updateObject(o);
      else window.ME.rebuild(o);
      window.MTA.paintStatus();
    }
  });

  document.addEventListener("change", (e) => {
    if (state.view !== "world" || !ed()) {
      const s = e.target.closest("[data-filter]");
      if (s && s.tagName === "SELECT") {
        const k = s.dataset.filter;
        if (k === "status") state.filter.status = s.value;
        if (k === "method") state.filter.method = s.value;
        if (k === "slow") state.filter.slow = !!s.value;
        if (k === "auditact") filterAudit($('[data-filter="audit"]').value, s.value);
        render();
        return;
      }
      const r = e.target.closest("[data-role]");
      if (r) toast("ロールを変更しました（プロトタイプ）");
      return;
    }
    const E = ed();

    const wsel = e.target.closest("[data-worldsel]");
    if (wsel) {
      state.worldId = wsel.value;
      state.ed = null;
      window.MTA._mounted = null;
      render();
      return;
    }

    const cb = e.target.closest("[data-ed-visible]");
    if (cb) {
      const o = E.objects.find((x) => x.id === E.selected[0]);
      if (o) {
        o.visible = cb.checked;
        window.ME.setVisible(o.id, o.visible);
        E.dirty = true;
        window.MTA.refreshOutliner();
        window.MTA.paintStatus();
      }
      return;
    }

    const pcb = e.target.closest('[data-ed-prop][type="checkbox"]');
    if (pcb) {
      const o = E.objects.find((x) => x.id === E.selected[0]);
      if (o) {
        o.props[pcb.dataset.edProp] = pcb.checked;
        E.dirty = true;
        window.ME.rebuild(o);
        window.MTA.paintStatus();
      }
      return;
    }

    /* オプションのチェックボックス / セレクト */
    const oc = e.target.closest("[data-ed-opt]");
    if (oc) {
      const key = oc.dataset.edOpt;
      const [grp, k] = key.split(".");
      const o = ed().objects.find((x) => x.id === ed().selected[0]);
      if (!o) return;
      o.options = o.options || {};
      o.options[grp] = o.options[grp] || defaultOption(grp);
      const cur = o.options[grp];
      if (oc.type === "checkbox") cur[k] = oc.checked;
      else if (oc.type === "range") cur[k] = Number(oc.value);
      else if (oc.tagName === "SELECT") cur[k] = oc.value;
      ed().dirty = true;
      window.ME.updateObject(o);
      window.MTA.refreshOutliner();
      window.MTA.paintStatus();
      if (oc.type === "checkbox") window.MTA.refreshInspector();
      return;
    }

    /* 固有設定のチェックボックス / セレクト */
    const sel = e.target.closest("[data-ed-prop]");
    if (sel && sel.tagName === "SELECT") {
      const o = E.objects.find((x) => x.id === E.selected[0]);
      if (o) {
        o.props[sel.dataset.edProp] = sel.value;
        E.dirty = true;
        window.ME.rebuild(o);
        window.MTA.paintStatus();
      }
      return;
    }

    const lodSel = e.target.closest("select[data-ed-lod]");
    if (lodSel) {
      E.settings[lodSel.dataset.edLod] = lodSel.value;
      E.dirty = true;
      window.MTA.paintStatus();
    }
  });

  function filterAudit(q, act) {
    const qq = (q || "").toLowerCase();
    $$("[data-audit-row]").forEach((r) => {
      const okQ = !qq || r.dataset.q.includes(qq);
      const okA = !act || r.dataset.act === act;
      r.style.display = okQ && okA ? "" : "none";
    });
  }

  /* ---------- シーン選択の同期 ---------- */
  function hookEditorEvents() {
    if (!window.ME || hookEditorEvents.done) return;
    hookEditorEvents.done = true;
    window.ME.on("select", (ids) => {
      if (state.view !== "world" || !ed()) return;
      if (JSON.stringify(ed().selected) !== JSON.stringify(ids)) {
        ed().selected = ids;
        ed().selKind = ids.length ? "obj" : "world";
        ed().npanel = ids.length ? "item" : "world";
        if (!ed().panels.props && ids.length) { ed().panels.props = true; window.MTA.refreshPanels(); }
        window.MTA.refreshInspector();
        window.MTA.refreshOutliner();
        window.MTA.paintStatus();
      }
    });
    window.ME.on("transform-end", () => {
      if (!ed()) return;
      window.MTA.pushUndo(state);
      ed().dirty = true;
      window.MTA.paintStatus();
      window.MTA.refreshInspector();
    });
    window.ME.on("mode", (m) => { if (ed()) { ed().mode = m; window.MTA.paintStatus(); } });
    window.ME.on("snap", (o) => { if (ed()) { ed().snapOn = o.on; ed().snap = o.step; window.MTA.paintStatus(); } });
  }

  /* ---------- キーボード ---------- */
  document.addEventListener("keydown", (e) => {
    if (state.view !== "world" || !ed()) return;
    const tag = document.activeElement ? document.activeElement.tagName : "";
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(false); return; }
    if (inField) return;

    const k = e.key.toLowerCase();
    if (k === "v") { ed().mode = "translate"; window.ME.setMode("translate"); syncMode(); }
    else if (k === "r") { ed().mode = "rotate"; window.ME.setMode("rotate"); syncMode(); }
    else if (k === "s") { ed().mode = "scale"; window.ME.setMode("scale"); syncMode(); }
    else if (k === "f") window.ME.focus();
    else if (k === "n") {
      ed().panels.props = !ed().panels.props;
      window.MTA.refreshPanels();
    }
    else if (k === "delete" || k === "backspace") {
      if (!ed().selected.length) return;
      e.preventDefault();
      window.MTA.pushUndo(state);
      ed().objects = ed().objects.filter((o) => !ed().selected.includes(o.id));
      ed().selected = [];
      ed().dirty = true;
      window.MTA.rerenderAll(state);
    } else if (k === "escape") {
      if (ed().dialog) { ed().dialog = null; render(); }
      else if (ed().explorer.open) { window.MTA.closeExplorer(state); }
      else { ed().selected = []; window.ME.select([]); window.MTA.refreshInspector(); window.MTA.refreshOutliner(); }
    }
  });

  function syncMode() {
    $$("[data-ed-mode]").forEach((b) => b.classList.toggle("on", b.dataset.edMode === ed().mode));
    window.MTA.paintStatus();
  }

  /* ---------- ライブ更新 ---------- */
  function startLive() {
    timers.push(setInterval(() => {
      D.TENANTS.forEach((t) => {
        if (t.status === "offline") { window.MT.liveN[t.id] = 0; return; }
        const cur = window.MT.liveN[t.id] == null ? t.players : window.MT.liveN[t.id];
        const drift = Math.round((Math.random() - 0.5) * Math.max(2, t.players * 0.012));
        window.MT.liveN[t.id] = Math.max(0, Math.min(t.cap, cur + drift));
      });
      const el = $('[data-live="total"]');
      if (el) el.textContent = D.num(D.TENANTS.reduce((a, t) => a + (window.MT.liveN[t.id] == null ? t.players : window.MT.liveN[t.id]), 0));
      $$(".trow").forEach((r) => {
        const t = D.TENANTS.find((x) => x.id === r.dataset.focus);
        if (!t || t.status === "offline") return;
        const v = window.MT.liveN[t.id];
        const p = D.pct(v, t.cap);
        const vEl = r.querySelector(".v");
        if (vEl) vEl.innerHTML = `${D.num(v)}<small> / ${D.num(t.cap)}</small>`;
        const b = r.querySelector(".bar i");
        if (b) b.style.width = p.toFixed(1) + "%";
      });
    }, 2600));

    timers.push(setInterval(() => {
      if (!state.playing || state.view === "world") return;
      const t = D.TENANTS.find((x) => x.id === (state.tenant || "mmh"));
      if (!t || t.status === "offline") { state.rate = 0; return; }
      const n = 1 + Math.floor(Math.random() * 3);
      const fresh = [];
      for (let i = 0; i < n; i++) fresh.push(D.liveLog(t));
      state.logs = fresh.concat(state.logs).slice(0, 160);
      state.rate = 20 + Math.floor(Math.random() * 26);
      if (state.view === "logs" && state.logTab === "live") {
        const body = $("[data-logbody]");
        if (body) {
          const scroller = body.parentElement;
          const atTop = scroller.scrollTop < 40;
          body.innerHTML = state.logs.slice(0, 90).map((l) => V.logRowHtml(l, null)).join("");
          if (atTop) {
            const first = body.firstElementChild;
            if (first) first.classList.add("log-new");
          }
          const c = $("[data-logcount]");
          if (c) c.textContent = Math.min(90, state.logs.length);
        }
        const rEl = $("[data-rate]");
        if (rEl) rEl.textContent = D.num(state.rate);
      }
    }, 900));
  }

  document.addEventListener("click", (e) => {
    if (e.target.id === "logoutBtn") {
      sessionStorage.removeItem("mt.authed");
      location.reload();
    }
  });

  /* ---------- Tweaks ---------- */
  window.MT.applyTweaks = function (t) {
    if (t.dashMode && t.dashMode !== state.dashMode) {
      state.dashMode = t.dashMode;
      if (state.view === "dash") render();
    }
    document.documentElement.style.setProperty("--color-primary", t.accent);
    document.documentElement.style.setProperty("--color-primary-dark", t.accent === "#f38020" ? "#d96a0c" : t.accent);
    document.documentElement.style.setProperty("--color-primary-soft", t.accent + "1a");
    document.documentElement.style.setProperty("--color-primary-line", t.accent + "59");
  };
  window.MT.tweakDefaults = window.MT_TWEAKS || { dashMode: "sheet", accent: "#f38020" };
})();
