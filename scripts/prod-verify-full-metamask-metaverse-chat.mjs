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
const TENANT_PUBLIC_HOST = process.env.MCP_VERIFY_TENANT_HOST || 'sim.mmh-virtual.jp';
/** 本番内検証は /etc/hosts で sim → 127.0.0.1（sudo 設定）し HTTPS 公開 URL を使う */
const TENANT_URL =
    process.env.MCP_VERIFY_TENANT_URL ||
    `https://${TENANT_PUBLIC_HOST}/${TENANT}/`;
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
    const deadline = Date.now() + 180_000;
    const gatePanel = page.locator('#tenant-login-gate');
    while (Date.now() < deadline) {
        const open = await gatePanel.isVisible().catch(() => false);
        if (open) {
            const name = `McpVerify-${Date.now()}`;
            await page.locator('#tenant-login-display-name').fill(name, { timeout: 15_000 });
            const avatarSelect = page.locator('#tenant-login-avatar-select');
            if (!(await avatarSelect.isDisabled().catch(() => true))) {
                const val = await avatarSelect.locator('option').first().getAttribute('value');
                if (val) await avatarSelect.selectOption(val);
            }
            const enter = page.locator('#tenant-login-enter-btn');
            if (await enter.isVisible().catch(() => false)) {
                await enter.click({ timeout: 15_000 });
            } else {
                await page.evaluate(() => document.getElementById('tenant-login-enter-btn')?.click());
            }
            await page.waitForFunction(
                () => {
                    const g = document.getElementById('tenant-login-gate');
                    return (
                        !document.body.classList.contains('tenant-login-gate-open') &&
                        (g?.hidden !== false || g == null)
                    );
                },
                { timeout: 60_000 },
            );
            break;
        }
        await page.waitForTimeout(400);
    }
    const kb = page.locator('#control-scheme-keyboard-btn');
    if (await kb.isVisible({ timeout: 8000 }).catch(() => false)) {
        await kb.click();
    }
}

async function waitMetaverseReady(page) {
    await page.waitForFunction(
        () => document.documentElement.dataset.tenantMetaverseReady === 'true',
        { timeout: 120_000 },
    );
}

async function waitForSocket(page) {
    const deadline = Date.now() + 120_000;
    let stableTicks = 0;
    while (Date.now() < deadline) {
        const ready = await page
            .evaluate(() => {
                const e2e = window.__tenantE2E;
                const sock = e2e?.getSocket?.();
                if (!sock?.connected) return false;
                const ping = e2e?.getNetworkManager?.()?.getPingStatus?.();
                if (ping?.reconnecting) return false;
                return true;
            })
            .catch(() => false);
        if (!ready) {
            stableTicks = 0;
            await page.waitForTimeout(500);
            continue;
        }
        stableTicks += 1;
        if (stableTicks >= 2) return;
        await page.waitForTimeout(400);
    }
    throw new Error('socket not connected after wait');
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

    report.steps.push({
        step: 'browser_session_start',
        note: 'getOrLaunchBrowserSession (MetaMask MCP 同等)',
    });
    report.publicTenantUrl = TENANT_URL;
    const ctx = await getOrLaunchBrowserSession();
    await ctx.addInitScript(() => {
        window.__TENANT_E2E_HARNESS__ = '1';
        document.documentElement.dataset.e2eHarness = '1';
        try {
            localStorage.setItem('metaverse-control-scheme', 'keyboard');
            localStorage.setItem('username', `McpVerify-${Date.now()}`);
        } catch {
            /* ignore */
        }
    });
    report.steps.push({ step: 'browser_session_started', pageCount: ctx.pages().length, ok: true });

    const appPage0 =
        ctx.pages().find((p) => classifyPageUrl(p.url()) === 'app') || (await ctx.newPage());
    appPage0.setDefaultTimeout(120_000);
    if (TENANT_URL.startsWith('http://127.0.0.1')) {
        await appPage0.setExtraHTTPHeaders({
            'X-Forwarded-Proto': 'https',
            'X-Forwarded-Host': TENANT_PUBLIC_HOST,
        });
    }
    await appPage0.goto(TENANT_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 120_000,
        ignoreHTTPSErrors: true,
    });
    const appPage =
        ctx.pages().find((p) => classifyPageUrl(p.url()) === 'app' && p.url().includes(TENANT)) ||
        ctx.pages()[0];
    await dismissGate(appPage);
    await waitMetaverseReady(appPage).catch((e) => {
        report.steps.push({ step: 'metaverse_ready_warn', error: String(e) });
    });
    await appPage.keyboard.press('KeyW').catch(() => {});
    await waitForSocket(appPage).catch((e) => {
        report.steps.push({ step: 'socket_wait_warn', error: String(e) });
    });
    await appPage.waitForTimeout(3000);

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

    let chatAck = null;
    try {
        await waitForSocket(appPage);
        chatAck = await emitChatAckViaBrowser(appPage, OFFENSIVE);
    } catch (e) {
        report.steps.push({ step: 'chat_message_ack_warn', error: String(e) });
    }
    report.chatAck = chatAck;
    report.steps.push({ step: 'chat_message_ack', ack: chatAck });

    try {
        await appPage.locator('#chat-input').fill(OFFENSIVE, { timeout: 5000 });
        await appPage.locator('#chat-send-btn').click({ timeout: 15_000, force: true });
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
    const mod = report.moderationDirect || {};
    const reasonJa = String(mod.reason_ja || '');
    const violentCategories = /暴言|脅迫|殺害|暴力/;
    const categoryMatch = violentCategories.test(reasonJa);
    report.category_ja =
        reasonJa.match(/カテゴリ[：:]\s*(\S+)/)?.[1] ||
        (reasonJa.includes('暴言') ? '暴言' : reasonJa.includes('脅迫') ? '脅迫' : reasonJa || null);
    report.ok =
        mod.inappropriate === true &&
        (mod.moderation_stage === 'jev_reject_gemini_detail' || mod.moderation_stage === 'gemini_only') &&
        categoryMatch &&
        chatAck?.ok === false &&
        chatAck?.code === 'inappropriate';

    const out = path.join(artifactDir, 'prod-verify-full-report.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}

main().catch(async (e) => {
    console.error(e);
    await closeBrowserSession().catch(() => {});
    process.exit(1);
});
