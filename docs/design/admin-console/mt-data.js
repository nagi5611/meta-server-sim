/* マルチテナント管理パネル — データ層（プロトタイプ用モック） */
(function () {
  "use strict";

  /* ---------- 乱数（シード固定でリロードしても同じ形） ---------- */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 表示フォーマット ---------- */
  const num = (n) => (n == null ? "—" : Number(n).toLocaleString("ja-JP"));
  const pct = (a, b) => (!b ? 0 : Math.min(100, (a / b) * 100));
  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const hhmmss = (d) => `${hhmm(d)}:${pad(d.getSeconds())}`;
  const mdhm = (d) => `${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}`;

  /* ---------- テナント ---------- */
  const TENANTS = [
    {
      id: "mmh",
      org: "松山南高校",
      name: "みんなでメタ",
      host: "mmh.mmh-virtual.jp",
      plan: "教育機関",
      zone: "jp-osaka-1",
      status: "online",
      players: 312,
      cap: 500,
      latency: 38,
      errorRate: 0.42,
      bandwidth: 184.2,
      uptime: 99.98,
      since: "2025-04-12",
      owners: 4,
      worlds: [
        { id: "akari", name: "AKARI City", players: 128, cap: 200, status: "online", size: 42, version: "v14" },
        { id: "yofukashi", name: "Yofukashi Street", players: 74, cap: 120, status: "online", size: 38, version: "v9" },
        { id: "hoshimi", name: "Hoshimi Rooftop", players: 41, cap: 80, status: "online", size: 21, version: "v7" },
        { id: "lab", name: "Lab. Zero", players: 0, cap: 40, status: "maint", size: 16, version: "v3" }
      ]
    },
    {
      id: "matsuyama",
      org: "松山市教育委員会",
      name: "松山シティキャンパス",
      host: "city.mmh-virtual.jp",
      plan: "自治体",
      zone: "jp-osaka-1",
      status: "online",
      players: 1842,
      cap: 3000,
      latency: 44,
      errorRate: 0.71,
      bandwidth: 612.4,
      uptime: 99.94,
      since: "2025-01-20",
      owners: 11,
      worlds: [
        { id: "chuo", name: "中央商店街", players: 802, cap: 1200, status: "online", size: 96, version: "v22" },
        { id: "onsen", name: "道後温泉郷", players: 514, cap: 900, status: "online", size: 88, version: "v18" },
        { id: "castle", name: "城山公園", players: 402, cap: 700, status: "online", size: 74, version: "v11" },
        { id: "gym", name: "総合体育館", players: 124, cap: 300, status: "online", size: 33, version: "v5" }
      ]
    },
    {
      id: "kitakou",
      org: "松山北高校",
      name: "北高バーチャル校舎",
      host: "kitakou.mmh-virtual.jp",
      plan: "教育機関",
      zone: "jp-tokyo-1",
      status: "degraded",
      players: 642,
      cap: 1200,
      latency: 186,
      errorRate: 3.94,
      bandwidth: 241.8,
      uptime: 99.12,
      since: "2025-06-02",
      owners: 3,
      worlds: [
        { id: "honkan", name: "本館", players: 388, cap: 600, status: "online", size: 54, version: "v12" },
        { id: "toshokan", name: "図書室", players: 162, cap: 300, status: "online", size: 29, version: "v6" },
        { id: "butai", name: "講堂ステージ", players: 92, cap: 300, status: "online", size: 41, version: "v4" }
      ]
    },
    {
      id: "shogyo",
      org: "松山商業高校",
      name: "商業高校商店街",
      host: "shogyo.mmh-virtual.jp",
      plan: "教育機関",
      zone: "jp-osaka-1",
      status: "event",
      players: 310,
      cap: 800,
      latency: 41,
      errorRate: 0.28,
      bandwidth: 96.4,
      uptime: 99.99,
      since: "2025-09-08",
      owners: 2,
      worlds: [
        { id: "shotengai", name: "実習商店街", players: 268, cap: 600, status: "event", size: 62, version: "v8" },
        { id: "bank", name: "実習銀行", players: 42, cap: 200, status: "online", size: 24, version: "v3" }
      ]
    },
    {
      id: "ehime-edu",
      org: "愛媛大学 教育学部",
      name: "教育実践ラボ",
      host: "edu-lab.mmh-virtual.jp",
      plan: "研究",
      zone: "jp-tokyo-1",
      status: "online",
      players: 88,
      cap: 400,
      latency: 52,
      errorRate: 0.11,
      bandwidth: 28.6,
      uptime: 100.0,
      since: "2026-02-17",
      owners: 5,
      worlds: [
        { id: "classroom", name: "模擬教室", players: 61, cap: 200, status: "online", size: 18, version: "v5" },
        { id: "gallery", name: "作品ギャラリー", players: 27, cap: 200, status: "online", size: 22, version: "v2" }
      ]
    },
    {
      id: "lab",
      org: "内部",
      name: "検証環境",
      host: "lab.mmh-virtual.jp",
      plan: "検証",
      zone: "jp-osaka-1",
      status: "offline",
      players: 0,
      cap: 200,
      latency: 0,
      errorRate: 0,
      bandwidth: 1.2,
      uptime: 97.4,
      since: "2024-11-05",
      owners: 1,
      worlds: [{ id: "sandbox", name: "Sandbox", players: 0, cap: 200, status: "maint", size: 12, version: "v31" }]
    }
  ];

  const STATUS = {
    online: { label: "稼働中", tone: "ok" },
    degraded: { label: "劣化", tone: "warn" },
    event: { label: "イベント中", tone: "event" },
    offline: { label: "停止", tone: "off" }
  };

  /* ---------- 時系列 ---------- */
  const cache = {};
  function hourly(t) {
    if (cache["h" + t.id]) return cache["h" + t.id];
    const r = rng(t.id.length * 9173 + t.name.length * 31);
    const down = t.status === "offline";
    const out = [];
    for (let i = 0; i < 24; i++) {
      const h = (new Date().getHours() - 23 + i + 24) % 24;
      // 学校の利用は 8〜19 時に山、深夜は谷
      const shape = 0.28 + 0.72 * Math.max(0, Math.sin(((h - 5) / 24) * Math.PI * 1.55));
      const v = down ? 0 : Math.round(t.cap * 0.62 * shape * (0.86 + r() * 0.28));
      out.push(Math.min(t.cap, v));
    }
    if (!down) out[out.length - 1] = t.players;
    return (cache["h" + t.id] = out);
  }
  function daily(t) {
    if (cache["d" + t.id]) return cache["d" + t.id];
    const r = rng(t.id.length * 517 + 7);
    const down = t.status === "offline";
    const out = [];
    for (let i = 0; i < 7; i++) {
      const wk = (new Date().getDay() - 6 + i + 7) % 7;
      const weekend = wk === 0 || wk === 6 ? 0.55 : 1;
      out.push(down ? 0 : Math.round(t.cap * 0.58 * weekend * (0.85 + r() * 0.3)));
    }
    if (!down) out[6] = t.players;
    return (cache["d" + t.id] = out);
  }
  function labels24() {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return Array.from({ length: 24 }, (_, i) => {
      const d = new Date(now.getTime() - (23 - i) * 3600e3);
      return hhmm(d).slice(0, 2) + ":00";
    });
  }
  function labels7() {
    const wd = "日月火水木金土";
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 864e5);
      return `${d.getMonth() + 1}/${d.getDate()}（${wd[d.getDay()]}）`;
    });
  }

  /* ---------- ノード / ヘルス / イベント ---------- */
  const NODE_ROLES = ["world", "gateway", "voice"];
  function nodes(t) {
    const r = rng(t.id.length * 7717 + 3);
    const n = t.status === "offline" ? 1 : t.players > 1000 ? 4 : t.players > 300 ? 3 : 2;
    return Array.from({ length: n }, (_, i) => {
      const role = NODE_ROLES[i % 3];
      const share = role === "gateway" ? 0.12 : role === "voice" ? 0.18 : 0.7 / Math.max(1, n - 2);
      const p = Math.round(t.players * share);
      return {
        id: `node-${String.fromCharCode(97 + i)}`,
        zone: t.zone + String.fromCharCode(97 + i),
        role,
        cpu: t.status === "degraded" && role === "world" ? 94 : Math.round(28 + r() * 42),
        mem: Math.round(38 + r() * 40),
        players: p,
        status: t.status === "offline" ? "off" : t.status === "degraded" && role === "world" ? "warn" : "ok"
      };
    });
  }
  function health(t) {
    const off = t.status === "offline";
    const r = rng(t.id.length * 61 + 11);
    return [
      { path: "/healthz", ok: !off, ms: off ? null : 11 + Math.round(r() * 6) },
      { path: "/api/session", ok: !off, ms: off ? null : Math.round(t.latency * 1.2) },
      { path: "/rtc/signal", ok: !off, ms: off ? null : Math.round(t.latency * 1.6) },
      { path: "/assets/manifest.json", ok: !off, ms: off ? null : 24 + Math.round(r() * 18) },
      { path: "/db/read", ok: !off, ms: off ? null : Math.round(t.latency * 0.8) }
    ];
  }
  function events(t) {
    const base = [];
    if (t.status === "degraded")
      base.push({ at: "11/24 09:12", kind: "incident", text: "node-a の CPU 使用率が 90% を超過。ワールド応答が遅延。" });
    if (t.status === "offline")
      base.push({ at: "11/23 22:40", kind: "maintenance", text: "計画メンテナンスのため全ワールドを停止。" });
    base.push(
      { at: "11/22 18:04", kind: "deploy", text: "ワールド AKARI City を v13 → v14 に更新。" },
      { at: "11/21 14:26", kind: "config", text: "同時接続上限を 400 → 500 に変更。" },
      { at: "11/19 10:02", kind: "deploy", text: "アバター同期のビルドを更新しました。" },
      { at: "11/17 16:48", kind: "access", text: "新しいテナント管理者 kitsune を追加。" }
    );
    return base;
  }

  /* ---------- 通信ログ ---------- */
  const PATHS = [
    { p: "/api/session", m: "POST", w: 6 },
    { p: "/api/world/akari/state", m: "GET", w: 14 },
    { p: "/api/world/akari/objects", m: "GET", w: 10 },
    { p: "/rtc/signal", m: "POST", w: 9 },
    { p: "/assets/avatar/nagi.glb", m: "GET", w: 4 },
    { p: "/api/voice/token", m: "POST", w: 5 },
    { p: "/assets/env/akari/night.hdr", m: "GET", w: 3 },
    { p: "/api/chat/channels", m: "GET", w: 7 },
    { p: "/api/telemetry", m: "POST", w: 11 },
    { p: "/admin/worlds/publish", m: "PUT", w: 1 },
    { p: "/api/presence", m: "GET", w: 8 }
  ];
  const STATUSES = [
    { s: 200, w: 71 },
    { s: 204, w: 6 },
    { s: 304, w: 9 },
    { s: 400, w: 3 },
    { s: 401, w: 2 },
    { s: 404, w: 3 },
    { s: 429, w: 2 },
    { s: 500, w: 2 },
    { s: 503, w: 1 }
  ];
  const IPS = [
    "153.186.44.12", "133.11.208.75", "203.0.113.58", "198.51.100.21",
    "10.0.4.18", "172.16.8.44", "133.11.209.9", "126.72.190.4"
  ];

  function pickWeighted(list, key, r) {
    const total = list.reduce((a, x) => a + x[key], 0);
    let v = r() * total;
    for (const x of list) {
      v -= x[key];
      if (v <= 0) return x;
    }
    return list[list.length - 1];
  }

  const logCache = {};
  function seedLogs(t, n) {
    const key = t.id + ":" + n;
    if (logCache[key]) return logCache[key];
    const r = rng(t.id.length * 3331 + n);
    const out = [];
    const now = Date.now();
    for (let i = n - 1; i >= 0; i--) {
      const path = pickWeighted(PATHS, "w", r);
      const st = pickWeighted(STATUSES, "w", r);
      const bad = st.s >= 400;
      const ms = bad
        ? (st.s >= 500 ? 400 + Math.round(r() * 1600) : 8 + Math.round(r() * 40))
        : Math.round(t.latency * (0.4 + r() * 1.7));
      out.push({
        id: key + "-" + i,
        at: new Date(now - i * 1400 - Math.round(r() * 600)),
        method: path.m,
        path: path.p,
        status: st.s,
        ms,
        bytes: st.s === 304 || st.s === 204 ? 0 : 240 + Math.round(r() * 180000),
        ip: IPS[Math.floor(r() * IPS.length)],
        world: t.worlds[Math.floor(r() * Math.min(3, t.worlds.length))].id,
        ua: r() > 0.55 ? "MetaQuest/3" : "Chrome/128"
      });
    }
    return (logCache[key] = out);
  }

  let liveSeq = 0;
  function liveLog(t) {
    const r = Math.random;
    const path = pickWeighted(PATHS, "w", r);
    const st = pickWeighted(STATUSES, "w", r);
    const bad = st.s >= 400;
    const ms = bad
      ? st.s >= 500 ? 380 + Math.round(r() * 1500) : 6 + Math.round(r() * 34)
      : Math.round(t.latency * (0.35 + r() * 1.8));
    return {
      id: "live-" + ++liveSeq,
      at: new Date(),
      method: path.m,
      path: path.p,
      status: st.s,
      ms,
      bytes: st.s === 304 || st.s === 204 ? 0 : 240 + Math.round(r() * 160000),
      ip: IPS[Math.floor(r() * IPS.length)],
      world: t.worlds[Math.floor(r() * Math.min(3, t.worlds.length))].id,
      ua: r() > 0.55 ? "MetaQuest/3" : "Chrome/128"
    };
  }

  /* ---------- 集計 ---------- */
  function trafficAgg(t) {
    const r = rng(t.id.length * 911 + 5);
    const hours = Array.from({ length: 24 }, (_, i) => {
      const shape = 0.22 + 0.78 * Math.max(0, Math.sin(((i - 4) / 24) * Math.PI * 1.5));
      return Math.round((t.bandwidth / 12) * shape * (0.85 + r() * 0.3) * 10) / 10;
    });
    const total = hours.reduce((a, b) => a + b, 0);
    const dist = [
      { k: "2xx", v: 77, tone: "ok" },
      { k: "3xx", v: 15, tone: "mute" },
      { k: "4xx", v: Math.round(4 + t.errorRate * 0.8), tone: "warn" },
      { k: "5xx", v: Math.max(1, Math.round(t.errorRate * 0.6)), tone: "bad" }
    ];
    return {
      hours,
      total: Math.round(total * 10) / 10,
      dist,
      p50: t.latency,
      p95: Math.round(t.latency * 2.4),
      p99: Math.round(t.latency * 4.1),
      reqPerSec: Math.round(38 + t.players * 0.42),
      top: [
        { p: "/api/world/*/state", n: Math.round(t.players * 8.4), avg: Math.round(t.latency * 0.9) },
        { p: "/rtc/signal", n: Math.round(t.players * 5.1), avg: Math.round(t.latency * 1.6) },
        { p: "/api/telemetry", n: Math.round(t.players * 4.2), avg: 21 },
        { p: "/api/presence", n: Math.round(t.players * 2.8), avg: Math.round(t.latency * 0.6) },
        { p: "/assets/*", n: Math.round(t.players * 1.9), avg: 44 }
      ]
    };
  }

  /* ---------- 監査 / 権限 ---------- */
  const AUDIT = [
    { at: "11/24 09:41", who: "nagi", act: "world.publish", target: "mmh / AKARI City v14", ip: "153.186.44.12", ok: true },
    { at: "11/24 09:12", who: "system", act: "alert.raise", target: "kitakou / node-a CPU 94%", ip: "—", ok: true },
    { at: "11/24 08:50", who: "kitsune", act: "tenant.config.update", target: "kitakou / 同時接続上限 1200", ip: "133.11.208.75", ok: true },
    { at: "11/24 08:22", who: "nagi", act: "auth.login", target: "admin", ip: "153.186.44.12", ok: true },
    { at: "11/23 22:40", who: "nagi", act: "tenant.stop", target: "lab / 全ワールド", ip: "153.186.44.12", ok: true },
    { at: "11/23 19:04", who: "mio", act: "auth.login", target: "admin", ip: "198.51.100.21", ok: false },
    { at: "11/23 18:31", who: "kitsune", act: "object.create", target: "kitakou / 本館 / 掲示板 ×3", ip: "133.11.208.75", ok: true },
    { at: "11/23 15:12", who: "nagi", act: "token.issue", target: "ci-deploy", ip: "153.186.44.12", ok: true },
    { at: "11/22 18:04", who: "nagi", act: "world.publish", target: "mmh / AKARI City v13", ip: "153.186.44.12", ok: true },
    { at: "11/22 11:26", who: "haru", act: "traffic.export", target: "mmh / 24h", ip: "126.72.190.4", ok: true }
  ];

  const ROLES = [
    {
      id: "owner", label: "全体管理者", count: 2,
      desc: "全テナントの作成・停止・削除。請求と権限の変更も可能。",
      perms: ["テナント作成 / 削除", "全テナントの設定変更", "権限・API トークン管理", "監査ログの閲覧"]
    },
    {
      id: "tenant", label: "テナント管理者", count: 6,
      desc: "割り当てられたテナント内のみ。ワールド編集と公開ができる。",
      perms: ["ワールドの編集 / 公開", "通信ログの閲覧", "テナント設定の変更", "監査ログの閲覧（自テナント）"]
    },
    {
      id: "viewer", label: "閲覧者", count: 9,
      desc: "読み取りのみ。オブジェクトの編集や公開は行えない。",
      perms: ["ステータスの閲覧", "通信ログの閲覧", "ワールドのプレビュー"]
    }
  ];

  const MEMBERS = [
    { id: "nagi", name: "nagi", mail: "nagi@mmh.ed.jp", role: "owner", tenants: ["すべて"], last: "11/24 08:22" },
    { id: "mio", name: "mio", mail: "mio@mmh.ed.jp", role: "owner", tenants: ["すべて"], last: "11/23 19:04" },
    { id: "kitsune", name: "kitsune", mail: "kitsune@kitakou.ed.jp", role: "tenant", tenants: ["北高バーチャル校舎"], last: "11/24 08:50" },
    { id: "haru", name: "haru", mail: "haru@mmh.ed.jp", role: "tenant", tenants: ["みんなでメタ"], last: "11/22 11:26" },
    { id: "sora", name: "sora", mail: "sora@city.matsuyama.ehime.jp", role: "tenant", tenants: ["松山シティキャンパス"], last: "11/21 17:02" },
    { id: "rin", name: "rin", mail: "rin@shogyo.ed.jp", role: "viewer", tenants: ["商業高校商店街"], last: "11/20 09:48" }
  ];

  const TOKENS = [
    { name: "ci-deploy", scope: "worlds:write", created: "10/02", last: "11/24 09:38" },
    { name: "grafana-scrape", scope: "metrics:read", created: "08/17", last: "11/24 09:44" }
  ];

  /* ---------- 編集可能なオブジェクト定義 ---------- */
  const OBJ_TYPES = {
    portal: { label: "ポータル", w: 1.6, d: 1.6, h: 2.2, color: "#f6f7f9" },
    spawn: { label: "スポーン地点", w: 1.4, d: 1.4, h: 0.16, color: "#101624" },
    board: { label: "掲示板", w: 2.2, d: 0.3, h: 1.8, color: "#aab4c2" },
    prop: { label: "小物", w: 1.1, d: 1.1, h: 0.9, color: "#bfc8d4" },
    light: { label: "ライト", w: 0.7, d: 0.7, h: 0.7, color: "#f6cf96" },
    sound: { label: "サウンド源", w: 0.9, d: 0.9, h: 0.4, color: "#9fb0c4" },
    stage: { label: "ステージ", w: 4.2, d: 2.6, h: 0.5, color: "#d5dce5" },
    collider: { label: "当たり判定", w: 2, d: 2, h: 1.6, color: "#8a92a1" }
  };

  const WORLD_OBJECTS = [
    { id: "o1", type: "stage", name: "中央ステージ", x: 0, z: 0, y: 0, rot: 0 },
    { id: "o2", type: "portal", name: "Yofukashi Street への扉", x: -3.5, z: -3, y: 0, rot: 0 },
    { id: "o3", type: "spawn", name: "初期スポーン", x: 0, z: 3.5, y: 0, rot: 0 },
    { id: "o4", type: "board", name: "案内板", x: 3.4, z: 2.2, y: 0, rot: 90 },
    { id: "o5", type: "prop", name: "屋台 A", x: -4.6, z: 2.4, y: 0, rot: 0 },
    { id: "o6", type: "prop", name: "屋台 B", x: -4.6, z: 4.4, y: 0, rot: 0 },
    { id: "o7", type: "light", name: "街灯 01", x: 5.2, z: -1.2, y: 3.2, rot: 0 },
    { id: "o8", type: "light", name: "街灯 02", x: -5.6, z: -4.4, y: 3.2, rot: 0 },
    { id: "o9", type: "sound", name: "環境音・人混み", x: 1.8, z: -2.4, y: 0.2, rot: 0 },
    { id: "o10", type: "collider", name: "外周フェンス", x: 6, z: 4, y: 0, rot: 0 }
  ];

  /* ---------- アドオン ---------- */
  const ADDON_CATS = [
    { id: "world", label: "ワールド拡張", en: "WORLD" },
    { id: "comm", label: "コミュニケーション", en: "COMM" },
    { id: "guard", label: "アクセスと安全", en: "GUARD" },
    { id: "insight", label: "分析・運用", en: "INSIGHT" },
    { id: "event", label: "イベント", en: "EVENT" }
  ];

  const ADDONS = [
    { id: "avatar-sync", name: "アバター同期", cat: "world", vendor: "公式", ver: "3.4.1", icon: "person",
      desc: "参加者の姿勢・表情・リップシンクを全クライアントへ同期します。",
      perms: ["avatar:sync", "presence:read"], dep: [] },
    { id: "gltf-import", name: "GLTF インポータ", cat: "world", vendor: "公式", ver: "2.1.0", icon: "box",
      desc: ".glb / .gltf をワールド編集に取り込み、そのまま配置できます。",
      perms: ["asset:write"], dep: [] },
    { id: "portal-link", name: "ワールド間ポータル", cat: "world", vendor: "公式", ver: "1.8.3", icon: "portal",
      desc: "ワールドをまたぐ移動ポータルを設置し、行き先を管理画面から指定します。",
      perms: ["world:write", "session:transfer"], dep: ["avatar-sync"] },
    { id: "board-notice", name: "ワールド内掲示板", cat: "world", vendor: "公式", ver: "2.0.4", icon: "board",
      desc: "ワールド内の掲示板に、管理画面からお知らせを配信します。",
      perms: ["board:write"], dep: [] },

    { id: "voice-spatial", name: "空間ボイス", cat: "comm", vendor: "公式", ver: "4.2.0", icon: "mic",
      desc: "距離減衰つきの音声通話。ワールドごとに最大 32 人まで同時接続できます。",
      perms: ["voice:join", "rtc:signal"], dep: ["avatar-sync"] },
    { id: "chat-text", name: "テキストチャット", cat: "comm", vendor: "公式", ver: "1.6.2", icon: "chat",
      desc: "ワールド内チャンネルとダイレクトメッセージ。ログは通信ログへ転送されます。",
      perms: ["chat:write", "chat:moderate"], dep: [] },
    { id: "discord-bridge", name: "Discord 連携", cat: "comm", vendor: "コミュニティ", ver: "0.9.7", icon: "link",
      desc: "ワールド内チャットを指定した Discord チャンネルへ中継します。",
      perms: ["webhook:post", "chat:read"], dep: ["chat-text"] },
    { id: "translate-auto", name: "自動翻訳", cat: "comm", vendor: "コミュニティ", ver: "1.2.5", icon: "translate",
      desc: "チャットと掲示板の文面を日本語・英語のあいだで自動翻訳します。",
      perms: ["text:translate"], dep: ["chat-text"] },

    { id: "access-gate", name: "入室ゲート", cat: "guard", vendor: "公式", ver: "3.0.2", icon: "shield",
      desc: "時間帯・IP・所属で入室を制限します。授業時間外の接続を止められます。",
      perms: ["session:gate"], dep: [] },
    { id: "sso-google", name: "Google Workspace SSO", cat: "guard", vendor: "公式", ver: "2.3.0", icon: "key",
      desc: "学校アカウントでのシングルサインオン。パスワードを保持しません。",
      perms: ["auth:sso", "member:read"], dep: [] },
    { id: "moderation", name: "発言モデレーション", cat: "guard", vendor: "公式", ver: "1.4.0", icon: "alert",
      desc: "不適切語の検知とミュート。検知結果は監査ログへ記録されます。",
      perms: ["chat:read", "member:mute"], dep: ["chat-text"] },
    { id: "anti-grief", name: "荒らし対策", cat: "guard", vendor: "コミュニティ", ver: "0.8.1", icon: "shield",
      desc: "オブジェクトの大量生成・削除を検知し、自動で操作を制限します。",
      perms: ["object:watch", "member:limit"], dep: [] },

    { id: "analytics", name: "行動ログ収集", cat: "insight", vendor: "公式", ver: "2.7.1", icon: "chart",
      desc: "滞在時間・移動経路・操作イベントを収集し、CSV で出力できます。",
      perms: ["telemetry:read"], dep: [] },
    { id: "heatmap", name: "混雑ヒートマップ", cat: "insight", vendor: "公式", ver: "1.1.0", icon: "grid",
      desc: "ワールド内の人の集まりをヒートマップで可視化します。",
      perms: ["telemetry:read"], dep: ["analytics"] },

    { id: "stage-stream", name: "ステージ配信", cat: "event", vendor: "公式", ver: "3.1.4", icon: "play",
      desc: "講堂ステージから WebRTC で配信。視聴者はアバターのまま参加できます。",
      perms: ["rtc:publish"], dep: ["voice-spatial"] },
    { id: "scheduler", name: "イベントスケジューラ", cat: "event", vendor: "コミュニティ", ver: "1.0.0", icon: "clock",
      desc: "時間割やイベントの開始・終了に合わせてワールド状態を自動で切り替えます。",
      perms: ["world:state"], dep: [] }
  ];
  const ADDON_BY_ID = {};
  ADDONS.forEach((a) => (ADDON_BY_ID[a.id] = a));

  /* テナント（サーバー）ごとの導入状態。シードで再現性を保ち、要点だけ上書き */
  const ADDON_FIX = {
    mmh: {
      "avatar-sync": { on: true }, "voice-spatial": { on: true }, "chat-text": { on: true },
      "translate-auto": { on: true }, "analytics": { on: true }, "heatmap": { on: false },
      "anti-grief": { on: false }, "stage-stream": { on: false }, "portal-link": { on: true }
    },
    kitakou: {
      "avatar-sync": { on: true }, "moderation": { on: true, errs: 6 }, "access-gate": { on: true },
      "heatmap": { on: false }, "stage-stream": { on: false }, "discord-bridge": { on: false }
    },
    lab: {}
  };

  function addonsOf(t) {
    const r = rng(t.id.length * 7331 + t.name.length * 17 + 3);
    const down = t.status === "offline";
    const map = {};
    ADDONS.forEach((a) => {
      let on = r() > (a.cat === "guard" || a.cat === "insight" ? 0.45 : 0.3);
      if (down) on = false;
      const n = Math.max(1, Math.min(t.worlds.length, 1 + Math.floor(r() * t.worlds.length)));
      const outdated = r() > 0.8;
      const minor = Number(a.ver.split(".")[0]);
      map[a.id] = {
        on,
        worlds: t.worlds.slice(0, n).map((w) => w.id),
        ver: outdated ? `${Math.max(1, minor - 1)}.${a.ver.split(".")[1]}.${a.ver.split(".")[2]}` : a.ver,
        calls: Math.round((t.players * (0.6 + r() * 2.4) + 40) / 10) * 10,
        lat: Math.round(6 + r() * 44),
        errs: down ? 0 : r() > 0.88 ? 1 : 0,
        updated: ["11/22 18:04", "11/20 10:12", "11/18 14:36", "11/12 09:48"][Math.floor(r() * 4)],
        by: ["nagi", "kitsune", "haru", "sora"][Math.floor(r() * 4)]
      };
    });
    const fix = ADDON_FIX[t.id] || {};
    Object.keys(fix).forEach((k) => { if (map[k]) Object.assign(map[k], fix[k]); });
    /* 依存が無効なら有効にはできない */
    ADDONS.forEach((a) => {
      if (map[a.id].on && a.dep.some((d) => !map[d] || !map[d].on)) map[a.id].on = false;
    });
    return map;
  }

  window.MTD = {
    ADDONS, ADDON_BY_ID, ADDON_CATS, addonsOf,
    rng, num, pct, hhmm, hhmmss, mdhm,
    TENANTS, STATUS, hourly, daily, labels24, labels7,
    nodes, health, events, seedLogs, liveLog, trafficAgg,
    AUDIT, ROLES, MEMBERS, TOKENS, OBJ_TYPES, WORLD_OBJECTS
  };
})();
