// public/js/tenant-metaverse-app.js — metaverse-simple コアをテナント向けに起動
import './tenant-runtime-shim.js';
import '../../../metaverse-simple/public/css/style.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import * as THREE from 'three';
import '../../../metaverse-simple/public/js/addons/registry-game.js';
import SceneManager from '../../../metaverse-simple/public/js/scene-manager.js';
import PhysicsManager from '../../../metaverse-simple/public/js/physics-manager.js';
import CharacterController from '../../../metaverse-simple/public/js/character-controller.js';
import PlayerManager from '../../../metaverse-simple/public/js/player-manager.js';
import NetworkManager from '../../../metaverse-simple/public/js/network-manager.js';
import WorldManager from '../../../metaverse-simple/public/js/world-manager.js';
import TeleportManager from '../../../metaverse-simple/public/js/teleport-manager.js';
import UIManager from '../../../metaverse-simple/public/js/ui-manager.js';
import { getTenantIdFromPath, toTenantUrl } from './tenant-runtime-shim.js';
import { renderMetaversePortalNav } from './metaverse-portal-nav.js';
import { applyMetaverseI18nToDocument, t } from '../../../metaverse-simple/public/js/metaverse-i18n.js';
import { resolveEnvAssetHref } from './tenant-asset-resolve.js';
import { ensureControlSchemeChosen } from '../../../metaverse-simple/public/js/mobile-utils.js';
import { runFrameUpdates } from '../../../metaverse-simple/lib/client-addon-registry.js';
import { DEFAULT_HDR_PATH } from '../../../metaverse-simple/public/js/ibl-setup.js';
import { TenantFdsSmokeManager } from './tenant-fds-smoke-manager.js';

const DEFAULT_ROOM = 'lobby';

/** HDR 未配置時に RGBELoader が HTML 404 をパースして落ちるのを防ぐ */
const _loadIBLAsyncOrig = SceneManager.prototype._loadIBLAsync;
SceneManager.prototype._loadIBLAsync = async function patchedTenantLoadIBLAsync() {
    if (!this.scene || !this.renderer) return;
    try {
        const hdrUrl = await resolveEnvAssetHref(DEFAULT_HDR_PATH);
        const head = await fetch(hdrUrl, { method: 'HEAD' });
        if (!head.ok) {
            console.warn('[tenant-metaverse] IBL skipped (HDR missing):', hdrUrl);
            return;
        }
    } catch {
        console.warn('[tenant-metaverse] IBL skipped (HDR check failed)');
        return;
    }
    return _loadIBLAsyncOrig.call(this);
};

/**
 * テナント検証用: 操作方式未選択時はキーボードを既定にする（モーダル待ちで init が止まらない）
 */
function ensureTenantControlSchemeDefault() {
    try {
        const scheme = localStorage.getItem('metaverse-control-scheme');
        if (scheme !== 'touch' && scheme !== 'keyboard') {
            localStorage.setItem('metaverse-control-scheme', 'keyboard');
        }
    } catch {
        /* ignore */
    }
}

/**
 * ゲスト名を localStorage に用意
 */
function ensureGuestUsername() {
    try {
        const existing = localStorage.getItem('username');
        if (existing && existing.trim().length >= 2) return existing.trim();
        const guest = `Guest-${Math.floor(Math.random() * 9000) + 1000}`;
        localStorage.setItem('username', guest);
        return guest;
    } catch {
        return `Guest-${Math.floor(Math.random() * 9000) + 1000}`;
    }
}

class TenantMetaverseApp {
    constructor() {
        this.sceneManager = null;
        this.physicsManager = null;
        this.characterController = null;
        this.playerManager = null;
        this.networkManager = null;
        this.worldManager = null;
        this.teleportManager = null;
        this.uiManager = null;
        this.fdsSmokeManager = null;
        this.clock = 0;
        this.isPageVisible = true;
        this._frameCallback = null;
        this._worldReadyForNetwork = false;
        this._networkConnectPendingRoomSync = false;
    }

    setupPageVisibility() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.isPageVisible = false;
            } else {
                this.isPageVisible = true;
                this.clock = performance.now();
            }
        });
    }

    updateTeleportZones() {
        const teleporters = this.sceneManager.getTeleporters();
        const currentWorldId = this.worldManager.getCurrentWorldId();

        const existingZones = this.teleportManager.getZonesForWorld(currentWorldId);
        if (existingZones.length > 0) {
            this.teleportManager.teleportZones = this.teleportManager.teleportZones.filter(
                (zone) => zone.worldId !== currentWorldId
            );
        }

        teleporters.forEach((teleporter) => {
            this.teleportManager.addZone({
                id: teleporter.id,
                position: teleporter.position,
                radius: teleporter.radius,
                destinationWorld: teleporter.destinationWorld,
                label: teleporter.label,
                worldId: currentWorldId,
                access: teleporter.access || 'public',
                autoTeleport: !!teleporter.autoTeleport,
                autoTeleportOnContact: !!teleporter.autoTeleportOnContact,
            });
        });
    }

    async init() {
        const tenantId = getTenantIdFromPath();
        if (!tenantId) {
            document.body.innerHTML = '<p class="muted">tenant ID を URL から取得できません。</p>';
            return;
        }

        applyMetaverseI18nToDocument();
        ensureTenantControlSchemeDefault();
        await ensureControlSchemeChosen();
        ensureGuestUsername();

        const titleEl = document.getElementById('tenant-title');
        if (titleEl) titleEl.textContent = tenantId;

        renderMetaversePortalNav(document.getElementById('metaverse-portal-links')).then(() => {
            const nav = document.getElementById('metaverse-portal-nav');
            if (nav?.querySelector('.portal-nav-links a')) {
                nav.removeAttribute('hidden');
            }
        });

        this.setupPageVisibility();

        this.sceneManager = new SceneManager();
        this.sceneManager.init();

        this.fdsSmokeManager = new TenantFdsSmokeManager(this.sceneManager.getScene());

        this.physicsManager = new PhysicsManager();
        await this.physicsManager.init();

        this.uiManager = new UIManager();
        this.worldManager = new WorldManager(this.sceneManager);
        await this.worldManager.init();

        this.worldManager.onWorldChange((world) => {
            void this.fdsSmokeManager.loadForWorld(world);
        });

        this.worldManager.setWorldLoadUiHandlers({
            begin: (opts) => this.uiManager.showWorldLoadProgress(opts.totalCount, opts),
            progress: (detail) => this.uiManager.updateWorldLoadProgress(detail),
            finalize: (beforePaint) => this.uiManager.finalizeWorldLoadProgress(beforePaint),
            onLoadStart: () => {
                this.networkManager?.setWorldViewDisplayReady(false);
            },
            onLoadComplete: async () => {
                this.networkManager?.setWorldViewDisplayReady(true);
                await this.networkManager?.flushPendingRemotePlayers();
            },
        });

        this.sceneManager.physicsManager = this.physicsManager;
        this.physicsManager.setSpawnPointGetter(() => this.worldManager.getSpawnPoint());

        this.teleportManager = new TeleportManager(this.worldManager, this.uiManager);
        this.teleportManager.setUserRole('guest');
        this.teleportManager.setTeleportCallback((destinationWorld, teleporterId) => {
            this.networkManager.changeWorld(destinationWorld, { teleporterId }, (err) => {
                if (err) {
                    alert(err.message || t('main.teleporterError'));
                    return;
                }
                this.worldManager.switchWorld(destinationWorld);
            });
        });

        const defaultWorldId = this.worldManager.getWorld(DEFAULT_ROOM)
            ? DEFAULT_ROOM
            : (this.worldManager.getAllWorlds()[0]?.id || DEFAULT_ROOM);

        this.playerManager = new PlayerManager(this.sceneManager.getScene());
        this.networkManager = new NetworkManager(this.playerManager);
        this.networkManager.setWorldViewDisplayReady(false);
        this.networkManager.currentWorld = defaultWorldId;
        this.networkManager.setPostConnectHandler(async () => {
            await this._onNetworkPostConnect();
        });

        await this.networkManager.connect();

        await this.worldManager.loadWorld(defaultWorldId, () => {
            this.updateTeleportZones();
            this._worldReadyForNetwork = true;
            if (this._networkConnectPendingRoomSync) {
                this._networkConnectPendingRoomSync = false;
                void this._applyInitialRoomSync();
            }
        });

        const spawnPoint = this.worldManager.getSpawnPoint();
        this.characterController = new CharacterController(
            this.sceneManager.getCamera(),
            this.physicsManager
        );
        this.teleportManager.setInputActiveCheck(() => this.characterController.isInputActive());
        this.characterController.setPosition(spawnPoint.x, spawnPoint.y, spawnPoint.z);

        await this.playerManager.createLocalPlayer(spawnPoint);
        this.networkManager.startSendingUpdates(this.characterController);

        this.clock = performance.now();
        this._frameCallback = (timeMs) => this.frameUpdate(timeMs);
        const renderer = this.sceneManager.getRenderer();
        renderer.setAnimationLoop(this._frameCallback);
        window.addEventListener('beforeunload', () => {
            renderer.setAnimationLoop(null);
            this.fdsSmokeManager?.dispose();
        });

        console.log(`[tenant-metaverse] initialized for ${tenantId}`);
        document.documentElement.dataset.tenantMetaverseReady = 'true';
    }

    async _onNetworkPostConnect() {
        if (!this._worldReadyForNetwork) {
            this._networkConnectPendingRoomSync = true;
            return;
        }
        await this._applyInitialRoomSync();
    }

    async _applyInitialRoomSync() {
        if (!this.networkManager?.socket?.connected || !this.worldManager) return;
        const roomId = this.worldManager.getCurrentWorldId() || DEFAULT_ROOM;
        if (roomId === DEFAULT_ROOM) return;
        await new Promise((resolve) => {
            this.networkManager.changeWorld(roomId, {}, (err) => {
                if (err) console.error('[Network] Initial room sync failed:', err);
                resolve();
            });
        });
    }

    frameUpdate(timeMs) {
        const currentTime = timeMs;
        let deltaTime = (currentTime - this.clock) / 1000;
        this.clock = currentTime;

        const MAX_DELTA_TIME = 0.1;
        if (deltaTime > MAX_DELTA_TIME) deltaTime = MAX_DELTA_TIME;

        runFrameUpdates(this, deltaTime, timeMs);

        this.fdsSmokeManager?.update(deltaTime);

        if (this.isPageVisible) {
            this.characterController.update(deltaTime);

            const position = this.characterController.getPosition();
            const rotation = this.characterController.getRotation();
            const movementState = this.characterController.getMovementState();
            this.playerManager.updateLocalPlayer(position, rotation, movementState);

            const viewDistanceM = this.sceneManager.graphicsOptions.viewDistanceM;
            const vas = this.worldManager.getViewDistanceStreaming();
            if (vas) {
                void vas.tick(position, viewDistanceM).catch((err) => {
                    console.warn('[VAS] tick error:', err);
                });
            }

            this.sceneManager.updatePrefabLodVisibility(position);
            this.sceneManager.updateDrawDistanceCulling(position);
            this.playerManager.updateRemoteDrawDistance(position, viewDistanceM);

            if (this.teleportManager) {
                this.teleportManager.update(position);
            }

            if (this.teleportManager?.nearestZone) {
                this.uiManager.showTeleportPrompt(this.teleportManager.nearestZone.label);
            } else {
                this.uiManager.hideTeleportPrompt();
            }
        }

        this.sceneManager.updateAnimations();
        this.sceneManager.updateGltfAnimationMixers(deltaTime);
        this.playerManager.updateAnimations(deltaTime);

        if (this.uiManager && this.worldManager && this.networkManager) {
            const world = this.worldManager.getCurrentWorld();
            const position = this.characterController?.getPosition?.() ?? null;
            const playerCount = this.playerManager?.getPlayerCount?.() ?? 0;
            const pingStatus = this.networkManager.getPingStatus();
            const myId = this.networkManager.myPlayerId;
            const players = (this.networkManager.lastPlayersSnapshot || []).map((p) => {
                if (p.id !== myId) return p;
                if (pingStatus.noResponse || pingStatus.connecting || pingStatus.reconnecting) {
                    return { ...p, pingMs: null };
                }
                if (pingStatus.pingMs != null) {
                    return { ...p, pingMs: pingStatus.pingMs };
                }
                return p;
            });
            this.uiManager.updateInfoPanel(world?.name || '-', position, playerCount, players);
            this.uiManager.updatePingDisplay(pingStatus);
        }

        this.sceneManager.render();
    }
}

const app = new TenantMetaverseApp();
app.init().catch((err) => {
    console.error('[tenant-metaverse] init failed:', err);
    const el = document.getElementById('socket-status');
    if (el) el.textContent = `初期化エラー: ${err instanceof Error ? err.message : String(err)}`;
});
