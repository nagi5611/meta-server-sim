// public/js/tenant-scene-taiko-patch.js — 古い metaverse-simple に太鼓ゾーン追跡を補う

import SceneManager from '../../../metaverse-simple/public/js/scene-manager.js';

/**
 * SceneManager に getTaikos / config.taiko 処理が無い場合だけパッチする
 */
export function applyTenantSceneTaikoPatch() {
    if (typeof SceneManager.prototype.getTaikos === 'function') {
        return;
    }

    const orig = SceneManager.prototype.constructor;
    if (orig) {
        /* noop — コンストラクタ差し替えは行わない */
    }

    const prevInit = SceneManager.prototype.init;
    SceneManager.prototype.init = function patchedInit(...args) {
        this.taikos = [];
        return prevInit.apply(this, args);
    };

    SceneManager.prototype.getTaikos = function getTaikos() {
        return Array.isArray(this.taikos) ? this.taikos : [];
    };
}