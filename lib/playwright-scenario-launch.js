// lib/playwright-scenario-launch.js — 本番飛行シナリオ用 Playwright 起動オプション

import {
    PLAYWRIGHT_SCENARIO_BROWSER_ARGS,
    PLAYWRIGHT_SCENARIO_THROTTLE_ARGS,
} from './playwright-aircraft-harness.js';

/**
 * マトリクス / 本番検証は xvfb + headed を既定（headless は rAF 間引きで距離が狂う）
 * @param {{ headless?: boolean }} [opts]
 */
export function resolvePlaywrightHeadless(opts = {}) {
    if (typeof opts.headless === 'boolean') return opts.headless;
    const env = String(process.env.MCP_SCENARIO_HEADED || process.env.PLAYWRIGHT_HEADED || '1');
  if (env === '0' || env.toLowerCase() === 'false') return true;
    return false;
}

/**
 * xvfb + headed では --use-gl=angle が真っ黒になり tenantMetaverseReady まで到達しない。
 * @param {{ headless?: boolean }} [opts]
 */
export function resolveScenarioChromiumArgs(opts = {}) {
    const headless = resolvePlaywrightHeadless(opts);
    const glOverride = String(process.env.PLAYWRIGHT_SCENARIO_GL || '').trim();
    /** @type {string[]} */
    const glArgs = ['--enable-webgl'];
    if (glOverride) {
        glArgs.push(`--use-gl=${glOverride}`);
    } else if (!headless && process.env.DISPLAY) {
        glArgs.push('--use-gl=swiftshader');
    } else {
        glArgs.push(...PLAYWRIGHT_SCENARIO_BROWSER_ARGS.filter((a) => a !== '--enable-webgl'));
    }
    return [...glArgs, ...PLAYWRIGHT_SCENARIO_THROTTLE_ARGS];
}

/**
 * @param {{ headless?: boolean }} [opts]
 */
export function chromiumScenarioLaunchOptions(opts = {}) {
    const headless = resolvePlaywrightHeadless(opts);
    return {
        headless,
        args: resolveScenarioChromiumArgs(opts),
    };
}