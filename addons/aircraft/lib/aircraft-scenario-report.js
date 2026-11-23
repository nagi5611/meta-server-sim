// addons/aircraft/lib/aircraft-scenario-report.js — シナリオ軌跡とチェックポイントの数値検証

/**
 * @param {number} deg
 * @returns {number}
 */
export function normalizeHeadingDeg(deg) {
    let d = deg % 360;
    if (d < 0) d += 360;
    return d;
}

/**
 * 2 方位の最短角差（度）
 * @param {number} aDeg
 * @param {number} bDeg
 * @returns {number}
 */
export function shortestHeadingDeltaDeg(aDeg, bDeg) {
    let d = normalizeHeadingDeg(aDeg) - normalizeHeadingDeg(bDeg);
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return Math.abs(d);
}

/**
 * @param {{ x: number, y: number, z: number }} a
 * @param {{ x: number, y: number, z: number }} b
 * @returns {number}
 */
export function positionDistanceM(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.hypot(dx, dy, dz);
}

/**
 * @param {import('./aircraft-scenario-types.js').AircraftScenarioPoseSample[]} samples
 * @param {number} tSec
 * @returns {import('./aircraft-scenario-types.js').AircraftScenarioPoseSample | null}
 */
export function sampleAtTime(samples, tSec) {
    if (!samples.length) return null;
    let best = samples[0];
    let bestDt = Math.abs(best.tSec - tSec);
    for (const s of samples) {
        const dt = Math.abs(s.tSec - tSec);
        if (dt < bestDt) {
            bestDt = dt;
            best = s;
        }
    }
    return best;
}

/**
 * @param {import('./aircraft-scenario-types.js').AircraftScenarioCheckpoint} cp
 * @param {import('./aircraft-scenario-types.js').AircraftScenarioPoseSample | null} sample
 * @param {import('./aircraft-scenario-types.js').AircraftScenarioPoseSample | null} [startSample]
 * @returns {import('./aircraft-scenario-types.js').AircraftScenarioCheckpointResult}
 */
export function evaluateCheckpoint(cp, sample, startSample = null) {
    /** @type {import('./aircraft-scenario-types.js').AircraftScenarioCheckpointResult['metrics']} */
    const metrics = {};
    let pass = Boolean(sample);

    if (!sample) {
        return {
            label: `t=${cp.atTimeSec}s`,
            atTimeSec: cp.atTimeSec,
            pass: false,
            metrics: {
                sample: {
                    expected: 'pose',
                    actual: 'missing',
                    delta: Infinity,
                    tolerance: 0,
                    pass: false,
                },
            },
        };
    }

    const { expect, tolerance } = cp;

    if (expect.position && tolerance.positionM != null) {
        const delta = positionDistanceM(sample.position, expect.position);
        const ok = delta <= tolerance.positionM;
        metrics.positionM = {
            expected: expect.position,
            actual: sample.position,
            delta,
            tolerance: tolerance.positionM,
            pass: ok,
        };
        if (!ok) pass = false;
    }

    if (expect.headingDeg != null && tolerance.headingDeg != null) {
        const delta = shortestHeadingDeltaDeg(sample.headingDeg, expect.headingDeg);
        const ok = delta <= tolerance.headingDeg;
        metrics.headingDeg = {
            expected: expect.headingDeg,
            actual: sample.headingDeg,
            delta,
            tolerance: tolerance.headingDeg,
            pass: ok,
        };
        if (!ok) pass = false;
    }

    if (expect.altitude != null && tolerance.altitudeM != null) {
        const delta = Math.abs(sample.position.y - expect.altitude);
        const ok = delta <= tolerance.altitudeM;
        metrics.altitudeM = {
            expected: expect.altitude,
            actual: sample.position.y,
            delta,
            tolerance: tolerance.altitudeM,
            pass: ok,
        };
        if (!ok) pass = false;
    }

    if (expect.deltaPosition && tolerance.positionM != null && startSample) {
        const actualDelta = {
            x: sample.position.x - startSample.position.x,
            y: sample.position.y - startSample.position.y,
            z: sample.position.z - startSample.position.z,
        };
        const delta = positionDistanceM(actualDelta, expect.deltaPosition);
        const ok = delta <= tolerance.positionM;
        metrics.deltaPositionM = {
            expected: expect.deltaPosition,
            actual: actualDelta,
            delta,
            tolerance: tolerance.positionM,
            pass: ok,
        };
        if (!ok) pass = false;
    }

    if (expect.minAltitudeGain != null && tolerance.altitudeM != null && startSample) {
        const gain = sample.position.y - startSample.position.y;
        const ok = gain >= expect.minAltitudeGain - tolerance.altitudeM;
        metrics.minAltitudeGain = {
            expected: expect.minAltitudeGain,
            actual: gain,
            delta: Math.max(0, expect.minAltitudeGain - gain),
            tolerance: tolerance.altitudeM,
            pass: ok,
        };
        if (!ok) pass = false;
    }

    if (expect.minHeadingChangeDeg != null && tolerance.headingDeg != null && startSample) {
        const change = shortestHeadingDeltaDeg(sample.headingDeg, startSample.headingDeg);
        const ok = change >= expect.minHeadingChangeDeg - tolerance.headingDeg;
        metrics.minHeadingChangeDeg = {
            expected: expect.minHeadingChangeDeg,
            actual: change,
            delta: Math.max(0, expect.minHeadingChangeDeg - change),
            tolerance: tolerance.headingDeg,
            pass: ok,
        };
        if (!ok) pass = false;
    }

    return {
        label: `t=${cp.atTimeSec}s`,
        atTimeSec: cp.atTimeSec,
        pass,
        metrics,
    };
}

/**
 * @param {import('./aircraft-scenario-types.js').AircraftScenario} scenario
 * @param {import('./aircraft-scenario-types.js').AircraftScenarioPoseSample[]} samples
 * @param {Partial<import('./aircraft-scenario-types.js').AircraftScenarioReport>} meta
 * @returns {import('./aircraft-scenario-types.js').AircraftScenarioReport}
 */
export function buildAircraftScenarioReport(scenario, samples, meta = {}) {
    /** @type {import('./aircraft-scenario-types.js').AircraftScenarioCheckpointResult[]} */
    const startSample = samples[0] || null;
    const checkpointResults = (scenario.checkpoints || []).map((cp) =>
        evaluateCheckpoint(cp, sampleAtTime(samples, cp.atTimeSec), startSample)
    );
    const pass = checkpointResults.every((c) => c.pass) && (meta.errors?.length ?? 0) === 0;

    const durationSec = samples.length
        ? samples[samples.length - 1].tSec
        : scenario.steps.reduce((s, step) => s + step.durationSec, 0);

    return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        pass,
        durationSec,
        startedAtIso: meta.startedAtIso || new Date().toISOString(),
        finishedAtIso: meta.finishedAtIso || new Date().toISOString(),
        tenantId: meta.tenantId,
        worldId: meta.worldId,
        slotId: meta.slotId,
        samples,
        checkpoints: checkpointResults,
        errors: meta.errors || [],
    };
}