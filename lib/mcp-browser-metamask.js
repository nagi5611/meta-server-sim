// lib/mcp-browser-metamask.js — Playwright + MetaMask 拡張向けブラウザセッション（MCP 共通）

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

/** @type {import('playwright').BrowserContext | null} */
let activeContext = null;

/**
 * @param {string} url
 * @returns {'metamask-notification' | 'metamask-popup' | 'metamask-extension' | 'app' | 'other'}
 */
export function classifyPageUrl(url) {
    const u = String(url || '');
    if (!u.startsWith('chrome-extension://')) {
        if (u.startsWith('http://') || u.startsWith('https://')) return 'app';
        return 'other';
    }
    if (u.includes('notification.html')) return 'metamask-notification';
    if (u.includes('popup.html') || u.includes('home.html')) return 'metamask-popup';
    return 'metamask-extension';
}

/**
 * @param {string} combinedText
 * @param {string[]} buttonLabels
 * @returns {'connect' | 'signature' | 'network' | 'unlock' | 'unknown'}
 */
export function classifyMetamaskUi(combinedText, buttonLabels) {
    const text = String(combinedText || '').toLowerCase();
    const buttons = buttonLabels.map((b) => b.toLowerCase());
    if (
        text.includes('switch') && text.includes('network') ||
        buttons.some((b) => b.includes('switch network'))
    ) {
        return 'network';
    }
    if (
        text.includes('signature') ||
        text.includes('sign message') ||
        text.includes('sign-in') ||
        buttons.some((b) => b === 'sign' || b.includes('sign'))
    ) {
        return 'signature';
    }
    if (
        text.includes('connect') ||
        text.includes('requested your accounts') ||
        buttons.some((b) => b === 'connect' || b.includes('connect'))
    ) {
        return 'connect';
    }
    if (text.includes('unlock') || text.includes('enter your password')) {
        return 'unlock';
    }
    return 'unknown';
}

/**
 * @returns {{
 *   extensionPath: string | null,
 *   userDataDir: string,
 *   headless: boolean,
 *   channel: string | undefined,
 *   defaultBaseUrl: string,
 * }}
 */
export function getBrowserMetamaskConfig() {
    const extensionPath = String(process.env.METAMASK_EXTENSION_PATH || '').trim() || null;
    const userDataDir =
        String(process.env.BROWSER_METAMASK_USER_DATA_DIR || '').trim() ||
        path.join(process.cwd(), '.data', 'mcp-metamask-profile');
    const headless = process.env.BROWSER_METAMASK_HEADLESS === '1';
    const channelRaw = String(process.env.BROWSER_METAMASK_CHANNEL ?? 'chrome').trim();
    const channel = channelRaw === '' || channelRaw === 'none' ? undefined : channelRaw;
    const defaultBaseUrl =
        String(process.env.BROWSER_METAMASK_BASE_URL || '').trim() || 'http://127.0.0.1:3003';
    return { extensionPath, userDataDir, headless, channel, defaultBaseUrl };
}

export function isBrowserSessionActive() {
    return activeContext != null;
}

/**
 * @returns {Promise<import('playwright').BrowserContext>}
 */
export async function getOrLaunchBrowserSession() {
    if (activeContext) return activeContext;

    const cfg = getBrowserMetamaskConfig();
    if (!cfg.extensionPath || !fs.existsSync(cfg.extensionPath)) {
        throw new Error(
            'METAMASK_EXTENSION_PATH must point to an unpacked MetaMask extension directory (see mcp/README-browser-metamask.md).',
        );
    }

    fs.mkdirSync(cfg.userDataDir, { recursive: true });

    /** @type {import('playwright').LaunchPersistentContextOptions} */
    const launchOpts = {
        headless: cfg.headless,
        viewport: { width: 1280, height: 720 },
        ignoreDefaultArgs: ['--disable-extensions'],
        args: [
            `--disable-extensions-except=${cfg.extensionPath}`,
            `--load-extension=${cfg.extensionPath}`,
        ],
    };
    if (cfg.channel) {
        launchOpts.channel = cfg.channel;
    }

    activeContext = await chromium.launchPersistentContext(cfg.userDataDir, launchOpts);
    return activeContext;
}

export async function closeBrowserSession() {
    if (!activeContext) return { closed: false };
    await activeContext.close();
    activeContext = null;
    return { closed: true };
}

/**
 * @param {import('playwright').Page} page
 */
async function collectButtonLabels(page) {
    try {
        const labels = await page.locator('button:visible, [role="button"]:visible').allTextContents();
        return [...new Set(labels.map((t) => t.trim()).filter(Boolean))];
    } catch {
        return [];
    }
}

/**
 * @param {import('playwright').Page} page
 */
export async function snapshotPlaywrightPage(page) {
    const url = page.url();
    const title = await page.title().catch(() => '');
    const bodyText = await page
        .locator('body')
        .innerText({ timeout: 5000 })
        .catch(() => page.content().catch(() => ''));
    const buttonLabels = await collectButtonLabels(page);
    const kind = classifyPageUrl(url);
    const uiKind =
        kind.startsWith('metamask') ? classifyMetamaskUi(`${title}\n${bodyText}`, buttonLabels) : null;

    let screenshotBase64 = null;
    try {
        const buf = await page.screenshot({ type: 'png', timeout: 15_000 });
        screenshotBase64 = buf.toString('base64');
    } catch {
        /* optional */
    }

    return {
        url,
        title,
        kind,
        uiKind,
        buttonLabels,
        textPreview: bodyText.slice(0, 2000),
        screenshotBase64,
    };
}

/**
 * @param {import('playwright').BrowserContext} context
 */
export async function listContextPages(context) {
    const pages = context.pages();
    const out = [];
    for (const page of pages) {
        out.push(await snapshotPlaywrightPage(page));
    }
    return out;
}

/**
 * @param {import('playwright').BrowserContext} context
 */
export async function findMetamaskNotificationPage(context) {
    for (const page of context.pages()) {
        if (classifyPageUrl(page.url()) === 'metamask-notification') {
            return page;
        }
    }
    for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 250));
        for (const page of context.pages()) {
            if (classifyPageUrl(page.url()) === 'metamask-notification') {
                return page;
            }
        }
    }
    return null;
}

/**
 * @param {import('playwright').Page} page
 * @param {string} label
 */
export async function clickVisibleButton(page, label) {
    const wanted = String(label || '').trim();
    if (!wanted) throw new Error('buttonLabel is required');

    const loc = page.getByRole('button', { name: new RegExp(wanted, 'i') }).first();
    if ((await loc.count()) > 0) {
        await loc.click({ timeout: 10_000 });
        return { clicked: wanted, strategy: 'role-button' };
    }

    const textBtn = page.locator('button:visible', { hasText: new RegExp(wanted, 'i') }).first();
    if ((await textBtn.count()) > 0) {
        await textBtn.click({ timeout: 10_000 });
        return { clicked: wanted, strategy: 'button-has-text' };
    }

    throw new Error(`Button not found: ${wanted}`);
}

/**
 * @param {import('playwright').BrowserContext} context
 * @param {string} [url]
 */
export async function navigateApp(context, url) {
    const target = url || getBrowserMetamaskConfig().defaultBaseUrl;
    let page = context.pages().find((p) => classifyPageUrl(p.url()) === 'app');
    if (!page) {
        page = await context.newPage();
    }
    await page.goto(target, {
        waitUntil: 'domcontentloaded',
        timeout: 120_000,
        ignoreHTTPSErrors: true,
    });
    return snapshotPlaywrightPage(page);
}
