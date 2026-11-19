import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    buildOtpSmsMessage,
    isAwsSnsConfigured,
    maskAdminPhone,
    normalizeJapanPhoneE164,
    sendAdminOtpSms,
    snsPublishSms,
} from '../src/aws-sns-sms.js';

test('normalizeJapanPhoneE164 domestic and international', () => {
    assert.equal(normalizeJapanPhoneE164('090-1234-5678'), '+819012345678');
    assert.equal(normalizeJapanPhoneE164('+81 90-1234-5678'), '+819012345678');
    assert.equal(normalizeJapanPhoneE164('819012345678'), '+819012345678');
    assert.equal(normalizeJapanPhoneE164('070-7037-9203'), '+817070379203');
    assert.equal(normalizeJapanPhoneE164('invalid'), null);
    assert.equal(normalizeJapanPhoneE164('+81107037920331'), null);
    assert.equal(normalizeJapanPhoneE164('070703792031'), null);
});

test('maskAdminPhone hides middle digits', () => {
    assert.match(maskAdminPhone('+819012345678'), /\*\*\*/);
    assert.ok(maskAdminPhone('+819012345678').endsWith('5678'));
});

test('buildOtpSmsMessage includes code and JST', () => {
    const body = buildOtpSmsMessage({ code: '123456', clientIp: '203.0.113.1', atJst: '2026-01-01T12:00:00+09:00' });
    assert.match(body, /123456/);
    assert.match(body, /203\.0\.113\.1/);
});

test('isAwsSnsConfigured requires access key pair', () => {
    assert.equal(isAwsSnsConfigured({}), false);
    assert.equal(
        isAwsSnsConfigured({ AWS_ACCESS_KEY_ID: 'A', AWS_SECRET_ACCESS_KEY: 'B' }),
        true,
    );
});

test('sendAdminOtpSms uses test sink without AWS', async () => {
    const sink = [];
    const env = { __test_sms_sink: sink };
    await sendAdminOtpSms(env, { phone: '09012345678', message: 'hello' });
    assert.equal(sink.length, 1);
    assert.equal(sink[0].phone, '+819012345678');
    assert.equal(sink[0].message, 'hello');
});

test('snsPublishSms builds signed publish body (mock fetch)', async () => {
    /** @type {string | undefined} */
    let capturedBody;
    const env = {
        AWS_ACCESS_KEY_ID: 'AKIATEST',
        AWS_SECRET_ACCESS_KEY: 'secret',
        AWS_SNS_REGION: 'ap-northeast-1',
        __test_sns_fetch: async (_url, init) => {
            capturedBody = String(init?.body || '');
            return new Response(
                '<?xml version="1.0"?><PublishResponse><PublishResult><MessageId>msg-1</MessageId></PublishResult></PublishResponse>',
                { status: 200 },
            );
        },
    };
    const result = await snsPublishSms(env, '+819012345678', 'otp body', env.__test_sns_fetch);
    assert.equal(result.id, 'msg-1');
    assert.ok(capturedBody?.includes('PhoneNumber=%2B819012345678'));
    assert.ok(capturedBody?.includes('Transactional'));
    assert.ok(capturedBody?.includes('Action=Publish'));
});