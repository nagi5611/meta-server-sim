// Transactional email via Resend (https://resend.com)

/**
 * @returns {boolean}
 */
export function isResendConfigured() {
    return Boolean(String(process.env.RESEND_API_KEY || '').trim());
}

/**
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 */
export async function sendResendEmail(opts) {
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    if (!apiKey) {
        const err = new Error('RESEND_API_KEY not configured');
        err.code = 'RESEND_NOT_CONFIGURED';
        throw err;
    }
    const from = String(process.env.RESEND_FROM_EMAIL || 'みんなでメタ <onboarding@resend.dev>').trim();
    const to = String(opts.to || '').trim();
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
        const err = new Error('invalid_recipient_email');
        err.code = 'INVALID_EMAIL';
        throw err;
    }
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: [to],
            subject: String(opts.subject || '').slice(0, 200),
            html: opts.html,
            text: opts.text || undefined,
        }),
        signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data?.message || data?.error || `Resend HTTP ${res.status}`);
        err.code = 'RESEND_SEND_FAILED';
        err.status = res.status;
        err.detail = data;
        throw err;
    }
    return { ok: true, id: data.id };
}