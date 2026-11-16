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
const STALL_MS = Number(process.env.MCP_VERIFY_STALL_MS || 180_000);
const TICK_DT = Number(process.env.MCP_VERIFY_TICK_DT || 0.12);
const TICKS_PER_POLL = Number(process.env.MCP_VERIFY_TICKS_PER_POLL || 24);
const MAX_WALL_MS = Number(process.env.MCP_VERIFY_MAX_WALL_MS || 900_000);
const SKIP_MULTIPART_WARM = process.env.MCP_VERIFY_SKIP_MULTIPART_WARM === '1';

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
    try {
        await page.screenshot({
            path: path.join(ARTIFACT_DIR, 'fds-full-school-ready.png'),
            timeout: 120_000,
            animations: 'disabled',
        });
    } catch (e) {
        console.warn('school ready screenshot skipped:', e instanceof Error ? e.message : e);
    }

    const before = await page.evaluate((id) => window.__tenantE2E.getFdsSmokePlaybackState(id), SMOKE_ID);
    if (!before?.frameCount) {
        throw new Error(`smoke not loaded: ${JSON.stringify(before)}`);
    }

    const t0 = Date.now();
    let reachedEnd = false;
    let loopError = null;
    let harnessResult = null;
  let warm = { parts: 0, loaded: 0, skipped: SKIP_MULTIPART_WARM };

    try {
        harnessResult = await page.evaluate(
            async (opts) => {
                const runner = window.__tenantE2E?.runFdsSmokePlaybackUntilEnd;
                if (typeof runner !== 'function') {
                    return { __missingHarness: true };
                }
                return runner(opts.smokeId, {
                    secondsPerFrame: opts.secondsPerFrame,
                    tickDt: opts.tickDt,
                    ticksPerBatch: opts.ticksPerPoll,
                    stallMs: opts.stallMs,
                    maxWallMs: opts.maxWallMs,
                    warmMultipart: opts.warmMultipart,
                });
            },
            {
                smokeId: SMOKE_ID,
                secondsPerFrame: SECONDS_PER_FRAME,
                tickDt: TICK_DT,
                ticksPerPoll: TICKS_PER_POLL,
                stallMs: STALL_MS,
                maxWallMs: MAX_WALL_MS,
                warmMultipart: !SKIP_MULTIPART_WARM,
            },
            { timeout: MAX_WALL_MS + 180_000 },
        );
    } catch (err) {
        loopError = err;
        pageCrashReason = pageCrashReason || String(err?.message || err);
    }

    if (harnessResult?.__missingHarness) {
        throw new Error(
            'runFdsSmokePlaybackUntilEnd missing on production bundle; deploy latest main and retry',
        );
    }

    if (harnessResult?.timeline?.length) {
        for (const sample of harnessResult.timeline) {
            timeline.push({
                elapsedMs: sample.elapsedMs,
                frameIndex: sample.frameIndex,
                frameCount: sample.frameCount,
                maxFrame: sample.maxFrame,
                playing: sample.playing,
                atEnd: sample.atEnd,
            });
        }
    }

    if (harnessResult?.multipartWarm) {
        warm = harnessResult.multipartWarm;
    }
    if (harnessResult?.error) {
        loopError = loopError || new Error(harnessResult.error);
    }

    reachedEnd = Boolean(harnessResult?.reachedEnd);
    const finalState = harnessResult?.finalState ?? (timeline.length ? timeline[timeline.length - 1] : null);
    try {
        await page.screenshot({
            path: path.join(ARTIFACT_DIR, 'fds-full-playback-end.png'),
            timeout: 120_000,
            animations: 'disabled',
        });
    } catch (e) {
        console.warn('playback end screenshot skipped:', e instanceof Error ? e.message : e);
    }

    const report = {
        smokeId: SMOKE_ID,
        multipartWarm: warm,
        secondsPerFrame: SECONDS_PER_FRAME,
        tickDt: TICK_DT,
        ticksPerPoll: TICKS_PER_POLL,
        wallMs: harnessResult?.wallMs ?? Date.now() - t0,
        reachedEnd,
        finalFrame: finalState?.frameIndex,
        maxFrame: finalState?.maxFrame,
        frameCount: finalState?.frameCount,
        playing: finalState?.playing,
        pageCrashReason,
        loopError: loopError ? String(loopError?.message || loopError) : null,
        harnessError: harnessResult?.error ?? null,
        success: Boolean(
            harnessResult?.success &&
            finalState != null &&
            finalState.frameIndex >= finalState.maxFrame &&
            !finalState.playing,
        ),
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