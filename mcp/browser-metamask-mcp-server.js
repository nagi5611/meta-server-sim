#!/usr/bin/env node
/**
 * Browser + MetaMask MCP server (stdio).
 * Playwright でテナントメタバースと MetaMask 通知 UI をスナップショット・操作する。
 *
 * Env: METAMASK_EXTENSION_PATH, BROWSER_METAMASK_USER_DATA_DIR, BROWSER_METAMASK_BASE_URL, …
 * See mcp/README-browser-metamask.md
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
    classifyPageUrl,
    clickVisibleButton,
    closeBrowserSession,
    findMetamaskNotificationPage,
    getBrowserMetamaskConfig,
    getOrLaunchBrowserSession,
    isBrowserSessionActive,
    listContextPages,
    navigateApp,
    snapshotPlaywrightPage,
} from '../lib/mcp-browser-metamask.js';

const server = new Server(
    {
        name: 'metasim-browser-metamask',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    },
);

const TOOLS = [
    {
        name: 'browser_metamask_config',
        description:
            'Show effective browser/MetaMask MCP config (paths, base URL). Does not launch a browser.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'browser_session_start',
        description:
            'Launch persistent Chromium/Chrome with MetaMask extension (METAMASK_EXTENSION_PATH).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'browser_session_status',
        description: 'Whether a Playwright context is active and list open pages with snapshots.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'browser_session_close',
        description: 'Close Playwright browser context.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'browser_navigate',
        description:
            'Navigate the app tab to a URL (default BROWSER_METAMASK_BASE_URL, e.g. http://127.0.0.1:3003/P-01/).',
        inputSchema: {
            type: 'object',
            properties: { url: { type: 'string' } },
            additionalProperties: false,
        },
    },
    {
        name: 'browser_snapshot_app',
        description: 'Screenshot + text/button summary of the current app (non-extension) tab.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'metamask_wait_notification',
        description:
            'Wait for MetaMask notification.html popup (connect, sign, switch network) and return snapshot.',
        inputSchema: {
            type: 'object',
            properties: { timeoutMs: { type: 'number' } },
            additionalProperties: false,
        },
    },
    {
        name: 'metamask_snapshot',
        description: 'Snapshot MetaMask notification or popup page if open.',
        inputSchema: {
            type: 'object',
            properties: {
                target: {
                    type: 'string',
                    enum: ['notification', 'popup', 'any'],
                },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'metamask_click',
        description:
            'Click a visible button on MetaMask notification/popup (e.g. Connect, Confirm, Switch network, Cancel).',
        inputSchema: {
            type: 'object',
            properties: {
                buttonLabel: { type: 'string' },
                target: {
                    type: 'string',
                    enum: ['notification', 'popup', 'any'],
                },
            },
            required: ['buttonLabel'],
        },
    },
    {
        name: 'metamask_approve_connect',
        description: 'Click Connect on the MetaMask connection request notification.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'metamask_confirm',
        description: 'Click Confirm / Sign on MetaMask notification.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'metamask_switch_network',
        description: 'Click Switch network (or approve) on MetaMask network prompt.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'browser_app_click',
        description: 'Click a button on the app page by visible label (dapp UI).',
        inputSchema: {
            type: 'object',
            properties: { buttonLabel: { type: 'string' } },
            required: ['buttonLabel'],
        },
    },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

/**
 * @param {import('playwright').BrowserContext} context
 * @param {'notification' | 'popup' | 'any'} target
 */
async function resolveMetamaskPage(context, target) {
    const pages = context.pages();
    if (target === 'notification') {
        return findMetamaskNotificationPage(context);
    }
    for (const page of pages) {
        const kind = classifyPageUrl(page.url());
        if (target === 'popup' && kind === 'metamask-popup') return page;
        if (target === 'any' && kind.startsWith('metamask')) return page;
    }
    return null;
}

/**
 * @param {import('playwright').BrowserContext} context
 */
function resolveAppPage(context) {
    const pages = context.pages();
    return pages.find((p) => classifyPageUrl(p.url()) === 'app') || pages[0] || null;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        let payload;

        switch (name) {
            case 'browser_metamask_config':
                payload = {
                    ...getBrowserMetamaskConfig(),
                    sessionActive: isBrowserSessionActive(),
                    note: 'Set METAMASK_EXTENSION_PATH before browser_session_start. Run npm run dev for 3002/3003.',
                };
                break;

            case 'browser_session_start': {
                const ctx = await getOrLaunchBrowserSession();
                payload = {
                    started: true,
                    pages: await listContextPages(ctx),
                };
                break;
            }

            case 'browser_session_status':
                if (!isBrowserSessionActive()) {
                    payload = { active: false, pages: [] };
                } else {
                    const ctx = await getOrLaunchBrowserSession();
                    payload = { active: true, pages: await listContextPages(ctx) };
                }
                break;

            case 'browser_session_close':
                payload = await closeBrowserSession();
                break;

            case 'browser_navigate': {
                const ctx = await getOrLaunchBrowserSession();
                payload = await navigateApp(ctx, args?.url);
                break;
            }

            case 'browser_snapshot_app': {
                const ctx = await getOrLaunchBrowserSession();
                const page = resolveAppPage(ctx);
                if (!page) throw new Error('No app page open');
                payload = await snapshotPlaywrightPage(page);
                break;
            }

            case 'metamask_wait_notification': {
                const ctx = await getOrLaunchBrowserSession();
                const timeoutMs =
                    typeof args?.timeoutMs === 'number' ? args.timeoutMs : 30_000;
                const started = Date.now();
                let page = null;
                while (Date.now() - started < timeoutMs) {
                    page = await findMetamaskNotificationPage(ctx);
                    if (page) break;
                    await new Promise((r) => setTimeout(r, 300));
                }
                if (!page) throw new Error('MetaMask notification did not appear in time');
                payload = await snapshotPlaywrightPage(page);
                break;
            }

            case 'metamask_snapshot': {
                const ctx = await getOrLaunchBrowserSession();
                const target = /** @type {'notification'|'popup'|'any'} */ (
                    args?.target || 'notification'
                );
                const page = await resolveMetamaskPage(ctx, target);
                if (!page) throw new Error(`No MetaMask page open (${target})`);
                payload = await snapshotPlaywrightPage(page);
                break;
            }

            case 'metamask_click':
            case 'metamask_approve_connect':
            case 'metamask_confirm':
            case 'metamask_switch_network': {
                const ctx = await getOrLaunchBrowserSession();
                const page =
                    (await resolveMetamaskPage(ctx, 'notification')) ||
                    (await resolveMetamaskPage(ctx, 'any'));
                if (!page) throw new Error('No MetaMask notification/popup open');

                let label = args?.buttonLabel;
                if (name === 'metamask_click' && !label) {
                    throw new Error('buttonLabel is required for metamask_click');
                }
                if (name === 'metamask_approve_connect') label = 'Connect';
                if (name === 'metamask_confirm') label = 'Confirm|Sign';
                if (name === 'metamask_switch_network') label = 'Switch network|Approve';

                if (name === 'metamask_confirm' || name === 'metamask_switch_network') {
                    const patterns = String(label).split('|');
                    let lastErr;
                    for (const p of patterns) {
                        try {
                            payload = await clickVisibleButton(page, p.trim());
                            payload.after = await snapshotPlaywrightPage(page);
                            lastErr = null;
                            break;
                        } catch (e) {
                            lastErr = e;
                        }
                    }
                    if (lastErr) throw lastErr;
                } else {
                    payload = await clickVisibleButton(page, String(label));
                    payload.after = await snapshotPlaywrightPage(page);
                }
                break;
            }

            case 'browser_app_click': {
                const ctx = await getOrLaunchBrowserSession();
                const page = resolveAppPage(ctx);
                if (!page) throw new Error('No app page');
                payload = await clickVisibleButton(page, String(args?.buttonLabel ?? ''));
                payload.after = await snapshotPlaywrightPage(page);
                break;
            }

            default:
                throw new Error(`unknown tool: ${name}`);
        }

        const text = JSON.stringify(payload, null, 2);
        const content = [{ type: 'text', text }];
        if (payload && typeof payload === 'object' && payload.screenshotBase64) {
            content.push({
                type: 'image',
                data: payload.screenshotBase64,
                mimeType: 'image/png',
            });
        }
        return { content };
    } catch (e) {
        return {
            content: [
                {
                    type: 'text',
                    text: e instanceof Error ? e.message : String(e),
                },
            ],
            isError: true,
        };
    }
});

const transport = new StdioServerTransport();
await server.connect(transport);
