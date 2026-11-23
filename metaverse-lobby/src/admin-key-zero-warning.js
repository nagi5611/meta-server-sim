import { countActiveAdminEd25519Keys } from './db-ops.js';

/**
 * ログイン第2要素の判定用（D1 の有効鍵のみ。env bootstrap は秘密鍵がサーバーに無い場合は数えない）。
 * @param {D1Database | undefined} db
 */
export async function countRegisteredActiveAdminKeys(db) {
    return countActiveAdminEd25519Keys(db);
}
import { ADMIN_KEY_REGISTER_NOTIFY_EMAIL } from './admin-ed25519-auth.js';
import { formatJstTimestamp, sendAdminOtpEmail } from './admin-super-login.js';

const WARNING_KV_KEY = 'admin_ed25519_zero_keys_warn';
const WARNING_COOLDOWN_SEC = 3600;

const RECOVERY_STEPS = `復旧手順:
1. admin でパスワード入力後、Resend で developer@mmh-virtual.jp へ届くメール OTP でログイン（鍵ゼロ本時のフォールバック）。
2. ログイン後、管理画面「設定 → Ed25519 鍵」で新しい鍵ペアを発行し、秘密鍵を安全に保管する。
3. またはローカルで鍵ペアを生成し、公開鍵のみ D1 / Worker ADMIN_ED25519_PUBLIC_KEY に登録。
4. 鍵登録後はパスワード + 秘密鍵署名が第2要素に戻る。`;

/**
 * @param {Record<string, unknown>} env
 * @param {D1Database | undefined} db
 */
export async function countBootstrapActiveAdminKeys(env, db) {
    const dbCount = await countActiveAdminEd25519Keys(db);
    const envKey = String(env.ADMIN_ED25519_PUBLIC_KEY || '').trim();
    return dbCount + (envKey ? 1 : 0);
}

/**
 * @param {KVNamespace} kv
 */
async function maySendZeroKeysWarning(kv) {
    const now = Math.floor(Date.now() / 1000);
    const last = Number(await kv.get(WARNING_KV_KEY)) || 0;
    if (last > 0 && now - last < WARNING_COOLDOWN_SEC) {
        return { ok: false, reason: 'rate_limited', retryAfterSec: WARNING_COOLDOWN_SEC - (now - last) };
    }
    await kv.put(WARNING_KV_KEY, String(now), { expirationTtl: WARNING_COOLDOWN_SEC + 60 });
    return { ok: true };
}

/**
 * @param {Record<string, unknown>} env
 * @param {KVNamespace} kv
 * @param {{ reason: 'startup' | 'login_attempt', clientIp?: string }} ctx
 */
export async function maybeNotifyZeroAdminKeys(env, kv, ctx) {
    const db = /** @type {D1Database | undefined} */ (env.LOBBY_DB);
    const d1Active = await countRegisteredActiveAdminKeys(db);
    if (d1Active > 0) return { sent: false, reason: 'keys_present', activeCount: d1Active };

    const gate = await maySendZeroKeysWarning(kv);
    if (!gate.ok) return { sent: false, reason: gate.reason, retryAfterSec: gate.retryAfterSec };

    const atJst = formatJstTimestamp();
    const reasonJa =
        ctx.reason === 'startup'
            ? 'Worker 起動時（定期／wake）に有効な公開鍵が 0 件でした。'
            : `admin ユーザーがログインを試みましたが、有効な公開鍵が 0 件です。IP: ${ctx.clientIp || '—'}`;

    const text = [
        '【警告】みんなでメタ スーパー管理者の Ed25519 公開鍵が 1 件も登録されていません。',
        '',
        reasonJa,
        `検知日時 (JST): ${atJst}`,
        '',
        'D1 に有効な登録鍵がありません。Resend 設定時はメール OTP でログインし、管理画面から鍵を再発行してください。',
        '',
        RECOVERY_STEPS,
    ].join('\n');

    const html = `<p><strong>警告:</strong> スーパー管理者の Ed25519 公開鍵が 0 件です。</p>
<p>${escapeHtml(reasonJa)}</p>
<p>検知日時 (JST): ${escapeHtml(atJst)}</p>
<pre style="white-space:pre-wrap">${escapeHtml(RECOVERY_STEPS)}</pre>`;

    try {
        const mail = await sendAdminOtpEmail(env, {
            to: ADMIN_KEY_REGISTER_NOTIFY_EMAIL,
            subject: '【みんなでメタ】管理者公開鍵未登録の警告',
            html,
            text,
        });
        return { sent: true, resendMessageId: mail?.id || null, activeCount: 0 };
    } catch (err) {
        const code = /** @type {{ code?: string }} */ (err).code;
        return { sent: false, reason: code || 'send_failed' };
    }
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}