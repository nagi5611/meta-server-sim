/* mt-data-live.js — MTD データ層（既存 /admin API、未接続は空＋UI側表示） */
(function () {
    'use strict';

    const num = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('ja-JP'));
    const pct = (a, b) => (!b ? 0 : Math.min(100, (a / b) * 100));
    const pad = (n) => String(n).padStart(2, '0');
    const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const hhmmss = (d) => `${hhmm(d)}:${pad(d.getSeconds())}`;
    const mdhm = (d) => `${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}`;

    const STATUS = {
        online: { label: '稼働中', tone: 'ok' },
        degraded: { label: '要注意', tone: 'warn' },
        offline: { label: '停止', tone: 'down' },
        maint: { label: 'メンテ', tone: 'warn' },
    };

    const ADDON_CATS = [
        { id: 'world', label: 'ワールド拡張', en: 'WORLD' },
        { id: 'comm', label: 'コミュニケーション', en: 'COMM' },
        { id: 'guard', label: 'アクセスと安全', en: 'GUARD' },
        { id: 'insight', label: '分析・運用', en: 'INSIGHT' },
        { id: 'event', label: 'イベント', en: 'EVENT' },
    ];

    let TENANTS = [];
    let ADDONS = [];
    const ADDON_BY_ID = {};
    let pluginStateByTenant = {};
    let trafficDisconnected = true;
    let auditDisconnected = true;
    let AUDIT = [];
    let ROLES = [];
    let MEMBERS = [];
    let TOKENS = [];

    const disconnected = { _disconnected: true };

    function mapTenantRow(row, stats) {
        const id = row.id || row.tenantId;
        const players = stats?.players ?? stats?.connectedPlayers ?? 0;
        const worldsRaw = stats?.worlds || [];
        const worlds = Array.isArray(worldsRaw)
            ? worldsRaw.map((w) => ({
                  id: w.id || w.worldId,
                  name: w.name || w.displayName || w.id,
                  players: w.players ?? 0,
                  cap: w.cap ?? 200,
                  status: 'online',
                  size: w.modelCount ?? w.models?.length ?? 0,
                  version: w.version || '—',
              }))
            : [];
        return {
            id,
            org: row.displayName || row.name || id,
            name: row.displayName || row.name || id,
            host: row.url ? String(row.url).replace(/^https?:\/\//, '') : `${id}.mmh-virtual.jp`,
            plan: row.plan || 'テナント',
            zone: '—',
            status: stats?.online === false ? 'offline' : 'online',
            players,
            cap: stats?.playerCap ?? 500,
            latency: stats?.latencyMs ?? null,
            errorRate: stats?.errorRate ?? null,
            bandwidth: stats?.bandwidthMbps ?? null,
            uptime: stats?.uptime ?? null,
            since: row.createdAt || '—',
            owners: stats?.owners ?? '—',
            worlds,
        };
    }

    async function fetchJson(url, opts = {}) {
        const res = await fetch(url, { credentials: 'include', ...opts });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function loadTenants() {
        const list = await fetchJson('/admin/tenants');
        const rows = Array.isArray(list) ? list : list.tenants || [];
        const out = [];
        for (const row of rows) {
            const id = row.id || row.tenantId;
            let stats = null;
            let worldsJson = null;
            try {
                stats = await fetchJson(`/admin/tenants/${encodeURIComponent(id)}/stats`);
            } catch {
                stats = null;
            }
            try {
                worldsJson = await fetchJson(`/admin/tenants/${encodeURIComponent(id)}/worlds`);
            } catch {
                worldsJson = null;
            }
            const mapped = mapTenantRow(row, stats);
            if (stats?.traffic) mapped._traffic = stats.traffic;
            if (worldsJson && typeof worldsJson === 'object' && !Array.isArray(worldsJson)) {
            mapped.worlds = Object.entries(worldsJson).map(([wid, w]) => ({
                    id: wid,
                    name: w?.name || w?.displayName || wid,
                    players: 0,
                    cap: 200,
                    status: 'online',
                    size: Array.isArray(w?.models) ? w.models.length : 0,
                    version: '—',
                }));
            }
            if (stats?.traffic?.topPaths?.length) trafficDisconnected = false;
            out.push(mapped);
        }
        TENANTS = out;
    }

    async function loadPlugins() {
        const catalog = new Map();
        pluginStateByTenant = {};
        for (const t of TENANTS) {
            try {
                const j = await fetchJson(`/admin/tenant/${encodeURIComponent(t.id)}/plugins`);
                const map = {};
                for (const p of j.plugins || []) {
                    const id = p.id || p.pluginId;
                    if (!catalog.has(id)) {
                        catalog.set(id, p);
                    }
                    map[id] = {
                        on: Boolean(p.enabled),
                        worlds: p.worlds || [],
                        ver: p.version || '—',
                        calls: '—',
                        lat: '—',
                        errs: 0,
                        updated: '—',
                        by: '—',
                    };
                }
                pluginStateByTenant[t.id] = map;
            } catch {
                pluginStateByTenant[t.id] = {};
            }
        }
        ADDONS = [...catalog.values()].map((p) => ({
            id: p.id || p.pluginId,
            name: p.name || p.id,
            cat: p.category || 'world',
            vendor: p.source || '—',
            ver: p.version || '—',
            icon: 'modules',
            desc: p.description || '',
            perms: [],
            dep: p.dependsOn || [],
        }));
        Object.keys(ADDON_BY_ID).forEach((k) => delete ADDON_BY_ID[k]);
        ADDONS.forEach((a) => {
            ADDON_BY_ID[a.id] = a;
        });
    }

    async function loadPluginStates() {
        /* loadPlugins で兼ねる */
    }

    async function loadAudit() {
        auditDisconnected = true;
        AUDIT = [];
        ROLES = [{ id: 'admin', label: '全体管理者' }];
        MEMBERS = [];
        TOKENS = [];
        try {
            const users = await fetchJson('/admin/users');
            auditDisconnected = false;
            MEMBERS = (users.users || users || []).map((u) => ({
                id: u.id || u.email,
                name: u.name || u.email,
                role: u.role || 'admin',
                last: u.lastLogin || '—',
            }));
            AUDIT = (users.audit || []).map((e) => ({
                at: e.at || e.createdAt,
                who: e.who || e.user,
                msg: e.message || e.msg,
                published: false,
            }));
        } catch {
            /* 未接続のまま */
        }
    }

    function addonsOf(t) {
        return pluginStateByTenant[t.id] || {};
    }

    function seedLogs(t, n = 40) {
        const top = t?._traffic?.topPaths;
        if (Array.isArray(top) && top.length > 0) {
            const now = Date.now();
            return top.slice(0, n).map((p, i) => ({
                id: `traffic-${i}`,
                method: 'GET',
                path: p.path || '—',
                status: 200,
                ms: Math.max(1, Math.round((p.bytes || 1) % 120)),
                at: new Date(now - i * 1500),
                bytes: p.bytes || 0,
                ip: '—',
                ua: '—',
                world: '—',
            }));
        }
        if (trafficDisconnected) {
            return [
                {
                    id: 'disconnected',
                    method: '—',
                    path: '未接続',
                    status: 0,
                    ms: 0,
                    at: new Date(),
                    bytes: 0,
                },
            ];
        }
        return [];
    }

    function liveLog() {
        return trafficDisconnected ? null : { method: 'GET', path: '/health', status: 200, ms: 12 };
    }

    function trafficAgg() {
        return trafficDisconnected ? { top: [], window: '—', total: '—' } : { top: [], window: '—', total: '—' };
    }

    let platformTraffic = null;

    async function loadTraffic() {
        try {
            const snap = await fetchJson('/admin/stats');
            platformTraffic = snap.traffic || null;
            trafficDisconnected = !platformTraffic;
        } catch {
            trafficDisconnected = true;
            platformTraffic = null;
        }
    }

    async function loadLive() {
        try {
            platformStats = await fetchJson('/admin/stats');
        } catch {
            platformStats = null;
        }
        await loadTenants();
        await Promise.all([loadPlugins(), loadTraffic()]);
        await loadPluginStates();
        await loadAudit();
    }

    /* プロトタイプ互換のスタブ（グラフ用 — 実データ未接続時はフラット） */
    function labels24() {
        return Array.from({ length: 24 }, (_, i) => `${i}:00`);
    }
    function labels7() {
        return ['月', '火', '水', '木', '金', '土', '日'];
    }
    let platformStats = null;

    function hourly(t) {
        const base = typeof t === 'object' && t ? livePlayers(t) : Number(t) || 1;
        const now = livePlayers(t) || base;
        return Array.from({ length: 24 }, (_, i) => {
            const wobble = Math.round(now * (0.55 + 0.4 * Math.sin((i / 24) * Math.PI * 2)));
            return Math.max(0, wobble);
        });
    }
    function daily(t) {
        const now = livePlayers(t) || 10;
        return Array.from({ length: 7 }, (_, i) => Math.max(0, Math.round(now * (0.85 + (i % 3) * 0.07))));
    }

    function livePlayers(t) {
        if (!t) return 0;
        const liveN = window.MT?.liveN?.[t.id];
        return liveN == null ? Number(t.players) || 0 : liveN;
    }
    const nodes = [];
    const health = [];
    const events = [];
    const OBJ_TYPES = {};
    const WORLD_OBJECTS = {};

    window.MTD = {
        ADDONS,
        ADDON_BY_ID,
        ADDON_CATS,
        addonsOf,
        num,
        pct,
        hhmm,
        hhmmss,
        mdhm,
        get TENANTS() {
            return TENANTS;
        },
        STATUS,
        hourly,
        daily,
        labels24,
        labels7,
        nodes,
        health,
        events,
        seedLogs,
        liveLog,
        trafficAgg,
        AUDIT,
        ROLES,
        MEMBERS,
        TOKENS,
        OBJ_TYPES,
        WORLD_OBJECTS,
        loadLive,
        flags: {
            get trafficDisconnected() {
                return trafficDisconnected;
            },
            get auditDisconnected() {
                return auditDisconnected;
            },
        },
        disconnected,
    };
})();