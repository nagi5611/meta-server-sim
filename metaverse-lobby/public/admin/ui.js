/* 描画ヘルパー：状態表示・プレビュー・グラフ */
(function () {
  "use strict";
  const { STATUS, AUDIENCE, visible, fmtNum } = window.MMH;
  const tr = (k) => (window.LobbyI18n && window.LobbyI18n.t(k)) || k;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function stText(s) {
    const map = { open: tr("status.online"), event: tr("status.live"), maint: tr("status.maint") };
    return map[s] || map.open;
  }
  function status(s) {
    return `<span class="st ${s === "open" ? "" : s}">${stText(s)}</span>`;
  }
  function audText(a) {
    return { all: tr("admin.audAll"), signed: tr("admin.audSigned"), admin: tr("admin.audAdmin") }[a] || a;
  }
  function audience(a) {
    return a === "all" ? `<span class="dim">${esc(tr("admin.audAll"))}</span>` : esc(audText(a));
  }

  function viewerText(v) {
    return { guest: tr("ui.viewerGuest"), signed: tr("ui.viewerSigned"), admin: tr("ui.viewerAdmin") }[v] || v;
  }
  const VIEWER_TEXT = new Proxy({}, { get: (_t, k) => viewerText(String(k)) });

  /* ---------- 公開ページの再現（一覧） ---------- */
  function lobby(target, worlds, viewer) {
    const shown = worlds.filter((x) => visible(x, viewer));
    const cards = shown.map((x) => {
      const bd = x.status === "maint" ? "maint" : x.status === "event" ? "event" : "";
      const meta = x.status === "maint" ? tr("lobby.offlineMaint") : `<b>${fmtNum(x.players)}</b>${tr("admin.onlineSuffix")}`;
      return `<div class="lc ${x.id === target.id ? "me" : ""} ${x.status === "maint" ? "maint" : ""}">
        <div class="ph">${x.thumb ? `<img src="${esc(x.thumb)}" alt="">` : ""}<span class="bd ${bd}">${stText(x.status)}</span></div>
        <div class="b"><div class="n">${esc(x.name || "名称未設定")}</div><div class="m">${meta}</div></div>
      </div>`;
    }).join("");
    return `<div class="lob">
      <div class="lob-h"><img src="icon-192.png" alt="">みんなでメタ</div>
      <div class="lob-p">
        <div class="lob-t">${tr("lobby.worldList")}</div>
        <div class="lob-g">${cards || `<div class="lob-none">${tr("ui.previewNone")}</div>`}</div>
      </div>
    </div>`;
  }

  /* ---------- 公開ページの再現（ポップアップ） ---------- */
  function popup(w, viewer) {
    if (!visible(w, viewer)) {
      return `<div class="pop-hidden"><b>${viewerText(viewer)}</b> — ${tr("admin.audSigned")} / ${esc(audText(w.audience))}</div>`;
    }
    const bd = w.status === "maint" ? "maint" : w.status === "event" ? "event" : "";
    const off = w.status === "maint";
    return `<div class="pop">
      <div class="ph">${w.thumb ? `<img src="${esc(w.thumb)}" alt="">` : ""}</div>
      <div class="nm"><b>${esc(w.name || "—")}</b><span class="bd ${bd}">${stText(w.status)}</span></div>
      <div class="pl"><b class="num">${fmtNum(w.players)}</b>${tr("admin.onlineSuffix")}</div>
      <div class="ds"><span>${tr("lobby.descLabel")}</span><p>${esc(w.desc || "—")}</p></div>
      <div class="fl">${tr("lobby.displayName")}</div><div class="fi"></div>
      <div class="bt"><span class="c">${tr("common.cancel")}</span><span class="j ${off ? "off" : ""}">${off ? tr("lobby.offlineMaint") : tr("common.join")}</span></div>
    </div>`;
  }

  /* ---------- 推移グラフ（積み上げなし：全体＝面、選択サーバー＝線） ---------- */
  function niceMax(v) {
    if (v <= 0) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * p;
  }

  /**
   * total: number[]、focus: number[]|null、labels: string[]
   * 返り値：SVG文字列（W×H は viewBox、CSSで横幅いっぱい）
   */
  function chart(total, focus, labels, W, H) {
    const padL = 40, padR = 8, padT = 10, padB = 24;
    const iw = W - padL - padR, ih = H - padT - padB;
    const max = niceMax(Math.max.apply(null, total.concat(focus || [0])) * 1.08);
    const n = total.length;
    const x = (i) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => padT + ih - (v / max) * ih;

    const line = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const area = (arr) => line(arr) + `L${x(n - 1).toFixed(1)},${padT + ih}L${x(0).toFixed(1)},${padT + ih}Z`;

    let grid = "";
    for (let k = 0; k <= 4; k++) {
      const v = (max / 4) * k;
      const yy = y(v).toFixed(1);
      grid += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" ${k ? 'stroke-dasharray="2 3"' : ""}/>`;
      grid += `<text class="ax" x="${padL - 8}" y="${+yy + 4}" text-anchor="end">${fmtNum(Math.round(v))}</text>`;
    }
    const step = n > 12 ? 6 : 1;
    let xl = "";
    labels.forEach((l, i) => {
      if (i % step && i !== n - 1) return;
      if (n > 12 && i === n - 1) l = "現在";
      xl += `<text class="ax" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${esc(l)}</text>`;
    });

    const orange = "#f38020";
    const fA = focus ? 0.10 : 0.16;
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="アクセス推移">
      ${grid}${xl}
      <path d="${area(total)}" fill="${orange}" fill-opacity="${fA}"/>
      <path d="${line(total)}" fill="none" stroke="${orange}" stroke-width="1.75" stroke-linejoin="round" vector-effect="non-scaling-stroke" ${focus ? 'stroke-opacity=".55"' : ""}/>
      ${focus ? `<path d="${line(focus)}" fill="none" stroke="#101624" stroke-width="1.75" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : ""}
    </svg>`;
  }
  const CHART_PAD_L = 40, CHART_PAD_R = 8, CHART_PAD_T = 10, CHART_PAD_B = 24, CHART_H = 220;
  chart.geom = function (W, n) {
    const ih = CHART_H - CHART_PAD_T - CHART_PAD_B;
    return { padL: CHART_PAD_L, padT: CHART_PAD_T, ih, iw: W - CHART_PAD_L - CHART_PAD_R, n };
  };
  chart.ensureCursor = function (svg, geom) {
    let cur = svg.querySelector(".cursor");
    if (!cur) {
      cur = document.createElementNS("http://www.w3.org/2000/svg", "line");
      cur.setAttribute("class", "cursor");
      cur.setAttribute("y1", geom.padT);
      cur.setAttribute("y2", geom.padT + geom.ih);
      cur.setAttribute("stroke", "#101624");
      cur.setAttribute("stroke-opacity", ".25");
      cur.setAttribute("stroke-width", "1");
      cur.setAttribute("vector-effect", "non-scaling-stroke");
      cur.setAttribute("opacity", "0");
      svg.appendChild(cur);
    }
    return cur;
  };

  window.UI = { esc, status, audience, lobby, popup, chart, VIEWER_TEXT };
})();
