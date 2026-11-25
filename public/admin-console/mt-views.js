/* マルチテナント管理パネル — ビュー（ダッシュボード / テナント / 通信ログ / 監査） */
(function () {
  "use strict";
  const D = window.MTD, U = window.MUI;
  const { esc, icon, chart, spark, statusPill, bytes, statusClass } = U;
  const V = {};

  const state = () => window.MT.state;
  const live = (t) => (window.MT.liveN[t.id] == null ? t.players : window.MT.liveN[t.id]);

  function head(kicker, title, sub, acts) {
    return `<div class="head"><div>
      ${kicker ? `<div class="kicker">${kicker}</div>` : ""}
      <h1>${title}</h1>
      ${sub ? `<p class="sub">${sub}</p>` : ""}
    </div>${acts ? `<div class="acts">${acts}</div>` : ""}</div>`;
  }

  /* =========================================================
     ダッシュボード
     ========================================================= */
  function sumSeries(key, n) {
    const out = new Array(n).fill(0);
    D.TENANTS.forEach((t) => {
      const arr = key === "h" ? D.hourly(t) : D.daily(t);
      arr.forEach((v, i) => (out[i] += v));
    });
    return out;
  }

  function dashSeries() {
    const st = state();
    const isH = st.range === "24h";
    const labels = isH ? D.labels24() : D.labels7();
    const total = sumSeries(isH ? "h" : "d", labels.length);
    let focus = null;
    if (st.focus) {
      const t = D.TENANTS.find((x) => x.id === st.focus);
      if (t) focus = isH ? D.hourly(t) : D.daily(t);
    }
    return { labels, total, focus };
  }

  function chartBlock(W) {
    const st = state();
    const { labels, total, focus } = dashSeries();
    const peak = Math.max.apply(null, total);
    const peakAt = labels[total.indexOf(peak)];
    const totalNow = D.TENANTS.reduce((a, t) => a + live(t), 0);
    const fw = st.focus ? D.TENANTS.find((t) => t.id === st.focus) : null;
    const fwPct = fw ? D.pct(live(fw), fw.cap) : 0;

    return `<div class="dash-chart">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px">
        <div>
          <div class="big"><span class="v" data-live="total">${D.num(totalNow)}</span><span class="u">人 オンライン</span></div>
          <div class="kvline">
            <div>ピーク <b>${D.num(peak)}</b></div>
            <div>稼働テナント <b>${D.TENANTS.filter((t) => t.status !== "offline").length} / ${D.TENANTS.length}</b></div>
            <div>平均レイテンシ <b>${Math.round(D.TENANTS.reduce((a, t) => a + t.latency, 0) / D.TENANTS.length)} ms</b></div>
          </div>
        </div>
        <div class="seg" data-act="range">
          <button data-range="24h" class="${st.range === "24h" ? "on" : ""}">24時間</button>
          <button data-range="7d" class="${st.range === "7d" ? "on" : ""}">7日間</button>
        </div>
      </div>
      <div class="chart" data-chart="main">
        ${chart(
          [
            { values: total, color: "#f38020", fill: focus ? 0.1 : 0.15 },
            ...(focus ? [{ values: focus, color: "#101624" }] : [])
          ],
          labels, W, 196
        )}
        <div class="tip" data-tip></div>
      </div>
      <div class="legend">
        <span><i style="background:#f38020"></i>全テナント合計</span>
        ${fw ? `<span><i style="background:#101624"></i>${esc(fw.name)}</span>
          <a href="#" data-act="focus-off" style="color:var(--color-primary-dark);font-weight:600;text-decoration:none">選択を解除</a>` : ""}
        <span style="margin-left:auto">${st.range === "24h" ? "1時間ごと" : "日ごと"} ／ ピーク ${esc(peakAt)}</span>
      </div>
      ${fw ? `<div class="kvline" style="margin-top:8px">
        <div>${esc(fw.name)} の現在 <b>${D.num(live(fw))}</b> 人 ／ 定員比 ${fwPct.toFixed(0)}%</div>
      </div>` : ""}
    </div>`;
  }

  function listBlock() {
    const st = state();
    const sorted = D.TENANTS.slice().sort((a, b) => {
      const rank = { degraded: 0, offline: 1, event: 2, online: 3 };
      return rank[a.status] - rank[b.status] || live(b) - live(a);
    });
    return `<div class="tlist">
      <div class="tlist-h"><span>テナント別</span><span>同時接続 / 定員</span></div>
      ${sorted.map((t) => {
        const v = live(t);
        const p = D.pct(v, t.cap);
        const tone = t.status === "online" ? "" : t.status;
        return `<button class="trow ${tone} ${st.focus === t.id ? "on" : ""}" data-focus="${esc(t.id)}">
          <span class="n"><span>${esc(t.name)}</span></span>
          <span class="v">${t.status === "offline" ? `<small>停止中</small>` : `${D.num(v)}<small> / ${D.num(t.cap)}</small>`}</span>
          <span class="bar"><i class="${p >= 90 ? "hot" : ""}${t.status === "degraded" ? " hot" : ""}" style="width:${p.toFixed(1)}%"></i></span>
        </button>`;
      }).join("")}
    </div>`;
  }

  function tenantTable(W) {
    return `<section class="block">
      <div class="block-h"><h2>テナント一覧</h2><span class="aside">行を選ぶと管理メニューを開きます</span></div>
      <div class="sheet">
        <table>
          <colgroup>
            <col><col style="width:84px"><col style="width:84px">
            <col style="width:92px"><col style="width:100px">
            <col style="width:76px"><col style="width:74px"><col style="width:24px">
          </colgroup>
          <thead><tr>
            <th>テナント</th><th>状態</th><th class="hide-sm">プラン</th>
            <th class="hide-sm">ゾーン</th><th class="r">同時接続</th>
            <th class="r hide-sm">p95</th><th class="r">エラー</th><th></th></tr></thead>
          <tbody>
            ${D.TENANTS.map((t) => `<tr class="row" data-open="${esc(t.id)}">
              <td><div class="t-cell">
                <div class="av">${esc(t.org.slice(0, 1))}</div>
                <div class="tx"><b>${esc(t.name)}</b><span>${esc(t.host)}</span></div>
              </div></td>
              <td>${statusPill(t)}</td>
              <td class="hide-sm" style="color:var(--muted);font-size:11.5px">${esc(t.plan)}</td>
              <td class="hide-sm mono" style="font-size:10.5px;color:var(--faint)">${esc(t.zone)}</td>
              <td class="r num"><b style="color:var(--ink);font-weight:600">${D.num(live(t))}</b>
                <span style="color:var(--faint);font-size:10.5px"> / ${D.num(t.cap)}</span></td>
              <td class="r num hide-sm" style="color:${t.latency > 120 ? "var(--color-primary-dark)" : "var(--muted)"};font-weight:${t.latency > 120 ? "600" : "400"}">${t.latency ? t.latency + " ms" : "—"}</td>
              <td class="r num" style="color:${t.errorRate > 2 ? "var(--danger)" : "var(--muted)"};font-weight:${t.errorRate > 2 ? "600" : "400"}">${t.errorRate ? t.errorRate.toFixed(2) + "%" : "—"}</td>
              <td class="r" style="color:var(--faint)">${icon("right", "")}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>`;
  }

  function cardsBlock() {
    return `<div class="cards">
      ${D.TENANTS.map((t) => {
        const v = live(t);
        const p = D.pct(v, t.cap);
        const cls = t.status === "online" ? "" : t.status === "event" ? "" : t.status === "degraded" ? "warn" : "off";
        const series = D.hourly(t);
        const trend = series[series.length - 1] - series[series.length - 4];
        return `<button class="tcard ${cls}" data-open="${esc(t.id)}">
          <div class="top">
            <div><div class="nm">${esc(t.name)}</div><div class="org">${esc(t.org)} ・ ${esc(t.zone)}</div></div>
            ${statusPill(t)}
          </div>
          <div class="mid">
            <div>
              <div class="p">${D.num(v)}<small>人</small></div>
              <div style="font-size:10.5px;color:${trend >= 0 ? "var(--ok)" : "var(--color-primary-dark)"};margin-top:3px;font-variant-numeric:tabular-nums">
                ${trend >= 0 ? "▲" : "▼"} ${D.num(Math.abs(trend))} <span style="color:var(--faint)">直近3時間</span></div>
            </div>
            <div class="spark" style="color:${t.status === "degraded" ? "var(--danger)" : "var(--color-primary)"}">
              ${spark(series, 96, 30, t.status === "degraded" ? "#c62828" : "#f38020")}
            </div>
          </div>
          <div class="bar"><i class="${p >= 90 ? "hot" : ""}" style="width:${p.toFixed(1)}%"></i></div>
          <div class="foot">
            <span>定員 ${D.num(t.cap)}</span>
            <span>p95 <b>${t.latency ? t.latency * 2.4 > 120 ? (t.latency * 2.4).toFixed(0) : Math.round(t.latency * 2.4) : 0} ms</b></span>
            <span>エラー <b style="color:${t.errorRate > 2 ? "var(--danger)" : "var(--muted)"}">${t.errorRate ? t.errorRate.toFixed(2) + "%" : "—"}</b></span>
          </div>
        </button>`;
      }).join("")}
    </div>`;
  }

  function dashSummary() {
    const tot = D.TENANTS.reduce((a, t) => a + live(t), 0);
    const errors = D.TENANTS.filter((t) => t.status === "degraded").length;
    return `<div style="display:flex;align-items:baseline;gap:18px;flex-wrap:wrap;margin-bottom:14px;font-size:12px;color:var(--faint)">
      <span><b class="num" style="font-size:15px;color:var(--ink);font-weight:700">${D.num(tot)}</b> 人 接続中</span>
      <span><b class="num" style="font-size:15px;color:var(--ink);font-weight:700">${D.TENANTS.length}</b> テナント</span>
      <span><b class="num" style="font-size:15px;color:${errors ? "var(--danger)" : "var(--ink)"};font-weight:700">${errors}</b> 件の異常</span>
      <span style="margin-left:auto">${esc(D.mdhm(new Date()))} 時点</span>
    </div>`;
  }

  V.dash = function () {
    const st = state();
    const cards = st.dashMode === "cards";
    const W = window.MT.width ? Math.max(300, window.MT.width - (cards ? 0 : 300)) : 620;
    const bad = D.TENANTS.filter((t) => t.status === "degraded" || t.status === "offline");

    return `<div class="wrap">
      ${head("全体", "ダッシュボード",
        "全テナントの稼働状況と、各テナントの管理メニューへの入口。",
        `<button class="btn btn-line btn-sm" data-go="audit">${icon("shield")}監査ログ</button>
         <button class="btn btn-primary btn-sm" data-act="new-tenant">${icon("plus")}テナントを追加</button>`)}

      ${bad.map((t) => `<div class="alert-row">
        ${icon("alert", "ico")}
        <span>${t.status === "degraded"
          ? `<b>${esc(t.name)}</b> の node-a で CPU 使用率 94% が継続。p95 レイテンシが ${Math.round(t.latency * 2.4)} ms に上昇しています。`
          : `<b>${esc(t.name)}</b> は停止中です。最終確認 ${esc(t.host)}`}</span>
        <a class="go" href="#" data-open="${esc(t.id)}">詳細を見る →</a>
      </div>`).join("")}

      ${cards ? `${dashSummary()}${cardsBlock()}
        <section class="block" style="margin-top:26px">
          <div class="block-h"><h2>直近の操作</h2><a class="aside" href="#" data-go="audit" style="text-decoration:none;color:var(--color-primary-dark)">監査ログをすべて見る →</a></div>
          <div class="sheet">${D.AUDIT.slice(0, 5).map((a) => `<div class="line-row">
            <span class="k mono" style="font-size:10.5px">${esc(a.at)}</span>
            <span style="min-width:0"><b class="lbl">${esc(a.who)}</b>
              <span style="color:var(--faint)"> — ${esc(a.target)}</span></span>
            <span class="m"><span class="tag">${esc(a.act)}</span></span>
          </div>`).join("")}</div>
        </section>`
      : `<section class="block"><div class="sheet dash-split">${chartBlock(W)}${listBlock()}</div></section>
        ${tenantTable(W)}`}
    </div>`;
  };

  /* =========================================================
     テナント：ステータス
     ========================================================= */
  V.tenant = function () {
    const st = state();
    const t = D.TENANTS.find((x) => x.id === st.tenant);
    if (!t) return "";
    const isH = st.range === "24h";
    const series = isH ? D.hourly(t) : D.daily(t);
    const labels = isH ? D.labels24() : D.labels7();
    const W = window.MT.width ? Math.max(300, window.MT.width - 400) : 560;
    const nodes = D.nodes(t);
    const hs = D.health(t);
    const evs = D.events(t);
    const v = live(t);

    return `<div class="wrap">
      ${head(`${esc(t.org)} ／ ${esc(t.plan)}`,
        `${esc(t.name)} ${statusPill(t)}`,
        `<span class="mono">${esc(t.host)}</span> ・ ${esc(t.zone)} ・ 開設 ${esc(t.since)}`,
        `<button class="btn btn-line btn-sm" data-act="settings">${icon("server")}テナント設定</button>
         <button class="btn btn-primary btn-sm" data-go="world">${icon("cube")}ワールドを編集</button>`)}

      ${t.status === "degraded" ? `<div class="alert-row">
        ${icon("alert", "ico")}
        <span><b>node-a の CPU 使用率が 94%</b> で推移しています。ワールド応答が通常より ${Math.round(t.latency - 40)} ms 遅い状態です。</span>
        <a class="go" href="#" data-go="logs">ログを調査 →</a>
      </div>` : ""}

      <section class="block"><div class="sheet facts">
        <div><span>同時接続</span><b>${D.num(v)}<small>/ ${D.num(t.cap)}</small></b></div>
        <div><span>稼働率（30日）</span><b>${t.uptime.toFixed(2)}<small>%</small></b></div>
        <div><span>レイテンシ p95</span><b class="${t.latency * 2.4 > 120 ? "bad" : ""}">${t.latency ? Math.round(t.latency * 2.4) : "—"}<small>ms</small></b></div>
        <div><span>エラー率（24h）</span><b class="${t.errorRate > 2 ? "bad" : ""}">${t.errorRate ? t.errorRate.toFixed(2) : "—"}<small>%</small></b></div>
      </div></section>

      <div class="split">
        <div class="col">
          <section class="block" style="margin:0">
            <div class="block-h"><h2>同時接続の推移</h2>
              <div class="seg" data-act="range">
                <button data-range="24h" class="${isH ? "on" : ""}">24時間</button>
                <button data-range="7d" class="${isH ? "" : "on"}">7日間</button>
              </div>
            </div>
            <div class="sheet">
              <div style="padding:16px 18px 8px">
                <div class="big"><span class="v">${D.num(Math.max.apply(null, series))}</span><span class="u">人 ピーク</span></div>
                <div class="kvline">
                  <div>定員 <b>${D.num(t.cap)}</b></div>
                  <div>平均 <b>${D.num(Math.round(series.reduce((a, b) => a + b, 0) / series.length))}</b></div>
                  <div>現在 <b>${D.num(v)}</b></div>
                </div>
              </div>
              <div class="chart" data-chart="tenant" style="height:186px;padding:0 6px 6px">
                ${chart([{ values: series, color: "#f38020", fill: 0.14, dot: true }], labels, W, 186)}
                <div class="tip" data-tip></div>
              </div>
            </div>
          </section>

          <section class="block" style="margin:0">
            <div class="block-h"><h2>ワールド</h2><span class="aside">${t.worlds.length} ワールド</span></div>
            <div class="sheet" style="overflow:hidden">
              <table>
                <thead><tr><th>ワールド</th><th>状態</th><th class="r">同時接続</th><th class="r hide-sm">サイズ</th><th class="r hide-sm">版</th></tr></thead>
                <tbody>${t.worlds.map((w) => `<tr class="row" data-world="${esc(w.id)}">
                  <td><b style="font-weight:600;color:var(--ink)">${esc(w.name)}</b></td>
                  <td>${w.status === "online" ? `<span class="st live">稼働中</span>`
                    : w.status === "event" ? `<span class="st event">イベント中</span>`
                    : `<span class="st warn">メンテナンス</span>`}</td>
                  <td class="r num">${D.num(w.players)} <span style="color:var(--faint);font-size:11px">/ ${D.num(w.cap)}</span></td>
                  <td class="r num hide-sm" style="color:var(--muted)">${w.size} MB</td>
                  <td class="r hide-sm"><span class="tag">${esc(w.version)}</span></td>
                </tr>`).join("")}</tbody>
              </table>
            </div>
          </section>
        </div>

        <div class="col">
          <section class="block" style="margin:0">
            <div class="block-h"><h2>ノード</h2><span class="aside">${nodes.length} 台</span></div>
            <div class="sheet">${nodes.map((n) => `<div class="node">
              <div class="h">
                <b>${esc(n.id)}</b>
                <span class="tag">${esc(n.role)}</span>
                <span class="tag ${n.status === "warn" ? "warn" : ""}">${n.status === "warn" ? "高負荷" : n.status === "off" ? "停止" : "正常"}</span>
              </div>
              <div class="gauge"><span>CPU</span>
                <span class="bar"><i class="${n.cpu > 85 ? "hot" : ""}" style="width:${n.cpu}%"></i></span>
                <span class="v">${n.cpu}%</span></div>
              <div class="gauge"><span>MEM</span>
                <span class="bar"><i style="width:${n.mem}%;background:#8a92a1"></i></span>
                <span class="v">${n.mem}%</span></div>
              <div class="gauge"><span>接続</span>
                <span style="color:var(--muted);font-size:10.5px;font-variant-numeric:tabular-nums">${D.num(n.players)} 人</span>
                <span class="v">${esc(n.zone.slice(-3))}</span></div>
            </div>`).join("")}</div>
          </section>

          <section class="block" style="margin:0">
            <div class="block-h"><h2>ヘルスチェック</h2><span class="aside">${t.status === "offline" ? "停止中" : "正常"}</span></div>
            <div class="sheet">${hs.map((h) => `<div class="line-row" style="grid-template-columns:minmax(0,1fr) auto auto;gap:10px">
              <span class="mono" style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis">${esc(h.path)}</span>
              <span class="tag ${h.ok ? "ok" : "bad"}">${h.ok ? "OK" : "NG"}</span>
              <span class="m">${h.ms == null ? "—" : `${h.ms} <small>ms</small>`}</span>
            </div>`).join("")}</div>
          </section>

          <section class="block" style="margin:0">
            <div class="block-h"><h2>最近のイベント</h2><a class="aside" href="#" data-go="audit" style="text-decoration:none">すべて →</a></div>
            <div class="sheet">${evs.slice(0, 4).map((e) => `<div class="ev ${esc(e.kind)}">
              ${icon(e.kind === "incident" ? "alert" : e.kind === "deploy" ? "cube" : e.kind === "config" ? "server" : "shield", "ico")}
              <div class="tx">${esc(e.text)}<div class="at">${esc(e.at)}</div></div>
            </div>`).join("")}</div>
          </section>
        </div>
      </div>
    </div>`;
  };

  /* =========================================================
     通信ログ
     ========================================================= */
  const LOG_COLS = "74px minmax(0,1fr) 54px 58px 66px 104px 56px";

  function logRow(l, selectedId) {
    const slow = l.ms > 180;
    const sel = selectedId === l.id;
    return `<div class="lrow ${sel ? "sel" : ""}" data-log="${esc(l.id)}">
        <span class="t">${D.hhmmss(l.at)}</span>
        <span class="req"><span class="meth">${esc(l.method)}</span>${esc(l.path)}</span>
        <span><span class="sc ${statusClass(l.status)}">${l.status}</span></span>
        <span class="n ${slow ? "slow" : ""}">${l.ms} ms</span>
        <span class="n dim">${bytes(l.bytes)}</span>
        <span class="dim">${esc(l.ip)}</span>
        <span class="dim">${esc(l.world)}</span>
      </div>
      ${sel ? `<div class="ldet"><dl class="dl">
        <dt>request_id</dt><dd>req_${esc(l.id)}</dd>
        <dt>time</dt><dd>${l.at.toISOString()}</dd>
        <dt>request</dt><dd>${esc(l.method)} ${esc(l.path)}</dd>
        <dt>status</dt><dd>${l.status} ・ ${l.status >= 500 ? "origin_error" : l.status >= 400 ? "client_error" : "ok"}</dd>
        <dt>duration</dt><dd>${l.ms} ms（upstream ${Math.max(1, Math.round(l.ms * 0.72))} ms / queue ${Math.max(0, l.ms - Math.round(l.ms * 0.72))} ms）</dd>
        <dt>bytes</dt><dd>${bytes(l.bytes)}</dd>
        <dt>remote_addr</dt><dd>${esc(l.ip)}</dd>
        <dt>user_agent</dt><dd>${esc(l.ua)}</dd>
        <dt>world</dt><dd>${esc(l.world)}</dd>
        <dt>edge_zone</dt><dd>jp-osaka-1</dd>
      </dl></div>` : ""}`;
  }

  function logHead() {
    return `<div class="lhead" style="grid-template-columns:${LOG_COLS}">
      <span>時刻</span><span>リクエスト</span><span>状態</span>
      <span class="n">応答</span><span class="n">転送量</span><span>送信元</span><span>ワールド</span>
    </div>`;
  }

  V.logs = function () {
    const st = state();
    const t = D.TENANTS.find((x) => x.id === st.tenant);
    if (!t) return "";
    const tab = st.logTab;
    const W = window.MT.width ? Math.max(300, window.MT.width - 380) : 620;

    let body = "";
    if (tab === "live") {
      const rows = st.logs.slice(0, 90);
      body = `<div class="logbar">
          <div class="seg" data-act="logtab">
            <button data-tab="live" class="on">ライブ</button>
            <button data-tab="query">検索</button>
            <button data-tab="agg">集計</button>
          </div>
          <button class="btn btn-line btn-sm" data-act="log-toggle">${st.playing ? icon("pause") : icon("play")}${st.playing ? "一時停止" : "再開"}</button>
          <span class="live-pill ${st.playing ? "" : "off"}" data-live-pill>${st.playing ? "ストリーミング中" : "停止中"}</span>
          <div class="grow"></div>
          <div class="rate">直近1秒 <b data-rate>${D.num(st.rate)}</b> req/s</div>
          <button class="btn btn-line btn-sm" data-act="log-export">${icon("dl")}エクスポート</button>
        </div>
        <div class="log-scroll" data-logscroll>
          ${logHead()}
          <div data-logbody>${rows.map((l) => logRow(l, null)).join("")}</div>
        </div>
        <div class="wmeta">
          <span>表示 <b class="num" data-logcount>${rows.length}</b> 件 / 直近 5 分</span>
          <span>保持 7 日 ・ クリックで詳細</span>
          <span class="sp"></span>
          <span style="color:var(--faint)">HTTP/2 ・ TLS 1.3 ・ リバースプロキシ経由</span>
        </div>`;
    } else if (tab === "query") {
      const all = st.logs;
      const f = st.filter;
      const filtered = all.filter((l) => {
        if (f.status === "2" && !(l.status < 300)) return false;
        if (f.status === "4" && !(l.status >= 400 && l.status < 500)) return false;
        if (f.status === "5" && l.status < 500) return false;
        if (f.method && l.method !== f.method) return false;
        if (f.q) {
          const q = f.q.toLowerCase();
          if (!(l.path + " " + l.ip).toLowerCase().includes(q)) return false;
        }
        if (f.slow && l.ms <= 180) return false;
        return true;
      });
      body = `<div class="logbar">
          <div class="seg" data-act="logtab">
            <button data-tab="live">ライブ</button>
            <button data-tab="query" class="on">検索</button>
            <button data-tab="agg">集計</button>
          </div>
          <span style="font-size:11.5px;color:var(--faint)">条件に一致した行を開いて詳細を確認できます</span>
          <div class="grow"></div>
          <div class="rate">該当 <b>${D.num(filtered.length)}</b> / ${D.num(all.length)} 件</div>
          <button class="btn btn-line btn-sm" data-act="log-export">${icon("dl")}エクスポート</button>
        </div>
        <div class="filters">
          <div class="field"><label>検索</label>
            <div class="search" style="width:100%">${icon("search")}
              <input class="inp" data-filter="q" value="${esc(f.q)}" placeholder="パス・送信元IP" style="width:100%">
            </div></div>
          <div class="field"><label>状態</label>
            <select class="inp" data-filter="status">
              <option value="">すべて</option>
              <option value="2" ${f.status === "2" ? "selected" : ""}>2xx 成功</option>
              <option value="4" ${f.status === "4" ? "selected" : ""}>4xx クライアント</option>
              <option value="5" ${f.status === "5" ? "selected" : ""}>5xx サーバ</option>
            </select></div>
          <div class="field"><label>メソッド</label>
            <select class="inp" data-filter="method">
              <option value="">すべて</option>
              ${["GET", "POST", "PUT"].map((m) => `<option value="${m}" ${f.method === m ? "selected" : ""}>${m}</option>`).join("")}
            </select></div>
          <div class="field"><label>応答時間</label>
            <select class="inp" data-filter="slow">
              <option value="">すべて</option>
              <option value="1" ${f.slow ? "selected" : ""}>180 ms 以上</option>
            </select></div>
        </div>
        <div class="log-scroll" style="max-height:calc(100dvh - 388px)">
          ${logHead()}
          ${filtered.length ? filtered.slice(0, 200).map((l) => logRow(l, st.logSel)).join("")
            : `<div class="empty" style="padding:34px 14px;text-align:center;font-size:12.5px">条件に一致するログはありません</div>`}
        </div>`;
    } else {
      const agg = D.trafficAgg(t);
      body = `<div class="logbar">
          <div class="seg" data-act="logtab">
            <button data-tab="live">ライブ</button>
            <button data-tab="query">検索</button>
            <button data-tab="agg" class="on">集計</button>
          </div>
          <span style="font-size:11.5px;color:var(--faint)">直近24時間の集計</span>
          <div class="grow"></div>
          <button class="btn btn-line btn-sm" data-act="log-export">${icon("dl")}CSV</button>
        </div>
        <div style="padding:16px 18px 6px">
          <div class="big"><span class="v">${agg.total.toFixed(1)}</span><span class="u">GB 転送（24時間）</span></div>
          <div class="kvline">
            <div>平均 <b>${(agg.total / 24).toFixed(1)} GB/h</b></div>
            <div>ピーク <b>${Math.max.apply(null, agg.hours).toFixed(1)} GB/h</b></div>
            <div>リクエスト <b>${D.num(agg.reqPerSec * 3600 * 24 / 1000)}k</b></div>
          </div>
        </div>
        <div class="chart" data-chart="agg" style="height:172px;padding:0 18px 8px">
          ${chart([{ values: agg.hours, color: "#f38020", fill: 0.14 }], D.labels24(), W, 172)}
        </div>
        <div class="agg" style="border-top:1px solid var(--line)">
          <div>
            <div class="block-h"><h2 style="font-size:12.5px">上位エンドポイント</h2><span class="aside">requests / 24h</span></div>
            <div style="display:flex;flex-direction:column;gap:9px;margin-top:2px">
              ${agg.top.map((x) => `<div>
                <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:3px">
                  <span class="mono" style="color:var(--ink)">${esc(x.p)}</span>
                  <span class="num" style="color:var(--muted)">${D.num(x.n)} <span style="color:var(--faint)">・${x.avg}ms</span></span>
                </div>
                <div class="bar"><i style="width:${(x.n / agg.top[0].n) * 100}%"></i></div>
              </div>`).join("")}
            </div>
          </div>
          <div>
            <div class="block-h"><h2 style="font-size:12.5px">ステータス分布</h2><span class="aside">24h</span></div>
            <div class="dist">
              ${agg.dist.map((d) => `<i class="${d.tone}" style="width:${d.v}%" title="${d.k} ${d.v}%"></i>`).join("")}
            </div>
            <div class="dist-legend">
              ${agg.dist.map((d) => `<span><i class="${d.tone}" style="background:${d.tone === "ok" ? "var(--ok)" : d.tone === "warn" ? "var(--color-primary)" : d.tone === "bad" ? "var(--danger)" : "#b9c0cb"}"></i>${d.k}<b>${d.v}%</b></span>`).join("")}
            </div>
            <div style="border-top:1px solid var(--line);margin-top:14px;padding-top:2px">
              <div class="line-row" style="padding-left:0;padding-right:0"><span class="k">p50</span><span></span><span class="m">${agg.p50} <small>ms</small></span></div>
              <div class="line-row" style="padding-left:0;padding-right:0"><span class="k">p95</span><span></span><span class="m">${agg.p95} <small>ms</small></span></div>
              <div class="line-row" style="padding-left:0;padding-right:0;border-bottom:0"><span class="k">p99</span><span></span><span class="m">${agg.p99} <small>ms</small></span></div>
            </div>
          </div>
        </div>`;
    }

    return `<div class="wrap">
      ${head(`通信 · ${esc(t.name)}`, "通信ログ",
        "HTTP リクエストのリアルタイム監視、条件検索、トラフィック集計。",
        `<button class="btn btn-line btn-sm" data-act="limits">${icon("shield")}アクセス制限</button>`)}
      <div class="sheet" style="overflow:hidden">${body}</div>
    </div>`;
  };

  /* =========================================================
     監査ログ・権限
     ========================================================= */
  /* =========================================================
     ワールド編集サーバー選択
     ========================================================= */
  V.pick = function () {
    const totalWorlds = D.TENANTS.reduce((a, t) => a + t.worlds.length, 0);
    return `<div class="wrap">
      ${head("ワールド編集", "サーバーを選択",
        `編集するワールドが入っているサーバーを選んでください。全 ${D.TENANTS.length} サーバー / ${totalWorlds} ワールド。`)}
      <div class="srv-grid">
        ${D.TENANTS.map((t) => {
          const v = live(t);
          const p = D.pct(v, t.cap);
          const online = t.worlds.filter((w) => w.status !== "maint").length;
          return `<button class="srv-card ${t.status === "offline" ? "is-off" : ""}" data-server-card="${esc(t.id)}">
            <div class="srv-top">
              <span class="srv-em">${esc(t.org.slice(0, 1))}</span>
              <span class="srv-tt">
                <b>${esc(t.name)}</b>
                <span>${esc(t.host)}</span>
              </span>
              ${statusPill(t)}
            </div>
            <div class="srv-mid">
              <div class="srv-worlds">
                <span class="srv-k">ワールド</span>
                <span class="srv-v">${t.worlds.length}<small>件</small></span>
                <span class="srv-sub">稼働 ${online}</span>
              </div>
              <div class="srv-conn">
                <span class="srv-k">同時接続</span>
                <span class="srv-v">${D.num(v)}<small>/ ${D.num(t.cap)}</small></span>
              </div>
            </div>
            <div class="bar"><i class="${p >= 90 ? "hot" : ""}" style="width:${p.toFixed(1)}%"></i></div>
            <div class="srv-worlds-list">
              ${t.worlds.map((w) => `<span class="srv-wtag ${w.status === "maint" ? "maint" : ""}">${esc(w.name)}</span>`).join("")}
            </div>
          </button>`;
        }).join("")}
      </div>
    </div>`;
  };

  V.audit = function () {
    return `<div class="wrap">
      ${head("セキュリティ", "監査ログと権限",
        "管理操作の記録、ロールの権限範囲、API トークンの管理。",
        `<button class="btn btn-line btn-sm" data-act="audit-export">${icon("dl")}CSV で出力</button>`)}
      <section class="block">
        <div class="block-h"><h2>ロール</h2><span class="aside">3 種類 ・ 17 名</span></div>
        <div class="sheet role-grid">
          ${D.ROLES.map((r) => `<div class="role">
            <div class="rh"><b>${esc(r.label)}</b><span>${r.count} 名</span></div>
            <p>${esc(r.desc)}</p>
            <ul>${r.perms.map((p) => `<li>${icon("check")}<span>${esc(p)}</span></li>`).join("")}</ul>
          </div>`).join("")}
        </div>
      </section>

      <section class="block">
        <div class="block-h"><h2>メンバー</h2><span class="aside">ロールは行ごとに変更できます</span></div>
        <div class="sheet" style="overflow:hidden">
          <table>
            <thead><tr><th>メンバー</th><th>ロール</th><th class="hide-sm">対象テナント</th><th class="r hide-sm">最終ログイン</th><th style="width:70px"></th></tr></thead>
            <tbody>${D.MEMBERS.map((m) => `<tr>
              <td><div class="t-cell">
                <div class="av">${esc(m.name.slice(0, 1).toUpperCase())}</div>
                <div class="tx"><b>${esc(m.name)}</b><span style="font-family:var(--font);font-size:11px">${esc(m.mail)}</span></div>
              </div></td>
              <td><select class="inp" data-role="${esc(m.id)}" style="height:26px;font-size:11.5px;width:auto;padding:0 24px 0 7px">
                ${D.ROLES.map((r) => `<option value="${r.id}" ${m.role === r.id ? "selected" : ""}>${r.label}</option>`).join("")}
              </select></td>
              <td class="hide-sm" style="color:var(--muted)">${m.tenants.map((x) => `<span class="tag">${esc(x)}</span>`).join(" ")}</td>
              <td class="r hide-sm num" style="color:var(--faint);font-size:11.5px">${esc(m.last)}</td>
              <td class="r"><button class="txt-btn" data-act="member-edit">編集</button></td>
            </tr>`).join("")}</tbody>
          </table>
        </div>
      </section>

      <section class="block">
        <div class="block-h"><h2>API トークン</h2><span class="aside">CI / 監視からの読み取りに使用</span></div>
        <div class="sheet">
          ${D.TOKENS.map((tk) => `<div class="token-row">
            <span class="nm">${esc(tk.name)}</span>
            <span class="tag primary">${esc(tk.scope)}</span>
            <span style="font-size:11px;color:var(--faint)">最終使用 ${esc(tk.last)}</span>
            <button class="txt-btn danger" data-act="token-revoke">失効</button>
          </div>`).join("")}
        </div>
      </section>

      <section class="block">
        <div class="block-h"><h2>監査ログ</h2><span class="aside">直近 30 日を保持</span></div>
        <div class="sheet" style="overflow:hidden">
          <div class="audit-tools">
            <div class="search">${icon("search")}<input class="inp" data-filter="audit" placeholder="操作・対象・メンバーで検索" style="width:260px"></div>
            <select class="inp" data-filter="auditact" style="height:30px;width:auto;font-size:12px">
              <option value="">すべての操作</option>
              ${Array.from(new Set(D.AUDIT.map((a) => a.act))).map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join("")}
            </select>
            <span class="count" style="margin-left:auto;font-size:11.5px;color:var(--faint)">${D.AUDIT.length} 件</span>
          </div>
          <table>
            <thead><tr><th style="width:88px">日時</th><th style="width:150px">実行者</th><th>操作</th><th class="hide-sm">対象</th><th class="r hide-sm" style="width:120px">送信元</th></tr></thead>
            <tbody data-auditbody>${D.AUDIT.map((a) => `<tr data-audit-row data-q="${esc((a.who + a.act + a.target).toLowerCase())}" data-act="${esc(a.act)}">
              <td class="num" style="color:var(--faint);font-size:11.5px">${esc(a.at)}</td>
              <td><span class="who"><span class="av">${esc(a.who.slice(0, 1).toUpperCase())}</span>${esc(a.who)}</span>
                ${a.ok ? "" : `<span class="tag bad" style="margin-left:5px">失敗</span>`}</td>
              <td><code class="act">${esc(a.act)}</code></td>
              <td class="hide-sm" style="color:var(--muted);font-size:12px">${esc(a.target)}</td>
              <td class="r hide-sm mono" style="color:var(--faint);font-size:11px">${esc(a.ip)}</td>
            </tr>`).join("")}</tbody>
          </table>
        </div>
      </section>
    </div>`;
  };

  V.logRowHtml = logRow;
  window.MTV = V;
})();
