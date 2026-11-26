/* mt-world-loading.js — ワールド編集 円形カードローディング UI */
(function () {
  "use strict";

  const STEPS = [
    "ワールドデータの取得",
    "シーンの準備",
    "環境の設定",
    "ライトの配置",
    "モデルの読み込み",
    "モデルの配置と調整",
    "発着板などの配置",
    "カメラと描画範囲の調整",
  ];
  const N = STEPS.length;
  const COLLAPSE_GAP_MS = 85;

  let root = null;
  let stage = null;
  let desc = null;
  let slotEls = [];
  let token = 0;
  let resizeBound = false;
  let reducedMotion = false;

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** ローディング DOM を一度だけ生成する */
  function ensureDom() {
    if (root) return;
    root = document.createElement("div");
    root.className = "mt-world-loading ld-bar-step-0";
    root.setAttribute("hidden", "");
    root.setAttribute("aria-live", "polite");
    root.setAttribute("aria-busy", "true");
    root.setAttribute("data-stage-fit", "100");

    const stageWrap = document.createElement("div");
    stageWrap.className = "ld-stage";
    const mark = document.createElement("div");
    mark.className = "ld-mark";
    mark.innerHTML = "<b aria-hidden=\"true\">✓</b>";
    stageWrap.appendChild(mark);

    for (let i = 0; i < N; i++) {
      const slot = document.createElement("div");
      slot.className = `ld-slot ld-i-${i} ld-c-${i}`;
      slot.dataset.step = String(i);
      const card = document.createElement("div");
      card.className = "ld-card";
      slot.appendChild(card);
      stageWrap.appendChild(slot);
      slotEls.push(slot);
    }

    desc = document.createElement("div");
    desc.className = "ld-desc";

    const bar = document.createElement("div");
    bar.className = "ld-bar";
    bar.innerHTML = "<i></i>";

    root.appendChild(stageWrap);
    root.appendChild(desc);
    root.appendChild(bar);
    document.body.appendChild(root);
    stage = stageWrap;
  }

  /** ステージをビューポートに合わせて縮小する */
  function fitStage() {
    if (!root) return;
    const vw = window.innerWidth - 48;
    const vh = window.innerHeight - 48 - 130;
    const s = Math.min(1, vw / 520, vh / 520);
    const pct = Math.max(50, Math.min(100, Math.round(s * 100 / 5) * 5));
    root.setAttribute("data-stage-fit", String(pct));
  }

  function bindResizeOnce() {
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener("resize", fitStage);
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function setBarStep(i) {
    if (!root) return;
    root.classList.remove(
      "ld-bar-step-0", "ld-bar-step-1", "ld-bar-step-2", "ld-bar-step-3",
      "ld-bar-step-4", "ld-bar-step-5", "ld-bar-step-6", "ld-bar-step-7", "ld-bar-step-8"
    );
    const step = Math.max(0, Math.min(N, i + 1));
    root.classList.add(`ld-bar-step-${step}`);
  }

  /** 進行中ステップを表示する */
  function setActive(i) {
    slotEls.forEach((s, k) => {
      s.classList.toggle("is-active", k === i);
      s.classList.toggle("in", k <= i);
    });
    setBarStep(i);
    const stepNo = String(i + 1).padStart(2, "0");
    desc.innerHTML =
      `<div class="d-pill">STEP <strong>${stepNo}</strong> / 08</div>` +
      `<h1 class="d-t">${esc(STEPS[i])}</h1>`;
    desc.classList.remove("is-swap");
    void desc.offsetWidth;
    desc.classList.add("is-swap");
  }

  function resetSlots() {
    token += 1;
    if (stage) stage.classList.remove("is-collapsed");
    slotEls.forEach((s) => s.classList.remove("in", "is-active", "is-gone"));
    setBarStep(-1);
    if (desc) {
      desc.classList.remove("is-swap");
      desc.innerHTML = "";
    }
  }

  /** オーバーレイを表示する */
  function open() {
    ensureDom();
    bindResizeOnce();
    resetSlots();
    root.classList.remove("is-dismissing");
    root.removeAttribute("hidden");
    root.setAttribute("aria-busy", "true");
    fitStage();
  }

  /** 外周から中央へ吸い込む完了アニメーション */
  async function collapseCards(my) {
    for (let i = 0; i < N; i++) {
      if (my !== token) return false;
      slotEls[i].classList.remove("is-active");
      slotEls[i].classList.add("is-gone");
      if (!reducedMotion) await wait(COLLAPSE_GAP_MS);
    }
    if (my !== token) return false;
    if (!reducedMotion) await wait(420);
    stage.classList.add("is-collapsed");
    if (!reducedMotion) await wait(240);
    return true;
  }

  /**
   * 成功完了（吸い込み → ✓ → フェードアウト）
   * @param {string} worldName
   */
  async function finish(worldName) {
    ensureDom();
    const my = token;
    slotEls.forEach((s) => s.classList.remove("is-active"));
    if (!reducedMotion) await wait(160);
    const ok = await collapseCards(my);
    if (!ok) return;

    const name = esc(worldName || "ワールド");
    desc.innerHTML =
      `<div class="d-ok"><b aria-hidden="true">✓</b>読み込み完了</div>` +
      `<h1 class="d-t">${name} を開きました</h1>`;
    desc.classList.remove("is-swap");
    void desc.offsetWidth;
    desc.classList.add("is-swap");

    const hold = reducedMotion ? 320 : 720;
    await wait(hold);
    if (my !== token) return;
    await dismiss();
  }

  /** エラー時に短く表示して閉じる */
  async function fail(message) {
    ensureDom();
    const my = token;
    slotEls.forEach((s) => s.classList.remove("is-active", "in", "is-gone"));
    stage.classList.remove("is-collapsed");
    const msg = esc(message || "読み込みに失敗しました");
    desc.innerHTML =
      `<div class="d-err">${msg}</div>` +
      `<h1 class="d-t">エディタに戻ります</h1>`;
    await wait(reducedMotion ? 400 : 1400);
    if (my !== token) return;
    await dismiss();
  }

  /** フェードアウトして非表示 */
  async function dismiss() {
    if (!root) return;
    token += 1;
    root.classList.add("is-dismissing");
    root.setAttribute("aria-busy", "false");
    const dur = reducedMotion ? 80 : 450;
    await wait(dur);
    root.setAttribute("hidden", "");
    root.classList.remove("is-dismissing");
    resetSlots();
  }

  /**
   * 1ステップ分の処理を実行し UI を進める
   * @param {number} index 0..7
   * @param {() => (void|Promise<void>)} work
   * @param {number} [minMs]
   */
  async function runStep(index, work, minMs) {
    const min = minMs == null ? 200 : minMs;
    setActive(index);
    const t0 = performance.now();
    await work();
    const remain = min - (performance.now() - t0);
    if (remain > 0 && !reducedMotion) await wait(remain);
  }

  function isOpen() {
    return !!(root && !root.hasAttribute("hidden"));
  }

  window.MTWorldLoading = {
    STEPS,
    open,
    setActive,
    runStep,
    finish,
    fail,
    dismiss,
    resetSlots,
    isOpen,
  };
})();