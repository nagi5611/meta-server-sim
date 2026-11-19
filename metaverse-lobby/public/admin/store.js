/* みんなでメタ 管理パネル — データ層（プロトタイプ用のローカルストア） */
(function () {
  "use strict";

  const KEY = "mmh.admin.v2";

  const WORLD_SEED = [
    {
      id: "akari",
      name: "AKARI City",
      url: "https://world.mmh-virtual.jp/akari",
      code: "AKARI-01",
      thumb: "",
      desc: "夜のネオン商店街。屋台と看板の灯りが路面に反射する、人がもっとも集まるワールド。",
      status: "open",
      audience: "all",
      cap: 3000,
      players: 2481,
      updated: "2026-11-17T21:04:00"
    },
    {
      id: "yofukashi",
      name: "Yofukashi Street",
      url: "https://world.mmh-virtual.jp/yofukashi",
      code: "YOFU-02",
      thumb: "",
      desc: "午前0時を過ぎても明るい通り。コンビニの灯りと自販機の音だけが残る夜の散歩道。",
      status: "open",
      audience: "signed",
      cap: 1200,
      players: 762,
      updated: "2026-11-16T18:20:00"
    },
    {
      id: "hoshimi",
      name: "Hoshimi Rooftop",
      url: "https://world.mmh-virtual.jp/hoshimi",
      code: "HOSHI-03",
      thumb: "",
      desc: "ビルの屋上から夜空を眺めるワールド。投影された星と、風の音だけがある静かな場所。",
      status: "open",
      audience: "signed",
      cap: 400,
      players: 386,
      updated: "2026-11-15T12:45:00"
    },
    {
      id: "lab",
      name: "Lab. Zero",
      url: "https://world.mmh-virtual.jp/lab0",
      code: "LAB-00",
      thumb: "",
      desc: "新規アバター機能の検証区画。現在はアップデートのため接続を停止しています。",
      status: "maint",
      audience: "admin",
      cap: 200,
      players: 0,
      updated: "2026-11-18T06:10:00"
    },
    {
      id: "rakuen",
      name: "Rakuen Garden",
      url: "https://world.mmh-virtual.jp/rakuen",
      code: "RAKU-05",
      thumb: "",
      desc: "水面と苔の庭。環境音が位置に応じて聞こえるため、ボイスチャットの検証に使われています。",
      status: "open",
      audience: "all",
      cap: 1500,
      players: 1204,
      updated: "2026-11-18T08:32:00"
    },
    {
      id: "signal",
      name: "Signal Hub",
      url: "https://world.mmh-virtual.jp/signal",
      code: "SIGNAL-06",
      thumb: "",
      desc: "大型イベント用のステージ。スクリーンと観客席が常設され、配信の同時視聴ができます。",
      status: "event",
      audience: "all",
      cap: 2000,
      players: 320,
      updated: "2026-11-18T09:15:00"
    }
  ];

  const USERS_SEED = [
    {
      id: "u1", name: "nagi", handle: "@nagi", email: "nagi@mmh.ed.jp", role: "admin",
      joined: "2025-04-12", last: "2026-11-18T09:41:00", online: true,
      history: [
        { world: "akari", at: "2026-11-18T09:12:00", dur: 29, ok: true },
        { world: "signal", at: "2026-11-17T20:02:00", dur: 54, ok: true },
        { world: "rakuen", at: "2026-11-16T17:30:00", dur: 12, ok: true },
        { world: "lab", at: "2026-11-15T19:08:00", dur: 0, ok: false }
      ]
    },
    {
      id: "u2", name: "haru", handle: "@haru_phys", email: "haru@mmh.ed.jp", role: "member",
      joined: "2025-06-02", last: "2026-11-18T09:36:00", online: true,
      history: [
        { world: "yofukashi", at: "2026-11-18T09:04:00", dur: 32, ok: true },
        { world: "hoshimi", at: "2026-11-17T22:18:00", dur: 21, ok: true },
        { world: "akari", at: "2026-11-14T18:45:00", dur: 47, ok: true }
      ]
    },
    {
      id: "u3", name: "mio", handle: "@mio_3d", email: "mio@mmh.ed.jp", role: "member",
      joined: "2025-07-19", last: "2026-11-18T08:58:00", online: true,
      history: [
        { world: "rakuen", at: "2026-11-18T08:40:00", dur: 18, ok: true },
        { world: "akari", at: "2026-11-16T20:11:00", dur: 63, ok: true },
        { world: "lab", at: "2026-11-13T16:02:00", dur: 0, ok: false }
      ]
    },
    {
      id: "u4", name: "sora", handle: "@sora", email: "sora@mmh.ed.jp", role: "member",
      joined: "2025-09-08", last: "2026-11-17T22:40:00", online: false,
      history: [
        { world: "hoshimi", at: "2026-11-17T22:02:00", dur: 38, ok: true },
        { world: "signal", at: "2026-11-15T19:30:00", dur: 72, ok: true }
      ]
    },
    {
      id: "u5", name: "kaito", handle: "@kaito_m", email: "kaito@mmh.ed.jp", role: "member",
      joined: "2025-10-21", last: "2026-11-17T19:05:00", online: false,
      history: [
        { world: "akari", at: "2026-11-17T18:40:00", dur: 25, ok: true },
        { world: "yofukashi", at: "2026-11-12T21:15:00", dur: 16, ok: true }
      ]
    },
    {
      id: "u6", name: "rin", handle: "@rin_v", email: "rin@mmh.ed.jp", role: "member",
      joined: "2025-11-30", last: "2026-11-16T16:12:00", online: false,
      history: [
        { world: "rakuen", at: "2026-11-16T15:50:00", dur: 22, ok: true },
        { world: "hoshimi", at: "2026-11-09T20:22:00", dur: 41, ok: true },
        { world: "signal", at: "2026-11-02T18:00:00", dur: 9, ok: true }
      ]
    },
    {
      id: "u7", name: "yuto", handle: "@yuto", email: "yuto@mmh.ed.jp", role: "member",
      joined: "2026-04-04", last: "2026-11-14T21:33:00", online: false,
      history: [
        { world: "yofukashi", at: "2026-11-14T21:10:00", dur: 23, ok: true }
      ]
    },
    {
      id: "u8", name: "mei", handle: "@mei_lab", email: "mei@mmh.ed.jp", role: "admin",
      joined: "2025-04-12", last: "2026-11-18T07:20:00", online: false,
      history: [
        { world: "lab", at: "2026-11-18T06:40:00", dur: 40, ok: true },
        { world: "rakuen", at: "2026-11-15T13:05:00", dur: 28, ok: true },
        { world: "akari", at: "2026-11-10T19:44:00", dur: 51, ok: true }
      ]
    }
  ];

  const STATUS = {
    open: { label: "稼働中", cls: "green" },
    maint: { label: "メンテナンス中", cls: "maint" },
    event: { label: "イベント中", cls: "event" }
  };

  const AUDIENCE = {
    all: { label: "全員に表示", short: "全員", note: "サインインしていないゲストにも一覧と参加ボタンを表示します。" },
    signed: { label: "サインイン済みのみ", short: "サインイン済", note: "アカウントでサインインしている人だけに表示します。ゲストには見えません。" },
    admin: { label: "管理者のみ", short: "管理者", note: "管理者アカウントだけに表示します。検証用ワールドの隔離に使います。" }
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.worlds) || !Array.isArray(d.users)) return null;
      return d;
    } catch (e) {
      return null;
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ worlds: store.worlds, users: store.users }));
    } catch (e) {
      /* 容量超過などは無視（プロトタイプ） */
    }
  }

  const seed = load();
  const store = {
    worlds: seed ? seed.worlds : JSON.parse(JSON.stringify(WORLD_SEED)),
    users: seed ? seed.users : JSON.parse(JSON.stringify(USERS_SEED)),
    save,
    reset() {
      this.worlds = JSON.parse(JSON.stringify(WORLD_SEED));
      this.users = JSON.parse(JSON.stringify(USERS_SEED));
      save();
    },
    user(id) {
      return this.users.find((u) => u.id === id) || null;
    },
    patchUser(id, patch) {
      const u = this.user(id);
      if (!u) return null;
      Object.assign(u, patch);
      save();
      return u;
    },
    world(id) {
      return this.worlds.find((w) => w.id === id) || null;
    },
    removeWorld(id) {
      this.worlds = this.worlds.filter((w) => w.id !== id);
      save();
    },
    upsertWorld(w) {
      const i = this.worlds.findIndex((x) => x.id === w.id);
      if (i >= 0) this.worlds[i] = w;
      else this.worlds.push(w);
      save();
    },
    worldName(id) {
      const w = this.world(id);
      return w ? w.name : "削除されたワールド";
    }
  };

  /* ---- アクセス推移（24h：1時間ごと、7d：日ごとの平均同時接続） ---- */
  const SHAPE = {
    akari:     [12,9,7,5,4,4,6,11,18,24,29,33,35,34,31,28,30,36,43,49,52,46,34,22],
    yofukashi: [4,3,2,2,1,1,2,3,5,8,11,13,14,13,12,12,14,17,21,25,28,26,18,10],
    hoshimi:   [2,1,1,1,1,1,2,3,5,7,9,10,9,8,7,7,8,10,12,14,15,13,9,5],
    lab:       [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    rakuen:    [6,5,4,3,3,3,4,6,9,13,17,20,22,21,19,18,19,22,26,30,33,29,21,13],
    signal:    [1,1,1,1,1,2,3,5,8,12,16,20,23,22,20,18,17,19,24,30,36,42,30,14]
  };
  const GENERIC = [3,2,2,1,1,1,2,4,6,9,12,14,15,14,13,12,13,16,19,22,24,21,15,8];
  const WEEK = [0.72, 0.68, 0.75, 0.81, 0.93, 1.12, 1.0];

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /** 24時間分（23時間前 → 現在）。現在値 = players に合わせてスケール */
  function hourly(w) {
    if (w.status === "maint") return new Array(24).fill(0);
    const s = SHAPE[w.id] || GENERIC;
    const last = s[s.length - 1] || 1;
    const k = (w.players || 0) / last;
    return s.map((v) => Math.round(v * k));
  }
  /** 7日分（日ごとの平均同時接続） */
  function daily(w) {
    const h = hourly(w);
    const avg = h.reduce((a, b) => a + b, 0) / 24;
    const j = hash(w.id);
    return WEEK.map((m, i) => Math.round(avg * m * (0.92 + ((j >> i) % 7) / 40)));
  }

  window.MMH = {
    store,
    hourly,
    daily,
    STATUS,
    AUDIENCE,
    /** 閲覧者がこのワールドを見られるか */
    visible(w, viewer) {
      if (w.audience === "all") return true;
      if (w.audience === "signed") return viewer === "signed" || viewer === "admin";
      return viewer === "admin";
    },
    fmtNum(n) {
      return Number(n || 0).toLocaleString("ja-JP");
    },
    fmtDateTime(iso) {
      const d = new Date(iso);
      if (isNaN(d)) return "—";
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
    fmtDur(min) {
      if (!min) return "—";
      if (min < 60) return min + "分";
      const h = Math.floor(min / 60);
      return h + "時間" + (min % 60 ? (min % 60) + "分" : "");
    }
  };
})();
