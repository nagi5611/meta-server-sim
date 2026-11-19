import { sendResendEmail, isResendConfigured } from './resend-mail.js';
import { getLobbyUserByKindId } from '../db/users.js';
import { buildLobbyBanNotificationText } from './lobby-ban.js';

/**
 * @param {string} email
 */
function isDeliverableEmail(email) {
    return Boolean(
        email &&
            !email.endsWith('@mmh.local') &&
            /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email),
    );
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * @param {'student'|'teacher'} kind
 * @param {number} id
 * @param {{ banExpiresAt?: string | null }} [opts]
 */
export async function sendLobbyBanNotificationEmail(kind, id, opts = {}) {
    if (!isResendConfigured()) {
        return { ok: false, skipped: true, reason: 'RESEND_NOT_CONFIGURED' };
    }
    const user = await getLobbyUserByKindId(kind, id);
    if (!user) {
        return { ok: false, skipped: true, reason: 'NOT_FOUND' };
    }
    const email = String(user.email || '').trim();
    if (!isDeliverableEmail(email)) {
        return { ok: false, skipped: true, reason: 'EMAIL_REQUIRED' };
    }
    const banExpiresAt = opts.banExpiresAt !== undefined ? opts.banExpiresAt : user.banExpiresAt;
    const text = buildLobbyBanNotificationText(banExpiresAt);
    const name = user.displayName || user.username;
    await sendResendEmail({
        to: email,
        subject: '【みんなでメタ】アカウント利用停止のお知らせ',
        text,
        html: `<p>${escapeHtml(name)} さん</p>
<p>${escapeHtml(text)}</p>`,
    });
    return { ok: true, email };
}