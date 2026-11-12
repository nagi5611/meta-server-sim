// public/js/tenant-player-manager.js — テナント URL・Registry アバター互換
import PlayerManager from '../../../metaverse-simple/public/js/player-manager.js';
import { getTenantIdFromPath } from './tenant-runtime-shim.js';

export default class TenantPlayerManager extends PlayerManager {
    /**
     * Registry API は glbPath を返す。metaverse-simple は path を期待する。
     * @param {object} j
     */
    async resolveAvatarLoadUrlsFromPayload(j) {
        const normalized = {
            ...j,
            path:
                typeof j?.path === 'string' && j.path.length > 0
                    ? j.path
                    : typeof j?.glbPath === 'string'
                      ? j.glbPath
                      : '',
        };
        return super.resolveAvatarLoadUrlsFromPayload(normalized);
    }

    /**
     * ログインゲートが保存する `metaverseAvatarId:<tenant>` を優先する
     * @param {string|null} [explicitAvatarId]
     */
    async resolveAvatarSessionUrlAndMap(explicitAvatarId = null) {
        const isRemote = typeof explicitAvatarId === 'string' && explicitAvatarId.trim() !== '';
        if (!isRemote) {
            const tenantId = getTenantIdFromPath();
            if (tenantId) {
                try {
                    const stored = localStorage.getItem(`metaverseAvatarId:${tenantId}`);
                    if (stored && stored.trim()) {
                        explicitAvatarId = stored.trim();
                    }
                } catch {
                    /* ignore */
                }
            }
        }
        return super.resolveAvatarSessionUrlAndMap(explicitAvatarId);
    }
}
