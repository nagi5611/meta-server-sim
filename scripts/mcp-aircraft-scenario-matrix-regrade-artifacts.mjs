#!/usr/bin/env node
/**
 * マトリクス途中失敗時、artifacts 内の直近 JSON から 25 ケース表を再集計する。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
    MATRIX_DURATIONS_SEC,
    MATRIX_VARIANTS,
    evaluateMatrixCase,
    expectedPrimaryFromCalibration,
    extractMatrixMetrics,
} from '../lib/aircraft-scenario-matrix-eval.js';

const ARTIFACTS = process.env.MCP_ARTIFACTS_DIR || '/opt/cursor/artifacts';
const AIRFRAME = 'A320';
const REQUIRED_SLOT = 'p01-scenario-a320';

/** @param {string} dir @param {string} prefix */
async function latestReport(dir, prefix) {
    const names = await fs.readdir(dir);
    const matches = names
        .filter((n) => n.startsWith(prefix) && n.endsWith('.json'))
        .sort();
    if (!matches.length) return null;
    const raw = await fs.readFile(path.join(dir, matches[matches.length - 1]), 'utf8');
    return JSON.parse(raw);
}

async function main() {
    /** @type {Record<string, number>} */
    const calibration = {};
    for (const v of MATRIX_VARIANTS) {
        const report = await latestReport(ARTIFACTS, `aircraft-scenario-matrix-${v.kind}-5s-`);
        const m = extractMatrixMetrics(report, v.kind);
        if (m?.primary > 0) calibration[v.kind] = m.primary;
    }

    const rows = [];
    for (const variant of MATRIX_VARIANTS) {
        const ref5 = calibration[variant.kind];
        const prevPrimary = { value: /** @type {number | null} */ (null) };
        for (const durationSec of MATRIX_DURATIONS_SEC) {
            const expected = expectedPrimaryFromCalibration(ref5 ?? 0, durationSec);
            const report = await latestReport(
                ARTIFACTS,
                `aircraft-scenario-matrix-${variant.kind}-${durationSec}s-`,
            );
            const m = extractMatrixMetrics(report, variant.kind);
            const actualPrimary = m?.primary ?? 0;
            const evalResult = evaluateMatrixCase({
                expected,
                actual: actualPrimary,
                prevPrimary: prevPrimary.value,
                slotId: m?.slotId ?? null,
                errors: report?.errors ?? [],
            });
            const pass =
                Boolean(ref5) &&
                evalResult.pass &&
                m?.slotId === REQUIRED_SLOT &&
                !(report?.errors?.length);
            if (pass && m) prevPrimary.value = m.primary;
            rows.push({
                scenario: `${variant.kind}_${durationSec}s`,
                airframe: AIRFRAME,
                expected: Number(expected.toFixed(4)),
                actual: m
                    ? {
                          primary: Number(m.primary.toFixed(4)),
                          deltaM: Number(m.deltaM.toFixed(4)),
                          headingChangeDeg: Number(m.headingChangeDeg.toFixed(4)),
                          altitudeGainM: Number(m.altitudeGainM.toFixed(4)),
                      }
                    : null,
                deviationPct: evalResult.deviationPct,
                pass: Boolean(pass),
                failReasons: evalResult.reasons,
                slotId: m?.slotId ?? null,
                reportPath: report
                    ? `aircraft-scenario-matrix-${variant.kind}-${durationSec}s-*.json`
                    : null,
            });
        }
    }

    const summary = {
        regradedAt: new Date().toISOString(),
        artifactsDir: ARTIFACTS,
        calibration,
        matrix: rows,
        passCount: rows.filter((r) => r.pass).length,
        totalCases: rows.length,
        allPass: rows.every((r) => r.pass),
        note: 'artifact 再集計。各ケースは該当プレフィックスの最後の JSON（タイムスタンプ名）を採用。',
    };
    const out = path.join(ARTIFACTS, 'mcp-aircraft-scenario-matrix-regrade.json');
    await fs.writeFile(out, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});