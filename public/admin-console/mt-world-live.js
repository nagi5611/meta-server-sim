/* mt-world-live.js — worlds.json ↔ mt-editor 状態（本番 API） */
(function () {
    'use strict';

    let settingBootPromise = null;

  /** setting.js 向け admin API / R2 / VDB shims を一度だけ初期化する */
    async function ensureSettingModules(tenantId) {
        if (window.__MT_SETTING_LIVE__) return window.__MT_SETTING_LIVE__;
        if (!settingBootPromise) {
            settingBootPromise = (async () => {
                const { bootstrapAdminApi } = await import('/js/admin-api-fetch-init.js');
                await bootstrapAdminApi();
                const { installTenantR2FetchShim, installTenantR2UploadShim } = await import(
                    '/js/tenant-r2-upload-shim.js'
                );
                const { installTenantWorldEditXhrShim } = await import('/js/tenant-world-edit-xhr.js');
                installTenantR2FetchShim();
                installTenantR2UploadShim();
                installTenantWorldEditXhrShim();
                try {
                    const { installTenantWorldEditVdbShim } = await import('/js/tenant-world-edit-vdb-shim.js');
                    await installTenantWorldEditVdbShim(tenantId);
                } catch (vdbErr) {
                    console.warn('[mt-world-live] VDB shim skipped (mt-editor mode)', vdbErr);
                }
                const svc = { tenantId, ready: true };
                window.__MT_SETTING_LIVE__ = svc;
                return svc;
            })().catch((e) => {
                console.error('[mt-world-live] setting shims boot failed', e);
                settingBootPromise = null;
                return null;
            });
        }
        return settingBootPromise;
    }

    window.MTSettingLive = { ensureSettingModules };

    const MOCK_PHRASES = ['街灯 01', '中央ステージ', '案内アバター', '夜のネオン商店街', 'AKARI City'];

    function vec3ToArr(v, d) {
        if (!v || typeof v !== 'object') return d || [0, 0, 0];
        return [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0];
    }

    function arrToVec3(a) {
        const x = Array.isArray(a) ? a : [0, 0, 0];
        return { x: x[0] || 0, y: x[1] || 0, z: x[2] || 0 };
    }

    function scaleToArr(s) {
        if (typeof s === 'number') return [s, s, s];
        if (!s || typeof s !== 'object') return [1, 1, 1];
        return [Number(s.x) || 1, Number(s.y) || 1, Number(s.z) || 1];
    }

    function scaleToWorld(s) {
        const a = scaleToArr(s);
        if (a[0] === a[1] && a[1] === a[2]) return a[0];
        return { x: a[0], y: a[1], z: a[2] };
    }

    const DEG2RAD = Math.PI / 180;
    const RAD2DEG = 180 / Math.PI;

    /** worlds.json の回転（度）→ エディタ（ラジアン） */
    function rotWorldToEditor(rot) {
        return vec3ToArr(rot).map((v) => (Number(v) || 0) * DEG2RAD);
    }

    /** エディタ（ラジアン）→ worlds.json（度） */
    function rotEditorToWorld(rot) {
        const a = Array.isArray(rot) ? rot : [0, 0, 0];
        return {
            x: (Number(a[0]) || 0) * RAD2DEG,
            y: (Number(a[1]) || 0) * RAD2DEG,
            z: (Number(a[2]) || 0) * RAD2DEG,
        };
    }

    function modelBaseName(path) {
        const base = String(path || '').split('/').pop() || 'model';
        return base.replace(/\.[^.]+$/, '');
    }

    function hexLightColor(c) {
        if (typeof c === 'string' && c.startsWith('#')) return c;
        const n = Number(c);
        if (!Number.isFinite(n)) return '#ffffff';
        return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
    }

    function hasMockData(ed) {
        if (!ed) return false;
        const text = [
            ed.settings?.desc,
            ed.worldName,
            ...(ed.objects || []).map((o) => o.name),
            ...(ed.history || []).map((h) => h.msg),
        ]
            .filter(Boolean)
            .join('\u0000');
        return MOCK_PHRASES.some((p) => text.includes(p));
    }

    async function fetchJson(url) {
        const liveFetch = window.__nativeAdminFetch || window.fetch;
        const res = await liveFetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
        return res.json();
    }

    async function fetchCsrf() {
        const j = await fetchJson('/admin/csrf-token');
        return j.token || '';
    }

    /**
     * @param {string} tenantId
     * @returns {Promise<Record<string, unknown>>}
     */
    async function fetchAllWorlds(tenantId) {
        return fetchJson(`/admin/tenants/${encodeURIComponent(tenantId)}/worlds`);
    }

    /**
     * worlds.json の1ワールド → エディタ objects[]
     * @param {string} tenantId
     * @param {string} worldId
     * @param {Record<string, unknown>} w
     */
    function worldDocToObjects(tenantId, worldId, w) {
        const objects = [];
        let n = 0;
        const mkId = (pfx) => `${pfx}-${tenantId}-${worldId}-${++n}`;

        if (w.spawnPoint) {
            objects.push({
                id: mkId('spawn'),
                type: 'spawn',
                name: 'スポーン',
                pos: vec3ToArr(w.spawnPoint, [0, 1, 5]),
                rot: [0, 0, 0],
                scale: [1, 1, 1],
                visible: true,
                props: { yaw: 0 },
                options: {},
                _src: 'spawnPoint',
            });
        }

        (w.models || []).forEach((m, idx) => {
            const path = String(m.path || '');
            const name = modelBaseName(path) || `model-${idx + 1}`;
            const pos = vec3ToArr(m.position);
            const rot = rotWorldToEditor(m.rotation);
            const scale = scaleToArr(m.scale);
            let type = 'model';
            const props = {
                modelPath: path,
                modelUrl: path ? `/${encodeURIComponent(tenantId)}/${path.replace(/^\//, '')}` : '',
            };
            const options = {};
            if (m.aircraft) {
                type = 'plane';
                props.aircraft = m.aircraft;
                props.speed = w.aircraftPhysics?.maxThrustSpeed || 12;
            }
            if (m.teleporter) {
                options.teleporter = {
                    on: true,
                    to: m.teleporter.destinationWorld || '',
                    radius: m.teleporter.radius ?? 2,
                    mode: m.teleporter.autoTeleport ? 'auto' : 'manual',
                    prompt: true,
                    key: 'E',
                };
            }
            if (m.animate) props.animate = m.animate;
            objects.push({
                id: mkId('mdl'),
                type,
                name,
                pos,
                rot,
                scale,
                visible: true,
                props,
                options,
                _src: 'models',
                _modelIndex: idx,
                _raw: m,
            });
        });

        (w.lights || []).forEach((L, idx) => {
            if (L.type === 'ambient' || L.type === 'directional') return;
            objects.push({
                id: mkId('lt'),
                type: 'light',
                name: L.type === 'point' ? `ライト ${idx + 1}` : String(L.type || 'light'),
                pos: vec3ToArr(L.position, [0, 2, 0]),
                rot: [0, 0, 0],
                scale: [1, 1, 1],
                visible: true,
                props: {
                    color: hexLightColor(L.color),
                    intensity: L.intensity ?? 1,
                    distance: L.distance ?? 8,
                },
                options: {},
                _src: 'lights',
                _lightIndex: idx,
                _raw: L,
            });
        });

        (w.flightBoards || w.flightboards || []).forEach((fb, idx) => {
            objects.push({
                id: mkId('fb'),
                type: 'board',
                name: fb.id || `発着板 ${idx + 1}`,
                pos: vec3ToArr(fb.position),
                rot: rotWorldToEditor(fb.rotation),
                scale: scaleToArr(fb.scale),
                visible: true,
                props: { filter: fb.filter || 'all', rows: fb.rows || 7 },
                options: {},
                _src: 'flightBoards',
                _boardIndex: idx,
                _raw: fb,
            });
        });

        (w.pdfs || []).forEach((p, idx) => {
            objects.push({
                id: mkId('pdf'),
                type: 'pdf',
                name: p.path ? modelBaseName(p.path) : `PDF ${idx + 1}`,
                pos: vec3ToArr(p.position),
                rot: rotWorldToEditor(p.rotation),
                scale: scaleToArr(p.scale),
                visible: true,
                props: { file: p.path || '', pages: p.pages || 1, page: p.page || 1 },
                options: {},
                _src: 'pdfs',
                _pdfIndex: idx,
                _raw: p,
            });
        });

        (w.fdsSmoke || []).forEach((s, idx) => {
            objects.push({
                id: mkId('smk'),
                type: 'smoke',
                name: s.label || s.path || `煙 ${idx + 1}`,
                pos: vec3ToArr(s.position),
                rot: rotWorldToEditor(s.rotation),
                scale: scaleToArr(s.scale),
                visible: true,
                props: { file: s.path || s.file || '', density: s.density ?? 0.6, playing: false },
                options: {},
                _src: 'fdsSmoke',
                _fdsIndex: idx,
                _raw: s,
            });
        });

        (w.vdbs || []).forEach((v, idx) => {
            objects.push({
                id: mkId('vdb'),
                type: 'cloud',
                name: v.path ? modelBaseName(v.path) : `雲 ${idx + 1}`,
                pos: vec3ToArr(v.position),
                rot: rotWorldToEditor(v.rotation),
                scale: scaleToArr(v.scale),
                visible: true,
                props: { file: v.path || '', density: v.density ?? 0.45, tint: '#ffffff', scale: 1 },
                options: {},
                _src: 'vdbs',
                _vdbIndex: idx,
                _raw: v,
            });
        });

        return objects;
    }

  function worldDocToSettings(w) {
        return {
            desc: String(w.description || w.desc || '').trim(),
            viewDistance: w.viewDistanceM ?? w.viewDistance ?? 60,
            quality: w.quality || 'mid',
            cap: w.playerCap ?? w.cap ?? 320,
            sky: w.skyColor ? hexLightColor(w.skyColor) : w.sky || '#eef0f4',
            ambient: w.ambientSound || w.ambient || 'none',
            spawnPoint: w.spawnPoint || null,
            lightsWorld: (w.lights || []).filter((l) => l.type === 'ambient' || l.type === 'directional'),
        };
    }

    function listFilesFromWorlds(worldsRoot) {
        const files = [];
        let fi = 0;
        Object.values(worldsRoot || {}).forEach((w) => {
            (w.models || []).forEach((m) => {
                if (!m.path) return;
                const kind = (m.path.split('.').pop() || 'glb').toLowerCase();
                files.push({
                    id: `live-f${++fi}`,
                    path: ['models'],
                    name: m.path.split('/').pop(),
                    kind,
                    size: 0,
                    date: '—',
                    asset: null,
                });
            });
        });
        return files;
    }

    /**
     * @param {Record<string, unknown>} ed
     * @param {Record<string, unknown>} worldsRoot
     * @param {string} worldId
     */
    function editorToWorldDoc(ed, worldsRoot, worldId) {
        const base = JSON.parse(JSON.stringify(worldsRoot[worldId] || { id: worldId }));
        base.id = worldId;
        base.name = ed.worldName || base.name || worldId;
        base.description = ed.settings?.desc ?? base.description ?? '';
        if (ed.settings?.viewDistance != null) base.viewDistanceM = ed.settings.viewDistance;

        const models = [];
        const lights = [...(base.lights || []).filter((l) => l.type === 'ambient' || l.type === 'directional')];
        const flightBoards = [];
        const pdfs = [];
        const fdsSmoke = [];
        const vdbs = [];

        (ed.objects || []).forEach((o) => {
            if (o._raw && o._src === 'models') {
                const m = JSON.parse(JSON.stringify(o._raw));
                m.position = { x: o.pos[0], y: o.pos[1], z: o.pos[2] };
                m.rotation = rotEditorToWorld(o.rot);
                m.scale = scaleToWorld(o.scale);
                if (o._modelIndex != null) m._idx = o._modelIndex;
                models.push(m);
                return;
            }
            if (o.type === 'spawn' && o._src === 'spawnPoint') {
                base.spawnPoint = { x: o.pos[0], y: o.pos[1], z: o.pos[2] };
                return;
            }
            if (o.type === 'model' || o.type === 'plane') {
                const path = o.props?.modelPath || o.props?.file || o._raw?.path;
                if (!path) return;
                const entry = {
                    path,
                    position: { x: o.pos[0], y: o.pos[1], z: o.pos[2] },
                    rotation: rotEditorToWorld(o.rot),
                    scale: scaleToWorld(o.scale),
                };
                if (o.options?.teleporter?.on) {
                    entry.teleporter = {
                        destinationWorld: o.options.teleporter.to,
                        radius: o.options.teleporter.radius,
                        autoTeleport: o.options.teleporter.mode === 'auto',
                    };
                }
                if (o.props?.animate) entry.animate = o.props.animate;
                if (o.type === 'plane' && o.props?.id) entry.aircraft = { ...o.props };
                models.push(entry);
                return;
            }
            if (o.type === 'light' && o._src === 'lights') {
                lights.push({
                    type: 'point',
                    intensity: o.props?.intensity ?? 1,
                    color: parseInt(String(o.props?.color || '#ffffff').replace('#', ''), 16) || 0xffffff,
                    distance: o.props?.distance ?? 8,
                    position: { x: o.pos[0], y: o.pos[1], z: o.pos[2] },
                });
            }
            if (o.type === 'board') {
                flightBoards.push({
                    id: o.name,
                    filter: o.props?.filter || 'all',
                    position: { x: o.pos[0], y: o.pos[1], z: o.pos[2] },
                    rotation: rotEditorToWorld(o.rot),
                    scale: scaleToWorld(o.scale),
                });
            }
            if (o.type === 'pdf' && o._src === 'pdfs') {
                pdfs.push({
                    path: o.props?.file || o._raw?.path || '',
                    position: { x: o.pos[0], y: o.pos[1], z: o.pos[2] },
                    rotation: rotEditorToWorld(o.rot),
                    scale: scaleToWorld(o.scale),
                });
            }
            if (o.type === 'smoke' && o._src === 'fdsSmoke') {
                fdsSmoke.push({
                    ...(o._raw || {}),
                    path: o.props?.file || o._raw?.path || o._raw?.manifest || '',
                    position: { x: o.pos[0], y: o.pos[1], z: o.pos[2] },
                    rotation: rotEditorToWorld(o.rot),
                    scale: scaleToWorld(o.scale)[0] ?? scaleToWorld(o.scale),
                });
            }
            if (o.type === 'cloud' && o._src === 'vdbs') {
                vdbs.push({
                    path: o.props?.file || o._raw?.path || '',
                    position: { x: o.pos[0], y: o.pos[1], z: o.pos[2] },
                    rotation: rotEditorToWorld(o.rot),
                    scale: scaleToWorld(o.scale),
                    density: o.props?.density ?? o._raw?.density,
                });
            }
        });

        base.models = models.sort((a, b) => (a._idx ?? 0) - (b._idx ?? 0)).map((m) => {
            const c = { ...m };
            delete c._idx;
            return c;
        });
        base.lights = lights;
        base.flightBoards = flightBoards.length ? flightBoards : base.flightBoards;
        base.pdfs = pdfs.length ? pdfs : base.pdfs;
        base.fdsSmoke = fdsSmoke.length ? fdsSmoke : base.fdsSmoke;
        base.vdbs = vdbs.length ? vdbs : base.vdbs;
        return base;
    }

    async function saveWorldsToApi(st, publish) {
        const ed = st.ed;
        if (!ed?._worldsRoot || !ed.worldId) throw new Error('worlds snapshot missing');
        const worlds = JSON.parse(JSON.stringify(ed._worldsRoot));
        worlds[ed.worldId] = editorToWorldDoc(ed, worlds, ed.worldId);
        const token = await fetchCsrf();
        const liveFetch = window.__nativeAdminFetch || window.fetch;
        const res = await liveFetch(`/admin/tenants/${encodeURIComponent(st.tenant)}/worlds`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-CSRF': token,
            },
            body: JSON.stringify(worlds),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            if (res.status === 409) {
                throw new Error(`save_conflict: ${text.slice(0, 200)}`);
            }
            throw new Error(`save failed ${res.status} ${text.slice(0, 200)}`);
        }
        ed._worldsRoot = worlds;
        ed.dirty = false;
        const t = window.MTD.TENANTS.find((x) => x.id === st.tenant);
        if (t) {
            const w = t.worlds.find((x) => x.id === ed.worldId);
            if (w) w.name = ed.worldName;
        }
        if (window.MT?.toast) {
            window.MT.toast(publish ? '公開しました' : '保存しました');
        }
        return worlds;
    }

    /**
     * 本番 initEd 置換
     * @param {object} st
     */
    function initEdLive(st) {
        const D = window.MTD;
        const t = D.TENANTS.find((x) => x.id === st.tenant) || D.TENANTS[0];
        const wid = st.worldId || t?.worlds?.[0]?.id;
        const wMeta = t?.worlds?.find((x) => x.id === wid);
        const ed = {
            worlds: t?.worlds || [],
            worldId: wid,
            worldName: wMeta?.name || wid || '',
            objects: [],
            settings: {
                desc: '',
                viewDistance: 60,
                quality: 'mid',
                cap: 320,
                sky: '#eef0f4',
                ambient: 'none',
            },
            selected: [],
            selKind: 'world',
            mode: 'translate',
            snapOn: true,
            snap: 0.5,
            theme: 'light',
            panels: { props: true },
            sec: { tf: true, vis: true, own: true, meta: false, world: true, lod: true, env: true, limit: false },
            split: 46,
            collapsed: {},
            q: '',
            files: [],
            explorer: { open: false, path: [], q: '', view: 'list', sel: null },
            ctx: null,
            preview: null,
            uploads: [],
            dirty: false,
            undo: [],
            redo: [],
            dialog: null,
            json: '',
            jsonErr: '',
            history: [],
            loading: { label: 'ワールドを読み込み中', pct: 0 },
            _live: true,
            _worldsRoot: null,
        };
        if (window.innerWidth < 900) ed.panels.props = false;
        st.ed = ed;

        void hydrateFromApi(st).catch((err) => {
            console.error('[mt-world-live] hydrate failed', err);
            if (window.MT?.toast) window.MT.toast('ワールドデータの読み込みに失敗しました');
            ed.loading = null;
            window.MT?.render?.();
        });

        return ed;
    }

    async function hydrateFromApi(st) {
        const ed = st.ed;
        const worldsRoot = await fetchAllWorlds(st.tenant);
        const wid = ed.worldId;
        const wdoc = worldsRoot[wid];
        if (!wdoc) throw new Error(`world ${wid} missing`);
        ed._worldsRoot = worldsRoot;
        ed.worldName = wdoc.name || ed.worldName;
        ed.objects = worldDocToObjects(st.tenant, wid, wdoc);
        ed.settings = worldDocToSettings(wdoc);
        ed.files = listFilesFromWorlds(worldsRoot);
        ed.loading = null;
        ed.dirty = false;
        void ensureSettingModules(st.tenant);
        window.MT?.render?.();
        requestAnimationFrame(() => {
            if (!window.ME?.isMounted) window.MTA?.mountScene?.(st);
            else {
                window.ME.unmount();
                window.MTA?.mountScene?.(st);
            }
            window.MTA?.bindDropzones?.();
            window.MTA?.bindSplitter?.();
            window.MTA?.bindOutlinerWheel?.();
            if (window.ME?.fitSettingEditorCamera) window.ME.fitSettingEditorCamera();
            else if (window.ME?.fitScene) window.ME.fitScene();
        });
    }

    function dismissCanvasLoading() {
        document.querySelectorAll('[data-loading]').forEach((el) => {
            el.classList.remove('on');
            el.setAttribute('hidden', '');
        });
        const bar = document.querySelector('[data-loadbar]');
        if (bar) bar.remove();
    }

    function install() {
        if (!window.MTA || !window.MTD) return;
        const protoInit = window.MTA.initEd;
        window.MTA.initEd = initEdLive;
        window.MTA._protoInitEd = protoInit;

        const protoMount = window.MTA.mountScene;
        window.MTA.mountScene = function mountSceneLive(st) {
            const ed = st?.ed;
            if (ed?._live && (!ed._worldsRoot || ed.loading)) {
                return;
            }
            if (ed?._live && window.ME?.isMounted) {
                const sig = `${st.tenant}/${ed.worldId}`;
                if (window.MTA._mounted !== sig) {
                    window.ME.unmount();
                    window.MTA._mounted = null;
                }
            }
            protoMount(st);
            dismissCanvasLoading();
            requestAnimationFrame(() => {
                if (window.ME?.fitSettingEditorCamera) window.ME.fitSettingEditorCamera();
                else if (window.ME?.fitScene) window.ME.fitScene();
            });
        };

        const protoSave = window.MTA.saveDraft;
        window.MTA.saveDraft = function saveDraftLive(st, publish) {
            if (!st?.ed?._live) return protoSave(st, publish);
            return saveWorldsToApi(st, publish)
                .then(() => {
                    window.MTA.paintStatus?.();
                })
                    .catch((err) => {
                        console.error('[mt-world-live] save failed', err);
                        if (st.ed) st.ed.dirty = true;
                        window.MTA.paintStatus?.();
                        const msg = String(err?.message || '');
                        if (msg.startsWith('save_conflict:')) {
                            window.MT?.toast?.('他の管理者が先に保存しました。ページを再読み込みしてください。');
                        } else {
                            window.MT?.toast?.('保存に失敗しました');
                        }
                    });
        };

        document.addEventListener(
            'click',
            (e) => {
                const btn = e.target.closest('[data-ed-act="draft"], [data-ed-act="publish"]');
                if (!btn) return;
                const st = window.MT?.state;
                if (!st?.ed?._live) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                const publish = btn.getAttribute('data-ed-act') === 'publish';
                void saveWorldsToApi(st, publish)
                    .then(() => {
                        window.MTA.paintStatus?.();
                        const now = new Date();
                        const at = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                        st.ed.history.unshift({
                            at,
                            who: 'admin',
                            msg: publish ? '公開' : '下書きを保存',
                            published: !!publish,
                        });
                        window.MT?.toast?.(publish ? '公開しました' : '下書きを保存しました');
                    })
                .catch((err) => {
                    console.error('[mt-world-live] save click failed', err);
                    if (st.ed) st.ed.dirty = true;
                    window.MTA.paintStatus?.();
                    const msg = String(err?.message || '');
                    if (msg.startsWith('save_conflict:')) {
                        window.MT?.toast?.('他の管理者が先に保存しました。ページを再読み込みしてください。');
                    } else {
                        window.MT?.toast?.('保存に失敗しました');
                    }
                });
            },
            true
        );

        window.MTWL = {
            fetchAllWorlds,
            listFilesFromWorlds,
            worldDocToObjects,
            worldDocToSettings,
            editorToWorldDoc,
            hasMockData,
            expectedObjectCount(wdoc) {
                return worldDocToObjects('x', 'y', wdoc || {}).length;
            },
            MOCK_PHRASES,
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install);
    } else {
        install();
    }
})();