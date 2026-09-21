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
 * @param {{ mode?: 'force' | 'planned', delayMinutes?: number, delaySeconds?: number, message?: string }} [options]
 */
export async function restartPlatformFromAdmin(options = {}) {
    const body =
        options.mode === 'planned'
            ? {
                  mode: 'planned',
                  delayMinutes: options.delayMinutes ?? 0,
                  delaySeconds: options.delaySeconds ?? 0,
                  message: options.message ?? '',
              }
            : { mode: 'force' };

    const res = await adminFetch('/admin/restart', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
    }
    return data;
}

/**
 * 再起動モーダルを開く
 */
function openRestartModal() {
    const modal = document.getElementById('admin-restart-modal');
    if (!modal) {
        return false;
    }
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    const forceRadio = modal.querySelector('input[name="restart-mode"][value="force"]');
    if (forceRadio instanceof HTMLInputElement) {
        forceRadio.focus();
    }
    return true;
}

/**
 * 再起動モーダルを閉じる
 */
function closeRestartModal() {
    const modal = document.getElementById('admin-restart-modal');
    if (!modal) {
        return;
    }
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
}

/**
 * モーダルから再起動パラメータを読み取る
 */
function readRestartModalForm() {
    const modal = document.getElementById('admin-restart-modal');
    if (!modal) {
        return { mode: 'force' };
    }
    const modeInput = modal.querySelector('input[name="restart-mode"]:checked');
    const mode = modeInput?.value === 'planned' ? 'planned' : 'force';
    const minutesEl = document.getElementById('admin-restart-delay-minutes');
    const secondsEl = document.getElementById('admin-restart-delay-seconds');
    const messageEl = document.getElementById('admin-restart-alert-message');
    return {
        mode,
        delayMinutes: Number(minutesEl?.value ?? 0),
        delaySeconds: Number(secondsEl?.value ?? 0),
        message: String(messageEl?.value ?? '').trim(),
    };
}

/**
 * 計画再起動フィールドの表示切替
 */
function syncPlannedRestartFieldsVisibility() {
    const modal = document.getElementById('admin-restart-modal');
    const plannedFields = document.getElementById('admin-restart-planned-fields');
    if (!modal || !plannedFields) {
        return;
    }
    const modeInput = modal.querySelector('input[name="restart-mode"]:checked');
    const isPlanned = modeInput?.value === 'planned';
    plannedFields.hidden = !isPlanned;
}

/**
 * 再起動モーダルのイベントを配線する
 */
function wireRestartModal() {
    const modal = document.getElementById('admin-restart-modal');
    if (!modal) {
        return;
    }
    modal.querySelectorAll('[data-modal-close]').forEach((el) => {
        el.addEventListener('click', () => closeRestartModal());
    });
    modal.querySelectorAll('input[name="restart-mode"]').forEach((el) => {
        el.addEventListener('change', () => syncPlannedRestartFieldsVisibility());
    });
    syncPlannedRestartFieldsVisibility();
}

/**
 * 強制再起動の完了待ち（管理画面の再接続）
 * @param {(text: string) => void} setStatus
 */
async function waitForForceRestartComplete(setStatus) {
    setStatus('サーバー停止中…');
    const online = await waitForServerOnline();
    if (online) {
        setStatus('再起動完了');
        window.location.reload();
    } else {
        setStatus(
            'Node (3002) が起動していません。ターミナルで Ctrl+C → npm run dev を実行してください。'
        );
    }
    return online;
}

/**
 * 再読み込み・再起動ボタンを配線する
 * @param {{ onReloadSuccess?: (data: object) => void | Promise<void> }} options
 */
export function wirePlatformOpsButtons(options = {}) {
    const reloadBtn = document.getElementById('admin-reload-settings-btn');
    const restartBtn = document.getElementById('admin-restart-btn');
    const restartSubmitBtn = document.getElementById('admin-restart-submit-btn');
    const statusEl = document.getElementById('admin-ops-status');

    const setStatus = (text) => {
        if (statusEl) statusEl.textContent = text;
    };

    wireRestartModal();

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

    const runRestart = async () => {
        const params = readRestartModalForm();
        if (params.mode === 'planned') {
            if (!params.message) {
                alert('プレイヤー向けアラートメッセージを入力してください');
                return;
            }
        } else if (
            !confirm(
                'サーバーを強制再起動します。\n接続中のプレイヤーは切断されます。続行しますか？'
            )
        ) {
            return;
        }

        if (restartBtn) restartBtn.disabled = true;
        if (reloadBtn) reloadBtn.disabled = true;
        if (restartSubmitBtn) restartSubmitBtn.disabled = true;

        try {
            if (params.mode === 'planned') {
                setStatus('計画再起動を予約中…');
                const data = await restartPlatformFromAdmin(params);
                closeRestartModal();
                setStatus(data.message || '計画再起動を予約しました');
            } else {
                closeRestartModal();
                setStatus('再起動を送信しました…');
                await restartPlatformFromAdmin({ mode: 'force' });
                const online = await waitForForceRestartComplete(setStatus);
                if (!online) {
                    if (restartBtn) restartBtn.disabled = false;
                    if (reloadBtn) reloadBtn.disabled = false;
                }
            }
        } catch (e) {
            setStatus('');
            alert(e instanceof Error ? e.message : '再起動に失敗しました');
            if (restartBtn) restartBtn.disabled = false;
            if (reloadBtn) reloadBtn.disabled = false;
        } finally {
            if (restartSubmitBtn) restartSubmitBtn.disabled = false;
            if (params.mode === 'planned') {
                if (restartBtn) restartBtn.disabled = false;
                if (reloadBtn) reloadBtn.disabled = false;
            }
        }
    };

    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            if (!openRestartModal()) {
                void runRestart();
            }
        });
    }

    if (restartSubmitBtn) {
        restartSubmitBtn.addEventListener('click', () => {
            void runRestart();
        });
    }
}
