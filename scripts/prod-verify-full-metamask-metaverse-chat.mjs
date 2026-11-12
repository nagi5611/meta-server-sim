#!/usr/bin/env node
/**
 * Production verification: MetaMask MCP browser + HTTPS metaverse + Jev-Gemini chat reject.
 * Run on meta.mmh-virtual.jp with /etc/mmh-virtual/mcp-metamask.env loaded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { moderateChatMessage } from '../lib/chat-moderation.js';
import { getPlatformEnv } from '../lib/platform-env-config.js';
import {
    classifyPageUrl,
    clickVisibleButton,
    closeBrowserSession,
    getOrLaunchBrowserSession,
    navigateApp,
    snapshotPlaywrightPage,
} from '../lib/mcp-browser-metamask.js';

const TENANT = 'P-01';
/**
 * 公開 URL は https://sim.mmh-virtual.jp/P-01/。自宅サーバ内は hairpin 不可のため
 * loopback + X-Forwarded-Proto: https（REQUIRE_SECURE_HTTP 互換）で入場する。
 */
const TENANT_URL =
    process.env.MCP_VERIFY_TENANT_URL || `http://127.0.0.1:3004/${TENANT}/`;
const TENANT_PUBLIC_HOST = process.env.MCP_VERIFY_TENANT_HOST || 'sim.mmh-virtual.jp';
const OFFENSIVE = process.env.MCP_VERIFY_OFFENSIVE_MSG || 'てめえ殺すぞ';
const artifactDir =
    process.env.MCP_VERIFY_ARTIFACT_DIR ||
    (fs.existsSync('/opt/cursor/artifacts')
        ? '/opt/cursor/artifacts'
        : path.join(process.cwd(), 'artifacts'));

fs.mkdirSync(artifactDir, { recursive: true });

function savePng(name, b64) {
    if (!b64) return null;
    const p = path.join(artifactDir, name);
    fs.writeFileSync(p, Buffer.from(b64, 'base64'));
    return p;
}

async function dismissGate(page) {
    const gate = page.locator('#tenant-login-gate');
    if (await gate.isVisible({ timeout: 8000 }).catch(() => false)) {
        await page.locator('#tenant-login-display-name').fill(`McpVerify-${Date.now()}`);
        await page.locator('#tenant-login-enter-btn').click();
        await gate.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
    }
    const kb = page.locator('#control-scheme-keyboard-btn');
    if (await kb.isVisible({ timeout: 3000 }).catch(() => false)) {
        await kb.click();
    }
}

async function waitMetaverseReady(page) {
    await page.waitForFunction(
        () => document.documentElement.dataset.tenantMetaverseReady === 'true',
        { timeout: 120_000 },
    );
}

/**
 * @param {import('playwright').Page} page
 * @param {string} message
 */
async function emitChatAckViaBrowser(page, message) {
    return page.evaluate(
        async ({ text, timeout }) => {
            const sock = window.__tenantE2E?.getSocket?.();
            if (!sock?.connected) throw new Error('browser socket not connected');
            return await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('chat ack timeout')), timeout);
                sock.emit('chat-message', text, (ack) => {
                    clearTimeout(timer);
                    resolve(ack);
                });
            });
        },
        { text: message, timeout: 120_000 },
    );
}

async function main() {
    const report = { steps: [], offensiveMessage: OFFENSIVE, tenantUrl: TENANT_URL };

    report.steps.push({ step: 'browser_session_start', note: 'getOrLaunchBrowserSession' });
    const ctx = await getOrLaunchBrowserSession();
    for (const p of ctx.pages()) {
        await p.addInitScript(() => {
            window.__TENANT_E2E_HARNESS__ = '1';
            document.documentElement.dataset.e2eHarness = '1';
            try {
                localStorage.setItem('metaverse-control-scheme', 'keyboard');
            } catch {
                /* ignore */
            }
        });
    }
    report.steps.push({ step: 'browser_session_started', pageCount: ctx.pages().length, ok: true });

    const appPage0 =
        ctx.pages().find((p) => classifyPageUrl(p.url()) === 'app') || (await ctx.newPage());
    await appPage0.setExtraHTTPHeaders({
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': TENANT_PUBLIC_HOST,
    });
    await appPage0.goto(TENANT_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 120_000,
    });
    const appPage =
        ctx.pages().find((p) => classifyPageUrl(p.url()) === 'app' && p.url().includes(TENANT)) ||
        ctx.pages()[0];
    await dismissGate(appPage);
    await waitMetaverseReady(appPage).catch((e) => {
        report.steps.push({ step: 'metaverse_ready_warn', error: String(e) });
    });

    const metaSnap = await snapshotPlaywrightPage(appPage);
    savePng('prod-verify-metaverse.png', metaSnap.screenshotBase64);
    report.steps.push({
        step: 'browser_navigate_snapshot',
        url: metaSnap.url,
        title: metaSnap.title,
        screenshot: 'prod-verify-metaverse.png',
    });

    const moderationDirect = await moderateChatMessage({
        apiKey: String(getPlatformEnv('GEMINI_API_KEY') || '').trim(),
        model: getPlatformEnv('GEMINI_MODEL'),
        historyTableText: '(検証用・履歴なし)',
        pendingLine: `${new Date().toISOString()} | verify-script | ${OFFENSIVE}`,
    });
    report.moderationDirect = moderationDirect;
    report.steps.push({ step: 'jev_gemini_pipeline_direct', moderation: moderationDirect });

    const chatAck = await emitChatAckViaBrowser(appPage, OFFENSIVE);
    report.chatAck = chatAck;
    report.steps.push({ step: 'chat_message_ack', ack: chatAck });

    try {
        await appPage.locator('#chat-input').fill(OFFENSIVE, { timeout: 5000 });
        await appPage.locator('#chat-send-btn').click({ timeout: 5000 });
        await appPage.waitForTimeout(8000);
        const chatSnap = await snapshotPlaywrightPage(appPage);
        savePng('prod-verify-chat-ui.png', chatSnap.screenshotBase64);
        const chatText = await appPage.locator('#chat-messages').innerText().catch(() => '');
        report.steps.push({
            step: 'chat_ui_after_send',
            messagesPreview: chatText.slice(0, 1500),
            screenshot: 'prod-verify-chat-ui.png',
        });
    } catch (e) {
        report.steps.push({ step: 'chat_ui_after_send', skipped: true, error: String(e) });
    }

    await closeBrowserSession();
    report.ok =
        chatAck?.ok === false &&
        (chatAck?.code === 'inappropriate' || String(chatAck?.message || '').length > 0);

    const out = path.join(artifactDir, 'prod-verify-full-report.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}

main().catch(async (e) => {
    console.error(e);
    await closeBrowserSession().catch(() => {});
    process.exit(1);
});
