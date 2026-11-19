// public/js/hub-lobby-auth.js — hub ログイン後は公開ロビーへ

import { resolveLobbyExitUrl } from './tenant-lobby-exit.js';

/**
 * 認証成功後の遷移先（logout と同一の lobbyPublicUrl 解決）
 * @returns {Promise<void>}
 */
export async function navigateToPublicLobbyAfterLogin() {
    window.location.href = await resolveLobbyExitUrl();
}

/**
 * @param {unknown} data
 * @returns {string}
 */
function mapLoginError(data) {
    const code = data && typeof data === 'object' ? data.error : '';
    if (code === 'banned') return 'アカウントが利用停止です。';
    if (code === 'invalid_credentials') return 'メールアドレスまたはパスワードが正しくありません。';
    if (code === 'username_and_password_required') return 'メールアドレスとパスワードを入力してください。';
    return 'ログインに失敗しました。時間をおいて再度お試しください。';
}

/**
 * プラットフォーム hub のログインフォーム
 */
export function wireHubLobbyLogin() {
    const form = document.getElementById('hub-login-form');
    if (!form) return;

    const emailInput = /** @type {HTMLInputElement | null} */ (document.getElementById('hub-login-email'));
    const passInput = /** @type {HTMLInputElement | null} */ (document.getElementById('hub-login-password'));
    const errEl = document.getElementById('hub-login-error');
    const submitBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('hub-login-submit'));

    const showError = (msg) => {
        if (!errEl) return;
        errEl.textContent = msg;
        errEl.hidden = !msg;
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        showError('');

        const username = String(emailInput?.value || '').trim();
        const password = String(passInput?.value || '');
        if (!username || !password) {
            showError('メールアドレスとパスワードを入力してください。');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.dataset.prevLabel = submitBtn.textContent || '';
            submitBtn.textContent = '認証中…';
        }

        try {
            const res = await fetch('/api/lobby/auth/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showError(mapLoginError(data));
                return;
            }
            await navigateToPublicLobbyAfterLogin();
        } catch {
            showError('ログインに失敗しました。時間をおいて再度お試しください。');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = submitBtn.dataset.prevLabel || 'ログインしてロビーへ';
            }
        }
    });
}

/**
 * フッターの公開ロビーリンクを client-config に合わせる
 */
export async function wireHubLobbyFooterLink() {
    const link = /** @type {HTMLAnchorElement | null} */ (document.getElementById('hub-lobby-link'));
    if (!link) return;
    try {
        link.href = await resolveLobbyExitUrl();
    } catch {
        /* keep default href */
    }
}