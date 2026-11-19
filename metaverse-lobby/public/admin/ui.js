/* 描画ヘルパー：状態表示・プレビュー・グラフ */
(function () {
  "use strict";
  const { STATUS, AUDIENCE, visible, fmtNum } = window.MMH;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  const ST_TEXT = { open: "稼働中", event: "イベント中", maint: "メンテナンス中" };
  function status(s) {
    return `<span class="st ${s === "open" ? "" : s}">${ST_TEXT[s] || ST_TEXT.open}</span>`;
  }
  const AUD_TEXT = { all: "全員", signed: "サインイン済みのみ", admin: "管理者のみ" };
  function audience(a) {
    return a === "all" ? `<span class="dim">全員</span>` : esc(AUD_TEXT[a]);
  }

  const VIEWER_TEXT = { guest: "ゲスト", signed: "サインイン済み", admin: "管理者" };

  /* ---------- 公開ページの再現（一覧） ---------- */
  function lobby(target, worlds, viewer) {
    const shown = worlds.filter((x) => visible(x, viewer));
    const cards = shown.map((x) => {
      const bd = x.status === "maint" ? "maint" : x.status === "event" ? "event" : "";
      const meta = x.status === "maint" ? "接続停止中" : `<b>${fmtNum(x.players)}</b> 人オンライン`;
      return `<div class="lc ${x.id === target.id ? "me" : ""} ${x.status === "maint" ? "maint" : ""}">
        <div class="ph">${x.thumb ? `<img src="${esc(x.thumb)}" alt="">` : ""}<span class="bd ${bd}">${ST_TEXT[x.status]}</span></div>
        <div class="b"><div class="n">${esc(x.name || "名称未設定")}</div><div class="m">${meta}</div></div>
      </div>`;
    }).join("");
    return `<div class="lob">
      <div class="lob-h"><img src="icon-192.png" alt="">みんなでメタ</div>
      <div class="lob-p">
        <div class="lob-t">メタバース一覧</div>
        <div class="lob-g">${cards || `<div class="lob-none">表示できるメタバースがありません</div>`}</div>
      </div>
    </div>`;
  }

  /* ---------- 公開ページの再現（ポップアップ） ---------- */
  function popup(w, viewer) {
    if (!visible(w, viewer)) {
      return `<div class="pop-hidden"><b>${VIEWER_TEXT[viewer]}には表示されません</b>公開範囲が「${esc(AUD_TEXT[w.audience])}」のため、一覧に出ずポップアップも開けません。</div>`;
    }
    const bd = w.status === "maint" ? "maint" : w.status === "event" ? "event" : "";
    const off = w.status === "maint";
    return `<div class="pop">
      <div class="ph">${w.thumb ? `<img src="${esc(w.thumb)}" alt="">` : ""}</div>
      <div class="nm"><b>${esc(w.name || "名称未設定")}</b><span class="bd ${bd}">${ST_TEXT[w.status]}</span></div>
      <div class="pl"><b class="num">${fmtNum(w.players)}</b> 人オンライン</div>
      <div class="ds"><span>説明</span><p>${esc(w.desc || "（未入力）")}</p></div>
      <div class="fl">参加時の表示名</div><div class="fi"></div>
      <div class="bt"><span class="c">キャンセル</span><span class="j ${off ? "off" : ""}">${off ? "接続停止中" : "参加"}</span></div>
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
      <line class="cursor" x1="0" x2="0" y1="${padT}" y2="${padT + ih}" stroke="#101624" stroke-opacity=".25" stroke-width="1" vector-effect="non-scaling-stroke" style="display:none"/>
    </svg>`;
  }
  chart.geom = function (W, n) {
    const padL = 40, padR = 8;
    return { padL, iw: W - padL - padR, n };
  };

  window.UI = { esc, status, audience, lobby, popup, chart, ST_TEXT, AUD_TEXT, VIEWER_TEXT };
})();
