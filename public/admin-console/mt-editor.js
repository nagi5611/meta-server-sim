/* ワールドエディタ — Three.js シーン管理 */
(function () {
  "use strict";
  const T3 = window.THREE;
  if (!T3) { console.error("THREE not loaded"); return; }

  /* ================= 型定義 ================= */
  const TYPES = {
    model: { label: "3Dモデル", size: [1.2, 1.2, 1.2], color: "#9aa7b8", props: {} },
    prop: { label: "小物", size: [0.9, 0.7, 0.9], color: "#b3bdca", props: { solid: true } },
    light: { label: "ライト", size: [0.4, 0.4, 0.4], color: "#f3c98b", props: { color: "#ffd9a0", intensity: 1.4, distance: 8 } },
    spawn: { label: "スポーン", size: [1.4, 0.1, 1.4], color: "#101624", props: { yaw: 0 } },
    animate: { label: "アニメーション", size: [1.3, 1.6, 1.3], color: "#8f7bb8", props: { clip: "idle", speed: 1 } },
    board: { label: "発着案内板", size: [2.6, 1.5, 0.16], color: "#1a2430", props: { filter: "all", rows: 7 } },
    pdf: { label: "PDF", size: [1.6, 2.1, 0.06], color: "#f7f8fa", props: { file: "案内図.pdf", pages: 4, page: 1 } },
    smoke: { label: "煙 (FDS)", size: [1.6, 2.2, 1.6], color: "#8d97a5", props: { file: "smoke_test.zip", density: 0.6, playing: false } },
    cloud: { label: "雲 (VDB)", size: [2.4, 1.4, 2.4], color: "#dfe6ef", props: { density: 0.45, tint: "#ffffff", scale: 1 } },
    plane: { label: "機体", size: [2.2, 0.5, 2.6], color: "#c9d3df", props: { speed: 12, turn: 0.6, mass: 1.4, tags: ["standard"], test: false } }
  };

  /* ================= テクスチャ ================= */
  function boardTexture(filter) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 288;
    const g = c.getContext("2d");
    g.fillStyle = "#131c26"; g.fillRect(0, 0, 512, 288);
    g.fillStyle = "#2a3a4a"; g.fillRect(0, 0, 512, 42);
    g.fillStyle = "#e8eef6"; g.font = "600 17px sans-serif";
    g.fillText("DEPARTURES", 16, 27);
    g.fillStyle = "#7f93a8"; g.font = "12px sans-serif";
    g.fillText(filter === "all" ? "全便" : filter === "domestic" ? "国内線" : "国際線", 148, 27);
    const rows = filter === "all"
      ? [["08:40", "MYJ 01", "松山", "定刻"], ["08:55", "MYJ 02", "今治", "定刻"], ["09:10", "HND 14", "東京", "搭乗中"], ["09:35", "ITM 07", "大阪", "定刻"], ["10:05", "MYJ 03", "宇和島", "遅延"]]
      : filter === "domestic"
        ? [["08:40", "MYJ 01", "松山", "定刻"], ["08:55", "MYJ 02", "今治", "定刻"], ["09:35", "ITM 07", "大阪", "定刻"]]
        : [["09:10", "HND 14", "東京", "搭乗中"], ["11:20", "ICN 02", "ソウル", "定刻"], ["13:45", "TPE 05", "台北", "定刻"]];
    rows.forEach((r, i) => {
      const y = 68 + i * 42;
      g.fillStyle = i % 2 ? "#161f2a" : "#1a2531";
      g.fillRect(10, y - 20, 492, 34);
      g.fillStyle = "#f38020"; g.font = "600 14px monospace"; g.fillText(r[0], 22, y + 3);
      g.fillStyle = "#d4deea"; g.font = "14px monospace"; g.fillText(r[1], 96, y + 3);
      g.fillStyle = "#9db0c3"; g.fillText(r[2], 210, y + 3);
      g.fillStyle = r[3] === "遅延" ? "#e5a13d" : r[3] === "搭乗中" ? "#4fb477" : "#8fa4b8";
      g.fillText(r[3], 400, y + 3);
    });
    const t = new T3.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  function pdfTexture(title, page) {
    const c = document.createElement("canvas");
    c.width = 340; c.height = 440;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, 340, 440);
    g.fillStyle = "#101624"; g.font = "600 17px sans-serif";
    g.fillText(title, 28, 50);
    g.strokeStyle = "#e2e5ea"; g.beginPath(); g.moveTo(28, 66); g.lineTo(312, 66); g.stroke();
    g.fillStyle = "#5e6778"; g.font = "11px sans-serif";
    for (let i = 0; i < 16; i++) {
      const w = 150 + ((i * 37) % 130);
      g.fillRect(28, 88 + i * 17, w, 4);
    }
    g.fillStyle = "#dfe3e9";
    g.fillRect(28, 380, 284, 30);
    g.fillStyle = "#8a92a1"; g.font = "10px monospace";
    g.fillText(`page ${page}`, 28, 428);
    const t = new T3.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  /* ================= シーン ================= */
  const M = {
    state: null, scene: null, camera: null, renderer: null, raycaster: null,
    orbit: null, tc: null, objs: new Map(), frames: [], raf: 0,
    selected: [], hovered: null, container: null, clock: null,
    helpers: new Map(), listeners: {}, dragStart: null
  };

  const EV = {
    on(k, f) { (M.listeners[k] = M.listeners[k] || []).push(f); },
    emit(k, d) { (M.listeners[k] || []).forEach((f) => f(d)); }
  };

  const COL = {
    light: { bg: 0xe8eaee, ground: 0xdfe3e9, grid1: 0xb2bcc9, grid2: 0xd0d6df, fog: 0xe8eaee },
    dark: { bg: 0x22252b, ground: 0x2b2f36, grid1: 0x4a525e, grid2: 0x353a42, fog: 0x22252b }
  };

  /* ---------- マテリアル ---------- */
  function mat(color, opt) {
    return new T3.MeshStandardMaterial(Object.assign({
      color: new T3.Color(color), roughness: 0.72, metalness: 0.04
    }, opt || {}));
  }

  /* ---------- オブジェクト生成 ---------- */
  function build(o) {
    const t = TYPES[o.type] || TYPES.prop;
    const g = new T3.Group();
    g.userData.id = o.id;
    const size = t.size;
    const p = o.props || {};

    const addMesh = (geo, material, y) => {
      const m = new T3.Mesh(geo, material);
      m.castShadow = true; m.receiveShadow = true;
      if (y != null) m.position.y = y;
      g.add(m);
      return m;
    };

    if (o.type === "light") {
      const b = addMesh(new T3.SphereGeometry(0.16, 16, 12), mat(p.color || "#ffd9a0", { emissive: new T3.Color(p.color || "#ffd9a0"), emissiveIntensity: 1.1 }), 0);
      const l = new T3.PointLight(new T3.Color(p.color || "#ffd9a0"), p.intensity == null ? 1.2 : p.intensity, p.distance || 8);
      l.position.y = 0;
      g.add(l);
      g.userData.light = l;
      // 光の輪
      const ring = new T3.Mesh(new T3.RingGeometry(0.34, 0.4, 24), new T3.MeshBasicMaterial({ color: 0xf6cf96, transparent: true, opacity: 0.5, side: T3.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = -0.02;
      g.add(ring);
    } else if (o.type === "spawn") {
      const ring = new T3.Mesh(new T3.RingGeometry(0.62, 0.74, 36), new T3.MeshBasicMaterial({ color: 0x101624, transparent: true, opacity: 0.55, side: T3.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
      g.add(ring);
      const arrow = new T3.Mesh(new T3.ConeGeometry(0.16, 0.44, 4), mat("#101624"));
      arrow.rotation.x = Math.PI / 2; arrow.position.set(0, 0.06, -0.5);
      g.add(arrow);
      g.userData.spawnArrow = arrow;
    } else if (o.type === "animate") {
      const body = addMesh(new T3.CylinderGeometry(0.3, 0.26, 1.1, 14), mat("#8f7bb8"), 0.75);
      const head = addMesh(new T3.SphereGeometry(0.26, 18, 14), mat("#a996cc"), 1.5);
      g.userData.animBody = body;
    } else if (o.type === "board") {
      const frame = addMesh(new T3.BoxGeometry(2.6, 1.58, 0.14), mat("#2a3644"), 0.9);
      const tex = boardTexture(p.filter || "all");
      const face = new T3.Mesh(new T3.PlaneGeometry(2.42, 1.36), new T3.MeshBasicMaterial({ map: tex }));
      face.position.set(0, 0.9, 0.076);
      g.add(face);
      g.userData.faceMat = face.material;
      const pole = addMesh(new T3.CylinderGeometry(0.05, 0.05, 0.9, 8), mat("#4a5764"), 0.1);
      pole.position.set(0, 0.45, -0.06);
    } else if (o.type === "pdf") {
      const tex = pdfTexture(p.file || "document.pdf", p.page || 1);
      const face = new T3.Mesh(new T3.PlaneGeometry(1.05, 1.36), new T3.MeshBasicMaterial({ map: tex, side: T3.DoubleSide }));
      face.position.y = 1.05; face.castShadow = true;
      g.add(face);
      g.userData.pdfFace = face;
      addMesh(new T3.BoxGeometry(1.12, 0.04, 0.06), mat("#c3ccd8"), 0.34);
    } else if (o.type === "smoke") {
      const group = new T3.Group();
      for (let i = 0; i < 7; i++) {
        const s = new T3.Mesh(new T3.SphereGeometry(0.28 + i * 0.03, 14, 10), new T3.MeshStandardMaterial({
          color: 0x9aa4b2, transparent: true, opacity: 0.24, roughness: 1, depthWrite: false
        }));
        s.position.set((Math.sin(i * 1.7) * 0.22), 0.3 + i * 0.26, Math.cos(i * 2.1) * 0.22);
        s.userData.seed = i;
        group.add(s);
      }
      g.add(group);
      g.userData.smoke = group;
    } else if (o.type === "cloud") {
      const group = new T3.Group();
      for (let i = 0; i < 6; i++) {
        const s = new T3.Mesh(new T3.SphereGeometry(0.42 + (i % 3) * 0.12, 14, 10), new T3.MeshStandardMaterial({
          color: new T3.Color(p.tint || "#ffffff"), transparent: true, opacity: 0.5, roughness: 1, depthWrite: false
        }));
        s.position.set(Math.sin(i * 2.3) * 0.42, 0.35 + (i % 2) * 0.1, Math.cos(i * 1.9) * 0.4);
        group.add(s);
      }
      group.scale.setScalar(p.scale || 1);
      g.add(group);
      g.userData.cloud = group;
    } else if (o.type === "plane") {
      const body = addMesh(new T3.CylinderGeometry(0.16, 0.16, 1.5, 12), mat("#e9eef5"), 0.45);
      body.rotation.x = Math.PI / 2;
      const wing = addMesh(new T3.BoxGeometry(2.1, 0.05, 0.42), mat("#d3dce7"), 0.45);
      const tail = addMesh(new T3.BoxGeometry(0.6, 0.05, 0.26), mat("#d3dce7"), 0.72);
      tail.position.z = -0.72;
      const fin = addMesh(new T3.BoxGeometry(0.05, 0.34, 0.28), mat("#d3dce7"), 0.62);
      fin.position.z = -0.74;
      g.userData.plane = body;
    } else if ((o.type === "model" || o.type === "plane") && p.modelUrl && window.THREE.GLTFLoader) {
      const ph = addMesh(new T3.BoxGeometry(0.35, 0.35, 0.35), mat("#c8d0dc", { transparent: true, opacity: 0.25 }), 0.2);
      ph.name = "__placeholder";
      g.userData._glbUrl = p.modelUrl;
      queueGltfLoad(g, o);
    } else {
      // model / prop（プレースホルダ）
      const b = addMesh(new T3.BoxGeometry(size[0], size[1], size[2]), mat(t.color), 0);
      b.position.y = size[1] / 2;
      const edge = new T3.LineSegments(new T3.EdgesGeometry(b.geometry), new T3.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }));
      b.add(edge);
      const top = addMesh(new T3.BoxGeometry(size[0] * 0.42, 0.08, size[2] * 0.42), mat("#ffffff", { opacity: 0.9, transparent: true }), 0);
      top.position.y = size[1] + 0.01;
    }

    g.position.fromArray(o.pos || [0, 0, 0]);
    const r = o.rot || [0, 0, 0];
    g.rotation.set(r[0], r[1], r[2]);
    const s = o.scale || [1, 1, 1];
    g.scale.set(s[0], s[1], s[2]);
    g.visible = o.visible !== false;
    g.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    applyOptions(g, o);
    return g;
  }

  const gltfPending = new Set();
  function queueGltfLoad(g, o) {
    const url = o.props && o.props.modelUrl;
    if (!url || !window.THREE.GLTFLoader) return;
    const pendingKey = o.id + "|" + url;
    if (gltfPending.has(pendingKey)) return;
    gltfPending.add(pendingKey);
    const loader = new T3.GLTFLoader();
    loader.load(
      url,
      (gl) => {
        gltfPending.delete(pendingKey);
        const root = gl.scene || gl.scenes?.[0];
        if (!root) return;
        const ph = g.children.find((c) => c.name === "__placeholder");
        if (ph) g.remove(ph);
        root.traverse((c) => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });
        g.add(root);
        g.userData.gltf = root;
        EV.emit("gltf-loaded", o.id);
        scheduleFitScene();
      },
      undefined,
      (err) => {
        gltfPending.delete(pendingKey);
        console.error("[mt-editor] GLTF load failed", url, err);
      }
    );
  }

  function fitScene() {
    if (!M.camera || !M.orbit || !M.scene) return;
    const box = new T3.Box3();
    let any = false;
    M.objs.forEach((obj) => {
      if (!obj.visible) return;
      box.expandByObject(obj);
      any = true;
    });
    if (!any || box.isEmpty()) {
      fitHome();
      return;
    }
    const center = box.getCenter(new T3.Vector3());
    const size = box.getSize(new T3.Vector3());
    const span = Math.max(size.x, size.y, size.z, 2);
    const dist = Math.min(180, Math.max(8, span * 1.85));
    M.orbit.target.copy(center);
    const elev = Math.PI / 5;
    const az = Math.PI / 4;
    M.camera.position.set(
      center.x + Math.cos(az) * dist,
      center.y + Math.sin(elev) * dist,
      center.z + Math.sin(az) * dist
    );
    M.camera.lookAt(center);
    M.orbit.update();
  }

  function rebuildScene(objects) {
    if (!M.scene) return;
    Array.from(M.objs.keys()).forEach((id) => {
      const g = M.objs.get(id);
      if (g) {
        M.scene.remove(g);
        disposeTree(g);
      }
      M.objs.delete(id);
      const h = M.helpers.get(id);
      if (h) {
        M.scene.remove(h);
        M.helpers.delete(id);
      }
    });
    M.frames.length = 0;
    (objects || []).forEach((o) => addToScene(o));
    M.state.objects = objects || [];
    scheduleFitScene();
  }

  /* ================= オプション（テレポーター / 太鼓） ================= */
  function applyOptions(g, o) {
    if (g.userData.optTp) { g.remove(g.userData.optTp); g.userData.optTp = null; }
    if (g.userData.optTaiko) { g.remove(g.userData.optTaiko); g.userData.optTaiko = null; }
    const op = o.options || {};

    if (op.teleporter && op.teleporter.on) {
      const tp = new T3.Group();
      const r = op.teleporter.radius || 2;
      // 半径リング（床）
      const ringGeo = new T3.RingGeometry(r - 0.06, r, 56);
      const ringMat = new T3.MeshBasicMaterial({ color: 0x5b7fd6, transparent: true, opacity: 0.55, side: T3.DoubleSide });
      const ring = new T3.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.015;
      tp.add(ring);
      // 内側の淡い面
      const disc = new T3.Mesh(new T3.CircleGeometry(r - 0.06, 48),
        new T3.MeshBasicMaterial({ color: 0x6d8fe0, transparent: true, opacity: 0.09, side: T3.DoubleSide }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.012;
      tp.add(disc);
      // 頭上マーカー
      const mark = new T3.Mesh(new T3.TorusGeometry(0.16, 0.035, 8, 20),
        new T3.MeshStandardMaterial({ color: 0x5b7fd6, emissive: new T3.Color(0x3355aa), emissiveIntensity: 0.6 }));
      mark.position.y = 1.55;
      tp.add(mark);
      g.add(tp);
      g.userData.optTp = tp;
    }

    if (op.taiko && op.taiko.on) {
      const tk = new T3.Group();
      const badge = new T3.Mesh(new T3.SphereGeometry(0.1, 14, 10),
        new T3.MeshStandardMaterial({ color: 0xb5763f, emissive: new T3.Color(0x6b4420), emissiveIntensity: 0.35 }));
      badge.position.y = 1.35;
      tk.add(badge);
      // 響きの輪
      const beat = new T3.Mesh(new T3.RingGeometry(0.13, 0.17, 24),
        new T3.MeshBasicMaterial({ color: 0xb5763f, transparent: true, opacity: 0.5, side: T3.DoubleSide }));
      beat.rotation.x = -Math.PI / 2;
      beat.position.y = 0.02;
      tk.add(beat);
      g.add(tk);
      g.userData.optTaiko = tk;
    }
  }

  /* ---------- ヘルパー ---------- */
  function helperFor(id) {
    if (M.helpers.has(id)) return M.helpers.get(id);
    const obj = M.objs.get(id);
    if (!obj) return null;
    const h = new T3.BoxHelper(obj, 0xf38020);
    h.material.depthTest = false;
    h.material.transparent = true;
    h.renderOrder = 10;
    M.scene.add(h);
    M.helpers.set(id, h);
    return h;
  }

  function refreshHelpers() {
    M.helpers.forEach((h, id) => {
      const o = M.objs.get(id);
      const on = M.selected.includes(id);
      const hov = M.hovered === id;
      if (!on && !hov) { h.visible = false; return; }
      h.visible = true;
      h.setFromObject(o);
      h.material.color.set(on ? 0xf38020 : 0x8a92a1);
      h.material.opacity = on ? 1 : 0.65;
    });
  }

  /* ---------- 初期化 ---------- */
  function mount(container, world) {
    unmount();
    M.container = container;
    M.state = world;
    const w = container.clientWidth || 640;
    const h = container.clientHeight || 480;

    M.scene = new T3.Scene();
    M.camera = new T3.PerspectiveCamera(38, w / h, 0.1, 300);
    M.camera.position.set(7.5, 7, 9);

    try {
      M.renderer = new T3.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch (err) {
      // コンテキストが枯渇している場合のフォールバック
      container.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;color:#8a92a1;font-size:12px;gap:6px;text-align:center">
        <div><b style="color:#1d2433">3D プレビューを表示できません</b><br>ページを再読み込みしてください</div></div>`;
      window.__ME_ERR = err.message;
      return null;
    }
    M.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    M.renderer.setSize(w, h);
    M.renderer.shadowMap.enabled = true;
    M.renderer.shadowMap.type = T3.PCFSoftShadowMap;
    if ("outputEncoding" in M.renderer) M.renderer.outputEncoding = T3.sRGBEncoding;
    container.appendChild(M.renderer.domElement);
    M.renderer.domElement.style.display = "block";
    M.renderer.domElement.style.outline = "none";

    M.orbit = new T3.OrbitControls(M.camera, M.renderer.domElement);
    M.orbit.enableDamping = true;
    M.orbit.dampingFactor = 0.08;
    M.orbit.maxPolarAngle = Math.PI * 0.495;
    M.orbit.minDistance = 2.2;
    M.orbit.maxDistance = 220;
    M.orbit.target.set(0, 0.6, 0);
    fitHome();

    M.tc = new (window.THREE.TransformControls)(M.camera, M.renderer.domElement);
    M.tc.setSize(0.82);
    M.scene.add(M.tc);
    M.tc.addEventListener("dragging-changed", (e) => {
      M.orbit.enabled = !e.value;
      if (e.value) { beginTransform(); EV.emit("transform-start"); }
      else endTransform();
    });
    M.tc.addEventListener("objectChange", onTransform);

    M.raycaster = new T3.Raycaster();
    M.clock = new T3.Clock();

    setTheme(world.theme || "light");
    applySettings(world.settings || {});
    (world.objects || []).forEach((o) => addToScene(o));
    scheduleFitScene();
    setMode("translate");
    setSnap(world.snapOn !== false, world.snap || 0.5);
    if (world.selected && world.selected.length) select(world.selected);

    const dom = M.renderer.domElement;
    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("pointermove", onPointerMove);

    M.resizeObs = new ResizeObserver(() => resize());
    M.resizeObs.observe(container);
    loop();
    return M;
  }

  function unmount() {
    cancelAnimationFrame(M.raf);
    if (M.resizeObs) { M.resizeObs.disconnect(); M.resizeObs = null; }
    if (M.renderer) {
      const d = M.renderer.domElement;
      d.removeEventListener("pointerdown", onPointerDown);
      d.removeEventListener("pointerup", onPointerUp);
      d.removeEventListener("pointermove", onPointerMove);
      try {
        M.renderer.dispose();
        if (M.renderer.forceContextLoss) M.renderer.forceContextLoss();
      } catch (e) {}
      if (d.parentNode) d.parentNode.removeChild(d);
    }
    if (M.tc) M.tc.dispose && M.tc.dispose();
    M.scene = null; M.camera = null; M.renderer = null; M.orbit = null; M.tc = null;
    M.objs = new Map(); M.helpers = new Map(); M.selected = []; M.hovered = null;
    M.frames = [];
  }

  function fitHome() {
    if (!M.camera || !M.renderer) return;
    const aspect = M.camera.aspect || 1.4;
    // 横長ほど寄り、縦長ほど引く（横方向の画角を一定に保つ）
    const dist = 22 / Math.min(1.5, Math.max(0.72, aspect));
    M.camera.position.set(dist * 0.5, dist * 0.62, dist * 0.72);
    M.orbit.target.set(0, 0.9, 0);
    M.orbit.update();
  }

  function resize() {
    if (!M.renderer || !M.container) return;
    const w = M.container.clientWidth, h = M.container.clientHeight;
    if (!w || !h) return;
    const first = !M.camera.aspect;
    M.camera.aspect = w / h;
    M.camera.updateProjectionMatrix();
    M.renderer.setSize(w, h);
    if (first) fitHome();
  }

  function loop() {
    M.raf = requestAnimationFrame(loop);
    if (!M.renderer) return;
    const dt = M.clock ? M.clock.getDelta() : 0.016;
    const t = performance.now() / 1000;
    M.orbit.update();
    M.frames.forEach((f) => f(t, dt));
    refreshHelpers();
    if (M.tc.axis || M.tc.dragging) M.tc.updateMatrixWorld();
    M.renderer.render(M.scene, M.camera);
  }

  /* ---------- 環境 ---------- */
  function setTheme(theme) {
    if (!M.scene) return;
    const c = COL[theme] || COL.light;
    M.scene.background = new T3.Color(c.bg);
    M.scene.fog = new T3.Fog(c.fog, 34, 74);
    // 既存の環境物を再構築
    if (M.env) { M.scene.remove(M.env); M.env = null; }
    const env = new T3.Group();
    const ground = new T3.Mesh(new T3.PlaneGeometry(60, 60), new T3.MeshStandardMaterial({ color: c.ground, roughness: 1, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    env.add(ground);

    const grid = new T3.GridHelper(24, 48, c.grid1, c.grid2);
    grid.position.y = 0.002;
    grid.material.transparent = true;
    grid.material.opacity = theme === "dark" ? 0.55 : 0.85;
    env.add(grid);
    M.grid = grid;

    const hemi = new T3.HemisphereLight(theme === "dark" ? 0x8c9fb8 : 0xffffff, theme === "dark" ? 0x24282e : 0xdfe3e9, theme === "dark" ? 0.55 : 0.95);
    env.add(hemi);
    const dir = new T3.DirectionalLight(0xffffff, theme === "dark" ? 1.1 : 1.5);
    dir.position.set(9, 15, 7);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    const d = 14;
    dir.shadow.camera.left = -d; dir.shadow.camera.right = d;
    dir.shadow.camera.top = d; dir.shadow.camera.bottom = -d;
    dir.shadow.camera.far = 50;
    dir.shadow.bias = -0.0012;
    env.add(dir);
    const fill = new T3.DirectionalLight(0xffffff, theme === "dark" ? 0.18 : 0.28);
    fill.position.set(-8, 6, -9);
    env.add(fill);

    M.scene.add(env);
    M.env = env;
  }

  function applySettings(s) {
    M.worldSettings = s;
    if (!M.scene) return;
    if (s.sky) {
      const col = new T3.Color(s.sky);
      M.scene.background = col;
      if (M.scene.fog) M.scene.fog.color.copy(col);
    }
  }

  let fitTimer = 0;
  function scheduleFitScene() {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => fitScene(), 150);
  }

  /* ---------- 選択 ---------- */
  function onPointerDown(e) {
    M.downAt = { x: e.clientX, y: e.clientY };
    M.downShift = e.shiftKey;
  }

  function onPointerUp(e) {
    if (!M.downAt) return;
    const moved = Math.hypot(e.clientX - M.downAt.x, e.clientY - M.downAt.y);
    M.downAt = null;
    if (moved > 4) return;
    if (M.tc.dragging || M.tc.axis) return;
    const rect = M.renderer.domElement.getBoundingClientRect();
    const mouse = new T3.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    M.raycaster.setFromCamera(mouse, M.camera);
    const targets = [];
    M.objs.forEach((o) => { if (o.visible) targets.push(o); });
    const hits = M.raycaster.intersectObjects(targets, true);
    let id = null;
    if (hits.length) {
      let node = hits[0].object;
      while (node && !node.userData.id) node = node.parent;
      if (node) id = node.userData.id;
    }
    if (!id) { select([]); return; }
    select([id], e.shiftKey);
  }

  let hoverRaf = 0;
  function onPointerMove(e) {
    if (!M.raycaster || M.downAt) return;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      if (!M.renderer) return;
      const rect = M.renderer.domElement.getBoundingClientRect();
      const mouse = new T3.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      M.raycaster.setFromCamera(mouse, M.camera);
      const targets = [];
      M.objs.forEach((o) => { if (o.visible) targets.push(o); });
      const hits = M.raycaster.intersectObjects(targets, true);
      let id = null;
      if (hits.length) {
        let node = hits[0].object;
        while (node && !node.userData.id) node = node.parent;
        if (node) id = node.userData.id;
      }
      if (id !== M.hovered) {
        M.hovered = id;
        M.renderer.domElement.style.cursor = id ? "pointer" : "default";
      }
    });
  }

  function select(ids, additive, silent) {
    let next = ids.slice();
    if (additive) {
      next = M.selected.slice();
      ids.forEach((id) => {
        const i = next.indexOf(id);
        if (i >= 0) next.splice(i, 1);
        else next.push(id);
      });
    }
    M.selected = next.filter((id) => M.objs.has(id));
    refreshHelpers();
    attachGizmo();
    if (!silent) EV.emit("select", M.selected.slice());
  }

  function attachGizmo() {
    if (!M.tc) return;
    if (!M.selected.length) { M.tc.detach(); return; }
    const primary = M.objs.get(M.selected[0]);
    if (primary) M.tc.attach(primary);
  }

  /* ---------- 変換 ---------- */
  function beginTransform() {
    M.dragStart = M.selected.map((id) => {
      const o = M.objs.get(id);
      return {
        id,
        pos: o.position.clone(),
        quat: o.quaternion.clone(),
        scl: o.scale.clone()
      };
    });
  }

  function onTransform() {
    const primaryId = M.selected[0];
    if (!primaryId || !M.dragStart) { EV.emit("transform", null); return; }
    const p0 = M.dragStart.find((d) => d.id === primaryId);
    const prim = M.objs.get(primaryId);
    if (!p0 || !prim) return;
    const dPos = prim.position.clone().sub(p0.pos);
    const dQuat = prim.quaternion.clone().multiply(p0.quat.clone().invert());
    const dScl = prim.scale.clone().divide(p0.scl);

    M.dragStart.forEach((d) => {
      if (d.id === primaryId) return;
      const o = M.objs.get(d.id);
      if (!o) return;
      o.position.copy(d.pos).add(dPos);
      o.quaternion.copy(dQuat).multiply(d.quat);
      o.scale.copy(d.scl).multiply(dScl);
    });
    EV.emit("transform", M.selected.slice());
  }

  function endTransform() {
    M.dragStart = null;
    syncFromScene();
    EV.emit("transform-end", M.selected.slice());
  }

  /* シーン → データ */
  function syncFromScene() {
    if (!M.state) return;
    M.state.objects.forEach((o) => {
      const g = M.objs.get(o.id);
      if (!g) return;
      o.pos = [r3(g.position.x), r3(g.position.y), r3(g.position.z)];
      o.rot = [r3(g.rotation.x), r3(g.rotation.y), r3(g.rotation.z)];
      o.scale = [r3(g.scale.x), r3(g.scale.y), r3(g.scale.z)];
    });
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;

  /* ---------- 公開API ---------- */
  function addToScene(o) {
    if (!M.scene) return;
    if (M.objs.has(o.id)) return;
    const g = build(o);
    M.scene.add(g);
    M.objs.set(o.id, g);
    if (o.type === "smoke" && o.props && o.props.playing) startSmoke(g, o);
    if (o.type === "plane" && o.props && o.props.test) startTestFlight(g, o);
    return g;
  }

  function startSmoke(g, o) {
    const group = g.userData.smoke;
    if (!group) return;
    const fn = (t) => {
      group.children.forEach((s, i) => {
        const k = ((t * 0.22 + s.userData.seed * 0.14) % 1);
        s.position.y = 0.16 + k * 2.2;
        s.material.opacity = (o.props.density || 0.6) * 0.5 * (1 - k) * (k < 0.1 ? k * 10 : 1);
        const sc = 0.7 + k * 1.5;
        s.scale.setScalar(sc);
      });
    };
    M.frames.push(fn);
    g.userData.frame = fn;
  }

  function startTestFlight(g, o) {
    const speed = (o.props && o.props.speed) || 12;
    const radius = 3.2;
    g.userData.flightT = 0;
    const fn = (t, dt) => {
      const p = o.props || {};
      g.userData.flightT += dt * ((p.speed || 12) / radius) * 0.16;
      const a = g.userData.flightT;
      g.position.x = Math.cos(a) * radius;
      g.position.z = Math.sin(a) * radius;
      g.position.y = 1.6 + Math.sin(a * 2) * 0.18;
      g.rotation.y = -a + Math.PI / 2;
      g.rotation.z = Math.sin(a) * 0.16 * (p.turn || 0.6);
    };
    M.frames.push(fn);
    g.userData.frame = fn;
  }

  function setMode(m) {
    if (!M.tc) return;
    M.tc.setMode(m);
    if (M.state) M.state.mode = m;
    if (m === "scale") M.tc.setSpace("local");
    else M.tc.setSpace("world");
    EV.emit("mode", m);
  }

  function setSnap(on, step) {
    if (!M.tc) return;
    if (M.state) { M.state.snapOn = on; M.state.snap = step; }
    M.tc.setTranslationSnap(on ? step : null);
    M.tc.setRotationSnap(on ? Math.PI / 12 : null);
    M.tc.setScaleSnap(on ? 0.1 : null);
    if (M.grid) M.grid.material.opacity = on ? 0.9 : 0.35;
    EV.emit("snap", { on, step });
  }

  function setView(kind) {
    if (!M.camera) return;
    const targets = M.selected.length ? M.selected.map((id) => M.objs.get(id)).filter(Boolean) : null;
    if (kind === "top") {
      M.camera.position.set(0.01, 17, 0.01);
      M.orbit.target.set(0, 0, 0);
    } else if (kind === "front") {
      M.camera.position.set(0, 4.2, 15);
      M.orbit.target.set(0, 1.2, 0);
    } else if (kind === "side") {
      M.camera.position.set(15, 4.2, 0);
      M.orbit.target.set(0, 1.2, 0);
    } else {
      fitHome();
    }
    M.orbit.update();
  }

  function focus() {
    if (!M.camera) return;
    const list = (M.selected.length ? M.selected : Array.from(M.objs.keys()))
      .map((id) => M.objs.get(id)).filter(Boolean);
    if (!list.length) return;
    const box = new T3.Box3();
    list.forEach((o) => box.expandByObject(o));
    const center = box.getCenter(new T3.Vector3());
    const size = box.getSize(new T3.Vector3()).length();
    const dist = Math.max(3, size * 1.5);
    const dir = M.camera.position.clone().sub(M.orbit.target).normalize();
    M.orbit.target.copy(center);
    M.camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    M.orbit.update();
  }

  function addObject(o) {
    if (!M.state) return;
    M.state.objects.push(o);
    addToScene(o);
    select([o.id]);
    EV.emit("objects-change");
  }

  function removeObject(id) {
    if (!M.state) return;
    const i = M.state.objects.findIndex((x) => x.id === id);
    if (i < 0) return;
    M.state.objects.splice(i, 1);
    const g = M.objs.get(id);
    if (g) { M.scene.remove(g); disposeTree(g); M.objs.delete(id); }
    const h = M.helpers.get(id);
    if (h) { M.scene.remove(h); M.helpers.delete(id); }
    M.selected = M.selected.filter((x) => x !== id);
    attachGizmo();
    EV.emit("objects-change");
    EV.emit("select", M.selected.slice());
  }

  function disposeTree(g) {
    g.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
        else { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }
      }
    });
  }

  function updateObject(o) {
    const g = M.objs.get(o.id);
    if (!g) return;
    g.position.fromArray(o.pos || [0, 0, 0]);
    const r = o.rot || [0, 0, 0];
    g.rotation.set(r[0], r[1], r[2]);
    const s = o.scale || [1, 1, 1];
    g.scale.set(s[0], s[1], s[2]);
    g.visible = o.visible !== false;
    applyOptions(g, o);
    // 見た目に影響するプロパティ
    if (o.type === "light" && g.userData.light) {
      g.userData.light.color.set(o.props.color || "#ffd9a0");
      g.userData.light.intensity = o.props.intensity == null ? 1.2 : o.props.intensity;
      g.userData.light.distance = o.props.distance || 8;
      const head = g.children.find((c) => c.isMesh && c.geometry.type === "SphereGeometry");
      if (head) { head.material.color.set(o.props.color || "#ffd9a0"); head.material.emissive.set(o.props.color || "#ffd9a0"); }
    }
    if (o.type === "board" && g.userData.faceMat) {
      if (g.userData.boardFilter !== o.props.filter) {
        g.userData.boardFilter = o.props.filter;
        if (g.userData.faceMat.map) g.userData.faceMat.map.dispose();
        g.userData.faceMat.map = boardTexture(o.props.filter || "all");
        g.userData.faceMat.needsUpdate = true;
      }
    }
    if (o.type === "pdf" && g.userData.pdfFace) {
      const key = (o.props.page || 1) + "|" + (o.props.file || "");
      if (g.userData.pdfKey !== key) {
        g.userData.pdfKey = key;
        const m = g.userData.pdfFace.material;
        if (m.map) m.map.dispose();
        m.map = pdfTexture(o.props.file || "document.pdf", o.props.page || 1);
        m.needsUpdate = true;
      }
    }
    if (o.type === "smoke") {
      if (o.props.playing && !g.userData.frame) startSmoke(g, o);
      if (!o.props.playing && g.userData.frame) {
        M.frames = M.frames.filter((f) => f !== g.userData.frame);
        g.userData.frame = null;
      }
    }
    if (o.type === "plane") {
      if (o.props.test && !g.userData.frame) startTestFlight(g, o);
      if (!o.props.test && g.userData.frame) {
        M.frames = M.frames.filter((f) => f !== g.userData.frame);
        g.userData.frame = null;
        g.position.fromArray(o.pos || [0, 0, 0]);
        g.rotation.set(0, o.rot && o.rot[1] || 0, 0);
      }
    }
    if (o.type === "spawn" && g.userData.spawnArrow) {
      g.userData.spawnArrowRotation = o.props.yaw || 0;
      g.rotation.y = 0;
    }
    refreshHelpers();
  }

  function rebuild(o) {
    const g = M.objs.get(o.id);
    if (!g) { addToScene(o); return; }
    disposeTree(g);
    M.scene.remove(g);
    M.objs.delete(o.id);
    const h = M.helpers.get(o.id);
    if (h) { M.scene.remove(h); M.helpers.delete(o.id); }
    addToScene(o);
    attachGizmo();
  }

  function setVisible(id, v) {
    const g = M.objs.get(id);
    if (g) g.visible = v;
  }

  function hover(id) {
    M.hovered = id;
  }

  function getCamera() {
    if (!M.camera || !M.orbit) return null;
    return {
      pos: M.camera.position.toArray(),
      target: M.orbit.target.toArray()
    };
  }

  function setCamera(c) {
    if (!M.camera || !M.orbit || !c) return;
    M.camera.position.fromArray(c.pos);
    M.orbit.target.fromArray(c.target);
    M.orbit.update();
  }

  window.ME = {
    TYPES, mount, unmount, setMode, setSnap, setView, focus, fitScene, rebuildScene, scheduleFitScene,
    select, addObject, removeObject, updateObject, rebuild, setVisible, hover,
    setTheme, applySettings, on: EV.on, get selected() { return M.selected.slice(); },
    get state() { return M.state; }, get scene() { return M.scene; },
    get isMounted() { return !!M.renderer; },
    getCamera, setCamera,
    syncFromScene
  };
})();
