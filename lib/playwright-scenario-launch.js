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
 * @param {{ headless?: boolean }} [opts]
 */
export function chromiumScenarioLaunchOptions(opts = {}) {
    const headless = resolvePlaywrightHeadless(opts);
    return {
        headless,
        args: [...PLAYWRIGHT_SCENARIO_BROWSER_ARGS, ...PLAYWRIGHT_SCENARIO_THROTTLE_ARGS],
    };
}