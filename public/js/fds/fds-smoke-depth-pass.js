// public/js/fds/fds-smoke-depth-pass.js — シーン深度を VolumeRenderer のオクルージョン用に描画
import * as THREE from 'three';

/**
 * ジオメトリ深度を depthTexture に書き出す（煙 VolumeRenderer は除外）
 */
export class FdsSmokeDepthPass {
    constructor() {
        /** @type {THREE.WebGLRenderTarget | null} */
        this._target = null;
        this._width = 0;
        this._height = 0;
    }

    /**
     * 描画バッファサイズに合わせて RT を確保する
     * @param {number} width
     * @param {number} height
     */
    setSize(width, height) {
        const w = Math.max(1, Math.floor(width));
        const h = Math.max(1, Math.floor(height));
        if (this._target && this._width === w && this._height === h) {
            return;
        }
        this.dispose();
        this._width = w;
        this._height = h;
        this._target = new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            depthBuffer: true,
            stencilBuffer: false,
        });
        this._target.depthTexture = new THREE.DepthTexture(w, h);
        this._target.depthTexture.format = THREE.DepthFormat;
        this._target.depthTexture.type = THREE.UnsignedIntType;
    }

    /**
     * シーンを深度 RT に描画する（煙メッシュは一時非表示）
     * @param {THREE.WebGLRenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {THREE.Object3D[]} [hideObjects]
     */
    render(renderer, scene, camera, hideObjects = []) {
        if (!this._target) return;

        const hidden = hideObjects.map((o) => o.visible);
        for (const obj of hideObjects) {
            obj.visible = false;
        }

        const prevTarget = renderer.getRenderTarget();
        const prevAutoClear = renderer.autoClear;
        renderer.setRenderTarget(this._target);
        renderer.autoClear = true;
        renderer.clear();
        renderer.render(scene, camera);
        renderer.setRenderTarget(prevTarget);
        renderer.autoClear = prevAutoClear;

        for (let i = 0; i < hideObjects.length; i++) {
            hideObjects[i].visible = hidden[i];
        }
    }

    /**
     * @returns {THREE.DepthTexture | null}
     */
    getDepthTexture() {
        return this._target?.depthTexture ?? null;
    }

    dispose() {
        this._target?.depthTexture?.dispose?.();
        this._target?.dispose?.();
        this._target = null;
        this._width = 0;
        this._height = 0;
    }
}
