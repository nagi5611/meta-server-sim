// addons/aircraft/lib/aircraft-scenario-schema.js — 飛行シナリオ JSON のスキーマ検証

const CONTROL_AXES = ['thrust', 'yaw', 'pitch', 'roll'];
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * @param {unknown} v
 * @returns {v is number}
 */
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, scenario: import('./aircraft-scenario-types.js').AircraftScenario } | { ok: false, errors: string[] }}
 */
export function validateAircraftScenario(raw) {
    /** @type {string[]} */
    const errors = [];
    if (!raw || typeof raw !== 'object') {
        return { ok: false, errors: ['root must be an object'] };
    }
    const o = /** @type {Record<string, unknown>} */ (raw);

    const id = String(o.id || '').trim();
    if (!ID_RE.test(id)) errors.push('id must match ^[a-zA-Z0-9_-]{1,64}$');

    const version = Number(o.version ?? 1);
    if (!Number.isInteger(version) || version < 1 || version > 1) {
        errors.push('version must be 1');
    }

    const name = String(o.name || id || '').trim();
    if (!name) errors.push('name is required');

    const controlMode = String(o.controlMode || 'easy').toLowerCase();
    if (controlMode !== 'easy' && controlMode !== 'hard') {
        errors.push('controlMode must be easy or hard');
    }

    const slotId = String(o.slotId || '').trim();
    if (slotId && !ID_RE.test(slotId)) errors.push('slotId must match id pattern when set');

    const libraryId = o.aircraftLibraryId != null ? String(o.aircraftLibraryId).trim() : '';
    if (libraryId && !ID_RE.test(libraryId)) errors.push('aircraftLibraryId invalid');

    const sampleIntervalMs = Number(o.sampleIntervalMs ?? 100);
    if (!isFiniteNumber(sampleIntervalMs) || sampleIntervalMs < 16 || sampleIntervalMs > 2000) {
        errors.push('sampleIntervalMs must be 16–2000');
    }

    const stepsRaw = o.steps;
    if (!Array.isArray(stepsRaw) || stepsRaw.length < 1) {
        errors.push('steps must be a non-empty array');
    }

    /** @type {import('./aircraft-scenario-types.js').AircraftScenarioStep[]} */
    const steps = [];
    if (Array.isArray(stepsRaw)) {
        stepsRaw.forEach((step, i) => {
            if (!step || typeof step !== 'object') {
                errors.push(`steps[${i}] must be an object`);
                return;
            }
            const s = /** @type {Record<string, unknown>} */ (step);
            const durationSec = Number(s.durationSec);
            if (!isFiniteNumber(durationSec) || durationSec <= 0 || durationSec > 600) {
                errors.push(`steps[${i}].durationSec must be 0–600 (exclusive 0)`);
            }
            const controls = s.controls;
            if (!controls || typeof controls !== 'object') {
                errors.push(`steps[${i}].controls required`);
                return;
            }
            const c = /** @type {Record<string, unknown>} */ (controls);
            /** @type {Record<string, number>} */
            const normalizedControls = {};
            for (const axis of CONTROL_AXES) {
                const v = Number(c[axis] ?? 0);
                if (!isFiniteNumber(v) || v < -1 || v > 1) {
                    errors.push(`steps[${i}].controls.${axis} must be -1..1`);
                } else {
                    normalizedControls[axis] = v;
                }
            }
            steps.push({ durationSec, controls: normalizedControls });
        });
    }

    const checkpointsRaw = o.checkpoints;
    /** @type {import('./aircraft-scenario-types.js').AircraftScenarioCheckpoint[]} */
    const checkpoints = [];
    if (checkpointsRaw != null) {
        if (!Array.isArray(checkpointsRaw)) {
            errors.push('checkpoints must be an array when set');
        } else {
            checkpointsRaw.forEach((cp, i) => {
                if (!cp || typeof cp !== 'object') {
                    errors.push(`checkpoints[${i}] must be an object`);
                    return;
                }
                const c = /** @type {Record<string, unknown>} */ (cp);
                const atTimeSec = Number(c.atTimeSec);
                if (!isFiniteNumber(atTimeSec) || atTimeSec < 0) {
                    errors.push(`checkpoints[${i}].atTimeSec must be >= 0`);
                }
                const expect = c.expect;
                const tolerance = c.tolerance;
                if (!expect || typeof expect !== 'object') {
                    errors.push(`checkpoints[${i}].expect required`);
                    return;
                }
                if (!tolerance || typeof tolerance !== 'object') {
                    errors.push(`checkpoints[${i}].tolerance required`);
                    return;
                }
                const ex = /** @type {Record<string, unknown>} */ (expect);
                const tol = /** @type {Record<string, unknown>} */ (tolerance);
                /** @type {import('./aircraft-scenario-types.js').AircraftScenarioCheckpoint['expect']} */
                const expectOut = {};
                if (ex.position != null) {
                    const p = /** @type {Record<string, unknown>} */ (ex.position);
                    if (![p.x, p.y, p.z].every(isFiniteNumber)) {
                        errors.push(`checkpoints[${i}].expect.position needs x,y,z`);
                    } else {
                        expectOut.position = { x: p.x, y: p.y, z: p.z };
                    }
                }
                if (ex.headingDeg != null) {
                    if (!isFiniteNumber(Number(ex.headingDeg))) {
                        errors.push(`checkpoints[${i}].expect.headingDeg must be number`);
                    } else {
                        expectOut.headingDeg = Number(ex.headingDeg);
                    }
                }
                if (ex.altitude != null) {
                    if (!isFiniteNumber(Number(ex.altitude))) {
                        errors.push(`checkpoints[${i}].expect.altitude must be number`);
                    } else {
                        expectOut.altitude = Number(ex.altitude);
                    }
                }
                if (ex.deltaPosition != null) {
                    const dp = /** @type {Record<string, unknown>} */ (ex.deltaPosition);
                    if (![dp.x, dp.y, dp.z].every(isFiniteNumber)) {
                        errors.push(`checkpoints[${i}].expect.deltaPosition needs x,y,z`);
                    } else {
                        expectOut.deltaPosition = { x: dp.x, y: dp.y, z: dp.z };
                    }
                }
                if (ex.minAltitudeGain != null) {
                    if (!isFiniteNumber(Number(ex.minAltitudeGain))) {
                        errors.push(`checkpoints[${i}].expect.minAltitudeGain must be number`);
                    } else {
                        expectOut.minAltitudeGain = Number(ex.minAltitudeGain);
                    }
                }
                if (ex.minHeadingChangeDeg != null) {
                    if (!isFiniteNumber(Number(ex.minHeadingChangeDeg))) {
                        errors.push(`checkpoints[${i}].expect.minHeadingChangeDeg must be number`);
                    } else {
                        expectOut.minHeadingChangeDeg = Number(ex.minHeadingChangeDeg);
                    }
                }
                if (Object.keys(expectOut).length === 0) {
                    errors.push(`checkpoints[${i}].expect needs at least one field`);
                }
                /** @type {import('./aircraft-scenario-types.js').AircraftScenarioCheckpoint['tolerance']} */
                const tolOut = {};
                if (tol.positionM != null) tolOut.positionM = Number(tol.positionM);
                if (tol.headingDeg != null) tolOut.headingDeg = Number(tol.headingDeg);
                if (tol.altitudeM != null) tolOut.altitudeM = Number(tol.altitudeM);
                if (Object.keys(tolOut).length === 0) {
                    errors.push(`checkpoints[${i}].tolerance needs at least one field`);
                }
                checkpoints.push({
                    atTimeSec,
                    expect: expectOut,
                    tolerance: tolOut,
                });
            });
        }
    }

    if (errors.length) return { ok: false, errors };

    /** @type {import('./aircraft-scenario-types.js').AircraftScenario} */
    const scenario = {
        id,
        version: 1,
        name,
        controlMode: /** @type {'easy'|'hard'} */ (controlMode),
        slotId: slotId || undefined,
        aircraftLibraryId: libraryId || undefined,
        sampleIntervalMs,
        steps,
        checkpoints,
    };
    return { ok: true, scenario };
}