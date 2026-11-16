#!/usr/bin/env node
/**
 * P-01 新校舎: FDS 煙を最終フレームまで再生できるか本番検証
 */
import fs from 'node:fs';
import path from 'node:path';
import {
    closeBrowserSession,
    getOrLaunchBrowserSession,
} from '../lib/mcp-browser-metamask.js';
import {
    dismissBlockingModals,
    unlockGameplayPhysics,
} from '../e2e/helpers/tenant-metaverse-agent.mjs';
import {
    installTenantE2EHarness,
    enableDeveloperMode,
} from '../e2e/helpers/tenant-metaverse.mjs';

const ARTIFACT_DIR = process.env.MCP_VERIFY_ARTIFACT_DIR || '/opt/cursor/artifacts';
const TENANT_URL = process.env.BROWSER_METAMASK_BASE_URL || 'https://sim.mmh-virtual.jp/P-01/';
const SMOKE_ID = process.env.MCP_VERIFY_SMOKE_ID || 'fugaku-prod01-smoke';
const WORLD_ID = 'school';
const SECONDS_PER_FRAME = Number(process.env.MCP_VERIFY_SECONDS_PER_FRAME || 0.08);
const POLL_MS = 250;
const STALL_MS = 60_000;
const TICK_DT = Number(process.env.MCP_VERIFY_TICK_DT || 0.12);
const MAX_WALL_MS = Number(process.env.MCP_VERIFY_MAX_WALL_MS || 900_000);

async function schoolWorldReady(page) {
    await page.goto(TENANT_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(
        () => document.documentElement.dataset.tenantMetaverseReady === 'true',
        null,
        { timeout: 300_000 },
    );
    await dismissBlockingModals(page);
    await unlockGameplayPhysics(page);
    await page.waitForFunction(
        () => Boolean(window.__tenantE2E?.getSocket?.()?.connected),
        null,
        { timeout: 120_000 },
    );
    await page.evaluate(async (wid) => window.__tenantE2E.switchToWorld(wid), WORLD_ID);
    await page.waitForFunction(
        () => window.__tenantE2E?.getCurrentWorldId?.() === 'school',
        null,
        { timeout: 300_000 },
    );
    await page.waitForFunction(
        () => Boolean(window.__tenantE2E?.fdsSmokeHasEntries?.()),
        null,
        { timeout: 300_000 },
    );
}

function writePlaybackArtifacts({
    report,
    timeline,
    fdsLogLines,
}) {
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'fds-full-playback-report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'fds-full-playback-timeline.json'), JSON.stringify(timeline, null, 2));
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'fds-full-playback-console.log'), fdsLogLines.join('\n'));
}

async function main() {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const timeline = [];
    const fdsLogLines = [];
    let pageCrashReason = null;

    const ctx = await getOrLaunchBrowserSession();
    const page = await ctx.newPage();
    page.on('crash', () => {
        pageCrashReason = 'renderer-crashed';
    });
    page.on('close', () => {
        if (!pageCrashReason) pageCrashReason = 'page-closed';
    });
    await installTenantE2EHarness(page);
    await enableDeveloperMode(page);
    await page.addInitScript(() => {
        localStorage.setItem('username', `McpFdsFull-${Date.now()}`);
        localStorage.setItem('metaverse-control-scheme', 'keyboard');
    });

    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[FDS smoke]')) {
            fdsLogLines.push(text);
            if (fdsLogLines.length <= 30 || fdsLogLines.length % 50 === 0) {
                console.log(`[browser] ${text}`);
            }
        }
    });

    await schoolWorldReady(page);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'fds-full-school-ready.png') });

    const before = await page.evaluate((id) => window.__tenantE2E.getFdsSmokePlaybackState(id), SMOKE_ID);
    if (!before?.frameCount) {
        throw new Error(`smoke not loaded: ${JSON.stringify(before)}`);
    }

    /** @type {{ parts: number, loaded: number, failed?: string[] }} */
    let warm = { parts: 0, loaded: 0, failed: [] };
    for (let attempt = 1; attempt <= 4; attempt++) {
        warm = await page.evaluate(async (id) => window.__tenantE2E.warmFdsSmokeMultipartCache(id), SMOKE_ID);
        console.log(`multipart cache warm attempt ${attempt}:`, JSON.stringify(warm));
        if (warm.parts > 0 && warm.loaded === warm.parts) {
            break;
        }
        await page.waitForTimeout(3000);
    }
    if (warm.parts > 0 && warm.loaded !== warm.parts) {
        throw new Error(`multipart warm incomplete: ${JSON.stringify(warm)}`);
    }

    await page.evaluate(
        async ({ smokeId, spf }) => {
            await window.__tenantE2E.startFdsSmokePlayback(smokeId, {
                fromFrame: 0,
                loop: false,
                secondsPerFrame: spf,
            });
        },
        { smokeId: SMOKE_ID, spf: SECONDS_PER_FRAME },
    );

    const t0 = Date.now();
    let lastFrame = -1;
    let lastAdvanceMs = t0;
    let reachedEnd = false;
    let loopError = null;

    while (Date.now() - t0 < MAX_WALL_MS) {
        try {
            await page.evaluate(
                (dt) => {
                    window.__tenantE2E.tickFdsSmokePlayback(dt);
                },
                TICK_DT,
            );
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                });
            });
        } catch (err) {
            loopError = err;
            pageCrashReason = pageCrashReason || String(err?.message || err);
            break;
        }
        let state;
        try {
            state = await page.evaluate((id) => window.__tenantE2E.getFdsSmokePlaybackState(id), SMOKE_ID);
        } catch (err) {
            loopError = err;
            pageCrashReason = pageCrashReason || String(err?.message || err);
            break;
        }
        const elapsed = Date.now() - t0;
        timeline.push({ elapsedMs: elapsed, ...state });

        if (state?.frameIndex != null && state.frameIndex > lastFrame) {
            lastFrame = state.frameIndex;
            lastAdvanceMs = Date.now();
        }

        if (state?.atEnd || (state?.maxFrame != null && state.frameIndex >= state.maxFrame && !state.playing)) {
            reachedEnd = true;
            break;
        }

        if (!state?.playing && state?.frameIndex > 0 && state.frameIndex < state.maxFrame) {
            throw new Error(`playback stopped early at frame ${state.frameIndex}/${state.maxFrame}`);
        }

        if (Date.now() - lastAdvanceMs >= STALL_MS) {
            throw new Error(
                `stalled at frame ${state?.frameIndex}/${state?.maxFrame} for ${STALL_MS}ms`,
            );
        }

        await page.waitForTimeout(POLL_MS);
    }

    let finalState = timeline.length ? timeline[timeline.length - 1] : null;
    try {
        finalState = await page.evaluate((id) => window.__tenantE2E.getFdsSmokePlaybackState(id), SMOKE_ID);
    } catch {
        /* page may have crashed */
    }
    try {
        await page.screenshot({ path: path.join(ARTIFACT_DIR, 'fds-full-playback-end.png') });
    } catch {
        /* optional if tab died */
    }

    const report = {
        smokeId: SMOKE_ID,
        multipartWarm: warm,
        secondsPerFrame: SECONDS_PER_FRAME,
        tickDt: TICK_DT,
        wallMs: Date.now() - t0,
        reachedEnd,
        finalFrame: finalState?.frameIndex,
        maxFrame: finalState?.maxFrame,
        frameCount: finalState?.frameCount,
        playing: finalState?.playing,
        pageCrashReason,
        loopError: loopError ? String(loopError?.message || loopError) : null,
        success:
            reachedEnd &&
            finalState != null &&
            finalState.frameIndex >= finalState.maxFrame &&
            !finalState.playing,
        timelineSamples: timeline.length,
        lastTimeline: timeline.slice(-5),
        fdsLogTail: fdsLogLines.slice(-15),
    };

    writePlaybackArtifacts({ report, timeline, fdsLogLines });
    console.log(JSON.stringify(report, null, 2));

    await closeBrowserSession();
    process.exit(report.success ? 0 : 1);
}

main().catch(async (e) => {
    console.error(e);
    await closeBrowserSession().catch(() => {});
    process.exit(1);
});