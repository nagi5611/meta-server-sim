/* みんなでメタ 管理パネル v2 — 画面 */
(function () {
  "use strict";
  const tr = (k, v) => (window.LobbyI18n && window.LobbyI18n.t(k, v)) || k;
  const M = window.MMH, U = window.UI;
  const { store, AUDIENCE, fmtNum, fmtDateTime, fmtLobbyDate, fmtDur } = M;
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
  const otpState = { challengeId: null, pending: false };

  function resetOtpGate() {
    otpState.challengeId = null;
    otpState.pending = false;
    const otpField = $("#gateOtpField");
    const otp = $("#gOtp");
    const hint = $("#gateOtpHint");
    const audit = $("#gateAudit");
    if (otpField) otpField.hidden = true;
    if (otp) otp.value = "";
    if (hint) hint.textContent = "";
    if (audit) { audit.hidden = true; audit.textContent = ""; }
    const btn = $("#gateBtn");
    if (btn) btn.textContent = tr("admin.gateLogin");
  }

  function showSuperLoginAudit() {
    const strip = $("#superLoginAudit");
    if (!strip) return;
    const last = store.superLoginAudit?.lastSuccess;
    if (store.superAdmin && last?.eventAtJst) {
      strip.hidden = false;
      strip.textContent = tr("admin.superLoginLast", {
        ip: last.clientIp || "—",
        at: last.eventAtJst,
      });
    } else {
      strip.hidden = true;
      strip.textContent = "";
    }
  }

  async function enter() {
    $("#gateErr").textContent = "";
    $("#gateBtn").disabled = true;
    try {
      await store.refresh();
      const who = $("#whoUser");
      if (who && store.adminUsername) who.textContent = store.adminUsername;
      resetOtpGate();
      showSuperLoginAudit();
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
    $("#gateBtn").disabled = true;
    try {
      if (otpState.pending && otpState.challengeId) {
        const code = $("#gOtp")?.value?.trim() || "";
        await window.LobbyAdminApi.verifyOtp(otpState.challengeId, code);
        await enter();
        return;
      }
      const data = await window.LobbyAdminApi.login($("#gUser").value.trim(), $("#gPass").value);
      if (data?.otpRequired && data.challengeId) {
        otpState.challengeId = data.challengeId;
        otpState.pending = true;
        const otpField = $("#gateOtpField");
        const hint = $("#gateOtpHint");
        const audit = $("#gateAudit");
        if (otpField) otpField.hidden = false;
        if (hint) {
          hint.textContent = tr("admin.gateOtpSent", { mask: data.otpSentTo || "email" });
        }
        if (audit && data.clientIp && data.attemptedAtJst) {
          audit.hidden = false;
          audit.textContent = tr("admin.gateAttemptAudit", {
            ip: data.clientIp,
            at: data.attemptedAtJst,
          });
        }
        $("#gateBtn").textContent = tr("admin.gateOtpSubmit");
        setTimeout(() => $("#gOtp")?.focus(), 50);
        return;
      }
      await enter();
    } catch (err) {
      const code = err?.data?.error;
      const key =
        code === "banned"
          ? "admin.gateBanned"
          : code === "admin_required"
            ? "admin.gateAdminRequired"
            : code === "session_not_configured"
              ? "admin.gateSessionNotConfigured"
              : code === "otp_invalid" || code === "otp_expired" || code === "otp_locked"
                ? "admin.gateOtpInvalid"
                : code === "otp_mail_not_configured" || code === "otp_send_failed"
                  ? "admin.gateOtpMailFail"
                  : "admin.gateErr";
      $("#gateErr").textContent = tr(key);
      if (otpState.pending) $("#gOtp")?.select();
      else $("#gPass").select();
    } finally {
      $("#gateBtn").disabled = false;
    }
  });
  $("#logoutBtn").addEventListener("click", async () => {
    try { await window.LobbyAdminApi.logout(); } catch { /* ignore */ }
    app.hidden = true; gate.hidden = false;
    resetOtpGate();
    $("#gPass").value = ""; $("#gUser").focus();
    const strip = $("#superLoginAudit");
    if (strip) { strip.hidden = true; strip.textContent = ""; }
  });
  (async function trySession() {
    async function openApp() {
      const who = $("#whoUser");
      if (who && store.adminUsername) who.textContent = store.adminUsername;
      showSuperLoginAudit();
      gate.hidden = true;
      app.hidden = false;
      render();
    }
    try {
      await store.refresh();
      await openApp();
    } catch {
      try {
        await window.LobbyAdminApi.bootstrapFromLobby();
        await store.refresh();
        await openApp();
      } catch {
        gate.hidden = false;
        app.hidden = true;
        setTimeout(() => $("#gUser").focus(), 50);
      }
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
        <label for="fThumb">サムネイル<span class="sub">16:9 · JPEG/PNG/WebP/GIF · 最大10MB</span></label>
        <div class="thumb-in">
          <div class="thumb-box" id="thPrev">${w.thumb ? `<img src="${esc(w.thumb)}" alt="">` : ""}</div>
          <div class="thumb-side">
            <div class="thumb-drop" id="thDrop" tabindex="0" role="button" aria-label="画像をドロップまたはクリックして選択">
              <span class="thumb-drop-t" id="thDropTxt">画像をドロップ、またはクリックして選択</span>
              <span class="thumb-drop-sub">アップロード後にURLが入力されます</span>
              <input type="file" id="thFile" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
            </div>
            <div class="thumb-prog" id="thProg" hidden><i id="thProgBar" style="width:0%"></i></div>
            <p class="err" id="thUpErr"></p>
            <input class="inp" id="fThumb" maxlength="300" value="${esc(w.thumb)}" placeholder="画像のURL（直接入力も可）">
          </div>
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
  const BAN_ACTION_TEXT = { ban: "BAN", unban: "解除", expire: "期限切れ" };
  function fmtBanUntil(u) {
    if (!u?.banned) return "—";
    if (!u.banExpiresAt) return "永久";
    return `～${fmtDateTime(u.banExpiresAt)}`;
  }
  function userState(u) {
    if (u.banned) return `<span class="st bad" title="${esc(fmtBanUntil(u))}">停止中</span>`;
    if (u.online) return `<span class="st">オンライン</span>`;
    return `<span class="st off">オフライン</span>`;
  }
  function fmtBanHistoryRow(h) {
    const ends = h.endsAt ? fmtDateTime(h.endsAt) : "永久";
  const who = h.actor ? esc(h.actor) : "—";
    return `<div class="hrow"><b>${BAN_ACTION_TEXT[h.action] || esc(h.action)}</b>
      <span class="d num">${who}</span>
      <span class="t num">${fmtDateTime(h.startedAt)} · ${ends}</span></div>`;
  }

  function ensureUserBanHistory(id) {
    if (!id) return;
    const u = store.user(id);
    if (!u || u._banHist) return;
    u._banHist = "loading";
    store.loadBanHistory(id).then(() => {
      u._banHist = "done";
      render();
    }).catch(() => { u._banHist = "err"; });
  }

  function viewUsers() {
    const us = store.users;
    const sel = us.find((u) => u.id === state.user) || us[0];
    if (sel?.id) ensureUserBanHistory(sel.id);
    const rows = us.map((u) => `
      <tr class="row ${u.id === sel.id ? "sel" : ""}" data-user="${esc(u.id)}">
        <td><div class="u-cell"><span class="av">${esc(u.name[0].toUpperCase())}</span>
          <div><div class="nm">${esc(u.name)} ${u.role === "admin" ? `<span class="tag">管理者</span>` : ""} ${u.banned ? `<span class="tag warn">BAN</span>` : ""}</div><div class="em">${esc(u.email)}</div></div></div></td>
        <td class="hide-sm">${userState(u)}<span class="dim" style="display:block;font-size:11px;margin-top:2px">${esc(fmtBanUntil(u))}</span></td>
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
        <div><span>BAN 期間</span><b class="num" style="font-size:13px">${esc(fmtBanUntil(sel))}</b></div>
      </div>
      ${sel.banned ? `<div class="det-ban">このアカウントは BAN されています。サインインもメタバースへの参加もできません。</div>` : ""}
      <div class="det-l"><div class="cap">BAN 履歴</div>
        ${(sel.banHistory || []).length
          ? (sel.banHistory || []).map((h) => fmtBanHistoryRow(h)).join("")
          : '<p class="dim" style="margin:0;font-size:13px">履歴を読み込むと表示されます</p>'}
      </div>
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
      store.superAdmin
        ? (u.role === "admin"
          ? { k: "role", label: "管理者から外す", desc: "一般ユーザーに戻す" }
          : { k: "role", label: "管理者にする", desc: "管理画面へアクセスできる" })
        : null,
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
      if (!store.superAdmin) {
        toast(tr("admin.superAdminRequired"));
        return;
      }
      const to = u.role === "admin" ? "member" : "admin";
      store.patchUser(id, { role: to }).then(() => {
        render(); toast(to === "admin" ? `${u.name} を管理者にしました` : `${u.name} を一般ユーザーに戻しました`);
      }).catch((err) => {
        if (err?.data?.error === "super_admin_required") toast(tr("admin.superAdminRequired"));
        else toast(tr("admin.userPatchFail"));
      });
      return;
    }
    if (k === "ban") {
      if (!u.banned) {
        openBanModal(u);
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
  const ANN_LOCALE_CODES = ["ja", "zh-CN", "zh-TW", "en"];
  const ANN_LOCALE_LABEL = {
    ja: "admin.announcementsLocaleJa",
    "zh-CN": "admin.announcementsLocaleZhCN",
    "zh-TW": "admin.announcementsLocaleZhTW",
    en: "admin.announcementsLocaleEn",
  };

  function annInputDomId(code) {
    return "fAnnT_" + String(code).replace(/[^a-zA-Z0-9]/g, "_");
  }

  function ensureAnnI18n(a) {
    const src = a.sourceLocale || window.LobbyI18n?.getLocale?.() || "ja";
    const i18n = a.i18n && typeof a.i18n === "object" ? JSON.parse(JSON.stringify(a.i18n)) : {};
    for (const code of ANN_LOCALE_CODES) {
      const hit = i18n[code];
      const t = typeof hit?.title === "string" ? hit.title : "";
      i18n[code] = {
        title: t || (code === src ? String(a.title || "") : ""),
        body: "",
      };
    }
    a.i18n = i18n;
    a.title = String(i18n[src]?.title || a.title || "").trim();
    return i18n;
  }

  function annTitleForLocale(a, code) {
    return String(ensureAnnI18n(a)[code]?.title || "").trim();
  }

  function collectAnnI18nFromForm() {
    /** @type {Record<string, { title: string, body: string }>} */
    const out = {};
    for (const code of ANN_LOCALE_CODES) {
      const inp = document.getElementById(annInputDomId(code));
      out[code] = { title: (inp?.value || "").trim(), body: "" };
    }
    return out;
  }

  function syncAnnEditingFromForm() {
    const a = state.annEditing;
    if (!a) return;
    a.sourceLocale = ($("#fAnnLocale")?.value || a.sourceLocale || "ja").trim();
    a.i18n = collectAnnI18nFromForm();
    a.title = annTitleForLocale(a, a.sourceLocale);
    a.published = Boolean($("#fAnnPub")?.checked);
  }

  function refreshAnnRowPreviews() {
    const a = state.annEditing;
    if (!a || state.view !== "annEditor") return;
    syncAnnEditingFromForm();
    const dateRaw = a.createdAt || a.updatedAt || new Date().toISOString();
    const dateStr = fmtLobbyDate(dateRaw);
    for (const code of ANN_LOCALE_CODES) {
      const title = annTitleForLocale(a, code) || "—";
      const row = $$(`.ann-locale-row`, $("#main")).find((el) => el.dataset.annLocale === code);
      if (!row) continue;
      const prevTitle = $(".ann-prev-title", row);
      const prevDate = $(".ann-prev-date", row);
      if (prevTitle) prevTitle.textContent = title;
      if (prevDate) prevDate.textContent = dateStr;
    }
    refreshAnnLobbyPreview();
  }

  function refreshAnnLobbyPreview() {
    const list = $("#annPvList");
    if (!list || !state.annEditing) return;
    syncAnnEditingFromForm();
    const a = state.annEditing;
    const dateRaw = a.createdAt || a.updatedAt || new Date().toISOString();
    const dateStr = fmtLobbyDate(dateRaw);
    const items = ANN_LOCALE_CODES.map((code) => {
      const title = annTitleForLocale(a, code);
      if (!title) return "";
      return `<li class="ann-prev-item">
        <div class="ann-head">
          <time class="ann-date">${esc(dateStr)}</time>
          <h3 class="ann-title"><span class="ann-pv-lbl">${esc(tr(ANN_LOCALE_LABEL[code] || code))}</span>${esc(title)}</h3>
        </div>
      </li>`;
    }).filter(Boolean).join("");
    list.innerHTML = items || `<li class="ann-prev-empty">${esc(tr("admin.announcementsPreviewEmpty"))}</li>`;
  }

  function viewAnnouncements() {
    const rows = store.announcements || [];
    const list = rows.length
      ? rows.map((a) => {
          const dateRaw = a.createdAt || a.updatedAt;
          const pubLbl = tr("admin.announcementsPublished");
          return `<div class="ann-row" data-ann="${esc(a.id)}" role="button" tabindex="0">
            <span class="ann-row-date num">${esc(fmtLobbyDate(dateRaw))}</span>
            <span class="ann-row-main">
              <span class="ann-row-title" data-ann-title="${esc(a.id)}">${esc(a.title)}${a.published ? "" : ` <small class="dim">${esc(tr("admin.announcementsDraft"))}</small>`}</span>
            </span>
            <span class="ann-row-pub">
              <label class="ann-list-pub" title="${esc(pubLbl)}">
                <input type="checkbox" class="ann-pub-cb" data-ann-pub="${esc(a.id)}" ${a.published ? "checked" : ""} aria-label="${esc(pubLbl)}" ${state._annPubBusy === a.id ? "disabled" : ""}>
              </label>
            </span>
            <span class="ann-row-del"><button type="button" class="txt-btn" data-ann-del="${esc(a.id)}">${esc(tr("admin.announcementsDelete"))}</button></span>
          </div>`;
        }).join("")
      : `<p class="empty">${esc(tr("admin.announcementsEmpty"))}</p>`;
    return head(
      tr("admin.announcementsTitle"),
      `<button class="btn btn-primary" data-act="ann-new">${esc(tr("admin.announcementsAdd"))}</button>`,
      null,
      `${rows.length}${tr("admin.announcementsCountSuffix")}`,
    ) + `<div class="sheet ann-sheet"><div class="ann-list-admin">${list}</div></div>`;
  }

  function viewAnnEditor() {
    const a = state.annEditing;
    if (!a) return "";
    ensureAnnI18n(a);
    const srcLoc = a.sourceLocale || "ja";
    const localeOpts = ANN_LOCALE_CODES.map(
      (code) =>
        `<option value="${esc(code)}"${srcLoc === code ? " selected" : ""}>${esc(tr(ANN_LOCALE_LABEL[code] || code))}</option>`,
    ).join("");
    const dateRaw = a.createdAt || a.updatedAt || new Date().toISOString();
    const dateStr = fmtLobbyDate(dateRaw);
    const localeRows = ANN_LOCALE_CODES.map((code) => {
      const isSource = srcLoc === code;
      const title = annTitleForLocale(a, code);
      const previewTitle = title || "—";
      return `<div class="ann-locale-row${isSource ? " is-source" : ""}" data-ann-locale="${esc(code)}">
        <div class="ann-locale-prev" aria-hidden="true">
          <div class="ann-locale-prev-h">
            <span class="ann-locale-code">${esc(tr(ANN_LOCALE_LABEL[code] || code))}</span>
            ${isSource ? `<span class="tag ann-src-tag">${esc(tr("admin.announcementsSourceBadge"))}</span>` : ""}
          </div>
          <div class="ann-prev-item">
            <div class="ann-head">
              <time class="ann-prev-date ann-date">${esc(dateStr)}</time>
              <h3 class="ann-prev-title ann-title">${esc(previewTitle)}</h3>
            </div>
          </div>
        </div>
        <div class="field ann-locale-field">
          <label for="${annInputDomId(code)}">${esc(tr("admin.announcementsColTitle"))}</label>
          <input id="${annInputDomId(code)}" class="inp" type="text" data-ann-locale-inp="${esc(code)}" maxlength="120" value="${esc(title)}" autocomplete="off">
        </div>
      </div>`;
    }).join("");
    return head(
      state.isNewAnn ? tr("admin.announcementsAdd") : tr("admin.announcementsEdit"),
      `<button class="btn btn-primary" data-act="ann-save">${esc(tr("admin.save"))}</button>`,
      tr("admin.announcementsTitle"),
    ) + `<div class="ed ann-ed">
      <div class="sheet ann-editor">
        <form id="annForm" class="ann-form" onsubmit="return false">
          <div class="ann-locale-toolbar">
            <div class="field ann-src-locale">
              <label for="fAnnLocale">${esc(tr("admin.announcementsSourceLocale"))}</label>
              <select id="fAnnLocale" class="inp">${localeOpts}</select>
            </div>
            <button type="button" class="btn btn-quiet ann-retranslate-btn" data-act="ann-retranslate">${esc(tr("admin.announcementsRetranslate"))}</button>
          </div>
          <p class="ann-i18n-hint">${esc(tr("admin.announcementsI18nHint"))}</p>
          <div class="ann-locale-grid">${localeRows}</div>
          <label class="ann-pub">
            <input id="fAnnPub" type="checkbox" ${a.published ? "checked" : ""}>
            <span>${esc(tr("admin.announcementsPublished"))}</span>
          </label>
          <p class="msg" id="annErr" role="alert"></p>
        </form>
      </div>
      <div class="pv-wrap ann-pv-wrap">
        <div class="pv-bar"><h2>${esc(tr("admin.announcementsPreview"))}</h2></div>
        <div class="pv-stage ann-pv-stage">
          <div>
            <div class="pv-cap">${esc(tr("lobby.announcements"))}</div>
            <section class="panel announcements ann-pv-panel" aria-labelledby="annPvTitle">
              <h2 class="sr-only" id="annPvTitle">${esc(tr("admin.announcementsPreview"))}</h2>
              <ul class="ann-list ann-prev-list" id="annPvList"></ul>
            </section>
          </div>
        </div>
        <p class="pv-note">${esc(tr("admin.announcementsPreviewNote"))}</p>
      </div>
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
    const auditRows = (state.superLoginEvents || []).map((r) => {
      const outcome = tr(`admin.superLoginOutcome.${r.outcome}`) || r.outcome;
      return `<tr><td class="num dim">${esc(r.eventAtJst)}</td><td class="num">${esc(r.clientIp || "—")}</td><td>${esc(outcome)}</td></tr>`;
    }).join("");
    const auditBlock = store.superAdmin
      ? `<div class="set-row"><h3 data-i18n="admin.superLoginAuditTitle">スーパー管理者ログイン</h3><div>
        <p data-i18n="admin.superLoginAuditDesc">パスワード承認・OTP・セッション開始を IP と JST 時刻で記録します。</p>
        ${state._superAuditLoading ? `<p>${esc(tr("common.syncing"))}</p>` : ""}
        ${auditRows ? `<table class="mini-log"><thead><tr><th>時刻 (JST)</th><th>IP</th><th>結果</th></tr></thead><tbody>${auditRows}</tbody></table>` : `<p class="dim">${esc(tr("admin.superLoginAuditEmpty"))}</p>`}
      </div></div>`
      : "";
    return head("設定") + `<div class="sheet set">
      <div class="set-row"><h3>管理ログイン</h3><div>
        <p>Cloudflare Worker の <code>LOBBY_ADMIN_USER</code> / <code>LOBBY_ADMIN_PASSWORD</code> で認証します。スーパー管理者は <code>ADMIN_EMAIL</code> 宛 OTP 2FA（Secrets: <code>ADMIN_EMAIL</code>, <code>ADMIN_OTP_SECRET</code>, Worker <code>RESEND_API_KEY</code>）。カタログは sim 本番 JSON が正本です。</p></div></div>
      ${auditBlock}
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
    if (v === "settings" && store.superAdmin && !state.superLoginEvents && !state._superAuditLoading) {
      state._superAuditLoading = true;
      window.LobbyAdminApi.superLoginAudit(25).then((data) => {
        state.superLoginEvents = data.events || [];
        state._superAuditLoading = false;
        if (state.view === "settings") render();
      }).catch(() => {
        state._superAuditLoading = false;
      });
    }
    if (v === "worlds") {
      drawChart(true);
      pullChartMetrics();
    }
    if (v === "editor" && state.editing) bindThumbUpload();
    if (v === "annEditor" && state.annEditing) refreshAnnLobbyPreview();
  }

  function setThumbPreview(url) {
    const box = $("#thPrev");
    if (!box) return;
    box.innerHTML = url ? `<img src="${esc(url)}" alt="">` : "";
  }

  function bindThumbUpload() {
    const drop = $("#thDrop");
    const input = $("#thFile");
    if (!drop || !input || drop.dataset.bound) return;
    drop.dataset.bound = "1";

    const pick = () => input.click();

    drop.addEventListener("click", (e) => {
      if (e.target === input) return;
      pick();
    });
    drop.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick();
      }
    });
    ["dragenter", "dragover"].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add("drag");
      });
    });
    ["dragleave", "drop"].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (ev === "drop") drop.classList.remove("drag");
      });
    });
    drop.addEventListener("dragleave", (e) => {
      if (!drop.contains(e.relatedTarget)) drop.classList.remove("drag");
    });
    drop.addEventListener("drop", (e) => {
      drop.classList.remove("drag");
      const f = e.dataTransfer?.files?.[0];
      if (f) void uploadThumbFile(f);
    });
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      input.value = "";
      if (f) void uploadThumbFile(f);
    });
  }

  const THUMB_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

  function validateThumbFile(file) {
    const type = String(file?.type || "").toLowerCase();
    if (!THUMB_TYPES.has(type)) {
      return "JPEG・PNG・WebP・GIF のみアップロードできます";
    }
    const size = Number(file?.size) || 0;
    if (size <= 0) return "空のファイルはアップロードできません";
    return "";
  }

  async function uploadThumbFile(file) {
    const w = state.editing;
    if (!w || !window.LobbyAdminApi?.uploadThumbnail) return;
    const errEl = $("#thUpErr");
    const prog = $("#thProg");
    const bar = $("#thProgBar");
    const dropTxt = $("#thDropTxt");
    const clientErr = validateThumbFile(file);
    if (clientErr) {
      if (errEl) errEl.textContent = clientErr;
      toast(clientErr);
      return;
    }
    if (!window.resizeThumbnailFile) {
      const msg = "画像の処理モジュールを読み込めませんでした";
      if (errEl) errEl.textContent = msg;
      toast(msg);
      return;
    }
    if (errEl) errEl.textContent = "";
    if (prog) prog.hidden = false;
    if (bar) bar.style.width = "0%";
    if (dropTxt) dropTxt.textContent = "画像を処理中…";
    let uploadFile = file;
    try {
      const { blob, fileName } = await window.resizeThumbnailFile(file);
      uploadFile = new File([blob], fileName, { type: blob.type || "image/webp" });
    } catch (err) {
      const msg =
        err?.message === "file_too_large"
          ? "ファイルが大きすぎます（最大10MB）"
          : "画像の処理に失敗しました";
      if (errEl) errEl.textContent = msg;
      toast(msg);
      if (prog) prog.hidden = true;
      if (bar) bar.style.width = "0%";
      if (dropTxt) dropTxt.textContent = "画像をドロップ、またはクリックして選択";
      return;
    }
    if (dropTxt) dropTxt.textContent = "アップロード中…";
    try {
      const data = await window.LobbyAdminApi.uploadThumbnail(uploadFile, (pct) => {
        if (bar) bar.style.width = pct + "%";
      });
      const url = String(data?.url || "").trim();
      if (!url) throw new Error("no_url");
      w.thumb = url;
      const inp = $("#fThumb");
      if (inp) inp.value = url;
      setThumbPreview(url);
      refreshPv();
      toast("サムネイルをアップロードしました");
    } catch (err) {
      const code = err?.data?.error || err?.message || "";
      const msg =
        code === "assets_not_configured" ? "画像ストレージが未設定です（運用に連絡してください）" :
        code === "invalid_type" ? "JPEG・PNG・WebP・GIF のみアップロードできます" :
        code === "file_too_large" ? "ファイルが大きすぎます（最大10MB）" :
        "アップロードに失敗しました";
      if (errEl) errEl.textContent = msg;
      toast(msg);
    } finally {
      if (prog) prog.hidden = true;
      if (bar) bar.style.width = "0%";
      if (dropTxt) dropTxt.textContent = "画像をドロップ、またはクリックして選択";
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
      if (act === "ann-save") return saveAnn(false);
      if (act === "ann-retranslate") return saveAnn(true);
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
    const annRow = t.closest(".ann-row[data-ann]");
    if (annRow && !t.closest("[data-ann-del]") && !t.closest("[data-ann-pub]")) {
      return startEditAnn(annRow.dataset.ann);
    }
    const row = t.closest("tr.row[data-id]");
    if (row) return startEdit(row.dataset.id);
    const ur = t.closest("tr.row[data-user]");
    if (ur) {
      state.user = ur.dataset.user;
      ensureUserBanHistory(state.user);
      return render();
    }
  });

  main.addEventListener("input", (e) => {
    const t = e.target, w = state.editing;
    if (t.dataset?.annLocaleInp && state.annEditing) {
      refreshAnnRowPreviews();
      return;
    }
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
    else if (t.id === "fThumb") { w.thumb = t.value.trim(); setThumbPreview(w.thumb); }
    refreshPv();
  });
  function syncAnnRowPublished(id, published) {
    const titleEl = $(`[data-ann-title="${CSS.escape(id)}"]`);
    if (!titleEl) return;
    const a = (store.announcements || []).find((x) => x.id === id);
    if (!a) return;
    titleEl.innerHTML = published
      ? esc(a.title)
      : `${esc(a.title)} <small class="dim">${esc(tr("admin.announcementsDraft"))}</small>`;
  }

  async function toggleAnnPublished(id, published) {
    const a = (store.announcements || []).find((x) => x.id === id);
    if (!a) return;
    const prev = Boolean(a.published);
    if (prev === published) return;
    a.published = published;
    syncAnnRowPublished(id, published);
    state._annPubBusy = id;
    const cb = $(`[data-ann-pub="${CSS.escape(id)}"]`);
    if (cb) cb.disabled = true;
    try {
      await store.updateAnnouncement(id, { published });
      toast(published ? tr("admin.announcementsPublishedOn") : tr("admin.announcementsPublishedOff"));
    } catch {
      a.published = prev;
      if (cb) cb.checked = prev;
      syncAnnRowPublished(id, prev);
      toast(tr("admin.announcementsSaveFail"));
    } finally {
      state._annPubBusy = null;
      if (cb) cb.disabled = false;
    }
  }

  main.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches?.("[data-ann-pub]")) {
      e.stopPropagation();
      void toggleAnnPublished(t.dataset.annPub, t.checked);
      return;
    }
    if (t.id === "fAnnLocale" && state.annEditing) {
      syncAnnEditingFromForm();
      render();
      return;
    }
    if (t.id === "fAnnPub" && state.annEditing) {
      state.annEditing.published = Boolean(t.checked);
      return;
    }
    const w = state.editing;
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
    const src = window.LobbyI18n?.getLocale?.() || "ja";
    state.annEditing = {
      id: "",
      title: "",
      published: true,
      sourceLocale: src,
      i18n: Object.fromEntries(ANN_LOCALE_CODES.map((c) => [c, { title: "", body: "" }])),
    };
    state.isNewAnn = true;
    state.view = "annEditor";
    render();
    const focusId = annInputDomId(src);
    setTimeout(() => document.getElementById(focusId)?.focus(), 30);
  }
  function startEditAnn(id) {
    const a = (store.announcements || []).find((x) => x.id === id);
    if (!a) return;
    state.annEditing = JSON.parse(JSON.stringify(a));
    ensureAnnI18n(state.annEditing);
    state.isNewAnn = false;
    state.view = "annEditor";
    render();
  }
  function saveAnn(retranslate) {
    const a = state.annEditing;
    if (!a) return;
    syncAnnEditingFromForm();
    const published = Boolean(a.published);
    const sourceLocale = a.sourceLocale || "ja";
    const i18n = collectAnnI18nFromForm();
    const title = (i18n[sourceLocale]?.title || "").trim();
    const err = $("#annErr");
    const srcInp = document.getElementById(annInputDomId(sourceLocale));
    if (!title) {
      if (err) err.textContent = tr("admin.announcementsValidation");
      srcInp?.classList.add("bad");
      return;
    }
    srcInp?.classList.remove("bad");
    if (err) err.textContent = "";
    const payload = { title, published, sourceLocale, i18n, retranslate: Boolean(retranslate) };
    const stayOnEditor = Boolean(retranslate);
    const p = state.isNewAnn
      ? store.createAnnouncement(payload)
      : store.updateAnnouncement(a.id, payload);
    p.then((saved) => {
      if (stayOnEditor && saved) {
        state.annEditing = JSON.parse(JSON.stringify(saved));
        ensureAnnI18n(state.annEditing);
        state.isNewAnn = false;
        render();
        toast(tr("admin.announcementsRetranslated"));
        return;
      }
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

  function openBanModal(u) {
    const def = new Date(Date.now() + 7 * 864e5);
    def.setMinutes(0, 0, 0);
    const local = new Date(def.getTime() - def.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    scrim.innerHTML = `<div class="modal"><h2>${esc(u.name)} を BAN</h2>
      <p>サインインとメタバースへの参加を停止します。</p>
      <label style="display:flex;gap:8px;align-items:center;margin:12px 0;font-size:14px">
        <input type="checkbox" id="banPerm" checked> 永久 BAN
      </label>
      <label class="dim" style="display:block;font-size:13px;margin-bottom:6px">解除予定（永久以外）</label>
      <input type="datetime-local" id="banUntil" class="inp" disabled value="${local}">
      <div class="btns" style="margin-top:16px">
        <button class="btn btn-quiet" data-close>キャンセル</button>
        <button class="btn btn-danger" id="okB">BAN する</button>
      </div></div>`;
    scrim.classList.add("on");
    const perm = $("#banPerm");
    const until = $("#banUntil");
    perm?.addEventListener("change", () => { if (until) until.disabled = perm.checked; });
    $("#okB").addEventListener("click", () => {
      const patch = { banned: true };
      if (!perm?.checked && until?.value) {
        patch.banExpiresAt = new Date(until.value).toISOString();
      } else {
        patch.banPermanent = true;
      }
      close();
      store.patchUser(u.id, patch).then(() => {
        render();
        toast(`${u.name} を BAN しました`);
      });
    });
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
