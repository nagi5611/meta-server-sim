#!/usr/bin/env node
/**
 * P-01 A320: 25ケース二段階マトリクス
 * 1) キャリブ: 各ケース3回 → 中央値（線形外挿なし）
 * 2) 検証: 別走行1回 → 中央値 ±20% ＋ 秒数単調増加
 * ケースごとに状態を書き、ブラウザは走行ごとに新規（再開可能）
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
    extractMatrixMetrics,
    medianPositiveFinite,
} from '../lib/aircraft-scenario-matrix-eval.js';
import { runAircraftScenarioFromPathOrObject } from '../lib/mcp-aircraft-scenario-run.js';
import { runP01LobbyHeadedCheck } from './mcp-p01-lobby-headed-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const BASE_URL = process.env.AIRCRAFT_SCENARIO_BASE_URL || 'https://sim.mmh-virtual.jp';
const TENANT = process.env.WORLD_EDIT_MCP_TENANT_ID || 'P-01';
const ARTIFACTS = process.env.MCP_ARTIFACTS_DIR || '/opt/cursor/artifacts';
const CALIB_REPEATS = Number(process.env.MCP_MATRIX_CALIB_REPEATS || 3);
const ENTRY_ATTEMPTS = Number(process.env.MCP_MATRIX_ENTRY_ATTEMPTS || 4);
const REQUIRED_SLOT = 'p01-scenario-a320';
const AIRFRAME = 'A320';
const STATE_VERSION = 2;
const STATE_NAME = 'mcp-aircraft-scenario-matrix-state.json';

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
 * @param {MatrixVariantKind} kind
 * @param {number} durationSec
 */
function caseKey(kind, durationSec) {
    return `${kind}_${durationSec}s`;
}

/**
 * @param {unknown} report
 * @param {MatrixVariantKind} kind
 */
function metricsFromReport(report, kind) {
    return extractMatrixMetrics(/** @type {any} */ (report), kind);
}

/**
 * @param {Record<string, unknown>} [loaded]
 */
async function loadState(loaded) {
    const statePath = path.join(ARTIFACTS, STATE_NAME);
    if (loaded) return loaded;
    try {
        const raw = JSON.parse(await fs.readFile(statePath, 'utf8'));
        if (raw?.version === STATE_VERSION && raw.cases) return raw;
    } catch {
        /* fresh */
    }
    return {
        version: STATE_VERSION,
        startedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        tenantId: TENANT,
        calibRepeats: CALIB_REPEATS,
        phase: 'calibration',
        cases: /** @type {Record<string, unknown>} */ ({}),
    };
}

/** @param {Record<string, unknown>} state */
async function saveState(state) {
    const statePath = path.join(ARTIFACTS, STATE_NAME);
    await fs.mkdir(ARTIFACTS, { recursive: true });
    state.updatedAt = new Date().toISOString();
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await writeReportFromState(state);
}

/**
 * @param {Record<string, unknown>} state
 * @param {string} key
 */
function ensureCase(state, key, variant, durationSec) {
    if (!state.cases[key]) {
        state.cases[key] = {
            scenario: key,
            airframe: AIRFRAME,
            variant: variant.kind,
            durationSec,
            calibrationPrimaries: [],
            calibrationRuns: [],
            median: null,
            validationPrimary: null,
            validationRun: null,
            pass: null,
            failReasons: [],
        };
    }
    return /** @type {any} */ (state.cases[key]);
}

/**
 * @param {{ kind: MatrixVariantKind, metric: string }} variant
 * @param {number} durationSec
 */
function buildScenarioForCase(variant, durationSec) {
    return buildMatrixScenario(variant.kind, durationSec, 0, {
        metric: /** @type {'deltaM'|'heading'|'altitude'|'combo'} */ (variant.metric),
    }, { skipCheckpoints: true });
}

/**
 * @param {{ kind: MatrixVariantKind, metric: string }} variant
 * @param {number} durationSec
 */
async function runOneScenario(variant, durationSec) {
    const scenario = buildScenarioForCase(variant, durationSec);
    let lastErr = null;
    for (let i = 1; i <= ENTRY_ATTEMPTS; i += 1) {
        try {
            process.env.MCP_SCENARIO_ENTRY_ATTEMPTS = '3';
            const report = await runAircraftScenarioFromPathOrObject(scenario, scenarioRunOpts());
            const m = metricsFromReport(report, variant.kind);
            if (!m || m.primary <= 0 || m.slotId !== REQUIRED_SLOT) {
                throw new Error(
                    `bad metrics key=${caseKey(variant.kind, durationSec)} slot=${m?.slotId} primary=${m?.primary}`,
                );
            }
            if (report?.errors?.length) {
                throw new Error(report.errors.join('; '));
            }
            return { report, metrics: m };
        } catch (err) {
            lastErr = err;
            await new Promise((r) => setTimeout(r, 1500 * i));
        }
    }
    throw lastErr;
}

/**
 * @param {Record<string, unknown>} state
 * @param {{ kind: MatrixVariantKind, metric: string }} variant
 * @param {number} durationSec
 */
async function runCalibrationCase(state, variant, durationSec) {
    const key = caseKey(variant.kind, durationSec);
    const row = ensureCase(state, key, variant, durationSec);
    while (row.calibrationPrimaries.length < CALIB_REPEATS) {
        const { report, metrics } = await runOneScenario(variant, durationSec);
        row.calibrationPrimaries.push(Number(metrics.primary.toFixed(6)));
        row.calibrationRuns.push({
            at: new Date().toISOString(),
            primary: metrics.primary,
            reportPath: report.reportPath,
            slotId: report.slotId,
        });
        row.median = medianPositiveFinite(row.calibrationPrimaries);
        await saveState(state);
        console.log(
            JSON.stringify({
                phase: 'calibration',
                case: key,
                run: row.calibrationPrimaries.length,
                primary: metrics.primary,
                median: row.median,
            }),
        );
    }
}

/**
 * @param {Record<string, unknown>} state
 * @param {{ kind: MatrixVariantKind, metric: string }} variant
 * @param {number} durationSec
 */
async function runValidationCase(state, variant, durationSec) {
    const key = caseKey(variant.kind, durationSec);
    const row = ensureCase(state, key, variant, durationSec);
    if (row.median == null || row.median <= 0) {
        throw new Error(`validation without median: ${key}`);
    }
    if (row.validationPrimary != null) return row;

    const { report, metrics } = await runOneScenario(variant, durationSec);
    const actual = metrics.primary;
    const prevIdx = MATRIX_DURATIONS_SEC.indexOf(durationSec) - 1;
    let prevPrimary = null;
    if (prevIdx >= 0) {
        const prevKey = caseKey(variant.kind, MATRIX_DURATIONS_SEC[prevIdx]);
        const prevRow = /** @type {any} */ (state.cases[prevKey]);
        prevPrimary = prevRow?.validationPrimary ?? null;
    }

    const evalResult = evaluateMatrixCase({
        expected: row.median,
        actual,
        prevPrimary,
        slotId: metrics.slotId,
        errors: report?.errors ?? [],
    });

    row.validationPrimary = Number(actual.toFixed(6));
    row.validationRun = {
        at: new Date().toISOString(),
        primary: actual,
        reportPath: report.reportPath,
        slotId: report.slotId,
    };
    row.pass = evalResult.pass;
    row.failReasons = evalResult.reasons;
    row.deviationPct = evalResult.deviationPct;
    await saveState(state);
    console.log(
        JSON.stringify({
            phase: 'validation',
            case: key,
            median: row.median,
            actual,
            pass: row.pass,
            reasons: row.failReasons,
        }),
    );
    return row;
}

/** @param {Record<string, unknown>} state */
function orderedCaseKeys() {
    /** @type {string[]} */
    const keys = [];
    for (const variant of MATRIX_VARIANTS) {
        for (const durationSec of MATRIX_DURATIONS_SEC) {
            keys.push(caseKey(variant.kind, durationSec));
        }
    }
    return keys;
}

/** @param {Record<string, unknown>} state */
function matrixRowsFromState(state) {
    return orderedCaseKeys().map((key) => {
        const row = /** @type {any} */ (state.cases[key]);
        if (!row) {
            return {
                scenario: key,
                airframe: AIRFRAME,
                calibratedMedian: null,
                validationActual: null,
                pass: false,
                failReasons: ['not_run'],
            };
        }
        return {
            scenario: row.scenario,
            airframe: row.airframe,
            variant: row.variant,
            durationSec: row.durationSec,
            calibratedMedian: row.median != null ? Number(row.median.toFixed(4)) : null,
            validationActual:
                row.validationPrimary != null ? Number(row.validationPrimary.toFixed(4)) : null,
            deviationPct: row.deviationPct ?? null,
            pass: row.pass === true,
            failReasons: row.failReasons ?? [],
            calibrationSamples: row.calibrationPrimaries?.length ?? 0,
        };
    });
}

/** @param {Record<string, unknown>} state */
async function writeReportFromState(state) {
    const rows = matrixRowsFromState(state);
    const passCount = rows.filter((r) => r.pass).length;
    const summary = {
        methodology:
            'per-case calibration median (3 runs) + separate validation vs median ±20%, monotonic on validation across durations',
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        finishedAt: state.phase === 'done' ? state.updatedAt : null,
        baseUrl: state.baseUrl,
        tenantId: state.tenantId,
        requiredSlotId: REQUIRED_SLOT,
        prodHead: process.env.METASIM_PROD_HEAD || null,
        phase: state.phase,
        matrix: rows,
        passCount,
        totalCases: rows.length,
        allPass: passCount === rows.length && rows.every((r) => r.validationActual != null),
        lobbyChecks: state.lobbyChecks ?? null,
    };

    const jsonOut = path.join(ARTIFACTS, 'mcp-aircraft-scenario-matrix-report.json');
    await fs.writeFile(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);

    const mdLines = [
        '# P-01 A320 matrix (median calibration + validation)',
        '',
        '| scenario | airframe | calibrated median | validation actual | pass |',
        '| --- | --- | ---: | ---: | --- |',
    ];
    for (const r of rows) {
        mdLines.push(
            `| ${r.scenario} | ${r.airframe} | ${r.calibratedMedian ?? '—'} | ${r.validationActual ?? '—'} | ${r.pass ? 'PASS' : 'FAIL'} |`,
        );
    }
    const mdOut = path.join(ARTIFACTS, 'mcp-aircraft-scenario-matrix-report.md');
    await fs.writeFile(mdOut, `${mdLines.join('\n')}\n`);
}

/** @param {Record<string, unknown>} state */
function calibrationComplete(state) {
    for (const variant of MATRIX_VARIANTS) {
        for (const durationSec of MATRIX_DURATIONS_SEC) {
            const key = caseKey(variant.kind, durationSec);
            const row = /** @type {any} */ (state.cases[key]);
            if (!row || row.calibrationPrimaries?.length < CALIB_REPEATS || row.median == null) {
                return false;
            }
        }
    }
    return true;
}

/** @param {Record<string, unknown>} state */
function validationComplete(state) {
    for (const key of orderedCaseKeys()) {
        const row = /** @type {any} */ (state.cases[key]);
        if (!row || row.validationPrimary == null) return false;
    }
    return true;
}

async function main() {
    await fs.mkdir(ARTIFACTS, { recursive: true });
    const resume = String(process.env.MCP_MATRIX_RESUME || '1') !== '0';
    let state = await loadState();
    const fresh = !resume || !state.cases || Object.keys(state.cases).length === 0;

    if (fresh) {
        const lobbyBefore = await runP01LobbyHeadedCheck({
            artifactsDir: ARTIFACTS,
            screenshotName: 'p01-lobby-before-matrix.png',
        });
        if (!lobbyBefore.pass) {
            console.error(JSON.stringify({ fatal: 'lobby check failed before matrix', lobbyBefore }, null, 2));
            process.exit(3);
        }
        state.lobbyChecks = { before: lobbyBefore };
        state.startedAt = new Date().toISOString();
        await saveState(state);
    }

    state.phase = 'calibration';
    for (const variant of MATRIX_VARIANTS) {
        for (const durationSec of MATRIX_DURATIONS_SEC) {
            const key = caseKey(variant.kind, durationSec);
            const row = ensureCase(state, key, variant, durationSec);
            if (row.calibrationPrimaries.length >= CALIB_REPEATS && row.median != null) continue;
            await runCalibrationCase(state, variant, durationSec);
        }
    }

    if (!calibrationComplete(state)) {
        throw new Error('calibration incomplete');
    }
    state.phase = 'validation';
    await saveState(state);

    for (const variant of MATRIX_VARIANTS) {
        for (const durationSec of MATRIX_DURATIONS_SEC) {
            const key = caseKey(variant.kind, durationSec);
            const row = /** @type {any} */ (state.cases[key]);
            if (row.validationPrimary != null) continue;
            await runValidationCase(state, variant, durationSec);
        }
    }

    if (!validationComplete(state)) {
        throw new Error('validation incomplete');
    }

    const lobbyAfter = await runP01LobbyHeadedCheck({
        artifactsDir: ARTIFACTS,
        screenshotName: 'p01-lobby-after-matrix.png',
    });
    state.lobbyChecks = { ...(state.lobbyChecks || {}), after: lobbyAfter };
    state.phase = 'done';
    state.finishedAt = new Date().toISOString();
    await saveState(state);

    const rows = matrixRowsFromState(state);
    const allPass = rows.every((r) => r.pass);
    console.log(
        JSON.stringify({
            passCount: rows.filter((r) => r.pass).length,
            totalCases: rows.length,
            allPass,
            report: path.join(ARTIFACTS, 'mcp-aircraft-scenario-matrix-report.json'),
        }),
    );
    process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});