/* ワールドエディタ — 状態・操作・永続化 */
(function () {
  "use strict";
  const D = window.MTD, V = window.MTV;

  function initEd(st) {
    const t = D.TENANTS.find((x) => x.id === st.tenant) || D.TENANTS[0];
    const wid = st.worldId || (t.worlds[0] && t.worlds[0].id);
    const w = t.worlds.find((x) => x.id === wid) || t.worlds[0];
    const saved = loadDraft(st.tenant, wid);
    const ed = {
      worlds: t.worlds,
      worldId: wid,
      worldName: w ? w.name : "",
      objects: saved ? saved.objects : V.seedObjects(),
      settings: (saved && saved.settings) || {
        desc: "夜のネオン商店街。屋台と看板の灯りが路面に反射する。",
        viewDistance: 60, quality: "mid", cap: 320, sky: "#eef0f4", ambient: "night_street"
      },
      selected: [],
      selKind: "world",
      mode: "translate",
      snapOn: true, snap: 0.5,
      theme: "light",
      panels: { props: true },
      sec: { tf: true, vis: true, own: true, meta: false, world: true, lod: true, env: true, limit: false },
      split: 46,
      collapsed: {},
      q: "",
      files: V.seedFiles(),
      explorer: { open: false, path: [], q: "", view: "list", sel: null },
      ctx: null,
      preview: null,
      uploads: [],
      dirty: false,
      undo: [], redo: [],
      dialog: null,
      json: "", jsonErr: "",
      history: (saved && saved.history) || [
        { at: "11/24 09:41", who: "nagi", msg: "オブジェクト 2 件を移動", published: false },
        { at: "11/22 18:04", who: "nagi", msg: "AKARI City v14 として公開", published: true },
        { at: "11/21 14:26", who: "kitsune", msg: "同時接続上限を変更", published: true },
        { at: "11/19 10:02", who: "nagi", msg: "太鼓の音源を差し替え", published: true }
      ]
    };
    if (window.innerWidth < 900) ed.panels.props = false;
    st.ed = ed;
    return ed;
  }

  /* ---------- 保存 ---------- */
  function key(tid, wid) { return "mt.draft." + tid + "." + wid; }
  function loadDraft(tid, wid) {
    try {
      const raw = localStorage.getItem(key(tid, wid));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveDraft(st, published) {
    const ed = st.ed;
    const rec = {
      objects: ed.objects, settings: ed.settings, worldName: ed.worldName,
      history: ed.history, at: Date.now(), published: !!published
    };
    try { localStorage.setItem(key(st.tenant, ed.worldId), JSON.stringify(rec)); } catch (e) {}
  }

  /* ---------- 表示のみ更新 ---------- */
  function paintStatus() {
    const ed = window.MT.state.ed;
    if (!ed) return;
    const s = document.querySelector("[data-save-state]");
    if (s) {
      s.textContent = ed.dirty ? "未保存" : "保存済み";
      s.classList.toggle("dirty", ed.dirty);
    }
    const u = document.querySelector('[data-ed-act="undo"]');
    if (u) u.disabled = !ed.undo.length;
    const r = document.querySelector('[data-ed-act="redo"]');
    if (r) r.disabled = !ed.redo.length;
    const hc = document.querySelector("[data-hud-count]");
    if (hc) hc.textContent = ed.objects.length + " objects";
    const hs = document.querySelector("[data-hud-sel]");
    if (hs) hs.textContent = ed.selected.length ? ed.selected.length + " 選択中" : "未選択";
    const hm = document.querySelector("[data-hud-mode]");
    if (hm) hm.textContent = ed.mode === "translate" ? "移動" : ed.mode === "rotate" ? "回転" : "拡大";
  }
  window.MT_paintStatus = paintStatus;

  /* ---------- 部分再描画 ---------- */
  function refreshOutliner() {
    const st = window.MT.state, ed = st.ed;
    const host = document.querySelector(".vout-scroll");
    if (!host) return;
    const top = host.scrollTop;
    const wrap = document.createElement("div");
    wrap.innerHTML = V.inspectorHtml(ed);
    const nb = wrap.querySelector(".vout-scroll");
    if (nb) host.innerHTML = nb.innerHTML;
    host.scrollTop = top;
    bindOutlinerWheel();
  }

  /* 右パネルは必ず state から作り直す（存在判定に頼らない） */
  function refreshPanels() {
    const st = window.MT.state, ed = st.ed;
    const stage = document.querySelector(".ved-stage");
    if (!stage) return;

    const oldPanel = stage.querySelector(".vpanel.right");
    const oldPill = stage.querySelector(".vpill.right");
    if (oldPanel) oldPanel.remove();
    if (oldPill) oldPill.remove();

    if (ed.panels.props) {
      stage.classList.add("docked");
      const el = document.createElement("aside");
      el.className = "vpanel right";
      el.innerHTML = V.inspectorHtml(ed);
      stage.appendChild(el);
    } else {
      stage.classList.remove("docked");
      const b = document.createElement("button");
      b.className = "vpill right";
      b.dataset.edPanel = "props";
      b.title = "プロパティを開く";
      b.innerHTML = window.MUI.icon("server") + "<span>プロパティ</span>";
      stage.appendChild(b);
    }

    document.querySelectorAll(".vd-panels [data-ed-panel]").forEach((b) => {
      b.classList.toggle("on", !!ed.panels[b.dataset.edPanel]);
    });
    requestAnimationFrame(() => { bindSplitter(); bindOutlinerWheel(); });
  }

  const refreshInspector = refreshPanels;

  /* ---------- シーン ---------- */
  /* =========================================================
     ワールド読み込み（ロードバー付き）
     ========================================================= */
  let loadT = [];
  function clearLoad() {
    loadT.forEach((t) => clearTimeout(t));
    loadT = [];
  }

  function showLoad(st, label) {
    const ed = st.ed;
    if (!ed) return;
    clearLoad();
    ed.loading = { label, pct: 0 };
    window.MT.render();
    const steps = [18, 42, 63, 78, 90, 100];
    steps.forEach((v, i) => {
      loadT.push(setTimeout(() => {
        const e2 = window.MT.state.ed;
        if (!e2 || !e2.loading) return;
        e2.loading.pct = v;
        const fill = document.querySelector("[data-loadfill]");
        const pct = document.querySelector("[data-loadpct]");
        if (fill) fill.style.width = v + "%";
        if (pct) pct.textContent = v + "%";
      }, 90 + i * 105));
    });
    loadT.push(setTimeout(() => {
      const e2 = window.MT.state.ed;
      if (!e2) return;
      e2.loading = null;
      window.MT.render();
      requestAnimationFrame(() => {
        mountScene(window.MT.state);
        bindDropzones();
        bindSplitter();
        bindOutlinerWheel();
      });
    }, 90 + steps.length * 105 + 160));
  }

  function switchWorld(st, wid) {
    const ed = st.ed;
    if (!ed || ed.worldId === wid) return;
    const t = D.TENANTS.find((x) => x.id === st.tenant);
    const w = t && t.worlds.find((x) => x.id === wid);
    saveDraft(st, false);
    st.worldId = wid;
    st.ed = null;
    window.MT._mounted = null;
    initEd(st);
    showLoad(st, `「${w ? w.name : wid}」を読み込み中`);
  }

  function mountScene(st) {
    const host = document.querySelector("[data-canvas]");
    if (!host) { window.MTA._mounted = null; return; }
    const ed = st.ed;
    const sig = st.tenant + "/" + ed.worldId;
    if (window.ME.isMounted && host.querySelector("canvas")) {
      window.ME.select(ed.selected.slice(), false, true);
      window.MTA._mounted = sig;
      return;
    }
    const cam = window.ME.isMounted ? window.ME.getCamera() : null;
    const ok = window.ME.mount(host, {
      theme: ed.theme, objects: ed.objects, settings: ed.settings,
      snapOn: ed.snapOn, snap: ed.snap, selected: ed.selected, mode: ed.mode
    });
    if (ok && cam) window.ME.setCamera(cam);
    window.MTA._mounted = sig;
    const loading = host.querySelector("[data-loading]");
    if (loading) setTimeout(() => loading.classList.remove("on"), 380);
  }

  function rerenderAll(st) {
    window.MT.render();
    requestAnimationFrame(() => {
      mountScene(st);
      bindDropzones();
      window.MTA._mounted = st.tenant + "/" + st.ed.worldId;
    });
  }

  /* ---------- 配置 ---------- */
  function defaultProps(type) {
    const T = window.ME.TYPES[type];
    return Object.assign({}, (T && T.props) || {});
  }

  const NAME_BY_TYPE = {
    model: "3Dオブジェクト", prop: "小物", light: "ライト", spawn: "スポーン",
    teleporter: "テレポーター", taiko: "太鼓", animate: "アニメーション",
    board: "発着案内板", pdf: "PDF", smoke: "煙", cloud: "雲", plane: "機体"
  };

  function placeFromFile(st, file) {
    const ed = st.ed;
    const kind = V.kindOf(file.name);
    let type = "model";
    if (kind === "zip") type = "smoke";
    else if (kind === "vdb") type = "cloud";
    else if (kind === "pdf") type = "pdf";
    else if (kind === "png" || kind === "jpg") type = "prop";

    pushUndo(st);
    const o = {
      id: "o-" + Math.random().toString(36).slice(2, 7),
      type,
      name: file.name.replace(/\.[^.]+$/, ""),
      pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], visible: true,
      props: defaultProps(type)
    };
    if (["pdf", "smoke", "cloud"].includes(type)) o.props.file = file.name;
    ed.objects.push(o);
    ed.selected = [o.id];
    ed.selKind = "obj";
    ed.dirty = true;
    rerenderAll(st);
    return o;
  }

  /* ---------- Undo ---------- */
  function snapshot(ed) {
    return JSON.stringify({ objects: ed.objects, settings: ed.settings, worldName: ed.worldName });
  }
  function pushUndo(st) {
    const ed = (st || window.MT.state).ed;
    if (!ed) return;
    ed.undo.push(snapshot(ed));
    if (ed.undo.length > 50) ed.undo.shift();
    ed.redo.length = 0;
    paintStatus();
  }
  function applySnap(st, snap) {
    const ed = st.ed;
    const o = JSON.parse(snap);
    ed.objects = o.objects;
    ed.settings = o.settings;
    ed.worldName = o.worldName;
    ed.selected = [];
  }

  /* =========================================================
     アップロード
     ========================================================= */
  let uploadTimer = 0;
  function startUpload(st, fileNames) {
    const ed = st.ed;
    const now = Date.now();
    const added = fileNames.map((name, i) => {
      const kind = V.kindOf(name);
      const size = 1 + Math.random() * 24;
      return {
        id: "up-" + (now + i) + "-" + Math.random().toString(36).slice(2, 5),
        name, kind, size,
        progress: 0, speed: 2 + Math.random() * 6, eta: 0,
        done: false, startedAt: now
      };
    });
    added.forEach((u) => { u.eta = u.size / u.speed; });
    ed.uploads = added.concat(ed.uploads || []).slice(0, 8);
    tickUploads(st);
    if (!uploadTimer) uploadTimer = setInterval(() => tickUploads(window.MT.state), 220);
  }

  function tickUploads(st) {
    const ed = st && st.ed;
    if (!ed) return;
    let active = false;
    (ed.uploads || []).forEach((u) => {
      if (u.done) return;
      active = true;
      const step = (u.speed * 0.22) / u.size * 100;
      u.progress = Math.min(100, u.progress + step * (0.7 + Math.random() * 0.9));
      u.speed = Math.max(1.2, u.speed + (Math.random() - 0.45) * 1.1);
      u.eta = Math.max(0, ((100 - u.progress) / 100) * u.size / u.speed);
      if (u.progress >= 100) {
        u.progress = 100;
        u.done = true;
        u.eta = 0;
        onUploaded(st, u);
      }
    });
    paintUploads(st);
    if (!active) {
      clearInterval(uploadTimer);
      uploadTimer = 0;
      // 完了分を少し残してから片付ける
      setTimeout(() => {
        const e2 = window.MT.state.ed;
        if (!e2) return;
        e2.uploads = (e2.uploads || []).filter((u) => !u.done);
        paintUploads(window.MT.state);
        refreshTopBadge();
      }, 2600);
    }
  }

  function onUploaded(st, u) {
    const ed = st.ed;
    const folderId = u.kind === "zip" || u.kind === "vdb" ? "fx"
      : u.kind === "pdf" ? "docs"
      : u.kind === "png" || u.kind === "jpg" ? "textures" : "models";
    const exists = ed.files.some((f) => f.name === u.name && (f.path || [])[0] === folderId);
    if (!exists) {
      const d = new Date();
      ed.files.unshift({
        id: "f-" + Math.random().toString(36).slice(2, 7),
        path: [folderId], name: u.name, kind: u.kind, size: u.size,
        date: `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
        asset: V.assetForKind(u.kind)
      });
    }
    paintExplorer();
    refreshTopBadge();
    window.MT.toast(u.name + " をアップロードしました");
  }

  function paintUploads(st) {
    const ed = st && st.ed;
    if (!ed) return;
    const html = V.uploadRowsHtml(ed);
    document.querySelectorAll("[data-up-stack], [data-ex-ups]").forEach((host) => {
      if (host.hasAttribute("data-ex-ups")) { host.innerHTML = ed.uploads && ed.uploads.length ? html : '<div class="ex-ups-empty">アップロード中のファイルはありません</div>'; }
      else {
        host.hidden = !(ed.uploads && ed.uploads.length);
        host.innerHTML = ed.uploads && ed.uploads.length
          ? `<div class="up-stack-h">${window.MUI.icon("dl")}<b>アップロード中</b><span>${ed.uploads.filter((u) => !u.done).length} 件</span></div>${html}`
          : "";
      }
    });
    refreshTopBadge();
  }

  function refreshTopBadge() {
    const ed = window.MT.state.ed;
    const btn = document.querySelector('[data-ed-act="explorer"]');
    if (!btn || !ed) return;
    let dot = btn.querySelector(".up-dot");
    const n = (ed.uploads || []).filter((u) => !u.done).length;
    if (n) {
      if (!dot) { dot = document.createElement("i"); dot.className = "up-dot"; btn.appendChild(dot); }
      dot.textContent = n;
    } else if (dot) {
      dot.remove();
    }
  }

  /* =========================================================
     エクスプローラ
     ========================================================= */
  function openExplorer(st) {
    const ed = st.ed;
    ed.explorer.open = true;
    window.MT.render();
    requestAnimationFrame(() => {
      mountScene(st);
      bindDropzones();
    });
  }
  function closeExplorer(st) {
    const ed = st.ed;
    ed.explorer.open = false;
    ed.explorer.sel = null;
    window.MT.render();
    requestAnimationFrame(() => {
      mountScene(st);
      bindDropzones();
    });
  }
  function paintExplorer() {
    const st = window.MT.state, ed = st.ed;
    const host = document.querySelector("[data-ex]");
    if (!host) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = V.world();
    const nex = wrap.querySelector("[data-ex]");
    if (nex) host.replaceWith(nex);
    paintCtx();
    paintPreview();
    bindDropzones();
    bindFileInput();
  }

  /* 右クリックメニューだけ差し替え */
  function paintCtx() {
    const ed = window.MT.state.ed;
    const old = document.querySelector("[data-ctx]");
    if (old) old.remove();
    if (!ed.ctx) return;
    const root = document.querySelector(".wed-root");
    if (!root) return;
    const t = document.createElement("div");
    t.innerHTML = V.ctxMenuHtml(ed);
    const el = t.firstElementChild;
    if (el) root.appendChild(el);
  }

  /* プレビューモーダルだけ差し替え */
  function paintPreview() {
    const st = window.MT.state, ed = st.ed;
    const old = document.querySelector(".vpv");
    const oldScrim = old ? old.parentElement : null;
    if (oldScrim) oldScrim.remove();
    if (!ed.preview) {
      if (pv) {
        try { cancelAnimationFrame(pv.raf); pv.renderer.dispose(); } catch (e) {}
        pv = null;
      }
      return;
    }
    const root = document.querySelector(".wed-root");
    if (!root) return;
    const t = document.createElement("div");
    t.innerHTML = V.previewHtml(ed);
    const el = t.firstElementChild;
    if (el) root.appendChild(el);
    mountPreviewViewer(st);
  }

  function paintExplorerBody() {
    const st = window.MT.state, ed = st.ed;
    const host = document.querySelector("[data-ex]");
    if (!host) return;
    const body = host.querySelector("[data-ex-drop]");
    if (!body) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = V.world();
    const nb = wrap.querySelector("[data-ex-drop]");
    if (nb) body.innerHTML = nb.innerHTML;
    const sel = host.querySelector(".ex-sel");
    const f = ed.files.find((x) => x.id === ed.explorer.sel);
    if (sel) sel.textContent = f ? `${f.name} ・ ${V.KIND_LABEL[f.kind] || "ファイル"} ・ ${f.size.toFixed(1)} MB` : "ファイルを選択してください";
    const delBtn = host.querySelector('[data-ed-act="ex-del"]');
    if (delBtn) delBtn.disabled = !f;
    const placeBtn = host.querySelector('[data-ed-act="ex-place"]');
    if (placeBtn) placeBtn.disabled = !(f && f.asset);
  }

  function bindFileInput() {
    const inp = document.querySelector("[data-ex-upload]");
    if (!inp || inp.dataset.bound) return;
    inp.dataset.bound = "1";
    inp.addEventListener("change", () => {
      const files = Array.from(inp.files || []);
      if (files.length) startUpload(window.MT.state, files.map((f) => f.name));
      inp.value = "";
    });
  }

  /* =========================================================
     ドラッグ＆ドロップ（キャンバス / エクスプローラ）
     ========================================================= */
  function bindDropzones() {
    const handle = (files) => {
      if (!files || !files.length) return;
      startUpload(window.MT.state, files.map((f) => f.name));
    };

    // キャンバス
    const canvas = document.querySelector("[data-canvas]");
    if (canvas && !canvas.dataset.dnd) {
      canvas.dataset.dnd = "1";
      canvas.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        const hint = document.querySelector("[data-ex-hint]");
        if (!hint && !canvas.dataset.warned) {
          canvas.dataset.warned = "1";
          window.MT.toast("ファイルをサーバーにアップロードします");
        }
      });
      canvas.addEventListener("dragleave", () => { delete canvas.dataset.warned; });
      canvas.addEventListener("drop", (e) => {
        e.preventDefault();
        delete canvas.dataset.warned;
        handle(Array.from(e.dataTransfer.files || []));
      });
    }

    // エクスプローラ本体
    const exBody = document.querySelector("[data-ex-drop]");
    if (exBody && !exBody.dataset.dnd) {
      exBody.dataset.dnd = "1";
      exBody.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        exBody.classList.add("over");
      });
      exBody.addEventListener("dragleave", (e) => {
        if (!exBody.contains(e.relatedTarget)) exBody.classList.remove("over");
      });
      exBody.addEventListener("drop", (e) => {
        e.preventDefault();
        exBody.classList.remove("over");
        handle(Array.from(e.dataTransfer.files || []));
      });
    }
  }

  /* =========================================================
     上下分割（ドラッグ）
     ========================================================= */
  /* =========================================================
     アウトライナーのホイール量を小さく
     ========================================================= */
  function bindOutlinerWheel() {
    const sc = document.querySelector(".vout-scroll");
    if (!sc || sc.dataset.wheel) return;
    sc.dataset.wheel = "1";
    sc.addEventListener("wheel", (e) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      const step = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 120 : 1;
      sc.scrollTop += (e.deltaY * step) * 0.42;
    }, { passive: false });
  }

  /* 上部バー（ワールドタブ）とコンテキストメニューだけ差し替え */
  function refreshTop() {
    const ed = window.MT.state.ed;
    const root = document.querySelector(".wed-root");
    if (!root || !ed) return;
    const oldTop = root.querySelector(".ved-top");
    const wrap = document.createElement("div");
    wrap.innerHTML = V.world();
    const nt = wrap.querySelector(".ved-top");
    if (nt && oldTop) oldTop.replaceWith(nt);
    // メニュー
    root.querySelectorAll("[data-ctxw], [data-ctx]").forEach((m) => m.remove());
    const wm = wrap.querySelector("[data-ctxw]");
    if (wm) root.appendChild(wm);
    const cm = wrap.querySelector("[data-ctx]");
    if (cm) root.appendChild(cm);
  }

  function bindSplitter() {
    const sp = document.querySelector("[data-vsplit]");
    if (!sp || sp.dataset.bound) return;
    const panel = document.querySelector(".vpanel.right");
    const out = document.querySelector(".vout");
    if (!panel || !out) return;
    sp.dataset.bound = "1";

    const apply = (ratio) => {
      const r = Math.max(18, Math.min(82, ratio));
      window.MT.state.ed.split = Math.round(r * 10) / 10;
      out.style.flex = `0 0 ${window.MT.state.ed.split}%`;
    };

    sp.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pr = panel.getBoundingClientRect();
      document.body.classList.add("vsplit-active");
      sp.classList.add("dragging");
      const move = (ev) => {
        apply(((ev.clientY - pr.top) / pr.height) * 100);
      };
      const up = () => {
        document.body.classList.remove("vsplit-active");
        sp.classList.remove("dragging");
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      apply(((e.clientY - pr.top) / pr.height) * 100);
    });
  }

  /* =========================================================
     プレビュー（3D / PDF / FX）
     ========================================================= */
  function closePreview(st) {
    st.ed.preview = null;
    paintPreview();
    if (document.querySelector("[data-ex]")) paintExplorer();
  }

  /* 3Dモデルのプレビュー：Three.js で簡易回転表示 */
  let pv = null;
  function mountPreviewViewer(st) {
    const host = document.querySelector("[data-pv3d]");
    if (!host || !st.ed.preview) return;
    const f = st.ed.files.find((x) => x.id === st.ed.preview.id);
    if (!f) return;
    const T3 = window.THREE;
    if (!T3) return;
    if (pv) { try { pv.raf && cancelAnimationFrame(pv.raf); pv.renderer && pv.renderer.dispose(); } catch (e) {} pv = null; }

    const w = host.clientWidth || 640, h = host.clientHeight || 340;
    let renderer;
    try {
      renderer = new T3.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.domElement.style.display = "block";
    host.innerHTML = "";
    host.appendChild(renderer.domElement);

    const scene = new T3.Scene();
    const cam = new T3.PerspectiveCamera(38, w / h, 0.1, 100);
    cam.position.set(3.4, 2.6, 4.2);
    cam.lookAt(0, 0.5, 0);

    scene.add(new T3.HemisphereLight(0xffffff, 0xd8dde6, 1.05));
    const dir = new T3.DirectionalLight(0xffffff, 1.3);
    dir.position.set(4, 6, 3);
    scene.add(dir);

    const grp = new T3.Group();
    const mat = new T3.MeshStandardMaterial({ color: 0xc2ccd8, roughness: 0.68, metalness: 0.08 });
    const edge = new T3.LineBasicMaterial({ color: 0x8a92a1, transparent: true, opacity: 0.4 });
    const add = (geo, x, y, z) => {
      const m = new T3.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.add(new T3.LineSegments(new T3.EdgesGeometry(geo), edge));
      grp.add(m);
      return m;
    };
    add(new T3.BoxGeometry(1.7, 0.9, 1.7), 0, 0, 0);
    add(new T3.BoxGeometry(0.9, 1.3, 0.9), -0.2, 1.1, 0.1);
    add(new T3.BoxGeometry(0.7, 0.5, 0.7), 0.9, 0.25, -0.6);
    const roof = new T3.Mesh(new T3.ConeGeometry(1.35, 0.42, 4), mat);
    roof.position.y = 1.95; roof.rotation.y = Math.PI / 4;
    grp.add(roof);
    grp.position.y = -0.55;
    scene.add(grp);

    const grid = new T3.GridHelper(8, 16, 0xd0d6df, 0xe3e7ec);
    scene.add(grid);

    pv = { renderer, scene, cam, grp, raf: 0, spin: 0.004, drag: null };

    const canvas = renderer.domElement;
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", (e) => {
      pv.drag = { x: e.clientX, y: e.clientY, ry: grp.rotation.y, rx: grp.rotation.x };
      canvas.style.cursor = "grabbing";
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!pv || !pv.drag) return;
      grp.rotation.y = pv.drag.ry + (e.clientX - pv.drag.x) * 0.01;
      grp.rotation.x = Math.max(-0.6, Math.min(0.6, pv.drag.rx + (e.clientY - pv.drag.y) * 0.006));
    });
    canvas.addEventListener("pointerup", () => { if (pv) { pv.drag = null; canvas.style.cursor = "grab"; } });

    const loop = () => {
      if (!pv || pv.renderer !== renderer) return;
      if (!pv.drag) grp.rotation.y += pv.spin;
      renderer.render(scene, cam);
      pv.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  function pvRotate(v) {
    if (!pv) return;
    if (v === "left") pv.grp.rotation.y -= 0.5;
    else if (v === "right") pv.grp.rotation.y += 0.5;
    else { pv.grp.rotation.set(0, 0, 0); }
  }

  window.MTA = {
    _mounted: null,
    initEd, loadDraft, saveDraft, key, defaultProps,
    paintStatus, refreshOutliner, refreshInspector, refreshPanels,
    mountScene, rerenderAll, placeFromFile, pushUndo, applySnap, snapshot,
    startUpload, tickUploads, paintUploads, refreshTopBadge,
    openExplorer, closeExplorer, paintExplorer, paintExplorerBody, bindDropzones, bindFileInput,
    bindSplitter, bindOutlinerWheel, paintCtx, paintPreview, refreshTop,
    showLoad, switchWorld, clearLoad,
    closePreview, mountPreviewViewer, pvRotate,
    NAME_BY_TYPE
  };
})();
