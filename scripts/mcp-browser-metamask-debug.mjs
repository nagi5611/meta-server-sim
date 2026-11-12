#!/usr/bin/env node
import {
    closeBrowserSession,
    getOrLaunchBrowserSession,
    listContextPages,
    navigateApp,
} from '../lib/mcp-browser-metamask.js';

const url = process.env.MCP_SMOKE_URL || 'http://127.0.0.1:3004/mcp-wallet-smoke.html';

async function main() {
    const ctx = await getOrLaunchBrowserSession();
    const page = (await navigateApp(ctx, url)).url
        ? ctx.pages().find((p) => p.url().includes('mcp-wallet-smoke')) || ctx.pages()[0]
        : ctx.pages()[0];
    const hasEth = await page.evaluate(() => ({
        ethereum: !!window.ethereum,
        isMetaMask: window.ethereum?.isMetaMask === true,
    }));
    await page.click('#btn-connect').catch((e) => ({ clickError: String(e) }));
    await new Promise((r) => setTimeout(r, 8000));
    console.log(JSON.stringify({ hasEth, pages: await listContextPages(ctx) }, null, 2));
    await closeBrowserSession();
}

main().catch(async (e) => {
    console.error(e);
    await closeBrowserSession();
    process.exit(1);
});
