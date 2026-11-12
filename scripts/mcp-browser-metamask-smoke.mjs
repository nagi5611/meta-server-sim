#!/usr/bin/env node
/**
 * Production / CI smoke for Browser+MetaMask MCP (no stdio MCP).
 * Writes PNG artifacts under MCP_SMOKE_ARTIFACT_DIR (default /opt/cursor/artifacts or ./artifacts).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
    classifyPageUrl,
    clickVisibleButton,
    closeBrowserSession,
    findMetamaskNotificationPage,
    getBrowserMetamaskConfig,
    getOrLaunchBrowserSession,
    listContextPages,
    navigateApp,
    snapshotPlaywrightPage,
} from '../lib/mcp-browser-metamask.js';

const artifactDir =
    process.env.MCP_SMOKE_ARTIFACT_DIR ||
    (fs.existsSync('/opt/cursor/artifacts')
        ? '/opt/cursor/artifacts'
        : path.join(process.cwd(), 'artifacts'));

fs.mkdirSync(artifactDir, { recursive: true });

function writePng(name, base64) {
    if (!base64) return null;
    const p = path.join(artifactDir, name);
    fs.writeFileSync(p, Buffer.from(base64, 'base64'));
    return p;
}

function stripScreenshot(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const { screenshotBase64, ...rest } = obj;
    return { ...rest, screenshotSaved: !!screenshotBase64 };
}

async function main() {
    const cfg = getBrowserMetamaskConfig();
    const results = { steps: [], config: { ...cfg, extensionPath: cfg.extensionPath } };

    const ctx = await getOrLaunchBrowserSession();
    results.steps.push({ step: 'session_start', ok: true, pageCount: ctx.pages().length });

    const smokeUrl =
        process.env.MCP_SMOKE_URL ||
        `${cfg.defaultBaseUrl.replace(/\/$/, '')}/mcp-wallet-smoke.html`;

    const appSnap = await navigateApp(ctx, smokeUrl);
    writePng('mcp-smoke-app-initial.png', appSnap.screenshotBase64);
    results.steps.push({ step: 'browser_navigate', url: smokeUrl, snapshot: stripScreenshot(appSnap) });

    const appPage = ctx.pages().find((p) => p.url().includes('mcp-wallet-smoke'));
    if (!appPage) throw new Error('smoke page not found');

    const providerState = await appPage.evaluate(() => ({
        ethereum: typeof window.ethereum !== 'undefined',
        isMetaMask: window.ethereum?.isMetaMask === true,
    }));
    results.steps.push({ step: 'injected_provider', ...providerState });
    if (!providerState.ethereum) {
        throw new Error('window.ethereum not injected — MetaMask extension did not load');
    }

    await clickVisibleButton(appPage, 'Connect Wallet');
    results.steps.push({ step: 'click_connect_wallet', ok: true });

    let mmPage = null;
    const waitUntil = Date.now() + 20_000;
    while (Date.now() < waitUntil) {
        mmPage = await findMetamaskNotificationPage(ctx);
        if (mmPage) break;
        const mmAny = ctx.pages().find((p) => classifyPageUrl(p.url()).startsWith('metamask'));
        if (mmAny) {
            mmPage = mmAny;
            break;
        }
        await new Promise((r) => setTimeout(r, 400));
    }
    if (!mmPage) {
        results.steps.push({
            step: 'metamask_missing',
            pages: (await listContextPages(ctx)).map((p) => ({ url: p.url, kind: p.kind })),
        });
        throw new Error('MetaMask notification not shown after connect');
    }
    const mmSnap = await snapshotPlaywrightPage(mmPage);
    writePng('mcp-smoke-metamask-connect.png', mmSnap.screenshotBase64);
    results.steps.push({
        step: 'metamask_connect_snapshot',
        uiKind: mmSnap.uiKind,
        snapshot: stripScreenshot(mmSnap),
    });

    const tenantUrl = process.env.MCP_SMOKE_TENANT_URL;
    if (tenantUrl) {
        const tenantSnap = await navigateApp(ctx, tenantUrl);
        writePng('mcp-smoke-tenant.png', tenantSnap.screenshotBase64);
        results.steps.push({ step: 'browser_navigate_tenant', url: tenantUrl, snapshot: stripScreenshot(tenantSnap) });
    }

    await closeBrowserSession();
    results.steps.push({ step: 'session_close', ok: true });
    results.ok = true;
    results.artifactDir = artifactDir;

    const outPath = path.join(artifactDir, 'mcp-browser-metamask-smoke.json');
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
}

main().catch(async (e) => {
    console.error(e instanceof Error ? e.stack || e.message : String(e));
    try {
        await closeBrowserSession();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
