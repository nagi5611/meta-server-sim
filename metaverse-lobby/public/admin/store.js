/* 管理パネル — API データ層 */
(function () {
  "use strict";

  const API = window.LobbyAdminApi;

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

  const metricsCache = { range: "24h", per: {}, total: [], labels: [] };

  const store = {
    worlds: [],
    users: [],
    announcements: [],
    overview: null,
    async refresh() {
      if (!API) throw new Error("api_unavailable");
      const [cat, users] = await Promise.all([API.getCatalog(), API.getUsers()]);
      this.worlds = cat.worlds || [];
      this.users = users.users || [];
      try {
        this.overview = await API.overview();
      } catch {
        this.overview = null;
      }
      try {
        await store.fetchMetrics("24h");
      } catch {
        /* metrics optional — empty charts if 401 or LOBBY_DB unset */
      }
    },
    async fetchMetrics(range) {
      if (!API) return metricsCache;
      const data = await API.metrics(range);
      metricsCache.range = range;
      if (range === "7d") {
        metricsCache.per = {};
        metricsCache.labels = data.labels || [];
        metricsCache.total = data.values || [];
        this.worlds.forEach((w) => {
          metricsCache.per[w.id] = metricsCache.total.map((v) =>
            Math.round(v * ((w.players || 1) / Math.max(this.overview?.online || 1, 1)))
          );
        });
      } else {
        metricsCache.per = data.per || {};
        const ids = this.worlds.map((w) => w.id);
        const len = 24;
        metricsCache.total = new Array(len).fill(0).map((_, i) =>
          ids.reduce((a, id) => a + (Number((data.per?.[id] || [])[i]) || 0), 0)
        );
        const now = new Date();
        now.setMinutes(0);
        metricsCache.labels = metricsCache.total.map((_, i) => {
          const d = new Date(now.getTime() - (len - 1 - i) * 3600e3);
          return d.getHours() + ":00";
        });
      }
      return metricsCache;
    },
    user(id) {
      return this.users.find((u) => u.id === id) || null;
    },
    async patchUser(id, patch) {
      if (patch.banned !== undefined) {
        await API.patchUser(id, { banned: patch.banned });
      }
      if (patch.role) {
        await API.patchUser(id, { role: patch.role });
      }
      await this.refresh();
      return this.user(id);
    },
    async kickUser(id) {
      await API.kickUser(id);
      await this.refresh();
    },
    async sendPasswordReset(id) {
      return API.sendPasswordReset(id);
    },
    world(id) {
      return this.worlds.find((w) => w.id === id) || null;
    },
    async removeWorld(id) {
      this.worlds = this.worlds.filter((w) => w.id !== id);
      await API.putCatalog(this.worlds);
      await this.refresh();
    },
    async upsertWorld(w) {
      const i = this.worlds.findIndex((x) => x.id === w.id);
      if (i >= 0) this.worlds[i] = w;
      else this.worlds.push(w);
      await API.putCatalog(this.worlds);
      await this.refresh();
    },
    worldName(id) {
      const w = this.world(id);
      return w ? w.name : "削除されたワールド";
    },
    async joinLogs(page) {
      return API.joinLogs(page);
    },
    async refreshAnnouncements() {
      if (!API) return [];
      const data = await API.listAnnouncements();
      this.announcements = data.announcements || [];
      return this.announcements;
    },
    async createAnnouncement(payload) {
      const data = await API.createAnnouncement(payload);
      await this.refreshAnnouncements();
      return data.announcement;
    },
    async updateAnnouncement(id, payload) {
      const data = await API.updateAnnouncement(id, payload);
      await this.refreshAnnouncements();
      return data.announcement;
    },
    async removeAnnouncement(id) {
      await API.deleteAnnouncement(id);
      this.announcements = this.announcements.filter((a) => a.id !== id);
    },
  };

  function hourly(w) {
    const s = metricsCache.per[w.id];
    if (Array.isArray(s) && s.length) return s;
    return new Array(24).fill(w.status === "maint" ? 0 : Number(w.players) || 0);
  }

  function daily(w) {
    const h = hourly(w);
    const avg = h.reduce((a, b) => a + b, 0) / Math.max(h.length, 1);
    const WEEK = [0.72, 0.68, 0.75, 0.81, 0.93, 1.12, 1.0];
    return WEEK.map((m) => Math.round(avg * m));
  }

  window.MMH = {
    store,
    hourly,
    daily,
    metricsCache,
    STATUS,
    AUDIENCE,
    visible(w, viewer) {
      if (w.audience === "all") return true;
      if (w.audience === "signed") return viewer === "signed" || viewer === "admin";
      return viewer === "admin";
    },
    fmtNum(n) {
      return Number(n || 0).toLocaleString("ja-JP");
    },
    fmtDateTime(iso) {
      const d = window.LobbyTime?.parseLobbyInstant
        ? window.LobbyTime.parseLobbyInstant(iso)
        : new Date(iso);
      if (isNaN(d)) return "—";
      return new Intl.DateTimeFormat(undefined, {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
    },
    fmtLobbyDate(iso) {
      if (window.LobbyTime?.formatLobbyDate) {
        return window.LobbyTime.formatLobbyDate(iso) || "—";
      }
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "—";
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}/${m}/${day}`;
    },
    fmtDur(min) {
      if (!min) return "—";
      if (min < 60) return min + "分";
      const h = Math.floor(min / 60);
      return h + "時間" + (min % 60 ? (min % 60) + "分" : "");
    }
  };
})();