// Password reset tokens (users DB) + Resend delivery

import crypto from 'node:crypto';
import { sendResendEmail, isResendConfigured } from './resend-mail.js';
import {
    consumePasswordResetToken,
    createPasswordResetToken,
    getUserForPasswordReset,
} from '../db/users.js';

const TOKEN_TTL_MS = 60 * 60 * 1000;

function resetBaseUrl() {
    const fromEnv = String(process.env.LOBBY_PASSWORD_RESET_URL || '').trim();
    if (fromEnv) return fromEnv.replace(/\?.*$/, '').replace(/\/$/, '');
    return 'https://m.mmh-virtual.jp/reset-password.html';
}

/**
 * @param {'student'|'teacher'} kind
 * @param {number} id
 */
export async function sendLobbyPasswordResetEmail(kind, id) {
    if (!isResendConfigured()) {
        const err = new Error('Resend is not configured');
        err.code = 'RESEND_NOT_CONFIGURED';
        throw err;
    }
    const user = await getUserForPasswordReset(kind, id);
    if (!user) {
        const err = new Error('user_not_found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    const email = String(user.email || '').trim();
    if (!email || email.endsWith('@mmh.local') || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        const err = new Error('user_email_missing');
        err.code = 'EMAIL_REQUIRED';
        throw err;
    }
    const { token, expiresAt } = await createPasswordResetToken(kind, id, TOKEN_TTL_MS);
    const link = `${resetBaseUrl()}?token=${encodeURIComponent(token)}`;
    const name = user.displayName || user.username;
    await sendResendEmail({
        to: email,
        subject: '【みんなでメタ】パスワードの再設定',
        html: `<p>${escapeHtml(name)} さん</p>
<p>パスワード再設定のリクエストを受け付けました。次のリンクから新しいパスワードを設定してください（有効期限 ${formatJp(expiresAt)}）。</p>
<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
<p>心当たりがない場合はこのメールを無視してください。</p>`,
        text: `${name} さん\n\nパスワード再設定:\n${link}\n\n有効期限: ${expiresAt.toISOString()}`,
    });
    return { ok: true, email, expiresAt: expiresAt.toISOString() };
}

/**
 * @param {string} token
 * @param {string} newPassword
 */
export async function completeLobbyPasswordReset(token, newPassword) {
    const raw = String(token || '').trim();
    if (!raw) {
        const err = new Error('token_required');
        err.code = 'INVALID_TOKEN';
        throw err;
    }
    return consumePasswordResetToken(raw, newPassword);
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatJp(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function hashResetToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}