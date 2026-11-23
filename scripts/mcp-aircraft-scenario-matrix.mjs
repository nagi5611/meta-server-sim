#!/usr/bin/env node
/**
 * P-01 A320 専用スロットで 5×5 飛行マトリクスを本番検証（キャリブ ±20%、単調増加、0 変化 NG）
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    MATRIX_DURATIONS_SEC,
    MATRIX_VARIANTS,
    buildMatrixScenario,
    evaluateMatrixCase,
    expectedPrimaryFromCalibration,
    extractMatrixMetrics,
} from '../lib/aircraft-scenario-matrix-eval.js';
import { runAircraftScenarioFromPathOrObject } from '../lib/mcp-aircraft-scenario-run.js';
import { runP01LobbyHeadedCheck } from './mcp-p01-lobby-headed-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const BASE_URL = process.env.AIRCRAFT_SCENARIO_BASE_URL || 'https://sim.mmh-virtual.jp';
const TENANT = process.env.WORLD_EDIT_MCP_TENANT_ID || 'P-01';
const ARTIFACTS = process.env.MCP_ARTIFACTS_DIR || '/opt/cursor/artifacts';
const MAX_ATTEMPTS = Number(process.env.MCP_MATRIX_MAX_ATTEMPTS || 5);
const REQUIRED_SLOT = 'p01-scenario-a320';
const AIRFRAME = 'A320';

/** @returns {Parameters<typeof runAircraftScenarioFromPathOrObject>[1]} */
function scenarioRunOpts(extra = {}) {
    return {
        baseUrl: BASE_URL,
        tenantId: TENANT,
        artifactsDir: ARTIFACTS,
        ...extra,
    };
}

/** @typedef {import('../lib/aircraft-scenario-matrix-eval.js').MatrixVariantKind} MatrixVariantKind */

/**
 * @param {unknown} report
 * @param {MatrixVariantKind} kind
 */
function metricsFromReport(report, kind) {
    return extractMatrixMetrics(/** @type {any} */ (report), kind);
}

/**
 * @param {Record<MatrixVariantKind, number>} calibration
 * @param {{ kind: MatrixVariantKind, metric: string }} variant
 */
async function runCalibration5s(variant, calibration) {
    const scenario = buildMatrixScenario(
        variant.kind,
        5,
        100,
        { metric: /** @type {'deltaM'|'heading'|'altitude'|'combo'} */ (variant.metric) },
    );
    const report = await runAircraftScenarioFromPathOrObject(scenario, scenarioRunOpts());
    const m = metricsFromReport(report, variant.kind);
    if (!m || m.primary <= 0 || m.slotId !== 'p01-scenario-a320') {
        throw new Error(
            `calibration failed for ${variant.kind}: slot=${m?.slotId} primary=${m?.primary} errors=${JSON.stringify(report?.errors)}`,
        );
    }
    calibration[variant.kind] = m.primary;
    return { report, metrics: m };
}

/**
 * @param {Record<MatrixVariantKind, number>} calibration
 */
async function runMatrix(calibration) {
    /** @type {Record<MatrixVariantKind, number | null>} */
    const prevPrimary = {
        straight: null,
        'yaw-right': null,
        climb: null,
        roll: null,
        combo: null,
    };

    /** @type {Array<Record<string, unknown>>} */
    const rows = [];

    for (const variant of MATRIX_VARIANTS) {
        const ref5 = calibration[variant.kind];
        for (const durationSec of MATRIX_DURATIONS_SEC) {
            const expected = expectedPrimaryFromCalibration(ref5, durationSec);
            const scenario = buildMatrixScenario(variant.kind, durationSec, expected, {
                metric: /** @type {'deltaM'|'heading'|'altitude'|'combo'} */ (variant.metric),
            });

            let attempt = 0;
            let pass = false;
            /** @type {unknown} */
            let lastReport = null;
            /** @type {import('../lib/aircraft-scenario-matrix-eval.js').extractMatrixMetrics extends (...args: any) => infer R ? R : never} */
            let lastMetrics = null;
            /** @type {string[]} */
            let failReasons = [];

            while (attempt < MAX_ATTEMPTS && !pass) {
                attempt += 1;
                lastReport = await runAircraftScenarioFromPathOrObject(scenario, scenarioRunOpts());
                lastMetrics = metricsFromReport(lastReport, variant.kind);
                const actualPrimary = lastMetrics?.primary ?? 0;
                const evalResult = evaluateMatrixCase({
                    expected,
                    actual: actualPrimary,
                    prevPrimary: prevPrimary[variant.kind],
                    slotId: lastMetrics?.slotId ?? null,
                    errors: lastReport?.errors ?? [],
                });
                pass =
                    evalResult.pass &&
                    lastReport?.pass === true &&
                    (lastReport?.errors?.length ?? 0) === 0;
                failReasons = evalResult.reasons;
                if (!pass) {
                    await new Promise((r) => setTimeout(r, 1500 + attempt * 500));
                }
            }

            if (lastMetrics && pass) {
                prevPrimary[variant.kind] = lastMetrics.primary;
            }

            rows.push({
                scenario: `${variant.kind}_${durationSec}s`,
                airframe: AIRFRAME,
                variant: variant.kind,
                durationSec,
                expected: Number(expected.toFixed(4)),
                actual: lastMetrics
                    ? {
                          primary: Number(lastMetrics.primary.toFixed(4)),
                          deltaM: Number(lastMetrics.deltaM.toFixed(4)),
                          headingChangeDeg: Number(lastMetrics.headingChangeDeg.toFixed(4)),
                          altitudeGainM: Number(lastMetrics.altitudeGainM.toFixed(4)),
                      }
                    : null,
                deviationPct:
                    lastMetrics && expected > 0
                        ? Number((((lastMetrics.primary - expected) / expected) * 100).toFixed(2))
                        : null,
                pass,
                attemptsToPass: pass ? attempt : null,
                attemptsRun: attempt,
                failReasons: pass ? [] : failReasons,
                slotId: lastReport?.slotId ?? null,
                checkpointPass: lastReport?.pass ?? false,
                reportPath: lastReport?.reportPath ?? null,
                screenshotPath: lastReport?.screenshotPath ?? null,
            });
        }
    }
    return rows;
}

async function diagnoseStraightRootCause() {
    const straightPath = path.join(ROOT, 'scenarios/aircraft/p01-straight.json');
    const report = await runAircraftScenarioFromPathOrObject(
        straightPath,
        scenarioRunOpts({ captureScreenshot: true }),
    );
    const m = metricsFromReport(report, 'straight');
    const cp = report?.checkpoints?.[0];
    return {
        reportPath: report?.reportPath,
        pass: report?.pass,
        slotId: report?.slotId,
        errors: report?.errors,
        deltaM: m?.deltaM,
        checkpointDeltaM: cp?.metrics?.deltaPositionM?.delta,
        checkpointPass: cp?.pass,
        sampleCount: report?.samples?.length ?? 0,
    };
}

async function main() {
    await fs.mkdir(ARTIFACTS, { recursive: true });
    const startedAt = new Date().toISOString();
    const headed =
        String(process.env.MCP_SCENARIO_HEADED || process.env.PLAYWRIGHT_HEADED || '1') !== '0';

    const lobbyBefore = await runP01LobbyHeadedCheck({
        artifactsDir: ARTIFACTS,
        screenshotName: 'p01-lobby-before-matrix.png',
    });
    if (!lobbyBefore.pass) {
        console.error(JSON.stringify({ fatal: 'lobby check failed before matrix', lobbyBefore }, null, 2));
        process.exit(3);
    }

    const diagnosis = await diagnoseStraightRootCause();

    /** @type {Record<MatrixVariantKind, number>} */
    const calibration = /** @type {Record<MatrixVariantKind, number>} */ ({});
    const calibrationRuns = [];
    for (const variant of MATRIX_VARIANTS) {
        const cal = await runCalibration5s(variant, calibration);
        calibrationRuns.push({
            variant: variant.kind,
            primaryAt5s: calibration[variant.kind],
            reportPath: cal.report?.reportPath,
            slotId: cal.report?.slotId,
        });
    }

    const matrixRows = await runMatrix(calibration);

    const lobbyAfter = await runP01LobbyHeadedCheck({
        artifactsDir: ARTIFACTS,
        screenshotName: 'p01-lobby-after-matrix.png',
    });

    const summary = {
        startedAt,
        finishedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        tenantId: TENANT,
        requiredSlotId: REQUIRED_SLOT,
        playwrightHeaded: headed,
        slotPolicy: 'A320 のみ使用（bc-b0586736 B787 用 p01-scenario-b787 は触らない）',
        calibration,
        calibrationRuns,
        lobbyChecks: { before: lobbyBefore, after: lobbyAfter },
        prodHead: process.env.METASIM_PROD_HEAD || null,
        diagnosis,
        rootCauseNotes: [
            '旧マトリクスは checkpoints: [] のため buildAircraftScenarioReport が errors なしで常に pass=true になり、movedEnough フォールバックも緩かった。',
            '9.1m vs 125m の主因は headless Playwright で document.hidden / rAF スロットリングにより frameUpdate 内の aircraftController.update が実質数フレームしか走らないこと（壁時計 5s でも移動 ~7.5m）。E2E ハーネス時は isPageVisible 無視＋visibility 偽装＋Chrome スロットリング無効化で是正。',
        ],
        matrix: matrixRows,
        allPass: matrixRows.every((r) => r.pass),
        passCount: matrixRows.filter((r) => r.pass).length,
        totalCases: matrixRows.length,
    };

    const jsonOut = path.join(ARTIFACTS, 'mcp-aircraft-scenario-matrix-report.json');
    await fs.writeFile(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);

    const mdLines = [
        '# P-01 A320 scenario matrix',
        '',
        `診断 p01-straight: deltaM=${diagnosis.deltaM ?? 'n/a'}, checkpointΔ=${diagnosis.checkpointDeltaM ?? 'n/a'}, slot=${diagnosis.slotId}`,
        '',
        '| scenario | airframe | sec | expected | actual | deviation % | pass | attempt |',
        '| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |',
    ];
    for (const r of matrixRows) {
        const prim = r.actual?.primary ?? '—';
        mdLines.push(
            `| ${r.scenario ?? r.variant} | ${r.airframe ?? AIRFRAME} | ${r.durationSec} | ${r.expected} | ${prim} | ${r.deviationPct ?? '—'} | ${r.pass ? 'OK' : 'NG'} | ${r.attemptsToPass ?? r.attemptsRun} |`,
        );
    }
    const mdOut = path.join(ARTIFACTS, 'mcp-aircraft-scenario-matrix-report.md');
    await fs.writeFile(mdOut, `${mdLines.join('\n')}\n`);

    console.log(JSON.stringify({ jsonOut, mdOut, allPass: summary.allPass, passCount: summary.passCount }, null, 2));
    process.exit(summary.allPass ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});