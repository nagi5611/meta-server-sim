/* マルチテナント管理パネル — 描画ヘルパー */
(function () {
  "use strict";
  const D = window.MTD;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ---------- アイコン（線画のみ） ---------- */
  const P = {
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.4"/>',
    pulse: '<path d="M3 12h3.5l2-6 3 12 2.5-8 1.6 2H21"/>',
    net: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 2.4 12.7 0 17M12 3.5c-2.4 2.4-2.4 12.7 0 17"/>',
    cube: '<path d="M12 3.2l7.6 4.3v8.9L12 20.8l-7.6-4.4V7.5z"/><path d="M4.4 7.5L12 11.9l7.6-4.4M12 11.9v8.9"/>',
    shield: '<path d="M12 3.4l7 2.8v5.5c0 4.4-3 7.4-7 8.9-4-1.5-7-4.5-7-8.9V6.2z"/><path d="M9 12.2l2.1 2.1 4-4.2"/>',
    server: '<rect x="3.5" y="4" width="17" height="6" rx="1.4"/><rect x="3.5" y="14" width="17" height="6" rx="1.4"/><path d="M6.8 7h.01M6.8 17h.01"/>',
    search: '<circle cx="11" cy="11" r="6.4"/><path d="M15.8 15.8L20 20"/>',
    chev: '<path d="M6 9.5l6 5 6-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    reset: '<path d="M4 10a8 8 0 1 1 1.6 6.4"/><path d="M4 4.5V10h5.5"/>',
    dl: '<path d="M12 4v11M7.5 11l4.5 4.5L16.5 11"/><path d="M5 19h14"/>',
    open: '<path d="M14 5h5v5M19 5l-6.5 6.5"/><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
    left: '<path d="M14 6l-6 6 6 6"/>',
    right: '<path d="M10 6l6 6-6 6"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.2 2"/>',
    wave: '<path d="M3 14l3.5-4 3 6 3.5-9 3 7 2.5-3H21"/>',
    arrow: '<path d="M5 12h13M13 6.5l5.5 5.5L13 17.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    key: '<circle cx="8" cy="8" r="4.2"/><path d="M11 11l8 8M16 16l2-2M18.5 18.5l2-2"/>',
    alert: '<path d="M12 4.5l8.4 15H3.6z"/><path d="M12 10v4M12 17h.01"/>',
    play: '<path d="M8 5.5l10 6.5-10 6.5z"/>',
    pause: '<path d="M9 5.5v13M15 5.5v13"/>',
    trash: '<path d="M5 7h14M9.5 7V5h5v2M7 7l1 12h8l1-12"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.6"/><path d="M15.5 8.5V5.6A1.6 1.6 0 0 0 13.9 4H5.6A1.6 1.6 0 0 0 4 5.6v8.3a1.6 1.6 0 0 0 1.6 1.6h2.9"/>',
    /* --- オブジェクト種別 --- */
    bulb: '<path d="M9.2 17h5.6M10 20h4"/><path d="M12 3.5a5.6 5.6 0 0 0-3.2 10.2c.5.4.8 1 .8 1.6v.2h4.8v-.2c0-.6.3-1.2.8-1.6A5.6 5.6 0 0 0 12 3.5z"/>',
    box: '<path d="M12 3.2l7.6 4.3v8.9L12 20.8l-7.6-4.4V7.5z"/><path d="M12 11.9v8.9"/>',
    person: '<circle cx="12" cy="7.4" r="3"/><path d="M5.8 20c0-3.6 2.7-5.8 6.2-5.8s6.2 2.2 6.2 5.8"/>',
    drum: '<ellipse cx="12" cy="7" rx="6.6" ry="2.4"/><path d="M5.4 7v9.2c0 1.3 3 2.4 6.6 2.4s6.6-1.1 6.6-2.4V7"/><path d="M5.4 11.6c0 1.3 3 2.4 6.6 2.4s6.6-1.1 6.6-2.4"/>',
    portal: '<ellipse cx="12" cy="12" rx="4.4" ry="8"/><path d="M9.6 5.4c-2 1.8-3.2 4.1-3.2 6.6s1.2 4.8 3.2 6.6M14.4 5.4c2 1.8 3.2 4.1 3.2 6.6s-1.2 4.8-3.2 6.6"/>',
    board: '<rect x="3.4" y="4.6" width="17.2" height="10.4" rx="1.4"/><path d="M7 8.2h7M7 11.2h5M9.6 15v2.2M14.4 15v2.2"/>',
    file: '<path d="M6.2 3.6h7l4.6 4.6v12.2H6.2z"/><path d="M13 3.6V8.4h4.6"/>',
    smoke: '<path d="M6.4 18.6c-1.6 0-2.8-1.3-2.8-2.9 0-1.5 1.1-2.7 2.5-2.9.1-2.2 1.9-3.9 4.1-3.9 1.4 0 2.6.7 3.3 1.7.4-.2.8-.3 1.3-.3 1.6 0 2.9 1.3 2.9 2.9 0 .3 0 .5-.1.8 1.2.4 2 1.5 2 2.7 0 1.6-1.3 2.9-2.9 2.9z"/>',
    cloud: '<path d="M7.2 18.2a3.6 3.6 0 0 1-.5-7.2 5 5 0 0 1 9.6-.8 3.4 3.4 0 0 1 .4 6.8"/><path d="M7.2 18.2h8.9"/>',
    plane: '<path d="M3.6 13.4l16.8-5.8-4.6 12-3.1-4.2z"/><path d="M12.7 15.4l-1.4-4.6"/>',
    pin: '<path d="M12 21s6.2-6.2 6.2-11A6.2 6.2 0 0 0 5.8 10c0 4.8 6.2 11 6.2 11z"/><circle cx="12" cy="10" r="2.2"/>',
    /* --- アドオン --- */
    modules: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.3"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.3"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.3"/><path d="M17 4v6.4M13.8 7.2h6.4"/>',
    chat: '<path d="M20 11.9c0 3.5-3.6 6.3-8 6.3-1 0-2-.2-2.9-.5L4.6 20l1-3.4c-1.3-1.2-2.1-2.9-2.1-4.7C3.5 8.4 7.1 5.6 11.5 5.6s8.5 2.8 8.5 6.3z"/><path d="M8.6 11.9h.01M12 11.9h.01M15.4 11.9h.01"/>',
    mic: '<rect x="9.2" y="3.4" width="5.6" height="10.2" rx="2.8"/><path d="M5.8 11.6a6.2 6.2 0 0 0 12.4 0M12 17.8V21M9 21h6"/>',
    chart: '<path d="M4 20h16M7.6 20v-6.2M12 20V6M16.4 20v-9.2"/>',
    calendar: '<rect x="3.6" y="5.2" width="16.8" height="15.2" rx="1.8"/><path d="M3.6 9.8h16.8M8.2 3.4v3.4M15.8 3.4v3.4"/><path d="M7.8 13.8h1.8M14.4 13.8h1.8M11.1 17.4h1.8"/>',
    link: '<path d="M10.2 13.6a3.6 3.6 0 0 0 5.1 0l2.4-2.4a3.6 3.6 0 0 0-5.1-5.1l-1.1 1.1"/><path d="M13.8 10.4a3.6 3.6 0 0 0-5.1 0l-2.4 2.4a3.6 3.6 0 0 0 5.1 5.1l1.1-1.1"/>',
    translate: '<path d="M3.6 6.4h8.6M7.9 4.4v2M5.3 6.4c0 4 2.4 7.2 5.6 8.8M10.5 6.4c-.4 3.6-2.6 6.6-5.4 8.4"/><path d="M12.6 20l3.6-9.4L19.8 20M14 17h4.4"/>'
  };
  /* オブジェクト種別 → アイコン */
  const TYPE_ICON = {
    light: "bulb", model: "box", prop: "box", animate: "person", taiko: "drum",
    teleporter: "portal", board: "board", pdf: "file", smoke: "smoke",
    cloud: "cloud", plane: "plane", spawn: "pin"
  };
  function icon(name, cls) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round" class="${cls || ""}" aria-hidden="true">${P[name] || ""}</svg>`;
  }

  /* ---------- 状態表示 ---------- */
  function statusPill(t) {
    const s = D.STATUS[t.status];
    return `<span class="st ${s.tone === "ok" ? "live" : s.tone}">${s.label}</span>`;
  }

  /* ---------- 折れ線チャート ---------- */
  function niceMax(v) {
    if (v <= 0) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * p;
  }
  /**
   * series: [{values, color, fill, dash}]
   */
  function chart(series, labels, W, H, opt) {
    opt = opt || {};
    const padL = opt.padL == null ? 38 : opt.padL;
    const padR = 6, padT = 8, padB = 22;
    const iw = W - padL - padR, ih = H - padT - padB;
    let peak = 0;
    series.forEach((s) => s.values.forEach((v) => (peak = Math.max(peak, v))));
    const max = niceMax(peak * 1.1);
    const n = labels.length;
    const x = (i) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => padT + ih - (v / max) * ih;
    const line = (a) => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const area = (a) => line(a) + `L${x(n - 1).toFixed(1)},${padT + ih}L${x(0).toFixed(1)},${padT + ih}Z`;

    let grid = "";
    for (let k = 0; k <= 4; k++) {
      const v = (max / 4) * k;
      const yy = y(v).toFixed(1);
      grid += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" ${k ? 'stroke-dasharray="2 3"' : ""}/>`;
      grid += `<text class="ax" x="${padL - 7}" y="${+yy + 4}" text-anchor="end">${D.num(Math.round(v))}</text>`;
    }
    const step = n > 12 ? 6 : 1;
    let xl = "";
    labels.forEach((l, i) => {
      if (i % step && i !== n - 1) return;
      if (n > 12 && i === n - 1) l = "現在";
      xl += `<text class="ax" x="${x(i).toFixed(1)}" y="${H - 5}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${esc(l)}</text>`;
    });

    let paths = "";
    series.slice().reverse().forEach((s) => {
      if (s.fill) paths += `<path d="${area(s.values)}" fill="${s.color}" fill-opacity="${s.fill}"/>`;
      paths += `<path d="${line(s.values)}" fill="none" stroke="${s.color}" stroke-width="1.75"
        stroke-linejoin="round" stroke-linecap="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}
        vector-effect="non-scaling-stroke"/>`;
      if (s.dot) {
        const i = s.values.length - 1;
        paths += `<circle cx="${x(i).toFixed(1)}" cy="${y(s.values[i]).toFixed(1)}" r="2.6" fill="${s.color}" stroke="#fff" stroke-width="1.5"/>`;
      }
    });

    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="none" aria-hidden="true">
      ${grid}${xl}${paths}
      <line class="cur" x1="0" x2="0" y1="${padT}" y2="${padT + ih}" stroke="#101624" stroke-opacity=".22"
        stroke-width="1" vector-effect="non-scaling-stroke" style="display:none"/>
    </svg>`;
  }
  chart.geom = (W) => ({ padL: 38, padR: 6, iw: W - 44 });
  // チャート幅は JS 側で実測して渡す（preserveAspectRatio=none で伸縮）
  function fit(W) { return Math.max(280, W); }

  /* ---------- スパークライン ---------- */
  function spark(values, w, h, color) {
    const max = Math.max.apply(null, values) || 1;
    const min = Math.min.apply(null, values);
    const span = Math.max(1, max - min);
    const p = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - 3 - ((v - min) / span) * (h - 8);
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join("");
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <path d="${p}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${w}" cy="${(h - 3 - ((values[values.length - 1] - min) / span) * (h - 8)).toFixed(1)}" r="2" fill="${color}"/>
    </svg>`;
  }

  /* ---------- etc ---------- */
  function bytes(b) {
    if (!b) return "—";
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }
  function statusClass(s) {
    return s >= 500 ? "s5" : s >= 400 ? "s4" : s >= 300 ? "s3" : "s2";
  }

  /* ---------- アイソメトリック投影 ---------- */
  const ISO = {
    project(x, y, z, S) {
      return { x: (x - z) * 0.866 * S, y: (x + z) * 0.5 * S - y * S };
    },
    unproject(dsx, dsy, S) {
      const a = dsx / (0.866 * S);
      const b = dsy / (0.5 * S);
      return { dx: (a + b) / 2, dz: (b - a) / 2 };
    }
  };

  window.MUI = { esc, icon, chart, fit, spark, statusPill, bytes, statusClass, ISO, niceMax, TYPE_ICON };
})();
