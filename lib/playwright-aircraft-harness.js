// lib/playwright-aircraft-harness.js — headless 飛行シナリオ用 Playwright 起動・ページ初期化

/** @type {readonly string[]} */
export const PLAYWRIGHT_SCENARIO_BROWSER_ARGS = [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    '--use-gl=angle',
    '--enable-webgl',
];

/**
 * E2E ハーネス（飛行シナリオ計測）向けの init script 本体
 */
export function aircraftScenarioHarnessInitScript() {
    window.__TENANT_E2E_HARNESS__ = '1';
    document.documentElement.dataset.e2eHarness = '1';
    localStorage.setItem('metaverse-control-scheme', 'keyboard');
}