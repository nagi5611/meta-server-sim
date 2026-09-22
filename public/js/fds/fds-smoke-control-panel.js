// public/js/fds/fds-smoke-control-panel.js — FDS 煙再生用 in-world 2D パネル（Canvas テクスチャ）

import * as THREE from 'three';

/** ワールド内メッシュの縦横比（横 4 : 縦 3） */
export const PANEL_ASPECT_W = 4;
export const PANEL_ASPECT_H = 3;

export const CANVAS_W = 1024;
export const CANVAS_H = 768;

/** 再生ボタン領域（キャンバス正規化座標 0–1） */
export const PANEL_PLAY_BUTTON_RECT = Object.freeze({
    x: 0.12,
    y: 0.52,
    w: 0.76,
    h: 0.32,
});

const COLOR_BG = '#0a0f14';
const COLOR_BORDER = '#3a5a78';
const COLOR_TITLE = '#e8f4ff';
const COLOR_SUB = '#8aa8c4';
const COLOR_BTN = '#1e6f4a';
const COLOR_BTN_HOVER = '#2a9d62';
const COLOR_BTN_BORDER = '#7dffb8';
const COLOR_BTN_TEXT = '#f0fff6';

/** 再生ボタンに付与する既定の in-world パネル設定 */
export const DEFAULT_FDS_SMOKE_BUTTON_PANEL = Object.freeze({
    rotation: { x: 0, y: 180, z: 0 },
    scale: { x: 1.4, y: 1.4, z: 1 },
    maxDistance: 18,
});

/**
 * panel 未設定の再生ボタンに既定パネルを付与する（panel: false は近接 E のみ）
 * @param {object} btn
 * @returns {object}
 */
export function ensureFdsSmokeButtonPanel(btn) {
    if (!btn || typeof btn !== 'object') {
        return btn;
    }
    if (btn.panel === false) {
        return btn;
    }
    if (btn.panel != null && typeof btn.panel === 'object') {
        return btn;
    }
    return {
        ...btn,
        panel: {
            rotation: { ...DEFAULT_FDS_SMOKE_BUTTON_PANEL.rotation },
            scale: { ...DEFAULT_FDS_SMOKE_BUTTON_PANEL.scale },
            maxDistance: DEFAULT_FDS_SMOKE_BUTTON_PANEL.maxDistance,
        },
    };
}

/**
 * fdsSmokeButtons エントリが in-world パネル操作か
 * @param {object | null | undefined} btn
 * @returns {boolean}
 */
export function isFdsSmokePanelButton(btn) {
    if (!btn || btn.panel === false) return false;
    return btn.panel != null && typeof btn.panel === 'object';
}

/**
 * パネル用ワールド設定を正規化する
 * @param {object} btn
 * @returns {object | null}
 */
export function normalizeFdsSmokePanelEntry(btn) {
    if (!isFdsSmokePanelButton(btn) || !btn.fdsSmokeId || !btn.position) return null;
    const panel = btn.panel && typeof btn.panel === 'object' ? btn.panel : {};
    const rot = panel.rotation || btn.rotation || { x: 0, y: 0, z: 0 };
    const scale = panel.scale || btn.scale || { x: 1.4, y: 1.4, z: 1 };
    return {
        id: btn.id || String(btn.fdsSmokeId),
        fdsSmokeId: String(btn.fdsSmokeId),
        label: String(btn.label || '煙を再生').trim() || '煙を再生',
        message: String(btn.message || '').trim(),
        position: { ...btn.position },
        rotation: { x: rot.x ?? 0, y: rot.y ?? 0, z: rot.z ?? 0 },
        scale: {
            x: Number.isFinite(scale.x) ? scale.x : 1.4,
            y: Number.isFinite(scale.y) ? scale.y : 1.4,
            z: Number.isFinite(scale.z) ? scale.z : 1,
        },
        playback: btn.playback,
        maxDistance:
            typeof panel.maxDistance === 'number' && Number.isFinite(panel.maxDistance)
                ? panel.maxDistance
                : 18,
    };
}

/**
 * UV が再生ボタン矩形内か（PlaneGeometry の UV）
 * @param {{ x: number, y: number } | null | undefined} uv
 * @param {{ x: number, y: number, w: number, h: number }} [rect]
 * @returns {boolean}
 */
export function fdsSmokePanelUvHitsButton(uv, rect = PANEL_PLAY_BUTTON_RECT) {
    if (!uv || !Number.isFinite(uv.x) || !Number.isFinite(uv.y)) return false;
    return (
        uv.x >= rect.x &&
        uv.x <= rect.x + rect.w &&
        uv.y >= rect.y &&
        uv.y <= rect.y + rect.h
    );
}

/**
 * 角丸矩形
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/**
 * パネル Canvas を描画する
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ label: string, message?: string, buttonHovered?: boolean, buttonPressed?: boolean }} state
 */
export function paintFdsSmokeControlPanel(ctx, state) {
    const label = state.label || '煙を再生';
    const message = state.message || '';
    const hovered = Boolean(state.buttonHovered);
    const pressed = Boolean(state.buttonPressed);

    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.strokeStyle = COLOR_BORDER;
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, CANVAS_W - 16, CANVAS_H - 16);

    ctx.fillStyle = COLOR_TITLE;
    ctx.font = '700 52px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('FDS SMOKE', CANVAS_W / 2, 36);

    ctx.fillStyle = COLOR_SUB;
    ctx.font = '500 28px system-ui, sans-serif';
    ctx.fillText('シミュレーション再生', CANVAS_W / 2, 108);

    if (message) {
        ctx.font = '400 24px system-ui, sans-serif';
        ctx.fillText(message.slice(0, 48), CANVAS_W / 2, 150);
    }

    const bx = PANEL_PLAY_BUTTON_RECT.x * CANVAS_W;
    const by = PANEL_PLAY_BUTTON_RECT.y * CANVAS_H;
    const bw = PANEL_PLAY_BUTTON_RECT.w * CANVAS_W;
    const bh = PANEL_PLAY_BUTTON_RECT.h * CANVAS_H;

    ctx.fillStyle = pressed ? COLOR_BTN_HOVER : hovered ? COLOR_BTN_HOVER : COLOR_BTN;
    roundRect(ctx, bx, by, bw, bh, 18);
    ctx.fill();
    ctx.strokeStyle = hovered || pressed ? COLOR_BTN_BORDER : COLOR_BORDER;
    ctx.lineWidth = 4;
    roundRect(ctx, bx, by, bw, bh, 18);
    ctx.stroke();

    ctx.fillStyle = COLOR_BTN_TEXT;
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(`▶ ${label}`, CANVAS_W / 2, by + bh / 2);
}

/**
 * in-world FDS 煙コントロールパネルメッシュを生成する
 * @param {ReturnType<typeof normalizeFdsSmokePanelEntry>} config
 * @returns {THREE.Mesh}
 */
export function createFdsSmokeControlPanelMesh(config) {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    paintFdsSmokeControlPanel(ctx, { label: config.label, message: config.message });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geom = new THREE.PlaneGeometry(PANEL_ASPECT_W, PANEL_ASPECT_H);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: false });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = 'fds-smoke-control-panel';
    mesh.position.set(config.position.x, config.position.y, config.position.z);
    mesh.rotation.set(
        (config.rotation.x * Math.PI) / 180,
        (config.rotation.y * Math.PI) / 180,
        (config.rotation.z * Math.PI) / 180,
    );
    mesh.scale.set(config.scale.x, config.scale.y, config.scale.z);
    mesh.userData.fdsSmokePanelConfig = { ...config };
    mesh.userData.fdsSmokePanelCanvas = canvas;
    mesh.userData.fdsSmokePanelTexture = tex;
    mesh.userData.fdsSmokePanelButtonRect = { ...PANEL_PLAY_BUTTON_RECT };
    return mesh;
}

/**
 * ホバー状態でテクスチャを更新する
 * @param {THREE.Mesh} mesh
 * @param {{ buttonHovered?: boolean, buttonPressed?: boolean }} paintState
 */
export function updateFdsSmokeControlPanelPaint(mesh, paintState = {}) {
    const canvas = mesh.userData.fdsSmokePanelCanvas;
    const tex = mesh.userData.fdsSmokePanelTexture;
    const cfg = mesh.userData.fdsSmokePanelConfig;
    if (!canvas || !tex || !cfg) return;
    const ctx = canvas.getContext('2d');
    paintFdsSmokeControlPanel(ctx, {
        label: cfg.label,
        message: cfg.message,
        buttonHovered: paintState.buttonHovered,
        buttonPressed: paintState.buttonPressed,
    });
    tex.needsUpdate = true;
}
