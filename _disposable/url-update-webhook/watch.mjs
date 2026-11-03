#!/usr/bin/env node
// _disposable/url-update-webhook/watch.mjs — 指定URLの更新を検知して Webhook へ通知（削除用フォルダ）
import crypto from 'node:crypto';
import process from 'node:process';

/**
 * 環境変数から設定を読み込む
 */
function loadConfig() {
    const watchUrl = String(process.env.WATCH_URL || '').trim();
    const webhookUrl = String(process.env.WEBHOOK_URL || '').trim();
    const intervalMs = Math.max(
        5000,
        parseInt(String(process.env.INTERVAL_MS || '60000'), 10) || 60000
    );
    const notifyOnStart = isTruthy(process.env.NOTIFY_ON_START);
    const userAgent = String(process.env.USER_AGENT || 'url-update-webhook/1.0').trim();
    const message = String(process.env.NOTIFY_MESSAGE || '更新されました').trim() || '更新されました';

    if (!watchUrl) throw new Error('WATCH_URL が未設定です');
    if (!webhookUrl) throw new Error('WEBHOOK_URL が未設定です');

    let parsedWatch;
    try {
        parsedWatch = new URL(watchUrl);
        if (parsedWatch.protocol !== 'http:' && parsedWatch.protocol !== 'https:') {
            throw new Error('http/https のみ');
        }
    } catch {
        throw new Error('WATCH_URL が不正です');
    }

    let parsedWebhook;
    try {
        parsedWebhook = new URL(webhookUrl);
        if (parsedWebhook.protocol !== 'http:' && parsedWebhook.protocol !== 'https:') {
            throw new Error('http/https のみ');
        }
    } catch {
        throw new Error('WEBHOOK_URL が不正です');
    }

    return {
        watchUrl: parsedWatch.href,
        webhookUrl: parsedWebhook.href,
        intervalMs,
        notifyOnStart,
        userAgent,
        message,
    };
}

/**
 * @param {unknown} v
 */
function isTruthy(v) {
    const s = String(v ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/**
 * レスポンスから更新判定用フィンガープリントを作る
 * @param {Response} res
 * @param {ArrayBuffer} body
 */
export function buildFingerprint(res, body) {
    const etag = res.headers.get('etag')?.trim() || '';
    const lastModified = res.headers.get('last-modified')?.trim() || '';
    if (etag || lastModified) {
        return `meta:${etag}|${lastModified}`;
    }
    const hash = crypto.createHash('sha256').update(Buffer.from(body)).digest('hex');
    return `body:${hash}`;
}

/**
 * @param {string} watchUrl
 * @param {string} userAgent
 */
export async function fetchSnapshot(watchUrl, userAgent) {
    const res = await fetch(watchUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
            'User-Agent': userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
    });
    const body = await res.arrayBuffer();
    return {
        ok: res.ok,
        status: res.status,
        fingerprint: buildFingerprint(res, body),
        bodyByteLength: body.byteLength,
    };
}

/**
 * @param {object} opts
 * @param {string} opts.webhookUrl
 * @param {string} opts.message
 * @param {string} opts.watchUrl
 * @param {number} opts.status
 * @param {string} opts.fingerprint
 */
export async function postWebhookNotify(opts) {
    const at = new Date().toISOString();
    const text = `${opts.message}\n${opts.watchUrl}\n(${at})`;
    const payload = {
        content: text,
        text,
        message: opts.message,
        url: opts.watchUrl,
        watchUrl: opts.watchUrl,
        updatedAt: at,
        httpStatus: opts.status,
        fingerprint: opts.fingerprint,
    };

    const res = await fetch(opts.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const snippet = (await res.text()).slice(0, 200);
        throw new Error(`Webhook HTTP ${res.status}: ${snippet}`);
    }
}

/**
 * @param {ReturnType<typeof loadConfig>} cfg
 */
async function runLoop(cfg) {
    /** @type {string | null} */
    let previous = null;
    let tick = 0;

    const check = async () => {
        tick += 1;
        const label = `[url-watch #${tick}]`;
        try {
            const snap = await fetchSnapshot(cfg.watchUrl, cfg.userAgent);
            if (!snap.ok) {
                console.warn(`${label} GET ${snap.status} (${cfg.watchUrl})`);
            }

            const changed = previous !== null && snap.fingerprint !== previous;
            const first = previous === null;

            if (first) {
                console.log(
                    `${label} 初回取得 fingerprint=${snap.fingerprint.slice(0, 48)}… (${snap.bodyByteLength} bytes)`
                );
                if (cfg.notifyOnStart) {
                    await postWebhookNotify({
                        webhookUrl: cfg.webhookUrl,
                        message: cfg.message,
                        watchUrl: cfg.watchUrl,
                        status: snap.status,
                        fingerprint: snap.fingerprint,
                    });
                    console.log(`${label} Webhook 送信（初回通知 ON）`);
                }
            } else if (changed) {
                await postWebhookNotify({
                    webhookUrl: cfg.webhookUrl,
                    message: cfg.message,
                    watchUrl: cfg.watchUrl,
                    status: snap.status,
                    fingerprint: snap.fingerprint,
                });
                console.log(`${label} 更新検知 → Webhook 送信`);
            } else {
                console.log(`${label} 変更なし`);
            }

            previous = snap.fingerprint;
        } catch (e) {
            console.error(`${label} エラー:`, e instanceof Error ? e.message : e);
        }
    };

    await check();
    setInterval(check, cfg.intervalMs);
    console.log(
        `監視開始: ${cfg.watchUrl}\n間隔: ${cfg.intervalMs}ms\nWebhook: ${cfg.webhookUrl}\n終了: Ctrl+C`
    );
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isMain =
    Boolean(process.argv[1]) &&
    path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
    try {
        const cfg = loadConfig();
        await runLoop(cfg);
    } catch (e) {
        console.error(e instanceof Error ? e.message : e);
        console.error(
            '例: WATCH_URL=https://example.com WEBHOOK_URL=https://discord.com/api/webhooks/... node watch.mjs'
        );
        process.exit(1);
    }
}
