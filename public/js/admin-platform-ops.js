// public/js/admin-platform-ops.js — 設定再読み込み・完全再起動
import { adminFetch } from './admin-api-fetch.js';

/**
 * サーバー復帰までポーリングする
 * @param {number} timeoutMs
 */
async function waitForServerOnline(timeoutMs = 90000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch('/api/health', { cache: 'no-store' });
            if (res.ok) return true;
        } catch {
            /* 再起動中 */
        }
        await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
}

/**
 * プラットフォーム設定を再読み込みする
 */
export async function reloadPlatformSettingsFromAdmin() {
    const res = await adminFetch('/admin/reload-settings', {
        method: 'POST',
        credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
    }
    return data;
}

/**
 * プラットフォームを完全再起動する
 */
export async function restartPlatformFromAdmin() {
    const res = await adminFetch('/admin/restart', {
        method: 'POST',
        credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
    }
    return data;
}

/**
 * 再読み込み・再起動ボタンを配線する
 * @param {{ onReloadSuccess?: (data: object) => void | Promise<void> }} options
 */
export function wirePlatformOpsButtons(options = {}) {
    const reloadBtn = document.getElementById('admin-reload-settings-btn');
    const restartBtn = document.getElementById('admin-restart-btn');
    const statusEl = document.getElementById('admin-ops-status');

    const setStatus = (text) => {
        if (statusEl) statusEl.textContent = text;
    };

    if (reloadBtn) {
        reloadBtn.addEventListener('click', async () => {
            reloadBtn.disabled = true;
            setStatus('設定を再読み込み中…');
            try {
                const data = await reloadPlatformSettingsFromAdmin();
                setStatus(data.message || '再読み込み完了');
                if (options.onReloadSuccess) {
                    await options.onReloadSuccess(data);
                }
            } catch (e) {
                setStatus('');
                alert(e instanceof Error ? e.message : '再読み込みに失敗しました');
            } finally {
                reloadBtn.disabled = false;
            }
        });
    }

    if (restartBtn) {
        restartBtn.addEventListener('click', async () => {
            if (
                !confirm(
                    'サーバーを完全再起動します。\n接続中のプレイヤーは切断されます。続行しますか？'
                )
            ) {
                return;
            }
            restartBtn.disabled = true;
            if (reloadBtn) reloadBtn.disabled = true;
            setStatus('再起動を送信しました…');
            try {
                await restartPlatformFromAdmin();
                setStatus('サーバー停止中…');
                const online = await waitForServerOnline();
                if (online) {
                    setStatus('再起動完了');
                    window.location.reload();
                } else {
                    setStatus(
                        'Node (3002) が起動していません。ターミナルで Ctrl+C → npm run dev を実行してください。'
                    );
                    restartBtn.disabled = false;
                    if (reloadBtn) reloadBtn.disabled = false;
                }
            } catch (e) {
                setStatus('');
                alert(e instanceof Error ? e.message : '再起動に失敗しました');
                restartBtn.disabled = false;
                if (reloadBtn) reloadBtn.disabled = false;
            }
        });
    }
}
