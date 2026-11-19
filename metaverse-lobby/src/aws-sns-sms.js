import { AwsClient } from 'aws4fetch';

const DEFAULT_SNS_REGION = 'ap-northeast-1';

/**
 * @param {Record<string, unknown>} env
 * @returns {boolean}
 */
export function isAwsSnsConfigured(env) {
    return Boolean(
        String(env.AWS_ACCESS_KEY_ID || '').trim() &&
            String(env.AWS_SECRET_ACCESS_KEY || '').trim(),
    );
}

/**
 * @param {Record<string, unknown>} env
 * @returns {string}
 */
export function getAwsSnsRegion(env) {
    return String(env.AWS_SNS_REGION || DEFAULT_SNS_REGION).trim() || DEFAULT_SNS_REGION;
}

/**
 * Japan mobile / landline → E.164 (+81…). Accepts +81…, 81…, 0-prefixed domestic, spaces/dashes.
 * @param {string} input
 * @returns {string | null}
 */
export function normalizeJapanPhoneE164(input) {
    let s = String(input || '').trim().replace(/[\s\-()]/g, '');
    if (!s) return null;
    if (s.startsWith('+')) {
        const digits = s.slice(1).replace(/\D/g, '');
        if (digits.startsWith('81') && digits.length >= 11 && digits.length <= 13) {
            return `+${digits}`;
        }
        return null;
    }
    const digits = s.replace(/\D/g, '');
    if (digits.startsWith('81') && digits.length >= 11 && digits.length <= 13) {
        return `+${digits}`;
    }
    if (digits.startsWith('0') && digits.length >= 10 && digits.length <= 11) {
        return `+81${digits.slice(1)}`;
    }
    return null;
}

/**
 * @param {string} phoneE164
 * @returns {string}
 */
export function maskAdminPhone(phoneE164) {
    const p = String(phoneE164 || '').trim();
    if (p.length < 8) return '***';
    const tail = p.slice(-4);
    const head = p.slice(0, Math.min(4, p.length - 4));
    return `${head}***${tail}`;
}

/**
 * @param {{ code: string, clientIp: string, atJst: string }} opts
 * @returns {string}
 */
export function buildOtpSmsMessage({ code, clientIp, atJst }) {
    return `【みんなでメタ】管理ログイン確認コード: ${code}（10分有効） IP:${clientIp} ${atJst}`;
}

/**
 * @param {Record<string, unknown>} env
 * @param {string} phoneE164
 * @param {string} message
 * @param {(url: string, init: RequestInit) => Promise<Response>} [fetchImpl]
 */
export async function snsPublishSms(env, phoneE164, message, fetchImpl) {
    const region = getAwsSnsRegion(env);
    const endpoint = `https://sns.${region}.amazonaws.com/`;
    const params = new URLSearchParams({
        Action: 'Publish',
        Version: '2010-03-31',
        PhoneNumber: phoneE164,
        Message: message,
        'MessageAttributes.entry.1.Name': 'AWS.SNS.SMS.SMSType',
        'MessageAttributes.entry.1.Value.DataType': 'String',
        'MessageAttributes.entry.1.Value.StringValue': 'Transactional',
    });
    const client = new AwsClient({
        accessKeyId: String(env.AWS_ACCESS_KEY_ID || '').trim(),
        secretAccessKey: String(env.AWS_SECRET_ACCESS_KEY || '').trim(),
        region,
        service: 'sns',
    });
    const doFetch = fetchImpl || ((url, init) => client.fetch(url, init));
    const res = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
        body: params.toString(),
    });
    const text = await res.text();
    if (!res.ok) {
        const err = new Error(`SNS HTTP ${res.status}`);
        err.code = 'SNS_SEND_FAILED';
        err.detail = text.slice(0, 500);
        throw err;
    }
    const idMatch = text.match(/<MessageId>([^<]+)<\/MessageId>/);
    return { ok: true, id: idMatch?.[1] || 'sns' };
}

/**
 * @param {Record<string, unknown>} env
 * @param {{ phone: string, message: string }} opts
 */
export async function sendAdminOtpSms(env, opts) {
    /** @type {Array<Record<string, unknown>> | undefined} */
    const sink = env.__test_sms_sink;
    const phoneE164 = normalizeJapanPhoneE164(opts.phone);
    if (!phoneE164) {
        const err = new Error('invalid admin phone');
        err.code = 'ADMIN_PHONE_INVALID';
        throw err;
    }
    if (Array.isArray(sink)) {
        sink.push({ phone: phoneE164, message: opts.message });
        return { ok: true, id: 'test-sms' };
    }
    if (!isAwsSnsConfigured(env)) {
        const err = new Error('AWS SNS credentials not configured');
        err.code = 'SNS_NOT_CONFIGURED';
        throw err;
    }
    const fetchImpl = typeof env.__test_sns_fetch === 'function' ? env.__test_sns_fetch : undefined;
    return snsPublishSms(env, phoneE164, opts.message, fetchImpl);
}