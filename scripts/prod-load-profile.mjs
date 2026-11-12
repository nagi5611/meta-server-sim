#!/usr/bin/env node
/**
 * 本番テナントメタバース入場のネットワーク／コンソールを収集し集計する。
 * 出力: MCP_VERIFY_ARTIFACT_DIR または /opt/cursor/artifacts/
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'https://sim.mmh-virtual.jp';
const TENANT = process.env.E2E_TENANT_ID || 'P-01';
const ENTRY_URL = `${BASE.replace(/\/$/, '')}/${TENANT}/`;
const ARTIFACT_DIR =
    process.env.MCP_VERIFY_ARTIFACT_DIR ||
    process.env.LOAD_PROFILE_OUT ||
    '/opt/cursor/artifacts';
const READY_TIMEOUT_MS = Number(process.env.LOAD_PROFILE_READY_MS || 120_000);

function bucket(url) {
    try {
        const u = new URL(url);
        const p = u.pathname;
        if (p.includes('/socket.io')) return 'socket.io';
        if (p.includes('/api/')) return 'api';
        if (p.includes('/assets/')) return 'assets';
        if (p.endsWith('.js') || p.includes('.js?')) return 'js';
        if (p.endsWith('.css') || p.includes('.css?')) return 'css';
        if (p.match(/\.(glb|gltf|bin|hdr|ktx2|png|jpg|webp)(\?|$)/i)) return 'media';
        if (p.includes('/simulations/')) return 'simulations';
        if (p.includes('/avatars/') || p.includes('/models/')) return 'models';
        return 'other';
    } catch {
        return 'other';
    }
}

function summarize(entries) {
    const byBucket = {};
    const slow = [];
    let totalXferMs = 0;
    for (const e of entries) {
        const b = e.bucket || 'other';
        byBucket[b] = byBucket[b] || { count: 0, totalMs: 0, bytes: 0 };
        byBucket[b].count += 1;
        byBucket[b].totalMs += e.durationMs;
        byBucket[b].bytes += e.responseBytes || 0;
        totalXferMs += e.durationMs;
        if (e.durationMs >= 500) slow.push(e);
    }
    slow.sort((a, b) => b.durationMs - a.durationMs);
    return { byBucket, slow, totalXferMs };
}

async function main() {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outJson = path.join(ARTIFACT_DIR, `prod-load-profile-${stamp}.json`);
    const outMd = path.join(ARTIFACT_DIR, `prod-load-profile-${stamp}.md`);

    /** @type {import('playwright').Request[]} */
    const pending = new Map();
    /** @type {object[]} */
    const networkLog = [];
    /** @type {object[]} */
    const consoleLog = [];
    /** @type {object[]} */
    const wsLog = [];

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        userAgent:
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    });

    await context.addInitScript(() => {
        window.__TENANT_E2E_HARNESS__ = '1';
        document.documentElement.dataset.e2eHarness = '1';
        try {
            localStorage.setItem('metaverse-control-scheme', 'keyboard');
            localStorage.setItem('username', `LoadProfile-${Date.now()}`);
        } catch {
            /* ignore */
        }
    });

    const page = await context.newPage();
    const navStart = Date.now();

    page.on('console', (msg) => {
        consoleLog.push({
            t: Date.now() - navStart,
            type: msg.type(),
            text: msg.text().slice(0, 2000),
        });
    });
    page.on('pageerror', (err) => {
        consoleLog.push({
            t: Date.now() - navStart,
            type: 'pageerror',
            text: String(err?.message || err).slice(0, 2000),
        });
    });

    page.on('request', (req) => {
        pending.set(req, { start: Date.now(), url: req.url(), method: req.method(), resourceType: req.resourceType() });
    });

    page.on('requestfinished', async (req) => {
        const meta = pending.get(req);
        pending.delete(req);
        const end = Date.now();
        const start = meta?.start ?? end;
        const durationMs = end - start;
        let responseBytes = 0;
        let status = 0;
        try {
            const res = await req.response();
            if (res) {
                status = res.status();
                const headers = res.headers();
                const cl = Number(headers['content-length'] || 0);
                if (Number.isFinite(cl) && cl > 0) responseBytes = cl;
            }
        } catch {
            /* ignore */
        }
        const startMs = start - navStart;
        networkLog.push({
            startMs,
            endMs: startMs + durationMs,
            durationMs,
            method: meta?.method || req.method(),
            resourceType: meta?.resourceType || req.resourceType(),
            status,
            responseBytes,
            bucket: bucket(req.url()),
            url: req.url(),
        });
    });

    page.on('requestfailed', (req) => {
        const meta = pending.get(req);
        pending.delete(req);
        networkLog.push({
            startMs: (meta?.start ?? Date.now()) - navStart,
            durationMs: Date.now() - (meta?.start ?? Date.now()),
            method: req.method(),
            resourceType: req.resourceType(),
            status: 0,
            failed: true,
            failure: req.failure()?.errorText,
            bucket: bucket(req.url()),
            url: req.url(),
        });
    });

    page.on('websocket', (ws) => {
        const url = ws.url();
        const wsStart = Date.now() - navStart;
        wsLog.push({ event: 'open', t: wsStart, url });
        ws.on('framesent', (f) => {
            wsLog.push({
                event: 'framesent',
                t: Date.now() - navStart,
                url,
                opcode: f.opcode,
                payloadBytes: typeof f.payload === 'string' ? f.payload.length : f.payload?.length || 0,
            });
        });
        ws.on('framereceived', (f) => {
            wsLog.push({
                event: 'framereceived',
                t: Date.now() - navStart,
                url,
                opcode: f.opcode,
                payloadBytes: typeof f.payload === 'string' ? f.payload.length : f.payload?.length || 0,
            });
        });
        ws.on('close', () => {
            wsLog.push({ event: 'close', t: Date.now() - navStart, url });
        });
    });

    const response = await page.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const domContentLoadedMs = Date.now() - navStart;

    await page
        .waitForFunction(
            () =>
                document.documentElement?.dataset?.tenantMetaverseReady === 'true' ||
                window.__tenantMetaverseReady === true,
            { timeout: READY_TIMEOUT_MS },
        )
        .catch(() => null);

    const readyMs = Date.now() - navStart;

    await page.waitForTimeout(3000);

    const perf = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const resources = performance.getEntriesByType('resource').map((r) => ({
            name: r.name,
            initiatorType: r.initiatorType,
            duration: r.duration,
            transferSize: r.transferSize,
            encodedBodySize: r.encodedBodySize,
            startTime: r.startTime,
        }));
        return {
            initPhase: window.__tenantInitPhase,
            tenantReady: !!window.__tenantMetaverseReady,
            navigation: nav
                ? {
                      domContentLoaded: nav.domContentLoadedEventEnd,
                      loadEventEnd: nav.loadEventEnd,
                      responseEnd: nav.responseEnd,
                      transferSize: nav.transferSize,
                  }
                : null,
            resourceCount: resources.length,
            resourcesTopSlow: resources.sort((a, b) => b.duration - a.duration).slice(0, 40),
        };
    });

    await browser.close();

    const summary = summarize(networkLog);
    const errors = {
        consoleErrors: consoleLog.filter((c) => c.type === 'error' || c.type === 'pageerror'),
        http4xx5xx: networkLog.filter((e) => e.status >= 400 || e.failed),
        failedRequests: networkLog.filter((e) => e.failed),
    };
    const payload = {
        entryUrl: ENTRY_URL,
        httpStatus: response?.status(),
        domContentLoadedMs,
        readyMs,
        perf,
        network: {
            requestCount: networkLog.length,
            summary,
            entries: networkLog,
        },
        websocket: wsLog,
        console: consoleLog,
        errors,
    };

    fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`);

    const lines = [
        `# 本番メタバース load profile`,
        ``,
        `- URL: ${ENTRY_URL}`,
        `- DOMContentLoaded (計測): ${domContentLoadedMs} ms`,
        `- Ready 待ち: ${readyMs} ms`,
        `- initPhase: ${perf.initPhase ?? '(unknown)'}`,
        `- HTTP requests: ${networkLog.length}`,
        ``,
        `## バケット集計（requestfinished 所要時間合計）`,
        ``,
        `| bucket | count | total ms | bytes |`,
        `|--------|------:|---------:|------:|`,
    ];
    for (const [k, v] of Object.entries(summary.byBucket).sort((a, b) => b[1].totalMs - a[1].totalMs)) {
        lines.push(`| ${k} | ${v.count} | ${Math.round(v.totalMs)} | ${v.bytes} |`);
    }
    lines.push('', '## 遅いリクエスト (>=500ms)', '');
    for (const s of summary.slow.slice(0, 35)) {
        lines.push(`- **${Math.round(s.durationMs)}ms** ${s.method} ${s.status} ${s.url.slice(0, 120)}`);
    }
    lines.push('', '## Performance API 上位', '');
    for (const r of perf.resourcesTopSlow?.slice(0, 25) || []) {
        lines.push(`- ${Math.round(r.duration)}ms ${r.initiatorType} ${r.name.slice(0, 100)}`);
    }
    lines.push('', `## コンソール (${consoleLog.length} 行)`, '');
    for (const c of consoleLog.filter((x) => x.type === 'error' || x.type === 'pageerror').slice(0, 30)) {
        lines.push(`- [${c.type} @${c.t}ms] ${c.text.slice(0, 200)}`);
    }

    fs.writeFileSync(outMd, `${lines.join('\n')}\n`);
    console.log(JSON.stringify({ outJson, outMd, domContentLoadedMs, readyMs, summary: summary.byBucket }));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
