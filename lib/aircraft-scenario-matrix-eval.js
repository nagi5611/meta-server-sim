// lib/aircraft-scenario-matrix-eval.js — 飛行シナリオマトリクス合否（キャリブ ±20%・単調増加・0 変化 NG）

import { shortestHeadingDeltaDeg } from '../addons/aircraft/lib/aircraft-scenario-report.js';

/** @typedef {'straight'|'yaw-right'|'climb'|'roll'|'combo'} MatrixVariantKind */

const REQUIRED_SLOT_ID = 'p01-scenario-a320';

/**
 * @param {{ x: number, y: number, z: number, w: number }} q
 * @returns {number}
 */
export function quaternionRollDegAbs(q) {
    const sinr = 2 * (q.w * q.x + q.y * q.z);
    const cosr = 1 - 2 * (q.x * q.x + q.y * q.y);
    return (Math.atan2(sinr, cosr) * 180) / Math.PI;
}

/**
 * @param {import('../addons/aircraft/lib/aircraft-scenario-types.js').AircraftScenarioReport | null | undefined} report
 * @param {MatrixVariantKind} variantKind
 */
export function extractMatrixMetrics(report, variantKind) {
    const samples = report?.samples;
    if (!Array.isArray(samples) || samples.length < 2) {
        return null;
    }
    const start = samples[0];
    const end = samples[samples.length - 1];
    const deltaM = Math.hypot(
        end.position.x - start.position.x,
        end.position.y - start.position.y,
        end.position.z - start.position.z,
    );
    const headingChangeDeg = shortestHeadingDeltaDeg(end.headingDeg, start.headingDeg);
    const altitudeGainM = end.position.y - start.position.y;
    const rollChangeDeg = Math.abs(
        quaternionRollDegAbs(end.quaternion) - quaternionRollDegAbs(start.quaternion),
    );

    /** @type {Record<MatrixVariantKind, number>} */
    const primaryByKind = {
        straight: deltaM,
        'yaw-right': headingChangeDeg,
        climb: altitudeGainM,
        roll: Math.max(rollChangeDeg, deltaM * 0.25),
        combo: deltaM + headingChangeDeg + Math.max(0, altitudeGainM),
    };

    return {
        deltaM,
        headingChangeDeg,
        altitudeGainM,
        rollChangeDeg,
        primary: primaryByKind[variantKind],
        slotId: report?.slotId ?? null,
        reportPass: report?.pass === true,
        errors: report?.errors ?? [],
    };
}

/**
 * @param {number} referenceAt5Sec
 * @param {number} durationSec
 */
export function expectedPrimaryFromCalibration(referenceAt5Sec, durationSec) {
    const ref = Number(referenceAt5Sec);
    const d = Number(durationSec);
    if (!Number.isFinite(ref) || ref <= 0 || !Number.isFinite(d) || d <= 0) return 0;
    return (ref * d) / 5;
}

/**
 * @param {{
 *   expected: number,
 *   actual: number,
 *   prevPrimary?: number | null,
 *   slotId?: string | null,
 *   errors?: string[],
 *   toleranceRatio?: number,
 * }} input
 */
export function evaluateMatrixCase(input) {
    const toleranceRatio = input.toleranceRatio ?? 0.2;
    const reasons = [];

    if (input.slotId !== REQUIRED_SLOT_ID) {
        reasons.push(`slot must be ${REQUIRED_SLOT_ID}, got ${input.slotId ?? 'null'}`);
    }
    if (input.errors?.length) {
        reasons.push(`report errors: ${input.errors.join('; ')}`);
    }
    if (!Number.isFinite(input.actual) || input.actual <= 0) {
        reasons.push('zero_or_missing_motion');
    }
    if (
        input.prevPrimary != null &&
        Number.isFinite(input.prevPrimary) &&
        Number.isFinite(input.actual) &&
        input.actual + 1e-6 < input.prevPrimary
    ) {
        reasons.push('not_monotonic_vs_shorter_duration');
    }

    const expected = Number(input.expected);
    if (Number.isFinite(expected) && expected > 0 && Number.isFinite(input.actual)) {
        const lo = expected * (1 - toleranceRatio);
        const hi = expected * (1 + toleranceRatio);
        if (input.actual < lo || input.actual > hi) {
            reasons.push(
                `outside ±${Math.round(toleranceRatio * 100)}% (expected ${expected.toFixed(3)}, actual ${input.actual.toFixed(3)}, band ${lo.toFixed(3)}–${hi.toFixed(3)})`,
            );
        }
    } else if (expected <= 0) {
        reasons.push('invalid_calibration_expected');
    }

    const pass = reasons.length === 0;
    const deviationPct =
        Number.isFinite(expected) && expected > 0 && Number.isFinite(input.actual)
            ? ((input.actual - expected) / expected) * 100
            : null;

    return { pass, reasons, deviationPct, expected, actual: input.actual };
}

/**
 * マトリクス用シナリオ JSON を組み立てる（公式コントロールと同系、秒数のみ可変）
 * @param {MatrixVariantKind} kind
 * @param {number} durationSec
 * @param {number} expectedPrimary
 * @param {{ metric: 'deltaM'|'heading'|'altitude'|'combo' }} calibrationHint
 */
export function buildMatrixScenario(kind, durationSec, expectedPrimary, calibrationHint) {
    const d = durationSec;
    /** @type {import('../addons/aircraft/lib/aircraft-scenario-types.js').AircraftScenarioStep[]} */
    let steps;
    if (kind === 'combo') {
        steps = [
            { durationSec: d * 0.4, controls: { thrust: 1, yaw: 0, pitch: 0, roll: 0 } },
            { durationSec: d * 0.35, controls: { thrust: 0.5, yaw: 1, pitch: 0, roll: 0 } },
            { durationSec: d * 0.25, controls: { thrust: 1, yaw: 0, pitch: 0.65, roll: 0 } },
        ];
    } else {
        /** @type {Record<MatrixVariantKind, import('../addons/aircraft/lib/aircraft-scenario-types.js').AircraftScenarioControls>} */
        const controls = {
            straight: { thrust: 1, yaw: 0, pitch: 0, roll: 0 },
            'yaw-right': { thrust: 0.55, yaw: 1, pitch: 0, roll: 0 },
            climb: { thrust: 1, yaw: 0, pitch: 0.75, roll: 0 },
            roll: { thrust: 0.5, yaw: 0, pitch: 0, roll: 1 },
            combo: { thrust: 1, yaw: 0, pitch: 0, roll: 0 },
        };
        steps = [{ durationSec: d, controls: controls[kind] }];
    }

    /** @type {import('../addons/aircraft/lib/aircraft-scenario-types.js').AircraftScenarioCheckpoint[]} */
    const checkpoints = [];
    const atTimeSec = steps.reduce((acc, s) => acc + s.durationSec, 0);
    const tol = Math.max(expectedPrimary * 0.2, 0.5);

    if (calibrationHint.metric === 'deltaM') {
        checkpoints.push({
            atTimeSec,
            expect: { deltaPosition: { x: 0, y: 0, z: -expectedPrimary } },
            tolerance: { positionM: tol },
        });
    } else if (calibrationHint.metric === 'heading') {
        checkpoints.push({
            atTimeSec,
            expect: { minHeadingChangeDeg: expectedPrimary },
            tolerance: { headingDeg: tol },
        });
    } else if (calibrationHint.metric === 'altitude') {
        checkpoints.push({
            atTimeSec,
            expect: { minAltitudeGain: expectedPrimary },
            tolerance: { altitudeM: tol },
        });
    } else {
        checkpoints.push({
            atTimeSec,
            expect: {
                minHeadingChangeDeg: expectedPrimary * 0.35,
                minAltitudeGain: expectedPrimary * 0.25,
            },
            tolerance: { headingDeg: tol, altitudeM: tol },
        });
    }

    return {
        id: `matrix-${kind}-${d}s`,
        version: 1,
        name: `matrix ${kind} ${d}s`,
        controlMode: 'easy',
        slotId: REQUIRED_SLOT_ID,
        teleportPosition: { x: 211, y: 1.2, z: 11 },
        sampleIntervalMs: 100,
        steps,
        checkpoints,
    };
}

/** @type {{ kind: MatrixVariantKind, metric: 'deltaM'|'heading'|'altitude'|'combo' }[]} */
export const MATRIX_VARIANTS = [
    { kind: 'straight', metric: 'deltaM' },
    { kind: 'yaw-right', metric: 'heading' },
    { kind: 'climb', metric: 'altitude' },
    { kind: 'roll', metric: 'deltaM' },
    { kind: 'combo', metric: 'combo' },
];

export const MATRIX_DURATIONS_SEC = [1, 2, 3, 4, 5];