// public/js/tenant-shell.js
import { io } from 'socket.io-client';

/**
 * URL から tenant ID を取得（/P-01/ 形式）
 * @returns {string | null}
 */
function getTenantIdFromPath() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length < 1) return null;
    return parts[0];
}

/**
 * tenant 検証ページの Socket・worlds 表示を初期化する
 */
async function initTenantShell() {
    const tenantId = getTenantIdFromPath();
    const titleEl = document.getElementById('tenant-title');
    const socketStatusEl = document.getElementById('socket-status');
    const playerCountEl = document.getElementById('player-count');
    const worldsEl = document.getElementById('worlds-json');

    if (!tenantId) {
        if (socketStatusEl) socketStatusEl.textContent = 'tenant ID を URL から取得できません';
        return;
    }

    if (titleEl) titleEl.textContent = tenantId;

    const apiBase = `/${tenantId}`;

    try {
        const worldsRes = await fetch(`${apiBase}/api/worlds`);
        if (!worldsRes.ok) throw new Error(`worlds HTTP ${worldsRes.status}`);
        const worldsData = await worldsRes.json();
        if (worldsEl) {
            worldsEl.textContent = JSON.stringify(worldsData.worlds ?? worldsData, null, 2);
        }
    } catch (e) {
        if (worldsEl) {
            worldsEl.textContent = `worlds 読み込み失敗: ${e instanceof Error ? e.message : e}`;
        }
    }

    let localPlayerCount = 0;

    const socket = io({
        path: `/${tenantId}/socket.io`,
        transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
        if (socketStatusEl) {
            socketStatusEl.textContent = `接続済み（id: ${socket.id}）`;
        }
    });

    socket.on('sim:hello', (payload) => {
        if (socketStatusEl && payload?.tenantId) {
            socketStatusEl.textContent = `tenant ${payload.tenantId} 接続済み（id: ${socket.id}）`;
        }
    });

    socket.on('current-players', (players) => {
        localPlayerCount = Array.isArray(players) ? players.length : 0;
        if (playerCountEl) playerCountEl.textContent = String(localPlayerCount);
    });

    socket.on('player-joined', () => {
        localPlayerCount += 1;
        if (playerCountEl) playerCountEl.textContent = String(localPlayerCount);
    });

    socket.on('player-left', () => {
        localPlayerCount = Math.max(0, localPlayerCount - 1);
        if (playerCountEl) playerCountEl.textContent = String(localPlayerCount);
    });

    socket.on('disconnect', () => {
        if (socketStatusEl) socketStatusEl.textContent = '切断';
    });

    socket.on('connect_error', () => {
        if (socketStatusEl) socketStatusEl.textContent = '接続エラー';
    });

    socket.emit('set-username', { username: `Guest-${Math.floor(Math.random() * 9000) + 1000}` });
}

initTenantShell();
