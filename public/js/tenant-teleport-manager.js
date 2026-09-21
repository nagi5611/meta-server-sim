// public/js/tenant-teleport-manager.js — FDS煙ボタン近接インタラクトを TeleportManager に追加

import TeleportManager from '../../../metaverse-simple/public/js/teleport-manager.js';

/**
 * テナント向け TeleportManager（FDS煙ボタンゾーン対応）
 */
export class TenantTeleportManager extends TeleportManager {
    constructor(worldManager, uiManager) {
        super(worldManager, uiManager);
        /** @type {Array<{ id: string, fdsSmokeId: string, position: { x: number, y: number, z: number }, radius: number, label: string, message: string, playback: object | undefined, worldId: string }>} */
        this.fdsSmokeInteractZones = [];
        this.nearestFdsSmokeInteractZone = null;
        /** @type {((zone: object) => void) | null} */
        this._fdsSmokeInteractPlayHandler = null;
    }

    /**
     * FDS煙ボタン押下時のコールバック
     * @param {((zone: object) => void) | null} fn
     */
    setFdsSmokeInteractPlayHandler(fn) {
        this._fdsSmokeInteractPlayHandler = typeof fn === 'function' ? fn : null;
    }

    /**
     * FDS煙ボタンゾーンを登録する
     * @param {object} zone
     */
    addFdsSmokeInteractZone(zone) {
        if (!zone?.fdsSmokeId || !zone.position || !zone.worldId) return;
        this.fdsSmokeInteractZones.push({
            id: zone.id || zone.fdsSmokeId,
            fdsSmokeId: String(zone.fdsSmokeId),
            position: zone.position,
            radius: typeof zone.radius === 'number' && Number.isFinite(zone.radius) ? zone.radius : 3,
            label: zone.label || '再生',
            message: zone.message || '',
            playback: zone.playback,
            worldId: zone.worldId,
        });
    }

    /**
     * 指定ワールドの FDS煙ボタンゾーンを削除する
     * @param {string} worldId
     */
    clearFdsSmokeInteractZonesForWorld(worldId) {
        this.fdsSmokeInteractZones = this.fdsSmokeInteractZones.filter((z) => z.worldId !== worldId);
        this.nearestFdsSmokeInteractZone = null;
    }

    /**
     * @param {import('three').Vector3} playerPosition
     */
    update(playerPosition) {
        super.update(playerPosition);
        const currentWorldId = this.worldManager.getCurrentWorldId();
        if (!currentWorldId) {
            this.nearestFdsSmokeInteractZone = null;
            return;
        }

        let closest = null;
        let closestDist = Infinity;
        const wp = playerPosition;

        for (const zone of this.fdsSmokeInteractZones) {
            if (zone.worldId !== currentWorldId) continue;
            const dx = wp.x - zone.position.x;
            const dy = wp.y - zone.position.y;
            const dz = wp.z - zone.position.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < zone.radius && dist < closestDist) {
                closestDist = dist;
                closest = zone;
            }
        }

        this.nearestFdsSmokeInteractZone = closest || null;
    }

    /**
     * @override
     */
    _runInteractAfterAircraftCheck() {
        if (this.nearestFdsSmokeInteractZone && this._fdsSmokeInteractPlayHandler) {
            this.uiManager.hideTeleportPrompt();
            this._fdsSmokeInteractPlayHandler(this.nearestFdsSmokeInteractZone);
            return;
        }
        super._runInteractAfterAircraftCheck();
    }

    /**
     * @override
     */
    clearZones() {
        super.clearZones();
        this.fdsSmokeInteractZones = [];
        this.nearestFdsSmokeInteractZone = null;
    }
}
