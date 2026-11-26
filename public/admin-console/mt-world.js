/* ワールド編集画面 — Blender 風レイアウト
   右パネル = アウトライナー（上）+ カテゴリ別プロパティ（下）
   左パネル / ワークスペースタブは廃止。ファイルはエクスプローラーで管理。 */
(function () {
  "use strict";
  const D = window.MTD, U = window.MUI;
  const { esc, icon } = U;
  const UU = window.MUI;
  const V = window.MTV;
  const TYPES = () => window.ME.TYPES;

  /* =========================================================
     初期オブジェクト
     ========================================================= */
  function seedObjects() {
    const base = [
      { type: "spawn", name: "初期スポーン", pos: [0, 0, 3.5], props: { yaw: 0 } },
      { type: "model", name: "中央ステージ", pos: [0, 0, 0], scale: [3.4, 0.5, 2.6], props: {} },
      { type: "model", name: "Yofukashi への扉", pos: [-3.5, 0, -3], options: { teleporter: { on: true, to: "yofukashi", radius: 2.5, mode: "manual", prompt: true, key: "E" } } },
      { type: "board", name: "発着案内板", pos: [3.6, 0, 2.2], rot: [0, -0.5, 0], props: { filter: "all", rows: 7 } },
      { type: "model", name: "太鼓 A", pos: [-4.4, 0, 2.6], options: { taiko: { on: true, sound: "taiko_01", volume: 0.8, radius: 2, prompt: true } } },
      { type: "light", name: "街灯 01", pos: [4.6, 2.6, -1.4], props: { color: "#ffd9a0", intensity: 1.5, distance: 9 } },
      { type: "animate", name: "案内アバター", pos: [2.2, 0, -2.2], props: { clip: "wave", speed: 1 } },
      { type: "pdf", name: "館内案内図", pos: [-2.4, 0, 1.4], rot: [0, 0.7, 0], props: { file: "館内案内図.pdf", pages: 4, page: 1 } }
    ];
    return base.map((o, i) => ({
      id: "o" + (i + 1), type: o.type, name: o.name,
      pos: o.pos || [0, 0, 0], rot: o.rot || [0, 0, 0], scale: o.scale || [1, 1, 1],
      visible: true, props: o.props || {}, options: o.options || {}
    }));
  }
  V.seedObjects = seedObjects;

  /* =========================================================
     サーバー上のファイル
     ========================================================= */
  const FOLDERS = [
    { id: "models", label: "3Dモデル" },
    { id: "fx", label: "煙・雲" },
    { id: "docs", label: "ドキュメント" },
    { id: "textures", label: "テクスチャ" }
  ];
  V.FOLDERS = FOLDERS;

  function seedFiles() {
    return [
      { id: "f01", path: ["models"], name: "校舎_v3.glb", kind: "glb", size: 8.4, date: "11/22 18:04", asset: "a1" },
      { id: "f02", path: ["models"], name: "体育館.glb", kind: "glb", size: 6.1, date: "11/22 17:41", asset: "a2" },
      { id: "f03", path: ["models"], name: "桜の木.glb", kind: "glb", size: 2.3, date: "11/20 09:12", asset: "a3" },
      { id: "f04", path: ["models"], name: "ベンチ.glb", kind: "glb", size: 0.4, date: "11/18 13:55", asset: "a4" },
      { id: "f05", path: ["models"], name: "自販機.glb", kind: "glb", size: 0.6, date: "11/18 13:52", asset: "a5" },
      { id: "f06", path: ["models"], name: "アバターA.glb", kind: "glb", size: 4.2, date: "11/17 10:30", asset: "a7" },
      { id: "f07", path: ["models"], name: "機体T-01.glb", kind: "glb", size: 5.2, date: "11/15 16:08", asset: "a13" },
      { id: "f08", path: ["fx"], name: "煙_体育館.zip", kind: "zip", size: 12.8, date: "11/20 11:26", asset: "a9" },
      { id: "f09", path: ["fx"], name: "層雲.vdb", kind: "vdb", size: 24.1, date: "11/18 15:02", asset: "a10" },
      { id: "f10", path: ["fx"], name: "積雲.vdb", kind: "vdb", size: 31.7, date: "11/18 14:50", asset: "a11" },
      { id: "f11", path: ["docs"], name: "案内図.pdf", kind: "pdf", size: 0.9, date: "11/17 09:44", asset: "a12" },
      { id: "f12", path: ["docs"], name: "館内案内図.pdf", kind: "pdf", size: 1.2, date: "11/17 09:40", asset: "a12" },
      { id: "f13", path: ["docs"], name: "ワールド仕様書.pdf", kind: "pdf", size: 0.6, date: "11/10 18:20", asset: "a12" },
      { id: "f14", path: ["textures"], name: "ネオン_夜.png", kind: "png", size: 3.8, date: "11/19 20:11", asset: null },
      { id: "f15", path: ["textures"], name: "路面_アスファルト.png", kind: "png", size: 5.4, date: "11/19 20:09", asset: null }
    ];
  }
  V.seedFiles = seedFiles;

  const KIND_LABEL = { glb: "3Dモデル", gltf: "3Dモデル", zip: "煙データ", vdb: "雲データ", pdf: "PDF", png: "画像", jpg: "画像" };
  const kindOf = (name) => {
    const e = (name.split(".").pop() || "").toLowerCase();
    return KIND_LABEL[e] ? e : "other";
  };
  const assetForKind = (k) => (k === "zip" ? "a9" : k === "vdb" ? "a10" : k === "pdf" ? "a12" : k === "png" || k === "jpg" ? null : "a1");
  V.kindOf = kindOf; V.assetForKind = assetForKind; V.KIND_LABEL = KIND_LABEL;

  /* =========================================================
     上部バー
     ========================================================= */
  function topHtml(ed, t) {
    return `<div class="ved-top">
      <a class="vd-brand" href="#" data-go="dash" title="テナント一覧"><img src="assets/icon-192.png" alt=""></a>
      <div class="vd-crumb">
        <a href="#" data-go="worldpick">${esc(t.name)}</a><span>/</span>
        <b>${esc(ed.worldName || "")}</b>
      </div>
      <div class="vd-worldtabs">
        ${t.worlds.map((w) => `<button data-worldtab="${esc(w.id)}" draggable="true" class="${w.id === ed.worldId ? "on" : ""}" title="${esc(w.name)}　（右クリックで名前変更 ・ ドラッグで並べ替え）">${esc(w.name)}</button>`).join("")}
        <span class="vsep"></span>
        <button class="vadd" data-ed-act="world-add" title="ワールドを追加">${icon("plus")}</button>
      </div>
      <button class="vd-file" data-ed-act="explorer" title="サーバー上のファイル">
        ${icon("server")}<span>ファイル</span>
        ${ed.uploads && ed.uploads.length ? `<i class="up-dot">${ed.uploads.length}</i>` : ""}
      </button>
      <div class="vd-grow"></div>
      <div class="vd-panels"><button class="${ed.panels.props ? "on" : ""}" data-ed-panel="props" title="プロパティ (N)">${icon("server")}</button>
        <span class="vd-vsep"></span>
        <button data-ed-act="undo" ${ed.undo.length ? "" : "disabled"} title="元に戻す (⌘Z)">${icon("left")}</button>
        <button data-ed-act="redo" ${ed.redo.length ? "" : "disabled"} title="やり直す (⇧⌘Z)">${icon("right")}</button>
      </div>
      <div class="vd-actions">
        <span class="vd-state ${ed.dirty ? "dirty" : ""}" data-save-state>${ed.dirty ? "未保存" : "保存済み"}</span>
        <button class="vd-btn" data-ed-act="json">JSON</button>
        <button class="vd-btn" data-ed-act="history">${icon("clock")}履歴</button>
        <button class="vd-btn" data-ed-act="draft">下書き</button>
        <button class="vd-btn primary" data-ed-act="publish">公開</button>
        <button class="vd-btn ghost" data-ed-act="preview" title="メタバースに入る">${icon("open")}</button>
      </div>
    </div>`;
  }

  /* =========================================================
     アウトライナー（右パネル上段）
     ========================================================= */
  /* オプションのアイコン（行の右側） */
  function optIcons(o) {
    const op = o.options || {};
    let h = "";
    if (op.teleporter && op.teleporter.on)
      h += `<span class="vo-opt tp" title="テレポーター（半径 ${op.teleporter.radius || 2}m / ${op.teleporter.mode === "auto" ? "自動" : "手動"}）">${icon("portal")}</span>`;
    if (op.taiko && op.taiko.on)
      h += `<span class="vo-opt tk" title="太鼓（${op.taiko.sound || "taiko_01"}）">${icon("drum")}</span>`;
    return h ? `<span class="vo-opts">${h}</span>` : `<span class="vo-opts"></span>`;
  }

  function optCount(o) {
    const op = o.options || {};
    let n = 0;
    if (op.teleporter && op.teleporter.on) n++;
    if (op.taiko && op.taiko.on) n++;
    return n ? `${n} 有効` : "なし";
  }

  function optionsBody(ed, o) {
    const op = o.options || {};
    const tp = op.teleporter || { on: false, to: "", radius: 2, mode: "manual", prompt: true, key: "E" };
    const tk = op.taiko || { on: false, sound: "taiko_01", volume: 0.8, radius: 2, prompt: true };

    return `
      <div class="vopt">
        <label class="vopt-h">
          <input type="checkbox" data-ed-opt="teleporter.on" ${tp.on ? "checked" : ""}>
          <span class="vopt-ic tp">${icon("portal")}</span>
          <b>テレポーター</b>
        </label>
        <div class="vopt-b ${tp.on ? "" : "is-off"}">
          <label class="vlbl">移動先</label>
          <select class="vinp" data-ed-opt="teleporter.to">
            ${(ed.worlds || []).map((w) => `<option value="${esc(w.id)}" ${tp.to === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}
          </select>
          <label class="vlbl">反応半径 <b>${tp.radius} m</b></label>
          <input type="range" data-ed-opt="teleporter.radius" min="0.5" max="10" step="0.5" value="${tp.radius}">
          <label class="vlbl">詰まり方</label>
          <div class="vseg" data-ed-opt="teleporter.mode">
            <button data-v="manual" class="${tp.mode !== "auto" ? "on" : ""}">手動（ボタン）</button>
            <button data-v="auto" class="${tp.mode === "auto" ? "on" : ""}">自動で転送</button>
          </div>
          <label class="vchk"><input type="checkbox" data-ed-opt="teleporter.prompt" ${tp.prompt ? "checked" : ""}><span>半径内で「インタラクト」ボタンを表示</span></label>
          ${tp.mode !== "auto" && tp.prompt ? `
            <label class="vlbl">ボタンのキー</label>
            <select class="vinp" data-ed-opt="teleporter.key">
              ${["E", "F", "Q", "Space"].map((k) => `<option value="${k}" ${tp.key === k ? "selected" : ""}>${k}</option>`).join("")}
            </select>` : ""}
          <p class="vhint">半径 ${tp.radius} m 以内に入ると${tp.mode === "auto" ? "自動で移動します" : "ボタンが表示されます"}。</p>
        </div>
      </div>

      <div class="vopt">
        <label class="vopt-h">
          <input type="checkbox" data-ed-opt="taiko.on" ${tk.on ? "checked" : ""}>
          <span class="vopt-ic tk">${icon("drum")}</span>
          <b>太鼓</b>
        </label>
        <div class="vopt-b ${tk.on ? "" : "is-off"}">
          <label class="vlbl">音源</label>
          <select class="vinp" data-ed-opt="taiko.sound">
            ${["taiko_01", "taiko_02", "taiko_matsuri"].map((s) => `<option ${tk.sound === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
          <label class="vlbl">音量 <b>${tk.volume}</b></label>
          <input type="range" data-ed-opt="taiko.volume" min="0" max="1" step="0.05" value="${tk.volume}">
          <label class="vlbl">反応半径 <b>${tk.radius} m</b></label>
          <input type="range" data-ed-opt="taiko.radius" min="0.5" max="10" step="0.5" value="${tk.radius}">
          <label class="vchk"><input type="checkbox" data-ed-opt="taiko.prompt" ${tk.prompt ? "checked" : ""}><span>半径内で「叩く」ボタンを表示</span></label>
        </div>
      </div>

      <p class="vhint">チェックしたオプションは、アウトライナーの名前の右にアイコンで表示されます。</p>`;
  }

  function outlinerHtml(ed) {    const objs = ed.objects;
    const groups = {};
    objs.forEach((o) => { (groups[o.type] = groups[o.type] || []).push(o); });
    const order = ["light", "model", "prop", "animate", "board", "pdf", "smoke", "cloud", "plane", "spawn"];
    const T = TYPES();
    const q = (ed.q || "").toLowerCase();

    return `<div class="vout">
      <div class="vout-h">
        <span>アウトライナー</span>
        <b>${objs.length}</b>
        <button class="vout-add" data-ed-act="explorer" title="ファイルから追加">${icon("plus")}</button>
        <button class="vout-min" data-ed-panel="props" title="最小化">${icon("right")}</button>
      </div>
      <div class="vout-search">
        ${icon("search")}
        <input data-ed-filter placeholder="検索" value="${esc(ed.q || "")}" spellcheck="false">
      </div>
      <div class="vout-scroll">
        <div class="vo-row scene ${ed.selKind === "world" ? "on" : ""}" data-ed-sel-world>
          ${icon("cube")}<span class="nm">ワールド設定</span>
        </div>
        ${order.filter((k) => groups[k]).map((k) => {
          const items = groups[k].filter((o) => !q || o.name.toLowerCase().includes(q));
          if (!items.length) return "";
          const open = !(ed.collapsed && ed.collapsed[k]);
          return `<div class="vo-grp ${open ? "" : "is-closed"}" data-vo-grp="${esc(k)}">
            <button class="vo-tgl" data-ed-grp="${esc(k)}" title="${open ? "折りたたむ" : "展開する"}">
              <span class="vo-chev">${icon("chev")}</span>
              <span class="vo-gl">${esc(T[k].label)}</span>
              <span class="c">${items.length}</span>
            </button>
          </div>
          ${open ? items.map((o) => `<div class="vo-row ${ed.selected.includes(o.id) ? "on" : ""} ${o.visible === false ? "hid" : ""}" data-ed-obj="${esc(o.id)}">
            <span class="vo-ic t-${esc(o.type)}">${icon(UU.TYPE_ICON[o.type] || "box")}</span>
            <span class="nm">${esc(o.name)}</span>
            ${optIcons(o)}
            <button class="vo-eye" data-ed-vis="${esc(o.id)}" title="表示 / 非表示">${icon(o.visible === false ? "minus" : "check")}</button>
          </div>`).join("") : ""}`;
        }).join("")}
      </div>
      <div class="vsplit" data-vsplit title="ドラッグで高さを変更"><span></span></div>
    </div>`;
  }

  /* =========================================================
     プロパティ（右パネル下段・カテゴリ別）
     ========================================================= */
  const deg = (r) => Math.round((r * 180) / Math.PI * 10) / 10;
  const r3 = (v) => Math.round(v * 1000) / 1000;

  function sec(ed, key, title, body, extra) {
    const open = ed.sec[key] !== false;
    return `<section class="vsec-c ${open ? "open" : ""}" data-sec="${key}">
      <button class="vsec-t" data-ed-sec="${key}">
        <span class="sec-chev">${icon("chev")}</span>
        <span class="sec-name">${title}</span>
        ${extra ? `<span class="sec-extra">${extra}</span>` : ""}
      </button>
      <div class="vsec-b">${body}</div>
    </section>`;
  }

  function axisRows(label, rows) {
    return `<div class="vtf">
      <span class="vtf-l">${label}</span>
      <div class="vtf-r" style="line-height: 0; gap: 0px">
        ${rows.map(([ax, key, val, step]) => `<div class="vrow">
          <i class="ax ${ax.toLowerCase()}">${ax}</i>
          <input class="vinp num" type="number" step="${step || 0.1}" data-ed-prop="${key}" value="${val}" style="overflow: visible">
        </div>`).join("")}
      </div>
    </div>`;
  }

  /** ライブ時 FDS/VDB 等の旧エディタ導線（暫定） */
  function liveLegacyEditorLink(ed, label) {
    if (!ed?._live) return "";
    const st = window.MT?.state;
    const tid = st?.tenant;
    if (!tid) return "";
    return `<div class="vrow-line" style="flex-direction:column;align-items:stretch;gap:6px;margin-top:8px">
        <a class="vbtn" href="/admin-legacy/tenant/${encodeURIComponent(tid)}/world-edit" target="_blank" rel="noopener noreferrer">${icon("open")}旧エディタで ${esc(label)} を開く</a>
        <p class="vhint" style="margin:0">暫定: フルプレビューと高度な編集は旧エディタをご利用ください。</p>
      </div>`;
  }

  function typeBody(ed, o) {
    const p = o.props || {};
    const sel = (key, opts, cur) => `<select class="vinp" data-ed-prop="${key}">
      ${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    const rng = (key, val, min, max, st) => `<div class="vrng">
      <input type="range" data-ed-prop="${key}" value="${val}" min="${min || 0}" max="${max || 1}" step="${st || 0.05}">
      <span class="rv">${val}</span></div>`;

    if (o.type === "light") return `
      <label class="vlbl">色</label>
      <div class="vrow2"><input type="color" data-ed-prop="color" value="${p.color || "#ffd9a0"}">
        <input class="vinp mono" data-ed-prop="color" value="${p.color || "#ffd9a0"}"></div>
      <label class="vlbl">明るさ</label>${rng("intensity", p.intensity == null ? 1.4 : p.intensity, 0, 4, 0.1)}
      <label class="vlbl">距離</label><input class="vinp num" type="number" step="1" data-ed-prop="distance" value="${p.distance || 8}">`;

    if (o.type === "spawn") return `
      <label class="vlbl">向き（度）</label><input class="vinp num" type="number" step="15" data-ed-prop="yaw" value="${p.yaw || 0}">
      <p class="vhint">プレイヤーはこの地点から出現します。ワールドに1つだけ有効です。</p>`;

    if (o.type === "animate") return `
      <label class="vlbl">クリップ</label>${sel("clip", ["idle", "wave", "walk", "bow"].map((c) => [c, c]), p.clip)}
      <label class="vlbl">速度</label><input class="vinp num" type="number" step="0.1" data-ed-prop="speed" value="${p.speed || 1}">`;

    if (o.type === "board") return `
      <label class="vlbl">表示する便</label>
      <div class="vseg" data-ed-prop="filter">
        ${[["all", "全便"], ["domestic", "国内線"], ["international", "国際線"]]
          .map(([v, l]) => `<button data-v="${v}" class="${p.filter === v ? "on" : ""}">${l}</button>`).join("")}
      </div>
      <button type="button" class="vbtn" data-ed-act="preview-obj" style="margin-top:8px">${icon("open")}発着プレビュー</button>
      ${liveLegacyEditorLink(ed, "発着案内")}`;

    if (o.type === "pdf") return `
      <label class="vlbl">ファイル</label><input class="vinp" data-ed-prop="file" value="${esc(p.file || "")}">
      <label class="vlbl">ページ</label>
      <div class="vpager">
        <button data-ed-page="-1">${icon("left")}</button>
        <span>${p.page || 1} / ${p.pages || 4}</span>
        <button data-ed-page="1">${icon("right")}</button>
      </div>
      <button type="button" class="vbtn" data-ed-act="preview-obj" style="margin-top:8px">${icon("open")}PDF プレビュー</button>
      ${liveLegacyEditorLink(ed, "PDF")}`;

    if (o.type === "smoke") return `
      <label class="vlbl">データ</label><input class="vinp" data-ed-prop="file" value="${esc(p.file || "")}">
      <label class="vlbl">濃さ</label>${rng("density", p.density == null ? 0.6 : p.density)}
      <label class="vchk"><input type="checkbox" data-ed-prop="playing" ${p.playing ? "checked" : ""}><span>エディタで再生</span></label>
      <button type="button" class="vbtn" data-ed-act="preview-obj" style="margin-top:8px">${icon("wave")}簡易プレビュー</button>
      ${liveLegacyEditorLink(ed, "FDS 煙")}`;

    if (o.type === "cloud") return `
      <label class="vlbl">ファイル</label><input class="vinp" data-ed-prop="file" value="${esc(p.file || p.path || "")}">
      <label class="vlbl">濃さ</label>${rng("density", p.density == null ? 0.45 : p.density)}
      <label class="vlbl">色</label><input type="color" data-ed-prop="tint" value="${p.tint || "#ffffff"}">
      <label class="vlbl">大きさ</label><input class="vinp num" type="number" step="0.1" data-ed-prop="scale" value="${p.scale || 1}">
      <button type="button" class="vbtn" data-ed-act="preview-obj" style="margin-top:8px">${icon("wave")}簡易プレビュー</button>
      ${liveLegacyEditorLink(ed, "VDB 雲")}`;

    if (o.type === "plane") return `
      <label class="vlbl">速度</label><input class="vinp num" type="number" step="1" data-ed-prop="speed" value="${p.speed || 12}">
      <label class="vlbl">旋回の効き</label><input class="vinp num" type="number" step="0.1" data-ed-prop="turn" value="${p.turn || 0.6}">
      <label class="vlbl">質量</label><input class="vinp num" type="number" step="0.1" data-ed-prop="mass" value="${p.mass || 1.4}">
      <label class="vlbl">タグ</label>
      <div class="vtags">${(p.tags || []).map((x) => `<span>${esc(x)}</span>`).join("")}
        <button class="vp-txt" data-ed-act="plane-tags">編集</button></div>
      <label class="vchk"><input type="checkbox" data-ed-prop="test" ${p.test ? "checked" : ""}><span>試乗プレビュー</span></label>`;

    return `<p class="vhint">この種類に固有の設定はありません。</p>`;
  }

  function objectSections(ed, o) {
    const T = TYPES();
    const p = o.props || {};
    return `
      ${sec(ed, "tf", "トランスフォーム", `
        ${axisRows("位置", [["X", "px", r3(o.pos[0])], ["Y", "py", r3(o.pos[1])], ["Z", "pz", r3(o.pos[2])]])}
        ${axisRows("回転", [["X", "rx", deg(o.rot[0]), 5], ["Y", "ry", deg(o.rot[1]), 5], ["Z", "rz", deg(o.rot[2]), 5]])}
        ${axisRows("スケール", [["X", "sx", r3(o.scale[0]), 0.05], ["Y", "sy", r3(o.scale[1]), 0.05], ["Z", "sz", r3(o.scale[2]), 0.05]])}
        <div class="vrow-line"><span>モード</span><b>XYZ オイラー</b></div>
      `, `<button class="sec-ic" data-ed-act="reset-tf" title="リセット">${icon("reset")}</button>`)}

      ${sec(ed, "vis", "表示", `
        <label class="vchk"><input type="checkbox" data-ed-visible ${o.visible !== false ? "checked" : ""}><span>ビューポートに表示</span></label>
        <label class="vchk"><input type="checkbox" data-ed-prop="solid" ${p.solid ? "checked" : ""}><span>当たり判定を持つ</span></label>
        <label class="vchk"><input type="checkbox" data-ed-prop="sync" ${p.sync !== false ? "checked" : ""}><span>全員に同期</span></label>
      `)}

      ${sec(ed, "own", "固有設定", typeBody(ed, o), `<span class="sec-tag">${esc(T[o.type].label)}</span>`)}

      ${sec(ed, "opt", "オプション", optionsBody(ed, o),
        `<span class="sec-tag">${optCount(o)}</span>`)}

      ${sec(ed, "meta", "メタ情報", `
        <div class="vrow-line"><span>ID</span><b class="mono">${esc(o.id)}</b></div>
        <div class="vrow-line"><span>種類</span><b>${esc(T[o.type].label)}</b></div>
        <div class="vrow-line"><span>最終編集</span><b>nagi ・ 11/22</b></div>
      `)}
    `;
  }

  function multiSections(ed, sel) {
    return `
      ${sec(ed, "tf", "トランスフォーム", `
        <p class="vhint">${sel.length} 個を選択中。ギズモでまとめて移動・回転・拡大できます。</p>
        <div class="vrow2" style="margin-top:8px">
          <button class="vbtn" data-ed-act="align-x">X を揃える</button>
          <button class="vbtn" data-ed-act="align-y">Y を揃える</button>
        </div>`)}
      ${sec(ed, "vis", "一括操作", `
        <button class="vbtn danger" data-ed-act="del-multi" style="width:100%">${icon("trash")}まとめて削除</button>`)}
    `;
  }

  function worldSections(ed) {
    const w = ed.settings;
    return `
      ${sec(ed, "world", "ワールド", `
        <label class="vlbl">名前</label><input class="vinp" data-ed-world="name" value="${esc(ed.worldName || "")}">
        <label class="vlbl">説明</label><textarea class="vinp" data-ed-world="desc" rows="3">${esc(w.desc || "")}</textarea>
      `)}
      ${sec(ed, "lod", "LOD / 品質", `
        <label class="vlbl">描画距離 <b data-lodv>${w.viewDistance || 60} m</b></label>
        <input type="range" data-ed-lod="viewDistance" min="20" max="200" step="5" value="${w.viewDistance || 60}">
        <label class="vlbl">品質</label>
        <div class="vseg" data-ed-lod="quality">
          ${[["low", "低"], ["mid", "中"], ["high", "高"]]
            .map(([v, l]) => `<button data-v="${v}" class="${(w.quality || "mid") === v ? "on" : ""}">${l}</button>`).join("")}
        </div>
        <p class="vhint">遠くのモデルは自動で簡略表示されます。</p>
      `)}
      ${sec(ed, "env", "環境", `
        <label class="vlbl">空の色</label><input type="color" data-ed-lod="sky" value="${w.sky || "#eef0f4"}">
        <label class="vlbl">環境音</label>
        <select class="vinp" data-ed-lod="ambient">
          ${[["none", "なし"], ["night_street", "night_street"], ["garden", "garden"], ["hall", "hall"]]
            .map(([v, l]) => `<option value="${v}" ${w.ambient === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      `, `<span class="sec-tag">${w.ambient || "none"}</span>`)}
      ${sec(ed, "limit", "上限", `
        <label class="vlbl">同時接続</label><input class="vinp num" type="number" step="10" data-ed-lod="cap" value="${w.cap || 200}">
        <div class="vrow-line"><span>オブジェクト</span><b>${ed.objects.length} / 500</b></div>
      `)}
    `;
  }

  function inspectorHtml(ed) {
    const sel = ed.objects.filter((o) => ed.selected.includes(o.id));
    const one = sel.length === 1 ? sel[0] : null;
    const title = one ? one.name : sel.length ? `${sel.length} 個を選択` : "ワールド設定";
    const T = TYPES();
    return `${outlinerHtml(ed)}
      <div class="vpar">
        <div class="vpar-h">
          <span class="vpar-t">${esc(title)}</span>
          ${one ? `<span class="vbadge">${esc(T[one.type].label)}</span>` : ""}
          <button class="vp-x" data-ed-act="collapse-right" title="しまう">${icon("right")}</button>
        </div>
        <div class="vpar-scroll">
          ${one ? objectSections(ed, one) : sel.length ? multiSections(ed, sel) : worldSections(ed)}
          ${one ? `<div class="vpar-foot">
            <button class="vbtn" data-ed-act="dupe">${icon("copy")}複製</button>
            <button class="vbtn danger" data-ed-act="del">${icon("trash")}削除</button>
          </div>` : ""}
        </div>
      </div>`;
  }

  /* =========================================================
     ファイルエクスプローラー
     ========================================================= */
  function explorerHtml(ed) {
    const ex = ed.explorer;
    const path = ex.path || [];
    const here = path.join("/");
    const q = (ex.q || "").toLowerCase();
    const dirs = FOLDERS.filter((f) => !path.length && (!q || f.label.includes(q) || f.id.includes(q)));
    const files = ed.files.filter((f) => (f.path || []).join("/") === here)
      .filter((f) => !q || f.name.toLowerCase().includes(q));

    const crumbs = [{ label: "サーバー", i: 0 }].concat(path.map((p, i) => ({ label: p, i: i + 1 })));
    const listView = ex.view !== "grid";

    const rows = files.map((f) => `<tr class="ex-row ${ex.sel === f.id ? "on" : ""}" data-ex-file="${esc(f.id)}">
        <td><div class="ex-name"><span class="ex-ic ${esc(f.kind)}">${icon(f.kind === "pdf" ? "open" : f.kind === "zip" ? "alert" : f.kind === "vdb" ? "wave" : "cube")}</span>
          <span>${esc(f.name)}</span></div></td>
        <td class="ex-kind">${esc(KIND_LABEL[f.kind] || "ファイル")}</td>
        <td class="ex-size">${f.size.toFixed(1)} MB</td>
        <td class="ex-date">${esc(f.date)}</td>
      </tr>`).join("");

    return `<div class="ex-scrim" data-ex-scrim>
      <div class="ex" data-ex>
        <div class="ex-h">
          ${icon("server")}<b>サーバーファイル</b>
          <span class="ex-host">mmh.mmh-virtual.jp / worlds / akari</span>
          <button class="vp-x" data-ed-act="ex-close">${icon("x")}</button>
        </div>

        <div class="ex-bar">
          <button class="ex-nb" data-ed-act="ex-up" ${path.length ? "" : "disabled"} title="上へ">${icon("left")}</button>
          <div class="ex-crumbs">
            ${crumbs.map((c, i) => `<span class="ex-crumb ${i === crumbs.length - 1 ? "on" : ""}" data-ex-crumb="${c.i}">${esc(c.label)}</span>${i < crumbs.length - 1 ? `<i>/</i>` : ""}`).join("")}
          </div>
          <div class="ex-search">${icon("search")}<input data-ex-q placeholder="このフォルダ内を検索" value="${esc(ex.q || "")}"></div>
          <div class="ex-views">
            <button class="${listView ? "on" : ""}" data-ed-act="ex-view" data-v="list" title="一覧">${icon("grid")}</button>
            <button class="${listView ? "" : "on"}" data-ed-act="ex-view" data-v="grid" title="タイル">${icon("server")}</button>
          </div>
          <label class="ex-up-btn">${icon("dl")}アップロード
            <input type="file" multiple hidden data-ex-upload>
          </label>
        </div>

        <div class="ex-main">
          <div class="ex-side">
            <div class="ex-side-t">場所</div>
            <button class="ex-place ${!path.length ? "on" : ""}" data-ex-crumb="0">${icon("server")}<span>サーバー</span></button>
            ${FOLDERS.map((f) => `<button class="ex-place ${path[0] === f.id ? "on" : ""}" data-ex-crumb="1" data-ex-folder="${f.id}">
              ${icon("cube")}<span>${esc(f.label)}</span></button>`).join("")}
          </div>

          <div class="ex-body" data-ex-drop>
            ${listView ? `<table class="ex-table">
              <colgroup><col><col style="width:78px"><col style="width:66px"><col style="width:88px"></colgroup>
              <thead><tr><th>名前</th><th>種類</th><th>サイズ</th><th>更新日時</th></tr></thead>
              <tbody>
                ${dirs.length ? dirs.map((f) => `<tr class="ex-row dir" data-ex-open="${f.id}">
                  <td><div class="ex-name"><span class="ex-ic folder">${icon("grid")}</span><span>${esc(f.label)}</span></div></td>
                  <td class="ex-kind">フォルダ</td><td class="ex-size">—</td><td class="ex-date">—</td></tr>`).join("") : ""}
                ${rows || (dirs.length ? "" : `<tr><td colspan="4" class="ex-empty">このフォルダは空です</td></tr>`)}
              </tbody>
            </table>`
            : `<div class="ex-grid">
              ${dirs.map((f) => `<button class="ex-tile dir" data-ex-open="${f.id}">
                <span class="ex-thumb folder">${icon("grid")}</span><span class="n">${esc(f.label)}</span><span class="m">フォルダ</span></button>`).join("")}
              ${files.map((f) => `<button class="ex-tile ${ex.sel === f.id ? "on" : ""}" data-ex-file="${esc(f.id)}">
                <span class="ex-thumb ${esc(f.kind)}">${icon(f.kind === "pdf" ? "open" : f.kind === "vdb" ? "wave" : "cube")}</span>
                <span class="n">${esc(f.name)}</span><span class="m">${f.size.toFixed(1)} MB</span></button>`).join("")}
            </div>`}

            <div class="ex-drop-hint" data-ex-hint>
              ${icon("dl")}<b>ここにドロップしてアップロード</b>
              <span>.glb / .gltf / .vdb / .zip / .pdf / .png ・ 200 MB まで</span>
            </div>
          </div>
        </div>

        <div class="ex-ups" data-ex-ups>${uploadRowsHtml(ed)}</div>

        <div class="ex-f">
          <span class="ex-sel">${(() => {
            const f = ed.files.find((x) => x.id === ex.sel);
            return f ? `${esc(f.name)} ・ ${KIND_LABEL[f.kind] || "ファイル"} ・ ${f.size.toFixed(1)} MB` : "ファイルを選択してください";
          })()}</span>
          <button class="vbtn" data-ed-act="ex-del" ${ex.sel ? "" : "disabled"}>削除</button>
          <button class="vbtn primary" data-ed-act="ex-place" ${ex.sel && ed.files.find((x) => x.id === ex.sel) && ed.files.find((x) => x.id === ex.sel).asset ? "" : "disabled"}>
            ${icon("plus")}ワールドに配置
          </button>
          <button class="vbtn" data-ed-act="ex-close">閉じる</button>
        </div>
      </div>
    </div>`;
  }

  /* ---------- アップロード行 ---------- */
  function etaText(u) {
    if (u.done) return "完了";
    const s = Math.max(1, Math.round(u.eta));
    return s >= 60 ? `残り ${Math.floor(s / 60)} 分 ${s % 60} 秒` : `残り ${s} 秒`;
  }

  function uploadRowsHtml(ed) {
    if (!ed.uploads || !ed.uploads.length) {
      return `<div class="ex-ups-empty">アップロード中のファイルはありません</div>`;
    }
    return ed.uploads.map((u) => `<div class="up ${u.done ? "done" : ""}" data-up="${esc(u.id)}">
      <span class="up-ic">${icon(u.done ? "check" : "dl")}</span>
      <div class="up-info">
        <div class="up-line">
          <span class="up-name">${esc(u.name)}</span>
          <span class="up-pct">${u.failed ? "失敗" : u.done ? "完了" : Math.round(u.progress) + "%"}</span>
        </div>
        <div class="up-bar"><i style="width:${u.progress.toFixed(1)}%"></i></div>
        <div class="up-meta">
          <span>${u.size.toFixed(1)} MB</span>
          <span>${u.done ? "" : u.speed.toFixed(1) + " MB/s"}</span>
          <span class="up-eta">${etaText(u)}</span>
        </div>
      </div>
    </div>`).join("");
  }
  V.uploadRowsHtml = uploadRowsHtml;
  V.inspectorHtml = inspectorHtml;
  V.outlinerHtml = outlinerHtml;

  /* =========================================================
     本体
     ========================================================= */
  V.world = function () {
    const st = window.MT.state;
    const t = D.TENANTS.find((x) => x.id === st.tenant);
    if (!t) return "";
    const ed = st.ed;

    return `<div class="wed-root" data-scene-theme="${ed.theme}">
      ${ed.loading && !ed._live ? `<div class="vloadbar" data-loadbar>
        <div class="vloadbar-in">
          <span class="vspin-sm"></span>
          <span class="vloadbar-t">${window.MUI.esc(ed.loading.label || "読み込み中")}</span>
          <span class="vloadbar-pct" data-loadpct>0%</span>
        </div>
        <div class="vloadbar-track"><i data-loadfill style="width:0%"></i></div>
      </div>` : ""}
      ${topHtml(ed, t)}
      <div class="ved-stage ${ed.panels.props ? "docked" : ""}">
        <div class="ved-canvas" data-canvas>
          <div class="ved-loading" data-loading ${ed._live && ed.loading ? 'hidden' : ''}><span class="vspin"></span>ワールドを読み込み中…</div>
        </div>

        <div class="vtools">
          ${[["translate", "移動", "arrow"], ["rotate", "回転", "reset"], ["scale", "拡大", "plus"]]
            .map(([m, l, ic]) => `<button class="${ed.mode === m ? "on" : ""}" data-ed-mode="${m}" title="${l}">${icon(ic)}</button>`).join("")}
          <span class="vt-sep"></span>
          <button class="${ed.snapOn ? "on" : ""}" data-ed-act="snap" title="スナップ">${icon("grid")}<i>${ed.snapOn ? ed.snap : "—"}</i></button>
          <span class="vt-sep"></span>
          <button data-ed-view="top" title="上面">上</button>
          <button data-ed-view="front" title="正面">前</button>
          <button data-ed-view="side" title="側面">横</button>
          <button data-ed-view="iso" title="初期位置">${icon("reset")}</button>
          <span class="vt-sep"></span>
          <button data-ed-act="focus" title="選択に寄る">${icon("search")}</button>
          <button data-ed-act="theme" title="明るさ">${icon("wave")}</button>
          <button data-ed-act="clear-cache" title="再読み込み">${icon("dl")}</button>
        </div>

        ${ed.panels.props
          ? `<aside class="vpanel right">${inspectorHtml(ed)}</aside>`
          : `<button class="vpill right" data-ed-panel="props">${icon("server")}<span>プロパティ</span></button>`}

        <div class="vhud">
          <span data-hud-count>${ed.objects.length} objects</span>
          <span class="vh-sep"></span>
          <span data-hud-sel>${ed.selected.length ? ed.selected.length + " 選択中" : "未選択"}</span>
          <span class="vh-sep"></span>
          <span data-hud-mode>${ed.mode === "translate" ? "移動" : ed.mode === "rotate" ? "回転" : "拡大"}</span>
          <span class="vh-sep"></span>
          <span>${ed.snapOn ? "スナップ " + ed.snap + " m" : "スナップ OFF"}</span>
        </div>

        <div class="up-stack" data-up-stack ${ed.uploads && ed.uploads.length ? "" : "hidden"}>
          ${ed.uploads && ed.uploads.length ? `<div class="up-stack-h">${icon("dl")}<b>アップロード中</b>
            <span>${ed.uploads.filter((u) => !u.done).length} 件</span></div>
            ${uploadRowsHtml(ed)}` : ""}
        </div>
      </div>
      ${ed.explorer && ed.explorer.open ? explorerHtml(ed) : ""}
      ${ed.ctx ? ctxMenuHtml(ed) : ""}
      ${ed.ctxWorld ? `<div class="vctx" style="left:${ed.ctxWorld.x}px;top:${ed.ctxWorld.y}px" data-ctxw>
        <div class="vctx-h">${esc(ed.ctxWorld.name)}</div>
        <button class="vctx-i" data-ed-act="wt-rename">${icon("search")}<span>名前を変更</span></button>
        <button class="vctx-i danger" data-ed-act="wt-delete">${icon("trash")}<span>削除</span></button>
      </div>` : ""}
      ${ed.preview ? previewHtml(ed) : ""}
      ${ed.dialog ? dialogHtml(ed) : ""}
    </div>`;
  };

  /* =========================================================
     右クリックメニュー
     ========================================================= */
  function ctxMenuHtml(ed) {
    const c = ed.ctx;
    const f = ed.files.find((x) => x.id === c.id);
    if (!f) return "";
    const items = [
      { a: "ctx-preview", label: "プレビュー", ic: "open" },
      { a: "ctx-rename", label: "名前を変更", ic: "search" },
      { a: "ctx-copy", label: "コピー", ic: "copy" },
      { a: "ctx-place", label: "ワールドに配置", ic: "plus", dis: !f.asset },
      { a: "ctx-del", label: "削除", ic: "trash", danger: true }
    ];
    return `<div class="vctx" style="left:${c.x}px;top:${c.y}px" data-ctx>
      <div class="vctx-h">${esc(f.name)}</div>
      ${items.map((i) => `<button class="vctx-i ${i.danger ? "danger" : ""}" data-ed-act="${i.a}" ${i.dis ? "disabled" : ""}>
        ${icon(i.ic)}<span>${i.label}</span></button>`).join("")}
    </div>`;
  }

  /* =========================================================
     プレビュー（3D / PDF / その他）
     ========================================================= */
  function previewHtml(ed) {
    const f = ed.files.find((x) => x.id === ed.preview.id);
    if (!f) return "";
    const k = f.kind;
    const is3D = ["glb", "gltf"].includes(k);
    const isPDF = k === "pdf";
    const isFX = ["zip", "vdb"].includes(k);

    let body;
    if (is3D) {
      body = `<div class="pv3d" data-pv3d>
          <div class="pv3d-load">${icon("box")}<span>モデルを読み込み中…</span></div>
        </div>
        <div class="pv3d-bar">
          <span>${icon("cube")}A-Frame ビューア</span>
          <span class="pv3d-sep"></span>
          <button data-ed-act="pv-rot" data-v="left">${icon("left")}</button>
          <button data-ed-act="pv-rot" data-v="reset">${icon("reset")}</button>
          <button data-ed-act="pv-rot" data-v="right">${icon("right")}</button>
          <span class="pv3d-sp"></span>
          <span class="pv3d-hint">ドラッグで回転 ・ ホイールでズーム</span>
        </div>`;
    } else if (isPDF) {
      body = `<div class="pvpdf">
          <div class="pvpdf-page" data-pvpdf>
            <div class="pvpdf-h">${esc(f.name.replace(/\.pdf$/i, ""))}</div>
            <div class="pvpdf-l">${Array.from({ length: 7 }, (_, i) => `<i style="width:${58 + ((i * 37) % 38)}%"></i>`).join("")}</div>
            <div class="pvpdf-img">図 1　全体配置図</div>
            <div class="pvpdf-l">${Array.from({ length: 5 }, (_, i) => `<i style="width:${72 + ((i * 29) % 26)}%"></i>`).join("")}</div>
          </div>
        </div>
        <div class="pv3d-bar">
          <span>${icon("open")}PDF ビューア</span>
          <span class="pv3d-sep"></span>
          <button data-ed-act="pv-page" data-v="-1">${icon("left")}</button>
          <span class="pv3d-pg">${ed.preview.page || 1} / ${ed.preview.pages || 4}</span>
          <button data-ed-act="pv-page" data-v="1">${icon("right")}</button>
          <span class="pv3d-sp"></span>
          <span class="pv3d-hint">${f.size.toFixed(1)} MB</span>
        </div>`;
    } else if (isFX) {
      body = `<div class="pv3d">
          <div class="pvfx">${Array.from({ length: 14 }, (_, i) => `<i style="left:${8 + ((i * 17) % 84)}%;animation-delay:${(i * 0.23).toFixed(2)}s;width:${18 + (i % 5) * 9}px;height:${18 + (i % 5) * 9}px"></i>`).join("")}</div>
        </div>
        <div class="pv3d-bar">
          <span>${icon("wave")}${k === "vdb" ? "VDB ボリューム" : "FDS 煙データ"}</span>
          <span class="pv3d-sp"></span>
          <span class="pv3d-hint">プレビュー再生中</span>
        </div>`;
    } else {
      body = `<div class="pv3d"><div class="pvnone">${icon("file")}
          <b>${esc(f.name)}</b><span>この形式のプレビューには対応していません</span></div></div>`;
    }

    return `<div class="vm-scrim" data-ed-act="pv-close">
      <div class="vpv" data-stop>
        <div class="vpv-h">
          <span class="vpv-ic t-${esc(k)}">${icon(k === "pdf" ? "file" : k === "vdb" || k === "zip" ? "wave" : "box")}</span>
          <b>${esc(f.name)}</b>
          <span class="vpv-meta">${esc(V.KIND_LABEL[k] || "ファイル")} ・ ${f.size.toFixed(1)} MB ・ ${esc(f.date)}</span>
          <button class="vp-x" data-ed-act="pv-close">${icon("x")}</button>
        </div>
        <div class="vpv-b">${body}</div>
      </div>
    </div>`;
  }

  V.ctxMenuHtml = ctxMenuHtml;
  V.previewHtml = previewHtml;

  /* =========================================================
     ダイアログ
     ========================================================= */
  function dialogHtml(ed) {
    const k = ed.dialog;
    const wrap = (inner, w) => `<div class="vm-scrim" data-ed-act="close-dialog">
      <div class="vm" style="width:min(${w}px,100%)" data-stop>${inner}</div></div>`;

    if (k === "history") return wrap(`
      <div class="vm-h"><b>変更履歴</b><button class="vp-x" data-ed-act="close-dialog">${icon("x")}</button></div>
      <div class="vm-b">
        ${ed.history.map((h, i) => `<div class="vhist">
          <span class="d">${esc(h.at)}</span><span class="w">${esc(h.who)}</span>
          <span class="m">${esc(h.msg)}</span>
          <span class="tag ${h.published ? "ok" : ""}">${h.published ? "公開" : "下書き"}</span>
          <button data-ed-act="restore" data-i="${i}" ${i === 0 ? "disabled" : ""}>復元</button>
        </div>`).join("")}
      </div>`, 520);

    if (k === "json") return wrap(`
      <div class="vm-h"><b>JSON</b>
        <div class="vm-hr">
          <button class="vbtn" data-ed-act="json-copy">コピー</button>
          <button class="vbtn primary" data-ed-act="json-apply">適用</button>
          <button class="vp-x" data-ed-act="close-dialog">${icon("x")}</button>
        </div>
      </div>
      <div class="vm-tools">
        <input data-ed-jsonfind placeholder="検索"><input data-ed-jsonrep placeholder="置換後">
        <button class="vbtn" data-ed-act="json-replace">置換</button>
        <span class="st ${ed.jsonErr ? "bad" : ""}">${ed.jsonErr ? esc(ed.jsonErr) : "有効な JSON"}</span>
      </div>
      <textarea class="vm-json" data-ed-json spellcheck="false">${esc(ed.json)}</textarea>`, 680);

    if (k === "preview") return wrap(`
      <div class="vm-h"><b>メタバースに入る</b><button class="vp-x" data-ed-act="close-dialog">${icon("x")}</button></div>
      <div class="vm-b" style="padding:16px">
        <p class="vhint">保存済みの状態でプレイ画面を開きます。未保存の変更は反映されません。</p>
        <div class="vprev"><span>プレイ画面</span></div>
        <div class="vm-hr" style="justify-content:flex-end;margin-top:14px">
          <button class="vbtn" data-ed-act="close-dialog">閉じる</button>
          <button class="vbtn primary" data-ed-act="preview-open">新しいタブで開く</button>
        </div>
      </div>`, 400);

    if (k === "leave") return `<div class="vm-scrim">
      <div class="vm" style="width:min(380px,100%)">
        <div class="vm-h"><b>未保存の変更があります</b></div>
        <div class="vm-b" style="padding:16px">
          <p class="vhint">破棄して移動しますか？</p>
          <div class="vm-hr" style="justify-content:flex-end;margin-top:16px">
            <button class="vbtn" data-ed-act="leave-cancel">編集を続ける</button>
            <button class="vbtn" data-ed-act="leave-save">保存して移動</button>
            <button class="vbtn danger" data-ed-act="leave-discard">破棄</button>
          </div>
        </div>
      </div></div>`;

    return "";
  }
})();
