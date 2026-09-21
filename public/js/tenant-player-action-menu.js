// public/js/tenant-player-action-menu.js — テナント向けプレイヤーアクションメニュー（管理者キック）
import PlayerActionMenu from '../../../metaverse-simple/public/js/player-action-menu.js';
import { t } from '../../../metaverse-simple/public/js/metaverse-i18n.js';

const KICK_LABEL = 'キック';

/**
 * ブロック/通報に加え、管理者のみキックを表示する
 */
export default class TenantPlayerActionMenu extends PlayerActionMenu {
    /**
     * @param {ConstructorParameters<typeof PlayerActionMenu>[0] & {
     *   isAdmin?: boolean,
     *   onKick?: (playerId: string) => void,
     * }} deps
     */
    constructor(deps) {
        super(deps);
        this._isAdmin = !!deps.isAdmin;
        this._onKick = typeof deps.onKick === 'function' ? deps.onKick : null;
        /** @type {HTMLButtonElement|null} */
        this._kickBtn = null;
    }

    _ensureDom() {
        super._ensureDom();
        const root = this._root;
        if (!root || root.querySelector('[data-action="kick"]')) return;

        const kickBtn = document.createElement('button');
        kickBtn.type = 'button';
        kickBtn.className = 'player-action-menu-item';
        kickBtn.setAttribute('data-action', 'kick');
        kickBtn.setAttribute('role', 'menuitem');
        kickBtn.hidden = true;
        kickBtn.textContent = KICK_LABEL;
        root.appendChild(kickBtn);
        this._kickBtn = kickBtn;

        root.addEventListener(
            'click',
            (e) => {
                const btn = e.target.closest('[data-action="kick"]');
                if (!btn || !this._currentPlayerId || !this._onKick) return;
                e.stopImmediatePropagation();
                const pid = this._currentPlayerId;
                this.close();
                this._onKick(pid);
            },
            true,
        );
    }

    /**
     * @param {HTMLElement} anchorEl
     * @param {{ playerId: string, displayName: string }} target
     */
    open(anchorEl, target) {
        this._ensureDom();
        if (this._kickBtn) {
            this._kickBtn.hidden = !this._isAdmin;
            this._kickBtn.textContent = t('playerAction.kick') === 'playerAction.kick'
                ? KICK_LABEL
                : t('playerAction.kick');
        }
        super.open(anchorEl, target);
    }
}
