#!/usr/bin/env node
/**
 * Resend smoke test (no mail if RESEND_API_KEY missing).
 * Usage: RESEND_TO=test@example.com node scripts/lobby-resend-smoke.mjs
 */
import 'dotenv/config';
import { isResendConfigured, sendResendEmail } from '../lib/resend-mail.js';

const to = String(process.env.RESEND_TO || '').trim();
if (!to) {
    console.error('Set RESEND_TO=recipient@domain.com');
    process.exit(1);
}
if (!isResendConfigured()) {
    console.error('RESEND_API_KEY not set');
    process.exit(2);
}
const result = await sendResendEmail({
    to,
    subject: '【みんなでメタ】Resend smoke test',
    html: '<p>Smoke test OK.</p>',
    text: 'Smoke test OK.',
});
console.log(JSON.stringify(result, null, 2));