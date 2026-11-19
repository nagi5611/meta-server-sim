/* みんなでメタ 管理パネル v2 — 画面 */
(function () {
  "use strict";
  const tr = (k, v) => (window.LobbyI18n && window.LobbyI18n.t(k, v)) || k;
  const M = window.MMH, U = window.UI;
  const { store, AUDIENCE, fmtNum, fmtDateTime, fmtDur } = M;
  const { esc } = U;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const state = {
    view: "worlds", q: "", filter: "all",
    range: "24h", focus: null,
    viewer: "guest", editing: null, isNew: false,
    annEditing: null, isNewAnn: false,
    user: "u1"
  };

  /* ================= 認証 ================= */
  const gate = $("#gate"), app = $("#app");
  async function enter() {
    $("#gateErr").textContent = "";
    $("#gateBtn").disabled = true;
    try {
      await store.refresh();
      gate.hidden = true;
      app.hidden = false;
      render();
    } catch (err) {
      $("#gateErr").textContent = err?.data?.error === "unauthorized" ? tr("admin.gateSessionExpired") : tr("admin.gateLoadFail");
      gate.hidden = false;
      app.hidden = true;
    } finally {
      $("#gateBtn").disabled = false;
    }
  }
  $("#gateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
  $("#gateErr").textContent = "";
    try {
      await window.LobbyAdminApi.login($("#gUser").value.trim(), $("#gPass").value);
      await enter();
    } catch {
      $("#gateErr").textContent = tr("admin.gateErr");
      $("#gPass").select();
    }
  });
  $("#logoutBtn").addEventListener("click", async () => {
    try { await window.LobbyAdminApi.logout(); } catch { /* ignore */ }
    app.hidden = true; gate.hidden = false;
    $("#gPass").value = ""; $("#gUser").focus();
  });
  (async function trySession() {
    try {
      await store.refresh();
      gate.hidden = true;
      app.hidden = false;
      render();
    } catch {
      gate.hidden = false;
      app.hidden = true;
      setTimeout(() => $("#gUser").focus(), 50);
    }
  })();

  $("#nav").addEventListener("click", (e) => {
    const t = e.target.closest("[data-nav]");
    if (!t) return;
    e.preventDefault();
    state.view = t.dataset.nav; state.editing = null; state.annEditing = null;
    if (t.dataset.nav === "announcements") {
      state._annLoading = true;
      render();
      store.refreshAnnouncements().then(() => {
        state._annLoading = false;
        render();
      }).catch(() => {
        state._annLoading = false;
        toast(tr("admin.announcementsLoadFail"));
        render();
      });
    } else {
      render();
    }
    window.scrollTo(0, 0);
  });
  $(".side-mark").addEventListener("click", (e) => {
    e.preventDefault();
    state.view = "worlds"; state.editing = null; render(); window.scrollTo(0, 0);
  });

  /* ================= 共通 ================= */
  function head(title, acts, back, meta) {
    return `<div class="head"><div>
      ${back ? `<a class="back" href="#" data-act="back">← ${esc(back)}</a>` : ""}
      <h1>${esc(title)}</h1>${meta ? `<p class="meta-line">${meta}</p>` : ""}
    </div><div class="acts">${acts || ""}</div></div>`;
  }

  /* ================= メタバース ================= */
  function series() {
    const ws = store.worlds;
    const get = state.range === "24h" ? M.hourly : M.daily;
    const len = state.range === "24h" ? 24 : 7;
    const per = {};
    ws.forEach((w) => (per[w.id] = get(w)));
    const total = new Array(len).fill(0).map((_, i) => ws.reduce((a, w) => a + per[w.id][i], 0));
    let labels;
    if (state.range === "24h") {
      const now = new Date(); now.setMinutes(0);
      labels = total.map((_, i) => {
        const d = new Date(now.getTime() - (len - 1 - i) * 3600e3);
        return d.getHours() + ":00";
      });
    } else {
      const wd = "日月火水木金土";
      labels = total.map((_, i) => {
        const d = new Date(Date.now() - (len - 1 - i) * 864e5);
        return `${d.getMonth() + 1}/${d.getDate()}（${wd[d.getDay()]}）`;
      });
    }
    return { per, total, labels };
  }

  function overview() {
    const ws = store.worlds;
    const live = ws.filter((w) => w.status !== "maint");
    const online = live.reduce((a, w) => a + +w.players, 0);
    const s = series();
    const peak = Math.max.apply(null, s.total);
    const peakAt = s.labels[s.total.indexOf(peak)];
    const fw = state.focus && store.world(state.focus);
    const sorted = ws.slice().sort((a, b) => (b.status !== "maint") - (a.status !== "maint") || b.players - a.players);

    const list = sorted.map((w) => {
      const pct = w.cap ? Math.min(100, (w.players / w.cap) * 100) : 0;
      const cls = w.status === "open" ? "" : w.status;
      return `<button class="srv ${cls} ${state.focus === w.id ? "on" : ""}" data-focus="${esc(w.id)}">
        <span class="n">${esc(w.name)}</span>
        <span class="v num">${w.status === "maint" ? `<small>停止中</small>` : `${fmtNum(w.players)}<small> / ${fmtNum(w.cap)}</small>`}</span>
        <span class="bar"><i class="${pct >= 90 ? "hot" : ""}" style="width:${pct.toFixed(1)}%"></i></span>
      </button>`;
    }).join("");

    return `<section class="block"><div class="sheet ov">
      <div class="ov-chart">
        <div class="ov-top">
          <div>
            <div class="ov-big">
              <span class="main num">${fmtNum(fw ? (fw.status === "maint" ? 0 : fw.players) : online)}<small>人オンライン</small></span>
              <span class="kv">${state.range === "24h" ? "24時間ピーク" : "7日間の最大"}<b class="num">${fmtNum(fw ? Math.max.apply(null, s.per[fw.id]) : peak)}</b></span>
              ${fw ? "" : `<span class="kv">稼働<b class="num">${live.length} / ${ws.length}</b></span>`}
            </div>
            <p class="ov-cap">${fw
              ? `<i></i>全サーバー合計　<i class="hl"></i>${esc(fw.name)}　<a href="#" data-focus="" style="color:var(--color-primary-dark);font-weight:600;text-decoration:none;margin-left:6px">選択を解除</a>`
              : `全サーバーの${state.range === "24h" ? "同時接続数（1時間ごと）" : "平均同時接続数（日ごと）"}・ピーク ${esc(peakAt)}`}</p>
          </div>
          <div class="toggle" id="rangeT">
            <button data-range="24h" class="${state.range === "24h" ? "on" : ""}">24時間</button>
            <button data-range="7d" class="${state.range === "7d" ? "on" : ""}">7日間</button>
          </div>
        </div>
        <div class="chart" id="chart"><div class="tip" id="tip"></div></div>
      </div>
      <div class="ov-list">
        <div class="ov-list-h"><span>サーバー別</span><span>オンライン / 定員</span></div>
        ${list}
      </div>
    </div></section>`;
  }

  let chartLive = null;
  let metricsInflight = null;

  function chartFingerprint(s, focus, W) {
    return state.range + "|" + (state.focus || "") + "|" + W + "|" + s.total.join(",") + "|" + (focus ? focus.join(",") : "");
  }

  function pullChartMetrics() {
    if (metricsInflight) return metricsInflight;
    metricsInflight = store.fetchMetrics(state.range)
      .then(() => { metricsInflight = null; drawChart(true); })
      .catch(() => { metricsInflight = null; });
    return metricsInflight;
  }

  function moveChartHover(e) {
    if (!chartLive) return;
    const { svg, cur, tip, g, s, fw, W } = chartLive;
    const r = svg.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.max(0, Math.min(g.n - 1, Math.round(((px - g.padL) / g.iw) * (g.n - 1))));
    const xx = g.padL + (i / (g.n - 1)) * g.iw;
    cur.setAttribute("x1", xx);
    cur.setAttribute("x2", xx);
    if (cur.getAttribute("opacity") !== "1") cur.setAttribute("opacity", "1");
    const top = store.worlds
      .map((w) => [w, s.per[w.id][i]])
      .filter((p) => p[1] > 0)
      .sort((a, b) => b[1] - a[1]);
    const rows = fw
      ? `<div class="r"><span>${esc(fw.name)}</span><b class="num">${fmtNum(s.per[fw.id][i])}</b></div>`
      : top.slice(0, 4).map((p) => `<div class="r mut"><span>${esc(p[0].name)}</span><span class="num">${fmtNum(p[1])}</span></div>`).join("");
    tip.innerHTML = `<div class="t">${esc(s.labels[i])}</div>
      <div class="r"><span>合計</span><b class="num">${fmtNum(s.total[i])}</b></div>${rows}`;
    tip.style.left = Math.max(80, Math.min(W - 80, xx)) + "px";
    tip.classList.add("on");
  }

  function bindChartBox(box) {
    if (box.dataset.chartBound) return;
    box.dataset.chartBound = "1";
    let raf = 0, pending = null;
    box.addEventListener("mousemove", (e) => {
      pending = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (pending) moveChartHover(pending);
        pending = null;
      });
    });
    box.addEventListener("mouseleave", () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      pending = null;
      if (!chartLive || chartLive.box !== box) return;
      chartLive.tip.classList.remove("on");
      chartLive.cur.setAttribute("opacity", "0");
    });
  }

  function drawChart(force) {
    const box = $("#chart");
    if (!box) return;
    const s = series();
    const W = Math.max(280, box.clientWidth), H = 220;
    const focus = state.focus && s.per[state.focus] ? s.per[state.focus] : null;
    const fp = chartFingerprint(s, focus, W);
    if (!force && chartLive && chartLive.box === box && chartLive.fp === fp) {
      chartLive.s = s;
      chartLive.fw = state.focus && store.world(state.focus);
      return;
    }
    let tip = $("#tip", box);
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tip";
      tip.id = "tip";
    }
    box.innerHTML = U.chart(s.total, focus, s.labels, W, H);
    box.appendChild(tip);
    const svg = $("svg", box);
    const g = U.chart.geom(W, s.total.length);
    const cur = U.chart.ensureCursor(svg, g);
    const fw = state.focus && store.world(state.focus);
    chartLive = { box, fp, svg, cur, tip, g, s, fw, W };
    bindChartBox(box);
  }
  let rz;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => drawChart(true), 120); });

  function viewWorlds() {
    const ws = store.worlds;
    const list = ws.filter((w) => {
      if (state.filter !== "all" && w.status !== state.filter) return false;
      const q = state.q.trim().toLowerCase();
      return !q || (w.name + " " + w.url + " " + w.code).toLowerCase().includes(q);
    });
    const rows = list.map((w) => `
      <tr class="row" data-id="${esc(w.id)}">
        <td><div class="w-cell">
          <div class="w-thumb">${w.thumb ? `<img src="${esc(w.thumb)}" alt="">` : ""}</div>
          <div style="min-width:0"><div class="nm">${esc(w.name)}</div><div class="u">${esc(w.url)}</div></div>
        </div></td>
        <td class="hide-sm">${U.status(w.status)}</td>
        <td class="hide-sm">${U.audience(w.audience)}</td>
        <td class="r num">${w.status === "maint" ? `<span class="dim">—</span>` : fmtNum(w.players)}</td>
        <td class="ops">
          <button class="txt-btn" data-act="preview" data-id="${esc(w.id)}">${tr("admin.preview")}</button>
          <button class="txt-btn danger" data-act="delete" data-id="${esc(w.id)}">${tr("admin.delete")}</button>
        </td>
      </tr>`).join("");

    const f = [["all", tr("admin.filterAll")], ["open", tr("admin.filterOpen")], ["event", tr("admin.filterEvent")], ["maint", tr("admin.filterMaint")]];
    return head(tr("admin.worldsTitle"), `<button class="btn btn-primary" data-act="new">${tr("admin.addWorld")}</button>`) +
      overview() +
      `<section class="block">
        <div class="tools">
          <div class="toggle">${f.map((x) => `<button data-filter="${x[0]}" class="${state.filter === x[0] ? "on" : ""}">${x[1]}</button>`).join("")}</div>
          <div class="search"><input class="inp" id="q" type="search" placeholder="${esc(tr("admin.searchPh"))}" value="${esc(state.q)}"></div>
          <span class="count num">${list.length}件</span>
        </div>
        <div class="sheet"><table>
          <thead><tr><th>${tr("admin.colName")}</th><th class="hide-sm" style="width:150px">${tr("admin.colStatus")}</th><th class="hide-sm" style="width:160px">${tr("admin.colAudience")}</th><th class="r" style="width:110px">${tr("admin.colOnline")}</th><th style="width:170px"></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5"><div class="empty">${tr("admin.emptyWorlds")}</div></td></tr>`}</tbody>
        </table></div>
      </section>`;
  }

  /* ================= 編集 ================= */
  function pvWorlds(w) {
    const l = store.worlds.map((x) => (x.id === w.id ? w : x));
    if (!l.some((x) => x.id === w.id)) l.push(w);
    return l;
  }
  function viewerToggle(attr) {
    return `<div class="toggle">${["guest", "signed", "admin"].map((v) =>
      `<button ${attr}="${v}" class="${state.viewer === v ? "on" : ""}">${U.VIEWER_TEXT[v]}</button>`).join("")}</div>`;
  }

  function viewEditor() {
    const w = state.editing;
    const radio = (name, key, items) => `<div class="choice">${items.map((it) => `
      <label class="${w[key] === it[0] ? "on" : ""}"><input type="radio" name="${name}" value="${it[0]}" ${w[key] === it[0] ? "checked" : ""}>
        <span><span class="t">${it[1]}</span><span class="d">${it[2]}</span></span></label>`).join("")}</div>`;

    const form = `<div class="sheet ed-form">
      <div class="field">
        <label for="fName">メタバース名</label>
        <input class="inp" id="fName" maxlength="40" value="${esc(w.name)}">
        <p class="err" id="eName"></p>
      </div>
      <div class="field">
        <label for="fUrl">転送先URL<span class="sub">参加ボタンを押したときの移動先</span></label>
        <input class="inp" id="fUrl" maxlength="200" value="${esc(w.url)}" placeholder="https://">
        <p class="err" id="eUrl"></p>
      </div>
      <div class="field">
        <label for="fDesc">説明<span class="sub num" id="dCount">${w.desc.length} / 160</span></label>
        <textarea class="inp" id="fDesc" maxlength="160">${esc(w.desc)}</textarea>
      </div>
      <div class="field">
        <label for="fThumb">サムネイル<span class="sub">16:9</span></label>
        <div class="thumb-in">
          <div class="thumb-box" id="thPrev">${w.thumb ? `<img src="${esc(w.thumb)}" alt="">` : ""}</div>
          <input class="inp" id="fThumb" maxlength="300" value="${esc(w.thumb)}" placeholder="画像のURL">
        </div>
      </div>
      <div class="ed-rule"></div>
      <div class="field">
        <span class="lbl">ステータス</span>
        ${radio("st", "status", [
          ["open", "稼働中", "通常どおり参加できます"],
          ["event", "イベント中", "一覧で目立つ表示になります"],
          ["maint", "メンテナンス中", "一覧には出ますが参加はできません"]
        ])}
      </div>
      <div class="field">
        <span class="lbl">公開範囲</span>
        ${radio("aud", "audience", [
          ["all", "全員", "ログインしていない人にも表示"],
          ["signed", "サインイン済みのみ", "アカウントでログインした人だけ"],
          ["admin", "管理者のみ", "管理者アカウントだけ。検証用に"]
        ])}
      </div>
      <div class="cols2">
        <div class="field"><label for="fCap">定員</label><input class="inp num" id="fCap" type="number" min="0" value="${esc(w.cap)}"></div>
        <div class="field"><label for="fCode">参加コード</label><input class="inp num" id="fCode" maxlength="12" value="${esc(w.code)}" style="text-transform:uppercase"></div>
      </div>
      <div class="ed-foot">
        ${state.isNew ? "" : `<button class="txt-btn danger left" data-act="delete" data-id="${esc(w.id)}">このメタバースを削除</button>`}
        <button class="btn btn-quiet" data-act="back">キャンセル</button>
        <button class="btn btn-primary" data-act="save">${state.isNew ? "追加" : "保存"}</button>
      </div>
    </div>`;

    const pv = `<div class="pv-wrap">
      <div class="pv-bar"><h2>プレビュー</h2>
        <div style="display:flex;align-items:center;gap:14px">${viewerToggle("data-viewer")}
        <button class="txt-btn" data-act="preview" data-id="${esc(w.id)}">大きく表示</button></div>
      </div>
      <div class="pv-stage">
        <div><div class="pv-cap">一覧</div><div id="pvL">${U.lobby(w, pvWorlds(w), state.viewer)}</div></div>
        <div><div class="pv-cap">選択したとき</div><div id="pvP">${U.popup(w, state.viewer)}</div></div>
      </div>
      <p class="pv-note">${U.VIEWER_TEXT[state.viewer]}として見た場合の表示です。保存するまで公開ページには反映されません。</p>
    </div>`;

    return head(state.isNew ? "メタバースを追加" : w.name || "名称未設定", "", "メタバース一覧",
      state.isNew ? "" : `最終更新 ${fmtDateTime(w.updated)}`) +
      `<div class="ed">${form}${pv}</div>`;
  }

  function refreshPv() {
    const w = state.editing;
    if (!w || !$("#pvL")) return;
    $("#pvL").innerHTML = U.lobby(w, pvWorlds(w), state.viewer);
    $("#pvP").innerHTML = U.popup(w, state.viewer);
  }

  /* ================= ユーザー ================= */
  const ROLE_TEXT = { admin: "管理者", member: "一般" };
  function userState(u) {
    if (u.banned) return `<span class="st bad">停止中</span>`;
    if (u.online) return `<span class="st">オンライン</span>`;
    return `<span class="st off">オフライン</span>`;
  }

  function viewUsers() {
    const us = store.users;
    const sel = us.find((u) => u.id === state.user) || us[0];
    const rows = us.map((u) => `
      <tr class="row ${u.id === sel.id ? "sel" : ""}" data-user="${esc(u.id)}">
        <td><div class="u-cell"><span class="av">${esc(u.name[0].toUpperCase())}</span>
          <div><div class="nm">${esc(u.name)} ${u.role === "admin" ? `<span class="tag">管理者</span>` : ""} ${u.banned ? `<span class="tag warn">BAN</span>` : ""}</div><div class="em">${esc(u.email)}</div></div></div></td>
        <td class="hide-sm">${userState(u)}</td>
        <td class="r num">${u.history.length}</td>
        <td class="r num dim hide-sm">${fmtDateTime(u.last)}</td>
        <td class="ops" style="width:96px">
          <button class="dd-btn" data-dd="${esc(u.id)}">操作 <span>▾</span></button>
        </td>
      </tr>`).join("");
    const total = sel.history.reduce((a, h) => a + (h.dur || 0), 0);
    const det = `<aside class="sheet det">
      <div class="det-h"><div class="nm">${esc(sel.name)} ${sel.role === "admin" ? `<span class="tag">管理者</span>` : ""}
        ${sel.banned ? `<span class="tag warn">BAN</span>` : ""}</div>
        <div class="em">${esc(sel.handle)} · ${esc(sel.email)} · 登録 ${esc(sel.joined)}</div></div>
      <div class="det-k">
        <div><span>参加</span><b class="num">${sel.history.length}回</b></div>
        <div><span>合計滞在</span><b class="num">${fmtDur(total)}</b></div>
        <div><span>状態</span><b style="font-size:13px">${sel.banned ? "利用停止" : sel.online ? "オンライン" : "オフライン"}</b></div>
      </div>
      ${sel.banned ? `<div class="det-ban">このアカウントは BAN されています。サインインもメタバースへの参加もできません。</div>` : ""}
      <div class="det-l"><div class="cap">参加履歴</div>
        ${sel.history.map((h) => `<div class="hrow ${h.ok ? "" : "fail"}"><b>${esc(store.worldName(h.world))}</b>
          <span class="d num">${h.ok ? fmtDur(h.dur) : "接続失敗"}</span><span class="t num">${fmtDateTime(h.at)}</span></div>`).join("")}
      </div></aside>`;
    return head("ユーザー", "", null, `サインイン済み ${us.length}人 · 現在オンライン ${us.filter((u) => u.online).length}人${us.some((u) => u.banned) ? ` · BAN ${us.filter((u) => u.banned).length}人` : ""}`) +
      `<div class="us"><div class="sheet"><table>
        <thead><tr><th>ユーザー</th><th class="hide-sm" style="width:130px">状態</th><th class="r" style="width:70px">参加</th><th class="r hide-sm" style="width:130px">最終サインイン</th><th style="width:96px"></th></tr></thead>
        <tbody>${rows}</tbody></table></div>${det}</div>`;
  }

  /* ================= 操作メニュー ================= */
  let ddEl = null;
  function closeDD() {
    if (!ddEl) return;
    ddEl.remove(); ddEl = null;
    $$(".dd-btn.act").forEach((b) => b.classList.remove("act"));
  }
  function openDD(btn) {
    const id = btn.dataset.dd;
    const u = store.user(id);
    if (!u) return;
    closeDD();
    btn.classList.add("act");

    const items = [
      u.role === "admin"
        ? { k: "role", label: "管理者から外す", desc: "一般ユーザーに戻す" }
        : { k: "role", label: "管理者にする", desc: "管理画面へアクセスできる" },
      u.banned
        ? { k: "ban", label: "BAN を解除", desc: "サインインを許可する" }
        : { k: "ban", label: "BAN する", desc: "サインインと参加を停止", danger: true },
      u.online ? { k: "kick", label: "接続を切る", desc: "参加中のセッションを終了" } : null,
      { k: "reset", label: "パスワード再設定を送る", desc: "登録メールアドレスに送信" },
      { k: "delete", label: "アカウントを削除", desc: "元に戻せません", danger: true }
    ].filter(Boolean);

    const el = document.createElement("div");
    el.className = "dd";
    el.innerHTML = `<div class="dd-h">${esc(u.name)}</div>` + items.map((it) =>
      `<button data-k="${it.k}" class="${it.danger ? "danger" : ""}">
        <span class="l">${it.label}</span><span class="d">${it.desc}</span></button>`).join("");
    document.body.appendChild(el);
    ddEl = el;

    const r = btn.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = Math.min(window.innerWidth - w - 12, Math.max(12, r.right - w));
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 4);
    el.style.left = left + "px";
    el.style.top = top + "px";

    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]");
      if (!b) return;
      const k = b.dataset.k;
      closeDD();
      doUserAction(u.id, k);
    });
  }

  function doUserAction(id, k) {
    const u = store.user(id);
    if (!u) return;
    if (k === "role") {
      const to = u.role === "admin" ? "member" : "admin";
      store.patchUser(id, { role: to }).then(() => {
        render(); toast(to === "admin" ? `${u.name} を管理者にしました` : `${u.name} を一般ユーザーに戻しました`);
      });
      return;
    }
    if (k === "ban") {
      if (!u.banned) {
        confirm(`${u.name} を BAN しますか？`, "サインインとメタバースへの参加ができなくなります。参加履歴は残ります。", "BAN する", () => {
          store.patchUser(id, { banned: true }).then(() => { render(); toast(`${u.name} を BAN しました`); });
        });
      } else {
        store.patchUser(id, { banned: false }).then(() => { render(); toast(`${u.name} の BAN を解除しました`); });
      }
      return;
    }
    if (k === "kick") {
      store.kickUser(id).then(() => { render(); toast(`${u.name} の接続を切りました`); }).catch(() => toast("キックに失敗しました"));
      return;
    }
    if (k === "reset") {
      const email = u.email && !u.email.endsWith("@mmh.local") ? u.email : "";
      if (!email) {
        toast("メールアドレスが未登録です。ユーザー情報に有効な email を設定してください");
        return;
      }
      store.sendPasswordReset(id).then((res) => {
        toast(`${res.email || email} にパスワード再設定メールを送信しました`);
      }).catch((err) => {
        const msg =
          err?.data?.error === "EMAIL_REQUIRED" ? "有効なメールアドレスが必要です" :
          err?.data?.error === "RESEND_NOT_CONFIGURED" ? "メール送信（Resend）が未設定です" :
          "送信に失敗しました";
        toast(msg);
      });
      return;
    }
    if (k === "delete") {
      confirm(`${u.name} のアカウントを削除しますか？`, "サインイン情報と参加履歴がすべて削除されます。元に戻せません。", "削除", () => {
        store.users = store.users.filter((x) => x.id !== id);
        store.save();
        if (state.user === id) state.user = (store.users[0] || {}).id;
        render(); toast("アカウントを削除しました");
      });
    }
  }

  document.addEventListener("click", (e) => {
    if (ddEl && !e.target.closest(".dd") && !e.target.closest("[data-dd]")) closeDD();
  });
  window.addEventListener("scroll", closeDD, true);
  window.addEventListener("resize", closeDD);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDD(); });

  /* ================= お知らせ ================= */
  function viewAnnouncements() {
    const rows = store.announcements || [];
    const list = rows.length
      ? rows.map((a) => `<tr class="row" data-ann="${esc(a.id)}">
          <td class="num dim" style="width:150px">${fmtDateTime(a.updatedAt)}</td>
          <td><b>${esc(a.title)}</b>${a.published ? "" : ` <small class="dim">${esc(tr("admin.announcementsDraft"))}</small>`}</td>
          <td class="dim">${esc(String(a.body || "").slice(0, 80))}${String(a.body || "").length > 80 ? "…" : ""}</td>
          <td class="r"><button type="button" class="btn btn-quiet btn-sm" data-ann-del="${esc(a.id)}">${esc(tr("admin.announcementsDelete"))}</button></td>
        </tr>`).join("")
      : `<tr><td colspan="4" class="dim" style="padding:24px;text-align:center">${esc(tr("admin.announcementsEmpty"))}</td></tr>`;
  return head(tr("admin.announcementsTitle"), `<button class="btn btn-primary" data-act="ann-new">${esc(tr("admin.announcementsAdd"))}</button>`, null, `${rows.length}${tr("admin.announcementsCountSuffix")}`) +
      `<div class="sheet"><table>
        <thead><tr><th style="width:150px">${esc(tr("admin.announcementsUpdated"))}</th><th>${esc(tr("admin.announcementsColTitle"))}</th><th>${esc(tr("admin.announcementsColBody"))}</th><th class="r" style="width:100px"></th></tr></thead>
        <tbody>${list}</tbody></table></div>`;
  }

  function viewAnnEditor() {
    const a = state.annEditing;
    if (!a) return "";
    return head(
      state.isNewAnn ? tr("admin.announcementsAdd") : tr("admin.announcementsEdit"),
      `<button class="btn btn-primary" data-act="ann-save">${esc(tr("admin.save"))}</button>`,
      tr("admin.announcementsTitle"),
    ) + `<div class="sheet form">
      <form id="annForm" class="form-grid" onsubmit="return false">
        <label class="fld full"><span>${esc(tr("admin.announcementsColTitle"))}</span>
          <input id="fAnnTitle" class="inp" type="text" maxlength="120" value="${esc(a.title)}" required></label>
        <label class="fld full"><span>${esc(tr("admin.announcementsColBody"))}</span>
          <textarea id="fAnnBody" class="inp" rows="6" maxlength="4000">${esc(a.body)}</textarea></label>
        <label class="fld chk"><input id="fAnnPub" type="checkbox" ${a.published ? "checked" : ""}> ${esc(tr("admin.announcementsPublished"))}</label>
        <label class="fld"><span>${esc(tr("admin.announcementsSort"))}</span>
          <input id="fAnnSort" class="inp num" type="number" value="${Number(a.sortOrder) || 0}"></label>
        <p class="msg" id="annErr" role="alert"></p>
      </form>
    </div>`;
  }

  /* ================= 参加履歴 ================= */
  function viewLogs() {
    const logs = state.joinLogs || [];
    const fails = logs.filter((r) => !r.ok).length;
    return head("参加履歴", "", null, `${logs.length}件 · 接続失敗 ${fails}件`) +
      `<div class="sheet"><table>
        <thead><tr><th style="width:150px">日時</th><th>ユーザー</th><th>メタバース</th><th class="r" style="width:110px">結果</th></tr></thead>
        <tbody>${logs.map((r) => `<tr>
          <td class="num dim">${fmtDateTime(r.joined_at)}</td>
          <td><input type="hidden"><div class="u-cell"><span class="av">${esc(String(r.display_name || "?")[0].toUpperCase())}</span><span class="nm" style="font-weight:600;color:var(--ink)">${esc(r.display_name || "—")}</span></div></td>
          <td>${esc(store.worldName(r.world_id))}</td>
          <td class="r num">${r.ok ? "参加" : `<span style="color:var(--danger)">接続失敗</span>`}</td>
        </tr>`).join("")}</tbody></table></div>`;
  }

  /* ================= 設定 ================= */
  function viewSettings() {
    return head("設定") + `<div class="sheet set">
      <div class="set-row"><h3>管理ログイン</h3><div>
        <p>Cloudflare Worker の <code>LOBBY_ADMIN_USER</code> / <code>LOBBY_ADMIN_PASSWORD</code> で認証します。カタログは sim 本番 JSON が正本です。</p></div></div>
      <div class="set-row"><h3>パスワード再設定メール</h3><div>
        <p>Resend で再設定リンクを送信します。sim の <code>RESEND_API_KEY</code> と <code>RESEND_FROM_EMAIL</code>、任意で <code>LOBBY_PASSWORD_RESET_URL</code> を設定してください。</p></div></div>
    </div>`;
  }

  /* ================= render ================= */
  function render() {
    const active = state.view === "editor" ? "worlds" : state.view === "annEditor" ? "announcements" : state.view;
    $$(".snav").forEach((t) => t.classList.toggle("on", t.dataset.nav === active));
    $("#cw").textContent = store.worlds.length;
    $("#cu").textContent = store.users.length;
    const ca = $("#ca");
    if (ca) ca.textContent = (store.announcements || []).length;
    const v = state.view;
    if (v === "logs" && !state.joinLogs) {
      store.joinLogs(1).then((data) => { state.joinLogs = data.logs || []; render(); });
      $("#main").innerHTML = head("参加履歴", "", null, "読み込み中…");
      return;
    }
    if (v === "announcements" && state._annLoading) {
      $("#main").innerHTML = head(tr("admin.announcementsTitle"), "", null, tr("common.syncing"));
      return;
    }
    $("#main").innerHTML =
      v === "annEditor" && state.annEditing ? viewAnnEditor() :
      v === "editor" && state.editing ? viewEditor() :
      v === "users" ? viewUsers() : v === "announcements" ? viewAnnouncements() :
      v === "logs" ? viewLogs() : v === "settings" ? viewSettings() : viewWorlds();
    if (v === "worlds") {
      drawChart(true);
      pullChartMetrics();
    }
  }

  /* ================= events ================= */
  const main = $("#main");
  main.addEventListener("click", (e) => {
    const t = e.target;
    const a = t.closest("[data-act]");
    if (a) {
      e.preventDefault(); e.stopPropagation();
      const id = a.dataset.id, act = a.dataset.act;
      if (act === "new") return startNew();
      if (act === "back") {
        if (state.view === "annEditor") {
          state.view = "announcements";
          state.annEditing = null;
        } else {
          state.view = "worlds";
          state.editing = null;
        }
        return render();
      }
      if (act === "save") return save();
      if (act === "delete") return askDelete(id);
      if (act === "preview") return openPreview(id);
      if (act === "ann-new") return startNewAnn();
      if (act === "ann-save") return saveAnn();
    }
    const annDel = t.closest("[data-ann-del]");
    if (annDel) {
      e.preventDefault();
      return askDeleteAnn(annDel.dataset.annDel);
    }
    const fo = t.closest("[data-focus]");
    if (fo) { e.preventDefault(); const id = fo.dataset.focus; state.focus = state.focus === id || !id ? null : id; return render(); }
    const rg = t.closest("[data-range]");
    if (rg) { state.range = rg.dataset.range; store.fetchMetrics(state.range).then(() => render()).catch(() => render()); return; }
    const fl = t.closest("[data-filter]");
    if (fl) { state.filter = fl.dataset.filter; return render(); }
    const vw = t.closest("[data-viewer]");
    if (vw) { state.viewer = vw.dataset.viewer; $$("[data-viewer]").forEach((b) => b.classList.toggle("on", b === vw)); return refreshPv(); }
    const dd = t.closest("[data-dd]");
    if (dd) { e.preventDefault(); e.stopPropagation(); return openDD(dd); }
    const annRow = t.closest("tr.row[data-ann]");
    if (annRow && !t.closest("[data-ann-del]")) return startEditAnn(annRow.dataset.ann);
    const row = t.closest("tr.row[data-id]");
    if (row) return startEdit(row.dataset.id);
    const ur = t.closest("tr.row[data-user]");
    if (ur) { state.user = ur.dataset.user; return render(); }
  });

  main.addEventListener("input", (e) => {
    const t = e.target, w = state.editing;
    if (t.id === "q") {
      state.q = t.value; render();
      const q = $("#q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); return;
    }
    if (!w) return;
    if (t.id === "fName") w.name = t.value;
    else if (t.id === "fUrl") w.url = t.value;
    else if (t.id === "fDesc") { w.desc = t.value; $("#dCount").textContent = t.value.length + " / 160"; }
    else if (t.id === "fCap") w.cap = +t.value || 0;
    else if (t.id === "fCode") { t.value = t.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""); w.code = t.value; }
    else if (t.id === "fThumb") { w.thumb = t.value.trim(); $("#thPrev").innerHTML = w.thumb ? `<img src="${esc(w.thumb)}" alt="">` : ""; }
    refreshPv();
  });
  main.addEventListener("change", (e) => {
    const t = e.target, w = state.editing;
    if (!w || t.type !== "radio") return;
    const key = t.name === "st" ? "status" : "audience";
    w[key] = t.value;
    $$(`input[name="${t.name}"]`).forEach((r) => r.closest("label").classList.toggle("on", r.checked));
    refreshPv();
  });

  function startNew() {
    state.editing = { id: "new-" + Date.now().toString(36), name: "", url: "", code: "", thumb: "", desc: "", status: "open", audience: "all", cap: 500, players: 0, updated: new Date().toISOString() };
    state.isNew = true; state.view = "editor"; render(); window.scrollTo(0, 0);
    setTimeout(() => $("#fName") && $("#fName").focus(), 30);
  }
  function startEdit(id) {
    const w = store.world(id); if (!w) return;
    state.editing = JSON.parse(JSON.stringify(w)); state.isNew = false; state.view = "editor";
    render(); window.scrollTo(0, 0);
  }
  function save() {
    const w = state.editing; let ok = true;
    const set = (id, el, msg) => { $(id).textContent = msg; $(el).classList.toggle("bad", !!msg); if (msg) ok = false; };
    set("#eName", "#fName", w.name.trim() ? "" : "名前を入力してください");
    set("#eUrl", "#fUrl", /^https?:\/\/\S+\.\S+/.test(w.url.trim()) ? "" : "http:// または https:// で始まるURLを入力してください");
    if (!ok) return;
    if (state.isNew) {
      w.id = (w.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "world") + "-" + Math.random().toString(36).slice(2, 5);
      w.code = w.code || w.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase();
    }
    w.name = w.name.trim(); w.url = w.url.trim(); w.updated = new Date().toISOString();
    store.upsertWorld(w).then(() => {
      const msg = state.isNew ? "追加しました" : "保存しました";
      state.view = "worlds"; state.editing = null; state.isNew = false;
      render(); toast(msg);
    }).catch(() => toast("保存に失敗しました"));
  }
  function startNewAnn() {
    state.annEditing = { id: "", title: "", body: "", published: true, sortOrder: 0 };
    state.isNewAnn = true;
    state.view = "annEditor";
    render();
    setTimeout(() => $("#fAnnTitle") && $("#fAnnTitle").focus(), 30);
  }
  function startEditAnn(id) {
    const a = (store.announcements || []).find((x) => x.id === id);
    if (!a) return;
    state.annEditing = JSON.parse(JSON.stringify(a));
    state.isNewAnn = false;
    state.view = "annEditor";
    render();
  }
  function saveAnn() {
    const a = state.annEditing;
    if (!a) return;
    const title = ($("#fAnnTitle")?.value || "").trim();
    const body = ($("#fAnnBody")?.value || "").trim();
    const published = Boolean($("#fAnnPub")?.checked);
    const sortOrder = Number($("#fAnnSort")?.value) || 0;
    const err = $("#annErr");
    if (!title || !body) {
      if (err) err.textContent = tr("admin.announcementsValidation");
      return;
    }
    if (err) err.textContent = "";
    const payload = { title, body, published, sortOrder };
    const p = state.isNewAnn
      ? store.createAnnouncement(payload)
      : store.updateAnnouncement(a.id, payload);
    p.then(() => {
      state.view = "announcements";
      state.annEditing = null;
      state.isNewAnn = false;
      render();
      toast(tr("admin.announcementsSaved"));
    }).catch(() => {
      if (err) err.textContent = tr("admin.announcementsSaveFail");
    });
  }
  function askDeleteAnn(id) {
    const a = (store.announcements || []).find((x) => x.id === id);
    if (!a) return;
    confirm(a.title, tr("admin.announcementsDeleteBody"), tr("admin.announcementsDelete"), () => {
      store.removeAnnouncement(id).then(() => {
        render();
        toast(tr("admin.announcementsDeleted"));
      }).catch(() => toast(tr("admin.announcementsSaveFail")));
    });
  }

  function askDelete(id) {
    const w = store.world(id); if (!w) return;
    confirm(`「${w.name}」を削除しますか？`, "公開ページの一覧からも消えます。参加履歴は残ります。", "削除", () => {
      store.removeWorld(id).then(() => {
        if (state.focus === id) state.focus = null;
        state.view = "worlds"; state.editing = null; render(); toast("削除しました");
      }).catch(() => toast("削除に失敗しました"));
    });
  }

  /* ================= modal ================= */
  const scrim = $("#scrim");
  function close() { scrim.classList.remove("on"); setTimeout(() => { if (!scrim.classList.contains("on")) scrim.innerHTML = ""; }, 160); }
  scrim.addEventListener("click", (e) => { if (e.target === scrim || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  function confirm(title, body, ok, fn) {
    scrim.innerHTML = `<div class="modal"><h2>${esc(title)}</h2><p>${esc(body)}</p>
      <div class="btns"><button class="btn btn-quiet" data-close>キャンセル</button><button class="btn btn-danger" id="okB">${esc(ok)}</button></div></div>`;
    scrim.classList.add("on");
    $("#okB").addEventListener("click", () => { close(); fn(); });
    setTimeout(() => $("#okB").focus(), 30);
  }

  function openPreview(id) {
    const w = (state.editing && state.editing.id === id) ? state.editing : store.world(id);
    if (!w) return;
    const paint = () => {
      $("#bigL").innerHTML = U.lobby(w, pvWorlds(w), state.viewer);
      $("#bigP").innerHTML = U.popup(w, state.viewer);
    };
    scrim.innerHTML = `<div class="modal wide">
      <div class="mw-h"><h2>${esc(w.name || "名称未設定")} のプレビュー</h2>
        <div class="r">${viewerToggle("data-pv")}<button class="btn btn-quiet" data-close>閉じる</button></div></div>
      <div class="mw-b"><div class="pv-stage">
        <div><div class="pv-cap">一覧</div><div id="bigL"></div></div>
        <div><div class="pv-cap">選択したとき</div><div id="bigP" style="max-width:340px"></div></div>
      </div></div></div>`;
    paint();
    scrim.classList.add("on");
    $$("[data-pv]", scrim).forEach((b) => b.addEventListener("click", () => {
      state.viewer = b.dataset.pv;
      $$("[data-pv]", scrim).forEach((x) => x.classList.toggle("on", x === b));
      $$("[data-viewer]").forEach((x) => x.classList.toggle("on", x.dataset.viewer === state.viewer));
      paint(); refreshPv();
    }));
  }

  let tt;
  function toast(m) {
    const el = $("#toast"); el.textContent = m; el.classList.add("on");
    clearTimeout(tt); tt = setTimeout(() => el.classList.remove("on"), 2200);
  }

  window.addEventListener("lobby:locale-change", () => {
    window.LobbyI18n?.applyDom(document.body);
    render();
  });
})();
