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
import UIManager from '../../../metaverse-simple/public/js/ui-manager.js';
import ChatManager from '../../../metaverse-simple/public/js/chat-manager.js';
import MenuManager from '../../../metaverse-simple/public/js/menu-manager.js';
import VoiceChatManager from '../../../metaverse-simple/public/js/voice-chat-manager.js';
import VideoChatManager from '../../../metaverse-simple/public/js/video-chat-manager.js';
import CaptionManager from '../../../metaverse-simple/public/js/caption-manager.js';
import TenantPlayerActionMenu from './tenant-player-action-menu.js';
import MobileUIManager from '../../../metaverse-simple/public/js/mobile-ui-manager.js';
import MobileJoystickManager from '../../../metaverse-simple/public/js/mobile-joystick-manager.js';
import { TenantTeleportManager } from './tenant-teleport-manager.js';
import { getTenantIdFromPath, toTenantUrl } from './tenant-runtime-shim.js';
import { renderMetaversePortalNav } from './metaverse-portal-nav.js';
import { applyMetaverseI18nToDocument, t } from '../../../metaverse-simple/public/js/metaverse-i18n.js';
import { resolveEnvAssetHref } from './tenant-asset-resolve.js';
import {
    ensureControlSchemeChosen,
    isMobile,
} from '../../../metaverse-simple/public/js/mobile-utils.js';
import { runFrameUpdates } from '../../../metaverse-simple/lib/client-addon-registry.js';
import { DEFAULT_HDR_PATH } from '../../../metaverse-simple/public/js/ibl-setup.js';
import { TenantFdsSmokeManager } from './tenant-fds-smoke-manager.js';
import { ensureFdsSmokeBulkConfig } from './fds/fds-smoke-fetch-client.js';
import { TenantFdsSmokeExposureMonitor } from './tenant-fds-smoke-exposure.js';
import { ensureFdsSmokeButtonPanel, isFdsSmokePanelButton } from './fds/fds-smoke-control-panel.js';
import { TenantFdsSmokePanelManager } from './tenant-fds-smoke-panel-manager.js';
import { fetchAdminMetaverseEntry } from '../../../metaverse-simple/public/js/admin-metaverse-auth.js';
import IdleControlHint from '../../../metaverse-simple/public/js/idle-control-hint.js';

const DEFAULT_ROOM = 'lobby';

/** テナント退出時は hub へ遷移 */
MenuManager.prototype.logout = async function tenantLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
        /* ignore */
    }
    try {
        await fetch('/admin/clear-metaverse-token', { credentials: 'include' });
    } catch {
        /* ignore */
    }
    localStorage.removeItem('username');
    localStorage.removeItem('userRole');
    sessionStorage.removeItem('metaverseAdminToken');
    window.location.href = toTenantUrl('/') || '/';
};

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
        this.fdsSmokePanelManager = null;
        this.fdsSmokeExposureMonitor = null;
        this.menuManager = null;
        this.voiceChatManager = null;
        this.videoChatManager = null;
        this.chatManager = null;
        this.captionManager = null;
        this.playerActionMenu = null;
        this.playerBlockList = new Set();
        this.userRole = 'guest';
        this.isMobileMode = false;
        this.clock = 0;
        this.isPageVisible = true;
        this._frameCallback = null;
        this._worldReadyForNetwork = false;
        this._networkConnectPendingRoomSync = false;
        this.refreshLocalAvatarVisibility = null;
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

    formatFdsSmokeButtonPrompt(zone) {
        const message = (zone.message && String(zone.message).trim()) || '';
        const label = (zone.label && String(zone.label).trim()) || '';
        if (message && label) {
            return `${message} — [E] ${label}`;
        }
        if (message) return message;
        if (label) return `[E] ${label}`;
        return t('ui.glbAnimDefault');
    }

    updateFdsSmokeButtonZones(world) {
        if (!this.teleportManager || !this.worldManager) return;
        const worldId = world?.id || this.worldManager.getCurrentWorldId();
        if (!worldId) return;

        this.teleportManager.clearFdsSmokeInteractZonesForWorld(worldId);
        const buttons = Array.isArray(world?.fdsSmokeButtons) ? world.fdsSmokeButtons : [];
        for (const raw of buttons) {
            const btn = ensureFdsSmokeButtonPanel(raw);
            if (!btn?.fdsSmokeId || !btn.position) continue;
            if (isFdsSmokePanelButton(btn)) continue;
            this.teleportManager.addFdsSmokeInteractZone({
                id: btn.id,
                fdsSmokeId: btn.fdsSmokeId,
                position: btn.position,
                radius: btn.radius,
                label: btn.label,
                message: btn.message,
                playback: btn.playback,
                worldId,
            });
        }
    }

    updateTeleportZones() {
        const teleporters = this.sceneManager.getTeleporters();
        const currentWorldId = this.worldManager.getCurrentWorldId();

        const existingZones = this.teleportManager.getZonesForWorld(currentWorldId);
        if (existingZones.length > 0) {
            this.teleportManager.teleportZones = this.teleportManager.teleportZones.filter(
                (zone) => zone.worldId !== currentWorldId,
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

    /**
     * リモートアバタークリックでプレイヤーアクションメニューを開く
     */
    setupRemotePlayerAvatarClick() {
        const canvas = document.getElementById('canvas');
        if (!canvas || !this.playerManager || !this.playerActionMenu || !this.sceneManager) return;

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        if (!this._avatarMenuAnchor) {
            const anchor = document.createElement('div');
            anchor.style.position = 'fixed';
            anchor.style.width = '1px';
            anchor.style.height = '1px';
            anchor.style.pointerEvents = 'none';
            document.body.appendChild(anchor);
            this._avatarMenuAnchor = anchor;
        }

        this._onRemotePlayerAvatarPointerDown = (e) => {
            if (e.button !== 0) return;
            const rect = canvas.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, this.sceneManager.getCamera());
            const intersects = raycaster.intersectObjects(this.sceneManager.getScene().children, true);
            for (const hit of intersects) {
                const playerId = this.playerManager.getPlayerIdFromObject(hit.object);
                if (!playerId || playerId === this.networkManager?.myPlayerId) continue;
                const remote = this.playerManager.remotePlayers.get(playerId);
                const displayName =
                    remote?.userData?.username ||
                    `Player ${String(playerId).substring(0, 4)}`;
                this._avatarMenuAnchor.style.left = `${e.clientX}px`;
                this._avatarMenuAnchor.style.top = `${e.clientY}px`;
                this.playerActionMenu.open(this._avatarMenuAnchor, { playerId, displayName });
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        };

        canvas.addEventListener('pointerdown', this._onRemotePlayerAvatarPointerDown);
    }

    async _resolveUserRole() {
        const adminEntry = await fetchAdminMetaverseEntry();
        if (adminEntry?.token) {
            this.userRole = 'admin';
            return;
        }
        this.userRole = localStorage.getItem('userRole') || 'guest';
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
        await this._resolveUserRole();

        const titleEl = document.getElementById('tenant-title');
        if (titleEl) titleEl.textContent = tenantId;

        renderMetaversePortalNav(document.getElementById('metaverse-portal-links')).then(() => {
            const nav = document.getElementById('metaverse-portal-nav');
            if (nav?.querySelector('.portal-nav-links a')) {
                nav.removeAttribute('hidden');
            }
        });

        this.setupPageVisibility();
        this.isMobileMode = isMobile();

        this.sceneManager = new SceneManager();
        this.sceneManager.init();

        this.fdsSmokeManager = new TenantFdsSmokeManager(this.sceneManager.getScene());
        this.fdsSmokePanelManager = new TenantFdsSmokePanelManager(
            this.sceneManager.getScene(),
            () => this.sceneManager.getCamera(),
            (panelConfig) => {
                void this.fdsSmokeManager.startPlayback(panelConfig.fdsSmokeId, {
                    fromFrame: panelConfig.playback?.fromFrame ?? 0,
                    loop: panelConfig.playback?.loop !== false,
                    framesPerSecond: panelConfig.playback?.framesPerSecond ?? 1,
                    secondsPerFrame: panelConfig.playback?.secondsPerFrame,
                }).then((started) => {
                    if (started) {
                        console.log(
                            `[tenant-metaverse] FDS smoke playback started (panel): ${panelConfig.fdsSmokeId}`,
                        );
                    }
                });
            },
        );

        this.physicsManager = new PhysicsManager();
        await this.physicsManager.init();

        this.uiManager = new UIManager();
        this.worldManager = new WorldManager(this.sceneManager);
        await Promise.all([this.worldManager.init(), ensureFdsSmokeBulkConfig()]);

        this.worldManager.onWorldChange((world) => {
            void this.fdsSmokeManager.loadForWorld(world);
            this.fdsSmokePanelManager?.loadForWorld(world);
            this.fdsSmokeExposureMonitor?.reset();
            this.updateFdsSmokeButtonZones(world);
            void this.onWorldChanged(world);
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

        this.teleportManager = new TenantTeleportManager(this.worldManager, this.uiManager);
        this.teleportManager.setUserRole(this.userRole);
        this.teleportManager.setFdsSmokeInteractPlayHandler((zone) => {
            void this.fdsSmokeManager.startPlayback(zone.fdsSmokeId, {
                fromFrame: zone.playback?.fromFrame ?? 0,
                loop: zone.playback?.loop !== false,
                framesPerSecond: zone.playback?.framesPerSecond ?? 1,
                secondsPerFrame: zone.playback?.secondsPerFrame,
            }).then((started) => {
                if (started) {
                    console.log(`[tenant-metaverse] FDS smoke playback started: ${zone.fdsSmokeId}`);
                }
            });
        });
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
        this.fdsSmokeExposureMonitor = new TenantFdsSmokeExposureMonitor(
            this.sceneManager.getScene(),
            this.fdsSmokeManager,
            this.playerManager,
        );
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
            this.physicsManager,
        );
        this.characterController.setMobileMode(this.isMobileMode);
        this.teleportManager.setInputActiveCheck(() => this.characterController.isInputActive());
        this.characterController.setPosition(spawnPoint.x, spawnPoint.y, spawnPoint.z);

        await this.playerManager.createLocalPlayer(spawnPoint);
        this.networkManager.startSendingUpdates(this.characterController);

        this.voiceChatManager = new VoiceChatManager(this.networkManager.socket);
        this.videoChatManager = new VideoChatManager(this.networkManager.socket);
        await this._joinVoiceAndVideoIfReady();

        this.chatManager = new ChatManager(
            this.networkManager,
            this.playerManager,
            this.sceneManager,
            { initialMinimized: this.isMobileMode },
        );
        this.chatManager.setCharacterController(this.characterController);
        this.chatManager.setPlayerBlockedCheck((id) => this.playerBlockList.has(id));

        this.captionManager = new CaptionManager(
            this.networkManager,
            this.playerManager,
            this.sceneManager,
        );
        this.captionManager.setCharacterController(this.characterController);
        this.captionManager.setPlayerBlockedCheck((id) => this.playerBlockList.has(id));

        this.playerActionMenu = new TenantPlayerActionMenu({
            blockList: this.playerBlockList,
            chatManager: this.chatManager,
            networkManager: this.networkManager,
            playerManager: this.playerManager,
            isAdmin: this.userRole === 'admin',
            onKick: (targetSocketId) => {
                if (this.userRole !== 'admin' || !this.networkManager?.socket?.connected) return;
                this.networkManager.socket.emit('admin-kick-player', { targetSocketId }, (res) => {
                    if (res?.ok) return;
                    alert(res?.message || 'キックに失敗しました。');
                });
            },
        });
        this.setupRemotePlayerAvatarClick();
        this._onMetaversePlayerNameMenu = (ev) => {
            const d = ev.detail;
            if (!d?.anchorEl || !d.playerId) return;
            this.playerActionMenu.open(d.anchorEl, {
                playerId: d.playerId,
                displayName: d.displayName || 'Player',
            });
        };
        window.addEventListener('metaverse-player-name-menu', this._onMetaversePlayerNameMenu);

        this.uiManager.setPlayerBlockedCheck((id) => this.playerBlockList.has(id));
        this.uiManager.setOnPlayerListNameMenu((playerId, displayName, anchorEl) => {
            this.playerActionMenu.open(anchorEl, { playerId, displayName });
        });
        this.uiManager.setOnPlayerListBlockedClick((playerId) => {
            this.playerBlockList.delete(playerId);
            this.networkManager.reapplyRemoteVisibilityForPlayer(playerId);
        });
        this.uiManager.setOnWatchVideo((peerId) => {
            if (this.videoChatManager) this.videoChatManager.showVideoContainer(peerId);
        });

        if (this.isMobileMode) {
            MobileJoystickManager.init(this.characterController);
            MobileUIManager.init();
            if (this.chatManager && !this.chatManager.isMinimized) {
                this.chatManager.toggleMinimize();
            }
        }

        this.menuManager = new MenuManager();
        this.menuManager.setVoiceChatManager(this.voiceChatManager);
        this.menuManager.setVideoChatManager(this.videoChatManager);
        this.menuManager.setCaptionManager(this.captionManager);
        this.menuManager.setReturnToLobbyCallback(() => {
            const world = this.worldManager.getWorld(DEFAULT_ROOM);
            if (world) {
                this.networkManager.changeWorld(DEFAULT_ROOM, {}, (err) => {
                    if (!err) this.worldManager.loadWorld(DEFAULT_ROOM, () => {});
                });
            }
        });
        this.menuManager.setRestartWorldCallback(async () => {
            try {
                document.exitPointerLock();
            } catch {
                /* ignore */
            }
            this.characterController.resetMovement();
            const sp = this.worldManager.getSpawnPoint();
            this.characterController.setPosition(sp.x, sp.y, sp.z);
            this.characterController.resetVelocity();
            this.playerManager.updateLocalPlayer(
                { x: sp.x, y: sp.y, z: sp.z },
                this.characterController.getRotation(),
            );
        });
        this.menuManager.setSceneManager(this.sceneManager);
        this.menuManager.setPlayerManager(this.playerManager);
        this.sceneManager.applyGraphicsSettings(this.menuManager.settings);
        this.playerManager.applyVisualMode(this.menuManager.settings.visualMode);
        this.characterController.setHeadPositionProvider((out) =>
            this.playerManager.getLocalHeadWorldPosition(out),
        );

        this.refreshLocalAvatarVisibility = () => {
            if (!this.playerManager) return;
            const mode = this.menuManager?.settings?.viewMode || 'third';
            const hideForFirst = mode === 'first';
            const hideForAdmin = !!(this.networkManager && this.networkManager.adminInvisible);
            this.playerManager.setLocalPlayerVisible(!hideForFirst && !hideForAdmin);
        };

        this.characterController.setViewMode(this.menuManager.settings.viewMode || 'third');
        this.refreshLocalAvatarVisibility();
        this.menuManager.setViewModeChangeHandler((mode) => {
            this.characterController.setViewMode(mode);
            this.refreshLocalAvatarVisibility();
        });

        if (this.userRole === 'admin') {
            this.menuManager.setAdminMenuHandlers({
                onInvisibleChange: (enabled) => {
                    if (this.networkManager) {
                        this.networkManager.setAdminInvisible(enabled);
                        this.networkManager.flushPlayerUpdate?.(this.characterController);
                    }
                    this.refreshLocalAvatarVisibility();
                },
                onFlyChange: (enabled) => {
                    this.characterController?.setFlyMode(enabled);
                },
                onSpeedChange: (enabled) => {
                    this.characterController?.setAdminSpeedMultiplier(enabled ? 3 : 1);
                },
            });
            const adminLink = document.querySelector('#admin-menu .admin-menu-link');
            if (adminLink) adminLink.setAttribute('href', '/admin.html');
        }

        document.addEventListener('keydown', (e) => {
            if (e.code !== 'KeyV' || e.repeat) return;
            if (this.sceneManager?.getRenderer?.()?.xr?.isPresenting) return;
            const input = document.activeElement?.tagName?.toLowerCase();
            if (input === 'input' || input === 'textarea') return;
            const videoOn = (this.networkManager?.lastPlayersSnapshot || []).find((p) => p.vcVideoOn);
            if (videoOn && this.videoChatManager) {
                this.videoChatManager.showVideoContainer(videoOn.id);
                return;
            }
            this.menuManager?.toggleViewMode?.();
        });

        // 初回の移動系入力まで落下・歩行物理を止める（metaverse-simple main と同様）
        this.characterController.setSuspendPhysicsUntilGameplayInput(true);
        IdleControlHint.start(this);

        this.clock = performance.now();
        this._frameCallback = (timeMs) => this.frameUpdate(timeMs);
        const renderer = this.sceneManager.getRenderer();
        renderer.setAnimationLoop(this._frameCallback);
        window.addEventListener('beforeunload', () => {
            renderer.setAnimationLoop(null);
            IdleControlHint.stop();
            this.fdsSmokeManager?.dispose();
            this.fdsSmokePanelManager?.dispose();
            window.removeEventListener('metaverse-player-name-menu', this._onMetaversePlayerNameMenu);
            const canvas = document.getElementById('canvas');
            if (canvas && this._onRemotePlayerAvatarPointerDown) {
                canvas.removeEventListener('pointerdown', this._onRemotePlayerAvatarPointerDown);
            }
        });

        console.log(`[tenant-metaverse] initialized for ${tenantId}`);
        const e2eHarnessEnabled =
            document.documentElement.dataset.e2eHarness === '1' ||
            window.__TENANT_E2E_HARNESS__ === '1';
        if (e2eHarnessEnabled) {
            window.__tenantE2E = {
                getSocket: () => this.networkManager?.socket ?? null,
                getVoiceChatManager: () => this.voiceChatManager ?? null,
                getVideoChatManager: () => this.videoChatManager ?? null,
                getChatManager: () => this.chatManager ?? null,
                getNetworkManager: () => this.networkManager ?? null,
                getCurrentWorldId: () => this.worldManager?.getCurrentWorldId?.() ?? null,
                fdsSmokeHasEntries: () => Boolean(this.fdsSmokeManager?.hasEntries()),
                countMeshesNamed: (name) => {
                    let total = 0;
                    let visible = 0;
                    const scene = this.sceneManager?.getScene?.();
                    scene?.traverse((obj) => {
                        if (obj.name !== name) return;
                        total += 1;
                        if (obj.visible) visible += 1;
                    });
                    return { total, visible };
                },
                switchToWorld: (worldId) =>
                    new Promise((resolve, reject) => {
                        if (!this.worldManager?.getWorld(worldId)) {
                            reject(new Error(`unknown world: ${worldId}`));
                            return;
                        }
                        this.networkManager.changeWorld(worldId, {}, (err) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            this.worldManager.loadWorld(worldId, () => resolve(worldId));
                        });
                    }),
                loadFdsSmokeFromWorld: async (worldId) => {
                    const world = this.worldManager?.getWorld(worldId);
                    if (!world) {
                        throw new Error(`unknown world: ${worldId}`);
                    }
                    await this.fdsSmokeManager.loadForWorld(world);
                },
                getLocalPosition: () => {
                    const pos = this.characterController?.getPosition?.();
                    if (!pos) return null;
                    return { x: pos.x, y: pos.y, z: pos.z };
                },
                isPhysicsSuspended: () =>
                    Boolean(this.characterController?.isPhysicsSuspended?.()),
                holdMovementForE2e: (axis, durationMs = 500) =>
                    new Promise((resolve, reject) => {
                        const cc = this.characterController;
                        if (!cc) {
                            reject(new Error('characterController unavailable'));
                            return;
                        }
                        const ms = Math.max(0, Number(durationMs) || 0);
                        cc.notifyGameplayInputIntent();
                        const setters = {
                            forward: () => {
                                cc.moveForward = true;
                            },
                            backward: () => {
                                cc.moveBackward = true;
                            },
                            left: () => {
                                cc.moveLeft = true;
                            },
                            right: () => {
                                cc.moveRight = true;
                            },
                        };
                        const clear = () => {
                            cc.moveForward = false;
                            cc.moveBackward = false;
                            cc.moveLeft = false;
                            cc.moveRight = false;
                        };
                        const apply = setters[axis];
                        if (!apply) {
                            reject(new Error(`unknown movement axis: ${axis}`));
                            return;
                        }
                        apply();
                        window.setTimeout(() => {
                            clear();
                            const pos = cc.getPosition();
                            resolve(
                                pos
                                    ? { x: pos.x, y: pos.y, z: pos.z }
                                    : null,
                            );
                        }, ms);
                    }),
            };
        }
        document.documentElement.dataset.tenantMetaverseReady = 'true';
    }

    async onWorldChanged(world) {
        if (!world?.id) return;
        // init 中の初回 loadWorld は characterController より先に onWorldChange が走る
        if (!this.characterController) {
            return;
        }
        const spawnPoint = world.spawnPoint || this.worldManager.getSpawnPoint();
        this.characterController.setPosition(spawnPoint.x, spawnPoint.y, spawnPoint.z);
        this.characterController.resetVelocity();
        this.playerManager.updateLocalPlayer(
            { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z },
            this.characterController.getRotation(),
        );
        this.networkManager.changeWorld(world.id);
        this.updateTeleportZones();

        const roomChangeTasks = [];
        if (this.voiceChatManager?.isJoined) {
            roomChangeTasks.push(
                this.voiceChatManager.changeRoom(world.id).catch((error) => {
                    console.error('[VC] Failed to change room:', error);
                }),
            );
        }
        if (this.videoChatManager?.isJoined) {
            roomChangeTasks.push(
                this.videoChatManager.changeRoom(world.id).catch((error) => {
                    console.error('[Video VC] Failed to change room:', error);
                }),
            );
        }
        if (roomChangeTasks.length) {
            await Promise.all(roomChangeTasks);
        }
    }

    async _onNetworkPostConnect() {
        if (!this._worldReadyForNetwork) {
            this._networkConnectPendingRoomSync = true;
            return;
        }
        await this._applyInitialRoomSync();
        await this._joinVoiceAndVideoIfReady();
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

    async _joinVoiceAndVideoIfReady() {
        if (!this.networkManager?.socket?.connected) return;
        const roomId = this.worldManager?.getCurrentWorldId() || DEFAULT_ROOM;
        const joinTasks = [];
        if (this.voiceChatManager && !this.voiceChatManager.isJoined) {
            joinTasks.push(
                this.voiceChatManager.joinRoom(roomId).catch((error) => {
                    console.error('[VC] Failed to auto-join:', error);
                }),
            );
        }
        if (this.videoChatManager && !this.videoChatManager.isJoined) {
            joinTasks.push(
                this.videoChatManager.joinRoom(roomId).catch((error) => {
                    console.error('[Video VC] Failed to auto-join:', error);
                }),
            );
        }
        if (joinTasks.length) {
            await Promise.all(joinTasks);
        }
    }

    frameUpdate(timeMs) {
        const currentTime = timeMs;
        let deltaTime = (currentTime - this.clock) / 1000;
        this.clock = currentTime;

        const MAX_DELTA_TIME = 0.1;
        if (deltaTime > MAX_DELTA_TIME) deltaTime = MAX_DELTA_TIME;

        runFrameUpdates(this, deltaTime, timeMs);

        this.fdsSmokeManager?.update(deltaTime);
        this.fdsSmokePanelManager?.update();
        this.fdsSmokeExposureMonitor?.update(deltaTime);

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

            if (
                this.fdsSmokePanelManager?.isAimingAtPlayButton()
                && this.fdsSmokePanelManager.shouldShowCrosshair()
            ) {
                this.uiManager.hideTeleportPrompt();
            } else if (this.teleportManager?.nearestFdsSmokeInteractZone) {
                this.uiManager.showGlbAnimInteractPrompt(
                    this.formatFdsSmokeButtonPrompt(this.teleportManager.nearestFdsSmokeInteractZone),
                );
            } else if (this.teleportManager?.nearestZone) {
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

        if (this.fdsSmokeManager?.hasEntries()) {
            this.fdsSmokeManager.prepareRender(
                this.sceneManager.getRenderer(),
                this.sceneManager.getScene(),
                this.sceneManager.getCamera(),
            );
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
